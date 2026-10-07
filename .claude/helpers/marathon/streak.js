/**
 * Marathon streak helpers: pure functions over run, review and finding rows.
 */

import { foldFindings } from './findings.js';

const SEVERITIES = ['high', 'medium', 'low'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Consecutive green runs of `kind`, counted from the end. Runs of other
 * kinds are ignored; a non-green run of the same kind ends the streak.
 */
export function greenStreak(runs, kind) {
  let n = 0;
  const list = runs ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const run = list[i];
    if (run?.kind !== kind) continue;
    if (run.status !== 'green') break;
    n++;
  }
  return n;
}

/**
 * Consecutive passing reviews, counted from the end.
 */
export function reviewStreak(reviews) {
  let n = 0;
  const list = reviews ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.pass !== true) break;
    n++;
  }
  return n;
}

export function latestReview(reviews) {
  const list = reviews ?? [];
  return list.length ? list[list.length - 1] : null;
}

/**
 * Count open findings by severity. Rows are folded by id first, so a later
 * row ({ id, status: 'fixed' }) closes an earlier open one.
 */
export function openBySeverity(findings) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of foldFindings(findings)) {
    if (f?.status === 'open' && SEVERITIES.includes(f.severity)) counts[f.severity]++;
  }
  return counts;
}

/**
 * True iff counts is a plain object whose keys are exactly high, medium and
 * low (all three, nothing else, case-sensitive) and each value is a finite
 * non-negative integer. `{}`, `{ High: 1, … }`, a missing severity or an extra
 * key such as `critical` are all invalid.
 */
export function validCounts(counts) {
  if (!isPlainObject(counts)) return false;
  const proto = Object.getPrototypeOf(counts);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Object.keys(counts);
  if (keys.length !== SEVERITIES.length) return false;
  return SEVERITIES.every(sev => Object.hasOwn(counts, sev) && isCount(counts[sev]));
}

/**
 * A review passes when each severity count is within tolerance. Fails closed:
 * invalid counts, or a tolerance with none of high/medium/low set, never pass.
 * A missing tolerance key means unlimited for that severity.
 */
export function reviewPasses(counts, tolerance) {
  if (!validCounts(counts)) return false;
  if (!isPlainObject(tolerance)) return false;
  const present = SEVERITIES.filter(sev => tolerance[sev] !== undefined && tolerance[sev] !== null);
  if (present.length === 0) return false;
  return present.every(sev => {
    const limit = tolerance[sev];
    return typeof limit === 'number' && !Number.isNaN(limit) && counts[sev] <= limit;
  });
}
