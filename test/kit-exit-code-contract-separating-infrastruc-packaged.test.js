import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
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
    const b = pkg.kit(['exit-codes', 'blocks', '2']);
    assert.equal(b.code, 0);
    assert.equal(b.json.blocks, true);
    assert.equal(pkg.kit(['exit-codes', 'blocks', '3', '--verb', 'safe-git']).json.blocks, false);
    assert.equal(pkg.kit(['exit-codes', 'classify', '--code', '137']).json.class, 'infrastructure');
    assert.equal(pkg.kit(['exit-codes', 'classify', '--code', '9']).json.class, 'unknown');
    assert.equal(pkg.kit(['exit-codes', 'describe', '3', '--verb', 'safe-git']).json.class, 'infrastructure');
    const bad = pkg.kit(['exit-codes', 'describe', 'zz']);
    assert.equal(bad.code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
