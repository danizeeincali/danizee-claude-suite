import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('review-score — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('scores the shipped fixtures with a perfect sample, then a bad review, from the installed kit', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('review-score'));
    const fx = path.join(pkg.dir, '.claude', 'helpers', 'kit', 'review-fixtures');
    assert.ok((await fs.readdir(path.join(fx, 'repos'))).length >= 3);
    const out = path.join(pkg.dir, 'cal', 'scores');
    const ok = pkg.kit(['review-score', '--specs', path.join(fx, 'specs'), '--reviews', path.join(fx, 'reviews-sample'), '--out', out]);
    assert.equal(ok.code, 0, ok.err);
    assert.equal(ok.json.totals.passed, 3);
    assert.equal(ok.json.totals.precision, 1);
    assert.equal(ok.json.totals.recall, 1);

    const bad = path.join(pkg.dir, 'cal', 'reviews');
    await fs.mkdir(bad, { recursive: true });
    await fs.writeFile(path.join(bad, 'cache-leak.json'), JSON.stringify({ case: 'cache-leak', completed: true, findings: [{ file: 'src/cache.js', line: 5, category: 'style', title: 'naming', detail: 'x' }] }));
    await fs.writeFile(path.join(bad, 'tidy-clean.json'), JSON.stringify({ case: 'tidy-clean', completed: true, findings: [{ file: 'src/sum.js', line: 1, category: 'style', title: 'x', detail: 'y' }] }));
    const r = pkg.kit(['review-score', '--specs', path.join(fx, 'specs'), '--reviews', bad, '--out', out]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.snapshot_reused, true);
    assert.equal(r.json.totals.passed, 0);
    assert.deepEqual(r.json.missing_reviews, ['pager-off-by-one']);
    assert.equal(r.json.totals.recall, 0);
    assert.equal(pkg.kit(['review-score', '--specs', fx]).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
