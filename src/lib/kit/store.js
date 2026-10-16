/**
 * store — where the kit verbs that keep state (reflect lessons, noise-ledger, triage) keep it. A library, not a verb:
 * cli.js discovery skips it (no `verb` export). The verbs never know which store is in use.
 * Built for the suite-db plan (2026-10-16); no foreign code.
 *
 * STORES. JSON files are the default and the fallback: each verb's file, written through ./state-lock.js exactly as
 * before. A project opts into one local SQLite file, `.claude/kit/suite.db` (plus -wal/-shm, git-ignored), with
 * `.claude/kit/store.local.json` `{"store":"sqlite"}` (written by `db init`; git-ignored: the choice is machine-local,
 * a clone without suite.db stays on json); absent = json. An older `.claude/kit/config.json` "store" key is read once
 * and copied to the local file (a "sqlite" there counts only on a machine that has suite.db).
 *
 * ENGINE. `better-sqlite3` when it is installed (resolved from the kit folder, then the project), else Node's built-in
 * `node:sqlite` (`DatabaseSync`, Node 22.5+). Both are loaded lazily, on first use. A project configured for sqlite
 * whose engine cannot load is an error (exit 1) that names the fix; it NEVER falls back to the JSON files (that would
 * split the state in two). `KIT_SQLITE_ENGINE=better-sqlite3|node:sqlite|none` pins the engine (tests, diagnosis).
 *
 * LAYOUT. A verb's document (the JSON it used to write) is split into rows: each collection of the document (an
 * array or an object of items) goes to its own table, one row per item, with the item as JSON in `data` (key order
 * kept) plus a few plain columns for queries; the other top-level fields (version, unknown fields) go to
 * `store_docs.data`. Every row carries the document's SCOPE: the path the verb would have used for the JSON file,
 * relative to the project folder with `/` separators (absolute when outside it). So `triage --state <path>` and
 * `noise-ledger --ledger <path>` keep working: the path is the key of a stream inside the one database.
 * A scope the database does not have yet but whose JSON file exists is read from that file (and stored at the next
 * write), so state written before `db init` is never lost.
 *
 * WRITES. One transaction per verb call, `BEGIN IMMEDIATE` (this replaces state-lock for the sqlite store), with a
 * busy timeout across processes and a promise queue inside one process (so two calls in one process never wait on
 * each other synchronously). WAL journal. Migrations are numbered, run in one transaction, version in `meta`.
 * A write re-reads the store choice inside its lock (the state lock on json, the transaction on sqlite) and, when
 * `db init` / `db off` switched it meanwhile, runs again on the other store, so no committed write is lost.
 *
 * DRIFT. Shared JSON files (lessons.json, noise-ledger.json) can change under the database (a git pull). Each stored
 * document keeps the sha256 of its file as last imported or exported (`store_docs.file_sha256`, 'absent' when there
 * was no file); a read or write of a scope whose file exists with another hash is exit 1 naming the file and the two
 * ways out (`db sync --from-files`, `db export --overwrite`).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { KitExit } from './kit-exit.js';
import { withStateLock, readJsonState, writeJsonAtomic } from './state-lock.js';

/** The machine-local store choice (git-ignored). */
export const CONFIG_FILE = path.join('.claude', 'kit', 'store.local.json');
/** Where the store choice lived before; its "store" key is read once and copied to CONFIG_FILE. */
export const LEGACY_CONFIG_FILE = path.join('.claude', 'kit', 'config.json');
export const CONFIG_GITIGNORE_RULE = '.claude/kit/store.local.json';
export const DB_FILE = path.join('.claude', 'kit', 'suite.db');
export const GITIGNORE_RULES = Object.freeze(['.claude/kit/suite.db', '.claude/kit/suite.db-wal', '.claude/kit/suite.db-shm']);
export const STORES = Object.freeze(['json', 'sqlite']);
export const ENGINES = Object.freeze(['better-sqlite3', 'node:sqlite']);
export const BUSY_TIMEOUT_MS = 15000;
export const ENGINE_FIX = 'install an engine: `npm install better-sqlite3` in the project, or run Node 22.5+ (built-in node:sqlite); or go back to the JSON files with `db off` on a machine that has one';

const invalid = (m) => new KitExit(m, 1);

// ================================================================ schema

/** What each verb's document looks like: its collections and the plain columns kept beside the JSON. */
export const SPECS = Object.freeze({
  lessons: {
    defaultFile: '.claude/kit/lessons.json',
    parts: [{ field: 'lessons', kind: 'array', table: 'lessons', cols: (x) => ({ id: x?.id, role: x?.role, status: x?.status, session: x?.session, created_at: x?.created_at }) }]
  },
  'noise-ledger': {
    defaultFile: '.claude/kit/noise-ledger.json',
    parts: [{ field: 'entries', kind: 'array', table: 'noise_ledger', cols: (x) => ({ id: x?.id, expires: x?.expires }) }]
  },
  triage: {
    defaultFile: '.claude/kit/triage.json',
    // per-stream triage files (marathon streams pass --state) are imported by `db init` too
    extraFiles: async (cwd) => {
      const root = path.join(cwd, '.claude', 'marathon');
      const out = [];
      let runs = [];
      try { runs = await fsp.readdir(root, { withFileTypes: true }); } catch { return out; }
      for (const r of runs.filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        let files = [];
        try { files = await fsp.readdir(path.join(root, r.name)); } catch { continue; }
        for (const f of files.sort()) if (/^triage[^/]*\.json$/.test(f)) out.push(path.join(root, r.name, f));
      }
      return out;
    },
    parts: [
      { field: 'records', kind: 'map', table: 'triage', cols: (x) => ({ scope: x?.scope, rule: x?.rule, status: x?.status }) },
      { field: 'scopes', kind: 'map', table: 'triage_scopes', cols: () => ({}) }
    ]
  }
});

/** Numbered migrations; each runs once, all pending ones in one transaction. Never edit a released one: add the next. */
export const MIGRATIONS = Object.freeze([
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS store_docs (store TEXT NOT NULL, scope TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store, scope));
CREATE TABLE lessons (scope TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT, role TEXT, status TEXT, session TEXT, created_at TEXT, data TEXT NOT NULL, PRIMARY KEY (scope, seq));
CREATE INDEX lessons_role ON lessons (scope, role, status);
CREATE TABLE noise_ledger (scope TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT, expires TEXT, data TEXT NOT NULL, PRIMARY KEY (scope, seq));
CREATE INDEX noise_ledger_id ON noise_ledger (scope, id);
CREATE TABLE triage (stream TEXT NOT NULL, key TEXT NOT NULL, seq INTEGER NOT NULL, scope TEXT, rule TEXT, status TEXT, data TEXT NOT NULL, PRIMARY KEY (stream, key));
CREATE INDEX triage_status ON triage (stream, status);
CREATE TABLE triage_scopes (stream TEXT NOT NULL, key TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (stream, key));
CREATE TABLE test_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, branch TEXT NOT NULL, commit_sha TEXT, source TEXT, started_at TEXT NOT NULL, finished_at TEXT,
  total INTEGER NOT NULL DEFAULT 0, passed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, data TEXT);
CREATE INDEX test_runs_branch ON test_runs (branch, started_at);
CREATE TABLE test_cases (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES test_runs (id) ON DELETE CASCADE, suite TEXT, name TEXT NOT NULL,
  file TEXT, status TEXT NOT NULL, duration_ms INTEGER, message TEXT);
CREATE INDEX test_cases_run ON test_cases (run_id);
CREATE INDEX test_cases_name ON test_cases (suite, name);
`
  },
  {
    // test runs: the run's verdict, and the key of an imported CI report (workflow run id / artifact name) so a report is imported once
    version: 2,
    sql: `
ALTER TABLE test_runs ADD COLUMN status TEXT;
ALTER TABLE test_runs ADD COLUMN run_key TEXT;
CREATE UNIQUE INDEX test_runs_run_key ON test_runs (run_key);
`
  },
  {
    // drift: the sha256 of a document's JSON file as last imported or exported ('absent': no file then; NULL: unknown)
    version: 3,
    sql: `
ALTER TABLE store_docs ADD COLUMN file_sha256 TEXT;
`
  }
]);
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
/** Every table and the column that holds the scope (for status counts and export). */
export const TABLES = Object.freeze(['lessons', 'noise_ledger', 'triage', 'triage_scopes', 'test_runs', 'test_cases']);
const SCOPE_COL = { lessons: 'scope', noise_ledger: 'scope', triage: 'stream', triage_scopes: 'stream' };

// ================================================================ config and engine

/** A config file's JSON object, or null when it does not exist. A broken one is exit 1. */
function readConfigObject(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf-8'); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw invalid(`cannot read ${file}: ${e.code || e.message}`);
  }
  let v;
  try { v = JSON.parse(text.replace(/^﻿/, '')); } catch { throw invalid(`${file} is not valid JSON`); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid(`${file} must be a JSON object like {"store":"json"}`);
  const store = v.store ?? 'json';
  if (!STORES.includes(store)) throw invalid(`${file}: "store" must be "json" or "sqlite" (got ${JSON.stringify(store).slice(0, 40)})`);
  return v;
}

/**
 * The configured store: { store: 'json'|'sqlite', configured: bool, file }. A broken config is exit 1.
 * Read from the machine-local CONFIG_FILE; when it is absent, an older committed LEGACY_CONFIG_FILE "store" key is
 * taken once and copied to CONFIG_FILE, except a "sqlite" on a machine with no suite.db (another clone: json).
 */
export function readConfig(cwd) {
  const file = path.join(cwd, CONFIG_FILE);
  const v = readConfigObject(file);
  if (v) return { store: v.store ?? 'json', configured: true, file, config: v };
  const legacyFile = path.join(cwd, LEGACY_CONFIG_FILE);
  const legacy = readConfigObject(legacyFile);
  if (!legacy || legacy.store === undefined) return { store: 'json', configured: false, file };
  if (legacy.store === 'sqlite' && !fs.existsSync(path.join(cwd, DB_FILE))) return { store: 'json', configured: false, file, legacy_ignored: legacyFile };
  writeFileAtomicSync(file, `${JSON.stringify({ store: legacy.store }, null, 2)}\n`);
  return { store: legacy.store, configured: true, file, config: { store: legacy.store }, migrated_from: legacyFile };
}

function writeFileAtomicSync(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left */ }
    throw invalid(`cannot write ${file}: ${e.code || e.message}`);
  }
}

/** Set the machine-local store choice. */
export async function writeConfig(cwd, store) {
  const file = path.join(cwd, CONFIG_FILE);
  let cur = {};
  try { cur = readConfigObject(file) || {}; } catch { cur = {}; }
  await writeJsonAtomic(file, { ...cur, store });
}

let warningFilterDepth = 0;
/** Load node:sqlite without its one-line ExperimentalWarning on stderr (only that warning is dropped). */
async function importNodeSqlite() {
  const orig = process.emitWarning;
  warningFilterDepth++;
  process.emitWarning = function (w, ...rest) {
    const msg = typeof w === 'string' ? w : w && w.message;
    if (/SQLite is an experimental feature/.test(String(msg))) return;
    return orig.call(this, w, ...rest);
  };
  try { return await import('node:sqlite'); } finally {
    if (--warningFilterDepth === 0) process.emitWarning = orig;
  }
}

const engineCache = new Map();

/** Load an engine: { name, open(file) } or { name: null, errors: [...] }. Lazy, cached per (pin, cwd). */
export async function loadEngine({ cwd = process.cwd(), env = process.env } = {}) {
  const pin = env && env.KIT_SQLITE_ENGINE ? String(env.KIT_SQLITE_ENGINE) : '';
  const key = `${pin}\0${cwd}`;
  if (engineCache.has(key)) return engineCache.get(key);
  const errors = [];
  let found = null;
  if (pin && pin !== 'none' && !ENGINES.includes(pin)) errors.push(`KIT_SQLITE_ENGINE=${pin} is not one of ${ENGINES.join(', ')}, none`);
  const want = pin === 'none' ? [] : pin && ENGINES.includes(pin) ? [pin] : pin ? [] : ENGINES;
  for (const name of want) {
    if (found) break;
    if (name === 'better-sqlite3') {
      for (const base of [import.meta.url, path.join(cwd, 'package.json')]) {
        try {
          const Database = createRequire(base)('better-sqlite3');
          // a native module built for another Node fails only when a database is opened: try one in memory
          new Database(':memory:').close();
          found = { name, open: (file, o = {}) => wrap(new Database(file, o.readOnly ? { readonly: true, fileMustExist: true } : {})) };
          break;
        } catch (e) { if (base === import.meta.url) errors.push(`better-sqlite3: ${String(e && e.message).split('\n')[0]}`); }
      }
    } else {
      try {
        const { DatabaseSync } = await importNodeSqlite();
        if (typeof DatabaseSync !== 'function') throw new Error('no DatabaseSync');
        found = { name, open: (file, o = {}) => wrap(o.readOnly ? new DatabaseSync(file, { readOnly: true }) : new DatabaseSync(file)) };
      } catch (e) { errors.push(`node:sqlite: ${String(e && e.message).split('\n')[0]} (Node ${process.versions.node}; needs 22.5+)`); }
    }
  }
  const res = found || { name: null, errors };
  engineCache.set(key, res);
  return res;
}

/** The common subset of both engines. Parameters: strings, numbers or null. */
function wrap(raw) {
  const fix = (ps) => ps.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));
  const plain = (row) => (row ? { ...row } : row);
  return {
    exec: (sql) => raw.exec(sql),
    run: (sql, ...ps) => raw.prepare(sql).run(...fix(ps)),
    get: (sql, ...ps) => plain(raw.prepare(sql).get(...fix(ps))),
    all: (sql, ...ps) => raw.prepare(sql).all(...fix(ps)).map(plain),
    close: () => raw.close()
  };
}

// ================================================================ context

/**
 * Which store this project uses: { kind: 'json' } or { kind: 'sqlite', engine, dbFile, cwd }.
 * Throws exit 1 (naming the fix) when sqlite is configured and no engine loads, or the database is missing.
 */
export async function resolveStore({ cwd = process.cwd(), env = process.env } = {}) {
  const cfg = readConfig(cwd);
  if (cfg.store !== 'sqlite') return { kind: 'json', cwd };
  const engine = await loadEngine({ cwd, env });
  if (!engine.name) throw invalid(`this project keeps its kit state in SQLite (${cfg.file}) but no SQLite engine loads here (${engine.errors.join('; ') || 'none tried'}): ${ENGINE_FIX}`);
  const dbFile = path.join(cwd, DB_FILE);
  if (!fs.existsSync(dbFile)) throw invalid(`${cfg.file} says "store": "sqlite" but ${dbFile} is missing: restore it, or run \`db init\` to create it again from the JSON files`);
  return { kind: 'sqlite', engine: engine.name, open: engine.open, dbFile, cwd };
}

/** The scope key of a state file: relative to the project with `/`, absolute when outside it. */
export function scopeKey(cwd, file) {
  const abs = path.resolve(cwd, file);
  const rel = path.relative(cwd, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return abs.split(path.sep).join('/');
  return rel.split(path.sep).join('/');
}

const queues = new Map();
/** Run `fn` after every earlier call for the same database in this process has finished. */
function serial(dbFile, fn) {
  const prev = queues.get(dbFile) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  queues.set(dbFile, tail);
  tail.then(() => { if (queues.get(dbFile) === tail) queues.delete(dbFile); });
  return next;
}

/** Open the database, set it up (WAL, busy timeout, foreign keys) and bring the schema up to date. */
export function openDb(ctx) {
  let db;
  try { db = ctx.open(ctx.dbFile); } catch (e) { throw invalid(`cannot open ${ctx.dbFile}: ${String(e && e.message).split('\n')[0]}`); }
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, ctx.dbFile);
  } catch (e) {
    try { db.close(); } catch { /* already failing */ }
    throw e instanceof KitExit ? e : invalid(`cannot set up ${ctx.dbFile}: ${String(e && e.message).split('\n')[0]}`);
  }
  return db;
}

export function schemaVersion(db) {
  const t = db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'");
  if (!t) return 0;
  const row = db.get("SELECT value FROM meta WHERE key = 'schema_version'");
  return row ? Number(row.value) : 0;
}

function migrate(db, file) {
  if (schemaVersion(db) === SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const have = schemaVersion(db);
    if (have > SCHEMA_VERSION) throw invalid(`${file} has schema version ${have}, newer than this kit understands (${SCHEMA_VERSION}); upgrade the kit`);
    for (const m of MIGRATIONS) if (m.version > have) db.exec(m.sql);
    db.run("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", String(SCHEMA_VERSION));
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
    throw e instanceof KitExit ? e : invalid(`cannot migrate ${file}: ${String(e && e.message).split('\n')[0]}`);
  }
}

/** One transaction on the database: `BEGIN IMMEDIATE` for writes, a plain read snapshot otherwise. */
export function withDb(ctx, fn, { write = true } = {}) {
  return serial(ctx.dbFile, async () => {
    const db = openDb(ctx);
    try {
      db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try {
        const r = await fn(db);
        db.exec('COMMIT');
        return r;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    } catch (e) {
      if (e instanceof KitExit) throw e;
      if (/SQLITE_BUSY|database is locked/i.test(String(e && e.message))) throw invalid(`${ctx.dbFile} is locked by another run (waited ${BUSY_TIMEOUT_MS} ms)`);
      throw e;
    } finally { db.close(); }
  });
}

// ================================================================ documents

/** Read one document from the database; null when the scope has none. */
export function getDoc(db, name, scope) {
  const spec = SPECS[name];
  const head = db.get('SELECT data FROM store_docs WHERE store = ? AND scope = ?', name, scope);
  if (!head) return null;
  const { keys, fields } = JSON.parse(head.data);
  const parts = {};
  for (const p of spec.parts) {
    const sc = SCOPE_COL[p.table];
    if (p.kind === 'array') {
      parts[p.field] = db.all(`SELECT data FROM ${p.table} WHERE ${sc} = ? ORDER BY seq`, scope).map((r) => JSON.parse(r.data));
    } else {
      const o = {};
      for (const r of db.all(`SELECT key, data FROM ${p.table} WHERE ${sc} = ? ORDER BY seq`, scope)) o[r.key] = JSON.parse(r.data);
      parts[p.field] = o;
    }
  }
  const doc = {};
  for (const k of keys) doc[k] = Object.hasOwn(parts, k) ? parts[k] : fields[k];
  return doc;
}

/**
 * Replace one document in the database (all its rows). The document must be a JSON object.
 * `fileSha` (a hash, 'absent' or null) sets the file hash it was synced with; left out, an existing row keeps its own.
 */
export function putDoc(db, name, scope, doc, fileSha) {
  const spec = SPECS[name];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw invalid(`${name} state for ${scope} is not a JSON object`);
  const json = JSON.parse(JSON.stringify(doc));
  const keys = Object.keys(json);
  const fields = {};
  for (const k of keys) if (!spec.parts.some((p) => p.field === k)) fields[k] = json[k];
  for (const p of spec.parts) {
    const sc = SCOPE_COL[p.table];
    db.run(`DELETE FROM ${p.table} WHERE ${sc} = ?`, scope);
    const v = json[p.field];
    if (v === undefined) continue;
    if (p.kind === 'array') {
      if (!Array.isArray(v)) throw invalid(`${name} state for ${scope}: ${p.field} is not a list`);
      v.forEach((item, seq) => {
        const cols = p.cols(item);
        const names = Object.keys(cols);
        db.run(`INSERT INTO ${p.table} (${sc}, seq, ${names.join(', ')}, data) VALUES (?, ?, ${names.map(() => '?').join(', ')}, ?)`,
          scope, seq, ...names.map((n) => (cols[n] == null ? null : String(cols[n]))), JSON.stringify(item));
      });
    } else {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid(`${name} state for ${scope}: ${p.field} is not an object`);
      Object.keys(v).forEach((key, seq) => {
        const cols = p.cols(v[key]);
        const names = Object.keys(cols);
        db.run(`INSERT INTO ${p.table} (${sc}, key, seq${names.map((n) => `, ${n}`).join('')}, data) VALUES (?, ?, ?${names.map(() => ', ?').join('')}, ?)`,
          scope, key, seq, ...names.map((n) => (cols[n] == null ? null : String(cols[n]))), JSON.stringify(v[key]));
      });
    }
  }
  if (fileSha === undefined) {
    db.run('INSERT INTO store_docs (store, scope, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (store, scope) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      name, scope, JSON.stringify({ keys, fields }), new Date().toISOString());
  } else {
    db.run('INSERT INTO store_docs (store, scope, data, updated_at, file_sha256) VALUES (?, ?, ?, ?, ?) ON CONFLICT (store, scope) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, file_sha256 = excluded.file_sha256',
      name, scope, JSON.stringify({ keys, fields }), new Date().toISOString(), fileSha);
  }
}

/** Remove one document (all its rows). */
export function deleteDoc(db, name, scope) {
  for (const p of SPECS[name].parts) db.run(`DELETE FROM ${p.table} WHERE ${SCOPE_COL[p.table]} = ?`, scope);
  db.run('DELETE FROM store_docs WHERE store = ? AND scope = ?', name, scope);
}

/** The sha256 of a file's bytes, or 'absent' when it does not exist. */
export function fileHash(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) {
    if (e.code === 'ENOENT') return 'absent';
    throw invalid(`cannot read ${file}: ${e.code || e.message}`);
  }
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Record the hash of a scope's file as it is now (after an import or an export). */
export function setFileHash(db, name, scope, sha) {
  db.run('UPDATE store_docs SET file_sha256 = ? WHERE store = ? AND scope = ?', sha, name, scope);
}

/** The file changed since the database last synced it: { scope, file } or null. A missing file is not drift. */
export function driftOf(db, name, scope, file) {
  const row = db.get('SELECT file_sha256 FROM store_docs WHERE store = ? AND scope = ?', name, scope);
  if (!row || row.file_sha256 == null) return null; // not in the database yet, or synced before hashes were kept
  const now = fileHash(file);
  if (now === 'absent' || now === row.file_sha256) return null;
  return { store: name, scope, file };
}

export const driftMessage = (scope) => `${scope} changed since the database last synced (a git pull?): run \`db sync --from-files\` to take the file, or \`db export --overwrite\` to keep the database`;

function assertNoDrift(db, name, scope, file) {
  const d = driftOf(db, name, scope, file);
  if (d) throw invalid(driftMessage(scope));
}

/** Load for the sqlite store: the database's document, else the JSON file still on disk, else fallback / error. */
async function loadFromDb(db, name, file, scope, opts) {
  const doc = getDoc(db, name, scope);
  if (doc !== null) return doc;
  return readJsonState(file, opts);
}

/** Thrown inside a lock or transaction when the store choice changed since the call resolved it: run again. */
export class StoreSwitched extends Error {}
const SWITCH_RETRIES = 5;

/**
 * Read a verb's document without changing anything: the JSON file (readJsonState semantics: `fallback` when it does
 * not exist, else "<file> does not exist") or the database row set for its scope.
 */
export async function readDoc(io, name, file, opts = {}) {
  const ctx = await resolveStore(ioCtx(io));
  if (ctx.kind === 'json') return readJsonState(file, opts);
  const scope = scopeKey(ctx.cwd, file);
  return withDb(ctx, (db) => {
    assertNoDrift(db, name, scope, file);
    return loadFromDb(db, name, file, scope, opts);
  }, { write: false });
}

/**
 * Read-modify-write a verb's document. `fn({ load, save })`: `load(opts)` reads as readDoc does, `save(doc)` stores it.
 * JSON: under the shared state lock (`lockOpts`), written atomically. SQLite: one BEGIN IMMEDIATE transaction.
 */
export async function updateDoc(io, name, file, fn, lockOpts) {
  for (let attempt = 0; ; attempt++) {
    const ctx = await resolveStore(ioCtx(io));
    try {
      if (ctx.kind === 'json') {
        return await withStateLock(file, () => {
          // `db init` holds this lock until it has switched the store: a writer that waited for it goes to the database
          if (readConfig(ctx.cwd).store !== 'json') throw new StoreSwitched();
          return fn({ load: (opts = {}) => readJsonState(file, opts), save: (doc) => writeJsonAtomic(file, doc) });
        }, lockOpts);
      }
      const scope = scopeKey(ctx.cwd, file);
      return await withDb(ctx, (db) => {
        // `db off` holds the write transaction until it has switched the store: a writer that waited goes to the file
        if (readConfig(ctx.cwd).store !== 'sqlite') throw new StoreSwitched();
        assertNoDrift(db, name, scope, file);
        return fn({
          load: (opts = {}) => loadFromDb(db, name, file, scope, opts),
          save: async (doc) => {
            const known = db.get('SELECT 1 AS x FROM store_docs WHERE store = ? AND scope = ?', name, scope);
            // the first write of a scope read from its file: remember the file it came from
            putDoc(db, name, scope, doc, known ? undefined : fileHash(file));
          }
        });
      });
    } catch (e) {
      if (e instanceof StoreSwitched && attempt < SWITCH_RETRIES) continue;
      if (e instanceof StoreSwitched) throw invalid(`the kit store kept switching while writing ${file}; run the command again`);
      throw e;
    }
  }
}

function ioCtx(io = {}) {
  return { cwd: io.cwd || process.cwd(), env: io.env && Object.keys(io.env).length ? { ...process.env, ...io.env } : process.env };
}

// ================================================================ db verb helpers

/** Row counts of every table. */
export function rowCounts(db) {
  const out = {};
  for (const t of TABLES) out[t] = Number(db.get(`SELECT COUNT(*) AS n FROM ${t}`).n);
  return out;
}

/** Every stored document: [{ store, scope }]. */
export function listDocs(db) {
  return db.all('SELECT store, scope FROM store_docs ORDER BY store, scope');
}

/** The file a scope key stands for. */
export const fileOfScope = (cwd, scope) => (path.isAbsolute(scope) ? scope : path.join(cwd, ...scope.split('/')));

/** The one line `danizee-claude-suite check` prints: { store, engine, ok, fatal, line, fix }. */
export async function storeCheck({ cwd = process.cwd(), env = process.env } = {}) {
  let cfg;
  try { cfg = readConfig(cwd); } catch (e) {
    return { store: null, engine: null, ok: false, fatal: true, line: `kit store: ${e.message}`, fix: `repair or remove ${CONFIG_FILE}` };
  }
  const engine = await loadEngine({ cwd, env });
  if (cfg.store === 'json') {
    return { store: 'json', engine: engine.name, ok: true, fatal: false, line: `kit store: json files${engine.name ? ` (sqlite engine ${engine.name} loads; \`db init\` to switch)` : ' (no sqlite engine loads; json needs none)'}` };
  }
  if (!engine.name) return { store: 'sqlite', engine: null, ok: false, fatal: true, line: `kit store: sqlite, but no engine loads (${engine.errors.join('; ')})`, fix: ENGINE_FIX };
  const dbFile = path.join(cwd, DB_FILE);
  if (!fs.existsSync(dbFile)) return { store: 'sqlite', engine: engine.name, ok: false, fatal: true, line: `kit store: sqlite (${engine.name}), but ${DB_FILE} is missing`, fix: 'restore the file, or run `db init` to create it again from the JSON files' };
  return { store: 'sqlite', engine: engine.name, ok: true, fatal: false, line: `kit store: sqlite ${DB_FILE} (engine ${engine.name} loads)` };
}
