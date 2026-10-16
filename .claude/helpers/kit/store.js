/**
 * store — the optional local SQLite INDEX of the kit's state. A library, not a verb: cli.js discovery skips it (no
 * `verb` export). Built for the suite-db plan (2026-10-16); no foreign code.
 *
 * SOURCE OF TRUTH. The JSON files (reflect lessons, noise-ledger, triage) are the ONLY source of truth, read and
 * written by the verbs exactly as without an index (./state-lock.js). The index is a rebuildable copy for fast queries
 * and `db status` counts, plus the one thing kept only here: test runs (test_runs / test_cases / imported_reports, see
 * ./test-runs.js; their durable copy is the CI artifact). Losing, moving or copying the index never loses kit state:
 * it is rebuilt from the JSON files.
 *
 * LOCATION. Per user, never in the project: `<base>/<key>/` where <base> is `$DANIZEE_KIT_HOME` (an absolute folder
 * outside the project, else exit 1) or `~/.claude/kit-db`, and <key> the sha256 of the project folder's real path
 * (realpathSync.native of the working folder). The folder (mode 0700, this user's, never a symbolic link) holds
 * `index.db` (plus -wal / -shm) and the per-user setting `enabled.json` that `db init` writes and `db off` removes.
 * Nothing in the project is read to decide: a planted repository file can never enable the index or choose where it is.
 *
 * WRITES. A verb writes its JSON file first (its own code path, under the state lock), then calls indexAfterWrite:
 * best effort, only when the index is enabled; any trouble is one stderr line, never a change to the verb's output or
 * exit code. READS. Verbs read their JSON files. Each time the index is opened (refreshIndex), the file a verb just
 * wrote comes first, then every file it holds whose size, mtime or inode changed (or whose mtime is too close to the
 * recorded read to trust, RACY_MS) is re-read and, when its sha256 differs from the one recorded, re-indexed (a file
 * gone or not valid JSON leaves no rows), then project state files it does not hold yet (a new
 * `.claude/marathon/<run>/triage*.json`) are added, so a git pull, an edit by hand, a write by an older kit or a crash
 * between a file write and its index update heals on a later open. Each file is indexed in its own transaction (a
 * failure keeps what was done before it) with one prepared INSERT. Any path a verb was given (--store, --ledger,
 * --state) is indexed under its real path, inside the project or not: it is only an index.
 *
 * BOUNDED COST. Repository content decides how much there is to index, so every open is bounded: a file over
 * MAX_FILE_BYTES is never read, one with more than MAX_FILE_RECORDS records is not indexed, and one open reads and
 * indexes at most OPEN_BUDGET (bytes and rows) of new or changed files; what does not fit stays as it was (listed by
 * `db status` as pending) and later opens pick it up. The index holds at most MAX_INDEX_ROWS JSON rows per project; a
 * file past it is skipped with that reason. A file skipped after it was read keeps its stat and is not read again until
 * it changes. `.claude/marathon` is listed without following links, at most MAX_MARATHON_FILES files: one beyond the cap
 * is never indexed (dropped when it was). `db init` and `db rebuild` are not limited by the per-open budget.
 *
 * UNTRUSTED FILES. A state file comes from the repository (a pull can put anything there), so the index reads one only
 * as a regular file of at most MAX_FILE_BYTES: lstat first, opened with O_NOFOLLOW | O_NONBLOCK, fstat on the open file,
 * read through it with a byte bound (readState). A symbolic link (in the project, also any folder on its way), a FIFO, a
 * device, a folder, a file too large or unreadable, or one that cannot be indexed (say, nested too deep) is skipped:
 * no rows, recorded with its reason and listed by `db status` (`skipped`). Skipping never changes a verb's output or
 * exit code.
 *
 * ENGINE. `better-sqlite3` only from this suite package's own node_modules (real path checked), else Node's built-in
 * `node:sqlite` (Node 22.13+ / 23.4+). Never anything from the project folder; no git is run. No engine: the index is
 * skipped with a one-line note (`db` subcommands that need it exit 1 naming the fix); the JSON verbs are unaffected.
 * `KIT_SQLITE_ENGINE=better-sqlite3|node:sqlite|none` pins the engine (tests, diagnosis).
 *
 * DEFENCE IN DEPTH. The index file is this user's, but before it is used its sqlite_master must hold exactly the
 * objects the kit's migrations create, with their exact SQL (checkSchema), and `PRAGMA trusted_schema = OFF` is set.
 * An index that fails the check is not used (`db rebuild` replaces it).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire, isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { KitExit } from './kit-exit.js';

/** The environment variable that replaces `~/.claude/kit-db` as the folder of the per-project index folders. */
export const KIT_HOME_ENV = 'DANIZEE_KIT_HOME';
export const DB_NAME = 'index.db';
export const SETTING_NAME = 'enabled.json';
export const ENGINES = Object.freeze(['better-sqlite3', 'node:sqlite']);
export const BUSY_TIMEOUT_MS = 15000;
/** A verb's best-effort index update waits at most this long for another writer of the index. */
export const AFTER_WRITE_BUSY_MS = 2000;
/** A JSON file larger than this is recorded (skipped, with its reason) but never read. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** A JSON file holding more records than this is recorded (skipped, with its reason) but not indexed. */
export const MAX_FILE_RECORDS = 20000;
/**
 * What one open of the index reads and indexes at most for files that are new to it or changed (a verb's own file
 * included): the rest stay as they were (stale or not listed yet), `db status` lists them as pending and later opens
 * pick them up. `db init` and `db rebuild` are not limited by it.
 */
export const OPEN_BUDGET = Object.freeze({ bytes: 16 * 1024 * 1024, rows: 50000 });
/** The JSON rows (lessons, noise_ledger and triage together) one project's index holds at most. */
export const MAX_INDEX_ROWS = 500000;
/** A recorded stat is trusted only when the file's mtime is older than the recorded read by more than this. */
export const RACY_MS = 2000;
export const ENGINE_FIX = 'the kit index needs a SQLite engine on this machine: run Node 22.13+ (built-in node:sqlite; on Node 22.5+ before 22.13 only with --experimental-sqlite), '
  + 'or install the suite package with its optional dependency better-sqlite3 (only the package\'s own copy, in its own node_modules, is ever loaded; never one from the project)';

const invalid = (m) => new KitExit(m, 1);
const firstLine = (e) => String(e && e.message).split('\n')[0].slice(0, 300);

// ================================================================ what is indexed

/** Each kit state file kind: its default file and how its JSON document becomes index rows. */
export const KINDS = Object.freeze({
  lessons: {
    defaultFile: '.claude/kit/lessons.json',
    table: 'lessons',
    cols: ['seq', 'id', 'role', 'status', 'session', 'created_at'],
    rows: (doc) => (Array.isArray(doc?.lessons) ? doc.lessons : []).map((x, seq) => ({ seq, id: x?.id, role: x?.role, status: x?.status, session: x?.session, created_at: x?.created_at, data: x }))
  },
  'noise-ledger': {
    defaultFile: '.claude/kit/noise-ledger.json',
    table: 'noise_ledger',
    cols: ['seq', 'id', 'expires'],
    rows: (doc) => (Array.isArray(doc?.entries) ? doc.entries : []).map((x, seq) => ({ seq, id: x?.id, expires: x?.expires, data: x }))
  },
  triage: {
    defaultFile: '.claude/kit/triage.json',
    table: 'triage',
    cols: ['seq', 'key', 'scope', 'rule', 'status'],
    rows: (doc) => {
      const r = doc?.records;
      if (!r || typeof r !== 'object' || Array.isArray(r)) return [];
      return Object.keys(r).map((key, seq) => ({ seq, key, scope: r[key]?.scope, rule: r[key]?.rule, status: r[key]?.status, data: r[key] }));
    }
  }
});

/** Numbered migrations; each runs once, all pending ones in one transaction. Never edit a released one: add the next. */
export const MIGRATIONS = Object.freeze([
  {
    version: 1,
    sql: `
CREATE TABLE files (file TEXT PRIMARY KEY, kind TEXT NOT NULL, sha256 TEXT NOT NULL, error TEXT, indexed_at TEXT NOT NULL);
CREATE TABLE lessons (file TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT, role TEXT, status TEXT, session TEXT, created_at TEXT, data TEXT NOT NULL, PRIMARY KEY (file, seq));
CREATE INDEX lessons_role ON lessons (role, status);
CREATE TABLE noise_ledger (file TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT, expires TEXT, data TEXT NOT NULL, PRIMARY KEY (file, seq));
CREATE INDEX noise_ledger_id ON noise_ledger (id);
CREATE TABLE triage (file TEXT NOT NULL, key TEXT NOT NULL, seq INTEGER NOT NULL, scope TEXT, rule TEXT, status TEXT, data TEXT NOT NULL, PRIMARY KEY (file, key));
CREATE INDEX triage_status ON triage (status);
CREATE TABLE test_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, branch TEXT NOT NULL, commit_sha TEXT, source TEXT, started_at TEXT NOT NULL, finished_at TEXT,
  total INTEGER NOT NULL DEFAULT 0, passed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, data TEXT,
  status TEXT, run_key TEXT);
CREATE INDEX test_runs_branch ON test_runs (branch, started_at);
CREATE UNIQUE INDEX test_runs_run_key ON test_runs (run_key);
CREATE TABLE test_cases (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES test_runs (id) ON DELETE CASCADE, suite TEXT, name TEXT NOT NULL,
  file TEXT, status TEXT NOT NULL, duration_ms INTEGER, message TEXT);
CREATE INDEX test_cases_run ON test_cases (run_id);
CREATE INDEX test_cases_name ON test_cases (suite, name);
CREATE TABLE imported_reports (run_key TEXT PRIMARY KEY, branch TEXT, imported_at TEXT NOT NULL);
`
  },
  {
    // a file's size, mtime and inode when it was read: an open re-reads (and hashes) only files whose stat changed
    version: 2,
    sql: `
ALTER TABLE files ADD COLUMN stat TEXT;
`
  }
]);
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
export const TABLES = Object.freeze(['files', 'lessons', 'noise_ledger', 'triage', 'test_runs', 'test_cases', 'imported_reports']);

// ================================================================ the per-user folder

const inside = (root, p) => { const rel = path.relative(root, p); return !!rel && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel); };

/** The project folder's real path, in the file system's own spelling: what the index is keyed by. */
export function projectRoot(cwd) {
  try { return fs.realpathSync.native(cwd); } catch (e) { throw invalid(`cannot resolve the project folder ${cwd}: ${e.code || e.message}`); }
}

/** The real path of `p` through its deepest existing folder (the missing rest appended as it is), or null. */
function realThrough(p) {
  let dir = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(dir), ...rest); } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') return null;
      const up = path.dirname(dir);
      if (up === dir) return null;
      rest.unshift(path.basename(dir));
      dir = up;
    }
  }
}

/**
 * The folder of the per-project index folders: `$DANIZEE_KIT_HOME` when set (an absolute path whose real path is not
 * the project folder or inside it, else exit 1), else `~/.claude/kit-db`.
 */
export function kitBase(root, env = process.env) {
  const raw = env && env[KIT_HOME_ENV] ? String(env[KIT_HOME_ENV]) : '';
  if (!raw) return path.join(os.homedir(), '.claude', 'kit-db');
  if (!path.isAbsolute(raw)) throw invalid(`${KIT_HOME_ENV}=${JSON.stringify(raw).slice(0, 200)} is not an absolute path: set it to an absolute folder outside the project (or unset it to use ~/.claude/kit-db)`);
  const base = path.resolve(raw);
  const real = realThrough(base);
  if (!real) throw invalid(`${KIT_HOME_ENV} (${base}) cannot be resolved`);
  if (real === root || inside(root, real)) throw invalid(`${KIT_HOME_ENV} (${base}) is inside the project folder ${root}: the kit index must live outside the project; set it to a folder outside the project`);
  return base;
}

/** The index key of a project: the sha256 of its real path. */
export const projectKey = (root) => crypto.createHash('sha256').update(root).digest('hex');

/** Where this project's index lives: { root, base, key, dir, db, setting }. Nothing is created or read. */
export function indexPaths(cwd, env = process.env) {
  const root = projectRoot(cwd);
  const base = kitBase(root, env);
  const key = projectKey(root);
  const dir = path.join(base, key);
  return { root, base, key, dir, db: path.join(dir, DB_NAME), setting: path.join(dir, SETTING_NAME) };
}

/** Why `dir` is not a private folder of this user, or null (also when it does not exist). */
function dirProblem(dir) {
  let st;
  try { st = fs.lstatSync(dir); } catch (e) { return e.code === 'ENOENT' ? null : `cannot be checked (${e.code || e.message})`; }
  if (st.isSymbolicLink() || !st.isDirectory()) return 'is not a folder (a symbolic link?)';
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return 'belongs to another user';
  return null;
}

/**
 * Whether the index is enabled for this project: { enabled, problem? }. Enabled means the per-user setting is a regular
 * file of this user in private folders of this user. Folders that are not (a link, another user's) are never used:
 * { enabled: false, problem }.
 */
export function indexState(paths) {
  for (const d of [paths.base, paths.dir]) {
    const bad = dirProblem(d);
    if (bad) return { enabled: false, problem: `the kit index folder ${d} ${bad}: not used` };
  }
  let st;
  try { st = fs.lstatSync(paths.setting); } catch { return { enabled: false }; }
  if (!st.isFile() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) return { enabled: false, problem: `${paths.setting} is not a file of this user: not used` };
  return { enabled: true };
}

/** Create the per-user folders (mode 0700) and check them. Exit 1 when they are not private folders of this user. */
export function ensureIndexDir(paths) {
  for (const d of [paths.base, paths.dir]) {
    const before = dirProblem(d);
    if (before) throw invalid(`the kit index folder ${d} ${before}: remove it (or set ${KIT_HOME_ENV} to another folder) and run the command again`);
    try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); } catch (e) { throw invalid(`cannot create the kit index folder ${d}: ${e.code || e.message}`); }
    const bad = dirProblem(d);
    if (bad) throw invalid(`the kit index folder ${d} ${bad}: remove it (or set ${KIT_HOME_ENV} to another folder) and run the command again`);
  }
  try { fs.chmodSync(paths.dir, 0o700); } catch (e) { throw invalid(`cannot make ${paths.dir} private (mode 0700): ${e.code || e.message}`); }
}

/** Write the per-user setting that enables the index (atomically, mode 0600). */
export function writeSetting(paths) {
  ensureIndexDir(paths);
  const tmp = `${paths.setting}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ project: paths.root, enabled_at: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, paths.setting);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left */ }
    throw invalid(`cannot write ${paths.setting}: ${e.code || e.message}`);
  }
}

// ================================================================ engine

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

/**
 * Whether this Node has node:sqlite without a flag: from 22.13 on the 22 line, from 23.4 on, and any later major.
 * 22.5 to 22.12 (and 23.0 to 23.3) have it only behind --experimental-sqlite: usable when that flag is given.
 */
export function nodeSqliteSupport(version = process.versions.node, flags = [...process.execArgv, ...String(process.env.NODE_OPTIONS || '').split(/\s+/)]) {
  const [maj, min] = String(version).split('.').map((x) => Number(x) || 0);
  const unflagged = maj > 23 || (maj === 23 && min >= 4) || (maj === 22 && min >= 13);
  if (unflagged) return { ok: true };
  const flagged = (maj === 22 && min >= 5) || maj === 23;
  if (flagged && flags.includes('--experimental-sqlite')) return { ok: true };
  return { ok: false, why: `node:sqlite: not available on Node ${version} (built in without a flag from Node 22.13+ / 23.4+; on 22.5 to 22.12 only with --experimental-sqlite)` };
}

function wantedEngines(env) {
  const pin = env && env.KIT_SQLITE_ENGINE ? String(env.KIT_SQLITE_ENGINE) : '';
  const errors = [];
  if (pin && pin !== 'none' && !ENGINES.includes(pin)) errors.push(`KIT_SQLITE_ENGINE=${pin} is not one of ${ENGINES.join(', ')}, none`);
  const want = pin === 'none' ? [] : pin && ENGINES.includes(pin) ? [pin] : pin ? [] : ENGINES;
  return { pin, want, errors };
}

/** The root of the npm package the kit runs from (this file at src/lib/kit/store.js), or null (a project's installed copy). */
function kitPackageRoot() {
  let here;
  try { here = path.dirname(fileURLToPath(import.meta.url)); } catch { return null; }
  const up = (p, n) => (n ? up(path.dirname(p), n - 1) : p);
  if (path.basename(here) !== 'kit' || path.basename(up(here, 1)) !== 'lib' || path.basename(up(here, 2)) !== 'src') return null;
  const root = up(here, 3);
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    return pj && pj.name === 'danizee-claude-suite' ? root : null;
  } catch { return null; }
}
const KIT_PACKAGE = kitPackageRoot();

/**
 * The kit package's own better-sqlite3: { file } (its real path) or { why }. Only when the module's real path is inside
 * `<package>/node_modules/`: a copy found by climbing to a parent node_modules (the project's) is never loaded.
 */
function kitBetterSqlite() {
  if (!KIT_PACKAGE) return { why: 'not used by the project\'s installed kit copy (.claude/helpers/kit), which loads only the built-in node:sqlite' };
  let own;
  try { own = path.join(fs.realpathSync.native(KIT_PACKAGE), 'node_modules'); } catch (e) { return { why: `cannot resolve the kit package folder (${e.code || e.message})` }; }
  let file;
  try { file = fs.realpathSync.native(createRequire(path.join(KIT_PACKAGE, 'package.json')).resolve('better-sqlite3')); } catch (e) {
    return { why: firstLine(e).slice(0, 200) };
  }
  if (!inside(own, file)) return { why: `resolved to ${file}, which is not in the kit package's own node_modules (${own}): not loaded` };
  return { file };
}

/** Which engine would load, WITHOUT loading anything (a path lookup and a built-in check). { name, errors }. */
export function probeEngine({ env = process.env } = {}) {
  const { want, errors } = wantedEngines(env);
  for (const name of want) {
    if (name === 'better-sqlite3') {
      const b = kitBetterSqlite();
      if (b.file) return { name, errors };
      errors.push(`better-sqlite3: ${b.why}`);
    } else {
      const sup = nodeSqliteSupport();
      if (!sup.ok) errors.push(sup.why);
      else if (isBuiltin('node:sqlite')) return { name, errors };
      else errors.push(`node:sqlite: not built in (Node ${process.versions.node}; needs 22.13+)`);
    }
  }
  return { name: null, errors };
}

/** Load an engine: { name, open(file) } or { name: null, errors }. Lazy, cached per pin. Never code from the project. */
export async function loadEngine({ env = process.env } = {}) {
  const { pin, want, errors } = wantedEngines(env);
  if (engineCache.has(pin)) return engineCache.get(pin);
  let found = null;
  for (const name of want) {
    if (found) break;
    if (name === 'better-sqlite3') {
      const b = kitBetterSqlite();
      if (!b.file) { errors.push(`better-sqlite3: ${b.why}`); continue; }
      try {
        const Database = createRequire(path.join(KIT_PACKAGE, 'package.json'))(b.file);
        new Database(':memory:').close(); // a module built for another Node fails only when a database opens
        found = { name, open: (file) => wrap(new Database(file)) };
      } catch (e) { errors.push(`better-sqlite3: ${firstLine(e)}`); }
    } else {
      const sup = nodeSqliteSupport();
      if (!sup.ok) { errors.push(sup.why); continue; }
      try {
        const { DatabaseSync } = await importNodeSqlite();
        if (typeof DatabaseSync !== 'function') throw new Error('no DatabaseSync');
        found = { name, open: (file) => wrap(new DatabaseSync(file)) };
      } catch (e) { errors.push(`node:sqlite: ${firstLine(e)} (Node ${process.versions.node}; needs 22.13+)`); }
    }
  }
  const res = found || { name: null, errors };
  engineCache.set(pin, res);
  return res;
}

/** The common subset of both engines. Parameters: strings, numbers or null. */
function wrap(raw) {
  const fix = (ps) => ps.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));
  const plain = (row) => (row ? { ...row } : row);
  return {
    exec: (sql) => raw.exec(sql),
    run: (sql, ...ps) => raw.prepare(sql).run(...fix(ps)),
    prepare: (sql) => { const st = raw.prepare(sql); return { run: (...ps) => st.run(...fix(ps)) }; },
    get: (sql, ...ps) => plain(raw.prepare(sql).get(...fix(ps))),
    all: (sql, ...ps) => raw.prepare(sql).all(...fix(ps)).map(plain),
    close: () => raw.close()
  };
}

// ================================================================ schema check (defence in depth)

/** A refusal of an index file the kit did not make (or that is not a database). */
const untrusted = (m) => Object.assign(invalid(m), { untrusted: true });

const referenceCache = new WeakMap();
function referenceSchema(open) {
  if (referenceCache.has(open)) return referenceCache.get(open);
  const known = new Map();
  const db = open(':memory:');
  try {
    const snap = () => {
      for (const r of db.all('SELECT type, name, tbl_name, sql FROM sqlite_master')) {
        const k = `${r.type}\0${r.name}`;
        if (!known.has(k)) known.set(k, { tbl: r.tbl_name, sqls: new Set() });
        known.get(k).sqls.add(r.sql ?? null);
      }
    };
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    snap();
    for (const m of MIGRATIONS) { db.exec(m.sql); snap(); }
  } finally { db.close(); }
  referenceCache.set(open, known);
  return known;
}

/**
 * Every object in sqlite_master must be one the kit's migrations create, with exactly the kit's SQL: a trigger, a
 * view, a virtual table, a sqlite_stat table (the kit never runs ANALYZE) or any unknown object is exit 1 naming it.
 * Reading sqlite_master evaluates nothing.
 */
export function checkSchema(db, open, file) {
  const known = referenceSchema(open);
  for (const r of db.all('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid')) {
    const ref = known.get(`${r.type}\0${r.name}`);
    const what = `${r.type} ${JSON.stringify(String(r.name).slice(0, 80))}`;
    if (!ref || ref.tbl !== r.tbl_name || !ref.sqls.has(r.sql ?? null)) {
      throw untrusted(`${file} holds ${ref ? `a ${what} that differs from` : `a ${what} that is not in`} the kit's own schema, so the kit did not make it: `
        + 'not used (nothing was read from it); `db rebuild` replaces it with a new index built from the JSON files');
    }
  }
}

/** Set up a freshly opened connection: trusted_schema off, then the schema check. */
export function guardDb(db, open, file) {
  try { db.exec('PRAGMA trusted_schema = OFF'); } catch { /* an engine without the pragma: the schema check still runs */ }
  checkSchema(db, open, file);
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
    if (have > SCHEMA_VERSION) throw untrusted(`${file} has schema version ${have}, newer than this kit understands (${SCHEMA_VERSION}); upgrade the kit, or \`db rebuild\` replaces it`);
    for (const m of MIGRATIONS) if (m.version > have) db.exec(m.sql);
    db.run("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", String(SCHEMA_VERSION));
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
    throw e instanceof KitExit ? e : invalid(`cannot migrate ${file}: ${firstLine(e)}`);
  }
}

// ================================================================ indexing JSON files

/** The key a state file is indexed under: its real path (through its deepest existing folder). */
export function fileKey(file) {
  return realThrough(file) || path.resolve(file);
}

/** At most this many `.claude/marathon/<run>/triage*.json` files are indexed (in run and file name order). */
export const MAX_MARATHON_FILES = 200;
/** Recorded in files.sha256 for a file that was skipped: a link, not a regular file, too large, too many records, unreadable. */
export const SKIPPED = 'skipped';

const statKey = (st) => `${st.size}:${st.mtimeNs}:${st.ino}`;
const skip = (reason) => ({ skip: reason });

/**
 * Read one file, never through a link and never more than `max` bytes (default MAX_FILE_BYTES):
 * { absent } | { skip: reason } | { unchanged } (its size, mtime and inode are `known`) | { deferred } (`allow(size)`
 * said no: not read) | { buf, stat }. Inside `root` no folder on the way may be a symbolic link either. Opened with
 * O_NOFOLLOW | O_NONBLOCK (a FIFO never blocks), checked with fstat as a regular file. Never throws.
 */
export function readState(file, { root = null, known = null, max = MAX_FILE_BYTES, allow = null } = {}) {
  try {
    if (root && inside(root, file)) {
      const parts = path.relative(root, file).split(path.sep);
      let p = root;
      for (const part of parts.slice(0, -1)) {
        p = path.join(p, part);
        let st;
        try { st = fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { absent: true }; return skip(`cannot be checked (${e.code || 'error'})`); }
        if (st.isSymbolicLink()) return skip(`a folder on its path (${path.relative(root, p)}) is a symbolic link`);
        if (!st.isDirectory()) return { absent: true };
      }
    }
    let st;
    try { st = fs.lstatSync(file, { bigint: true }); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { absent: true };
      return skip(`cannot be checked (${e.code || 'error'})`);
    }
    if (st.isSymbolicLink()) return skip('a symbolic link');
    if (!st.isFile()) return skip('not a regular file');
    if (st.size > BigInt(max)) return skip(`larger than ${max} bytes`);
    if (known && statKey(st) === known) return { unchanged: true };
    if (allow && !allow(Number(st.size))) return { deferred: true };
    let fd;
    // O_NONBLOCK: a file swapped for a FIFO after the lstat never blocks the open
    try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)); } catch (e) {
      return skip(e.code === 'ELOOP' ? 'a symbolic link' : `cannot be read (${e.code || 'error'})`);
    }
    try {
      const fst = fs.fstatSync(fd, { bigint: true });
      if (!fst.isFile()) return skip('not a regular file');
      if (fst.size > BigInt(max)) return skip(`larger than ${max} bytes`);
      const buf = Buffer.alloc(Number(fst.size) + 1);
      let n = 0;
      for (;;) {
        const k = fs.readSync(fd, buf, n, buf.length - n, null);
        if (k === 0) break;
        n += k;
        if (n >= buf.length) break;
      }
      if (n > max || n > Number(fst.size)) return skip(`grew while it was read (or larger than ${max} bytes)`);
      return { buf: buf.subarray(0, n), stat: statKey(fst) };
    } finally { fs.closeSync(fd); }
  } catch (e) {
    return skip(`cannot be read (${e.code || firstLine(e).slice(0, 80)})`);
  }
}

const shaOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Parse a state file's bytes as the verbs do (a leading BOM skipped): { doc } or { error }. */
function parseState(buf) {
  if (buf.length > MAX_FILE_BYTES) return { error: `larger than ${MAX_FILE_BYTES} bytes` };
  let b = buf;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    const doc = JSON.parse(b.toString('utf-8'));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? { doc } : { error: 'not a JSON object' };
  } catch { return { error: 'not valid JSON' }; }
}

/** Delete one file's rows; returns how many there were. */
const dropRows = (db, key) => { let n = 0; for (const k of Object.values(KINDS)) n += Number(db.run(`DELETE FROM ${k.table} WHERE file = ?`, key).changes || 0); return n; };
const countRows = (db, key) => Object.values(KINDS).reduce((n, k) => n + Number(db.get(`SELECT COUNT(*) AS n FROM ${k.table} WHERE file = ?`, key).n), 0);
const totalRows = (db) => Number(db.get(`SELECT ${Object.values(KINDS).map((k) => `(SELECT COUNT(*) FROM ${k.table})`).join(' + ')} AS n`).n);
const recordFile = (db, key, kind, sha, error, stat) => db.run(
  'INSERT INTO files (file, kind, sha256, error, indexed_at, stat) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (file) DO UPDATE SET kind = excluded.kind, sha256 = excluded.sha256, error = excluded.error, indexed_at = excluded.indexed_at, stat = excluded.stat',
  key, kind, sha, error ?? null, new Date().toISOString(), stat ?? null);

/** The reason a file is not indexed when the project's index is full. */
export const fullReason = (max) => `not indexed: the index holds at most ${max} rows per project (db rebuild retries)`;

/**
 * One open's indexing state: what it read and indexed so far against its budget (null: no budget), the files it left
 * for later (`pending`), and the project's row cap. `limits` (tests only) can lower the budget and the cap, never raise them.
 */
export function indexRun({ budget = OPEN_BUDGET, limits = null } = {}) {
  const low = (v, d) => (Number.isSafeInteger(v) && v > 0 ? Math.min(v, d) : d);
  const l = limits || {};
  return {
    budget: budget ? { bytes: low(l.bytes, budget.bytes), rows: low(l.rows, budget.rows) } : null,
    maxRows: low(l.maxRows, MAX_INDEX_ROWS),
    bytes: 0, rows: 0, full: false, total: null, pending: [], found: null
  };
}

/** Whether `run` may read `size` more bytes. The first read of an open always may (a file is at most MAX_FILE_BYTES). */
const fitsBytes = (run, size) => !run || !run.budget || (!run.full && (run.bytes === 0 || run.bytes + size <= run.budget.bytes));
const defer = (run, key) => { if (!run.pending.includes(key)) run.pending.push(key); return false; };

/**
 * Replace the rows of one file (by its key) with what `state` (readState) holds and record it. A file that is skipped,
 * absent, not valid JSON, holds more than MAX_FILE_RECORDS records, does not fit the project's row cap, or cannot be
 * indexed (say, nested too deep) leaves no rows; it is recorded with its reason. One prepared INSERT per file.
 * Never throws for the file's content. Returns false only when `run`'s row budget left it for a later open.
 */
export function indexFile(db, kind, key, state = readState(key), run = null) {
  const spec = KINDS[kind];
  if (state.skip) { dropRows(db, key); recordFile(db, key, kind, SKIPPED, state.skip, null); return true; }
  if (state.absent) { dropRows(db, key); recordFile(db, key, kind, 'absent', null, null); return true; }
  const { doc, error } = parseState(state.buf);
  const sha = shaOf(state.buf);
  // a file skipped after it was read keeps its stat: it is not read again until it changes
  const skipRead = (reason) => { if (run && run.total !== null) run.total -= dropRows(db, key); else dropRows(db, key); recordFile(db, key, kind, SKIPPED, reason, state.stat ? `${state.stat}:${SKIPPED}` : null); return true; };
  try {
    const rows = doc ? spec.rows(doc) : [];
    if (rows.length > MAX_FILE_RECORDS) return skipRead(`more than ${MAX_FILE_RECORDS} records`);
    if (run && run.budget && run.rows > 0 && run.rows + rows.length > run.budget.rows) { run.full = true; return defer(run, key); }
    const maxRows = run ? run.maxRows : MAX_INDEX_ROWS;
    if (run && run.total === null) run.total = totalRows(db);
    const others = (run ? run.total : totalRows(db)) - countRows(db, key);
    if (others + rows.length > maxRows) return skipRead(fullReason(maxRows));
    dropRows(db, key);
    if (rows.length) {
      const ins = db.prepare(`INSERT OR REPLACE INTO ${spec.table} (file, ${spec.cols.join(', ')}, data) VALUES (?, ${spec.cols.map(() => '?').join(', ')}, ?)`);
      for (const r of rows) {
        ins.run(key, ...spec.cols.map((n) => (r[n] == null ? null : typeof r[n] === 'number' ? r[n] : String(r[n]))), JSON.stringify(r.data ?? null));
      }
    }
    if (run) { run.rows += rows.length; run.total = others + rows.length; }
    recordFile(db, key, kind, sha, error, state.stat ? `${state.stat}:${sha}` : null);
    return true;
  } catch (e) {
    if (/SQLITE_BUSY|database is locked|SQLITE_FULL|SQLITE_IOERR|disk I\/O/i.test(firstLine(e))) throw e;
    if (run) run.total = null;
    dropRows(db, key);
    recordFile(db, key, kind, SKIPPED, `cannot be indexed (${firstLine(e).slice(0, 120)})`, null);
    return true;
  }
}

/**
 * The recorded stat of a files row (`<size>:<mtimeNs>:<inode>`, recorded as `<stat>:<sha256 or skipped>`), when it
 * can be trusted: recorded with the current hash, and the file's mtime older than the recorded read by more than
 * RACY_MS (a rewrite in the same timestamp tick as the read would otherwise keep the same stat). Else null: re-read.
 */
function trustedStat(row) {
  if (!row || !row.stat) return null;
  const tail = `:${row.sha256}`;
  if (row.sha256 === 'absent' || !row.stat.endsWith(tail)) return null;
  const st = row.stat.slice(0, -tail.length);
  const readAt = Date.parse(row.indexed_at);
  let mtimeMs;
  try { mtimeMs = Number(BigInt(st.split(':')[1]) / 1000000n); } catch { return null; }
  if (!Number.isFinite(readAt) || mtimeMs >= readAt - RACY_MS) return null;
  return st;
}

/**
 * Bring one file's rows up to date: skipped when its size, mtime and inode are the ones recorded (see trustedStat),
 * else read and re-indexed when its hash, kind or state changed. A read that does not fit `run`'s budget is left for a
 * later open (listed in run.pending). `key` is the indexed path (see fileKey). True when re-indexed.
 */
export function ensureKey(db, kind, key, root = null, run = null) {
  const row = db.get('SELECT kind, sha256, error, stat, indexed_at FROM files WHERE file = ?', key);
  const same = row && row.kind === kind;
  const state = readState(key, { root, known: same ? trustedStat(row) : null, allow: run ? (n) => fitsBytes(run, n) : null });
  if (state.unchanged) return false;
  if (state.deferred) return defer(run, key);
  if (state.buf && run) run.bytes += state.buf.length;
  if (same) {
    if (state.skip && row.sha256 === SKIPPED && row.error === state.skip) return false;
    if (state.absent && row.sha256 === 'absent') return false;
    if (state.buf && row.sha256 === shaOf(state.buf)) {
      // the same content: record the stat (and when it was read) so the next open need not read it
      db.run('UPDATE files SET stat = ?, indexed_at = ? WHERE file = ?', `${state.stat}:${row.sha256}`, new Date().toISOString(), key);
      return false;
    }
  }
  return indexFile(db, kind, key, state, run);
}

/** A folder's entries, only when the folder itself is a real folder (never through a symbolic link); else []. */
function listNoLink(dir) {
  try {
    if (!fs.lstatSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch { return []; }
}

/**
 * The project's own state files, as keys under the project's real path `root`: each kind's default file and the
 * per-stream triage files `.claude/marathon/<run>/triage*.json` (no symbolic link is followed: a linked .claude,
 * marathon or run folder, or a linked file, is not listed; at most MAX_MARATHON_FILES). The list carries `omitted`:
 * the marathon files left out by the cap (their keys), never indexed.
 */
export function projectFiles(root) {
  const out = Object.entries(KINDS).map(([kind, k]) => ({ kind, file: path.join(root, ...k.defaultFile.split('/')), project: true }));
  out.omitted = new Set();
  if (!listNoLink(path.join(root, '.claude')).some((d) => d.name === 'marathon' && d.isDirectory())) return out;
  const marathon = path.join(root, '.claude', 'marathon');
  let n = 0;
  for (const r of listNoLink(marathon).filter((d) => d.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const files = listNoLink(path.join(marathon, r.name)).filter((d) => d.isFile() && /^triage[^/]*\.json$/.test(d.name)).map((d) => d.name).sort();
    for (const f of files) {
      const file = path.join(marathon, r.name, f);
      if (n >= MAX_MARATHON_FILES) { out.omitted.add(file); continue; }
      out.push({ kind: 'triage', file, project: true });
      n++;
    }
  }
  return out;
}

/** Run `fn` in its own BEGIN IMMEDIATE transaction (one file's update): committed, or rolled back and rethrown. */
export function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

/**
 * Bring the index up to date with the files, each file in its own transaction (a failure keeps what was done before
 * it): first `first` (the file a verb just wrote: [{ kind, file }]), then every recorded file (a marathon file beyond
 * the cap, or of an unknown kind, is dropped), then the project files it does not hold yet. Within `run`'s budget: what
 * does not fit is left for a later open (run.pending). Returns `run`, with run.found = projectFiles(root).
 */
export function refreshIndex(db, root, run, { first = [] } = {}) {
  const found = projectFiles(root);
  run.found = found;
  for (const f of first) {
    const key = fileKey(f.file);
    if (!found.omitted.has(key)) inTransaction(db, () => ensureKey(db, f.kind, key, root, run));
  }
  const recorded = db.all('SELECT file, kind FROM files ORDER BY file');
  for (const r of recorded) {
    if (!Object.hasOwn(KINDS, r.kind) || found.omitted.has(r.file)) {
      inTransaction(db, () => { if (run.total !== null) run.total -= dropRows(db, r.file); else dropRows(db, r.file); db.run('DELETE FROM files WHERE file = ?', r.file); });
      continue;
    }
    inTransaction(db, () => ensureKey(db, r.kind, r.file, root, run));
  }
  const known = new Set(recorded.map((r) => r.file));
  for (const f of found) if (!known.has(f.file)) inTransaction(db, () => ensureKey(db, f.kind, f.file, root, run));
  inTransaction(db, () => db.run("INSERT INTO meta (key, value) VALUES ('project_files_indexed', ?) ON CONFLICT (key) DO NOTHING", new Date().toISOString()));
  return run;
}

// ================================================================ opening the index

const queues = new Map();
/** Run `fn` after every earlier call for the same index in this process has finished. */
function serial(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return next;
}

/** The context of an io object: { cwd, env }. */
export function ioCtx(io = {}) {
  return { cwd: io.cwd || process.cwd(), env: io.env && Object.keys(io.env).length ? { ...process.env, ...io.env } : process.env };
}

/** Open the index file (created when missing), check it and bring its schema up to date: { db }. */
export function openDb(engine, paths, { busyMs = BUSY_TIMEOUT_MS } = {}) {
  ensureIndexDir(paths);
  let db;
  try { db = engine.open(paths.db); } catch (e) { throw untrusted(`cannot open ${paths.db}: ${firstLine(e)}; \`db rebuild\` replaces it`); }
  try {
    db.exec(`PRAGMA busy_timeout = ${busyMs}`);
    guardDb(db, engine.open, paths.db);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, paths.db);
  } catch (e) {
    try { db.close(); } catch { /* already failing */ }
    if (e instanceof KitExit) throw e;
    if (/SQLITE_BUSY|database is locked/i.test(firstLine(e))) throw invalid(`${paths.db} is locked by another run (waited ${busyMs} ms)`);
    // not a database at all (a truncated or overwritten file): the same way out as an untrusted one
    throw untrusted(`cannot use ${paths.db}: ${firstLine(e)}; \`db rebuild\` replaces it with a new index built from the JSON files`);
  }
  try { fs.chmodSync(paths.db, 0o600); } catch { /* best effort */ }
  return { db };
}

/**
 * Open the project's index and run `fn(db, { paths, engine, cwd, env, run })` in one BEGIN IMMEDIATE transaction
 * (`transaction: false`: fn manages its own, see inTransaction). Before that, unless `refresh: false`, the index is
 * brought up to date with the files (refreshIndex: `first` before anything else, then every file whose size, mtime or
 * inode changed, then new project files; each in its own transaction, within OPEN_BUDGET: `run.pending` lists what was
 * left for a later open). `enabling: true` (db init) opens it before the setting exists. `io.indexLimits` (tests only)
 * can lower the budget and the row cap.
 * Exit 1: the index is off (naming `db init`), no engine (naming the fix), an index the kit did not make.
 */
export async function withIndex(io, fn, { busyMs = BUSY_TIMEOUT_MS, paths: given, refresh = true, enabling = false, first = [], transaction = true, budget = OPEN_BUDGET } = {}) {
  const { cwd, env } = ioCtx(io);
  const paths = given || indexPaths(cwd, env);
  const st = indexState(paths);
  if (st.problem || (!st.enabled && !enabling)) throw invalid(st.problem || 'the kit index is off for this project: run `db init` first');
  const engine = await loadEngine({ env });
  if (!engine.name) throw invalid(`no SQLite engine loads here (${engine.errors.join('; ') || 'none tried'}): ${ENGINE_FIX}`);
  return serial(paths.db, async () => {
    const { db } = openDb(engine, paths, { busyMs });
    try {
      const run = indexRun({ budget, limits: io && io.indexLimits });
      if (refresh) refreshIndex(db, paths.root, run, { first });
      const ctx = { paths, engine: engine.name, cwd, env, run };
      if (!transaction) return await fn(db, ctx);
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = await fn(db, ctx);
        db.exec('COMMIT');
        return r;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    } catch (e) {
      if (e instanceof KitExit) throw e;
      if (/SQLITE_BUSY|database is locked/i.test(firstLine(e))) throw invalid(`${paths.db} is locked by another run (waited ${busyMs} ms)`);
      throw e;
    } finally { db.close(); }
  });
}

/**
 * The index paths when the index can be on for this project, else null: a DANIZEE_KIT_HOME that is not usable
 * (relative, inside the project) means no setting can exist, so the index is off. `db` subcommands report it.
 */
export function quietPaths(cwd, env) {
  try { return indexPaths(cwd, env); } catch { return null; }
}

/**
 * After a verb wrote `file` (its JSON, under the state lock): update the index when it is enabled. Best effort: any
 * trouble is one stderr line and is never thrown, so the verb's output and exit code are as without an index.
 */
export async function indexAfterWrite(io, kind, file) {
  try {
    const { cwd, env } = ioCtx(io);
    // a DANIZEE_KIT_HOME that cannot hold a setting: the index was never enabled, nothing to say (db status says why)
    const paths = quietPaths(cwd, env);
    if (!paths) return;
    const st = indexState(paths);
    if (!st.enabled) {
      // a folder problem only matters when a setting is there to be ignored (the index was enabled); else silence
      if (st.problem && settingSeen(paths)) throw new Error(st.problem);
      return;
    }
    // the written file first, then at most the open's budget of other changed or new files (the rest: later opens)
    await withIndex(io, () => {}, { busyMs: AFTER_WRITE_BUSY_MS, paths, first: [{ kind, file }] });
  } catch (e) {
    try { process.stderr.write(`kit index: not updated (${firstLine(e)}); the JSON file is written and stays the source of truth\n`); } catch { /* nowhere to say it */ }
  }
}

/** Whether something is at the setting's path (followed through links, only to tell the user it is not used). */
function settingSeen(paths) {
  try { fs.statSync(paths.setting); return true; } catch { return false; }
}

/** `promise.then(indexed(io, kind, file))`: the verb's result, after a best-effort index update (indexAfterWrite). */
export const indexed = (io, kind, file) => async (result) => { await indexAfterWrite(io, kind, file); return result; };

/** Row counts of every table. */
export function rowCounts(db) {
  const out = {};
  for (const t of TABLES) out[t] = Number(db.get(`SELECT COUNT(*) AS n FROM ${t}`).n);
  return out;
}

/** The one info line `danizee-claude-suite check` prints: { on, engine, line }. Never fatal; nothing is loaded. */
export function indexCheck({ cwd = process.cwd(), env = process.env } = {}) {
  let on = false;
  let note = '';
  try {
    const st = indexState(indexPaths(cwd, env));
    on = st.enabled;
    if (st.problem) note = `; ${st.problem}`;
  } catch (e) { note = `; ${firstLine(e)}`; }
  const probe = probeEngine({ env });
  return { on, engine: probe.name, line: `kit index: ${on ? 'on' : 'off'} (${probe.name ? `engine ${probe.name}` : 'no SQLite engine'}${note}; optional, the JSON files are the source of truth)` };
}
