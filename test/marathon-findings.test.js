/**
 * Tests for src/lib/marathon/findings.js
 * AC 13–15. Property: seenTwice idempotent and never lists a promoted category.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { normalizeFinding, seenTwice, escapes, foldFindings } from '../src/lib/marathon/findings.js';
import { DEFAULT_CONFIG } from '../src/lib/marathon/config.js';

describe('findings — normalizeFinding', () => {
  it('lower-cases severity, defaults status/found_by, derives area', () => {
    const f = normalizeFinding({ severity: 'HIGH', category: 'correctness', file: 'src/lib/x.js', line: 3, title: 't' }, DEFAULT_CONFIG);
    assert.equal(f.severity, 'high');
    assert.equal(f.status, 'open');
    assert.equal(f.found_by, 'reviewer');
    assert.equal(f.area, 'src');
    assert.equal(f.category, 'correctness');
  });

  it('maps an unknown category to other and keeps a configured extra category', () => {
    assert.equal(normalizeFinding({ severity: 'low', category: 'vibes', title: 't' }, DEFAULT_CONFIG).category, 'other');
    const cfg = { ...DEFAULT_CONFIG, review: { ...DEFAULT_CONFIG.review, categories: [...DEFAULT_CONFIG.review.categories, 'i18n'] } };
    assert.equal(normalizeFinding({ severity: 'low', category: 'i18n', title: 't' }, cfg).category, 'i18n');
  });

  it('throws on a severity outside high|medium|low', () => {
    assert.throws(() => normalizeFinding({ severity: 'critical', category: 'security', title: 't' }, DEFAULT_CONFIG), /severity/i);
  });

  it('keeps an explicit found_by and a file without a directory gets area "."', () => {
    const f = normalizeFinding({ severity: 'medium', category: 'docs', file: 'README.md', title: 't', found_by: 'owner' }, DEFAULT_CONFIG);
    assert.equal(f.found_by, 'owner');
    assert.equal(f.area, '.');
  });
});

describe('findings — seenTwice and escapes', () => {
  const findings = [
    { id: 'f1', review_id: 'r1', category: 'correctness', severity: 'high' },
    { id: 'f2', review_id: 'r1', category: 'correctness', severity: 'low' },
    { id: 'f3', review_id: 'r2', category: 'correctness', severity: 'medium' },
    { id: 'f4', review_id: 'r1', category: 'docs', severity: 'low' },
    { id: 'f5', review_id: 'r2', category: 'accessibility', severity: 'medium' },
    { id: 'f6', review_id: 'r3', category: 'accessibility', severity: 'medium' }
  ];

  it('AC14: lists categories seen in ≥ 2 distinct reviews, not yet promoted', () => {
    const out = seenTwice(findings, []);
    const cats = out.map(c => c.category).sort();
    assert.deepEqual(cats, ['accessibility', 'correctness']);
    const corr = out.find(c => c.category === 'correctness');
    assert.deepEqual([...corr.reviews].sort(), ['r1', 'r2']);
    assert.equal(corr.count, 3);
  });

  it('AC14: a promoted category is excluded', () => {
    const out = seenTwice(findings, [{ category: 'correctness', kind: 'test', ref: 'test/x.test.js' }]);
    assert.deepEqual(out.map(c => c.category), ['accessibility']);
  });

  it('AC15: escapes are the owner-found findings', () => {
    const rows = [{ id: 'a', found_by: 'owner' }, { id: 'b', found_by: 'reviewer' }, { id: 'c', found_by: 'owner' }];
    assert.deepEqual(escapes(rows).map(r => r.id), ['a', 'c']);
  });

  it('f5: foldFindings keeps the last row per id in first-seen order; a fixed row closes a finding', () => {
    const rows = [
      { id: 'a', severity: 'high', status: 'open', found_by: 'owner' },
      { id: 'b', severity: 'low', status: 'open' },
      { id: 'a', severity: 'high', status: 'fixed', commit: 'abc' }
    ];
    const folded = foldFindings(rows);
    assert.deepEqual(folded.map(f => f.id), ['a', 'b']);
    assert.equal(folded[0].status, 'fixed');
    assert.equal(folded[0].found_by, 'owner', 'fields from the earlier row survive a partial close row');
    assert.equal(escapes(rows).length, 1, 'an escape stays an escape after it is fixed');
    assert.deepEqual(seenTwice([
      { id: 'x', review_id: 'r1', category: 'docs' }, { id: 'y', review_id: 'r2', category: 'docs' }, { id: 'x', status: 'fixed' }
    ], []).map(c => c.category), ['docs'], 'closing a finding does not erase that it was seen');
  });

  it('property: idempotent and never lists a promoted category', () => {
    const cats = ['correctness', 'security', 'docs', 'facts'];
    fc.assert(fc.property(
      fc.array(fc.record({ review_id: fc.constantFrom('r1', 'r2', 'r3'), category: fc.constantFrom(...cats) }), { maxLength: 12 }),
      fc.array(fc.record({ category: fc.constantFrom(...cats) }), { maxLength: 3 }),
      (fs, promos) => {
        const a = seenTwice(fs, promos);
        const b = seenTwice(fs, promos);
        assert.deepEqual(a, b);
        const promoted = new Set(promos.map(p => p.category));
        for (const c of a) {
          assert.ok(!promoted.has(c.category));
          assert.ok(c.reviews.length >= 2);
        }
      }
    ), { numRuns: 200 });
  });
});
