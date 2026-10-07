/**
 * Marathon budget guard: decides whether another helper may be spawned,
 * based on the run token budget and the account usage ceiling.
 */

import { foldHelpers } from './store.js';

const isAmount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// A usage reading may be a number or a numeric string; anything else (blank,
// '85%', objects) comes back as NaN so the caller can fail closed.
function parseUsage(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  return Number(value);
}

// Sum what the helpers have cost or may cost, and report the first helper whose
// numbers cannot be trusted. Values are never coerced: '120k' is not a number.
function tally(helpers) {
  let spent = 0;
  let problem = null;
  for (const h of foldHelpers(helpers).values()) {
    if (h.budget !== null && !isAmount(h.budget)) problem ??= `helper ${h.id} has a non-numeric budget`;
    if (h.done) {
      if (!isAmount(h.tokens)) problem ??= `helper ${h.id} has a non-numeric tokens`;
      else spent += h.tokens;
    } else if (!isAmount(h.budget)) {
      problem ??= `helper ${h.id} has a non-numeric budget`;
    } else {
      spent += h.budget;
    }
  }
  return { spent, problem };
}

/**
 * spent = actual tokens of done helpers + stated budgets of in-flight helpers.
 * With no usage reading only the token budget applies and usage_pct is null.
 * Fails closed: a non-numeric usage reading, helper tokens/budget or config
 * limit is never ok, with a reason starting "invalid:".
 */
export function canFanOut({ config, helpers = [], usagePct } = {}) {
  const limit = config.run_token_budget;
  const ceiling = config.ceiling_pct;
  const usage_pct = parseUsage(usagePct);
  const { spent, problem } = tally(helpers);
  const remaining = Number.isFinite(limit) ? Math.max(0, limit - spent) : 0;
  const invalid = (reason) => ({ ok: false, reason: `invalid: ${reason}`, spent, remaining, usage_pct: null });

  if (usage_pct !== null && !Number.isFinite(usage_pct)) return invalid(`usage reading "${usagePct}" is not a number`);
  if (problem) return invalid(problem);
  if (!Number.isFinite(limit) || !Number.isFinite(ceiling)) return invalid('run_token_budget or ceiling_pct is not a number');

  let ok = true;
  let reason = 'ok';
  if (usage_pct !== null && usage_pct >= ceiling) {
    ok = false;
    reason = `ceiling: usage ${usage_pct}% ≥ ${ceiling}%`;
  } else if (spent >= limit) {
    ok = false;
    reason = `budget: spent ${spent} ≥ ${limit}`;
  }

  return { ok, reason, spent, remaining, usage_pct };
}

/**
 * Per-helper token budget: the requested amount (or the default), clamped to the max.
 */
export function helperBudgetFor(config, requested) {
  return Math.min(requested ?? config.helper_budget.default, config.helper_budget.max);
}

/**
 * Folded helpers whose actual tokens exceeded their budget.
 */
export function overBudget(folded) {
  return [...folded.values()].filter(h => h.over_budget);
}
