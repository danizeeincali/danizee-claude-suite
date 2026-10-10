import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { scoreCase, scoreRun, keywordAtWordStart, normPath, snapshotSpecs, scoreFolders, run, MAX_FILES } from '../src/lib/kit/review-score.js';

const bug = { id: 'b1', file: 'src/a.js', lines: [10, 12], categories: ['correctness'], keywords: ['leak'] };
const spec = (over = {}) => ({ case: 'c', bugs: [bug], accepted: [], ...over });
const rev = (findings, completed = true) => ({ case: 'c', completed, findings });
const f = (over = {}) => ({ file: 'src/a.js', line: 11, category: 'correctness', title: 'A leak', detail: '', ...over });

describe('keyword and path matching', () => {
  it('a keyword matches only at the start of a word', () => {
    assert.equal(keywordAtWordStart('the handle leaked', 'leak'), true);
    assert.equal(keywordAtWordStart('an unleak thing', 'leak'), false);
    assert.equal(keywordAtWordStart('Memory-Leak here', 'leak'), true);
    assert.equal(keywordAtWordStart('anything', ''), false);
    assert.equal(keywordAtWordStart('a (b) c', '(b'), true, 'regex characters are literal');
  });
  it('paths are normalised', () => {
    assert.equal(normPath('.\\src\\\\a.js'), 'src/a.js');
    assert.equal(normPath('./src/./a.js'), 'src/a.js');
    assert.equal(scoreCase(spec(), rev([f({ file: '.\\src\\a.js' })])).hits.length, 1);
  });
});

describe('scoreCase', () => {
  it('tolerance edges', () => {
    const s = spec({ tolerance: 2 });
    for (const [line, hits] of [[7, 0], [8, 1], [14, 1], [15, 0]]) assert.equal(scoreCase(s, rev([f({ line })])).hits.length, hits, `line ${line}`);
    assert.equal(scoreCase(spec(), rev([f({ line: 9 })])).hits.length, 0);
    assert.equal(scoreCase(spec(), rev([f({ line: 12 })])).hits.length, 1);
  });
  it('close but wrong on one criterion is a near miss', () => {
    for (const over of [{ line: 40 }, { category: 'style' }, { title: 'something else' }]) {
      const r = scoreCase(spec(), rev([f(over)]));
      assert.equal(r.near_misses.length, 1, JSON.stringify(over));
      assert.equal(r.hits.length, 0);
    }
    assert.equal(scoreCase(spec(), rev([f({ line: 40, category: 'style' })])).false_positives.length, 1);
    assert.equal(scoreCase(spec(), rev([f({ file: 'src/b.js' })])).false_positives.length, 1);
  });
  it('a second hit on a found bug is a duplicate, kept out of precision', () => {
    const r = scoreCase(spec(), rev([f(), f({ line: 12 })]));
    assert.deepEqual([r.hits.length, r.duplicates.length], [1, 1]);
    assert.equal(scoreRun([r]).precision, 1);
  });
  it('an accepted side issue is not punished', () => {
    const s = spec({ accepted: [{ file: 'src/o.js', lines: [1, 3], note: 'x' }] });
    const r = scoreCase(s, rev([f(), f({ file: 'src/o.js', line: 2, category: 'style', title: 'meh' })]));
    assert.equal(r.accepted.length, 1);
    assert.equal(r.false_positives.length, 0);
    assert.equal(r.passed, true);
  });
  it('a clean case passes only with no findings and a finished review', () => {
    const c = { case: 'c', clean: true, bugs: [] };
    assert.equal(scoreCase(c, rev([])).passed, true);
    const bad = scoreCase(c, rev([f()]));
    assert.equal(bad.passed, false);
    assert.equal(bad.false_positives.length, 1);
    assert.equal(scoreCase(c, rev([], false)).passed, false);
  });
  it('an unfinished or missing review never passes; a missed bug is listed', () => {
    assert.equal(scoreCase(spec(), rev([f()], false)).passed, false);
    const m = scoreCase(spec(), null);
    assert.deepEqual([m.passed, m.completed, m.missed], [false, false, ['b1']]);
  });
  it('accepts marathon review rows as a bare array', () => {
    const rows = [{ severity: 'high', category: 'correctness', file: 'src/a.js', line: 10, title: 'leak', detail: 'x', fix_hint: 'y' }];
    assert.equal(scoreCase(spec(), { case: 'c', completed: true, rows }).hits.length, 1);
  });
  it('invalid specs and reviews are refused', () => {
    assert.throws(() => scoreCase({ case: 'c', bugs: [] }, rev([])), /no bugs planted/);
    assert.throws(() => scoreCase(spec(), { case: 'other', completed: true, findings: [] }), /spec is "c"/);
    assert.throws(() => scoreCase(spec(), { case: 'c', findings: [] }), /completed/);
  });
});

describe('scoreRun', () => {
  it('sums hits over sums of checks, not an average of ratios', () => {
    const a = scoreCase(spec(), rev([f()]));                                                  // 1 hit / 1 check
    const b = scoreCase(spec(), rev([f({ line: 40, category: 'x', title: 'q' }), f({ file: 'z', title: 'q' }), f({ file: 'y', title: 'q' }), f({ file: 'w', title: 'q' }), f({ file: 'v', title: 'q' })])); // 0 hits / 5 checks
    const t = scoreRun([a, b]);
    assert.equal(t.precision, 1 / 6);
    assert.equal(t.recall, 1 / 2);
    assert.equal(scoreRun([]).precision, null);
  });
});

describe('snapshot and the CLI', () => {
  let dir;
  afterEach(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }); dir = null; });
  const mk = async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-'));
    const p = (n) => path.join(dir, n);
    await fs.mkdir(p('specs')); await fs.mkdir(p('reviews'));
    await fs.writeFile(p('specs/c.json'), JSON.stringify(spec()));
    await fs.writeFile(p('reviews/odd name (1).json'), JSON.stringify(rev([f()])));
    return p;
  };
  it('editing the spec after the snapshot does not change the score', async () => {
    const p = await mk();
    const a = await scoreFolders({ specs: p('specs'), reviews: p('reviews'), out: p('out') });
    assert.equal(a.totals.hits, 1);
    assert.equal(a.snapshot_reused, false);
    await fs.writeFile(p('specs/c.json'), JSON.stringify(spec({ bugs: [{ ...bug, keywords: ['nothing'] }] })));
    const b = await scoreFolders({ specs: p('specs'), reviews: p('reviews'), out: p('out') });
    assert.equal(b.snapshot_reused, true);
    assert.equal(b.totals.hits, 1);
  });
  it('a tampered snapshot is refused', async () => {
    const p = await mk();
    await snapshotSpecs(p('specs'), p('out'));
    await fs.writeFile(p('out/specs/c.json'), JSON.stringify(spec({ tolerance: 99 })));
    await assert.rejects(snapshotSpecs(p('specs'), p('out')), /changed after it was copied/);
  });
  it('a half-written snapshot (no manifest) is redone, not trusted', async () => {
    const p = await mk();
    await fs.mkdir(p('out/specs'), { recursive: true });
    await fs.writeFile(p('out/specs/stale.json'), '{}');
    const r = await snapshotSpecs(p('specs'), p('out'));
    assert.equal(r.reused, false);
  });
  it('a missing review scores as unfinished; a review without a spec is invalid; the folder walk is capped', async () => {
    const p = await mk();
    await fs.rm(p('reviews/odd name (1).json'));
    const r = await scoreFolders({ specs: p('specs'), reviews: p('reviews'), out: p('out') });
    assert.deepEqual(r.missing_reviews, ['c']);
    assert.equal(r.totals.failed, 1);
    await fs.writeFile(p('reviews/x.json'), JSON.stringify({ case: 'zzz', completed: true, findings: [] }));
    await assert.rejects(scoreFolders({ specs: p('specs'), reviews: p('reviews'), out: p('out') }), /no spec/);
    await fs.rm(p('reviews/x.json'));
    for (let i = 0; i <= MAX_FILES; i++) await fs.writeFile(p(`reviews/r${i}.json`), '{}');
    await assert.rejects(scoreFolders({ specs: p('specs'), reviews: p('reviews'), out: p('out') }), /more than/);
  });
  it('bad arguments are short errors that point at --help', async () => {
    await assert.rejects(run(['--nope'], { cwd: '.' }), /unknown argument.*--help/);
    await assert.rejects(run(['--specs', 'a'], { cwd: '.' }), /--reviews is required/);
  });
});
