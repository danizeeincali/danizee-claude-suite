import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('redline-passes — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('plans, walks the passes in order, refuses out of order, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('redline-passes'));
    const p = pkg.kit(['redline-passes', 'plan']);
    assert.equal(p.code, 0);
    assert.equal(p.json.passes.length, 9);
    assert.equal(p.json.passes[0].id, 'spacing');
    assert.equal(p.json.passes[8].id, 'motion');

    const n0 = pkg.kit(['redline-passes', 'next', '--state', 'progress.json']);
    assert.equal(n0.code, 0);
    assert.equal(n0.json.next.id, 'spacing');

    const m1 = pkg.kit(['redline-passes', 'mark', '--state', 'progress.json', '--pass', 'spacing']);
    assert.equal(m1.code, 0);
    assert.equal(m1.json.next, 'color');
    const refused = pkg.kit(['redline-passes', 'mark', '--state', 'progress.json', '--pass', 'motion']);
    assert.equal(refused.code, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pkg.dir, 'progress.json'), 'utf-8')).done, ['spacing']);

    const all = pkg.kit(['redline-passes', 'next', '--state', 'progress.json', '--all-at-once']);
    assert.equal(all.json.batch.length, 8);

    fs.writeFileSync(path.join(pkg.dir, 'skip.json'), '{"done":["icons"]}');
    assert.equal(pkg.kit(['redline-passes', 'next', '--state', 'skip.json']).code, 0);
    assert.equal(pkg.kit(['redline-passes', 'next', '--state', 'skip.json', '--strict']).code, 2);

    fs.writeFileSync(path.join(pkg.dir, 'bad.json'), 'nope');
    assert.equal(pkg.kit(['redline-passes', 'next', '--state', 'bad.json']).code, 1);
    assert.equal(pkg.kit(['redline-passes', 'nope']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
