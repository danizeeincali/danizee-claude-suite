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

  it('detects a swap after the folder was opened: the written file is removed, none remains anywhere', async () => {
    const outside = path.join(base, 'outside');
    await fs.mkdir(outside);
    const dir = path.join(prot, 'd');
    await fs.mkdir(dir);
    const moved = path.join(prot, 'd-moved');
    const hooks = { afterOpen: async () => { await fs.rename(dir, moved); await fs.symlink(outside, dir); } };
    await assert.rejects(guardedWrite(path.join(dir, 'x'), 'no', opts({ hooks })), refused);
    assert.deepEqual(await fs.readdir(outside), []);
    assert.deepEqual(await fs.readdir(moved), []);
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
      await assert.rejects(gate(['receipt', '--verdict', 'pass', '--high', '0', '--medium', '0', '--low', '0'], io), (e) => e instanceof KitExit && e.code === 2);
      assert.ok(f);
    } finally { await fs.rm(t, { recursive: true, force: true }); }
  });
});
