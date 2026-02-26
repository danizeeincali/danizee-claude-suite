/**
 * Insight Management with Surfacing Algorithm
 */

import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export const IMPACT_SCORES = {
  revenue: 10,
  engagement: 8,
  retention: 7,
  acquisition: 5,
  default: 3
};

export function createInsight(input) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO insights (id, content, domain, source, impact, tags, url, url_summary, context_id, project_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    id, input.content, input.domain || null, input.source || null,
    input.impact || null, input.tags ? JSON.stringify(input.tags) : null,
    input.url || null, input.url_summary || null,
    input.context_id || null, input.project_id || null
  );
  return db.prepare("SELECT * FROM insights WHERE id = ?").get(id);
}

export function getInsight(id) {
  return getDb().prepare("SELECT * FROM insights WHERE id = ?").get(id);
}

export function getAllInsights() {
  return getDb().prepare("SELECT * FROM insights WHERE status = 'active' ORDER BY created_at DESC").all();
}

export function getInsightsByFilter(filter) {
  const db = getDb();
  const conditions = ["status = 'active'"];
  const params = [];

  if (filter.domain) { conditions.push('domain = ?'); params.push(filter.domain); }
  if (filter.impact) { conditions.push('impact = ?'); params.push(filter.impact); }
  if (filter.source) { conditions.push('source = ?'); params.push(filter.source); }

  return db.prepare(`SELECT * FROM insights WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`).all(...params);
}

export function updateInsight(id, updates) {
  const db = getDb();
  const fields = [];
  const params = [];
  for (const [key, value] of Object.entries(updates)) {
    if (['content', 'domain', 'source', 'impact', 'url', 'url_summary', 'context_id', 'project_id'].includes(key)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }
  if (fields.length === 0) return getInsight(id);
  params.push(id);
  db.prepare(`UPDATE insights SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getInsight(id);
}

export function deleteInsight(id) {
  return getDb().prepare("DELETE FROM insights WHERE id = ?").run(id).changes > 0;
}

export function archiveInsight(id) {
  getDb().prepare("UPDATE insights SET status = 'archived' WHERE id = ?").run(id);
  return getInsight(id);
}

export function validateInsight(id) {
  getDb().prepare("UPDATE insights SET status = 'validated' WHERE id = ?").run(id);
  return getInsight(id);
}

export function calculateSurfacingScore(insight) {
  const created = new Date(insight.created_at);
  const ageDays = (Date.now() - created.getTime()) / 86400000;
  const impactScore = IMPACT_SCORES[insight.impact] || IMPACT_SCORES.default;
  const lastSurfaced = insight.last_surfaced_at ? new Date(insight.last_surfaced_at) : created;
  const daysSinceSurfaced = (Date.now() - lastSurfaced.getTime()) / 86400000;

  return ageDays * 0.3 + impactScore * 0.5 + daysSinceSurfaced * 0.2;
}

export function getInsightsToSurface(limit = 5) {
  const all = getAllInsights();
  return all
    .map(i => ({ ...i, _score: calculateSurfacingScore(i) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

export function updateLastSurfaced(id) {
  getDb().prepare("UPDATE insights SET last_surfaced_at = datetime('now') WHERE id = ?").run(id);
  return getInsight(id);
}

export function suggestContextForInsight(input) {
  const db = getDb();
  const keywords = (input.content || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (keywords.length === 0) return null;
  const like = keywords.slice(0, 3).map(() => 'name LIKE ?').join(' OR ');
  const params = keywords.slice(0, 3).map(k => `%${k}%`);
  try {
    return db.prepare(`SELECT * FROM contexts WHERE ${like} LIMIT 1`).get(...params) || null;
  } catch { return null; }
}

export default {
  IMPACT_SCORES, createInsight, getInsight, getAllInsights, getInsightsByFilter,
  updateInsight, deleteInsight, archiveInsight, validateInsight,
  calculateSurfacingScore, getInsightsToSurface, updateLastSurfaced, suggestContextForInsight
};
