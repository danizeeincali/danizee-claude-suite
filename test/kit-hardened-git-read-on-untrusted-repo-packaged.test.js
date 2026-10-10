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
