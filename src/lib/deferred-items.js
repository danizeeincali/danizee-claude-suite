/**
 * Deferred Items — Workflow HITL Deferral
 * Auto-proceeded workflows queue decisions here for later human review.
 */

import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export function createDeferredItem(input) {
  const db = getDb();
  const id = randomUUID();
  const contextJson = input.context ? JSON.stringify(input.context) : null;

  db.prepare(
    `INSERT INTO deferred_items (id, type, content, context, source_workflow, source_session_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  ).run(id, input.type, input.content, contextJson, input.source_workflow, input.source_session_id || null);

  return db.prepare("SELECT * FROM deferred_items WHERE id = ?").get(id);
}

export function getDeferredItem(id) {
  return getDb().prepare("SELECT * FROM deferred_items WHERE id = ?").get(id);
}

export function getPendingDeferredItems() {
  return getDb().prepare(
    "SELECT * FROM deferred_items WHERE status = 'pending' ORDER BY created_at ASC"
  ).all();
}

export function actionDeferredItem(id) {
  const db = getDb();
  db.prepare(
    "UPDATE deferred_items SET status = 'actioned', resolved_at = datetime('now') WHERE id = ?"
  ).run(id);
  return db.prepare("SELECT * FROM deferred_items WHERE id = ?").get(id);
}

export function dismissDeferredItem(id) {
  const db = getDb();
  db.prepare(
    "UPDATE deferred_items SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?"
  ).run(id);
  return db.prepare("SELECT * FROM deferred_items WHERE id = ?").get(id);
}

export default {
  createDeferredItem, getDeferredItem, getPendingDeferredItems,
  actionDeferredItem, dismissDeferredItem
};
