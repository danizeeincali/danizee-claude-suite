import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installPackaged } from './helpers/packaged.js';

describe('exit-codes — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('drives the installed verb', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('exit-codes'));
    const t = pkg.kit(['exit-codes', 'table']);
    assert.equal(t.code, 0);
    assert.equal(t.json.codes['2'], 'regression');
    const b = pkg.kit(['exit-codes', 'blocks', '2', '--verb', 'push-gate']);
    assert.equal(b.code, 0);
    assert.equal(b.json.blocks, true);
    assert.equal(pkg.kit(['exit-codes', 'blocks', '2', '--verb', 'graph']).json.blocks, false);
    assert.equal(pkg.kit(['exit-codes', 'blocks', '2']).json.blocks, false);
    assert.equal(pkg.kit(['exit-codes', 'blocks', '2', '--verb', 'safegit']).code, 1);
    assert.equal(pkg.kit(['exit-codes', 'classify', '--code', '127']).json.class, 'precondition');
    assert.equal(pkg.kit(['exit-codes', 'blocks', '3', '--verb', 'safe-git']).json.blocks, false);
    assert.equal(pkg.kit(['exit-codes', 'classify', '--code', '137']).json.class, 'infrastructure');
    assert.equal(pkg.kit(['exit-codes', 'classify', '--code', '9']).json.class, 'unknown');
    assert.equal(pkg.kit(['exit-codes', 'describe', '3', '--verb', 'safe-git']).json.class, 'infrastructure');
    const bad = pkg.kit(['exit-codes', 'describe', 'zz']);
    assert.equal(bad.code, 1);
    assert.deepEqual(pkg.egress(), []);
  });

  it('a real push-gate run that could not run is infrastructure with --result, a regression without', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'exitcodes-pkg-'));
    try {
      const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf-8' });
      g('init', '-q'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 'a');
      fs.mkdirSync(path.join(repo, '.claude', 'kit'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.claude', 'kit', 'scrub-patterns'), 'secretword\n');
      fs.writeFileSync(path.join(repo, 'a'), 'hi\n');
      g('add', '-A'); g('commit', '-qm', 'x');
      const pg = pkg.kit(['push-gate', 'check', '--timeout', '1'], undefined, { cwd: repo });
      assert.equal(pg.code, 2);
      assert.equal(pg.json.scrub.ran, false);
      const without = pkg.kit(['exit-codes', 'classify', '--code', '2', '--verb', 'push-gate']);
      assert.equal(without.json.class, 'regression');
      const withR = pkg.kit(['exit-codes', 'classify', '--code', '2', '--verb', 'push-gate', '--result', '-'], pg.out);
      assert.equal(withR.code, 0);
      assert.equal(withR.json.class, 'infrastructure');
      assert.equal(withR.json.blocks, false);
      assert.equal(pkg.kit(['exit-codes', 'blocks', '2', '--verb', 'push-gate', '--result', '-'], pg.out).json.blocks, false);
      assert.equal(pkg.kit(['exit-codes', 'classify', '--code', '124']).json.class, 'infrastructure');
      const nope = pkg.kit(['exit-codes', 'blocks', '2', '--verb', 'scrub', '--result', '-'], 'nope');
      assert.equal(nope.code, 0, 'a judge 2 with unusable output blocks, it does not error');
      assert.equal(nope.json.blocks, true);
      assert.equal(pkg.kit(['exit-codes', 'blocks', '2', '--result', '-'], 'nope').json.blocks, false, 'no judge verb: the result is not read');
      fs.writeFileSync(path.join(repo, 'creds.txt'), 'AKIAABCDEFGHIJKLMNOP\n' + 'x'.repeat(300) + '\n');
      fs.writeFileSync(path.join(repo, '.claude', 'kit', 'scrub-patterns'), 'AKIA[0-9A-Z]{16}\n');
      g('add', '-A'); g('commit', '-qm', 'y');
      const big = pkg.kit(['scrub', '--max-file-bytes', '100'], undefined, { cwd: repo });
      assert.equal(big.code, 2);
      assert.equal(big.json.hit_count, 0);
      assert.equal(pkg.kit(['exit-codes', 'blocks', '2', '--verb', 'scrub', '--result', '-'], big.out).json.blocks, true);
      assert.equal(pkg.kit(['exit-codes', 'classify', '--code', '2', '--verb', 'scrub', '--result', '-'], big.out).json.class, 'regression');
      assert.deepEqual(pkg.egress(), []);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });
});
