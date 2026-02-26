/**
 * Follow-Up Management
 */

import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export function createFollowUp(input) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO follow_ups (id, content, person, due_date, project_id, status)
     VALUES (?, ?, ?, ?, ?, 'active')`
  ).run(id, input.content, input.person || null, input.due_date || null, input.project_id || null);
  return db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id);
}

export function getFollowUp(id) {
  return getDb().prepare("SELECT * FROM follow_ups WHERE id = ?").get(id);
}

export function getDueFollowUps() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  return db.prepare(
    `SELECT *, CASE WHEN due_date < ? THEN 1 ELSE 0 END as is_overdue
     FROM follow_ups WHERE status = 'active' AND due_date IS NOT NULL AND due_date <= ?
     ORDER BY due_date ASC`
  ).all(today, today);
}

export function getUndatedFollowUpsToSurface() {
  const db = getDb();
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  return db.prepare(
    `SELECT * FROM follow_ups
     WHERE status = 'active' AND due_date IS NULL
     AND (last_surfaced_at IS NULL OR last_surfaced_at < ?)
     ORDER BY created_at ASC`
  ).all(threeDaysAgo);
}

export function getFollowUpsByProject(projectId) {
  return getDb().prepare(
    "SELECT * FROM follow_ups WHERE project_id = ? AND status = 'active' ORDER BY created_at DESC"
  ).all(projectId);
}

export function completeFollowUp(id, outcome) {
  const db = getDb();
  db.prepare(
    "UPDATE follow_ups SET status = 'completed', outcome = ?, completed_at = datetime('now') WHERE id = ?"
  ).run(outcome || null, id);
  return db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id);
}

export function snoozeFollowUp(id, newDueDate) {
  const db = getDb();
  db.prepare("UPDATE follow_ups SET due_date = ? WHERE id = ?").run(newDueDate, id);
  return db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id);
}

export function markSurfaced(id) {
  getDb().prepare("UPDATE follow_ups SET last_surfaced_at = datetime('now') WHERE id = ?").run(id);
}

export function archiveFollowUp(id) {
  const db = getDb();
  db.prepare("UPDATE follow_ups SET status = 'archived' WHERE id = ?").run(id);
  return db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id);
}

export function getAllActiveFollowUps() {
  return getDb().prepare("SELECT * FROM follow_ups WHERE status = 'active' ORDER BY created_at DESC").all();
}

export function getActiveFollowUps() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  return db.prepare(
    `SELECT *, CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END as is_overdue
     FROM follow_ups WHERE status = 'active'
     ORDER BY
       CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 0
            WHEN due_date = ? THEN 1
            WHEN due_date IS NOT NULL THEN 2
            ELSE 3 END,
       due_date ASC`
  ).all(today, today, today);
}

export default {
  createFollowUp, getFollowUp, getDueFollowUps, getUndatedFollowUpsToSurface,
  getFollowUpsByProject, completeFollowUp, snoozeFollowUp, markSurfaced,
  archiveFollowUp, getAllActiveFollowUps, getActiveFollowUps
};
