/**
 * store — where the kit verbs that keep state (reflect lessons, noise-ledger, triage) keep it. A library, not a verb:
 * cli.js discovery skips it (no `verb` export). The verbs never know which store is in use.
 * Built for the suite-db plan (2026-10-16); no foreign code.
 *
 * STORES. JSON files are the default and the fallback: each verb's file, written through ./state-lock.js exactly as
 * before. A project opts into one local SQLite file with `db init`.
 *
 * MACHINE-LOCAL STATE lives outside the project, in a per-user folder `<base>/<id>/`: <base> is `$DANIZEE_KIT_HOME`
 * when set (tests; it must be absolute and outside the project, else exit 1), else `~/.claude/kit-db`; <id> is a random
 * 128-bit id (32 hex digits) that `db init` writes to the project's git-ignored marker `.claude/kit/store-id` (mode
 * 0600; the kit installer and `db init` add its .gitignore rule). The folder is created with mode 0700 and holds
 * `suite.db` (plus -wal/-shm), the store choice `store.local.json` ({"store":"sqlite"|"json"}, plus the "scopes"
 * registered by this machine's verbs), the files journal `suite.db-files-journal` and `project.json` ({ id, path }: the
 * project's real path, in the file system's own spelling). See locateStore: no marker means the JSON files and nothing
 * is created; a marker is only an id (the store choice lives in the per-user folder), so a junk or planted marker can
 * only be ignored or cause a refusal, never a read of another store; a marker the kit wrote whose store is gone is
 * exit 1 (never a silent fall back to the JSON files); a moved project keeps its store; a copy of the project folder
 * that still exists beside the original is exit 1 until `db init --new` gives it its own. So nothing in a cloned
 * repository can supply a database, a journal, a store choice or a registered scope: a stray `.claude/kit/suite.db` or
 * `store.local.json` in the project is never opened (`db status` names it once). A new worktree has no marker.
 *
 * ENGINE. `better-sqlite3`, else Node's built-in `node:sqlite` (`DatabaseSync`, unflagged from Node 22.13 / 23.4; older
 * Node counts as having none). better-sqlite3 is loaded only from the kit package's own install: when the kit runs from
 * the npm package (src/lib/kit of `danizee-claude-suite`) and the module's real path is inside that package's own
 * node_modules (never a copy found by climbing to a parent node_modules, such as the project's). The project's
 * installed copy (.claude/helpers/kit) and every other case use node:sqlite. Code from the project folder is never
 * loaded, and no git is run. Engines are loaded lazily, on first use; `check` and `db status` on the JSON files only
 * probe (probeEngine: a module resolve in the kit package and a built-in check, nothing loaded). A project configured
 * for sqlite whose engine cannot load is an error (exit 1) that names the fix; it NEVER falls back to the JSON files
 * (that would split the state in two). `KIT_SQLITE_ENGINE=better-sqlite3|node:sqlite|none` pins the engine (tests,
 * diagnosis).
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
 * `db export` / `off` / `sync` write the JSON files (and, for `off`, the store choice) as their transaction's last step,
 * all or none; the files journal, written before the renames and removed after COMMIT, lets the next database open
 * put the files back when a crash stopped the run in between (see recoverFilesJournal).
 *
 * DOCUMENT FILES. A document's file comes only from the kit's own mapping (scopeFile), never from a row: the store's
 * default file, a per-stream triage file `.claude/marathon/<run>/triage*.json`, a scope this machine's verbs wrote
 * (registered in the per-user store.local.json) or the path named on the command line; and only when that path, after
 * the real path of its existing parent folder, is inside the project folder (a symbolically linked `.claude` inside
 * the repository is fine) and not inside `.git`, no link on the way leads nowhere, and the file itself is not a
 * symbolic link (import, export, sync, drift and the files journal read store files with O_NOFOLLOW; the JSON store
 * keeps following links as it always did). Any other document is not written: export lists it in `not_written`
 * and exits 1, off refuses (exit 1, the project stays on sqlite) naming it and the ways out.
 *
 * DEFENCE IN DEPTH. The database is this machine's, but before it is used its sqlite_master must hold only objects the
 * kit's own migrations create, with exactly their SQL (checkSchema: no trigger, view, virtual table, sqlite_stat table
 * or unknown object; exit 1 naming it), checked before `db init` migrates an existing file; `PRAGMA trusted_schema =
 * OFF` is set where the engine supports it. The files journal is checked whole before anything is restored.
 *
 * DRIFT. Shared JSON files (lessons.json, noise-ledger.json) can change under the database (a git pull). Each stored
 * document keeps the sha256 of its file as last imported, exported or synced (`store_docs.file_sha256`, 'absent' when
 * there was no file) and that document itself, the BASE of the next merge (`store_docs.synced_doc`, 'absent' when there
 * was no file, NULL when unknown: synced by a kit older than schema 4). A read or write of a scope whose file exists
 * with another hash is exit 1 naming the file and the two ways out: `db sync --from-files` MERGES the file and the
 * database three-way against that base (see mergeDocs: a row deleted on one side and unchanged on the other is deleted,
 * two rows that took the same new id on both sides are both kept and the database's is renumbered, a row changed on
 * both sides is a conflict; every deletion, renumbering, conflict and discarded row is listed), `db export
 * --overwrite` replaces the file (the message names the file-only rows it drops, the file edits it reverts and the
 * file deletions it undoes).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire, isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { KitExit } from './kit-exit.js';
import { withStateLock, readJsonState, writeJsonAtomic } from './state-lock.js';

/** The environment variable that replaces `~/.claude/kit-db` as the folder of the per-project store folders (tests). */
export const KIT_HOME_ENV = 'DANIZEE_KIT_HOME';
/** File names inside a project's per-user store folder (storePaths). */
export const DB_NAME = 'suite.db';
export const CONFIG_NAME = 'store.local.json';
/**
 * The files journal of a run that writes JSON files inside a database transaction (db export / off / sync): written
 * (atomically) before the first file is renamed, removed right after COMMIT. Not `suite.db-journal`: that is SQLite's
 * own rollback-journal name, and SQLite deletes a file of that name when it opens the database.
 */
export const JOURNAL_NAME = 'suite.db-files-journal';
export const PROJECT_NAME = 'project.json';
/**
 * Where earlier builds of this branch kept the store inside the project. Never opened or read: `db status` only names
 * the ones that exist (a clone may carry them; they mean nothing to the kit).
 */
export const STRAY_PROJECT_FILES = Object.freeze(['.claude/kit/suite.db', '.claude/kit/suite.db-wal', '.claude/kit/suite.db-shm', '.claude/kit/suite.db-files-journal', '.claude/kit/store.local.json']);
export const STORES = Object.freeze(['json', 'sqlite']);
export const ENGINES = Object.freeze(['better-sqlite3', 'node:sqlite']);
export const BUSY_TIMEOUT_MS = 15000;
export const ENGINE_FIX = 'this machine\'s store needs a SQLite engine on this machine: run Node 22.13+ (built-in node:sqlite; on Node 22.5+ before 22.13 only with --experimental-sqlite), '
  + 'or install the suite package with its optional dependency better-sqlite3 (only the package\'s own copy, in its own node_modules, is ever loaded; never one from the project)';

const invalid = (m) => new KitExit(m, 1);

// ================================================================ schema

/** What each verb's document looks like: its collections and the plain columns kept beside the JSON. */
export const SPECS = Object.freeze({
  lessons: {
    defaultFile: '.claude/kit/lessons.json',
    parts: [{
      field: 'lessons',
      kind: 'array',
      table: 'lessons',
      cols: (x) => ({ id: x?.id, role: x?.role, status: x?.status, session: x?.session, created_at: x?.created_at }),
      // ids are made per machine (reflect: L<max+1>), so one id on two sides can be two different lessons: the merge
      // renumbers the database's one to the next free L<n>, unless both carry the same identity (one lesson, edited)
      identity: ['created_at', 'session'],
      renumber: (used) => `L${1 + Math.max(0, ...used.map((id) => Number(String(id).slice(1)) || 0))}`
    }]
  },
  'noise-ledger': {
    defaultFile: '.claude/kit/noise-ledger.json',
    // an entry's id is the id of the finding it accepts: one id on two sides is the same finding (never renumbered)
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
    // records and scopes are keyed by fingerprint / scope: one key on two sides is the same record (never renumbered)
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
  },
  {
    // three-way merge: the document as last synced with its file (the merge base; 'absent': no file then; NULL: unknown)
    version: 4,
    sql: `
ALTER TABLE store_docs ADD COLUMN synced_doc TEXT;
`
  },
  {
    // every CI report key ever imported, kept when `db prune` deletes the run, so import-reports never brings it back
    version: 5,
    sql: `
CREATE TABLE imported_reports (run_key TEXT PRIMARY KEY, branch TEXT, imported_at TEXT NOT NULL);
INSERT OR IGNORE INTO imported_reports (run_key, branch, imported_at) SELECT run_key, branch, started_at FROM test_runs WHERE run_key IS NOT NULL;
`
  }
]);
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
/** Every table and the column that holds the scope (for status counts and export). */
export const TABLES = Object.freeze(['lessons', 'noise_ledger', 'triage', 'triage_scopes', 'test_runs', 'test_cases']);
const SCOPE_COL = { lessons: 'scope', noise_ledger: 'scope', triage: 'stream', triage_scopes: 'stream' };

// ================================================================ the per-user store folder

/** The project's store marker: the id of its per-user store folder, written by `db init` (git-ignored, mode 0600). */
export const MARKER_FILE = '.claude/kit/store-id';
const STORE_ID = /^[0-9a-f]{32}$/;
const MARKER_MAX_BYTES = 256;
/** What to do when a project's store is gone. */
const MISSING_FIX = 'run `db init` to start a new one (imported from the JSON files) or restore it';

/** The project folder's real path, in the file system's own spelling (realpathSync.native): the path a store records. */
export function projectRoot(cwd) {
  try { return fs.realpathSync.native(cwd); } catch (e) { throw invalid(`cannot resolve the project folder ${cwd}: ${e.code || e.message}`); }
}

/**
 * The real path of `p` through its deepest existing folder (the missing rest appended as it is): { real }, or
 * { dangling: <path> } when a symbolic link on the way leads nowhere, or { error }.
 */
function realThrough(p) {
  let dir = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return { real: path.join(fs.realpathSync.native(dir), ...rest) }; } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') return { error: `cannot be checked (${e.code || e.message})` };
      // a link whose target is missing: never a plain name to append (what it would create is somewhere else)
      try { if (fs.lstatSync(dir).isSymbolicLink()) return { dangling: dir }; } catch { /* absent: go up */ }
      const up = path.dirname(dir);
      if (up === dir) return { error: 'cannot be resolved' };
      rest.unshift(path.basename(dir));
      dir = up;
    }
  }
}

/**
 * The folder of the per-user store folders: `$DANIZEE_KIT_HOME` when set (an absolute path whose real path is not the
 * project folder or inside it, else exit 1), else `~/.claude/kit-db`.
 */
export function kitBase(root, env = process.env) {
  const raw = env && env[KIT_HOME_ENV] ? String(env[KIT_HOME_ENV]) : '';
  if (!raw) return path.join(os.homedir(), '.claude', 'kit-db');
  if (!path.isAbsolute(raw)) throw invalid(`${KIT_HOME_ENV}=${JSON.stringify(raw).slice(0, 200)} is not an absolute path: set it to an absolute folder outside the project (or unset it to use ~/.claude/kit-db)`);
  const base = path.resolve(raw);
  const r = realThrough(base);
  if (!r.real) throw invalid(`${KIT_HOME_ENV} (${base}) ${r.dangling ? `leads through a symbolic link that points nowhere (${r.dangling})` : r.error}`);
  if (r.real === root || inside(root, r.real)) {
    throw invalid(`${KIT_HOME_ENV} (${base}) is inside the project folder ${root}: the per-user store must live outside the project (a repository must never supply it); set it to a folder outside the project`);
  }
  return base;
}

/** Read a small regular file without following a final symbolic link (O_NOFOLLOW where the platform has it). */
function readNoFollowSync(file, max = Infinity) {
  const C = fs.constants;
  const fd = fs.openSync(file, C.O_RDONLY | (C.O_NOFOLLOW || 0) | (C.O_NONBLOCK || 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'ENOTREG' });
    if (st.size > max) throw Object.assign(new Error(`${st.size} bytes`), { code: 'ETOOBIG' });
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

/**
 * The project's store marker: { state: 'none' } (no file), { state: 'invalid', why } (a link, not a file, outside the
 * project, not 32 hex digits) or { state: 'ok', id, own } (own: its permission bits are 0600 as `db init` writes it,
 * so not a file git checked out; always true on Windows). Never followed through a link.
 */
export function readMarker(root) {
  const file = path.join(root, ...MARKER_FILE.split('/'));
  let st;
  try { st = fs.lstatSync(file); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { state: 'none', file };
    return { state: 'invalid', file, why: `${MARKER_FILE} cannot be checked (${e.code || e.message})` };
  }
  if (st.isSymbolicLink()) return { state: 'invalid', file, why: `${MARKER_FILE} is a symbolic link (\`db init\` writes a plain file)` };
  if (!st.isFile()) return { state: 'invalid', file, why: `${MARKER_FILE} is not a file` };
  const out = outsideProject(root, file);
  if (out) return { state: 'invalid', file, why: `${MARKER_FILE} ${out}` };
  let text;
  try { text = readNoFollowSync(file, MARKER_MAX_BYTES).toString('utf-8').trim(); } catch (e) {
    return { state: 'invalid', file, why: `${MARKER_FILE} cannot be read (${e.code === 'ELOOP' ? 'a symbolic link' : e.code || e.message})` };
  }
  if (!STORE_ID.test(text)) return { state: 'invalid', file, why: `${MARKER_FILE} does not hold a store id \`db init\` writes (32 hex digits)` };
  const own = process.platform === 'win32' || (st.mode & 0o077) === 0;
  return { state: 'ok', file, id: text, own, mode: st.mode & 0o777 };
}

/** Why the store folder is not a usable private folder of this user, or null (also when it does not exist yet). */
function storeDirProblem(dir) {
  let st;
  try { st = fs.lstatSync(dir); } catch (e) { return e.code === 'ENOENT' ? null : `cannot be checked: ${e.code || e.message}`; }
  if (st.isSymbolicLink() || !st.isDirectory()) return 'is not a folder (a symbolic link?)';
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return 'belongs to another user';
  return null;
}

/** project.json of a store folder ({ id, path, created_at, moved_from?, moved_at? }) or null. */
export function readProjectJson(paths) {
  if (!paths || !paths.project) return null;
  try {
    const v = JSON.parse(fs.readFileSync(paths.project, 'utf-8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/** The paths of store `id` under `base`. */
function pathsOf(root, base, id) {
  const dir = path.join(base, id);
  return { root, base, id, dir, db: path.join(dir, DB_NAME), config: path.join(dir, CONFIG_NAME), journal: path.join(dir, JOURNAL_NAME), project: path.join(dir, PROJECT_NAME) };
}

/** Whether two existing paths are one folder (device and inode): a case or link spelling of the same project. */
function sameFolder(a, b) {
  try {
    const x = fs.statSync(a, { bigint: true });
    const y = fs.statSync(b, { bigint: true });
    return x.dev === y.dev && x.ino === y.ino;
  } catch { return false; }
}

/**
 * Where this project's machine-local store lives. The project names it by the id in its marker (MARKER_FILE, written
 * by `db init`); the store is `<base>/<id>/` (kitBase). Returns { root, marker, kind, id, base, dir, db, config,
 * journal, project, why?, moved? }:
 * - kind 'none': no marker. The project is on the JSON files and nothing is created (dir and the files are null).
 * - kind 'ignored' (why): a marker that is not one `db init` wrote (a link, not 32 hex digits, outside the project), or
 *   a valid id with no store on this machine in a file that does not look like `db init`'s (not mode 0600: committed
 *   to git?). The JSON files are used, `db status` warns. A marker never switches a project to SQLite by itself: the
 *   choice lives in the per-user folder.
 * - kind 'store': the marker's store exists and its project.json records that id. When project.json records another
 *   path: the same folder under another spelling is fine; another folder that still exists with the same marker means
 *   THIS folder is a copy (exit 1: `db init --new`); otherwise the project moved: project.json takes this path and
 *   keeps `moved_from` until `db status` reports it once.
 * A marker the kit wrote whose store is missing is exit 1 (never a silent fall back to the JSON files), except with
 * `missingOk` (db init): kind 'missing'. `copyOk`: kind 'copy' (copy_of) instead of the exit.
 */
export function locateStore(cwd, env = process.env, { missingOk = false, copyOk = false } = {}) {
  const root = projectRoot(cwd);
  const marker = readMarker(root);
  const empty = { root, marker, id: null, base: null, dir: null, db: null, config: null, journal: null, project: null };
  if (marker.state === 'none') return { ...empty, kind: 'none' };
  if (marker.state !== 'ok') return { ...empty, kind: 'ignored', why: marker.why };
  const p = { ...pathsOf(root, kitBase(root, env), marker.id), marker };
  const missing = (what) => {
    if (missingOk) return { ...p, kind: 'missing', why: what };
    throw invalid(`this project was on the SQLite store but its database is missing (${what}): ${MISSING_FIX}`);
  };
  let st = null;
  try { st = fs.lstatSync(p.dir); } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw invalid(`cannot check the kit store folder ${p.dir}: ${e.code || e.message}`); }
  if (!st) {
    if (!marker.own) {
      return { ...empty, kind: 'ignored', why: `${MARKER_FILE} names store ${marker.id}, which this machine does not have, and its permissions (${marker.mode.toString(8).padStart(4, '0')}) are not the 0600 \`db init\` writes (committed to git?): it is ignored` };
    }
    return missing(`${MARKER_FILE} names store ${marker.id}; ${p.dir} does not exist`);
  }
  const bad = storeDirProblem(p.dir);
  if (bad) throw invalid(`the kit store folder ${p.dir} ${bad}: refusing it`);
  const pj = readProjectJson(p);
  if (!pj || pj.id !== marker.id || typeof pj.path !== 'string') return missing(`${p.project} does not record store ${marker.id}`);
  if (pj.path !== root && !sameFolder(pj.path, root)) {
    const there = fs.existsSync(pj.path) ? readMarker(pj.path) : null;
    if (there && there.state === 'ok' && there.id === marker.id) {
      if (copyOk) return { ...p, kind: 'copy', copy_of: pj.path };
      throw invalid(`this project folder (${root}) is a copy of ${pj.path}, which uses the same SQLite store (${p.dir}): two folders must not share one store. `
        + `Run \`db init --new\` here to give this copy its own store, imported from its JSON files (run \`db export\` in ${pj.path} first to bring the JSON files it shares up to date)`);
    }
    // moved (or renamed): the store follows the project
    const moved = { ...pj, path: root, moved_from: pj.path, moved_at: new Date().toISOString() };
    writeFileAtomicSync(p.project, `${JSON.stringify(moved, null, 2)}\n`);
    return { ...p, kind: 'store', moved: { from: moved.moved_from, at: moved.moved_at } };
  }
  return { ...p, kind: 'store', ...(pj.moved_from ? { moved: { from: pj.moved_from, at: pj.moved_at ?? null } } : {}) };
}

/** locateStore without the options (the paths every verb uses; dir and the files are null when there is no store). */
export function storePaths(cwd, env = process.env) {
  return locateStore(cwd, env);
}

/** After `db status` reported a move once: drop the note from project.json. */
export function clearMoved(paths) {
  const pj = readProjectJson(paths);
  if (!pj || !pj.moved_from) return;
  const { moved_from: _f, moved_at: _a, ...rest } = pj;
  writeFileAtomicSync(paths.project, `${JSON.stringify(rest, null, 2)}\n`);
}

/**
 * This project's existing store folder, checked (not a symbolic link, this user's, mode 0700). No store is exit 1
 * (`db init` creates one: createStore). Returns locateStore's paths.
 */
export function ensureStoreDir(cwd, env = process.env) {
  const p = storePaths(cwd, env);
  if (p.kind !== 'store') throw invalid(`this project has no kit store on this machine${p.why ? ` (${p.why})` : ''}: run \`db init\``);
  const bad = storeDirProblem(p.dir);
  if (bad) throw invalid(`the kit store folder ${p.dir} ${bad}: remove it (or set ${KIT_HOME_ENV} to another folder) and run the command again`);
  try { fs.chmodSync(p.dir, 0o700); } catch (e) { throw invalid(`cannot make ${p.dir} private (mode 0700): ${e.code || e.message}`); }
  return p;
}

/**
 * Start a new store for the project (`db init` on a project without one, or `db init --new`): a random 128-bit id,
 * `<base>/<id>/` (mode 0700) with project.json { id, path }, then the marker (mode 0600) naming it, written last.
 * A marker that is a symbolic link, or a marker path outside the project, is exit 1 before anything is created.
 * Returns { paths, undo }: undo() (a failed init) removes the new folder and puts the old marker back.
 */
export function createStore(cwd, env = process.env) {
  const root = projectRoot(cwd);
  const markerFile = path.join(root, ...MARKER_FILE.split('/'));
  const out = outsideProject(root, markerFile);
  if (out) throw invalid(`cannot write the store marker ${MARKER_FILE}: it ${out}; nothing was changed`);
  const base = kitBase(root, env);
  const id = crypto.randomBytes(16).toString('hex');
  const p = { ...pathsOf(root, base, id), kind: 'store' };
  try {
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    fs.mkdirSync(p.dir, { mode: 0o700 });
  } catch (e) { throw invalid(`cannot create the kit store folder ${p.dir}: ${e.code || e.message}`); }
  const removeDir = () => { try { fs.rmSync(p.dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  let before = null;
  try {
    const bad = storeDirProblem(p.dir);
    if (bad) throw invalid(`the kit store folder ${p.dir} ${bad}: remove it (or set ${KIT_HOME_ENV} to another folder) and run the command again`);
    fs.chmodSync(p.dir, 0o700);
    writeFileAtomicSync(p.project, `${JSON.stringify({ id, path: root, created_at: new Date().toISOString() }, null, 2)}\n`);
    try { before = readNoFollowSync(markerFile, MARKER_MAX_BYTES); } catch (e) {
      if (e.code !== 'ENOENT') throw invalid(`cannot replace ${MARKER_FILE} (${e.code === 'ELOOP' ? 'a symbolic link' : e.code || e.message}): remove it and run \`db init\` again; nothing was changed`);
    }
    fs.mkdirSync(path.dirname(markerFile), { recursive: true });
    if (before === null) {
      // exclusive: two `db init` at once never both think they made the project's store
      let fd;
      try { fd = fs.openSync(markerFile, 'wx', 0o600); } catch (e) {
        throw invalid(e.code === 'EEXIST' ? `another \`db init\` wrote ${MARKER_FILE} meanwhile: run \`db init\` again` : `cannot write ${markerFile}: ${e.code || e.message}`);
      }
      try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, `${id}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } else {
      try { putFileSync(markerFile, Buffer.from(`${id}\n`), 0o600); } catch (e) { throw invalid(`cannot write ${markerFile}: ${e.code || e.message}`); }
    }
  } catch (e) { removeDir(); throw e; }
  const undo = () => {
    try {
      let now = null;
      try { now = readNoFollowSync(markerFile, MARKER_MAX_BYTES).toString('utf-8').trim(); } catch { /* gone */ }
      if (now === id) {
        if (before === null) fs.rmSync(markerFile, { force: true });
        else putFileSync(markerFile, before, 0o600);
      }
    } catch { /* best effort */ }
    removeDir();
  };
  return { paths: p, undo };
}

/** The STRAY_PROJECT_FILES that exist in the project (by lstat only: never opened). */
export function strayProjectFiles(cwd) {
  return STRAY_PROJECT_FILES.filter((f) => { try { fs.lstatSync(path.join(cwd, ...f.split('/'))); return true; } catch { return false; } });
}

// ================================================================ config and engine

/** A config file's JSON object, or null when it does not exist. A broken one is exit 1. */
function readConfigObject(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf-8'); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
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
 * The configured store: { store: 'json'|'sqlite', configured: bool, file, paths }, from the per-user store.local.json
 * of the project's store (locateStore; absent = json, and json when the project has no store). A broken one is exit 1.
 * In the project folder only the marker is read.
 */
export function readConfig(cwd, env = process.env) {
  const paths = storePaths(cwd, env);
  if (paths.kind !== 'store') return { store: 'json', configured: false, file: null, paths };
  const v = readConfigObject(paths.config);
  if (v) return { store: v.store ?? 'json', configured: true, file: paths.config, config: v, paths };
  return { store: 'json', configured: false, file: paths.config, paths };
}

function writeFileAtomicSync(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left */ }
    throw invalid(`cannot write ${file}: ${e.code || e.message}`);
  }
}

/** Set the machine-local store choice of the project's existing store (ensureStoreDir). */
export async function writeConfig(cwd, store, env = process.env) {
  const { config } = ensureStoreDir(cwd, env);
  let cur = {};
  try { cur = readConfigObject(config) || {}; } catch { cur = {}; }
  await writeJsonAtomic(config, { ...cur, store });
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

/**
 * Whether this Node has node:sqlite without a flag: from 22.13 on the 22 line, from 23.4 on, and any later major.
 * 22.5 to 22.12 (and 23.0 to 23.3) have it only behind --experimental-sqlite: usable when that flag is given.
 * { ok, why } (why: the message when not ok).
 */
export function nodeSqliteSupport(version = process.versions.node, flags = [...process.execArgv, ...String(process.env.NODE_OPTIONS || '').split(/\s+/)]) {
  const [maj, min] = String(version).split('.').map((x) => Number(x) || 0);
  const unflagged = maj > 23 || (maj === 23 && min >= 4) || (maj === 22 && min >= 13);
  if (unflagged) return { ok: true };
  const flagged = (maj === 22 && min >= 5) || maj === 23;
  if (flagged && flags.includes('--experimental-sqlite')) return { ok: true };
  return { ok: false, why: `node:sqlite: not available on Node ${version} (built in without a flag from Node 22.13+ / 23.4+; on 22.5 to 22.12 only with --experimental-sqlite)` };
}

/** The engines to try for a KIT_SQLITE_ENGINE pin, plus the error a bad pin gives. */
function wantedEngines(env) {
  const pin = env && env.KIT_SQLITE_ENGINE ? String(env.KIT_SQLITE_ENGINE) : '';
  const errors = [];
  if (pin && pin !== 'none' && !ENGINES.includes(pin)) errors.push(`KIT_SQLITE_ENGINE=${pin} is not one of ${ENGINES.join(', ')}, none`);
  const want = pin === 'none' ? [] : pin && ENGINES.includes(pin) ? [pin] : pin ? [] : ENGINES;
  return { pin, want, errors };
}

/**
 * The root of the npm package the kit runs from (`danizee-claude-suite`, this file at src/lib/kit/store.js), or null
 * when the kit runs from a project's installed copy (.claude/helpers/kit): then the kit has no dependencies of its own.
 */
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

const inside = (root, p) => { const rel = path.relative(root, p); return !!rel && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel); };

/**
 * The kit package's own better-sqlite3: { file } (its real path) or { why }. Only when the kit runs from the npm
 * package and the module's real path is inside `<package>/node_modules/`: a copy Node would find by climbing to a
 * parent node_modules (the project's, when the package is installed inside a project) is never loaded. Nothing is
 * loaded here.
 */
function kitBetterSqlite() {
  if (!KIT_PACKAGE) return { why: 'not used by the project\'s installed kit copy (.claude/helpers/kit), which loads only the built-in node:sqlite' };
  let own;
  try { own = path.join(fs.realpathSync.native(KIT_PACKAGE), 'node_modules'); } catch (e) { return { why: `cannot resolve the kit package folder (${e.code || e.message})` }; }
  let file;
  try { file = fs.realpathSync.native(createRequire(path.join(KIT_PACKAGE, 'package.json')).resolve('better-sqlite3')); } catch (e) {
    return { why: String(e && e.message).split('\n')[0].slice(0, 200) };
  }
  if (!inside(own, file)) return { why: `resolved to ${file}, which is not in the kit package's own node_modules (${own}): not loaded` };
  return { file };
}

/**
 * Which engine would load, WITHOUT loading anything: better-sqlite3 when the kit package has its own copy (a path
 * lookup, no code run), else node:sqlite when Node has it built in. Never looks in the project folder. { name, errors }.
 */
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

/**
 * Load an engine: { name, open(file) } or { name: null, errors: [...] }. Lazy, cached per pin. better-sqlite3 only
 * from the kit package's own node_modules (kitBetterSqlite), else node:sqlite. Code from the project folder is never
 * loaded.
 */
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
        // a native module built for another Node fails only when a database is opened: try one in memory
        new Database(':memory:').close();
        found = { name, open: (file, o = {}) => wrap(new Database(file, o.readOnly ? { readonly: true, fileMustExist: true } : {})) };
      } catch (e) { errors.push(`better-sqlite3: ${String(e && e.message).split('\n')[0]}`); }
    } else {
      const sup = nodeSqliteSupport();
      if (!sup.ok) { errors.push(sup.why); continue; }
      try {
        const { DatabaseSync } = await importNodeSqlite();
        if (typeof DatabaseSync !== 'function') throw new Error('no DatabaseSync');
        found = { name, open: (file, o = {}) => wrap(o.readOnly ? new DatabaseSync(file, { readOnly: true }) : new DatabaseSync(file)) };
      } catch (e) { errors.push(`node:sqlite: ${String(e && e.message).split('\n')[0]} (Node ${process.versions.node}; needs 22.13+)`); }
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
    get: (sql, ...ps) => plain(raw.prepare(sql).get(...fix(ps))),
    all: (sql, ...ps) => raw.prepare(sql).all(...fix(ps)).map(plain),
    close: () => raw.close()
  };
}

// ================================================================ schema check (defence in depth)

/** A refusal of a database or journal the kit did not make (never swallowed as passing trouble). */
const untrusted = (m) => Object.assign(invalid(m), { untrusted: true });

/** sqlite_master of a database the kit made, per object: `${type}\0${name}` -> { tbl, sqls }. Cached per engine open. */
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
    // every version's schema (an older database is read, then migrated): the SQL of an altered table changes per version
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    snap();
    for (const m of MIGRATIONS) { db.exec(m.sql); snap(); }
  } finally { db.close(); }
  referenceCache.set(open, known);
  return known;
}

/**
 * Check a database's sqlite_master against the kit's own schema before anything else reads it: every object must be
 * one the migrations create, with exactly the kit's SQL for it. A trigger (it runs on the kit's own writes), a view (a
 * query that may never end), a virtual table, a sqlite_stat table (the kit never runs ANALYZE; planner statistics could
 * steer its queries) or any unknown object is exit 1 naming it. Reading sqlite_master evaluates nothing.
 */
export function checkSchema(db, open, file) {
  const known = referenceSchema(open);
  for (const r of db.all('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid')) {
    const ref = known.get(`${r.type}\0${r.name}`);
    const what = `${r.type} ${JSON.stringify(String(r.name).slice(0, 80))}`;
    if (!ref || ref.tbl !== r.tbl_name || !ref.sqls.has(r.sql ?? null)) {
      throw untrusted(`${file} holds ${ref ? `a ${what} that differs from` : `a ${what} that is not in`} the kit's own schema, so the kit did not make it: `
        + 'refusing it (nothing was read from it). Remove it and run `db init` (the JSON files are imported again)');
    }
  }
}

/** Set up a freshly opened connection to a database that may be untrusted: trusted_schema off, then the schema check. */
export function guardDb(db, open, file) {
  try { db.exec('PRAGMA trusted_schema = OFF'); } catch { /* an engine without the pragma: the schema check still runs */ }
  checkSchema(db, open, file);
}

// ================================================================ context

/**
 * Which store this project uses: { kind: 'json' } or { kind: 'sqlite', engine, dbFile, cwd }.
 * Throws exit 1 (naming the fix) when sqlite is configured and no engine loads, or the database is missing.
 */
export async function resolveStore({ cwd = process.cwd(), env = process.env } = {}) {
  let cfg = readConfig(cwd, env);
  if (cfg.store !== 'sqlite' && await recoverJsonSide(cwd, env)) cfg = readConfig(cwd, env);
  if (cfg.store !== 'sqlite') return { kind: 'json', cwd, env };
  const bad = storeDirProblem(cfg.paths.dir);
  if (bad) throw invalid(`the kit store folder ${cfg.paths.dir} ${bad}: refusing it`);
  const engine = await loadEngine({ env });
  if (!engine.name) throw invalid(`this project keeps its kit state in SQLite (${cfg.file}) but no SQLite engine loads here (${engine.errors.join('; ') || 'none tried'}): ${ENGINE_FIX}`);
  const dbFile = cfg.paths.db;
  if (!fs.existsSync(dbFile)) throw invalid(`this project was on the SQLite store but its database is missing (${cfg.file} says "store": "sqlite"; ${dbFile} does not exist): ${MISSING_FIX}`);
  return { kind: 'sqlite', engine: engine.name, open: engine.open, dbFile, cwd, env };
}

/**
 * A project on the JSON files with a files journal left beside a leftover suite.db (a `db off` stopped between its
 * file renames, the store choice among them, and its COMMIT): recover it with the kit's own engine (never code from
 * the project folder), then read the store choice again. Trouble here never stops a JSON verb: it is reported on
 * stderr and the journal is kept for the next database open. Except a database the kit did not make (checkSchema):
 * exit 1 naming it, nothing read or restored.
 */
export async function recoverJsonSide(cwd, env = process.env) {
  const { db: dbFile, dir } = storePaths(cwd, env);
  if (!dbFile || !fs.existsSync(journalOf(dbFile)) || !fs.existsSync(dbFile)) return false;
  const bad = storeDirProblem(dir);
  if (bad) throw invalid(`the kit store folder ${dir} ${bad}: refusing it`);
  return serial(dbFile, () => recoverJsonSideNow(cwd, env, dbFile));
}

async function recoverJsonSideNow(cwd, env, dbFile) {
  let db = null;
  try {
    const own = await loadEngine({ env });
    if (!own.name) throw new Error(own.errors.join('; ') || 'no SQLite engine');
    db = own.open(dbFile);
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    guardDb(db, own.open, dbFile);
    recoverFilesJournal(db, cwd, dbFile, env);
    return true;
  } catch (e) {
    if (e instanceof KitExit && e.untrusted) throw e;
    process.stderr.write(`kit db: cannot recover ${journalOf(dbFile)} yet (${String(e && e.message).split('\n')[0].slice(0, 200)}); it is kept for the next database open\n`);
    return false;
  } finally { try { db?.close(); } catch { /* not open */ } }
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
    // before anything else reads it, and before migrations run on an existing file: only the kit's own schema
    guardDb(db, ctx.open, ctx.dbFile);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, ctx.dbFile);
    // before any read or drift check: finish what a run killed between its file renames and its COMMIT left behind
    if (ctx.cwd && fs.existsSync(journalOf(ctx.dbFile))) recoverFilesJournal(db, ctx.cwd, ctx.dbFile, ctx.env || process.env);
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

// ================================================================ files journal

/** The files journal beside a database file. */
export const journalOf = (dbFile) => path.join(path.dirname(dbFile), JOURNAL_NAME);

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Write `file` atomically and durably (temp file beside it, fsync, rename), with `mode` when given. Sync. */
function putFileSync(file, buf, mode = null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx', mode === null ? 0o666 : 0o600);
    try {
      if (mode !== null) fs.fchmodSync(fd, mode);
      fs.writeFileSync(fd, buf);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left */ } throw e; }
}

/**
 * Write the files journal of a run about to rename `entries` ([{ file, store?, scope?, storeChoice?, before:
 * Buffer|null, mode, sha }]) over the originals: per file its path (relative to the project, `/` separators; none for
 * the store choice, which is `store_choice: true` and lives beside the journal), the database document it belongs to,
 * its original bytes ('absent' when it did not exist) and mode, and the sha256 of the new bytes. Written atomically
 * (mode 0600): a reader sees the whole journal or none. A batch writes only files inside the project (scopeFile).
 */
export function writeFilesJournal(cwd, dbFile, entries) {
  const doc = {
    version: 1,
    note: 'kit db: JSON files being written by one database transaction; removed after its COMMIT. Do not edit',
    written_at: new Date().toISOString(),
    pid: process.pid,
    files: entries.map((e) => ({ e, key: e.storeChoice ? null : scopeKey(cwd, e.file) })).filter(({ key }) => key === null || !path.posix.isAbsolute(key)).map(({ e, key }) => ({
      ...(key === null ? { store_choice: true } : { path: key }),
      ...(e.store ? { store: e.store, scope: e.scope } : {}),
      new_sha256: e.sha,
      original: e.before === null ? 'absent' : { mode: e.mode, base64: e.before.toString('base64') }
    }))
  };
  putFileSync(journalOf(dbFile), Buffer.from(JSON.stringify(doc) + '\n'), 0o600);
}

/** Remove the files journal (after COMMIT, or once every file is restored). */
export function removeFilesJournal(dbFile) {
  fs.rmSync(journalOf(dbFile), { force: true });
}

/** Largest files journal recovery reads, and most files it lists: anything bigger is refused, not parsed. */
export const JOURNAL_MAX_BYTES = 32 * 1024 * 1024;
export const JOURNAL_MAX_FILES = 4096;
const HEX64 = /^[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const TRIAGE_STREAM_FILE = /^\.claude\/marathon\/[^/]+\/triage[^/]*\.json$/;

/** A store file the kit maps for `store` by itself (its default file, or a per-stream triage file), relative with `/`. */
export function kitMappedFile(store, rel) {
  const spec = SPECS[store];
  if (!spec) return false;
  return rel === spec.defaultFile || (store === 'triage' && TRIAGE_STREAM_FILE.test(rel));
}

/** Why `p` is not a usable scope key (a non-empty string, no NUL), or null. */
function scopeProblem(p) {
  if (typeof p !== 'string' || !p || p.length > 4096 || p.includes('\0')) return 'has no usable path';
  return null;
}

/** Why `p` is not a plain project-relative path (no absolute path, no `.`/`..`/empty segment, no backslash), or null. */
function relativeProblem(p) {
  const bad = scopeProblem(p);
  if (bad) return bad;
  if (p.includes('\\') || path.posix.isAbsolute(p) || path.win32.isAbsolute(p) || p.split('/').some((x) => !x || x === '.' || x === '..')) return `path ${JSON.stringify(p.slice(0, 200))} is not a plain path inside the project`;
  return null;
}

/**
 * Why `file` is not inside the project folder, or null: the real path of its deepest existing parent folder, plus the
 * rest of the path, must be inside the project's real path and not inside `.git` (a symbolic link inside the
 * repository, such as a linked `.claude`, is fine as long as it points inside the project). A symbolic link that leads
 * nowhere anywhere on the path counts as outside (what it would create is somewhere else), and so does a file that is
 * itself a symbolic link (the kit's store paths never read or write a store file through a link).
 */
export function outsideProject(cwd, file) {
  const root = projectRoot(cwd);
  const abs = path.resolve(cwd, file);
  try { if (fs.lstatSync(abs).isSymbolicLink()) return `is a symbolic link (${abs}): the kit never reads or writes a store file through a link`; } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') return `cannot be checked (${e.code || e.message})`;
  }
  const r = realThrough(path.dirname(abs));
  if (r.dangling) return `leads through a symbolic link that points nowhere (${r.dangling}), so it is not inside the project folder ${root}`;
  if (!r.real) return r.error;
  const full = path.join(r.real, path.basename(abs));
  if (!inside(root, full)) return `is outside the project folder ${root} (after following symbolic links: ${full})`;
  if (path.relative(root, full).split(path.sep).some((x) => x.toLowerCase() === '.git')) return 'is inside .git';
  return null;
}

/**
 * The scopes this machine's verbs wrote outside the kit's own files (a --store, --ledger or --state path), per store:
 * { store: [scope] }, kept in the per-user store.local.json ("scopes"). Never from the database or the project.
 */
export function registeredScopes(cwd, env = process.env) {
  let v = null;
  try {
    const { config } = storePaths(cwd, env);
    if (!config) return {};
    v = readConfigObject(config);
  } catch { return {}; }
  const out = {};
  const sc = v && v.scopes;
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return out;
  for (const [store, list] of Object.entries(sc)) if (SPECS[store] && Array.isArray(list)) out[store] = list.filter((x) => !scopeProblem(x));
  return out;
}

/**
 * Remember that a verb on this machine wrote `scope` of `store` (a path named on its command line), so export, off and
 * sync may write its file (when it is inside the project, see scopeFile). A no-op for a file the kit maps by itself.
 */
export function registerScope(cwd, store, scope, env = process.env) {
  if (!SPECS[store] || scopeProblem(scope) || kitMappedFile(store, scope)) return;
  const reg = registeredScopes(cwd, env);
  if ((reg[store] || []).includes(scope)) return;
  const { config: file } = ensureStoreDir(cwd, env);
  let cur = {};
  try { cur = readConfigObject(file) || {}; } catch { return; }
  const scopes = { ...reg, [store]: [...(reg[store] || []), scope].sort() };
  writeFileAtomicSync(file, `${JSON.stringify({ ...cur, scopes }, null, 2)}\n`);
}

/** Forget a registered scope (after `db forget`). */
export function unregisterScope(cwd, store, scope, env = process.env) {
  const reg = registeredScopes(cwd, env);
  if (!(reg[store] || []).includes(scope)) return;
  const { config: file } = storePaths(cwd, env);
  if (!file) return;
  let cur = {};
  try { cur = readConfigObject(file) || {}; } catch { return; }
  const scopes = { ...reg, [store]: reg[store].filter((x) => x !== scope) };
  if (!scopes[store].length) delete scopes[store];
  writeFileAtomicSync(file, `${JSON.stringify({ ...cur, scopes }, null, 2)}\n`);
}

/**
 * The file of a document, only through the kit's own mapping, never from a row: { file } or { reason }. The store's
 * default file, a per-stream triage file (`.claude/marathon/<run>/triage*.json`), a scope this machine registered
 * (registerScope), or one of `allow` (paths named on this command line); and inside the project (outsideProject).
 */
export function scopeFile(cwd, store, scope, { allow = [], registered = null, env = process.env } = {}) {
  if (!SPECS[store]) return { reason: 'names no kit store' };
  const bad = scopeProblem(scope);
  if (bad) return { reason: bad };
  const reg = registered || registeredScopes(cwd, env);
  if (!kitMappedFile(store, scope) && !(reg[store] || []).includes(scope) && !allow.includes(scope)) return { reason: `path ${scope} is not a file the kit writes for ${store} (not its default file, a per-stream triage file or a path a verb on this machine wrote)` };
  const file = fileOfScope(cwd, scope);
  const out = outsideProject(cwd, file);
  if (out) return { reason: `path ${scope} ${out}` };
  return { file };
}

/**
 * Check a parsed files journal before anything is restored (defence in depth: it lives in the per-user store folder).
 * Returns null when every entry is one the kit itself writes in a batch, else the problem. An entry is either the
 * store choice (`store_choice: true`, no path, store or scope) or the file of a document: `store` a kit store, `path`
 * a plain project-relative path, `scope` the same path, and a file the kit maps (scopeFile: the store's default file,
 * a per-stream triage file or a scope this machine registered, inside the project). Its new hash is a sha256 (a batch
 * never writes absence); its original is 'absent' or base64 bytes with an optional integer mode. No file twice.
 */
function checkFilesJournal(cwd, j, env) {
  if (!j || typeof j !== 'object' || Array.isArray(j) || j.version !== 1 || !Array.isArray(j.files)) return 'not a kit files journal (version 1 with a files list)';
  if (j.files.length > JOURNAL_MAX_FILES) return `lists ${j.files.length} files, more than ${JOURNAL_MAX_FILES}`;
  const registered = registeredScopes(cwd, env);
  const seen = new Set();
  for (const [i, f] of j.files.entries()) {
    const at = `entry ${i + 1}`;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return `${at} is not an object`;
    let p;
    if (f.store_choice === true) {
      if (f.path !== undefined || f.store !== undefined || f.scope !== undefined) return `${at} is the store choice and names a path or store too`;
      p = CONFIG_NAME;
    } else {
      p = f.path;
      const bad = relativeProblem(p);
      if (bad) return `${at} ${bad}`;
      if (typeof f.store !== 'string' || !SPECS[f.store]) return `${at} names no kit store`;
      if (f.scope !== p) return `${at} scope is not its path ${p}`;
      // the file itself a symbolic link: recovery would read through it; refused (defence in depth)
      try { if (fs.lstatSync(fileOfScope(cwd, p)).isSymbolicLink()) return `${at} the file is a symbolic link (${p})`; } catch { /* absent: fine */ }
      const m = scopeFile(cwd, f.store, p, { registered });
      if (!m.file) return `${at} ${m.reason}`;
    }
    if (seen.has(p)) return `${at} lists ${p} twice`;
    seen.add(p);
    if (typeof f.new_sha256 !== 'string' || !HEX64.test(f.new_sha256)) return `${at} (${p}) has no sha256 for its new bytes`;
    const o = f.original;
    if (o !== 'absent') {
      if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.base64 !== 'string' || !BASE64.test(o.base64)) return `${at} (${p}) original is neither 'absent' nor base64 bytes`;
      if (o.mode !== undefined && o.mode !== null && !(Number.isInteger(o.mode) && o.mode >= 0 && o.mode <= 0o7777)) return `${at} (${p}) original mode is not a file mode`;
    }
  }
  return null;
}

/**
 * Recover a files journal: a run stopped (killed, power loss) after it wrote the journal and before it removed it.
 * Runs in its own BEGIN IMMEDIATE, so it waits for a run still in that window and never undoes a live one.
 * The journal is checked whole first (defence in depth: checkFilesJournal; size and entry count capped, the journal
 * itself never followed through a symbolic link, a file outside the project never written) and on any problem refused:
 * one stderr line names it, nothing is restored, the journal is kept and the verb goes on. When the database holds, for every file of the journal that belongs to a document, the new hash,
 * that run's COMMIT happened: the journal is only removed. Otherwise the COMMIT did not happen: every file whose bytes
 * are still the new ones gets its original bytes back (permission bits only, `& 0o666`) or is removed when it did
 * not exist, a file changed since is left alone and named on stderr (it now differs from the database: drift,
 * `db sync --from-files` merges it), then the journal is removed. Returns { committed, restored, left },
 * { refused } or null when there is no journal.
 */
export function recoverFilesJournal(db, cwd, dbFile, env = process.env) {
  const jf = journalOf(dbFile);
  db.exec('BEGIN IMMEDIATE');
  try {
    // read under the write lock: a run still between its renames and its COMMIT holds it, so it has finished by now
    let j;
    let problem = null;
    try {
      const st = fs.lstatSync(jf);
      if (st.isSymbolicLink()) problem = 'it is a symbolic link';
      else if (!st.isFile()) problem = 'it is not a file';
      else if (st.size > JOURNAL_MAX_BYTES) problem = `it is ${st.size} bytes, more than ${JOURNAL_MAX_BYTES}`;
      else {
        const text = fs.readFileSync(jf, 'utf-8');
        try { j = JSON.parse(text); } catch { problem = 'it is not JSON'; }
      }
    } catch (e) {
      if (e.code === 'ENOENT') { db.exec('COMMIT'); return null; } // that run finished and removed it meanwhile
      problem = `it cannot be read (${e.code || e.message})`;
    }
    if (!problem) problem = checkFilesJournal(cwd, j, env);
    if (problem) {
      db.exec('ROLLBACK');
      process.stderr.write(`kit db: refusing the files journal ${jf}: ${String(problem).slice(0, 300)}; nothing was restored and it is kept (check the JSON files against the database, then remove it)\n`);
      return { refused: problem };
    }
    const tracked = j.files.filter((f) => f.store);
    const committed = tracked.every((f) => {
      const row = db.get('SELECT file_sha256 FROM store_docs WHERE store = ? AND scope = ?', f.store, f.scope);
      return !!row && row.file_sha256 === f.new_sha256;
    });
    const restored = [];
    const left = [];
    if (!committed) {
      for (const f of j.files) {
        const file = f.store_choice ? path.join(path.dirname(dbFile), CONFIG_NAME) : fileOfScope(cwd, f.path);
        const now = fileHash(file);
        if (now !== f.new_sha256) {
          const orig = f.original === 'absent' ? 'absent' : sha256(Buffer.from(f.original.base64, 'base64'));
          if (now !== orig) left.push(f.path ?? CONFIG_NAME);
          continue;
        }
        if (f.original === 'absent') fs.rmSync(file, { force: true });
        else putFileSync(file, Buffer.from(f.original.base64, 'base64'), Number.isInteger(f.original.mode) ? f.original.mode & 0o666 : null);
        restored.push(f.path ?? CONFIG_NAME);
      }
      process.stderr.write(`kit db: a run stopped after writing JSON files and before its database COMMIT; ${restored.length} file(s) put back as they were before it${restored.length ? ` (${restored.join(', ')})` : ''}`
        + `${left.length ? `; left alone because they changed since: ${left.join(', ')} (they now differ from the database: \`db sync --from-files\` merges them)` : ''}\n`);
    }
    removeFilesJournal(dbFile);
    db.exec('COMMIT');
    return { committed, restored, left };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
    throw e instanceof KitExit ? e : invalid(`cannot recover the JSON files listed in ${jf}: ${e.code || String(e && e.message).split('\n')[0]}; it is kept, run the command again`);
  }
}

/**
 * One transaction on the database: `BEGIN IMMEDIATE` for writes, a plain read snapshot otherwise. `onRollback` runs
 * (awaited) when the transaction does not commit, fn's own error or COMMIT's, before ROLLBACK (so still under the
 * write lock, unless SQLite already rolled back on its own) and before the error is thrown on;
 * `onCommit` runs (awaited) right after COMMIT.
 */
export function withDb(ctx, fn, { write = true, onRollback, onCommit } = {}) {
  return serial(ctx.dbFile, async () => {
    const db = openDb(ctx);
    try {
      db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      let r;
      try {
        r = await fn(db);
        db.exec('COMMIT');
      } catch (e) {
        // put the files back while this run still holds the write lock (ROLLBACK releases it): a writer waiting in
        // BEGIN IMMEDIATE never sees half-restored files, nor has its own committed files overwritten by this restore
        try { if (onRollback) await onRollback(e); } finally { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } }
        throw e;
      }
      if (onCommit) await onCommit();
      return r;
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
 * `fileSha` (a hash, 'absent' or null) sets the file hash it was synced with, and `synced` the document that file held
 * (the merge base: an object, 'absent', or null for unknown; a fileSha of 'absent' means 'absent'); left out, an
 * existing row keeps its own.
 */
export function putDoc(db, name, scope, doc, fileSha, synced) {
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
    db.run('INSERT INTO store_docs (store, scope, data, updated_at, file_sha256, synced_doc) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (store, scope) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, file_sha256 = excluded.file_sha256, synced_doc = excluded.synced_doc',
      name, scope, JSON.stringify({ keys, fields }), new Date().toISOString(), fileSha, encodeSynced(fileSha, synced));
  }
}

function encodeSynced(fileSha, synced) {
  if (fileSha === 'absent' || synced === 'absent') return 'absent';
  if (synced && typeof synced === 'object' && !Array.isArray(synced)) return JSON.stringify(synced);
  return null;
}

/**
 * The merge base of a scope: the document as last synced with its file; {} when there was no file then (nothing was
 * shared yet); null when unknown (no stored document, or synced by a kit older than schema 4).
 */
export function getBase(db, name, scope) {
  const row = db.get('SELECT file_sha256, synced_doc FROM store_docs WHERE store = ? AND scope = ?', name, scope);
  if (!row) return null;
  if (row.synced_doc === 'absent' || (row.synced_doc == null && row.file_sha256 === 'absent')) return {};
  if (row.synced_doc == null) return null;
  try { return JSON.parse(row.synced_doc); } catch { return null; }
}

/** Why a document does not fit its store's layout (a part that is not a list / an object), or null. As putDoc checks. */
export function shapeProblem(name, doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'is not a JSON object';
  for (const p of SPECS[name].parts) {
    const v = doc[p.field];
    if (v === undefined) continue;
    if (p.kind === 'array' ? !Array.isArray(v) : (!v || typeof v !== 'object' || Array.isArray(v))) return `${p.field} is not ${p.kind === 'array' ? 'a list' : 'an object'}`;
  }
  return null;
}

/** Remove one document (all its rows). */
export function deleteDoc(db, name, scope) {
  for (const p of SPECS[name].parts) db.run(`DELETE FROM ${p.table} WHERE ${SCOPE_COL[p.table]} = ?`, scope);
  db.run('DELETE FROM store_docs WHERE store = ? AND scope = ?', name, scope);
}

/**
 * A store file's bytes for the SQLite store's own paths (import, export, sync, drift, the files journal), never
 * through a final symbolic link: lstat, then open with O_NOFOLLOW where the platform has it. A link is an error with
 * code ELOOP; a missing file ENOENT.
 */
export function readStoreFile(file) {
  let st = null;
  try { st = fs.lstatSync(file); } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e; }
  if (st && st.isSymbolicLink()) throw Object.assign(new Error(`${file} is a symbolic link`), { code: 'ELOOP' });
  try { return readNoFollowSync(file); } catch (e) { if (e.code === 'ENOTDIR') e.code = 'ENOENT'; throw e; }
}

/** The message for a store file the SQLite store will not read or write because it is a symbolic link. */
const linkRefusal = (file) => `${file} is a symbolic link: the kit's SQLite store never reads or writes a store file through a link (it could lead out of the project); replace the link with the file itself`;

/** The sha256 of a file's bytes, or 'absent' when it does not exist. A symbolic link is exit 1 (readStoreFile). */
export function fileHash(file) {
  let buf;
  try { buf = readStoreFile(file); } catch (e) {
    if (e.code === 'ENOENT') return 'absent';
    if (e.code === 'ELOOP') throw invalid(linkRefusal(file));
    throw invalid(`cannot read ${file}: ${e.code || e.message}`);
  }
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * readJsonState's semantics (fallback when missing, a BOM skipped, UTF-16 and bad JSON refused with fixed texts) for
 * the SQLite store's own reads of a store file, never through a symbolic link (exit 1).
 */
export async function readJsonNoFollow(file, { fallback } = {}) {
  let buf;
  try { buf = readStoreFile(file); } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (err.code === 'ENOENT') throw invalid(`${file} does not exist`);
    if (err.code === 'ELOOP') throw invalid(linkRefusal(file));
    throw invalid(`cannot read ${file}: ${err.code || err.message}`);
  }
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) throw invalid(`${file} is UTF-16; save it as UTF-8`);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  try { return JSON.parse(buf.toString('utf-8')); } catch { throw invalid(`${file} is not valid JSON`); }
}

/** Record the hash of a scope's file as it is now and the document it holds (after an import, export or sync). */
export function setFileHash(db, name, scope, sha, synced) {
  db.run('UPDATE store_docs SET file_sha256 = ?, synced_doc = ? WHERE store = ? AND scope = ?', sha, encodeSynced(sha, synced), name, scope);
}

/** The file changed since the database last synced it: { scope, file } or null. A missing file is not drift. */
export function driftOf(db, name, scope, file) {
  const row = db.get('SELECT file_sha256 FROM store_docs WHERE store = ? AND scope = ?', name, scope);
  if (!row || row.file_sha256 == null) return null; // not in the database yet, or synced before hashes were kept
  const now = fileHash(file);
  if (now === 'absent' || now === row.file_sha256) return null;
  return { store: name, scope, file };
}

/** A file's document for a drift report: the parsed object, or { error } when it is not a JSON object. */
export function readFileDoc(file) {
  let text;
  try { text = readStoreFile(file).toString('utf-8'); } catch (e) { return { error: e.code === 'ENOENT' ? 'does not exist' : e.code === 'ELOOP' ? 'is a symbolic link' : (e.code || e.message) }; }
  let v;
  try { v = JSON.parse(text.replace(/^﻿/, '')); } catch { return { error: 'is not valid JSON' }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'is not a JSON object' };
  return { doc: v };
}

// ---------------------------------------------------------------- merge (drift recovery)

/** Timestamp fields a row may carry; the newest one dates the row. */
const STAMP_FIELDS = Object.freeze(['updated_at', 'retired_at', 'decided_at', 'closed_at', 'last_kept', 'created_at', 'added']);
function stampOf(item) {
  if (!item || typeof item !== 'object') return null;
  let best = null;
  for (const k of STAMP_FIELDS) {
    const v = item[k];
    if (typeof v !== 'string') continue;
    const ms = Date.parse(v);
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms;
  }
  return best;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The rows of one collection as [[key, item]]: a map by its keys, a list by `id` (+ occurrence), else by content. */
function keyedRows(kind, v) {
  if (kind === 'map') return v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v) : [];
  if (!Array.isArray(v)) return [];
  const seen = new Map();
  return v.map((item) => {
    const base = item && typeof item === 'object' && (typeof item.id === 'string' || typeof item.id === 'number') ? `id:${item.id}` : `json:${JSON.stringify(item)}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return [n ? `${base}#${n}` : base, item];
  });
}
const rowId = (kind, key, item) => (kind === 'map' ? key : (item && typeof item === 'object' && item.id != null ? String(item.id) : key.replace(/^json:/, '').slice(0, 80)));

/** Same row on both sides of a pair: every identity field present (a string) and equal. */
function sameIdentity(part, a, b) {
  if (!part.identity) return true;
  return part.identity.every((k) => typeof a?.[k] === 'string' && a[k] === b?.[k]);
}

/**
 * A row that took the id of a base row but is another row (lessons: created_at or session differs from the base's):
 * a side that deleted the base row and then made a new one, which got the freed id (reflect's next id is max + 1).
 */
function otherIdentity(part, base, item) {
  if (!part.identity || !part.renumber) return false;
  return part.identity.some((k) => typeof base?.[k] === 'string' && typeof item?.[k] === 'string' && base[k] !== item[k]);
}

/**
 * The ids a list part holds more than once ([{ part, id }]): sync and init refuse such a file, because the merge
 * matches rows by id and every verb refuses a store with a duplicate id.
 */
export function duplicateIds(name, doc) {
  const out = [];
  for (const p of SPECS[name]?.parts || []) {
    if (p.kind !== 'array' || !Array.isArray(doc?.[p.field])) continue;
    const seen = new Set();
    const dup = new Set();
    for (const item of doc[p.field]) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const id = String(item.id);
      if (seen.has(id)) dup.add(id);
      seen.add(id);
    }
    for (const id of dup) out.push({ part: p.field, id });
  }
  return out;
}

/**
 * Merge a scope's file document and its database document, row by row (by `id` in a list, by key in a map), against
 * `base`, the document as last synced with the file (getBase: an object, {} when there was no file, null when unknown).
 *
 * With a base (three-way), for each row:
 * - identical on both sides: one row (unchanged);
 * - in the base and changed on one side only: that side's version (a file edit is `updated`, a database edit `kept`);
 *   deleted on one side and unchanged on the other: deleted (listed in `deleted` with the side that deleted it and
 *   the row); changed on one side and deleted on the other: the edit is kept, listed as a conflict;
 * - in the base and changed on both sides: a conflict, the side with the newer timestamp field wins (updated_at,
 *   retired_at, last_kept, ...), else the database's;
 * - not in the base, on one side only: added on that side, kept (`added` from the file, `kept` from the database);
 * - not in the base, on both sides with different content: two rows that took the same new id (an ID COLLISION) when
 *   the store renumbers (lessons: identity fields created_at and session differ): both are kept, the file's row keeps
 *   its id (it is committed and shared) and the database's gets the next free id (listed in `renumbered`); otherwise
 *   (same identity, or a store whose id names the thing itself: a noise-ledger finding id, a triage fingerprint) one
 *   row edited on both sides: a conflict as above.
 * A row in the base whose id a side gave to ANOTHER row (lessons: created_at or session differs from the base row's;
 * the side deleted the base row, then a new lesson took the freed id) is, on that side, a deletion of the base row
 * plus a new row: the base row's fate follows the rules above, and when both it and the new row survive, the new row
 * of the file keeps the id and the database's row gets the next free id (listed in `renumbered`). Two different rows
 * are never merged into one.
 * Without a base (a database synced by an older kit): the union, nothing deleted; a pair with different content is a
 * collision or a conflict by the same identity rule.
 * Every conflict's losing row goes to `discarded` in full. Top-level fields keep the database's value; one only the
 * file has is added.
 * Returns { doc, kept, added, updated, unchanged, conflicts: [{ part, id, kept: 'database'|'file', reason }],
 *   deleted: [{ part, id, deleted_in: 'file'|'database', row }], renumbered: [{ part, from, to }],
 *   discarded: [{ part, id, side, row }], file_only: [{ part, id }] (the file rows the database does not have),
 *   edited_in_file: [{ part, id }] (rows in the base changed in the file only) }.
 */
export function mergeDocs(name, dbDoc, fileDoc, base = null) {
  const spec = SPECS[name];
  const out = { kept: 0, added: 0, updated: 0, unchanged: 0, conflicts: [], deleted: [], renumbered: [], discarded: [], file_only: [], edited_in_file: [] };
  if (!dbDoc) {
    for (const p of spec.parts) for (const [key, item] of keyedRows(p.kind, fileDoc[p.field])) { out.added++; out.file_only.push({ part: p.field, id: rowId(p.kind, key, item) }); }
    return { doc: JSON.parse(JSON.stringify(fileDoc)), ...out };
  }
  const doc = JSON.parse(JSON.stringify(dbDoc));
  for (const k of Object.keys(fileDoc)) if (!Object.hasOwn(doc, k)) doc[k] = JSON.parse(JSON.stringify(fileDoc[k]));
  for (const p of spec.parts) {
    const baseRows = base ? keyedRows(p.kind, base[p.field]) : [];
    const baseByKey = base ? new Map(baseRows) : null;
    // a side's row that reused a base row's id for another row: on that side the base row is deleted, this one is new
    const rekey = (rows) => (baseByKey ? rows.map(([key, item]) => (baseByKey.has(key) && otherIdentity(p, baseByKey.get(key), item) ? [`new:${key}`, item] : [key, item])) : rows);
    const fileRows = rekey(keyedRows(p.kind, fileDoc[p.field]));
    if (!fileRows.length && doc[p.field] === undefined) continue;
    const dbRows = rekey(keyedRows(p.kind, doc[p.field]));
    const fileByKey = new Map(fileRows);
    const dbByKey = new Map(dbRows);
    const merged = [];
    const collided = [];
    const idOf = (key, item) => rowId(p.kind, key, item);
    const conflict = (key, d, f, why) => {
      const a = stampOf(d);
      const b = stampOf(f);
      const fileWins = a !== null && b !== null && b > a;
      out.conflicts.push({ part: p.field, id: idOf(key, d), kept: fileWins ? 'file' : 'database', reason: why || (a !== null && b !== null ? (fileWins ? 'the file row is newer' : (b < a ? 'the database row is newer' : 'same timestamp: the database row')) : 'no timestamp on both sides: the database row') });
      out.discarded.push({ part: p.field, id: idOf(key, d), side: fileWins ? 'database' : 'file', row: fileWins ? d : f });
      merged.push([key, fileWins ? f : d, fileWins ? 'file' : 'database']);
    };
    for (const [key, d] of dbRows) {
      const inFile = fileByKey.has(key);
      const f = fileByKey.get(key);
      if (inFile && same(d, f)) { out.unchanged++; merged.push([key, d, 'both']); continue; }
      if (baseByKey && baseByKey.has(key)) {
        const b = baseByKey.get(key);
        if (!inFile) {
          if (same(d, b)) { out.deleted.push({ part: p.field, id: idOf(key, d), deleted_in: 'file', row: d }); continue; }
          out.conflicts.push({ part: p.field, id: idOf(key, d), kept: 'database', reason: 'changed in the database, deleted in the file: the edit is kept' });
          out.kept++;
          merged.push([key, d, 'database']);
          continue;
        }
        if (same(d, b)) { out.updated++; out.edited_in_file.push({ part: p.field, id: idOf(key, f) }); merged.push([key, f, 'file']); continue; }
        if (same(f, b)) { out.kept++; merged.push([key, d, 'database']); continue; }
        conflict(key, d, f);
        continue;
      }
      if (!inFile) { out.kept++; merged.push([key, d, 'database']); continue; }
      // not in the base, on both sides, different: the same id taken twice, or one row edited on both sides
      if (p.renumber && !sameIdentity(p, d, f)) {
        out.added++;
        out.file_only.push({ part: p.field, id: idOf(key, f) });
        merged.push([key, f, 'file']);
        collided.push(d);
        continue;
      }
      conflict(key, d, f);
    }
    for (const [key, f] of fileRows) {
      if (dbByKey.has(key)) continue;
      if (baseByKey && baseByKey.has(key)) {
        if (same(f, baseByKey.get(key))) { out.deleted.push({ part: p.field, id: idOf(key, f), deleted_in: 'database', row: f }); continue; }
        out.conflicts.push({ part: p.field, id: idOf(key, f), kept: 'file', reason: 'changed in the file, deleted in the database: the edit is kept' });
        out.file_only.push({ part: p.field, id: idOf(key, f) });
        merged.push([key, f, 'file']);
        continue;
      }
      out.added++;
      out.file_only.push({ part: p.field, id: idOf(key, f) });
      merged.push([key, f, 'file']);
    }
    if (p.renumber && p.kind === 'array') {
      // a base row kept on one side and a new row that reused its id on the other: two rows, one id. The file's
      // keeps the id; the database's is renumbered with the collisions below.
      const fileIds = new Set(merged.filter(([, , o]) => o !== 'database').map(([, x]) => String(x?.id)));
      for (let i = merged.length - 1; i >= 0; i--) {
        const [, x, o] = merged[i];
        if (o === 'database' && x?.id != null && fileIds.has(String(x.id))) { collided.unshift(x); merged.splice(i, 1); }
      }
    }
    if (collided.length) {
      // the next free id after every id either side or the base ever used (a deleted id is not reused)
      const used = [...dbRows, ...fileRows, ...baseRows].map(([, x]) => x?.id).filter((x) => x != null);
      for (const d of collided) {
        const to = p.renumber(used);
        used.push(to);
        out.renumbered.push({ part: p.field, from: String(d.id), to });
        merged.push([`id:${to}`, Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === 'id' ? to : v]))]);
      }
    }
    doc[p.field] = p.kind === 'map' ? Object.fromEntries(merged) : merged.map(([, item]) => item);
  }
  return { doc, ...out };
}

/** What to do with a store file that is not a usable JSON object (a git conflict, a bad edit): never move it away. */
export const REPAIR_ADVICE = 'repair the file in place (after a git pull with a conflict: resolve the conflict markers and keep the rows of both sides; where both sides added the same id, keep both rows and give one of them '
  + 'the next free id, the highest id in the file plus one); '
  + 'do not move it away: a moved file is not drift, so the next export would write the database copy over it and the other side\'s rows would never reach the database';

/** The drift message for one scope: what `db sync --from-files` (merge) and `db export --overwrite` (replace) do to it. */
export function driftMessage(scope, detail = {}) {
  if (detail.error) {
    return `${scope} changed since the database last synced (a git pull?) and ${detail.error}: ${REPAIR_ADVICE}; `
      + 'then run `db sync --from-files` to merge it with the database';
  }
  const n = detail.file_only ? detail.file_only.length : null;
  const ids = idList(detail.file_only);
  const c = detail.conflicts ? detail.conflicts.length : 0;
  const e = detail.edited_in_file || [];
  const r = detail.deleted_in_file || [];
  return `${scope} changed since the database last synced (a git pull?): run \`db sync --from-files\` to MERGE the file into the database by row id `
    + '(three-way, against the copy last synced: changes and additions from both sides are taken, a row deleted on one side and unchanged on the other is deleted, '
    + 'two different rows that took the same new id are both kept and the database\'s is renumbered, a row changed on both sides keeps the newer one, else the database\'s; '
    + 'every deletion, renumbering and conflict is listed). '
    + `\`db export --overwrite\` instead REPLACES the file with the database and drops ${n === null ? 'every' : n} file-only row(s)${ids}`
    + `${c ? ` and the file's side of ${c} conflicting row(s)${idList(detail.conflicts)}` : ''}`
    + `${e.length ? `, reverts ${e.length} edit(s) made in the file${idList(e)}` : ''}`
    + `${r.length ? `, restores ${r.length} row(s) deleted in the file${idList(r)}` : ''}`
    + (detail.base === null
      ? '; the database has no copy of the file as last synced (synced by an older kit), so which edits and deletions made in the file it would also revert is unknown'
      : '');
}

/** ` (id, id, ...)` for a list of { id }, or '' when it is empty. */
export function idList(list, max = 10) {
  if (!list || !list.length) return '';
  return ` (${list.slice(0, max).map((x) => x.id).join(', ')}${list.length > max ? ', ...' : ''})`;
}

/**
 * The drift detail of a drifted scope: { error }, or what `db export --overwrite` would undo, found by running the
 * sync merge against the stored base: { file_only (rows only the file has: dropped), conflicts (the file's side is
 * replaced), edited_in_file (edits made in the file only: reverted), deleted_in_file (rows the file deleted: restored),
 * base (the base, null when unknown: then the edits and deletions cannot be told) }.
 */
export function driftDetail(db, name, scope, file) {
  const f = readFileDoc(file);
  if (f.error) return { error: f.error };
  const base = getBase(db, name, scope);
  const m = mergeDocs(name, getDoc(db, name, scope), f.doc, base);
  return {
    file_only: m.file_only,
    conflicts: m.conflicts,
    edited_in_file: m.edited_in_file,
    deleted_in_file: m.deleted.filter((d) => d.deleted_in === 'file').map((d) => ({ part: d.part, id: d.id })),
    base: base === null ? null : 'known'
  };
}

function assertNoDrift(db, name, scope, file) {
  const d = driftOf(db, name, scope, file);
  if (d) throw invalid(driftMessage(scope, driftDetail(db, name, scope, file)));
}

/** Load for the sqlite store: the database's document, else the JSON file still on disk, else fallback / error. */
async function loadFromDb(db, name, file, scope, opts) {
  const doc = getDoc(db, name, scope);
  if (doc !== null) return doc;
  return readJsonNoFollow(file, opts);
}

/** Thrown inside a lock or transaction when the store choice changed since the call resolved it: run again. */
export class StoreSwitched extends Error {}
const SWITCH_RETRIES = 5;

/**
 * Read a verb's document without changing anything: the JSON file (readJsonState semantics: `fallback` when it does
 * not exist, else "<file> does not exist") or the database row set for its scope.
 */
export async function readDoc(io, name, file, opts = {}) {
  // an error of the store itself (no engine, no suite.db, drift, an untrusted database) carries `store: true`, so a
  // verb that labels its own file's errors ("corrupt or unreadable") passes it on as it is; the file's own do not
  const fromFile = (e) => { if (e instanceof KitExit) e.stateFile = true; throw e; };
  try {
    const ctx = await resolveStore(ioCtx(io));
    if (ctx.kind === 'json') return await readJsonState(file, opts).catch(fromFile);
    const scope = scopeKey(ctx.cwd, file);
    return await withDb(ctx, (db) => {
      assertNoDrift(db, name, scope, file);
      return loadFromDb(db, name, file, scope, opts).catch(fromFile);
    }, { write: false });
  } catch (e) {
    if (e instanceof KitExit && !e.stateFile) e.store = true;
    throw e;
  }
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
          if (readConfig(ctx.cwd, ctx.env).store !== 'json') throw new StoreSwitched();
          return fn({ load: (opts = {}) => readJsonState(file, opts), save: (doc) => writeJsonAtomic(file, doc) });
        }, lockOpts);
      }
      const scope = scopeKey(ctx.cwd, file);
      return await withDb(ctx, (db) => {
        // `db off` holds the write transaction until it has switched the store: a writer that waited goes to the file
        if (readConfig(ctx.cwd, ctx.env).store !== 'sqlite') throw new StoreSwitched();
        assertNoDrift(db, name, scope, file);
        return fn({
          load: (opts = {}) => loadFromDb(db, name, file, scope, opts),
          save: async (doc) => {
            // a path named on this command line (--store, --ledger, --state): export / off / sync may write its file
            registerScope(ctx.cwd, name, scope, ctx.env);
            const known = db.get('SELECT 1 AS x FROM store_docs WHERE store = ? AND scope = ?', name, scope);
            // the first write of a scope read from its file: remember the file it came from (its hash and document)
            if (known) putDoc(db, name, scope, doc);
            else {
              const sha = fileHash(file);
              putDoc(db, name, scope, doc, sha, sha === 'absent' ? 'absent' : (readFileDoc(file).doc ?? null));
            }
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

/**
 * `npx danizee-claude-suite db init` runs the package's kit, but the project's workflows run its installed copy,
 * `.claude/helpers/kit`. An installed kit with no store.js predates the store: it would keep writing the JSON files
 * behind a database (split state). Returns null when switching is safe, else the reason and the fix.
 */
export function installedKitProblem(cwd) {
  const kitDir = path.join(cwd, '.claude', 'helpers', 'kit');
  if (!fs.existsSync(kitDir) || fs.existsSync(path.join(kitDir, 'store.js'))) return null;
  return `this project's installed kit (.claude/helpers/kit) has no store.js: it predates the SQLite store and would keep writing the JSON files behind the database. `
    + 'Reinstall / update the kit first (`npx danizee-claude-suite update`), then run `db init` again; nothing was changed';
}

/**
 * Add the `rules` a project's .gitignore lacks, under one `# comment` line; returns the rules added. Used by the kit
 * installer (the project it installs into) and by `db init` (the store marker's rule, with `noFollow`). `noFollow`: a
 * .gitignore that is a symbolic link (or not a regular file) is left alone and the rules are returned in `refused`
 * instead (`db init` runs in a repository it did not write: a linked .gitignore could lead out of the project).
 */
export async function addGitignoreRules(dir, rules, comment, { noFollow = false } = {}) {
  const gi = path.join(dir, '.gitignore');
  if (noFollow) {
    try {
      const st = await fsp.lstat(gi);
      if (!st.isFile()) return Object.assign([], { refused: [...rules] });
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  let current = '';
  try { current = await fsp.readFile(gi, 'utf-8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const have = new Set(current.split('\n').map((l) => l.trim()));
  const missing = rules.filter((r) => !have.has(r));
  if (missing.length) {
    const sep = current.length && !current.endsWith('\n') ? '\n' : '';
    await fsp.writeFile(gi, `${current}${sep}\n# ${comment}\n${missing.join('\n')}\n`, 'utf-8');
  }
  return missing;
}

/** The one line `danizee-claude-suite check` prints: { store, engine, ok, fatal, line, fix }. */
export async function storeCheck({ cwd = process.cwd(), env = process.env } = {}) {
  let cfg;
  try { cfg = readConfig(cwd, env); } catch (e) {
    return { store: null, engine: null, ok: false, fatal: true, line: `kit store: ${e.message}`, fix: 'as the message says (the store choice and the store folder are this machine\'s, outside the project)' };
  }
  if (cfg.store === 'json') {
    // probed, not loaded: a project on the JSON files never runs code from its own folder here
    const probe = probeEngine({ env });
    return { store: 'json', engine: probe.name, ok: true, fatal: false, line: `kit store: json files${probe.name ? ` (sqlite engine ${probe.name} available, not loaded; \`db init\` to switch)` : ' (no sqlite engine available; json needs none)'}` };
  }
  const engine = await loadEngine({ env });
  if (!engine.name) return { store: 'sqlite', engine: null, ok: false, fatal: true, line: `kit store: sqlite, but no engine loads (${engine.errors.join('; ')})`, fix: ENGINE_FIX };
  const dbFile = cfg.paths.db;
  if (!fs.existsSync(dbFile)) return { store: 'sqlite', engine: engine.name, ok: false, fatal: true, line: `kit store: sqlite (${engine.name}), but its database ${dbFile} is missing`, fix: MISSING_FIX };
  return { store: 'sqlite', engine: engine.name, ok: true, fatal: false, line: `kit store: sqlite ${dbFile} (engine ${engine.name} loads)` };
}
