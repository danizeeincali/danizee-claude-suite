import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { installPackaged } from './helpers/packaged.js';

describe('safe-git — packaged end to end', () => {
  let pkg, root;
  before(async () => { pkg = await installPackaged(); root = await fs.mkdtemp(path.join(os.tmpdir(), 'sg-pkg-')); });
  after(async () => { await pkg.cleanup(); await fs.rm(root, { recursive: true, force: true }); });
  const sh = (cwd, args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf-8' });

  it('reads a hostile repo through the installed verb: output is right, no marker appears, an outer GIT_DIR is ignored, writes are refused', async () => {
    const repo = path.join(root, 'foreign');
    const markers = path.join(root, 'markers');
    await fs.mkdir(repo); await fs.mkdir(markers);
    sh(repo, ['init', '-q', '.']);
    await fs.writeFile(path.join(repo, 'f.txt'), 'one\n');
    sh(repo, ['add', 'f.txt']); sh(repo, ['commit', '-q', '-m', 'init']);
    const head = sh(repo, ['rev-parse', 'HEAD']).stdout.trim();
    const hook = path.join(repo, 'fsm.sh');
    await fs.writeFile(hook, `#!/bin/sh\ntouch '${markers}/fsmonitor'\n`, { mode: 0o755 });
    await fs.writeFile(path.join(repo, '.gitattributes'), '*.txt filter=evil\n');
    sh(repo, ['config', 'core.fsmonitor', hook]);
    sh(repo, ['config', 'filter.evil.clean', `sh -c 'touch ${markers}/clean; cat'`]);
    sh(repo, ['config', 'core.hooksPath', path.join(repo, 'nohooks')]);
    await fs.writeFile(path.join(repo, 'f.txt'), 'two\n');

    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('safe-git'));
    const rp = pkg.kit(['safe-git', '--dir', repo, '--', 'rev-parse', 'HEAD'], '', { extraEnv: { GIT_DIR: path.join(pkg.dir, '.git') } });
    assert.equal(rp.code, 0, rp.err);
    assert.equal(rp.json.stdout.trim(), head);
    assert.equal(rp.json.code, 0);
    const st = pkg.kit(['safe-git', '--dir', repo, '--', 'status', '--porcelain']);
    assert.match(st.json.stdout, / M f\.txt/);
    assert.match(pkg.kit(['safe-git', '--dir', repo, '--', 'diff']).json.stdout, /\+two/);
    assert.deepEqual(await fs.readdir(markers), []);

    // the repo config names a gpg program behind format.pretty=%G? and a signed-looking commit is checked out
    const tree = sh(repo, ['rev-parse', 'HEAD^{tree}']).stdout.trim();
    const body = `tree ${tree}\nparent ${head}\nauthor t <t@t> 1 +0000\ncommitter t <t@t> 1 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEz\n -----END PGP SIGNATURE-----\n\nsigned\n`;
    const signed = spawnSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: repo, input: body, encoding: 'utf-8' }).stdout.trim();
    sh(repo, ['update-ref', 'refs/heads/signed', signed]);
    const gpg = path.join(root, 'gpg.sh');
    await fs.writeFile(gpg, `#!/bin/sh\ntouch '${markers}/gpg'\nexit 1\n`, { mode: 0o755 });
    sh(repo, ['config', 'gpg.program', gpg]);
    sh(repo, ['config', 'format.pretty', 'format:%H %G?']);
    sh(repo, ['config', 'log.showSignature', 'true']);
    const lg = pkg.kit(['safe-git', '--dir', repo, '--', 'log', '-1', 'signed']);
    assert.equal(lg.code, 0, lg.err);
    assert.match(lg.json.stdout, new RegExp(`^commit ${signed}`));
    assert.equal(pkg.kit(['safe-git', '--dir', repo, '--', 'for-each-ref', '--format=%(signature)']).code, 2);
    assert.deepEqual(await fs.readdir(markers), []);

    const w = pkg.kit(['safe-git', '--dir', repo, '--', 'fetch', 'origin']);
    assert.equal(w.code, 2);
    assert.match(w.err, /refused/);
    assert.equal(pkg.kit(['safe-git', '--dir', repo, '--nope', '--', 'status']).code, 1);

    await fs.appendFile(path.join(repo, '.gitattributes'), '*.md filter=bad;name\n');
    const bad = pkg.kit(['safe-git', '--dir', repo, '--', 'status']);
    assert.equal(bad.code, 2);
    assert.deepEqual(await fs.readdir(markers), []);
    assert.deepEqual(pkg.egress(), []);
  });
});
