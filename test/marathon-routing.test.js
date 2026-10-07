/**
 * Tests for src/lib/marathon/routing.js + the haiku-first model ladder
 * Routing is a speed × probability problem: with contracts + failing tests the test run is a
 * near-free error detector, so scoped builds start on the cheapest tier and escalate one tier up
 * on red tests — before any review is spent. The ledger measures whether that pays.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { TIERS, classifyBuild, modelFor, nextTier, modelStats } from '../src/lib/marathon/routing.js';
import { foldHelpers } from '../src/lib/marathon/store.js';
import { DEFAULT_CONFIG } from '../src/lib/marathon/config.js';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

describe('routing — config defaults', () => {
  it('models carry the three build tiers, review, routine and the ladder', () => {
    const m = DEFAULT_CONFIG.models;
    assert.equal(m.build_scoped, 'haiku');
    assert.equal(m.build, 'sonnet');
    assert.equal(m.build_hard, 'opus');
    assert.equal(m.review, 'opus');
    assert.equal(m.routine, 'haiku');
    assert.deepEqual(m.ladder, ['haiku', 'sonnet', 'opus', 'session']);
    assert.deepEqual(TIERS, ['haiku', 'sonnet', 'opus', 'session']);
  });

  it('routing signals are configurable', () => {
    assert.equal(DEFAULT_CONFIG.routing.scoped_max_files, 3);
    assert.deepEqual(DEFAULT_CONFIG.routing.hard_categories, ['security', 'migration']);
  });
});

describe('routing — classifyBuild', () => {
  const scoped = { hasContract: true, hasFailingTests: true, files: 2, category: 'correctness' };

  it('scoped = contract + failing tests + few files + not a hard category', () => {
    assert.equal(classifyBuild(scoped, DEFAULT_CONFIG), 'scoped');
  });

  it('hard = security/migration, unknown root cause, or cross-cutting — regardless of scope', () => {
    assert.equal(classifyBuild({ ...scoped, category: 'security' }, DEFAULT_CONFIG), 'hard');
    assert.equal(classifyBuild({ ...scoped, category: 'migration' }, DEFAULT_CONFIG), 'hard');
    assert.equal(classifyBuild({ ...scoped, rootCauseKnown: false }, DEFAULT_CONFIG), 'hard');
    assert.equal(classifyBuild({ ...scoped, crossCutting: true }, DEFAULT_CONFIG), 'hard');
  });

  it('default when the scope is not nailed down — including a missing or non-numeric file count (l4)', () => {
    assert.equal(classifyBuild({ ...scoped, hasFailingTests: false }, DEFAULT_CONFIG), 'default');
    assert.equal(classifyBuild({ ...scoped, hasContract: false }, DEFAULT_CONFIG), 'default');
    assert.equal(classifyBuild({ ...scoped, files: 4 }, DEFAULT_CONFIG), 'default');
    assert.equal(classifyBuild({ ...scoped, files: undefined }, DEFAULT_CONFIG), 'default');
    assert.equal(classifyBuild({ ...scoped, files: 'two' }, DEFAULT_CONFIG), 'default');
    assert.equal(classifyBuild({}, DEFAULT_CONFIG), 'default');
  });

  it('property: a hard signal always wins; scoped never fires without both contract and failing tests', () => {
    fc.assert(fc.property(fc.record({
      hasContract: fc.boolean(), hasFailingTests: fc.boolean(), files: fc.nat(10),
      category: fc.constantFrom('correctness', 'security', 'migration', 'docs'),
      rootCauseKnown: fc.option(fc.boolean(), { nil: undefined }), crossCutting: fc.option(fc.boolean(), { nil: undefined })
    }), (s) => {
      const cls = classifyBuild(s, DEFAULT_CONFIG);
      const hard = ['security', 'migration'].includes(s.category) || s.rootCauseKnown === false || s.crossCutting === true;
      if (hard) assert.equal(cls, 'hard');
      if (cls === 'scoped') assert.ok(s.hasContract && s.hasFailingTests && typeof s.files === 'number' && s.files <= 3);
    }), { numRuns: 300 });
  });
});

describe('routing — modelFor and nextTier', () => {
  it('maps a class to its configured model', () => {
    assert.equal(modelFor(DEFAULT_CONFIG, 'scoped'), 'haiku');
    assert.equal(modelFor(DEFAULT_CONFIG, 'default'), 'sonnet');
    assert.equal(modelFor(DEFAULT_CONFIG, 'hard'), 'opus');
  });

  it('escalates exactly one tier up and stops at the session model', () => {
    assert.equal(nextTier(DEFAULT_CONFIG, 'haiku'), 'sonnet');
    assert.equal(nextTier(DEFAULT_CONFIG, 'sonnet'), 'opus');
    assert.equal(nextTier(DEFAULT_CONFIG, 'opus'), 'session');
    assert.equal(nextTier(DEFAULT_CONFIG, 'session'), null);
    assert.equal(nextTier(DEFAULT_CONFIG, 'unknown-model'), null);
  });

  it('respects a custom ladder', () => {
    const cfg = { ...DEFAULT_CONFIG, models: { ...DEFAULT_CONFIG.models, ladder: ['sonnet', 'opus'] } };
    assert.equal(nextTier(cfg, 'sonnet'), 'opus');
    assert.equal(nextTier(cfg, 'opus'), null);
  });
});

describe('routing — modelStats from the helper ledger', () => {
  const rows = [
    { event: 'spawn', id: 'h1', model: 'haiku', budget: 100, role: 'build' },
    { event: 'done', helper_id: 'h1', tokens: 60, outcome: 'green' },
    { event: 'spawn', id: 'h2', model: 'haiku', budget: 100, role: 'build' },
    { event: 'done', helper_id: 'h2', tokens: 80, outcome: 'red' },
    { event: 'spawn', id: 'h3', model: 'sonnet', budget: 150, role: 'build', escalated_from: 'h2' },
    { event: 'done', helper_id: 'h3', tokens: 140, outcome: 'green' },
    { event: 'spawn', id: 'h4', model: 'opus', budget: 200, role: 'review' },
    { event: 'done', helper_id: 'h4', tokens: 180 },
    { event: 'spawn', id: 'h5', model: 'sonnet', budget: 150, role: 'build' } // in flight
  ];

  it('foldHelpers keeps outcome and escalated_from', () => {
    const f = foldHelpers(rows);
    assert.equal(f.get('h2').outcome, 'red');
    assert.equal(f.get('h3').escalated_from, 'h2');
    assert.equal(f.get('h4').outcome, null);
  });

  it('reports per-model runs, outcomes, tokens and tokens per green', () => {
    const s = modelStats(rows);
    assert.equal(s.haiku.spawned, 2);
    assert.equal(s.haiku.done, 2);
    assert.equal(s.haiku.green, 1);
    assert.equal(s.haiku.red, 1);
    assert.equal(s.haiku.tokens_total, 140);
    assert.equal(s.haiku.tokens_mean, 70);
    assert.equal(s.haiku.first_pass_green_rate, 0.5);
    assert.equal(s.haiku.tokens_per_green, 140);
    assert.equal(s.sonnet.spawned, 2);
    assert.equal(s.sonnet.done, 1);
    assert.equal(s.sonnet.escalations_received, 1);
    assert.equal(s.opus.green, 0);
    assert.equal(s.opus.tokens_per_green, null);
    assert.equal(s.opus.first_pass_green_rate, null, 'no graded outcomes → null, not 0');
  });

  it('is empty for an empty ledger', () => {
    assert.deepEqual(modelStats([]), {});
  });
});

describe('routing — /w-marathon command text', () => {
  const c = getCommands()['w-marathon'].content;

  it('documents the three build tiers and the haiku-first default for scoped work', () => {
    assert.match(c, /build_scoped/);
    assert.match(c, /build_hard/);
    const build = c.slice(c.indexOf('4.3 Build'), c.indexOf('4.4'));
    assert.match(build, /haiku/, 'scoped builds start on haiku');
    assert.match(build, /scoped/i);
    assert.match(build, /hard/i);
  });

  it('escalates one tier up on red tests before any review is spent, and records the outcome', () => {
    assert.match(c, /one tier up/i);
    assert.match(c, /before (any|a) review/i);
    assert.match(c, /outcome=green\|red\|escalated|outcome=/);
    assert.match(c, /cli\.js model-stats/);
  });
});
