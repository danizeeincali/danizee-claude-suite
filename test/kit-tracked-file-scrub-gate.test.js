import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { run, parsePatterns, decodeText, scanBuffer, parseBatch, scrubIfConfigured, LIMITS } from '../src/lib/kit/scrub.js';
import { run as pushGate } from '../src/lib/kit/push-gate.js';

const sh = (cwd, ...a) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const utf16le = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const utf16be = (s) => { const b = Buffer.from(s, 'utf16le'); b.swap16(); return Buffer.concat([Buffer.from([0xfe, 0xff]), b]); };

describe('scrub — tracked-file scrub gate', () => {
  let dir;
  const io = (extra = {}) => ({ cwd: dir, stdin: async () => '', env: process.env, ...extra });
  const put = async (rel, content) => { await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await fs.writeFile(path.join(dir, rel), content); };
  const commit = (msg = 'c') => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg); };
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub-'));
    sh(dir, 'init', '-q', '.');
    // the private pattern file is git-ignored, as the kit install leaves it (info/exclude keeps the tree free of extra tracked files)
    await fs.appendFile(path.join(dir, '.git', 'info', 'exclude'), '.claude/kit/scrub-patterns.local\n');
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('a repository without pattern files is exit 0 with configured:false, stated plainly', async () => {
    await put('a.txt', 'hello\n'); commit();
    const r = await run([], io());
    assert.equal(r.configured, false);
    assert.equal(r.exit, 0);
    assert.match(r.reason, /nothing was scanned/);
  });

  it('a clean repository is exit 0, complete, and counts what it read', async () => {
    await put('.claude/kit/scrub-patterns', '# none of these appear\nforbidden-word\n');
    await put('a.txt', 'hello\n'); await put('b/c.txt', 'world\n'); commit();
    const r = await run([], io());
    assert.equal(r.exit, 0);
    assert.equal(r.clean, true);
    assert.equal(r.complete, true);
    assert.equal(r.scanned_files, 2); // the pattern file is not scanned
    assert.deepEqual(r.not_scanned, []);
  });

  it('reports file, line and pattern for a public hit and exits 2', async () => {
    await put('.claude/kit/scrub-patterns', 'internal-host: corp\\.example\\.com\n');
    await put('src/a.txt', 'one\ntwo corp.example.com\nthree\n'); commit();
    const r = await run([], io());
    assert.equal(r.exit, 2);
    assert.deepEqual(r.hits, [{ file: 'src/a.txt', line: 2, private: false, pattern: 'internal-host: corp\\.example\\.com' }]);
    assert.ok(!JSON.stringify(r).includes('two corp'), 'the matched line is never printed');
  });

  it('a private hit prints neither the pattern nor the matched text, only its number or label', async () => {
    await put('.claude/kit/scrub-patterns.local', 'zebra-secret-name\nboss: hunter2-[a-z]+\n');
    await put('a.txt', 'x\nthe zebra-secret-name is here\nhunter2-abc\n'); commit();
    const r = await run(['--json'], io());
    assert.equal(r.exit, 2);
    assert.deepEqual(r.hits, [
      { file: 'a.txt', line: 2, private: true, pattern: 'private pattern #1' },
      { file: 'a.txt', line: 3, private: true, pattern: 'boss' }
    ]);
    const all = JSON.stringify(r);
    for (const leak of ['zebra', 'hunter2', 'secret-name']) assert.ok(!all.includes(leak), `leaked ${leak}`);
  });

  it('decodes UTF-16LE and UTF-16BE with a BOM', async () => {
    await put('.claude/kit/scrub-patterns.local', 'zebra-secret\n');
    await put('le.txt', utf16le('first\r\nsecond zebra-secret\r\n'));
    await put('be.txt', utf16be('a\nb\nzebra-secret'));
    await put('plain.txt', 'nothing\n');
    commit();
    const r = await run([], io());
    assert.deepEqual(r.hits.map(h => `${h.file}:${h.line}`).sort(), ['be.txt:3', 'le.txt:2']);
  });

  it('finds an ASCII secret inside a binary file', async () => {
    await put('.claude/kit/scrub-patterns.local', 'AKIA[0-9A-Z]{8}\n');
    await put('blob.bin', Buffer.concat([Buffer.from([0, 1, 2, 0xff, 0xfe, 0xfd, 0x80]), Buffer.from('xxAKIA12345678yy'), Buffer.from([0, 0xc3, 0x28, 10])]));
    commit();
    const r = await run([], io());
    assert.equal(r.exit, 2);
    assert.equal(r.hits[0].file, 'blob.bin');
  });

  it('the pattern files and the scrub module are not scanned', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('.claude/kit/scrub-patterns.local', 'needle\n');
    await put('src/lib/kit/scrub.js', '// needle\n');
    await put('.claude/helpers/kit/scrub.js', '// needle\n');
    commit();
    const r = await run([], io());
    assert.equal(r.exit, 0);
    assert.equal(r.scanned_files, 0);
  });

  it('an invalid regex is exit 1 naming the file and line, not the pattern', async () => {
    await put('.claude/kit/scrub-patterns.local', 'ok\n\n# c\nbad-[unclosed\n');
    await put('a.txt', 'x\n'); commit();
    await assert.rejects(run([], io()), e => e instanceof KitExit && e.code === 1
      && e.message.includes('.claude/kit/scrub-patterns.local line 4') && !e.message.includes('unclosed'));
  });

  it('a pattern that matches the empty string is refused', () => {
    assert.throws(() => parsePatterns('a*\n', 'f'), e => e.code === 1 && /empty string/.test(e.message));
    assert.throws(() => parsePatterns('^\n', 'f'), e => e.code === 1);
  });

  it('labels, comments, blank lines and (?i) parse as documented', () => {
    const p = parsePatterns('# c\n\nname: foo+\n(?i)Bar\nhttp://x\n', 'f');
    assert.deepEqual(p.map(x => [x.n, x.label, x.source]), [[1, 'name', 'foo+'], [2, null, 'Bar'], [3, null, 'http://x']]);
    assert.ok(p[1].regex.test('BAR'));
  });

  it('scans HEAD by default and the tracked files on disk with --worktree', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('a.txt', 'clean\n'); commit();
    await put('a.txt', 'a needle appears\n');          // uncommitted edit
    await put('untracked.txt', 'needle\n');             // never tracked
    const head = await run([], io());
    assert.equal(head.exit, 0);
    assert.equal(head.mode, 'head');
    const wt = await run(['--worktree'], io());
    assert.equal(wt.exit, 2);
    assert.deepEqual(wt.hits.map(h => h.file), ['a.txt']);
    assert.equal(wt.mode, 'worktree');
  });

  it('--worktree: a tracked file that is missing on disk makes the scan incomplete (exit 2)', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('a.txt', 'clean\n'); await put('b.txt', 'clean\n'); commit();
    await fs.rm(path.join(dir, 'b.txt'));
    const r = await run(['--worktree'], io());
    assert.equal(r.exit, 2);
    assert.equal(r.complete, false);
    assert.deepEqual(r.not_scanned, [{ file: 'b.txt', reason: 'tracked but missing on disk' }]);
    assert.match(r.reason, /not scanned/);
  });

  it('a file over the size cap is listed as not scanned and the scan is not complete', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('big.txt', 'x'.repeat(5000)); await put('small.txt', 'needle\n'); commit();
    for (const flags of [[], ['--worktree']]) {
      const r = await run([...flags, '--max-file-bytes', '1000'], io());
      assert.equal(r.exit, 2);
      assert.equal(r.complete, false);
      assert.deepEqual(r.not_scanned.map(n => n.file), ['big.txt']);
      assert.deepEqual(r.hits.map(h => h.file), ['small.txt']);
    }
  });

  it('odd file names: spaces, quotes, non-ASCII, leading dash, newline', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    const names = ['sp ace.txt', 'q"uote\'s.txt', 'ünï-中文.txt', '-dash.txt', 'new\nline.txt'];
    for (const n of names) await put(n, 'a needle\n');
    commit();
    for (const flags of [[], ['--worktree']]) {
      const r = await run([...flags, '--json'], io());
      assert.equal(r.exit, 2);
      assert.deepEqual(r.hits.map(h => h.file).sort(), [...names].sort());
    }
  });

  it('a submodule entry is listed, not scanned, and does not fail the scan', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('a.txt', 'clean\n'); commit();
    const sha = sh(dir, 'rev-parse', 'HEAD').trim();
    sh(dir, 'update-index', '--add', '--cacheinfo', `160000,${sha},vendor/lib`);
    sh(dir, 'commit', '-q', '-m', 'gitlink');
    const r = await run([], io());
    assert.equal(r.exit, 0);
    assert.deepEqual(r.submodules, ['vendor/lib']);
  });

  it('a repository whose own config names a filter does not run it', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('.gitattributes', '* filter=evil\n');
    await put('a.txt', 'clean\n'); commit();
    const marker = path.join(dir, 'ran-marker');
    sh(dir, 'config', 'filter.evil.smudge', `touch ${marker}`);
    sh(dir, 'config', 'filter.evil.clean', `touch ${marker}`);
    await run(['--worktree'], io());
    await run([], io());
    await assert.rejects(fs.access(marker));
  });

  it('git failing is exit 1, never a pass (no commits, HEAD tree cannot be listed)', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await assert.rejects(run([], io()), e => e instanceof KitExit && e.code === 1 && /ls-tree failed/.test(e.message));
  });

  it('refuses unknown flags and bad values, and --help prints usage', async () => {
    await assert.rejects(run(['--wat'], io()), e => e.code === 1 && /--help/.test(e.message));
    await assert.rejects(run(['stray'], io()), e => e.code === 1);
    await assert.rejects(run(['--max-file-bytes', '0'], io()), e => e.code === 1);
    await assert.rejects(run(['--dir'], io()), e => e.code === 1);
    assert.match((await run(['--help'], io())).usage, /scrub/);
  });

  it('--dir points at another repository', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('a.txt', 'needle\n'); commit();
    const r = await run(['--dir', dir], io({ cwd: os.tmpdir() }));
    assert.equal(r.exit, 2);
  });

  it('more tracked files than the walk cap is a refusal, not a pass', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('a.txt', 'x\n'); await put('b.txt', 'x\n'); commit();
    await assert.rejects(scrubIfConfigured(dir, { limits: { ...LIMITS, files: 1 } }), e => e instanceof KitExit && e.code === 2);
  });

  it('the hit list is capped and says so', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('a.txt', 'needle\n'.repeat(10)); commit();
    const r = await scrubIfConfigured(dir, { limits: { ...LIMITS, hits: 3 } });
    assert.equal(r.hit_count, 3);
    assert.equal(r.truncated, true);
    assert.equal(r.exit, 2);
  });

  it('pure helpers: decodeText, scanBuffer, parseBatch', () => {
    assert.equal(decodeText(utf16le('héllo')), 'héllo');
    assert.equal(decodeText(utf16be('héllo')), 'héllo');
    assert.equal(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x')])), 'x');
    const p = parsePatterns('b+\n', 'f').map(x => ({ ...x, kind: 'public' }));
    assert.deepEqual(scanBuffer(Buffer.from('a\r\nabb\nccc\nb'), p).map(h => h.line), [2, 4]);
    const sha = 'a'.repeat(40);
    const buf = Buffer.concat([Buffer.from(`${sha} blob 3\n`), Buffer.from('abc\n')]);
    assert.equal(parseBatch(buf, [{ sha, size: 3 }])[0].toString(), 'abc');
    assert.throws(() => parseBatch(buf, [{ sha: 'b'.repeat(40), size: 3 }]), e => e.code === 1);
    assert.throws(() => parseBatch(Buffer.from(`${sha} missing\n`), [{ sha, size: 3 }]), e => e.code === 1);
    assert.throws(() => parseBatch(buf.subarray(0, 50 - 40), [{ sha, size: 3 }]), e => e.code === 1);
  });

  describe('push-gate check wiring', () => {
    let store;
    beforeEach(async () => { store = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub-store-')); });
    afterEach(async () => { await fs.rm(store, { recursive: true, force: true }); });
    const gate = (args = ['check']) => pushGate(args, io({ env: { ...process.env, KIT_RECEIPTS_DIR: store } }));

    it('without pattern files push-gate behaves as before', async () => {
      await put('a.txt', 'needle\n'); commit();
      const r = await gate();
      assert.equal(r.decision, 'ask');
      assert.equal(r.scrub, undefined);
    });

    it('a hit denies the push even when a passing receipt exists, without leaking the private pattern', async () => {
      await put('a.txt', 'clean\n'); commit();
      await gate(['receipt', '--verdict', 'pass']);
      assert.equal((await gate()).decision, 'abstain');
      await put('.claude/kit/scrub-patterns.local', 'zebra-secret\n');
      await put('a.txt', 'zebra-secret\n'); commit();
      await gate(['receipt', '--verdict', 'pass']);
      const r = await gate();
      assert.equal(r.decision, 'deny');
      assert.equal(r.exit, 2);
      assert.deepEqual(r.scrub.hits, [{ file: 'a.txt', line: 1, private: true, pattern: 'private pattern #1' }]);
      assert.ok(!JSON.stringify(r).includes('zebra'));
    });

    it('a configured scrub that cannot run is a deny (fail closed)', async () => {
      await put('a.txt', 'clean\n');
      await put('.claude/kit/scrub-patterns.local', 'bad-[unclosed\n'); commit();
      const r = await gate();
      assert.equal(r.decision, 'deny');
      assert.equal(r.exit, 2);
      assert.match(r.reason, /could not run/);
      assert.match(r.reason, /scrub-patterns\.local line 1/);
    });

    it('a clean configured scrub leaves the receipt decision alone', async () => {
      await put('.claude/kit/scrub-patterns', 'needle\n'); await put('a.txt', 'clean\n'); commit();
      await gate(['receipt', '--verdict', 'pass']);
      assert.equal((await gate()).decision, 'abstain');
    });
  });
});

describe('scrub — review round 1 regressions', () => {
  let dir;
  const io = () => ({ cwd: dir, stdin: async () => '', env: process.env });
  const put = async (rel, content) => { await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await fs.writeFile(path.join(dir, rel), content); };
  const commit = () => { sh(dir, 'add', '-A'); sh(dir, 'add', '-f', '-A'); sh(dir, 'commit', '-q', '-m', 'c'); };
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub-r1-')); sh(dir, 'init', '-q', '.'); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('a tracked private pattern file is refused (exit 2), never reported clean; an untracked one is only skipped', async () => {
    await put('.claude/kit/scrub-patterns.local', 'zebra-secret\n');
    await put('a.txt', 'clean\n');
    sh(dir, 'add', 'a.txt'); sh(dir, 'commit', '-q', '-m', 'c');
    assert.equal((await run([], io())).exit, 0); // untracked: skipped
    sh(dir, 'add', '-f', '.claude/kit/scrub-patterns.local'); sh(dir, 'commit', '-q', '-m', 'oops');
    for (const args of [[], ['--worktree']]) {
      await assert.rejects(run(args, io()), (e) => e instanceof KitExit && e.code === 2 && /private pattern file.*tracked.*published/.test(e.message) && !/zebra/.test(e.message));
    }
  });

  it('a UTF-16LE pattern file with a BOM matches committed text; a NUL left after decoding is exit 1', async () => {
    await put('.claude/kit/scrub-patterns.local', utf16le('zebra-secret\r\n'));
    await put('a.txt', 'zebra-secret\n'); commit();
    sh(dir, 'rm', '-q', '--cached', '.claude/kit/scrub-patterns.local'); sh(dir, 'commit', '-q', '-m', 'untrack');
    const r = await run([], io());
    assert.equal(r.exit, 2);
    assert.deepEqual(r.hits, [{ file: 'a.txt', line: 1, private: true, pattern: 'private pattern #1' }]);
    await put('.claude/kit/scrub-patterns.local', Buffer.from('zebra\0secret\n'));
    await assert.rejects(run([], io()), (e) => e instanceof KitExit && e.code === 1 && /NUL/.test(e.message));
  });

  it('--worktree allocates per file size, not the cap, for every file', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    for (let i = 0; i < 200; i++) await put(`f/${i}.txt`, `tiny ${i}\n`);
    commit();
    const alloc = Buffer.alloc;
    let biggest = 0;
    let total = 0;
    Buffer.alloc = function (n, ...rest) { biggest = Math.max(biggest, n); total += n; return alloc.call(Buffer, n, ...rest); };
    let r;
    try { r = await run(['--worktree'], io()); } finally { Buffer.alloc = alloc; }
    assert.equal(r.exit, 0);
    assert.equal(r.scanned_files, 200);
    assert.ok(biggest < LIMITS.file, `largest allocation was ${biggest} bytes`);
    assert.ok(total < 16 * 1024 * 1024, `200 tiny files allocated ${total} bytes in all`);
  });

  it('--worktree still catches a hit in a file larger than a small cap-sized guess and honours the cap', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('big.txt', 'x'.repeat(5000) + '\nneedle\n'); commit();
    const r = await run(['--worktree'], io());
    assert.deepEqual(r.hits.map(h => [h.file, h.line]), [['big.txt', 2]]);
    const small = await run(['--worktree', '--max-file-bytes', '100'], io());
    assert.equal(small.complete, false);
  });

  it('--max-file-bytes above 2 GiB is refused with exit 1 pointing at --help', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n'); await put('a.txt', 'x\n'); commit();
    for (const v of ['2147483649', '100000000000']) {
      await assert.rejects(run(['--worktree', '--max-file-bytes', v], io()), (e) => e instanceof KitExit && e.code === 1 && /at most 2147483648.*--help/.test(e.message));
    }
    assert.equal((await run(['--max-file-bytes', '2147483648'], io())).exit, 0);
  });

  it('--worktree reads a tracked file whose name is not valid UTF-8 and reports an escaped name', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    const name = Buffer.concat([Buffer.from(dir + '/bad'), Buffer.from([0xe9]), Buffer.from('.txt')]);
    await fs.writeFile(name, 'a\nneedle\n');
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'c');
    for (const args of [[], ['--worktree']]) {
      const r = await run(args, io());
      assert.equal(r.exit, 2, JSON.stringify(r));
      assert.deepEqual(r.not_scanned, []);
      assert.deepEqual(r.hits, [{ file: 'bad\\xe9.txt', line: 2, private: false, pattern: 'needle' }]);
    }
  });
});

describe('scrub — review round 2 regressions', () => {
  let dir; let store; let extra = [];
  const io = (o = {}) => ({ cwd: dir, stdin: async () => '', env: { ...process.env, KIT_RECEIPTS_DIR: store }, ...o });
  const put = async (rel, content) => { await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await fs.writeFile(path.join(dir, rel), content); };
  const commit = (msg = 'c') => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg); };
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub2-'));
    store = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub2-store-'));
    extra = [];
    sh(dir, 'init', '-q', '.');
    await fs.appendFile(path.join(dir, '.git', 'info', 'exclude'), '.claude/kit/scrub-patterns.local\n');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(store, { recursive: true, force: true });
    for (const d of extra) await fs.rm(d, { recursive: true, force: true });
  });

  it('push-gate check in a git clone --shared repo without a pattern file decides exactly as the original repo does', async () => {
    await put('a.txt', 'hello\n'); commit();
    const clone = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub2-clone-'));
    extra.push(clone);
    sh(clone, 'clone', '-q', '--shared', dir, 'c');
    const copy = path.join(clone, 'c');
    const a = await pushGate(['check'], io());
    const b = await pushGate(['check'], io({ cwd: copy }));
    assert.equal(a.decision, 'ask');
    assert.equal(b.decision, a.decision, JSON.stringify(b));
    assert.equal(b.scrub, undefined);
    assert.equal(await scrubIfConfigured(copy), null);
  });

  it('scrubIfConfigured returns null for a bare repository (no work tree)', async () => {
    const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub2-bare-'));
    extra.push(bare);
    sh(bare, 'init', '-q', '--bare', '.');
    assert.equal(await scrubIfConfigured(bare), null);
  });

  it('push-gate check denies a secret that was committed and then removed in the pushed range', async () => {
    await put('.claude/kit/scrub-patterns.local', 'zebra-secret\n');
    await put('a.txt', 'hello\n'); commit('base');
    await put('leak/k.txt', 'one\nthe zebra-secret is here\n'); commit('leak');
    sh(dir, 'rm', '-q', '-r', 'leak'); sh(dir, 'commit', '-q', '-m', 'remove');
    const head = await run([], io());
    assert.equal(head.exit, 0, 'the HEAD tree alone is clean');
    const d = await pushGate(['check'], io());
    assert.equal(d.decision, 'deny', JSON.stringify(d));
    assert.equal(d.exit, 2);
    assert.deepEqual(d.scrub.hits.map(h => [h.file, h.line, h.private]), [['leak/k.txt', 2, true]]);
    assert.ok(!JSON.stringify(d).includes('zebra'), 'neither the pattern nor the match is printed');
    // with --base the range starts after the leak: the leak is already published, so it passes
    const base = sh(dir, 'rev-parse', 'HEAD').trim();
    await put('b.txt', 'fine\n'); commit('later');
    const ok = await pushGate(['check', '--base', base], io());
    assert.notEqual(ok.decision, 'deny', JSON.stringify(ok));
    const bad = await pushGate(['check', '--base', sh(dir, 'rev-parse', 'HEAD~3').trim()], io());
    assert.equal(bad.decision, 'deny');
  });

  it('scrub --history <base> scans the range; - scans all of history; the plain verb still scans HEAD only', async () => {
    await put('.claude/kit/scrub-patterns.local', 'zebra-secret\n');
    await put('a.txt', 'hello\n'); commit('base');
    const base = sh(dir, 'rev-parse', 'HEAD').trim();
    await put('k.txt', 'zebra-secret\n'); commit('leak');
    sh(dir, 'rm', '-q', 'k.txt'); sh(dir, 'commit', '-q', '-m', 'remove');
    const h = await run(['--history', base], io());
    assert.equal(h.mode, 'history');
    assert.equal(h.exit, 2);
    assert.deepEqual(h.hits, [{ file: 'k.txt', line: 1, private: true, pattern: 'private pattern #1' }]);
    assert.equal((await run(['--history', '-'], io())).exit, 2);
    assert.equal((await run(['--history', 'HEAD'], io())).exit, 0);
    assert.equal((await run([], io())).exit, 0);
    await assert.rejects(run(['--history', 'nope-ref'], io()), (e) => e instanceof KitExit && e.code === 1);
    await assert.rejects(run(['--history', base, '--worktree'], io()), (e) => e instanceof KitExit && e.code === 1);
  });

  it('a history scan that cannot read an object is an error (fail closed)', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('a.txt', 'x\n'); commit();
    const sha = sh(dir, 'rev-parse', 'HEAD:a.txt').trim();
    const objFile = path.join(dir, '.git', 'objects', sha.slice(0, 2), sha.slice(2));
    await fs.chmod(path.dirname(objFile), 0o700).catch(() => {});
    await fs.rm(objFile);
    await assert.rejects(run(['--history', '-'], io()), (e) => e instanceof KitExit && e.code === 1);
    const d = await pushGate(['check'], io());
    assert.equal(d.decision, 'deny');
  });

  it('a private pattern file committed in the pushed history is refused even after it was removed', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('a.txt', 'x\n'); commit('base');
    await put('.claude/kit/scrub-patterns.local', 'zebra-secret\n');
    sh(dir, 'add', '-f', '.claude/kit/scrub-patterns.local'); sh(dir, 'commit', '-q', '-m', 'oops');
    sh(dir, 'rm', '-q', '--cached', '.claude/kit/scrub-patterns.local'); sh(dir, 'commit', '-q', '-m', 'untrack');
    assert.equal((await run([], io())).exit, 0, 'HEAD no longer tracks it');
    await assert.rejects(run(['--history', '-'], io()), (e) => e instanceof KitExit && e.code === 2 && /private pattern file/.test(e.message));
    assert.equal((await pushGate(['check'], io())).decision, 'deny');
  });

  it('a blob larger than what safe-git can return is listed under not_scanned (exit 2), not an aborted run', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('big.bin', Buffer.alloc(257 * 1024 * 1024)); await put('a.txt', 'needle\n'); commit();
    for (const args of [['--max-file-bytes', '400000000'], ['--history', '-', '--max-file-bytes', '400000000']]) {
      const r = await run(args, io());
      assert.equal(r.exit, 2, JSON.stringify(r));
      assert.equal(r.complete, false);
      assert.deepEqual(r.not_scanned.map(n => n.file), ['big.bin']);
      assert.deepEqual(r.hits.map(h => h.file), ['a.txt']);
    }
  });
});

describe('scrub — review round 3 regressions', () => {
  let dir; let store; let extra = [];
  const io = (o = {}) => ({ cwd: dir, stdin: async () => '', env: { ...process.env, KIT_RECEIPTS_DIR: store }, ...o });
  const put = async (rel, content) => { await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await fs.writeFile(path.join(dir, rel), content); };
  const commit = (msg = 'c') => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg); };
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub3-'));
    store = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub3-store-'));
    extra = [];
    sh(dir, 'init', '-q', '-b', 'main', '.');
    await fs.appendFile(path.join(dir, '.git', 'info', 'exclude'), '.claude/kit/scrub-patterns.local\n');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(store, { recursive: true, force: true });
    for (const d of extra) await fs.rm(d, { recursive: true, force: true });
  });
  const withRemote = async () => {
    const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub3-bare-'));
    extra.push(bare);
    sh(bare, 'init', '-q', '--bare', '.');
    sh(dir, 'remote', 'add', 'origin', bare);
    return bare;
  };

  it('with no base, push-gate check scans only the commits no remote has; a secret in new commits still denies', async () => {
    await withRemote();
    await put('.claude/kit/scrub-patterns.local', 'zebra-secret\n');
    await put('a.txt', 'hello\n'); commit('base');
    await put('leak/k.txt', 'the zebra-secret\n'); commit('leak');
    sh(dir, 'rm', '-q', '-r', 'leak'); sh(dir, 'commit', '-q', '-m', 'remove');
    sh(dir, 'push', '-q', 'origin', 'main');
    sh(dir, 'checkout', '-q', '-b', 'feature');
    await put('b.txt', 'clean\n'); commit('clean');
    assert.equal(sh(dir, 'rev-list', 'HEAD', '--not', '--remotes').trim().split('\n').length, 1);
    const ok = await pushGate(['check'], io());
    assert.notEqual(ok.decision, 'deny', JSON.stringify(ok));
    await put('c.txt', 'now zebra-secret again\n'); commit('bad');
    sh(dir, 'rm', '-q', 'c.txt'); sh(dir, 'commit', '-q', '-m', 'oops');
    const d = await pushGate(['check'], io());
    assert.equal(d.decision, 'deny', JSON.stringify(d));
    assert.deepEqual(d.scrub.hits.map(h => h.file), ['c.txt']);
    // without any remote-tracking ref the whole of HEAD's history is scanned
    sh(dir, 'update-ref', '-d', 'refs/remotes/origin/main');
    const all = await run(['--history', '-'], io());
    assert.deepEqual(all.hits.map(h => h.file).sort(), ['c.txt', 'leak/k.txt']);
  });

  it('a git timeout is exit 1 (git failed) with a reason naming a --timeout that scrub and push-gate check accept', async () => {
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('a.txt', 'x\n'); commit();
    const slow = (args, o) => { const e = new KitExit(`git ${args.find(a => a === 'ls-tree')} took longer than ${o.timeout} ms and was stopped (raise it with --timeout <ms>)`, 3); throw e; };
    await assert.rejects(() => run(['--timeout', '5000'], io({ git: (a, o) => (a.includes('ls-tree') ? slow(a, o) : spawnGit(a, o)) })),
      e => e instanceof KitExit && e.code === 1 && /took longer than 5000 ms/.test(e.message) && /--timeout <ms>/.test(e.message));
    const ok = await run(['--timeout', '90000'], io());
    assert.equal(ok.exit, 0);
    await assert.rejects(() => run(['--timeout', 'x'], io()), e => e.code === 1);
    const d = await pushGate(['check', '--timeout', '90000'], io());
    assert.notEqual(d.decision, 'deny', JSON.stringify(d));
    await assert.rejects(() => run(['--timeout', '5000'], io({ git: (a, o) => { throw Object.assign(new KitExit('git cat-file wrote more than 256 MiB of output; narrow the command', 3), { overflow: true }); } })),
      e => e.code === 1 && /--history <base>/.test(e.message));
  });

  it('the deny reason names the scan that refused and the command that reproduces it', async () => {
    await put('.claude/kit/scrub-patterns.local', 'zebra-secret\n');
    await put('a.txt', 'hello\n'); commit('base');
    const base = sh(dir, 'rev-parse', 'HEAD').trim();
    await put('k.txt', 'zebra-secret\n'); commit('leak');
    sh(dir, 'rm', '-q', 'k.txt'); sh(dir, 'commit', '-q', '-m', 'remove');
    const d = await pushGate(['check', '--base', base], io());
    assert.equal(d.decision, 'deny');
    assert.match(d.reason, new RegExp(`history scan refused; run cli\\.js scrub --history ${base}`));
    const again = await run(['--history', base], io());
    assert.equal(again.exit, 2, 'the named command reproduces the hit');
    const d2 = await pushGate(['check'], io());
    assert.match(d2.reason, /run cli\.js scrub --history - /);
    await put('h.txt', 'zebra-secret\n'); commit('head hit');
    const d3 = await pushGate(['check'], io());
    assert.match(d3.reason, /HEAD scan refused; run cli\.js scrub for the list/);
  });

  it('ls-tree sizes of - (blob) and BAD are listed as not available locally, not as unexpected output', async () => {
    const { parseLsTree } = await import('../src/lib/kit/scrub.js');
    const r = parseLsTree(['100644 blob ' + 'a'.repeat(40) + '       BAD\tgone.txt', '100644 blob ' + 'b'.repeat(40) + '       -\tgone2.txt',
      '160000 commit ' + 'c'.repeat(40) + '       -\tsub', '100644 blob ' + 'd'.repeat(40) + '       3\tok.txt', ''].join('\0'));
    assert.deepEqual(r.missing, ['gone.txt', 'gone2.txt']);
    assert.deepEqual(r.submodules, ['sub']);
    assert.deepEqual(r.files.map(f => f.path), ['ok.txt']);
    await put('.claude/kit/scrub-patterns', 'needle\n');
    await put('a.txt', 'needle\n'); commit();
    const fake = (args, o) => {
      if (args.includes('ls-tree')) return { code: 0, stdout: '100644 blob ' + 'a'.repeat(40) + '       BAD\tmissing.txt\0', stderr: '' };
      return spawnGit(args, o);
    };
    const res = await run([], io({ git: fake }));
    assert.equal(res.exit, 2);
    assert.equal(res.complete, false);
    assert.deepEqual(res.not_scanned, [{ file: 'missing.txt', reason: 'object not available locally (partial clone?)' }]);
  });

  function spawnGit(args, o = {}) {
    const r = spawnSync('git', args, { cwd: o.cwd, env: o.env, input: o.input, encoding: o.encoding || 'utf-8', maxBuffer: 256 * 1024 * 1024 });
    return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
  }
});
