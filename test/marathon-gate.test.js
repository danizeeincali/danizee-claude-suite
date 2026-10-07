/**
 * Tests for src/lib/marathon/gate.js + streak.js
 * AC 4–9. Property tests: missing data never met; null never counted; gateMet ⇒ buildGateMet.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { evaluateGate, resolveSource, compare, parseChecklist } from '../src/lib/marathon/gate.js';
import * as gateApi from '../src/lib/marathon/gate.js';
import { greenStreak, reviewStreak, latestReview, openBySeverity, reviewPasses } from '../src/lib/marathon/streak.js';
import * as streakApi from '../src/lib/marathon/streak.js';

const line = (o) => ({ type: 'number', op: 'at_least', owner: 'build', label: o.id, ...o });

const greenRuns = (n, kind = 'e2e') => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, kind, status: 'green' }));
const review = (id, pass, counts = { high: 0, medium: 0, low: 0 }, extra = {}) => ({ id, pass, counts, ...extra });

describe('streak helpers', () => {
  it('greenStreak counts consecutive green runs of a kind from the end', () => {
    const runs = [
      { kind: 'e2e', status: 'green' }, { kind: 'e2e', status: 'red' },
      { kind: 'unit', status: 'green' }, { kind: 'e2e', status: 'green' }, { kind: 'e2e', status: 'green' }
    ];
    assert.equal(greenStreak(runs, 'e2e'), 2);
    assert.equal(greenStreak(runs, 'unit'), 1);
    assert.equal(greenStreak(runs, 'build'), 0);
  });

  it('reviewStreak counts consecutive passes from the end', () => {
    assert.equal(reviewStreak([review('a', true), review('b', false), review('c', true), review('d', true)]), 2);
    assert.equal(reviewStreak([]), 0);
  });

  it('latestReview / openBySeverity / reviewPasses', () => {
    assert.equal(latestReview([review('a', true), review('b', false)]).id, 'b');
    assert.equal(latestReview([]), null);
    assert.deepEqual(
      openBySeverity([
        { severity: 'high', status: 'open' }, { severity: 'high', status: 'fixed' },
        { severity: 'low', status: 'open' }
      ]),
      { high: 1, medium: 0, low: 1 }
    );
    const tol = { high: 0, medium: 2, low: 5 };
    assert.equal(reviewPasses({ high: 0, medium: 2, low: 5 }, tol), true);
    assert.equal(reviewPasses({ high: 1, medium: 0, low: 0 }, tol), false);
    assert.equal(reviewPasses({ high: 0, medium: 3, low: 0 }, tol), false);
  });
});

describe('gate — compare and checklist', () => {
  it('compare implements at_least / at_most / is', () => {
    assert.equal(compare('at_least', 6, 6), true);
    assert.equal(compare('at_least', 5, 6), false);
    assert.equal(compare('at_most', 0, 0), true);
    assert.equal(compare('at_most', 1, 0), false);
    assert.equal(compare('is', true, true), true);
    assert.equal(compare('is', false, true), false);
  });

  it('parseChecklist reads "- [x] id — label" lines only', () => {
    const md = [
      '# Human checklist', '',
      '- [x] deployed — Deploy to hosting',
      '- [ ] domain — Point the domain',
      '- [X] keys — Add the API keys',
      'not a checkbox line', '- [ ] (no id here)'
    ].join('\n');
    assert.deepEqual(parseChecklist(md), { deployed: true, domain: false, keys: true });
  });
});

describe('gate — resolveSource vocabulary', () => {
  const ctx = {
    runs: greenRuns(6),
    reviews: [review('r1', false, { high: 1, medium: 0, low: 0 }), review('r2', true, { high: 0, medium: 1, low: 2 })],
    findings: [{ severity: 'high', status: 'open' }, { severity: 'medium', status: 'fixed' }],
    helpers: [
      { event: 'spawn', id: 'h1', budget: 100 }, { event: 'done', helper_id: 'h1', tokens: 300 },
      { event: 'spawn', id: 'h2', budget: 100 }, { event: 'done', helper_id: 'h2', tokens: 50 }
    ],
    measurements: [{ key: 'lighthouse', value: 85 }, { key: 'lighthouse', value: 92 }],
    checklist: { deployed: true, domain: false }
  };

  it('resolves every source in the vocabulary', () => {
    assert.deepEqual(resolveSource('runs.streak:e2e', ctx), { found: true, value: 6 });
    assert.deepEqual(resolveSource('reviews.streak', ctx), { found: true, value: 1 });
    assert.deepEqual(resolveSource('reviews.latest.high', ctx), { found: true, value: 0 });
    assert.deepEqual(resolveSource('reviews.latest.low', ctx), { found: true, value: 2 });
    assert.deepEqual(resolveSource('findings.open:high', ctx), { found: true, value: 1 });
    assert.deepEqual(resolveSource('findings.open:medium', ctx), { found: true, value: 0 });
    assert.deepEqual(resolveSource('helpers.over_budget', ctx), { found: true, value: 1 });
    assert.deepEqual(resolveSource('checklist:deployed', ctx), { found: true, value: true });
    assert.deepEqual(resolveSource('checklist:domain', ctx), { found: true, value: false });
    assert.deepEqual(resolveSource('measure:lighthouse', ctx), { found: true, value: 92 });
  });

  it('reports found:false for missing data and unknown sources', () => {
    assert.equal(resolveSource('measure:nothing', ctx).found, false);
    assert.equal(resolveSource('checklist:missing', ctx).found, false);
    assert.equal(resolveSource('reviews.latest.high', { ...ctx, reviews: [] }).found, false);
    assert.equal(resolveSource('bogus.source', ctx).found, false);
  });
});

describe('gate — evaluateGate scenarios', () => {
  const base = {
    runs: greenRuns(6),
    reviews: [review('r1', true), review('r2', true)],
    findings: [],
    helpers: [],
    measurements: [],
    checklist: {}
  };

  it('AC4: a line with no data is failing (build) or waitingOnHuman (human) — never met', () => {
    const fl = { lines: [
      line({ id: 'lh', source: 'measure:lighthouse', value: 90 }),
      line({ id: 'dep', source: 'checklist:deployed', type: 'bool', op: 'is', value: true, owner: 'human' })
    ] };
    const g = evaluateGate({ finishLine: fl, ...base });
    assert.deepEqual(g.failing, ['lh']);
    assert.deepEqual(g.waitingOnHuman, ['dep']);
    assert.equal(g.buildGateMet, false);
    assert.equal(g.gateMet, false);
    assert.ok(g.lines.every(l => l.status !== 'met'));
  });

  it('AC5: value null is shown as not_counted and does not affect the verdict', () => {
    const fl = { lines: [
      line({ id: 'e2e', source: 'runs.streak:e2e', value: 6 }),
      line({ id: 'lh', source: 'measure:lighthouse', value: null })
    ] };
    const g = evaluateGate({ finishLine: fl, ...base });
    assert.equal(g.lines.find(l => l.id === 'lh').status, 'not_counted');
    assert.deepEqual(g.failing, []);
    assert.equal(g.buildGateMet, true);
    assert.equal(g.gateMet, true);
  });

  it('AC6: human line unmet → buildGateMet true, gateMet false', () => {
    const fl = { lines: [
      line({ id: 'e2e', source: 'runs.streak:e2e', value: 6 }),
      line({ id: 'clean', source: 'reviews.streak', value: 2 }),
      line({ id: 'high', source: 'reviews.latest.high', op: 'at_most', value: 0 }),
      line({ id: 'dep', source: 'checklist:deployed', type: 'bool', op: 'is', value: true, owner: 'human' })
    ] };
    const g = evaluateGate({ finishLine: fl, ...base, checklist: { deployed: false } });
    assert.equal(g.buildGateMet, true);
    assert.equal(g.gateMet, false);
    assert.deepEqual(g.waitingOnHuman, ['dep']);
    assert.deepEqual(g.failing, []);
  });

  it('all lines met → both gates met', () => {
    const fl = { lines: [
      line({ id: 'e2e', source: 'runs.streak:e2e', value: 6 }),
      line({ id: 'clean', source: 'reviews.streak', value: 2 }),
      line({ id: 'lh', source: 'measure:lighthouse', type: 'percent', value: 90 }),
      line({ id: 'dep', source: 'checklist:deployed', type: 'bool', op: 'is', value: true, owner: 'human' })
    ] };
    const g = evaluateGate({
      finishLine: fl, ...base,
      measurements: [{ key: 'lighthouse', value: 93 }],
      checklist: { deployed: true }
    });
    assert.equal(g.buildGateMet, true);
    assert.equal(g.gateMet, true);
    assert.equal(g.lines.find(l => l.id === 'lh').actual, 93);
  });

  it('a failing build line is listed in failing with its actual value', () => {
    const fl = { lines: [line({ id: 'e2e', source: 'runs.streak:e2e', value: 6 })] };
    const g = evaluateGate({ finishLine: fl, ...base, runs: greenRuns(3) });
    assert.deepEqual(g.failing, ['e2e']);
    assert.equal(g.lines[0].actual, 3);
    assert.equal(g.lines[0].status, 'failing');
  });
});

describe('gate — review-round-1 fixes: types, invalid counts, per-stream scope', () => {
  const base = { runs: [], reviews: [], findings: [], helpers: [], measurements: [], checklist: {} };

  it('f7: a number/percent line is met only by a finite number; bool only by a boolean', () => {
    const fl = { lines: [
      line({ id: 'kb', type: 'number', op: 'at_most', value: 200, source: 'measure:kb' }),
      line({ id: 'pct', type: 'percent', op: 'at_least', value: 90, source: 'measure:pct' }),
      line({ id: 'dep', type: 'bool', op: 'is', value: true, source: 'checklist:deployed' })
    ] };
    for (const bad of ['', null, '150', 'abc', NaN, Infinity]) {
      const g = evaluateGate({ finishLine: fl, ...base, measurements: [{ key: 'kb', value: bad }, { key: 'pct', value: bad }], checklist: { deployed: 1 } });
      assert.equal(g.lines.find(l => l.id === 'kb').status, 'failing', `kb with ${String(bad)}`);
      assert.equal(g.lines.find(l => l.id === 'pct').status, 'failing', `pct with ${String(bad)}`);
      assert.equal(g.lines.find(l => l.id === 'dep').status, 'failing', 'bool line with a number is not met');
      assert.equal(g.buildGateMet, false);
    }
    const ok = evaluateGate({ finishLine: fl, ...base, measurements: [{ key: 'kb', value: 150 }, { key: 'pct', value: 95 }], checklist: { deployed: true } });
    assert.equal(ok.gateMet, true);
  });

  it('f3: reviews.latest.<sev> is unresolved when the latest review has no valid counts', () => {
    for (const counts of [undefined, null, '{"high":1}', { high: 'x' }, { high: -1, medium: 0, low: 0 }, { high: 0.5, medium: 0, low: 0 }]) {
      const ctx = { ...base, reviews: [{ id: 'r', pass: true, counts }] };
      assert.equal(resolveSource('reviews.latest.high', ctx).found, false, `counts=${JSON.stringify(counts)}`);
    }
    assert.equal(reviewPasses(undefined, { high: 0 }), false);
    assert.equal(reviewPasses({ high: 'x' }, { high: 0 }), false);
    assert.equal(reviewPasses({ high: 0, medium: 0, low: 0 }, {}), false, 'no tolerance = nothing to pass against');
  });

  it('f5: open findings are folded by id — a later fixed row closes an earlier open one', () => {
    const findings = [
      { id: 'f1', severity: 'high', status: 'open' },
      { id: 'f2', severity: 'high', status: 'open' },
      { id: 'f1', severity: 'high', status: 'fixed' }
    ];
    assert.deepEqual(openBySeverity(findings), { high: 1, medium: 0, low: 0 });
    assert.equal(resolveSource('findings.open:high', { ...base, findings }).value, 1);
  });

  it('f6: evaluateGate({stream}) scopes runs, reviews and findings to that stream', () => {
    const ctx = {
      ...base,
      runs: [...greenRuns(6).map(r => ({ ...r, stream: 'a' })), { kind: 'e2e', status: 'green', stream: 'b' }],
      reviews: [review('r1', true, undefined, { stream: 'a' }), review('r2', true, undefined, { stream: 'a' }), review('r3', true, undefined, { stream: 'b' })],
      findings: [{ id: 'x', severity: 'high', status: 'open', stream: 'a' }]
    };
    const fl = { lines: [
      line({ id: 'e2e', source: 'runs.streak:e2e', value: 6 }),
      line({ id: 'clean', source: 'reviews.streak', value: 2 }),
      line({ id: 'open', source: 'findings.open:high', op: 'at_most', value: 0 })
    ] };
    const all = evaluateGate({ finishLine: fl, ...ctx });
    assert.equal(all.lines.find(l => l.id === 'clean').actual, 3);
    const b = evaluateGate({ finishLine: fl, ...ctx, stream: 'b' });
    assert.equal(b.lines.find(l => l.id === 'clean').actual, 1);
    assert.equal(b.lines.find(l => l.id === 'e2e').actual, 1);
    assert.equal(b.lines.find(l => l.id === 'open').actual, 0, "stream a's finding does not count for b");
    assert.equal(b.stream, 'b');
    const a = evaluateGate({ finishLine: fl, ...ctx, stream: 'a' });
    assert.equal(a.lines.find(l => l.id === 'clean').actual, 2);
    assert.equal(a.lines.find(l => l.id === 'open').actual, 1);
  });

  it('f2: an empty line set is not a met gate', () => {
    const g = evaluateGate({ finishLine: { lines: [] }, ...base });
    assert.equal(g.buildGateMet, false);
    assert.equal(g.gateMet, false);
  });

  it('g2: a finish line with no counted build line meets neither gate — nothing was built', () => {
    const fl = { lines: [line({ id: 'dep', type: 'bool', op: 'is', value: true, owner: 'human', source: 'checklist:deployed' })] };
    const g = evaluateGate({ finishLine: fl, ...base, checklist: { deployed: true } });
    assert.equal(g.buildGateMet, false);
    assert.equal(g.gateMet, false, 'gateMet ⇒ buildGateMet holds for every input (AC6)');
    assert.equal(g.lines[0].status, 'met', 'the human line itself is met; the verdicts are not');
  });

  it('g1: validCounts requires exactly high, medium and low as non-negative integers', () => {
    const { validCounts } = streakApi;
    assert.equal(validCounts({ high: 0, medium: 0, low: 0 }), true);
    for (const bad of [{}, { foo: 3 }, { High: 1, Medium: 0, Low: 0 }, { high: 0, medium: 0 }, { high: 0, medium: 0, low: 0, critical: 1 }, { high: 1 }]) {
      assert.equal(validCounts(bad), false, JSON.stringify(bad));
    }
  });

  it('g7: filterByStream attributes a finding to a stream through its review when the row has none', () => {
    const { filterByStream } = gateApi;
    const ctx = {
      reviews: [{ id: 'r1', stream: 'a', pass: false, counts: { high: 1, medium: 0, low: 0 } }],
      findings: [{ id: 'f', review_id: 'r1', severity: 'high', status: 'open' }, { id: 'g', review_id: 'r9', severity: 'high', status: 'open' }],
      runs: []
    };
    const a = filterByStream(ctx, 'a');
    assert.deepEqual(a.findings.map(f => f.id), ['f']);
  });
});

describe('gate — properties', () => {
  const sources = ['runs.streak:e2e', 'runs.streak:unit', 'reviews.streak', 'reviews.latest.high',
    'findings.open:high', 'helpers.over_budget', 'checklist:deployed', 'measure:lh', 'bogus.source'];

  const arbLine = fc.record({
    id: fc.uuid(),
    owner: fc.constantFrom('build', 'human'),
    op: fc.constantFrom('at_least', 'at_most', 'is'),
    type: fc.constantFrom('number', 'percent', 'bool'),
    value: fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
    source: fc.constantFrom(...sources)
  });

  // Counts and measurements deliberately include garbage: missing, null, strings, negatives, floats.
  const arbCounts = fc.oneof(
    fc.record({ high: fc.nat(3), medium: fc.nat(3), low: fc.nat(3) }),
    fc.constant(undefined), fc.constant(null), fc.constant('{"high":1}'),
    fc.record({ high: fc.constantFrom('x', -1, 0.5), medium: fc.nat(3), low: fc.nat(3) })
  );
  const arbMeasure = fc.oneof(fc.nat(100), fc.constant(null), fc.constant(''), fc.constant('42'), fc.constant(NaN));
  const arbCtx = fc.record({
    runs: fc.array(fc.record({ kind: fc.constantFrom('e2e', 'unit'), status: fc.constantFrom('green', 'red') }), { maxLength: 8 }),
    reviews: fc.array(fc.record({ id: fc.uuid(), pass: fc.boolean(), counts: arbCounts }), { maxLength: 5 }),
    findings: fc.array(fc.record({ id: fc.constantFrom('a', 'b', 'c'), severity: fc.constantFrom('high', 'medium', 'low'), status: fc.constantFrom('open', 'fixed') }), { maxLength: 5 }),
    helpers: fc.constant([]),
    measurements: fc.array(fc.record({ key: fc.constant('lh'), value: arbMeasure }), { maxLength: 2 }),
    checklist: fc.option(fc.record({ deployed: fc.oneof(fc.boolean(), fc.constant(1), fc.constant('yes')) }), { nil: {} })
  });

  it('gateMet ⇒ buildGateMet; null never counted; unresolved or ill-typed never met; empty never met', () => {
    fc.assert(fc.property(fc.array(arbLine, { maxLength: 6 }), arbCtx, (lines, ctx) => {
      const g = evaluateGate({ finishLine: { lines }, ...ctx });
      if (g.gateMet) assert.equal(g.buildGateMet, true);
      if (lines.length === 0 || lines.every(l => l.value === null)) {
        assert.equal(g.buildGateMet, false);
        assert.equal(g.gateMet, false);
      }
      for (const l of g.lines) {
        const src = lines.find(x => x.id === l.id);
        if (src.value === null) {
          assert.equal(l.status, 'not_counted');
          assert.ok(!g.failing.includes(l.id) && !g.waitingOnHuman.includes(l.id));
          continue;
        }
        const res = resolveSource(src.source, ctx);
        if (!res.found) assert.notEqual(l.status, 'met');
        if (l.status === 'met') {
          if (src.type === 'bool') assert.equal(typeof l.actual, 'boolean');
          else assert.ok(Number.isFinite(l.actual), `met with non-finite actual ${String(l.actual)}`);
        }
      }
    }), { numRuns: 300 });
  });
});
