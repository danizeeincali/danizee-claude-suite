/**
 * Quick-Capture Notes with Smart Parsing
 */

import { randomUUID } from 'crypto';
import { getDb } from './db.js';

const TOPIC_KEYWORDS = ['analytics', 'revenue', 'ux', 'design', 'monetization', 'progression',
  'economy', 'performance', 'security', 'infrastructure', 'api', 'database', 'testing',
  'deployment', 'feature', 'bug', 'refactor'];

const ACTION_PATTERNS = [
  /(?:wants?\s+to|needs?\s+to|should|must|start|begin|launch|create|implement|build|fix)\s+\w+/gi
];

const PERSON_PATTERNS = [
  /(?:with|from|told|asked|(?:talk(?:ed|ing)?|spo(?:ke|ken)) to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
];

/**
 * Parse note content for people, topics, project refs, and potential actions.
 */
export function parseNoteContent(content) {
  const people = [];
  const topics = [];
  const potential_actions = [];
  const project_refs = [];

  // Extract people
  for (const pattern of PERSON_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1] && !people.includes(match[1])) people.push(match[1]);
    }
  }

  // Extract topics
  const lower = content.toLowerCase();
  for (const keyword of TOPIC_KEYWORDS) {
    if (lower.includes(keyword)) topics.push(keyword);
  }

  // Extract potential actions
  for (const pattern of ACTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      potential_actions.push(match[0].trim());
    }
  }

  // Match against active projects
  try {
    const db = getDb();
    const projects = db.prepare("SELECT id, name FROM projects WHERE status = 'active'").all();
    for (const project of projects) {
      const projectWords = project.name.toLowerCase().split(/\s+/);
      if (projectWords.some(w => w.length > 3 && lower.includes(w))) {
        project_refs.push(project.name);
      }
    }
  } catch {
    // DB not available — skip project matching
  }

  return { people, topics, project_refs, potential_actions };
}

export function createNote(input) {
  const db = getDb();
  const id = randomUUID();
  const parsed = parseNoteContent(input.content);

  db.prepare(
    `INSERT INTO notes (id, content, parsed_content, project_id, tags, status)
     VALUES (?, ?, ?, ?, ?, 'active')`
  ).run(id, input.content, JSON.stringify(parsed), input.project_id || null, input.tags ? JSON.stringify(input.tags) : null);

  return db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
}

export function getNote(id) {
  return getDb().prepare("SELECT * FROM notes WHERE id = ?").get(id);
}

export function listNotes(limit = 10) {
  return getDb().prepare(
    "SELECT * FROM notes WHERE status = 'active' ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
}

export function deleteNote(id) {
  return getDb().prepare("UPDATE notes SET status = 'archived' WHERE id = ?").run(id).changes > 0;
}

export function searchNotes(query) {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM notes WHERE status = 'active' AND content LIKE ? ORDER BY created_at DESC LIMIT 20"
  ).all(`%${query}%`);
}

export function tagNote(id, newTags) {
  const db = getDb();
  db.prepare("UPDATE notes SET tags = ? WHERE id = ?").run(JSON.stringify(newTags), id);
  return getNote(id);
}

export function linkNoteToProject(id, projectId) {
  const db = getDb();
  db.prepare("UPDATE notes SET project_id = ? WHERE id = ?").run(projectId, id);
  return getNote(id);
}

export function promoteNotePiece(noteId, content, targetType) {
  const db = getDb();
  const id = randomUUID();

  switch (targetType) {
    case 'fact':
      db.prepare("INSERT INTO facts (id, content, status) VALUES (?, ?, 'active')").run(id, content);
      break;
    case 'insight':
      db.prepare("INSERT INTO insights (id, content, status) VALUES (?, ?, 'active')").run(id, content);
      break;
    case 'idea':
      db.prepare("INSERT INTO ideas (id, content, status) VALUES (?, ?, 'active')").run(id, content);
      break;
    case 'action_item':
      db.prepare("INSERT INTO action_items (id, title, priority, status) VALUES (?, ?, 3, 'active')").run(id, content);
      break;
  }

  return { id, type: targetType, content, sourceNoteId: noteId };
}

export default {
  parseNoteContent, createNote, getNote, listNotes, deleteNote,
  searchNotes, tagNote, linkNoteToProject, promoteNotePiece
};
