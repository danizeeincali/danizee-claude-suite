import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('guarded-write — packaged end to end', () => {
  let pkg, base;
  before(async () => { pkg = await installPackaged(); base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gfs-pkg-'))); });
  after(async () => { await pkg.cleanup(); await fs.rm(base, { recursive: true, force: true }); });

  it('writes through the installed CLI, refuses a link in the protected tree, and push-gate uses the guard', async () => {
    assert.ok(pkg.kit(['help']).json.verbs.includes('guarded-write'));
    const home = path.join(base, 'home');
    await fs.mkdir(home);
    const ok = pkg.kit(['guarded-write', '--root', home, '--file', path.join(home, 'a', 'b.txt')], 'hello');
    assert.equal(ok.code, 0, ok.err);
    assert.equal(await fs.readFile(path.join(home, 'a', 'b.txt'), 'utf-8'), 'hello');

    const outside = path.join(base, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(home, 'a', 'lnk'));
    const bad = pkg.kit(['guarded-write', '--root', home, '--file', path.join(home, 'a', 'lnk', 'x')], 'no');
    assert.equal(bad.code, 2);
    assert.match(bad.err, /refused/);
    assert.deepEqual(await fs.readdir(outside), []);
    assert.equal(pkg.kit(['guarded-write', '--root', home, '--file', 'a/../../x'], 'no').code, 2);
    assert.equal(pkg.kit(['guarded-write', '--root', home, '--nope', 'x'], 'no').code, 1);

    // the receipts store of push-gate: the walk starts at the store's real parent, a link inside the receipts folder is refused
    const rec = path.join(home, '.claude', 'kit', 'receipts');
    await fs.mkdir(rec, { recursive: true });
    const env = { HOME: home };
    const r1 = pkg.kit(['push-gate', 'receipt', '--verdict', 'pass'], '', { extraEnv: env });
    assert.equal(r1.code, 0, r1.err);
    const files = (await fs.readdir(rec)).filter((n) => n.endsWith('.json'));
    assert.equal(files.length, 1);
    assert.equal(pkg.kit(['push-gate', 'check'], '', { extraEnv: env }).json.decision, 'abstain');
    await fs.rename(rec, path.join(base, 'moved'));
    await fs.symlink(path.join(base, 'moved'), rec);
    const r2 = pkg.kit(['push-gate', 'receipt', '--verdict', 'pass'], '', { extraEnv: env });
    assert.equal(r2.code, 2, r2.err);
    assert.equal(pkg.kit(['push-gate', 'check'], '', { extraEnv: env }).code, 2);
    assert.deepEqual(pkg.egress(), []);
  });
});
