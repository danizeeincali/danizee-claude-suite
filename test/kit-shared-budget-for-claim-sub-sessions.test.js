import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import * as sb from '../src/lib/kit/shared-budget.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';

async function withDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-budget-'));
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
const call = (dir, args) => sb.run(['--state', 'b.json', ...args], { cwd: dir });
const code = async (p) => { try { await p; return 0; } catch (e) { assert.ok(e instanceof KitExit); return e.code; } };

describe('shared-budget library', () => {
  it('exports the verb contract', () => {
    assert.equal(sb.verb, 'shared-budget');
    assert.equal(typeof sb.usage, 'string');
  });

  it('grant returns the remainder of each limit', () => {
    let s = sb.openBudget({ steps: 10, cost: 5, timeMs: 1000 }, 0);
    s = sb.recordSpend(s, { helper: 'a', steps: 3, cost: 1.5, outcome: 'ok' }).state;
    const g = sb.grantFor(s, { helper: 'b' }, 100);
    assert.equal(g.skip, false);
    assert.deepEqual(g.remaining, { steps: 7, cost: 3.5, timeMs: 1000 });
  });

  it('unlimited dimensions are null in a grant', () => {
    const s = sb.openBudget({ steps: 4 }, 0);
    assert.deepEqual(sb.grantFor(s, { helper: 'a' }, 0).remaining, { steps: 4, cost: null, timeMs: null });
  });

  it('skips with a reason when any limit is exhausted', () => {
    let s = sb.openBudget({ steps: 2, cost: 10 }, 0);
    s = sb.recordSpend(s, { helper: 'a', steps: 2, cost: 1, outcome: 'ok' }).state;
    const g = sb.grantFor(s, { helper: 'b' }, 0);
    assert.equal(g.skip, true);
    assert.match(g.reason, /steps/);
  });

  it('a check grant ignores steps and cost but obeys time', () => {
    let s = sb.openBudget({ steps: 1, cost: 1, timeMs: 100 }, 0);
    s = sb.recordSpend(s, { helper: 'a', steps: 5, cost: 5, outcome: 'ok' }).state;
    assert.equal(sb.grantFor(s, { helper: 'c', kind: 'check' }, 0).skip, false);
    assert.equal(sb.grantFor(s, { helper: 'c' }, 0).skip, true);
    s = sb.startClock(s, 0);
    const late = sb.grantFor(s, { helper: 'c', kind: 'check' }, 150);
    assert.equal(late.skip, true);
    assert.match(late.reason, /time/);
  });

  it('clock runs only while active; nested starts count once', () => {
    let s = sb.openBudget({ timeMs: 1000 }, 0);
    assert.equal(sb.elapsed(s, 500), 0);
    s = sb.startClock(s, 100);
    s = sb.startClock(s, 200); // nested
    assert.equal(s.clock.depth, 2);
    s = sb.stopClock(s, 300);  // inner stop: still running
    assert.equal(sb.elapsed(s, 400), 300);
    s = sb.stopClock(s, 500);
    assert.equal(s.clock.depth, 0);
    assert.equal(sb.elapsed(s, 9000), 400);
  });

  it('stop without start is invalid', () => {
    assert.throws(() => sb.stopClock(sb.openBudget({}, 0), 1), (e) => e instanceof KitExit && e.code === 1);
  });

  it('a clock that moves backwards never subtracts time', () => {
    let s = sb.openBudget({ timeMs: 100 }, 0);
    s = sb.startClock(s, 500);
    assert.equal(sb.elapsed(s, 400), 0);
    s = sb.stopClock(s, 300);
    assert.equal(sb.elapsed(s, 300), 0);
  });

  it('records failed spend and reports an overrun truthfully', () => {
    let s = sb.openBudget({ steps: 3, cost: 2 }, 0);
    const r = sb.recordSpend(s, { helper: 'a', steps: 5, cost: 1, outcome: 'failed' });
    assert.deepEqual(r.overrun, { steps: 2 });
    assert.equal(r.state.spent.steps, 5);
    const st = sb.statusOf(r.state, 0);
    assert.equal(st.remaining.steps, 0);
    assert.equal(st.helpers[0].failed, 1);
    assert.equal(st.helpers[0].steps, 5);
  });

  it('per-helper rows accumulate and skips are logged', () => {
    let s = sb.openBudget({ steps: 1 }, 0);
    s = sb.recordSpend(s, { helper: 'a', steps: 1, cost: 0, outcome: 'ok' }).state;
    s = sb.recordSpend(s, { helper: 'a', steps: 0, cost: 0, outcome: 'ok' }).state;
    s = sb.recordGrant(s, 'b', sb.grantFor(s, { helper: 'b' }, 0));
    const st = sb.statusOf(s, 0);
    const a = st.helpers.find((h) => h.helper === 'a');
    const b = st.helpers.find((h) => h.helper === 'b');
    assert.equal(a.ok, 2);
    assert.equal(b.skipped, 1);
  });

  it('validates limits and spend input', () => {
    for (const bad of [{ steps: 0 }, { steps: -1 }, { steps: 1.5 }, { cost: 0 }, { cost: NaN }, { timeMs: -5 }, { steps: '3' }]) {
      assert.throws(() => sb.openBudget(bad, 0), (e) => e instanceof KitExit && e.code === 1, JSON.stringify(bad));
    }
    const s = sb.openBudget({}, 0);
    assert.throws(() => sb.recordSpend(s, { helper: 'a', steps: -1, cost: 0, outcome: 'ok' }), KitExit);
    assert.throws(() => sb.recordSpend(s, { helper: 'a', steps: 1, cost: 0, outcome: 'meh' }), KitExit);
    assert.throws(() => sb.recordSpend(s, { helper: '', steps: 1, cost: 0, outcome: 'ok' }), KitExit);
  });

  it('rejects corrupt state', () => {
    assert.throws(() => sb.checkState({ version: 1 }), KitExit);
    assert.throws(() => sb.checkState(null), KitExit);
    const s = sb.openBudget({}, 0);
    s.clock.depth = -1;
    assert.throws(() => sb.checkState(s), KitExit);
  });
});

describe('shared-budget CLI', () => {
  it('full lifecycle with an injected clock', () => withDir(async (dir) => {
    const o = await call(dir, ['open', '--steps', '4', '--cost', '10', '--time-ms', '1000', '--now', '0']);
    assert.equal(o.opened, true);
    assert.equal((await call(dir, ['start', '--now', '100'])).depth, 1);
    assert.equal((await call(dir, ['start', '--now', '150'])).depth, 2);
    const g = await call(dir, ['grant', '--helper', 'h1', '--now', '200']);
    assert.deepEqual(g.remaining, { steps: 4, cost: 10, timeMs: 900 });
    const sp = await call(dir, ['spend', '--helper', 'h1', '--steps', '2', '--cost', '4', '--outcome', 'ok', '--now', '250']);
    assert.equal(sp.remaining.steps, 2);
    await call(dir, ['stop', '--now', '300']);
    const last = await call(dir, ['stop', '--now', '400']);
    assert.equal(last.elapsedMs, 300);
    const st = await call(dir, ['status', '--now', '5000']);
    assert.equal(st.elapsedMs, 300);
    assert.equal(st.helpers[0].helper, 'h1');
    const left = JSON.parse(await fs.readFile(path.join(dir, 'b.json'), 'utf8'));
    assert.equal(left.spent.steps, 2);
    assert.deepEqual((await fs.readdir(dir)).filter((f) => f.includes('.tmp')), []);
  }));

  it('exhaustion is a skip with exit 0, not a failure', () => withDir(async (dir) => {
    await call(dir, ['open', '--steps', '1', '--now', '0']);
    await call(dir, ['spend', '--helper', 'a', '--steps', '3', '--cost', '0', '--outcome', 'failed', '--now', '1']);
    const g = await call(dir, ['grant', '--helper', 'b', '--now', '2']);
    assert.equal(g.skip, true);
    assert.ok(g.reason);
    assert.equal(g.exit, undefined);
    const sp = await call(dir, ['spend', '--helper', 'c', '--steps', '1', '--cost', '0', '--outcome', 'ok', '--now', '3']);
    assert.deepEqual(sp.overrun, { steps: 3 });
  }));

  it('exit 1 on bad input and corrupt state', () => withDir(async (dir) => {
    assert.equal(await code(call(dir, ['status'])), 1); // no state
    assert.equal(await code(call(dir, ['bogus'])), 1);
    assert.equal(await code(sb.run(['open'], { cwd: dir })), 1); // no --state
    assert.equal(await code(call(dir, ['open', '--steps', '0'])), 1);
    assert.equal(await code(call(dir, ['open', '--steps', 'x'])), 1);
    await call(dir, ['open', '--steps', '3']);
    assert.equal(await code(call(dir, ['open', '--steps', '3'])), 1); // exists
    assert.equal(await code(call(dir, ['grant'])), 1); // helper missing
    assert.equal(await code(call(dir, ['grant', '--helper', 'a', '--kind', 'weird'])), 1);
    assert.equal(await code(call(dir, ['spend', '--helper', 'a', '--outcome', 'ok'])), 1); // nothing spent
    assert.equal(await code(call(dir, ['stop'])), 1);
    assert.equal(await code(call(dir, ['status', '--now', '-1'])), 1);
    await fs.writeFile(path.join(dir, 'b.json'), '{not json');
    assert.equal(await code(call(dir, ['status'])), 1);
  }));
});

const KIT_CLI = fileURLToPath(new URL('../src/lib/kit/cli.js', import.meta.url));
const proc = (dir, args) => new Promise((resolve) => execFile(process.execPath, [KIT_CLI, 'shared-budget', '--state', 'b.json', ...args], { cwd: dir },
  (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
const readState = async (dir) => JSON.parse(await fs.readFile(path.join(dir, 'b.json'), 'utf8'));

describe('shared-budget reservations (grants hold budget)', () => {
  it('a grant reserves what it hands out; later grants only get the rest', () => {
    let s = sb.openBudget({ steps: 10, cost: 5 }, 0);
    const g1 = sb.grantFor(s, { helper: 'a' }, 0);
    s = sb.recordGrant(s, 'a', g1);
    assert.deepEqual(g1.remaining, { steps: 10, cost: 5, timeMs: null });
    const g2 = sb.grantFor(s, { helper: 'b' }, 0);
    assert.equal(g2.skip, true);
    assert.match(g2.reason, /reserved/);
  });

  it('a spend releases its helper reservation', () => {
    let s = sb.openBudget({ steps: 10 }, 0);
    s = sb.recordGrant(s, 'a', sb.grantFor(s, { helper: 'a' }, 0));
    s = sb.recordSpend(s, { helper: 'a', steps: 3, cost: 0, outcome: 'ok' }).state;
    const g = sb.grantFor(s, { helper: 'b' }, 0);
    assert.equal(g.skip, false);
    assert.equal(g.remaining.steps, 7);
  });

  it('re-granting the same helper replaces, not stacks, its reservation', () => {
    let s = sb.openBudget({ steps: 10 }, 0);
    s = sb.recordGrant(s, 'a', sb.grantFor(s, { helper: 'a' }, 0));
    const again = sb.grantFor(s, { helper: 'a' }, 0);
    assert.equal(again.skip, false);
    assert.equal(again.remaining.steps, 10);
  });

  it('check grants reserve nothing and time is never reserved', () => {
    let s = sb.openBudget({ steps: 2, timeMs: 1000 }, 0);
    s = sb.recordGrant(s, 'c', sb.grantFor(s, { helper: 'c', kind: 'check' }, 0));
    assert.equal(sb.grantFor(s, { helper: 'm' }, 0).skip, false);
    s = sb.recordGrant(s, 'm', sb.grantFor(s, { helper: 'm' }, 0));
    assert.equal(sb.grantFor(s, { helper: 'c2', kind: 'check' }, 0).skip, false);
    assert.equal(sb.statusOf(s, 0).remaining.timeMs, 1000);
  });

  it('status shows reserved and available amounts', () => {
    let s = sb.openBudget({ steps: 10, cost: 4 }, 0);
    s = sb.recordGrant(s, 'a', sb.grantFor(s, { helper: 'a' }, 0));
    const st = sb.statusOf(s, 0);
    assert.deepEqual(st.reserved, { steps: 10, cost: 4 });
    assert.deepEqual(st.available, { steps: 0, cost: 0, timeMs: null });
    assert.equal(st.remaining.steps, 10);
  });

  it('parallel grants together never exceed the limit', () => withDir(async (dir) => {
    await call(dir, ['open', '--steps', '10', '--now', '0']);
    const grants = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((h) => call(dir, ['grant', '--helper', h, '--now', '1'])));
    const live = grants.filter((g) => !g.skip);
    assert.equal(live.length, 1);
    assert.equal(live.reduce((n, g) => n + g.remaining.steps, 0), 10);
    for (const g of grants.filter((x) => x.skip)) assert.match(g.reason, /reserved/);
    const st = await call(dir, ['status', '--now', '2']);
    assert.deepEqual(st.reserved.steps, 10);
  }));

  it('parallel grants from separate processes never exceed the limit', () => withDir(async (dir) => {
    await call(dir, ['open', '--steps', '10', '--cost', '6', '--now', '0']);
    const rs = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((h) => proc(dir, ['grant', '--helper', h, '--now', '1'])));
    for (const r of rs) assert.equal(r.code, 0, r.stderr);
    const gs = rs.map((r) => JSON.parse(r.stdout));
    assert.equal(gs.reduce((n, g) => n + (g.skip ? 0 : g.remaining.steps), 0), 10);
    assert.equal(gs.reduce((n, g) => n + (g.skip ? 0 : g.remaining.cost), 0), 6);
  }));

  it('old state rows without a reservation still load', () => {
    const s = sb.openBudget({ steps: 3 }, 0);
    s.helpers.x = { steps: 1, cost: 0, ok: 1, failed: 0, grants: 1, skipped: 0 };
    sb.checkState(s);
    assert.equal(sb.grantFor(s, { helper: 'y' }, 0).remaining.steps, 3);
  });
});

describe('shared-budget concurrent writers keep every write', () => {
  it('20 parallel in-process spends are all recorded', () => withDir(async (dir) => {
    await call(dir, ['open', '--now', '0']);
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call(dir, ['spend', '--helper', `h${i % 4}`, '--steps', '1', '--outcome', 'ok', '--now', '1'])));
    assert.equal(rs.length, 20);
    const s = await readState(dir);
    assert.equal(s.spent.steps, 20);
    assert.equal(Object.values(s.helpers).reduce((n, h) => n + h.ok, 0), 20);
    assert.deepEqual((await fs.readdir(dir)).filter((f) => f !== 'b.json'), []);
  }));

  it('20 parallel spend processes are all recorded', () => withDir(async (dir) => {
    await call(dir, ['open', '--now', '0']);
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => proc(dir, ['spend', '--helper', `h${i}`, '--steps', '1', '--outcome', 'ok', '--now', '1'])));
    for (const r of rs) assert.equal(r.code, 0, r.stderr);
    const s = await readState(dir);
    assert.equal(s.spent.steps, 20);
    assert.equal(Object.keys(s.helpers).length, 20);
    assert.deepEqual((await fs.readdir(dir)).filter((f) => f !== 'b.json'), []);
  }));

  it('parallel start/stop keep the depth counter exact', () => withDir(async (dir) => {
    await call(dir, ['open', '--now', '0']);
    await Promise.all(Array.from({ length: 10 }, () => call(dir, ['start', '--now', '5'])));
    assert.equal((await readState(dir)).clock.depth, 10);
    await Promise.all(Array.from({ length: 10 }, () => call(dir, ['stop', '--now', '15'])));
    const s = await readState(dir);
    assert.equal(s.clock.depth, 0);
    assert.equal(s.clock.elapsedMs, 10);
  }));

  it('parallel grants keep every grant count', () => withDir(async (dir) => {
    await call(dir, ['open', '--now', '0']);
    await Promise.all(Array.from({ length: 12 }, () => call(dir, ['grant', '--helper', 'same', '--now', '1'])));
    assert.equal((await readState(dir)).helpers.same.grants, 12);
  }));

  it('a stale lock file from a dead process is broken', () => withDir(async (dir) => {
    await call(dir, ['open', '--now', '0']);
    const lock = path.join(dir, 'b.json.lock');
    await fs.writeFile(lock, 'dead');
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await fs.utimes(lock, old, old);
    await call(dir, ['spend', '--helper', 'a', '--steps', '1', '--outcome', 'ok', '--now', '1']);
    assert.equal((await readState(dir)).spent.steps, 1);
    assert.deepEqual((await fs.readdir(dir)).filter((f) => f !== 'b.json'), []);
  }));

  it('the lock is released when a command fails', () => withDir(async (dir) => {
    await call(dir, ['open', '--now', '0']);
    assert.equal(await code(call(dir, ['stop', '--now', '1'])), 1);
    assert.deepEqual((await fs.readdir(dir)).filter((f) => f !== 'b.json'), []);
  }));
});

describe('shared-budget bounded grants and release', () => {
  it('a grant with --steps/--cost reserves only that share, capped at what is available', () => {
    let s = sb.openBudget({ steps: 10, cost: 5 }, 0);
    const a = sb.grantFor(s, { helper: 'a', steps: 4, cost: 2 }, 0);
    assert.deepEqual(a.remaining, { steps: 4, cost: 2, timeMs: null });
    s = sb.recordGrant(s, 'a', a);
    const b = sb.grantFor(s, { helper: 'b', steps: 100, cost: 100 }, 0);
    assert.equal(b.skip, false);
    assert.deepEqual(b.remaining, { steps: 6, cost: 3, timeMs: null });
    s = sb.recordGrant(s, 'b', b);
    assert.equal(sb.grantFor(s, { helper: 'c', steps: 1 }, 0).skip, true);
  });

  it('a share on one dimension leaves the other at its default', () => {
    const s = sb.openBudget({ steps: 10, cost: 5 }, 0);
    assert.deepEqual(sb.grantFor(s, { helper: 'a', steps: 3 }, 0).remaining, { steps: 3, cost: 5, timeMs: null });
  });

  it('--parts N splits what is available evenly, grant after grant', () => {
    let s = sb.openBudget({ steps: 9, cost: 6 }, 0);
    for (const h of ['a', 'b', 'c']) {
      const g = sb.grantFor(s, { helper: h, parts: 3 }, 0);
      assert.deepEqual(g.remaining, { steps: 3, cost: 2, timeMs: null }, h);
      s = sb.recordGrant(s, h, g);
    }
    assert.equal(sb.grantFor(s, { helper: 'd', parts: 3 }, 0).skip, true);
  });

  it('an explicit share beats --parts', () => {
    const s = sb.openBudget({ steps: 9 }, 0);
    assert.equal(sb.grantFor(s, { helper: 'a', steps: 2, parts: 3 }, 0).remaining.steps, 2);
  });

  it('rejects bad shares and parts, and shares on a check grant', () => {
    const s = sb.openBudget({ steps: 9 }, 0);
    for (const bad of [{ steps: 0 }, { steps: -1 }, { steps: 1.5 }, { cost: 0 }, { parts: 0 }, { parts: 1.5 }]) {
      assert.throws(() => sb.grantFor(s, { helper: 'a', ...bad }, 0), (e) => e instanceof KitExit && e.code === 1, JSON.stringify(bad));
    }
    assert.throws(() => sb.grantFor(s, { helper: 'a', kind: 'check', steps: 1 }, 0), (e) => e instanceof KitExit && e.code === 1);
  });

  it('release frees a dead helper reservation so later grants work again', () => {
    let s = sb.openBudget({ steps: 10, cost: 5 }, 0);
    s = sb.recordGrant(s, 'dead', sb.grantFor(s, { helper: 'dead' }, 0));
    assert.equal(sb.grantFor(s, { helper: 'b' }, 0).skip, true);
    const r = sb.releaseHelper(s, 'dead');
    assert.deepEqual(r.freed, { steps: 10, cost: 5 });
    assert.equal(r.state.spent.steps, 0);
    assert.equal(sb.grantFor(r.state, { helper: 'b' }, 0).remaining.steps, 10);
  });

  it('release of an unknown helper is invalid input', () => {
    assert.throws(() => sb.releaseHelper(sb.openBudget({}, 0), 'nobody'), (e) => e instanceof KitExit && e.code === 1);
  });

  it('usage text names release and the grant share flags', () => {
    assert.match(sb.usage, /release/);
    assert.match(sb.usage, /--parts/);
    assert.match(sb.usage, /release --helper|release:.*--helper/);
  });

  it('CLI: grant --steps/--cost/--parts and release', () => withDir(async (dir) => {
    await call(dir, ['open', '--steps', '10', '--cost', '4', '--now', '0']);
    const a = await call(dir, ['grant', '--helper', 'a', '--steps', '3', '--cost', '1', '--now', '1']);
    assert.deepEqual(a.remaining, { steps: 3, cost: 1, timeMs: null });
    const b = await call(dir, ['grant', '--helper', 'b', '--parts', '2', '--now', '1']);
    assert.equal(b.skip, false);
    assert.equal(b.remaining.steps, 7);
    const rel = await call(dir, ['release', '--helper', 'a', '--now', '2']);
    assert.deepEqual(rel, { released: true, helper: 'a', freed: { steps: 3, cost: 1 } });
    assert.equal((await call(dir, ['status', '--now', '2'])).reserved.steps, 7);
    assert.equal(await code(call(dir, ['release', '--helper', 'ghost'])), 1);
    assert.equal(await code(call(dir, ['release'])), 1);
    assert.equal(await code(call(dir, ['spend', '--helper', 'a', '--steps', '1', '--parts', '2', '--outcome', 'ok'])), 1);
    assert.equal(await code(call(dir, ['grant', '--helper', 'z', '--parts', '0'])), 1);
  }));

  it('parallel processes with --parts 4 never over-reserve', () => withDir(async (dir) => {
    await call(dir, ['open', '--steps', '8', '--now', '0']);
    const rs = await Promise.all(['a', 'b', 'c', 'd'].map((h) => proc(dir, ['grant', '--helper', h, '--parts', '4', '--now', '1'])));
    const gs = rs.map((r) => JSON.parse(r.stdout));
    assert.deepEqual(gs.map((g) => g.remaining.steps), [2, 2, 2, 2]);
  }));
});

describe('shared-budget stale-lock breaking, final form', () => {
  it('the lock wait is longer than the stale age', () => {
    assert.ok(sb.LOCK_WAIT_MS > sb.LOCK_STALE_MS);
  });

  for (let round = 0; round < 10; round++) {
    it(`pre-aged lock then 20 parallel writer processes keep every write (round ${round + 1}/10)`, () => withDir(async (dir) => {
      await call(dir, ['open', '--now', '0']);
      const lock = path.join(dir, 'b.json.lock');
      await fs.writeFile(lock, 'crashed-holder');
      const old = new Date(Date.now() - 2 * 60 * 1000);
      await fs.utimes(lock, old, old);
      const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => proc(dir, ['spend', '--helper', `h${i}`, '--steps', '1', '--outcome', 'ok', '--now', '1'])));
      for (const r of rs) assert.equal(r.code, 0, r.stderr);
      assert.equal((await readState(dir)).spent.steps, 20);
      assert.deepEqual((await fs.readdir(dir)).filter((f) => f !== 'b.json'), []);
    }));
  }

  it('a leftover break lock older than twice the stale age is removed', () => withDir(async (dir) => {
    await call(dir, ['open', '--now', '0']);
    const old = new Date(Date.now() - 5 * 60 * 1000);
    for (const f of ['b.json.lock', 'b.json.lock.break']) {
      await fs.writeFile(path.join(dir, f), 'dead');
      await fs.utimes(path.join(dir, f), old, old);
    }
    await call(dir, ['spend', '--helper', 'a', '--steps', '1', '--outcome', 'ok', '--now', '1']);
    assert.equal((await readState(dir)).spent.steps, 1);
    assert.deepEqual((await fs.readdir(dir)).filter((f) => f !== 'b.json'), []);
  }));

  it('a fresh lock is never broken by a waiter that judged an older one stale', () => withDir(async (dir) => {
    await call(dir, ['open', '--now', '0']);
    const lock = path.join(dir, 'b.json.lock');
    await fs.writeFile(lock, 'live-holder'); // fresh mtime: not stale
    const p = call(dir, ['spend', '--helper', 'a', '--steps', '1', '--outcome', 'ok', '--now', '1']);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await fs.readFile(lock, 'utf8'), 'live-holder');
    assert.equal((await readState(dir)).spent.steps, 0);
    await fs.rm(lock);
    await p;
    assert.equal((await readState(dir)).spent.steps, 1);
  }));
});
