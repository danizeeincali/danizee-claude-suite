import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { verb, usage, run, parseArgs, resolveGuarded, guardedWrite, guardedRead, guardedDelete } from '../src/lib/kit/guarded-fs.js';

const refused = (e) => e instanceof KitExit && e.code === 2;
const invalid = (e) => e instanceof KitExit && e.code === 1;

describe('guarded-fs', () => {
  let base, home, prot;
  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gfs-')));
    home = path.join(base, 'home');
    prot = path.join(home, '.claude', 'receipts');
    await fs.mkdir(prot, { recursive: true });
  });
  afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });
  const opts = (extra = {}) => ({ root: home, protect: prot, ...extra });
  const leftovers = async (d) => (await fs.readdir(d)).filter((n) => n.endsWith('.tmp'));

  it('exports the verb and usage', () => {
    assert.equal(verb, 'guarded-write');
    assert.match(usage, /--root/);
  });

  it('writes a file, creating missing folders, and leaves no temp file', async () => {
    const f = path.join(prot, 'a', 'b', 'x.json');
    const r = await guardedWrite(f, '{"a":1}', opts());
    assert.equal(r.bytes, 7);
    assert.equal(await fs.readFile(f, 'utf-8'), '{"a":1}');
    assert.deepEqual(await leftovers(path.dirname(f)), []);
    assert.equal(await guardedRead(f, opts()), '{"a":1}');
    await guardedWrite(f, 'second', opts());
    assert.equal(await fs.readFile(f, 'utf-8'), 'second');
  });

  it('refuses a symlink inside the protected tree and writes nothing through it', async () => {
    const outside = path.join(base, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(prot, 'sub'));
    await assert.rejects(guardedWrite(path.join(prot, 'sub', 'x'), 'no', opts()), refused);
    await assert.rejects(guardedRead(path.join(prot, 'sub', 'x'), opts()), refused);
    assert.deepEqual(await fs.readdir(outside), []);
  });

  it('refuses the protected folder itself when it is a link (default protect = root counts every link)', async () => {
    const real = path.join(base, 'real');
    await fs.mkdir(real);
    await fs.rm(prot, { recursive: true });
    await fs.symlink(real, prot);
    await assert.rejects(guardedWrite(path.join(prot, 'x'), 'no', opts()), refused);
    await fs.symlink(real, path.join(home, 'lnk'));
    await assert.rejects(guardedWrite(path.join(home, 'lnk', 'x'), 'no', { root: home }), refused);
    assert.deepEqual(await fs.readdir(real), []);
  });

  it('follows a dotfile-style link outside the protected tree while it stays under root', async () => {
    const dots = path.join(home, 'dotfiles', 'claude');
    await fs.mkdir(path.join(dots, 'receipts'), { recursive: true });
    await fs.rm(path.join(home, '.claude'), { recursive: true });
    await fs.symlink(dots, path.join(home, '.claude'));
    const f = path.join(prot, 'x.json');
    const res = await resolveGuarded(f, opts());
    assert.equal(res.parent, path.join(dots, 'receipts'));
    assert.ok(res.chain.some((c) => c.via === path.join(home, '.claude')));
    await guardedWrite(f, 'ok', opts());
    assert.equal(await fs.readFile(path.join(dots, 'receipts', 'x.json'), 'utf-8'), 'ok');
    assert.equal(await guardedRead(f, opts()), 'ok');
  });

  it('refuses a followed link whose target is outside root or lands inside the protected tree', async () => {
    await fs.rm(path.join(home, '.claude'), { recursive: true });
    const out = path.join(base, 'elsewhere');
    await fs.mkdir(path.join(out, 'receipts'), { recursive: true });
    await fs.symlink(out, path.join(home, '.claude'));
    await assert.rejects(guardedWrite(path.join(prot, 'x'), 'no', opts()), refused);
    assert.deepEqual(await fs.readdir(path.join(out, 'receipts')), []);
    await fs.rm(path.join(home, '.claude'));
    await fs.mkdir(prot, { recursive: true });
    await fs.symlink(prot, path.join(home, 'alias'));
    await assert.rejects(guardedWrite(path.join(home, 'alias', 'x'), 'no', opts()), refused);
  });

  it('refuses .. and targets outside the root, and a relative root', async () => {
    await assert.rejects(guardedWrite(path.join(home, 'a', '..', '..', 'x'), 'no', opts()), refused);
    await assert.rejects(guardedWrite(path.join(base, 'x'), 'no', opts()), refused);
    await assert.rejects(guardedWrite(home, 'no', opts()), refused);
    await assert.rejects(guardedWrite(path.join(home, 'x'), 'no', { root: 'home' }), invalid);
    await assert.rejects(guardedWrite(path.join(home, 'x'), 'no', { root: home, protect: base }), invalid);
    await assert.rejects(guardedWrite(path.join(home, 'x\0y'), 'no', { root: home }), invalid);
  });

  it('detects a parent swapped for a link between the walk and the write, and writes nothing', async () => {
    const outside = path.join(base, 'outside');
    await fs.mkdir(outside);
    const dir = path.join(prot, 'd');
    await fs.mkdir(dir);
    const hooks = { afterWalk: async () => { await fs.rm(dir, { recursive: true }); await fs.symlink(outside, dir); } };
    await assert.rejects(guardedWrite(path.join(dir, 'x'), 'no', opts({ hooks })), refused);
    assert.deepEqual(await fs.readdir(outside), []);
  });

  it('detects a swap after the folder was opened: nothing lands outside; the file stays only in the checked folder (Linux)', async () => {
    const outside = path.join(base, 'outside');
    await fs.mkdir(outside);
    const dir = path.join(prot, 'd');
    await fs.mkdir(dir);
    const moved = path.join(prot, 'd-moved');
    const hooks = { afterOpen: async () => { await fs.rename(dir, moved); await fs.symlink(outside, dir); } };
    await assert.rejects(guardedWrite(path.join(dir, 'x'), 'no', opts({ hooks })), refused);
    assert.deepEqual(await fs.readdir(outside), []);
    // via /proc/self/fd the write went into the opened folder (now d-moved) and is kept there (review round 2);
    // off Linux the rename goes by path and the pre-rename check refuses before anything is renamed
    assert.deepEqual(await fs.readdir(moved), process.platform === 'linux' ? ['x'] : []);
  });

  it('the temp file never remains after a failure (final name is a non-empty folder; swap before rename)', async () => {
    const f = path.join(prot, 'full');
    await fs.mkdir(path.join(f, 'kid'), { recursive: true });
    await assert.rejects(guardedWrite(f, 'x', opts()), invalid);
    assert.deepEqual(await leftovers(prot), []);
    const hooks = { beforeRename: async () => { throw new Error('boom'); } };
    await assert.rejects(guardedWrite(path.join(prot, 'y'), 'x', opts({ hooks })), invalid);
    assert.deepEqual(await leftovers(prot), []);
    assert.deepEqual((await fs.readdir(prot)).sort(), ['full']);
  });

  it('a final name that is a link is replaced, not written through', async () => {
    const victim = path.join(base, 'victim');
    await fs.writeFile(victim, 'keep');
    await fs.symlink(victim, path.join(prot, 'x'));
    await guardedWrite(path.join(prot, 'x'), 'new', opts());
    assert.equal(await fs.readFile(victim, 'utf-8'), 'keep');
    assert.equal((await fs.lstat(path.join(prot, 'x'))).isSymbolicLink(), false);
    assert.equal(await fs.readFile(path.join(prot, 'x'), 'utf-8'), 'new');
  });

  it('read refuses a final link, a missing file is .missing, and a link swapped in during the read is caught', async () => {
    const f = path.join(prot, 'r');
    await assert.rejects(guardedRead(f, opts()), (e) => invalid(e) && e.missing === true);
    await assert.rejects(guardedRead(path.join(prot, 'nope', 'r'), opts()), (e) => e.missing === true);
    await fs.writeFile(f, 'data');
    await assert.rejects(guardedRead(f, opts({ maxBytes: 2 })), refused);
    const hooks = { afterRead: async () => { await fs.rm(f); await fs.symlink(path.join(base, 'elsewhere'), f); } };
    await assert.rejects(guardedRead(f, opts({ hooks })), refused);
    await assert.rejects(guardedRead(f, opts()), refused); // now a link
  });

  it('delete does not follow a final link, removes only the name, and rechecks the folder before removing', async () => {
    const victim = path.join(base, 'victim');
    await fs.writeFile(victim, 'keep');
    await fs.symlink(victim, path.join(prot, 'l'));
    assert.deepEqual(await guardedDelete(path.join(prot, 'l'), opts()), { deleted: true });
    assert.equal(await fs.readFile(victim, 'utf-8'), 'keep');
    await assert.rejects(fs.lstat(path.join(prot, 'l')));
    assert.deepEqual(await guardedDelete(path.join(prot, 'l'), opts()), { deleted: false });
    assert.deepEqual(await guardedDelete(path.join(prot, 'no', 'such'), opts()), { deleted: false });
    await fs.mkdir(path.join(prot, 'dir'));
    await assert.rejects(guardedDelete(path.join(prot, 'dir'), opts()), invalid);

    const outside = path.join(base, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'f'), 'precious');
    const d = path.join(prot, 'd');
    await fs.mkdir(d);
    await fs.writeFile(path.join(d, 'f'), 'mine');
    const hooks = { beforeUnlink: async () => { await fs.rename(d, path.join(prot, 'd2')); await fs.symlink(outside, d); } };
    await assert.rejects(guardedDelete(path.join(d, 'f'), opts({ hooks })), refused);
    assert.equal(await fs.readFile(path.join(outside, 'f'), 'utf-8'), 'precious');
  });

  it('refuses writes over the size limit', async () => {
    await assert.rejects(guardedWrite(path.join(prot, 'big'), 'abcdef', opts({ maxBytes: 3 })), invalid);
    assert.deepEqual(await fs.readdir(prot), []);
  });

  it('CLI: parses flags, refuses unknown ones and ..', async () => {
    assert.throws(() => parseArgs(['--bogus', 'x']), invalid);
    assert.throws(() => parseArgs(['--root']), invalid);
    await assert.rejects(run(['--root', home], { stdin: async () => '' }), invalid);
    await assert.rejects(run(['--root', home, '--file', '../x'], { stdin: async () => 'x' }), refused);
    const r = await run(['--root', home, '--file', 'sub/n.txt'], { stdin: async () => 'hello' });
    assert.equal(r.written, true);
    assert.equal(await fs.readFile(path.join(home, 'sub', 'n.txt'), 'utf-8'), 'hello');
  });
});

describe('push-gate store behind the owner\'s own dotfile links', () => {
  it('a ~/.claude that links outside the home folder still stores receipts; a link inside the receipts folder is refused', async () => {
    const { run: gate } = await import('../src/lib/kit/push-gate.js');
    const { spawnSync } = await import('child_process');
    const t = await fs.mkdtemp(path.join(os.tmpdir(), 'gfs-dot-'));
    try {
      const home = path.join(t, 'home');
      const dotfiles = path.join(t, 'dotfiles', 'claude');
      await fs.mkdir(home, { recursive: true });
      await fs.mkdir(dotfiles, { recursive: true });
      await fs.symlink(dotfiles, path.join(home, '.claude'));
      const repo = path.join(t, 'repo');
      await fs.mkdir(repo);
      const g = (a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: repo, encoding: 'utf-8' });
      g(['init', '-q', '.']); await fs.writeFile(path.join(repo, 'a'), 'a\n'); g(['add', 'a']); g(['commit', '-q', '-m', 'a']);
      const env = { ...process.env, HOME: home };
      delete env.KIT_RECEIPTS_DIR;
      const io = { cwd: repo, stdin: async () => '', env };
      await gate(['receipt', '--verdict', 'pass', '--high', '0', '--medium', '0', '--low', '0'], io);
      const stored = await fs.readdir(path.join(dotfiles, 'kit', 'receipts'));
      assert.equal(stored.filter((f) => f.endsWith('.json')).length, 1);
      const receipts = path.join(dotfiles, 'kit', 'receipts');
      const f = path.join(receipts, stored.find((x) => x.endsWith('.json')));
      await fs.rename(receipts, receipts + '.real');
      await fs.symlink(receipts + '.real', receipts);
      const before = await fs.readFile(f.replace(receipts, receipts + '.real'), 'utf-8');
      await assert.rejects(gate(['receipt', '--verdict', 'pass', '--high', '0', '--medium', '0', '--low', '0'], io), (e) => e instanceof KitExit && e.code === 2);
      assert.equal(await fs.readFile(f.replace(receipts, receipts + '.real'), 'utf-8'), before); // the refused write changed nothing
      assert.deepEqual((await fs.readdir(receipts + '.real')).sort(), stored.sort());
    } finally { await fs.rm(t, { recursive: true, force: true }); }
  });
});

describe('guarded-write — review round 1 regressions', () => {
  let t;
  beforeEach(async () => { t = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gfs-r1-'))); });
  afterEach(async () => { await fs.rm(t, { recursive: true, force: true }); });
  const io = (bytes, extra = {}) => ({ cwd: t, stdin: async () => bytes.toString('utf-8'), stdinBytes: async () => bytes, stdinIsTTY: false, env: {}, ...extra });

  it('a terminal or an empty stdin never empties the target; --allow-empty means it', async () => {
    const f = path.join(t, 'rc');
    await fs.writeFile(f, 'keep\n');
    await assert.rejects(run(['--root', t, '--file', 'rc'], io(Buffer.alloc(0), { stdinIsTTY: true })), (e) => e instanceof KitExit && e.code === 1 && /terminal/.test(e.message));
    await assert.rejects(run(['--root', t, '--file', 'rc'], io(Buffer.alloc(0))), (e) => e instanceof KitExit && e.code === 1 && /empty/.test(e.message));
    assert.equal(await fs.readFile(f, 'utf-8'), 'keep\n');
    assert.equal((await run(['--root', t, '--file', 'rc', '--allow-empty'], io(Buffer.alloc(0)))).bytes, 0);
    assert.equal((await fs.stat(f)).size, 0);
  });

  it('binary input is written byte for byte', async () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x80]);
    const r = await run(['--root', t, '--file', 'bin'], io(bytes));
    assert.equal(r.bytes, 4);
    assert.deepEqual(await fs.readFile(path.join(t, 'bin')), bytes);
  });

  it('an overwrite keeps the permission bits; a new file is 0600', { skip: process.platform === 'win32' }, async () => {
    const f = path.join(t, 'script.sh');
    await fs.writeFile(f, 'old\n', { mode: 0o755 });
    await fs.chmod(f, 0o755);
    await guardedWrite(f, 'new\n', { root: t });
    assert.equal((await fs.stat(f)).mode & 0o777, 0o755);
    await guardedWrite(path.join(t, 'fresh'), 'x', { root: t });
    assert.equal((await fs.stat(path.join(t, 'fresh'))).mode & 0o777, 0o600);
  });

  it('without /proc/self/fd, a folder swapped for a link before the rename is refused and nothing outside is touched', { skip: process.platform === 'win32' }, async () => {
    const inner = path.join(t, 'd');
    const outside = path.join(t, 'outside');
    await fs.mkdir(inner);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'x'), 'precious\n');
    const hooks = { beforeRename: async () => { await fs.rename(inner, inner + '.moved'); await fs.symlink(outside, inner); } };
    await assert.rejects(guardedWrite(path.join(inner, 'x'), 'evil', { root: t, protect: t, byPath: true, hooks }), (e) => e instanceof KitExit && e.code === 2);
    assert.equal(await fs.readFile(path.join(outside, 'x'), 'utf-8'), 'precious\n');
    assert.deepEqual(await fs.readdir(outside), ['x']);
  });
});

describe('guarded-write — review round 2 regressions', () => {
  let t;
  beforeEach(async () => { t = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gfs-r2-'))); });
  afterEach(async () => { await fs.rm(t, { recursive: true, force: true }); });

  it('on Linux a write refused after the rename leaves the file in the checked folder, never deletes it', { skip: process.platform !== 'linux' }, async () => {
    const d = path.join(t, 'd');
    await fs.mkdir(d);
    await fs.writeFile(path.join(d, 'x'), 'OLD');
    await assert.rejects(guardedWrite(path.join(d, 'x'), 'NEW', { root: t, hooks: { afterOpen: () => fs.rename(d, d + '-moved') } }), (e) => e instanceof KitExit && e.code === 2);
    assert.deepEqual((await fs.readdir(d + '-moved')).filter((n) => !n.endsWith('.tmp')), ['x']);
    assert.equal(await fs.readFile(path.join(d + '-moved', 'x'), 'utf-8'), 'NEW');
    const a = path.join(t, 'a', 'b');
    await fs.mkdir(a, { recursive: true });
    await fs.writeFile(path.join(a, 'f'), 'OLD');
    await assert.rejects(guardedWrite(path.join(a, 'f'), 'NEW', { root: t, hooks: { afterRename: () => fs.rename(path.join(t, 'a'), path.join(t, 'a2')) } }), (e) => e instanceof KitExit && e.code === 2);
    assert.equal(await fs.readFile(path.join(t, 'a2', 'b', 'f'), 'utf-8'), 'NEW');
  });
});

describe('push-gate check — review round 3 regressions', () => {
  it('check on a home with no store folder answers (no receipt yet) and creates nothing', async () => {
    const { run: gate } = await import('../src/lib/kit/push-gate.js');
    const { spawnSync } = await import('child_process');
    const t = await fs.mkdtemp(path.join(os.tmpdir(), 'gfs-r3-'));
    try {
      const home = path.join(t, 'home');
      await fs.mkdir(home);
      const repo = path.join(t, 'repo');
      await fs.mkdir(repo);
      const g = (a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: repo, encoding: 'utf-8' });
      g(['init', '-q', '.']); await fs.writeFile(path.join(repo, 'a'), 'a\n'); g(['add', 'a']); g(['commit', '-q', '-m', 'a']);
      const env = { ...process.env, HOME: home };
      delete env.KIT_RECEIPTS_DIR;
      const r = await gate(['check'], { cwd: repo, stdin: async () => '', env });
      assert.ok(r.decision, JSON.stringify(r));
      assert.deepEqual(await fs.readdir(home), []); // no ~/.claude/kit created by a read
      const ro = { ...process.env, KIT_RECEIPTS_DIR: path.join(t, 'missing', 'deeper', 'receipts') };
      assert.ok((await gate(['check'], { cwd: repo, stdin: async () => '', env: ro })).decision);
      assert.equal(await fs.access(path.join(t, 'missing')).then(() => true, () => false), false);
    } finally { await fs.rm(t, { recursive: true, force: true }); }
  });
});
