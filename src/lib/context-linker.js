/**
 * Smart Connections — Context Linking
 * Links knowledge entities across projects, initiatives, facts, insights, ideas.
 */

import { getDb } from './db.js';

const MAX_RESULTS_PER_TYPE = 4;
const MIN_KEYWORD_LENGTH = 3;
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'been', 'will', 'are', 'was', 'not', 'but']);

function extractKeywords(text, extra = []) {
  const words = text.toLowerCase().split(/[\s\-_.,;:!?()[\]{}'"]+/).filter(Boolean);
  const keywords = words.filter(w => w.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(w));
  for (const kw of extra) {
    if (kw.length >= MIN_KEYWORD_LENGTH) keywords.push(kw.toLowerCase());
  }
  return [...new Set(keywords)];
}

export function findRelevantContext(title, keywords = []) {
  const db = getDb();
  const kws = extractKeywords(title, keywords);

  const result = { projects: [], initiatives: [], facts: [], insights: [], ideas: [] };
  if (kws.length === 0) return result;

  const likeClause = kws.map(() => 'name LIKE ?').join(' OR ');
  const likeParams = kws.map(k => `%${k}%`);

  // Projects
  try {
    result.projects = db.prepare(
      `SELECT id, name, 'project' as type FROM projects WHERE status = 'active' AND (${likeClause}) LIMIT ?`
    ).all([...likeParams, MAX_RESULTS_PER_TYPE]);
  } catch {}

  // Initiatives
  try {
    result.initiatives = db.prepare(
      `SELECT id, name, 'initiative' as type FROM initiatives WHERE status = 'active' AND (${likeClause}) LIMIT ?`
    ).all([...likeParams, MAX_RESULTS_PER_TYPE]);
  } catch {}

  // Facts
  const factLike = kws.map(() => 'content LIKE ?').join(' OR ');
  try {
    result.facts = db.prepare(
      `SELECT id, content, 'fact' as type FROM facts WHERE status = 'active' AND (${factLike}) LIMIT ?`
    ).all([...likeParams, MAX_RESULTS_PER_TYPE]);
  } catch {}

  // Insights
  try {
    result.insights = db.prepare(
      `SELECT id, content, 'insight' as type FROM insights WHERE status = 'active' AND (${factLike}) LIMIT ?`
    ).all([...likeParams, MAX_RESULTS_PER_TYPE]);
  } catch {}

  // Ideas
  try {
    result.ideas = db.prepare(
      `SELECT id, content, 'idea' as type FROM ideas WHERE status != 'archived' AND (${factLike}) LIMIT ?`
    ).all([...likeParams, MAX_RESULTS_PER_TYPE]);
  } catch {}

  return result;
}

export function formatContextForMultiSelect(context) {
  const options = [];
  for (const p of context.projects) options.push({ label: p.name, value: `project:${p.id}`, description: 'Project' });
  for (const i of context.initiatives) options.push({ label: i.name, value: `initiative:${i.id}`, description: 'Initiative' });
  for (const f of context.facts) options.push({ label: f.content?.slice(0, 60), value: `fact:${f.id}`, description: 'Fact' });
  for (const i of context.insights) options.push({ label: i.content?.slice(0, 60), value: `insight:${i.id}`, description: 'Insight' });
  for (const i of context.ideas) options.push({ label: i.content?.slice(0, 60), value: `idea:${i.id}`, description: 'Idea' });
  return options;
}

export function buildActionItemNotes(opts = {}) {
  return JSON.stringify({
    text: opts.text || null,
    linked_facts: opts.linked_facts || [],
    linked_insights: opts.linked_insights || [],
    linked_ideas: opts.linked_ideas || []
  });
}

export function parseActionItemNotes(notes) {
  if (!notes) return { text: null, linked_facts: [], linked_insights: [], linked_ideas: [] };
  try {
    const parsed = JSON.parse(notes);
    return {
      text: parsed.text || null,
      linked_facts: parsed.linked_facts || [],
      linked_insights: parsed.linked_insights || [],
      linked_ideas: parsed.linked_ideas || []
    };
  } catch {
    return { text: notes, linked_facts: [], linked_insights: [], linked_ideas: [] };
  }
}

export default { findRelevantContext, formatContextForMultiSelect, buildActionItemNotes, parseActionItemNotes };
