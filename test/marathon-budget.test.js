/**
 * Tests for src/lib/marathon/budget.js
 * AC 10–12. Property: never ok past either limit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { canFanOut, helperBudgetFor, overBudget } from '../src/lib/marathon/budget.js';
import { foldHelpers } from '../src/lib/marathon/store.js';
import { DEFAULT_CONFIG } from '../src/lib/marathon/config.js';

const cfg = (o = {}) => ({ ...DEFAULT_CONFIG, ...o });

const helpers = [
  { event: 'spawn', id: 'h1', budget: 100, model: 'sonnet' },
  { event: 'done', helper_id: 'h1', tokens: 150 },
  { event: 'spawn', id: 'h2', budget: 200, model: 'opus' } // in flight
];

describe('budget — canFanOut', () => {
  it('ok when under both limits', () => {
    const r = canFanOut({ config: cfg({ run_token_budget: 1000 }), helpers, usagePct: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.usage_pct, 30);
  });

  it('spent = done tokens + in-flight budgets', () => {
    const r = canFanOut({ config: cfg({ run_token_budget: 1000 }), helpers, usagePct: 10 });
    assert.equal(r.spent, 350);
    assert.equal(r.remaining, 650);
  });

  it('AC10: stops at the ceiling, naming it', () => {
    const r = canFanOut({ config: cfg({ run_token_budget: 1000 }), helpers, usagePct: 70 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /ceiling/i);
  });

  it('AC10: stops when spent ≥ run_token_budget, naming it', () => {
    const r = canFanOut({ config: cfg({ run_token_budget: 350 }), helpers, usagePct: 10 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /budget/i);
  });

  it('AC11: with no usage reading only the token budget applies and usage_pct is null', () => {
    const r = canFanOut({ config: cfg({ run_token_budget: 1000 }), helpers });
    assert.equal(r.ok, true);
    assert.equal(r.usage_pct, null);
    const r2 = canFanOut({ config: cfg({ run_token_budget: 100 }), helpers, usagePct: null });
    assert.equal(r2.ok, false);
  });

  it('f4: fails closed on a non-finite usage reading or non-numeric tokens/budgets', () => {
    for (const u of [NaN, '85%', 'abc', Infinity, '']) {
      const r = canFanOut({ config: cfg({ run_token_budget: 1000 }), helpers, usagePct: u });
      assert.equal(r.ok, false, `usagePct=${String(u)}`);
      assert.match(r.reason, /invalid/i);
    }
    const strTokens = [{ event: 'spawn', id: 'h1', budget: 100 }, { event: 'done', helper_id: 'h1', tokens: '25,000,000' }];
    const r1 = canFanOut({ config: cfg({ run_token_budget: 1_000_000 }), helpers: strTokens, usagePct: 10 });
    assert.equal(r1.ok, false); assert.match(r1.reason, /invalid/i);
    const strBudget = [{ event: 'spawn', id: 'h1', budget: '120k' }];
    const r2 = canFanOut({ config: cfg({ run_token_budget: 1_000_000 }), helpers: strBudget, usagePct: 10 });
    assert.equal(r2.ok, false); assert.match(r2.reason, /invalid/i);
    const numericString = canFanOut({ config: cfg({ run_token_budget: 1000 }), helpers, usagePct: '30' });
    assert.equal(numericString.ok, true, 'a numeric string is coerced');
    assert.equal(numericString.usage_pct, 30);
  });

  it('property: never ok when usage ≥ ceiling or spent ≥ budget — including garbage inputs', () => {
    fc.assert(fc.property(
      fc.oneof(fc.integer({ min: 0, max: 100 }), fc.constant(null), fc.constant(undefined), fc.constant(NaN), fc.constant('85%'), fc.constant('30')),
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 1, max: 1_000_000 }),
      fc.array(fc.record({ budget: fc.oneof(fc.nat(300_000), fc.constant('120k')), tokens: fc.oneof(fc.nat(400_000), fc.constant('1,000')), done: fc.boolean() }), { maxLength: 6 }),
      (usagePct, ceiling, budget, hs) => {
        const rows = [];
        hs.forEach((h, i) => {
          rows.push({ event: 'spawn', id: `h${i}`, budget: h.budget });
          if (h.done) rows.push({ event: 'done', helper_id: `h${i}`, tokens: h.tokens });
        });
        const r = canFanOut({ config: cfg({ ceiling_pct: ceiling, run_token_budget: budget }), helpers: rows, usagePct });
        const u = usagePct == null ? null : Number(usagePct);
        const garbage = (u !== null && !Number.isFinite(u)) || hs.some(h => typeof h.budget !== 'number' || (h.done && typeof h.tokens !== 'number'));
        if (garbage) { assert.equal(r.ok, false); return; }
        const pastCeiling = u !== null && u >= ceiling;
        if (pastCeiling || r.spent >= budget) assert.equal(r.ok, false);
        else assert.equal(r.ok, true);
      }
    ), { numRuns: 300 });
  });

  it('property (numeric inputs): spent is exact', () => {
    fc.assert(fc.property(
      fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 1, max: 1_000_000 }),
      fc.array(fc.record({ budget: fc.nat(300_000), tokens: fc.nat(400_000), done: fc.boolean() }), { maxLength: 6 }),
      (usagePct, ceiling, budget, hs) => {
        const rows = [];
        hs.forEach((h, i) => {
          rows.push({ event: 'spawn', id: `h${i}`, budget: h.budget });
          if (h.done) rows.push({ event: 'done', helper_id: `h${i}`, tokens: h.tokens });
        });
        const r = canFanOut({ config: cfg({ ceiling_pct: ceiling, run_token_budget: budget }), helpers: rows, usagePct });
        const pastCeiling = usagePct !== null && usagePct >= ceiling;
        const pastBudget = r.spent >= budget;
        if (pastCeiling || pastBudget) assert.equal(r.ok, false);
        else assert.equal(r.ok, true);
      }
    ), { numRuns: 300 });
  });
});

describe('budget — helper budgets', () => {
  it('AC12: helperBudgetFor defaults and clamps', () => {
    assert.equal(helperBudgetFor(DEFAULT_CONFIG), 150_000);
    assert.equal(helperBudgetFor(DEFAULT_CONFIG, 50_000), 50_000);
    assert.equal(helperBudgetFor(DEFAULT_CONFIG, 999_999), 200_000);
  });

  it('overBudget lists helpers whose actual tokens exceeded their budget', () => {
    const folded = foldHelpers(helpers);
    assert.deepEqual(overBudget(folded).map(h => h.id), ['h1']);
  });
});
