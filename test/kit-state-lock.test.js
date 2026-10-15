import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fsSync from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withStateLock, readJsonState, writeJsonAtomic } from '../src/lib/kit/state-lock.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, 'fixtures', 'state-lock-worker.mjs');

async function inTemp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-state-lock-'));
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

/** Start a worker process; resolves { code, stdout, stderr }. `onHold` fires when it is first inside the lock. */
function worker(file, iterations, opts, onHold) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, file, String(iterations), JSON.stringify(opts)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', held = false;
    child.stdout.on('data', d => {
      stdout += d;
      if (!held && stdout.includes('HOLD')) { held = true; if (onHold) onHold(); }
    });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function deadPid() {
  const r = spawnSync(process.execPath, ['-e', '']);
  return r.pid;
}

async function count(file) { return (await readJsonState(file)).count; }

// This machine's identity as the lock module records it: a lock written by a dead process here names all three.
const PIDNS = (() => { try { return fsSync.readlinkSync('/proc/self/ns/pid'); } catch { return null; } })();
const BOOT = (() => { try { return fsSync.readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim() || null; } catch { return null; } })();
const here = () => ({ host: os.hostname(), pidns: PIDNS, boot: BOOT });

const lockBody = o => JSON.stringify({ token: 'x-' + Math.random(), beat: 0, ...o });

describe('state-lock: parallel processes', () => {
  it('12 processes x 20 increments end at 240, five times over', async () => {
    for (let round = 0; round < 5; round++) {
      await inTemp(async dir => {
        const file = path.join(dir, 'state', 'counter.json');
        const runs = await Promise.all(Array.from({ length: 12 }, () => worker(file, 20, { staleMs: 2000, pollMs: 2 })));
        for (const r of runs) assert.equal(r.code, 0, r.stderr);
        assert.equal(await count(file), 240, `round ${round}`);
        const left = (await fs.readdir(path.dirname(file))).sort();
        assert.deepEqual(left, ['counter.json'], 'no lock, break or temp file left behind');
      });
    }
  });

  it('a lock left by a dead process on this host is taken at once and every write is kept', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      await fs.writeFile(file + '.lock', lockBody({ pid: deadPid(), ...here() }));
      const t0 = performance.now();
      const runs = await Promise.all(Array.from({ length: 4 }, () => worker(file, 5, { staleMs: 10000, pollMs: 5 })));
      const took = performance.now() - t0;
      for (const r of runs) assert.equal(r.code, 0, r.stderr);
      assert.equal(await count(file), 20);
      assert.ok(took < 5000, `took ${took} ms, staleMs is 10000`);
    });
  });

  it('a same-host lock from another pid namespace is not taken by the dead-pid shortcut', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      await fs.writeFile(file + '.lock', lockBody({ pid: deadPid(), host: os.hostname(), pidns: 'pid:[1]-another-container' }));
      const t0 = performance.now();
      const r = await worker(file, 1, { staleMs: 1500, waitMs: 8000, pollMs: 5 });
      const took = performance.now() - t0;
      assert.equal(r.code, 0, r.stderr);
      assert.equal(await count(file), 1);
      assert.ok(took >= 1400, `took ${took} ms: a lock from another pid namespace must wait the full staleMs`);
    });
  });

  for (const [label, extra] of [
    ['a different boot id (another machine with the same hostname)', { boot: 'another-machine-boot-id' }],
    ['no boot field', { boot: undefined }],
  ]) {
    it(`a same-host, same-pidns lock with ${label} is not taken by the dead-pid shortcut`, async () => {
      await inTemp(async dir => {
        const file = path.join(dir, 'counter.json');
        await fs.writeFile(file + '.lock', lockBody({ pid: deadPid(), ...here(), ...extra }));
        const t0 = performance.now();
        const r = await worker(file, 1, { staleMs: 1500, waitMs: 8000, pollMs: 5 });
        const took = performance.now() - t0;
        assert.equal(r.code, 0, r.stderr);
        assert.equal(await count(file), 1);
        assert.ok(took >= 1400, `took ${took} ms: a lock with ${label} must wait the full staleMs`);
      });
    });
  }

  it('a lock from another host whose content never changes is broken after staleMs', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      await fs.writeFile(file + '.lock', lockBody({ pid: 1, host: 'some-other-host.invalid' }));
      const t0 = performance.now();
      const runs = await Promise.all(Array.from({ length: 3 }, () => worker(file, 5, { staleMs: 300, waitMs: 5000, pollMs: 5 })));
      const took = performance.now() - t0;
      for (const r of runs) assert.equal(r.code, 0, r.stderr);
      assert.equal(await count(file), 15);
      assert.ok(took >= 300, `broken after ${took} ms, before staleMs`);
    });
  });

  it('a live holder working 3 x staleMs is not broken (heartbeat); both writes kept', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      let waiter;
      const holder = worker(file, 1, { staleMs: 300, waitMs: 5000, pollMs: 5, holdMs: 900 }, () => {
        waiter = worker(file, 1, { staleMs: 300, waitMs: 5000, pollMs: 5 });
      });
      const h = await holder;
      assert.ok(waiter, 'holder reached the lock');
      const w = await waiter;
      assert.equal(h.code, 0, h.stderr);
      assert.equal(w.code, 0, w.stderr);
      assert.equal(await count(file), 2, 'the waiter did not break the live lock');
    });
  });

  for (const [label, offsetS] of [['an hour in the past', -3600], ['an hour in the future', 3600]]) {
    it(`lock mtime ${label} while the holder is live: no break`, async () => {
      await inTemp(async dir => {
        const file = path.join(dir, 'counter.json');
        let waiter, stop = false, touching;
        const holder = worker(file, 1, { staleMs: 300, waitMs: 5000, pollMs: 5, holdMs: 900 }, () => {
          touching = (async () => {
            while (!stop) {
              const t = new Date(Date.now() + offsetS * 1000);
              await fs.utimes(file + '.lock', t, t).catch(() => {});
              await new Promise(r => setTimeout(r, 20));
            }
          })();
          waiter = worker(file, 1, { staleMs: 300, waitMs: 5000, pollMs: 5 });
        });
        const h = await holder;
        stop = true;
        await touching;
        const w = await waiter;
        assert.equal(h.code, 0, h.stderr);
        assert.equal(w.code, 0, w.stderr);
        assert.equal(await count(file), 2);
      });
    });
  }
});

/** fs shim: break-file creation fails with `code`; counts calls. */
function shim(over = {}) {
  const calls = { open: 0, breakOpen: 0, read: 0 };
  const f = {
    ...fs,
    async open(p, flags, mode) {
      calls.open++;
      if (String(p).endsWith('.break')) {
        calls.breakOpen++;
        if (over.breakCode) throw Object.assign(new Error(over.breakCode), { code: over.breakCode });
      }
      return fs.open(p, flags, mode);
    },
    async readFile(p, o) {
      calls.read++;
      if (over.readCode && String(p).endsWith('.lock')) throw Object.assign(new Error(over.readCode), { code: over.readCode });
      return fs.readFile(p, o);
    },
  };
  return { fs: f, calls };
}

describe('state-lock: bounded waits', () => {
  it('break file cannot be created (EACCES): KitExit 1 within waitMs, no spin', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      await fs.writeFile(file + '.lock', lockBody({ pid: 1, host: 'some-other-host.invalid' }));
      const { fs: f, calls } = shim({ breakCode: 'EACCES' });
      const cpu0 = process.cpuUsage(), t0 = performance.now();
      await assert.rejects(withStateLock(file, async () => assert.fail('must not run'), { staleMs: 100, waitMs: 600, pollMs: 5, fs: f }),
        err => err instanceof KitExit && err.code === 1 && /cannot lock .*EACCES/.test(err.message));
      const took = performance.now() - t0, cpu = process.cpuUsage(cpu0);
      assert.ok(took < 900, `took ${took} ms`);
      assert.ok(calls.breakOpen <= 1, `break tried ${calls.breakOpen} times`);
      assert.ok(calls.open < 200, `${calls.open} open calls`);
      assert.ok((cpu.user + cpu.system) / 1000 < took, 'no hot spin');
    });
  });

  it('a live holder past waitMs: KitExit 1 naming the holder pid and host, with bounded polling', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      let release;
      const held = new Promise(r => { release = r; });
      let inside;
      const entered = new Promise(r => { inside = r; });
      const holder = withStateLock(file, async () => { inside(); await held; }, { staleMs: 200 });
      await entered;
      const { fs: f, calls } = shim();
      const t0 = performance.now();
      await assert.rejects(withStateLock(file, async () => assert.fail('must not run'), { staleMs: 200, waitMs: 500, pollMs: 5, fs: f }),
        err => err instanceof KitExit && err.code === 1 &&
          err.message === `${file} is locked by another run (holder pid ${process.pid} on host ${os.hostname()})`);
      const took = performance.now() - t0;
      assert.ok(took >= 500 && took < 900, `took ${took} ms`);
      assert.ok(calls.open < 150, `${calls.open} open calls`);
      release();
      await holder;
      await assert.rejects(fs.stat(file + '.lock'), { code: 'ENOENT' });
    });
  });

  it('an unreadable lock file still ends at the wait cap', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      await fs.writeFile(file + '.lock', lockBody({ pid: 1, host: 'h' }));
      const { fs: f, calls } = shim({ readCode: 'EIO' });
      const t0 = performance.now();
      await assert.rejects(withStateLock(file, async () => {}, { staleMs: 100, waitMs: 400, pollMs: 5, fs: f }),
        err => err instanceof KitExit && err.code === 1 && /is locked by another run/.test(err.message));
      const took = performance.now() - t0;
      assert.ok(took < 800, `took ${took} ms`);
      assert.ok(calls.read < 150, `${calls.read} reads`);
    });
  });

  it('a leftover break file from a dead breaker is cleared and the stale lock is broken', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      await fs.writeFile(file + '.lock', lockBody({ pid: deadPid(), ...here() }));
      await fs.writeFile(file + '.lock.break', lockBody({ pid: deadPid(), ...here() }));
      const t0 = performance.now();
      const runs = await Promise.all(Array.from({ length: 3 }, () => worker(file, 3, { staleMs: 5000, pollMs: 5 })));
      for (const r of runs) assert.equal(r.code, 0, r.stderr);
      assert.equal(await count(file), 9);
      assert.ok(performance.now() - t0 < 4000);
      assert.deepEqual(await fs.readdir(dir), ['counter.json']);
    });
  });

  it('a leftover break file from another host that never changes is judged stale by observation', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      await fs.writeFile(file + '.lock', lockBody({ pid: 1, host: 'other.invalid' }));
      await fs.writeFile(file + '.lock.break', lockBody({ pid: 1, host: 'other.invalid' }));
      let ran = false;
      await withStateLock(file, async () => { ran = true; }, { staleMs: 150, waitMs: 2000, pollMs: 5 });
      assert.ok(ran);
      assert.deepEqual(await fs.readdir(dir), []);
    });
  });

  it('a holder whose heartbeat stalled and lost the lock saves nothing; the other run\'s write survives', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      // The holder's heartbeat cannot reopen its lock (stalled filesystem), so a waiter judges it stale and breaks it.
      const stalled = { ...fs, async open(p, flags, mode) {
        if (flags === 'r+') throw Object.assign(new Error('stalled'), { code: 'EIO' });
        return fs.open(p, flags, mode);
      } };
      let inside;
      const entered = new Promise(r => { inside = r; });
      let resume;
      const resumed = new Promise(r => { resume = r; });
      const first = withStateLock(file, async () => {
        inside();
        await resumed;
        await writeJsonAtomic(file, { who: 'first' });
      }, { staleMs: 100, waitMs: 2000, pollMs: 5, fs: stalled });
      const firstDone = first.then(() => null, err => err);
      await entered;
      await withStateLock(file, async () => { await writeJsonAtomic(file, { who: 'second' }); }, { staleMs: 100, waitMs: 2000, pollMs: 5 });
      resume();
      const err = await firstDone;
      assert.ok(err instanceof KitExit, `the first holder must fail, got ${err}`);
      assert.equal(err.code, 1);
      assert.equal(err.message, `lost the lock on ${file} to another run; nothing saved`);
      assert.ok(!err.message.includes('first'), 'no content in the message');
      assert.deepEqual(await readJsonState(file), { who: 'second' });
      assert.deepEqual(await fs.readdir(dir), ['counter.json'], 'no temp or lock file left behind');
    });
  });

  it('a holder whose lock file was replaced by another token mid-fn saves nothing', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'counter.json');
      await writeJsonAtomic(file, { who: 'before' });
      await assert.rejects(withStateLock(file, async () => {
        await fs.writeFile(file + '.lock', lockBody({ pid: 1, host: 'other.invalid' }));
        await writeJsonAtomic(file, { who: 'other' }); // still our context, so it must refuse too
      }, { staleMs: 1000 }), err => err instanceof KitExit && err.code === 1 && err.message === `lost the lock on ${file} to another run; nothing saved`);
      assert.deepEqual(await readJsonState(file), { who: 'before' });
      assert.deepEqual((await fs.readdir(dir)).sort(), ['counter.json', 'counter.json.lock'], 'the other run\'s lock is left alone');
    });
  });

  it('inside a lock, writeJsonAtomic to another file is not checked against this lock', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'a.json');
      const other = path.join(dir, 'b.json');
      await withStateLock(file, async () => {
        await writeJsonAtomic(other, { b: 1 });
        await writeJsonAtomic(file, { a: 1 });
      });
      assert.deepEqual(await readJsonState(other), { b: 1 });
      assert.deepEqual(await readJsonState(file), { a: 1 });
    });
  });

  it('refuses waitMs not greater than staleMs', async () => {
    await inTemp(async dir => {
      await assert.rejects(withStateLock(path.join(dir, 'f.json'), async () => {}, { staleMs: 500, waitMs: 500 }),
        err => err instanceof KitExit && err.code === 1);
    });
  });

  it('a lock open error other than EEXIST is fatal', async () => {
    await inTemp(async dir => {
      await fs.writeFile(path.join(dir, 'plain'), '');
      const file = path.join(dir, 'plain', 'f.json');
      await assert.rejects(withStateLock(file, async () => {}, { staleMs: 100 }),
        err => err instanceof KitExit && err.code === 1 && err.message.startsWith(`cannot lock ${file}: `));
      const { fs: f } = shim();
      f.open = async () => { throw Object.assign(new Error('x'), { code: 'EROFS' }); };
      const file2 = path.join(dir, 'g.json');
      await assert.rejects(withStateLock(file2, async () => {}, { staleMs: 100, fs: f }),
        err => err instanceof KitExit && err.code === 1 && err.message === `cannot lock ${file2}: EROFS`);
    });
  });

  it('returns fn\'s value and releases the lock when fn throws', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'f.json');
      assert.equal(await withStateLock(file, async () => 42), 42);
      await assert.rejects(withStateLock(file, async () => { throw new Error('boom'); }), /boom/);
      assert.deepEqual(await fs.readdir(dir), []);
    });
  });
});

describe('state-lock: readJsonState / writeJsonAtomic', () => {
  it('strips a UTF-8 BOM', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 's.json');
      await fs.writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')]));
      assert.deepEqual(await readJsonState(file), { a: 1 });
    });
  });

  for (const [name, bom] of [['FF FE', [0xff, 0xfe]], ['FE FF', [0xfe, 0xff]]]) {
    it(`refuses a UTF-16 file (${name}) without echoing it`, async () => {
      await inTemp(async dir => {
        const file = path.join(dir, 's.json');
        await fs.writeFile(file, Buffer.concat([Buffer.from(bom), Buffer.from('{"secret":"hunter2"}', 'utf16le')]));
        await assert.rejects(readJsonState(file), err => err instanceof KitExit && err.code === 1 &&
          err.message === `${file} is UTF-16; save it as UTF-8` && !err.message.includes('hunter2'));
      });
    });
  }

  it('malformed JSON fails with a fixed text that does not echo the content', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 's.json');
      await fs.writeFile(file, '{"secret": hunter2-token}');
      await assert.rejects(readJsonState(file), err => err instanceof KitExit && err.code === 1 &&
        /is not valid JSON/.test(err.message) && !err.message.includes('hunter2'));
    });
  });

  it('a missing file gives the fallback; without one it is an error', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'none.json');
      assert.deepEqual(await readJsonState(file, { fallback: { n: 0 } }), { n: 0 });
      await assert.rejects(readJsonState(file), err => err instanceof KitExit && err.code === 1);
    });
  });

  it('writeJsonAtomic keeps an existing file\'s mode (0644 stays 0644, 0640 stays 0640)', { skip: process.platform === 'win32' }, async () => {
    await inTemp(async dir => {
      for (const mode of [0o644, 0o640]) {
        const file = path.join(dir, `m${mode.toString(8)}.json`);
        await fs.writeFile(file, '{}');
        await fs.chmod(file, mode);
        await writeJsonAtomic(file, { x: 1 });
        assert.equal((await fs.stat(file)).mode & 0o7777, mode);
        assert.deepEqual(await readJsonState(file), { x: 1 });
      }
    });
  });

  it('writeJsonAtomic creates a new file with 0666 masked by the umask', { skip: process.platform === 'win32' }, async () => {
    await inTemp(async dir => {
      const old = process.umask(0o027);
      try {
        const file = path.join(dir, 'new.json');
        await writeJsonAtomic(file, { x: 1 });
        assert.equal((await fs.stat(file)).mode & 0o7777, 0o640);
        process.umask(0o022);
        const file2 = path.join(dir, 'new2.json');
        await writeJsonAtomic(file2, { x: 1 });
        assert.equal((await fs.stat(file2)).mode & 0o7777, 0o644);
      } finally { process.umask(old); }
    });
  });

  it('writeJsonAtomic creates folders, leaves no temp file, and names the file when the folder cannot be made', async () => {
    await inTemp(async dir => {
      const file = path.join(dir, 'a', 'b', 's.json');
      await writeJsonAtomic(file, { x: 1 });
      assert.deepEqual(await readJsonState(file), { x: 1 });
      assert.deepEqual(await fs.readdir(path.dirname(file)), ['s.json']);
      await fs.writeFile(path.join(dir, 'plain'), '');
      const bad = path.join(dir, 'plain', 'sub', 's.json');
      await assert.rejects(writeJsonAtomic(bad, {}), err => err instanceof KitExit && err.code === 1 && err.message.includes(bad));
    });
  });
});
