-- The persona-testing connector's tables. Every statement is safe to apply twice.
-- Rows older than 90 days are deleted on the next write. Sizes are bytes of UTF-8.

-- persona_rounds: one row per published round: its guide, and when it was closed (a closed round is never served).
CREATE TABLE IF NOT EXISTS persona_rounds (
  round      INTEGER PRIMARY KEY CHECK (round BETWEEN 1 AND 9999),
  guide      TEXT CHECK (guide IS NULL OR length(CAST(guide AS BLOB)) <= 65536),
  closed_at  TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_briefs (
  walk_id    TEXT PRIMARY KEY CHECK (length(walk_id) BETWEEN 4 AND 100 AND walk_id GLOB 'r[0-9]*-*' AND walk_id NOT GLOB '*[^a-z0-9-]*'),
  round      INTEGER NOT NULL CHECK (round BETWEEN 1 AND 9999),
  body       TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) <= 65536),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS persona_briefs_round ON persona_briefs (round, walk_id);

-- persona_walks: when a walk was started, by the server's clock (start_walk).
CREATE TABLE IF NOT EXISTS persona_walks (
  walk_id    TEXT PRIMARY KEY CHECK (length(walk_id) BETWEEN 4 AND 100),
  started_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_reports (
  walk_id     TEXT NOT NULL CHECK (length(walk_id) BETWEEN 4 AND 100),
  version     INTEGER NOT NULL CHECK (version >= 1),
  body        TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) <= 262144),
  status      TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
  problems    TEXT NOT NULL CHECK (length(problems) <= 262144),
  received_at TEXT NOT NULL,
  started_at  TEXT,
  PRIMARY KEY (walk_id, version)
);
CREATE INDEX IF NOT EXISTS persona_reports_received ON persona_reports (received_at);

CREATE TABLE IF NOT EXISTS persona_questions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  walk_id  TEXT CHECK (walk_id IS NULL OR length(walk_id) BETWEEN 4 AND 100),
  text     TEXT NOT NULL CHECK (length(text) >= 1 AND length(CAST(text AS BLOB)) <= 4096),
  asked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_answers (
  question_id INTEGER PRIMARY KEY REFERENCES persona_questions (id) ON DELETE CASCADE,
  text        TEXT NOT NULL CHECK (length(text) >= 1 AND length(CAST(text AS BLOB)) <= 4096),
  answered_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS persona_answers_answered ON persona_answers (answered_at);

-- persona_notes: the note board. The coding thread posts, the tester reads on every check, the oldest drop past 50.
CREATE TABLE IF NOT EXISTS persona_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round      INTEGER CHECK (round IS NULL OR round BETWEEN 1 AND 9999),
  text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 8000),
  created_at TEXT NOT NULL
);

-- persona_bundles, persona_bundle_briefs: a round posted to the server and kept pending under a random code until
-- publish_round names it. Inert (no tool reads it otherwise), gone after an hour. visitor is a keyed hash, never an address.
CREATE TABLE IF NOT EXISTS persona_bundles (
  code       TEXT PRIMARY KEY CHECK (length(code) = 10),
  round      INTEGER NOT NULL CHECK (round BETWEEN 1 AND 9999),
  guide      TEXT CHECK (guide IS NULL OR length(CAST(guide AS BLOB)) <= 65536),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  visitor    TEXT NOT NULL DEFAULT '',
  bytes      INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0)
);
CREATE INDEX IF NOT EXISTS persona_bundles_expires ON persona_bundles (expires_at);

CREATE TABLE IF NOT EXISTS persona_bundle_briefs (
  code    TEXT NOT NULL REFERENCES persona_bundles (code) ON DELETE CASCADE,
  walk_id TEXT NOT NULL CHECK (length(walk_id) BETWEEN 4 AND 100),
  body    TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) <= 65536),
  PRIMARY KEY (code, walk_id)
);

-- persona_exports: a short-lived code that opens a round's reports once or a few times.
CREATE TABLE IF NOT EXISTS persona_exports (
  code       TEXT PRIMARY KEY CHECK (length(code) = 10),
  round      INTEGER NOT NULL CHECK (round BETWEEN 1 AND 9999),
  reads      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS persona_exports_expires ON persona_exports (expires_at);

-- persona_rate: how many times a visitor (a keyed hash) did something this UTC hour.
CREATE TABLE IF NOT EXISTS persona_rate (
  key  TEXT NOT NULL,
  hour TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, hour)
);
