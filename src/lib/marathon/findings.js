/**
 * Marathon findings: normalization of reviewer rows, recurring-category
 * detection for promotion, and owner-found escapes.
 */

import path from 'path';

const SEVERITIES = ['high', 'medium', 'low'];

function areaOf(file) {
  const norm = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
  const dir = path.posix.dirname(norm);
  if (dir === '.') return '.';
  return dir.split('/').filter(Boolean)[0] ?? '.';
}

/**
 * Normalize a raw finding row: lower-case severity (throws outside
 * high|medium|low), map unknown categories to "other", default status and
 * found_by, and derive `area` from the file's first path segment.
 */
export function normalizeFinding(row, config) {
  const severity = String(row.severity).toLowerCase();
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`invalid severity "${row.severity}" (expected high, medium or low)`);
  }
  const categories = config?.review?.categories ?? [];
  return {
    ...row,
    severity,
    category: categories.includes(row.category) ? row.category : 'other',
    status: row.status ?? 'open',
    found_by: row.found_by ?? 'reviewer',
    area: row.file ? areaOf(row.file) : null
  };
}

const hasValue = (v) => v !== undefined && v !== null;

/**
 * Fold finding rows by id: the latest row per id wins, merged over earlier
 * rows with the same id, so a partial close row ({ id, status: 'fixed', commit })
 * keeps the earlier severity, category and found_by. Order is the first
 * appearance of each id; rows without an id are kept individually.
 */
export function foldFindings(rows) {
  const byId = new Map();
  const out = [];
  for (const row of rows ?? []) {
    if (row === null || typeof row !== 'object') continue;
    if (!hasValue(row.id)) {
      out.push({ ...row });
      continue;
    }
    if (byId.has(row.id)) {
      Object.assign(byId.get(row.id), row);
    } else {
      const folded = { ...row };
      byId.set(row.id, folded);
      out.push(folded);
    }
  }
  return out;
}

/**
 * Categories seen in at least two distinct reviews and not yet promoted.
 * Works over raw rows that carry both a category and a review_id; closing rows
 * without them are ignored, so fixing a finding never erases that it was seen.
 * Deterministic: sorted by category, reviews sorted.
 */
export function seenTwice(findings, promotions = []) {
  const promoted = new Set((promotions ?? []).map(p => p?.category));
  const byCategory = new Map();

  for (const f of findings ?? []) {
    if (!hasValue(f?.category) || !hasValue(f?.review_id)) continue;
    if (!byCategory.has(f.category)) byCategory.set(f.category, { reviews: new Set(), count: 0 });
    const g = byCategory.get(f.category);
    g.count++;
    g.reviews.add(f.review_id);
  }

  const out = [];
  for (const [category, g] of byCategory) {
    if (promoted.has(category) || g.reviews.size < 2) continue;
    out.push({ category, reviews: [...g.reviews].sort(), count: g.count });
  }
  return out.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}

/**
 * Escapes: findings the owner found after review missed them. Status does not
 * matter: a fixed escape is still an escape.
 */
export function escapes(rows) {
  return foldFindings(rows).filter(f => f.found_by === 'owner');
}
