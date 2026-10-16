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
 * MAX_FILE_BYTES (a `.claude/marathon` file: MAX_MARATHON_FILE_BYTES) is never read, one with more than
 * MAX_FILE_RECORDS records is not indexed, and one open reads and indexes at most OPEN_BUDGET (bytes and rows) of new
 * or changed files; what does not fit stays as it was (listed by `db status` as pending, and kept in the pending table)
 * and later opens take the pending files first, oldest first, so none waits forever. The index holds at most
 * MAX_INDEX_ROWS JSON rows and MAX_INDEX_BYTES of JSON files per project, and the index file itself at most
 * MAX_INDEX_DISK_BYTES (its pages in use, test runs included); a file past any of them is skipped with that reason.
 * Rows name their file by a small integer id (files.id), never by its path, and indexed columns hold at most
 * MAX_COLUMN_BYTES of a value. A file skipped after it was read keeps its stat and
 * is not read again until it changes, except one skipped because the index file was full: after `db prune` frees room
 * the next open reads it again (retryDiskFull). Test runs take at most their own share of the index file
 * (./test-runs.js TEST_RUNS_MAX_BYTES), so the JSON state files always have the rest. A file whose recorded stat cannot be trusted (its mtime too close to the read, or
 * in the future) is hashed once per open and, unchanged, costs the budget nothing. `.claude/marathon` is listed without
 * following links, read once and bounded (MARATHON_SCAN), at most MAX_MARATHON_FILES files: one beyond a bound is never
 * indexed (dropped when it was). `db init` and `db rebuild` are not limited by the per-open budget.
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
/** The same for a `.claude/marathon/<run>/` file (any number of them can arrive with a pull): smaller. */
export const MAX_MARATHON_FILE_BYTES = 1024 * 1024;
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
/** The JSON one project's index holds at most, counted as the sizes of the files it indexes. */
export const MAX_INDEX_BYTES = 256 * 1024 * 1024;
/**
 * The index file itself (its pages in use: PRAGMA page_count less freelist_count, times page_size, test runs included)
 * holds at most this much per project: a file whose rows would take it past (estimated as INDEX_COST per JSON byte and
 * per row, an upper bound of what its rows, columns and index entries take) is skipped with that reason. Pages freed by
 * deleted rows are reused before the file grows, so the file on disk stays near this size.
 */
export const MAX_INDEX_DISK_BYTES = 512 * 1024 * 1024;
/** The estimate of what indexing a file adds to the index file: bytes per JSON byte, plus bytes per row. */
export const INDEX_COST = Object.freeze({ perByte: 5, perRow: 160 });
/**
 * An indexed column (id, role, status, key, scope, rule, ...) holds at most this many bytes of its value: the index is
 * for queries and counts, never a second copy of a large value in a B-tree (the record itself stays whole in `data`
 * and in the JSON file). A longer value is cut and ends with `…#<sha256 of the whole value>`, so two long keys never collide.
 */
export const MAX_COLUMN_BYTES = 1024;
/**
 * A recorded stat is trusted only when the file's mtime is older than the recorded read by more than this. A file whose
 * mtime is later than that (a rewrite in the same timestamp tick as the read, or a mtime in the future: an extracted
 * archive, rsync -t, a skewed clock) is hashed once per open, and when its hash is the one recorded it counts as clean:
 * not re-indexed and not charged to the open's budget.
 */
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
  },
  {
    // the bytes of each indexed file (the per-project byte cap), and the files an open left for later, oldest first
    version: 3,
    sql: `
ALTER TABLE files ADD COLUMN bytes INTEGER;
CREATE TABLE pending (file TEXT PRIMARY KEY, kind TEXT NOT NULL, since TEXT NOT NULL);
`
  },
  {
    // rows name their file by a small integer id (files.id), never by its path: a path repeated in every row (and in
    // each table's primary key index) made the index hundreds of times larger than the JSON files. Existing rows are
    // rewritten with their file's id (through temp tables, so the main schema holds only the final objects).
    version: 4,
    sql: `
CREATE TEMP TABLE m4_files AS SELECT rowid AS id, file, kind, sha256, error, indexed_at, stat, bytes FROM files;
CREATE TEMP TABLE m4_lessons AS SELECT f.rowid AS file_id, l.seq, l.id, l.role, l.status, l.session, l.created_at, l.data FROM lessons l JOIN files f ON f.file = l.file;
CREATE TEMP TABLE m4_noise_ledger AS SELECT f.rowid AS file_id, n.seq, n.id, n.expires, n.data FROM noise_ledger n JOIN files f ON f.file = n.file;
CREATE TEMP TABLE m4_triage AS SELECT f.rowid AS file_id, t.key, t.seq, t.scope, t.rule, t.status, t.data FROM triage t JOIN files f ON f.file = t.file;
DROP TABLE lessons;
DROP TABLE noise_ledger;
DROP TABLE triage;
DROP TABLE files;
CREATE TABLE files (id INTEGER PRIMARY KEY, file TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, sha256 TEXT NOT NULL, error TEXT, indexed_at TEXT NOT NULL, stat TEXT, bytes INTEGER);
CREATE TABLE lessons (file_id INTEGER NOT NULL, seq INTEGER NOT NULL, id TEXT, role TEXT, status TEXT, session TEXT, created_at TEXT, data TEXT NOT NULL, PRIMARY KEY (file_id, seq));
CREATE INDEX lessons_role ON lessons (role, status);
CREATE TABLE noise_ledger (file_id INTEGER NOT NULL, seq INTEGER NOT NULL, id TEXT, expires TEXT, data TEXT NOT NULL, PRIMARY KEY (file_id, seq));
CREATE INDEX noise_ledger_id ON noise_ledger (id);
CREATE TABLE triage (file_id INTEGER NOT NULL, key TEXT NOT NULL, seq INTEGER NOT NULL, scope TEXT, rule TEXT, status TEXT, data TEXT NOT NULL, PRIMARY KEY (file_id, key));
CREATE INDEX triage_status ON triage (status);
INSERT INTO files (id, file, kind, sha256, error, indexed_at, stat, bytes) SELECT id, file, kind, sha256, error, indexed_at, stat, bytes FROM temp.m4_files;
INSERT INTO lessons (file_id, seq, id, role, status, session, created_at, data) SELECT file_id, seq, id, role, status, session, created_at, data FROM temp.m4_lessons;
INSERT INTO noise_ledger (file_id, seq, id, expires, data) SELECT file_id, seq, id, expires, data FROM temp.m4_noise_ledger;
INSERT INTO triage (file_id, key, seq, scope, rule, status, data) SELECT file_id, key, seq, scope, rule, status, data FROM temp.m4_triage;
DROP TABLE temp.m4_files;
DROP TABLE temp.m4_lessons;
DROP TABLE temp.m4_noise_ledger;
DROP TABLE temp.m4_triage;
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
/**
 * Listing `.claude/marathon` reads at most this many of its entries (the run folders, in the order the file system
 * gives them; the ones read are then sorted), and at most MARATHON_SCAN.runEntries entries of the run folders in all.
 * Run folders after the MAX_MARATHON_FILES-th triage file are not read at all.
 */
export const MARATHON_SCAN = Object.freeze({ entries: 2000, runEntries: 20000 });
/** Recorded in files.sha256 for a file that was skipped: a link, not a regular file, too large, too many records, unreadable. */
export const SKIPPED = 'skipped';

const statKey = (st) => `${st.size}:${st.mtimeNs}:${st.ino}`;
const skip = (reason) => ({ skip: reason });
const MARATHON_FILE = /^triage[^/]*\.json$/;

/**
 * Read one file, never through a link and never more than `max` bytes (default MAX_FILE_BYTES):
 * { absent } | { skip: reason } | { unchanged } (its size, mtime and inode are `known`) | { deferred } (`allow(size,
 * stat)` said no: not read) | { buf, stat }. Inside `root` no folder on the way may be a symbolic link either. Opened
 * with O_NOFOLLOW | O_NONBLOCK (a FIFO never blocks), checked with fstat as a regular file. Never throws.
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
    if (allow && !allow(Number(st.size), statKey(st))) return { deferred: true };
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

/** An indexed column's value: at most MAX_COLUMN_BYTES (see there). */
function columnValue(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (s.length * 3 <= MAX_COLUMN_BYTES || Buffer.byteLength(s, 'utf-8') <= MAX_COLUMN_BYTES) return s;
  const tail = `…#${crypto.createHash('sha256').update(s).digest('hex')}`;
  let t = Buffer.from(s, 'utf-8').subarray(0, MAX_COLUMN_BYTES - Buffer.byteLength(tail, 'utf-8')).toString('utf-8');
  if (t.endsWith('�')) t = t.slice(0, -1);
  return t + tail;
}

/** The id rows name a file by (files.id), or null when the file has no files row. */
const fileId = (db, key) => { const r = db.get('SELECT id FROM files WHERE file = ?', key); return r ? Number(r.id) : null; };
/** Delete one file's rows; returns how many there were. */
const dropRows = (db, key) => {
  const id = fileId(db, key);
  if (id === null) return 0;
  let n = 0;
  for (const k of Object.values(KINDS)) n += Number(db.run(`DELETE FROM ${k.table} WHERE file_id = ?`, id).changes || 0);
  return n;
};
const countRows = (db, key) => {
  const id = fileId(db, key);
  return id === null ? 0 : Object.values(KINDS).reduce((n, k) => n + Number(db.get(`SELECT COUNT(*) AS n FROM ${k.table} WHERE file_id = ?`, id).n), 0);
};
const totalRows = (db) => Number(db.get(`SELECT ${Object.values(KINDS).map((k) => `(SELECT COUNT(*) FROM ${k.table})`).join(' + ')} AS n`).n);
/** The bytes of every indexed file but `key`. */
const otherBytes = (db, key) => Number(db.get('SELECT COALESCE(SUM(bytes), 0) AS n FROM files WHERE file <> ? AND bytes IS NOT NULL', key).n);
const recordFile = (db, key, kind, sha, error, stat, bytes = null) => db.run(
  'INSERT INTO files (file, kind, sha256, error, indexed_at, stat, bytes) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (file) DO UPDATE SET kind = excluded.kind, sha256 = excluded.sha256, error = excluded.error, indexed_at = excluded.indexed_at, stat = excluded.stat, bytes = excluded.bytes',
  key, kind, sha, error ?? null, new Date().toISOString(), stat ?? null, bytes);

/** The reason a file is not indexed when the project's index is full. */
export const fullReason = (max) => `not indexed: the index holds at most ${max} rows per project (db rebuild retries)`;
/** The reason a file is not indexed when the project's index holds its byte cap of JSON. */
export const bytesFullReason = (max) => `not indexed: the index holds at most ${max} bytes of JSON files per project (db rebuild retries)`;
/** The reason a file is not indexed when its rows would take the index file past MAX_INDEX_DISK_BYTES. */
export const diskFullReason = (max) => `not indexed: the index file holds at most ${max} bytes per project (db prune --keep <n> makes room taken by test runs and the next open after it retries; db rebuild retries every file)`;
/** The start of diskFullReason: `db prune` lets the files skipped for it be read again (see retryDiskFull). */
export const DISK_FULL_PREFIX = 'not indexed: the index file holds at most ';

/**
 * Let the next open retry every file skipped because the index file was full (diskFullReason): their recorded stat is
 * cleared, so they are read again (within the open's budget) and indexed if they fit now. `db prune` calls it after
 * freeing pages; no rebuild is needed. Returns how many files will be retried.
 */
export function retryDiskFull(db) {
  return Number(db.run("UPDATE files SET stat = NULL WHERE sha256 = ? AND substr(error, 1, ?) = ?", SKIPPED, DISK_FULL_PREFIX.length, DISK_FULL_PREFIX).changes);
}

/** The bytes of the index file's pages in use (free pages, which later writes reuse first, not counted). */
export function indexUsedBytes(db) {
  const n = (p) => Number(Object.values(db.get(`PRAGMA ${p}`) || {})[0] || 0);
  return (n('page_count') - n('freelist_count')) * n('page_size');
}

/**
 * One open's indexing state: what it read and indexed so far against its budget (null: no budget), the files it left
 * for later (`pending`), and the project's row and byte caps. `limits` (tests only) can lower the budget and the caps,
 * never raise them.
 */
export function indexRun({ budget = OPEN_BUDGET, limits = null } = {}) {
  const low = (v, d) => (Number.isSafeInteger(v) && v > 0 ? Math.min(v, d) : d);
  const l = limits || {};
  return {
    budget: budget ? { bytes: low(l.bytes, budget.bytes), rows: low(l.rows, budget.rows) } : null,
    maxRows: low(l.maxRows, MAX_INDEX_ROWS),
    maxBytes: low(l.maxBytes, MAX_INDEX_BYTES),
    maxDisk: low(l.maxDiskBytes, MAX_INDEX_DISK_BYTES),
    marathon: { files: low(l.marathonFiles, MAX_MARATHON_FILES), entries: low(l.marathonEntries, MARATHON_SCAN.entries), runEntries: low(l.marathonRunEntries, MARATHON_SCAN.runEntries) },
    bytes: 0, rows: 0, full: false, total: null, pending: [], found: null
  };
}

/** Whether `run` may read `size` more bytes. The first read of an open always may (a file is at most MAX_FILE_BYTES). */
const fitsBytes = (run, size) => !run || !run.budget || (!run.full && (run.bytes === 0 || run.bytes + size <= run.budget.bytes));
const defer = (run, key) => { if (!run.pending.includes(key)) run.pending.push(key); return false; };

/** Drop `n` rows from the open's running total (when it has one). */
const lower = (run, n) => { if (run && run.total !== null) run.total -= n; };

/**
 * Replace the rows of one file (by its key) with what `state` (readState) holds and record it. A file that is skipped,
 * absent, not valid JSON, holds more than MAX_FILE_RECORDS records, does not fit the project's row or byte cap, or
 * cannot be indexed (say, nested too deep) leaves no rows; it is recorded with its reason. Indexed columns are cut to
 * MAX_COLUMN_BYTES. One prepared INSERT per file. Never throws for the file's content. Returns false only when `run`'s
 * row budget left it for a later open.
 */
export function indexFile(db, kind, key, state = readState(key), run = null) {
  const spec = KINDS[kind];
  if (state.skip) { lower(run, dropRows(db, key)); recordFile(db, key, kind, SKIPPED, state.skip, null); return true; }
  if (state.absent) { lower(run, dropRows(db, key)); recordFile(db, key, kind, 'absent', null, null); return true; }
  const { doc, error } = parseState(state.buf);
  const sha = state.sha || shaOf(state.buf);
  // a file skipped after it was read keeps its stat (and the hash of what was read): not read again until it changes
  const skipRead = (reason) => { lower(run, dropRows(db, key)); recordFile(db, key, kind, SKIPPED, reason, state.stat ? `${state.stat}:${SKIPPED}:${sha}` : null); return true; };
  try {
    const rows = doc ? spec.rows(doc) : [];
    if (rows.length > MAX_FILE_RECORDS) return skipRead(`more than ${MAX_FILE_RECORDS} records`);
    if (run && run.budget && run.rows > 0 && run.rows + rows.length > run.budget.rows) { run.full = true; return defer(run, key); }
    const maxRows = run ? run.maxRows : MAX_INDEX_ROWS;
    const maxBytes = run ? run.maxBytes : MAX_INDEX_BYTES;
    // what counts against the byte cap: the size of a file that gives rows
    const size = rows.length ? state.buf.length : 0;
    if (size && otherBytes(db, key) + size > maxBytes) return skipRead(bytesFullReason(maxBytes));
    if (run && run.total === null) run.total = totalRows(db);
    const others = (run ? run.total : totalRows(db)) - countRows(db, key);
    if (others + rows.length > maxRows) return skipRead(fullReason(maxRows));
    dropRows(db, key);
    if (run) run.total = others;
    // what the index file itself may hold: its pages in use (the file's old rows dropped) and an upper bound of the new rows
    const maxDisk = run ? run.maxDisk : MAX_INDEX_DISK_BYTES;
    if (rows.length && indexUsedBytes(db) + INDEX_COST.perByte * state.buf.length + INDEX_COST.perRow * rows.length > maxDisk) return skipRead(diskFullReason(maxDisk));
    // the files row first: rows name their file by its id
    recordFile(db, key, kind, sha, error, state.stat ? `${state.stat}:${sha}:${sha}` : null, size);
    if (rows.length) {
      const id = fileId(db, key);
      const ins = db.prepare(`INSERT OR REPLACE INTO ${spec.table} (file_id, ${spec.cols.join(', ')}, data) VALUES (?, ${spec.cols.map(() => '?').join(', ')}, ?)`);
      for (const r of rows) ins.run(id, ...spec.cols.map((n) => columnValue(r[n])), JSON.stringify(r.data ?? null));
    }
    if (run) { run.rows += rows.length; run.total = others + rows.length; }
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
 * What a files row says about the read it was recorded from: { stat, readSha, mtimeMs } (stat `<size>:<mtimeNs>:<inode>`,
 * recorded as `<stat>:<sha256 or skipped>:<sha256 of the bytes read>`), only when recorded together with the row's
 * current sha256 column; else null.
 */
function recordedRead(row) {
  if (!row || !row.stat || row.sha256 === 'absent') return null;
  const p = String(row.stat).split(':');
  if (p.length !== 5 || p[3] !== row.sha256 || !/^[0-9a-f]{64}$/.test(p[4])) return null;
  let mtimeMs;
  try { mtimeMs = Number(BigInt(p[1]) / 1000000n); } catch { return null; }
  return { stat: p.slice(0, 3).join(':'), readSha: p[4], mtimeMs };
}

/**
 * The recorded stat when it can be trusted without a read: the file's mtime older than the recorded read by more than
 * RACY_MS (a rewrite in the same timestamp tick as the read would otherwise keep the same stat). A later mtime (that
 * tick, or the future) is not trusted: the file is hashed (see ensureKey).
 */
function trustedStat(row, rec) {
  if (!rec) return null;
  const readAt = Date.parse(row.indexed_at);
  if (!Number.isFinite(readAt) || rec.mtimeMs >= readAt - RACY_MS) return null;
  return rec.stat;
}

/** The byte cap of one state file: smaller for the `.claude/marathon/<run>/` files of the project `root`. */
export function maxBytesFor(key, root) {
  return root && inside(path.join(root, '.claude', 'marathon'), key) ? MAX_MARATHON_FILE_BYTES : MAX_FILE_BYTES;
}

/**
 * Bring one file's rows up to date: skipped when its size, mtime and inode are the ones recorded (see trustedStat),
 * else read and re-indexed when its hash, kind or state changed. A read that does not fit `run`'s budget is left for a
 * later open (listed in run.pending). A file whose stat is the recorded one but not trusted (its mtime is too recent,
 * or in the future) is read without asking the budget and, when its hash is the recorded one, counts as clean and
 * costs the budget nothing. `key` is the indexed path (see fileKey). True when re-indexed.
 */
export function ensureKey(db, kind, key, root = null, run = null) {
  const row = db.get('SELECT kind, sha256, error, stat, indexed_at FROM files WHERE file = ?', key);
  const same = row && row.kind === kind;
  const rec = same ? recordedRead(row) : null;
  const state = readState(key, {
    root, known: trustedStat(row, rec), max: maxBytesFor(key, root),
    allow: run ? (n, st) => (rec && st === rec.stat) || fitsBytes(run, n) : null
  });
  if (state.unchanged) return false;
  if (state.deferred) return defer(run, key);
  const verify = !!(state.buf && rec && state.stat === rec.stat);
  if (state.buf) {
    state.sha = shaOf(state.buf);
    if (run && !verify) run.bytes += state.buf.length;
  }
  if (same) {
    if (state.skip && row.sha256 === SKIPPED && row.error === state.skip) return false;
    if (state.absent && row.sha256 === 'absent') return false;
    if (state.buf && (row.sha256 === state.sha || (verify && row.sha256 === SKIPPED && rec.readSha === state.sha))) {
      // the same content: record the stat (and when it was read) so the next open need not read it
      db.run('UPDATE files SET stat = ?, indexed_at = ? WHERE file = ?', `${state.stat}:${row.sha256}:${state.sha}`, new Date().toISOString(), key);
      return false;
    }
  }
  if (verify && run) {
    // changed under a stat that looked the same: now it is a read like any other
    if (!fitsBytes(run, state.buf.length)) return defer(run, key);
    run.bytes += state.buf.length;
  }
  return indexFile(db, kind, key, state, run);
}

/** Whether `p` is a real folder (not a symbolic link). */
const isRealDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };

/**
 * At most `max` entries of a real folder (never through a symbolic link), in the order the file system gives them:
 * { entries, more } (more: the folder has entries beyond them).
 */
function readSomeEntries(dir, max) {
  if (!isRealDir(dir)) return { entries: [], more: false };
  let d;
  try { d = fs.opendirSync(dir); } catch { return { entries: [], more: false }; }
  const entries = [];
  let more = false;
  try {
    for (;;) {
      const e = d.readSync();
      if (!e) break;
      if (entries.length >= max) { more = true; break; }
      entries.push(e);
    }
  } catch { /* what was read so far */ } finally { try { d.closeSync(); } catch { /* closed */ } }
  return { entries, more };
}

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The project's own state files, as keys under the project's real path `root`: each kind's default file and the
 * per-stream triage files `.claude/marathon/<run>/triage*.json` (no symbolic link is followed: a linked .claude,
 * marathon or run folder, or a linked file, is not listed; at most `limits.files` of them, MAX_MARATHON_FILES). The
 * marathon folder is read once and bounded (MARATHON_SCAN); run folders after the last listed file are not read. The
 * list carries `truncated` ({ files, entries, runEntries }: which bound left something out, or null) and `isOmitted(key)`:
 * whether a marathon triage file was left out by a bound (never indexed; dropped when it was).
 */
export function projectFiles(root, limits = indexRun({ budget: null }).marathon) {
  const out = Object.entries(KINDS).map(([kind, k]) => ({ kind, file: path.join(root, ...k.defaultFile.split('/')), project: true }));
  const marathon = path.join(root, '.claude', 'marathon');
  const listed = new Set();
  const truncated = { files: false, entries: false, runEntries: false };
  out.truncated = null;
  out.isOmitted = (key) => {
    if (!out.truncated || listed.has(key)) return false;
    const rel = path.relative(marathon, key).split(path.sep);
    return rel.length === 2 && rel[0] !== '..' && !path.isAbsolute(path.relative(marathon, key)) && MARATHON_FILE.test(rel[1]);
  };
  if (!isRealDir(path.join(root, '.claude')) || !isRealDir(marathon)) return out;
  const top = readSomeEntries(marathon, limits.entries);
  truncated.entries = top.more;
  const runs = top.entries.filter((d) => d.isDirectory()).map((d) => d.name).sort(byName);
  let scanned = 0;
  for (let i = 0; i < runs.length; i++) {
    if (listed.size >= limits.files) { truncated.files = true; break; }
    const left = limits.runEntries - scanned;
    const some = readSomeEntries(path.join(marathon, runs[i]), left);
    scanned += some.entries.length;
    if (some.more) truncated.runEntries = true;
    const files = some.entries.filter((d) => d.isFile() && MARATHON_FILE.test(d.name)).map((d) => d.name).sort(byName);
    for (const f of files) {
      if (listed.size >= limits.files) { truncated.files = true; break; }
      const file = path.join(marathon, runs[i], f);
      out.push({ kind: 'triage', file, project: true });
      listed.add(file);
    }
    if (truncated.runEntries) break;
  }
  if (truncated.files || truncated.entries || truncated.runEntries) out.truncated = truncated;
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
 * Fill files.bytes where it is NULL (an index made before migration 3, whose unchanged files are never re-indexed):
 * the size of the read the row was recorded from (its stat) when it gives rows, else 0; no file is read, at most an
 * lstat when no stat was recorded. Files about to be re-indexed (rebuild) are left alone: indexing sets their bytes.
 */
export function fillBytes(db) {
  const rows = db.all("SELECT id, file, kind, stat FROM files WHERE bytes IS NULL AND sha256 NOT IN ('absent', 'rebuild', ?)", SKIPPED);
  if (!rows.length) return 0;
  inTransaction(db, () => {
    for (const r of rows) {
      const spec = KINDS[r.kind];
      const has = spec && Number(db.get(`SELECT COUNT(*) AS n FROM ${spec.table} WHERE file_id = ?`, r.id).n) > 0;
      let size = 0;
      if (has) {
        const recorded = r.stat ? Number(String(r.stat).split(':')[0]) : NaN;
        if (Number.isSafeInteger(recorded) && recorded >= 0) size = recorded;
        else { try { const st = fs.lstatSync(r.file); size = st.isFile() ? st.size : 0; } catch { size = 0; } }
      }
      db.run('UPDATE files SET bytes = ? WHERE id = ?', size, r.id);
    }
  });
  return rows.length;
}

/** Drop one file from the index: its rows, its files row, its pending row. */
const forget = (db, key, run) => { lower(run, dropRows(db, key)); db.run('DELETE FROM files WHERE file = ?', key); db.run('DELETE FROM pending WHERE file = ?', key); };

/**
 * Bring the index up to date with the files, each file in its own transaction (a failure keeps what was done before
 * it), each file at most once per open: first `first` (the file a verb just wrote: [{ kind, file }]), then the files
 * earlier opens left pending (oldest first, so none waits forever), then every recorded file (a marathon file left out
 * by a bound, or of an unknown kind, is dropped), then the project files it does not hold yet. Within `run`'s budget:
 * what does not fit is left for a later open (run.pending, and the pending table with the time it was first left).
 * Returns `run`, with run.found = projectFiles(root).
 */
export function refreshIndex(db, root, run, { first = [] } = {}) {
  const found = projectFiles(root, run.marathon);
  run.found = found;
  fillBytes(db);
  const done = new Set();
  const visit = (kind, key) => {
    if (done.has(key)) return;
    done.add(key);
    inTransaction(db, () => {
      if (!Object.hasOwn(KINDS, kind) || found.isOmitted(key)) { forget(db, key, run); return; }
      ensureKey(db, kind, key, root, run);
      if (run.pending.includes(key)) db.run('INSERT INTO pending (file, kind, since) VALUES (?, ?, ?) ON CONFLICT (file) DO UPDATE SET kind = excluded.kind', key, kind, new Date().toISOString());
      else db.run('DELETE FROM pending WHERE file = ?', key);
    });
  };
  for (const f of first) { const key = fileKey(f.file); if (!found.isOmitted(key)) visit(f.kind, key); }
  for (const p of db.all('SELECT file, kind FROM pending ORDER BY since, file')) visit(p.kind, p.file);
  const recorded = db.all('SELECT file, kind FROM files ORDER BY file');
  for (const r of recorded) visit(r.kind, r.file);
  for (const f of found) visit(f.kind, f.file);
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
