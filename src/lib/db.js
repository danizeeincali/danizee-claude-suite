/**
 * SQLite Database for Chief of Staff PM Module
 * Creates and manages the chief-of-staff.db database.
 */

import { createRequire } from 'node:module';

let _db = null;

/**
 * Initialize database with all tables and indexes.
 * Idempotent — safe to call multiple times.
 * @param {string} dbPath - Path to the SQLite database file
 * @returns {import('better-sqlite3').Database}
 */
export function initDatabase(dbPath) {
  let Database;
  try {
    const require = createRequire(import.meta.url);
    Database = require('better-sqlite3');
  } catch {
    throw new Error('better-sqlite3 is required for the PM module. Run: npm install better-sqlite3');
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create all tables
  db.exec(SCHEMA);
  db.exec(INDEXES);

  _db = db;
  return db;
}

/**
 * Get the current database instance.
 * @returns {import('better-sqlite3').Database}
 */
export function getDb() {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.');
  return _db;
}

/**
 * Close the database connection.
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ============================================================
// Schema DDL
// ============================================================

const SCHEMA = `
-- Core Tables
CREATE TABLE IF NOT EXISTS contexts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project TEXT,
  description TEXT,
  last_accessed TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS priorities (
  id TEXT PRIMARY KEY,
  context_id TEXT,
  title TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  context_id TEXT,
  summary TEXT,
  files_touched TEXT,
  next_steps TEXT,
  todays_focus TEXT,
  needs TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  context_id TEXT,
  scheduled_at TEXT,
  attendees TEXT,
  agenda TEXT,
  talking_points TEXT,
  questions TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER,
  type TEXT,
  context_id TEXT,
  meeting_id TEXT,
  session_id TEXT,
  is_private INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE SET NULL,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- Strategic Hierarchy
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',
  target_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS initiatives (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  why TEXT,
  success_criteria TEXT,
  goal_id TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  initiative_id TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_sessions (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, session_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Knowledge Capture
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT,
  verified_at TEXT,
  project_id TEXT,
  initiative_id TEXT,
  goal_id TEXT,
  status TEXT DEFAULT 'active',
  category_id TEXT,
  confidence TEXT DEFAULT 'unknown',
  tags TEXT,
  last_reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE SET NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  domain TEXT,
  source TEXT,
  impact TEXT,
  tags TEXT,
  url TEXT,
  url_summary TEXT,
  context_id TEXT,
  project_id TEXT,
  status TEXT DEFAULT 'active',
  last_surfaced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'active',
  project_id TEXT,
  initiative_id TEXT,
  goal_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE SET NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ramblings (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'raw',
  project_id TEXT,
  initiative_id TEXT,
  goal_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_surfaced_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE SET NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS rambling_versions (
  id TEXT PRIMARY KEY,
  rambling_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  action_items TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (rambling_id) REFERENCES ramblings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT DEFAULT 'text',
  url TEXT,
  tags TEXT,
  source TEXT,
  context_id TEXT,
  project_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  parsed_content TEXT,
  project_id TEXT,
  tags TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Task Management
CREATE TABLE IF NOT EXISTS action_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  priority INTEGER NOT NULL DEFAULT 3,
  status TEXT DEFAULT 'active',
  due_date TEXT,
  project_id TEXT,
  initiative_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS follow_ups (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  person TEXT,
  due_date TEXT,
  project_id TEXT,
  status TEXT DEFAULT 'active',
  outcome TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  last_surfaced_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS deferred_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  context TEXT,
  source_workflow TEXT NOT NULL,
  source_session_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  reasoning TEXT,
  source_insights TEXT DEFAULT '[]',
  source_facts TEXT DEFAULT '[]',
  project_id TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Sharing
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  revoked_at TEXT
);

-- Doc Favorites
CREATE TABLE IF NOT EXISTS doc_favorites (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  favorited_at TEXT DEFAULT (datetime('now'))
);

-- Chronicled Facts & Preferences
CREATE TABLE IF NOT EXISTS chronicled_facts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  evidence TEXT DEFAULT '[]',
  mention_count INTEGER DEFAULT 1,
  project_id TEXT,
  tags TEXT DEFAULT '[]',
  status TEXT DEFAULT 'active',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chronicled_preferences (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  context_scope TEXT NOT NULL DEFAULT 'global',
  confidence REAL NOT NULL DEFAULT 0.5,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  evidence TEXT DEFAULT '[]',
  mention_count INTEGER DEFAULT 1,
  conflicts_with TEXT,
  status TEXT DEFAULT 'active',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ============================================================
// Indexes
// ============================================================

const INDEXES = `
-- Core
CREATE INDEX IF NOT EXISTS idx_priorities_context ON priorities(context_id);
CREATE INDEX IF NOT EXISTS idx_sessions_context ON sessions(context_id);
CREATE INDEX IF NOT EXISTS idx_meetings_context ON meetings(context_id);
CREATE INDEX IF NOT EXISTS idx_contexts_project ON contexts(project);
CREATE INDEX IF NOT EXISTS idx_uploads_context ON uploads(context_id);
CREATE INDEX IF NOT EXISTS idx_uploads_meeting ON uploads(meeting_id);
CREATE INDEX IF NOT EXISTS idx_uploads_session ON uploads(session_id);

-- Strategic hierarchy
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_initiatives_goal ON initiatives(goal_id);
CREATE INDEX IF NOT EXISTS idx_initiatives_status ON initiatives(status);
CREATE INDEX IF NOT EXISTS idx_projects_initiative ON projects(initiative_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Knowledge
CREATE INDEX IF NOT EXISTS idx_insights_context ON insights(context_id);
CREATE INDEX IF NOT EXISTS idx_insights_domain ON insights(domain);
CREATE INDEX IF NOT EXISTS idx_insights_impact ON insights(impact);
CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status);
CREATE INDEX IF NOT EXISTS idx_insights_project ON insights(project_id);
CREATE INDEX IF NOT EXISTS idx_ideas_project ON ideas(project_id);
CREATE INDEX IF NOT EXISTS idx_ideas_initiative ON ideas(initiative_id);
CREATE INDEX IF NOT EXISTS idx_ideas_goal ON ideas(goal_id);
CREATE INDEX IF NOT EXISTS idx_facts_project ON facts(project_id);
CREATE INDEX IF NOT EXISTS idx_facts_initiative ON facts(initiative_id);
CREATE INDEX IF NOT EXISTS idx_facts_goal ON facts(goal_id);
CREATE INDEX IF NOT EXISTS idx_ramblings_status ON ramblings(status);
CREATE INDEX IF NOT EXISTS idx_ramblings_project ON ramblings(project_id);
CREATE INDEX IF NOT EXISTS idx_ramblings_created ON ramblings(created_at);
CREATE INDEX IF NOT EXISTS idx_rambling_versions_rambling ON rambling_versions(rambling_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON knowledge(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_content_type ON knowledge(content_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge(created_at);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);

-- Task management
CREATE INDEX IF NOT EXISTS idx_action_items_priority ON action_items(priority);
CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due_date ON follow_ups(due_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_project ON follow_ups(project_id);
CREATE INDEX IF NOT EXISTS idx_deferred_items_status ON deferred_items(status);
CREATE INDEX IF NOT EXISTS idx_deferred_items_created ON deferred_items(created_at);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_project ON opportunities(project_id);

-- Linking
CREATE INDEX IF NOT EXISTS idx_project_sessions_project ON project_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_project_sessions_session ON project_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_doc_favorites_slug ON doc_favorites(slug);

-- Chronicled
CREATE INDEX IF NOT EXISTS idx_chronicled_facts_status ON chronicled_facts(status);
CREATE INDEX IF NOT EXISTS idx_chronicled_facts_confidence ON chronicled_facts(confidence);
CREATE INDEX IF NOT EXISTS idx_chronicled_facts_project ON chronicled_facts(project_id);
CREATE INDEX IF NOT EXISTS idx_chronicled_facts_source ON chronicled_facts(source_type);
CREATE INDEX IF NOT EXISTS idx_chronicled_preferences_status ON chronicled_preferences(status);
CREATE INDEX IF NOT EXISTS idx_chronicled_preferences_confidence ON chronicled_preferences(confidence);
CREATE INDEX IF NOT EXISTS idx_chronicled_preferences_category ON chronicled_preferences(category);
CREATE INDEX IF NOT EXISTS idx_chronicled_preferences_scope ON chronicled_preferences(context_scope);
`;

export default { initDatabase, getDb, closeDb };
