/**
 * Fibonacci Cascade Engine for Action Items
 */

import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { getFibonacciLimit } from './priority-utils.js';

export function getCountByPriority(priority) {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM action_items WHERE priority = ? AND status = 'active'"
  ).get(priority);
  return row.count;
}

export function getActionItemsByPriority(priority) {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM action_items WHERE priority = ? AND status = 'active' ORDER BY created_at ASC"
  ).all(priority);
}

/**
 * Cascade oldest item at priority down to priority+1.
 * Recursive if next level also exceeds limit.
 */
export function cascadeDown(priority, excludeId) {
  const db = getDb();
  const moved = [];

  const count = getCountByPriority(priority);
  const limit = getFibonacciLimit(priority);

  if (count <= limit) return { moved };

  // Find oldest item at this priority (excluding the one being added)
  let query = "SELECT * FROM action_items WHERE priority = ? AND status = 'active'";
  const params = [priority];
  if (excludeId) {
    query += " AND id != ?";
    params.push(excludeId);
  }
  query += " ORDER BY created_at ASC LIMIT 1";

  const oldest = db.prepare(query).get(...params);
  if (!oldest) return { moved };

  const newPriority = priority + 1;
  db.prepare("UPDATE action_items SET priority = ? WHERE id = ?").run(newPriority, oldest.id);
  moved.push({ id: oldest.id, title: oldest.title, from: priority, to: newPriority });

  // Check if next level now exceeds its limit too (recursive cascade)
  const nextCount = getCountByPriority(newPriority);
  const nextLimit = getFibonacciLimit(newPriority);
  if (nextCount > nextLimit) {
    const deeper = cascadeDown(newPriority);
    moved.push(...deeper.moved);
  }

  return { moved };
}

export function addActionItem(title, priority, opts = {}) {
  const db = getDb();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO action_items (id, title, notes, priority, status, due_date, project_id, initiative_id)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(id, title, opts.notes || null, priority, opts.due_date || null, opts.project_id || null, opts.initiative_id || null);

  // Check cascade
  const cascade = cascadeDown(priority, id);

  const item = db.prepare("SELECT * FROM action_items WHERE id = ?").get(id);
  return { item, cascade };
}

export function moveActionItem(id, newPriority) {
  const db = getDb();
  db.prepare("UPDATE action_items SET priority = ? WHERE id = ?").run(newPriority, id);
  const cascade = cascadeDown(newPriority, id);
  return { cascade };
}

export function completeActionItem(id) {
  const db = getDb();
  db.prepare(
    "UPDATE action_items SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
  ).run(id);
  return db.prepare("SELECT * FROM action_items WHERE id = ?").get(id);
}

export function getActiveActionItems() {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM action_items WHERE status = 'active' ORDER BY priority ASC, created_at ASC"
  ).all();
}

export default {
  getCountByPriority, getActionItemsByPriority, cascadeDown,
  addActionItem, moveActionItem, completeActionItem, getActiveActionItems
};
