/**
 * Tests for src/lib/marathon/reviewer.js
 * AC 16–19.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  DEFAULT_ANGLES, pickAngle, renderBrief, renderWriteup, ingestFindings
} from '../src/lib/marathon/reviewer.js';
import { DEFAULT_CONFIG } from '../src/lib/marathon/config.js';

describe('reviewer — angles', () => {
  it('DEFAULT_ANGLES is non-empty and excludes confirm-the-fixes', () => {
    assert.ok(Array.isArray(DEFAULT_ANGLES) && DEFAULT_ANGLES.length >= 5);
    assert.ok(!DEFAULT_ANGLES.some(a => /confirm/i.test(a)));
  });

  it('AC16: pickAngle rotates and never confirms the fixes', () => {
    assert.equal(pickAngle(1), DEFAULT_ANGLES[0]);
    assert.equal(pickAngle(DEFAULT_ANGLES.length + 1), DEFAULT_ANGLES[0]);
    assert.equal(pickAngle(2, ['a', 'b']), 'b');
    fc.assert(fc.property(fc.integer({ min: 1, max: 1000 }), (round) => {
      assert.ok(!/confirm/i.test(pickAngle(round)));
    }));
  });
});

describe('reviewer — brief and write-up', () => {
  it('AC18: renderBrief includes severity defs, angle, tolerance, categories, diff and the JSON-only rule', () => {
    const brief = renderBrief({
      stream: 'intake',
      round: 2,
      angle: 'failure conditions',
      severityMd: '## Severity\nhigh = data loss',
      diff: 'diff --git a/x b/x\n+added line',
      tolerance: { high: 0, medium: 2, low: 5, passes_in_a_row: 2 },
      categories: DEFAULT_CONFIG.review.categories
    });
    assert.match(brief, /high = data loss/);
    assert.match(brief, /failure conditions/);
    assert.match(brief, /intake/);
    assert.match(brief, /round 2/i);
    assert.match(brief, /high.*0/);
    assert.match(brief, /medium.*2/);
    assert.match(brief, /correctness/);
    assert.match(brief, /accessibility/);
    assert.match(brief, /\+added line/);
    assert.match(brief, /JSON/);
    assert.match(brief, /only/i);
    assert.match(brief, /neither inflate nor deflate/i);
    assert.match(brief, /never weaken/i);
  });

  it('l6: the brief describes the tolerance the way reviewPasses applies it', () => {
    const brief = renderBrief({ stream: 's', round: 1, angle: 'a', severityMd: '# sev', diff: '', tolerance: { high: 0, medium: 2 }, categories: ['docs'] });
    assert.match(brief, /this round/i, 'pass is computed from this round\'s counts, not open findings');
    assert.match(brief, /low[^\n]*no limit/i, 'a missing tolerance key is unlimited, as in reviewPasses');
    assert.ok(!/at most 0 open/.test(brief));
  });

  it('AC19: renderWriteup lists every finding with a count, grouped by severity', () => {
    const review = { id: 'r7', stream: 'intake', round: 3, commit: 'abc1234', counts: { high: 1, medium: 1, low: 0 }, pass: false, angle: 'security probes' };
    const findings = [
      { id: 'f1', severity: 'high', category: 'security', file: 'src/a.js', line: 10, title: 'Egress without allowlist', detail: 'd1' },
      { id: 'f2', severity: 'medium', category: 'correctness', file: 'src/b.js', line: 20, title: 'Off by one', detail: 'd2' }
    ];
    const md = renderWriteup(review, findings);
    assert.match(md, /2 findings/);
    assert.match(md, /Egress without allowlist/);
    assert.match(md, /Off by one/);
    assert.match(md, /src\/a\.js:10/);
    assert.match(md, /abc1234/);
    assert.match(md, /security probes/);
    assert.ok(md.indexOf('Egress without allowlist') < md.indexOf('Off by one'), 'high before medium');
    assert.match(md, /r7/);
  });

  it('k15: the write-up carries fix_hint and neutralises markdown/HTML in reviewer text', () => {
    const review = { id: 'r8', stream: 's', round: 1, commit: 'abc1234', counts: { high: 1, medium: 0, low: 0 }, pass: false };
    const md = renderWriteup(review, [
      { id: 'f', severity: 'high', category: 'security', file: 'a.js', line: 1, title: 'No **input** <b>validation</b>', detail: 'd', fix_hint: 'validate at the boundary' }
    ]);
    assert.match(md, /fix: validate at the boundary/);
    assert.ok(!md.includes('<b>validation</b>'), 'HTML tag neutralised');
    assert.ok(!md.includes('**input**'), 'inner bold neutralised');
  });

  it('ingestFindings stamps review_id, stream and found_by and normalises rows', () => {
    const rows = ingestFindings(
      [{ severity: 'High', category: 'security', file: 'src/a.js', line: 1, title: 't' },
       { severity: 'low', category: 'vibes', file: 'docs/x.md', title: 'u' }],
      { review_id: 'r1', stream: 'intake', found_by: 'scanner' },
      DEFAULT_CONFIG
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.review_id === 'r1' && r.stream === 'intake' && r.found_by === 'scanner'));
    assert.equal(rows[0].severity, 'high');
    assert.equal(rows[1].category, 'other');
    assert.equal(rows[1].area, 'docs');
  });
});
