/**
 * Marathon model routing: which tier builds a step, how a failure escalates,
 * and what the helper ledger says about each tier's cost per green step.
 *
 * Routing is a speed × probability problem. With a contract and failing tests written first,
 * the test run is a near-free error detector, so a cheap builder's miss costs one retry on the
 * next tier — not a review round. Hard work (security, migrations, unknown root cause,
 * cross-cutting) skips the cheap tiers because its errors are the kind tests don't catch.
 *
 * `classifyBuild` is deliberately structural and deterministic (no model, no embedding). A learned
 * router can replace it later behind the same signature; an abstention maps to 'default'.
 */

import { foldHelpers } from './store.js';

export const TIERS = ['haiku', 'sonnet', 'opus', 'session'];

/**
 * Classify a build step from structural signals.
 * @returns {'scoped'|'default'|'hard'}
 */
export function classifyBuild(signals = {}, config) {
  const routing = config?.routing ?? { scoped_max_files: 3, hard_categories: ['security', 'migration'] };
  const hardCategories = routing.hard_categories ?? [];

  if (hardCategories.includes(signals.category)) return 'hard';
  if (signals.rootCauseKnown === false) return 'hard';
  if (signals.crossCutting === true) return 'hard';

  // A missing or non-numeric file count means the scope is not nailed down.
  const files = signals.files;
  if (
    signals.hasContract === true && signals.hasFailingTests === true
    && typeof files === 'number' && Number.isFinite(files)
    && files <= (routing.scoped_max_files ?? 3)
  ) {
    return 'scoped';
  }
  return 'default';
}

/**
 * The configured model for a build class.
 */
export function modelFor(config, cls) {
  const m = config.models;
  if (cls === 'scoped') return m.build_scoped ?? m.build;
  if (cls === 'hard') return m.build_hard ?? m.build;
  return m.build;
}

/**
 * One tier up the ladder, or null at the top (or for a model not on the ladder).
 */
export function nextTier(config, model) {
  const ladder = config?.models?.ladder ?? TIERS;
  const i = ladder.indexOf(model);
  if (i < 0 || i === ladder.length - 1) return null;
  return ladder[i + 1];
}

/**
 * Per-model statistics from the helper ledger rows.
 * first_pass_green_rate and tokens_per_green are null when there is nothing to divide by,
 * so an unmeasured tier is never mistaken for a bad one.
 */
export function modelStats(rows) {
  const folded = foldHelpers(rows);
  const stats = {};
  const bucket = (model) => {
    const key = model ?? 'unknown';
    if (!stats[key]) {
      stats[key] = {
        spawned: 0, done: 0, green: 0, red: 0, escalated: 0, escalations_received: 0,
        tokens_total: 0, tokens_mean: null, first_pass_green_rate: null, tokens_per_green: null
      };
    }
    return stats[key];
  };

  for (const h of folded.values()) {
    const s = bucket(h.model);
    s.spawned += 1;
    if (h.escalated_from) s.escalations_received += 1;
    if (!h.done) continue;
    s.done += 1;
    if (typeof h.tokens === 'number') s.tokens_total += h.tokens;
    if (h.outcome === 'green') s.green += 1;
    else if (h.outcome === 'red') s.red += 1;
    else if (h.outcome === 'escalated') s.escalated += 1;
  }

  for (const s of Object.values(stats)) {
    const graded = s.green + s.red + s.escalated;
    s.tokens_mean = s.done ? s.tokens_total / s.done : null;
    s.first_pass_green_rate = graded ? s.green / graded : null;
    s.tokens_per_green = s.green ? s.tokens_total / s.green : null;
  }
  return stats;
}
