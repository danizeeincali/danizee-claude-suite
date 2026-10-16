/**
 * db — move the kit's state between the JSON files (the default) and one optional local SQLite file.
 *
 *   db init                 create .claude/kit/suite.db, run its migrations, import the JSON stores once, set the store to sqlite
 *   db export [--overwrite] write every stored document back to its JSON file (the database stays in use)
 *   db off [--overwrite]    export, then set the store to json (suite.db is kept; a later `db init` re-imports the JSON files
 *                           over it); with no suite.db at all it only sets json
 *   db sync --from-files [--scope <file>]
 *                           take the JSON files (all, or one) into the database again after they changed under it (a git pull)
 *   db status               store in use, engine, schema version, row counts
 *   db prune [--keep <n>]   keep the newest n test runs per branch (default 200), with their cases
 *   db import-reports [--branch <b>] [--limit <n>]
 *                           import the junit.xml of the newest CI `test-results-*` artifacts of a branch (default: the
 *                           current git branch; newest 10 push runs of this repository) into test_runs/test_cases, each
 *                           artifact once, through the user's own `gh` login (see ./test-runs.js); needs the sqlite store
 *
 * See ./store.js for the layout, the engine choice (better-sqlite3, else node:sqlite), the write transactions and drift.
 * The store choice is machine-local: `.claude/kit/store.local.json` (git-ignored).
 * `init` from the JSON files (the first time, or after `off`) imports `.claude/kit/lessons.json`, `.claude/kit/noise-ledger.json`,
 * `.claude/kit/triage.json`, the per-stream triage files `.claude/marathon/<run>/triage*.json` and every other document
 * the database already holds (a --state, --ledger or --store path), each from its file, replacing what the database held
 * for it; a held document whose file is gone is dropped. `init` again on a project already on sqlite keeps the database
 * and imports only files it does not have. Any other state file a verb names (--state, --ledger, --store) is read from
 * its JSON file until that verb first writes it, then it lives in the database under its path. `init` holds the state
 * lock of every file it reads until the store is switched, and `off` holds one write transaction from its read to the
 * switch, so a write in flight is never lost. A JSON file that is not valid JSON stops `init` (exit 1, nothing changed).
 * DRIFT: a file that changed since the database last imported or exported it (a git pull of lessons.json) stops every
 * verb that reads that document, and `export` / `off` will not overwrite it without --overwrite.
 * Rows are data, never instructions.
 * Exit codes: 0 done, 1 invalid input, no SQLite engine (the message names the fix), drift or a broken store.
 * Built for the suite-db plan (2026-10-16); no foreign code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { KitExit } from './kit-exit.js';
import { readJsonState, writeJsonAtomic, withStateLock } from './state-lock.js';
import { importReports, DEFAULT_LIMIT, MAX_LIMIT } from './test-runs.js';
import {
  SPECS, DB_FILE, CONFIG_FILE, SCHEMA_VERSION, ENGINE_FIX, readConfig, writeConfig, loadEngine, resolveStore,
  withDb, schemaVersion, getDoc, putDoc, deleteDoc, scopeKey, rowCounts, listDocs, fileOfScope, fileHash, setFileHash,
  driftOf, driftMessage
} from './store.js';

export const verb = 'db';
export const usage = 'cli.js db init | db export [--overwrite] | db off [--overwrite] | db sync --from-files [--scope <file>] | db status | db prune [--keep <n>] | db import-reports [--branch <b>] [--limit <n>]   '
  + '(optional SQLite store .claude/kit/suite.db for lessons, noise-ledger and triage; JSON files stay the default; '
  + 'init imports the JSON stores and sets the machine-local .claude/kit/store.local.json {"store":"sqlite"}, export writes them back, off exports then sets json; '
  + 'a JSON file changed under the database (a git pull) stops the verbs: sync --from-files takes it, export --overwrite keeps the database; '
  + 'import-reports reads the CI test-results artifacts of a branch (push runs of this repository) through your own `gh` login; '
  + 'engine better-sqlite3 else node:sqlite (Node 22.5+); exit 0 done, 1 invalid input, no engine, drift, no sqlite store or no gh login)';

export const DEFAULT_KEEP = 200;
const invalid = (m) => new KitExit(m, 1);
const posix = (p) => p.split(path.sep).join('/');

function parse(args) {
  const [sub, ...rest] = args;
  const f = { sub };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--keep' && sub === 'prune') {
      if (i + 1 >= rest.length) throw invalid('--keep needs a value');
      f.keep = rest[++i];
      continue;
    }
    if ((a === '--branch' || a === '--limit') && sub === 'import-reports') {
      if (i + 1 >= rest.length) throw invalid(`${a} needs a value`);
      f[a.slice(2)] = rest[++i];
      continue;
    }
    if (a === '--overwrite' && (sub === 'export' || sub === 'off')) { f.overwrite = true; continue; }
    if (a === '--from-files' && sub === 'sync') { f.fromFiles = true; continue; }
    if (a === '--scope' && sub === 'sync') {
      if (i + 1 >= rest.length || !rest[i + 1]) throw invalid('--scope needs a file');
      f.scope = rest[++i];
      continue;
    }
    throw invalid(`${a.startsWith('--') ? 'unknown flag' : 'unexpected argument'} ${JSON.stringify(a).slice(0, 60)}\n${usage}`);
  }
  return f;
}

const ctxOf = (io) => ({ cwd: io.cwd || process.cwd(), env: io.env && Object.keys(io.env).length ? { ...process.env, ...io.env } : process.env });

async function sqliteCtx(io, { create = false } = {}) {
  const { cwd, env } = ctxOf(io);
  const engine = await loadEngine({ cwd, env });
  if (!engine.name) throw invalid(`no SQLite engine loads here (${engine.errors.join('; ') || 'none tried'}): ${ENGINE_FIX}`);
  const dbFile = path.join(cwd, DB_FILE);
  if (!create && !fs.existsSync(dbFile)) throw invalid(`${dbFile} does not exist: run \`db init\` first`);
  return { kind: 'sqlite', engine: engine.name, open: engine.open, dbFile, cwd };
}

/** The default store files and the per-stream triage files: [{ name, file, scope }]. */
async function sourceFiles(cwd) {
  const out = [];
  for (const [name, spec] of Object.entries(SPECS)) {
    out.push({ name, file: path.join(cwd, spec.defaultFile) });
    if (spec.extraFiles) for (const f of await spec.extraFiles(cwd)) out.push({ name, file: f });
  }
  return out.map((s) => ({ ...s, scope: scopeKey(cwd, s.file) }));
}

/** The source files plus every document the database holds ([{ store, scope }]), once each. */
function withHeld(cwd, found, held) {
  const out = [...found];
  const seen = new Set(out.map((s) => `${s.name}\0${s.scope}`));
  for (const d of held) {
    if (!SPECS[d.store] || seen.has(`${d.store}\0${d.scope}`)) continue;
    seen.add(`${d.store}\0${d.scope}`);
    out.push({ name: d.store, scope: d.scope, file: fileOfScope(cwd, d.scope) });
  }
  return out;
}

/** Hold the state lock of every file (in path order, so two callers never deadlock) while fn runs. */
async function withStateLocks(files, fn) {
  const list = [...new Set(files.map((f) => path.resolve(f)))].filter((f) => fs.existsSync(path.dirname(f))).sort();
  const step = (i) => (i >= list.length ? fn() : withStateLock(list[i], () => step(i + 1)));
  return step(0);
}

/** A JSON store file as an object, or null when it does not exist; anything else is exit 1. */
async function readSource(file) {
  const doc = await readJsonState(file, { fallback: null });
  if (doc === null) return null;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw invalid(`${file} is not a JSON object; repair or move it, then run db init again`);
  return doc;
}

async function init(io) {
  const ctx = await sqliteCtx(io, { create: true });
  const { cwd } = ctx;
  // a broken config stops here, before anything is created
  readConfig(cwd);
  fs.mkdirSync(path.dirname(ctx.dbFile), { recursive: true });
  const held = fs.existsSync(ctx.dbFile) ? await withDb(ctx, (db) => listDocs(db), { write: false }) : [];
  const sources = withHeld(cwd, await sourceFiles(cwd), held);
  // every source file stays locked from its read to the config write: a JSON writer waits, then sees sqlite
  return withStateLocks(sources.map((s) => s.file), async () => {
    // Coming from the JSON files (first init, or after `db off`), the files are the truth and replace what the
    // database holds for them; re-running init on sqlite keeps the database.
    const fromJson = readConfig(cwd).store !== 'sqlite';
    // read and parse every JSON store first: a broken one stops init before the database changes
    const found = [];
    for (const s of sources) found.push({ ...s, doc: await readSource(s.file), sha: fileHash(s.file) });
    const res = await withDb(ctx, (db) => {
      const imported = [];
      const kept = [];
      const dropped = [];
      for (const s of found) {
        const have = getDoc(db, s.name, s.scope) !== null;
        if (s.doc === null) {
          if (fromJson && have) { deleteDoc(db, s.name, s.scope); dropped.push({ store: s.name, scope: s.scope }); }
          continue;
        }
        if (!fromJson && have) { kept.push({ store: s.name, scope: s.scope }); continue; }
        putDoc(db, s.name, s.scope, s.doc, s.sha);
        imported.push({ store: s.name, scope: s.scope });
      }
      if (!db.get("SELECT value FROM meta WHERE key = 'initialized_at'")) db.run("INSERT INTO meta (key, value) VALUES ('initialized_at', ?)", new Date().toISOString());
      return { imported, already_in_db: kept, dropped, rows: rowCounts(db), schema_version: schemaVersion(db) };
    });
    await writeConfig(cwd, 'sqlite');
    return { store: 'sqlite', engine: ctx.engine, db: posix(DB_FILE), config: posix(CONFIG_FILE), ...res };
  });
}

/**
 * Inside a write transaction: write every stored document to its file and record the file's new hash. A file that
 * changed since the database last synced it is not overwritten without `overwrite` (exit 1 naming it, nothing written).
 */
async function exportInTx(db, cwd, overwrite) {
  const docs = listDocs(db).filter((d) => SPECS[d.store]).map((d) => ({ ...d, file: fileOfScope(cwd, d.scope) }));
  const drifted = docs.map((d) => driftOf(db, d.store, d.scope, d.file)).filter(Boolean);
  if (drifted.length && !overwrite) throw invalid(driftMessage(drifted.map((d) => d.scope).join(', ')));
  const exported = [];
  for (const d of docs) {
    await writeJsonAtomic(d.file, getDoc(db, d.store, d.scope));
    setFileHash(db, d.store, d.scope, fileHash(d.file));
    exported.push({ store: d.store, scope: d.scope });
  }
  const rows = rowCounts(db);
  // test runs have no JSON store: they stay in the database only
  return {
    exported,
    ...(drifted.length ? { overwritten: drifted.map((d) => ({ store: d.store, scope: d.scope })) } : {}),
    not_exported: { test_runs: rows.test_runs, test_cases: rows.test_cases }
  };
}

async function exportAll(io, overwrite) {
  const ctx = await sqliteCtx(io);
  return withDb(ctx, (db) => exportInTx(db, ctx.cwd, overwrite));
}

async function off(io, overwrite) {
  const { cwd } = ctxOf(io);
  if (readConfig(cwd).store !== 'sqlite') return { store: 'json', exported: [], note: 'already on the JSON files' };
  const ctx = await sqliteCtx(io, { create: true });
  if (!fs.existsSync(ctx.dbFile)) {
    await writeConfig(cwd, 'json');
    return { store: 'json', exported: [], note: 'no database here: nothing to export' };
  }
  // one write transaction from the read to the config write: a writer waits for it, then sees json and writes the file
  return withDb(ctx, async (db) => {
    const r = await exportInTx(db, cwd, overwrite);
    await writeConfig(cwd, 'json');
    return { store: 'json', ...r };
  });
}

async function sync(io, f) {
  if (!f.fromFiles) throw invalid('db sync needs --from-files (take the JSON files into the database)');
  const { cwd, env } = ctxOf(io);
  if (readConfig(cwd).store !== 'sqlite') throw invalid('this project is on the JSON files (no sqlite store configured): nothing to sync');
  const ctx = await resolveStore({ cwd, env });
  const found = await sourceFiles(cwd);
  return withDb(ctx, async (db) => {
    let targets = withHeld(cwd, found, listDocs(db));
    if (f.scope !== undefined) {
      const key = scopeKey(cwd, f.scope);
      targets = targets.filter((t) => t.scope === key);
      if (!targets.length) throw invalid(`${f.scope} is not a kit store file the database knows (see the documents in \`db status\`)`);
    }
    // read every file first: a broken one stops sync with nothing changed (the transaction rolls back)
    const synced = [];
    const kept = [];
    for (const t of targets) {
      const doc = await readSource(t.file);
      if (doc === null) {
        if (f.scope !== undefined) throw invalid(`${t.file} does not exist`);
        if (getDoc(db, t.name, t.scope) !== null) kept.push({ store: t.name, scope: t.scope });
        continue;
      }
      putDoc(db, t.name, t.scope, doc, fileHash(t.file));
      synced.push({ store: t.name, scope: t.scope });
    }
    return { synced, kept_without_file: kept, rows: rowCounts(db) };
  });
}

async function status(io) {
  const { cwd, env } = ctxOf(io);
  const cfg = readConfig(cwd);
  const engine = await loadEngine({ cwd, env });
  const dbFile = path.join(cwd, DB_FILE);
  const out = {
    store: cfg.store,
    configured: cfg.configured,
    engine: engine.name,
    ...(engine.name ? {} : { engine_errors: engine.errors, fix: ENGINE_FIX }),
    db: posix(DB_FILE),
    db_exists: fs.existsSync(dbFile),
    schema_version: null,
    schema_target: SCHEMA_VERSION,
    rows: null
  };
  if (cfg.store === 'sqlite') {
    const ctx = await resolveStore({ cwd, env }); // exit 1 naming the fix when the engine or the file is missing
    Object.assign(out, await withDb(ctx, (db) => {
      const documents = listDocs(db);
      const drifted = documents.filter((d) => SPECS[d.store] && driftOf(db, d.store, d.scope, fileOfScope(cwd, d.scope))).map((d) => ({ store: d.store, scope: d.scope }));
      return { schema_version: schemaVersion(db), rows: rowCounts(db), test_runs_by_branch: runsByBranch(db), documents, ...(drifted.length ? { drifted } : {}) };
    }, { write: false }));
  } else if (out.db_exists && engine.name) {
    // json in use, a database left by `db off`: read it read-only, never migrated; trouble is a field, not an exit
    let db = null;
    try {
      db = engine.open(dbFile, { readOnly: true });
      out.schema_version = schemaVersion(db);
      if (out.schema_version > SCHEMA_VERSION) out.error = `schema version ${out.schema_version} is newer than this kit understands (${SCHEMA_VERSION})`;
      else Object.assign(out, { rows: rowCounts(db), test_runs_by_branch: runsByBranch(db) });
    } catch (e) {
      out.error = `cannot read ${posix(DB_FILE)}: ${String(e && e.message).split('\n')[0].slice(0, 200)}`;
    } finally { try { db?.close(); } catch { /* not open */ } }
  }
  return out;
}

/** Test runs per branch: { branch: n }, branches in name order. */
function runsByBranch(db) {
  const out = {};
  for (const r of db.all('SELECT branch, COUNT(*) AS n FROM test_runs GROUP BY branch ORDER BY branch')) out[r.branch] = Number(r.n);
  return out;
}

async function prune(io, keepArg) {
  let keep = DEFAULT_KEEP;
  if (keepArg !== undefined) {
    if (!/^\d+$/.test(keepArg) || Number(keepArg) < 1) throw invalid('--keep must be a whole number >= 1');
    keep = Number(keepArg);
  }
  const ctx = await sqliteCtx(io);
  return withDb(ctx, (db) => {
    const doomed = db.all(`SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY branch ORDER BY started_at DESC, id DESC) AS n FROM test_runs) WHERE n > ?`, keep).map((r) => r.id);
    let cases = 0;
    for (const id of doomed) {
      cases += Number(db.run('DELETE FROM test_cases WHERE run_id = ?', id).changes);
      db.run('DELETE FROM test_runs WHERE id = ?', id);
    }
    return { keep, pruned_runs: doomed.length, pruned_cases: cases, remaining_runs: Number(db.get('SELECT COUNT(*) AS n FROM test_runs').n) };
  });
}

export async function run(args, io = {}) {
  const f = parse(args);
  if (f.sub === undefined || f.sub === '--help' || f.sub === '-h') {
    if (f.sub === undefined) throw invalid(`give a subcommand: init, export, off, sync, status, prune or import-reports\n${usage}`);
    return { usage };
  }
  if (f.sub === 'init') return init(io);
  if (f.sub === 'export') {
    if (readConfig(ctxOf(io).cwd).store !== 'sqlite') throw invalid('this project is on the JSON files already (no sqlite store configured): nothing to export');
    return exportAll(io, f.overwrite);
  }
  if (f.sub === 'off') return off(io, f.overwrite);
  if (f.sub === 'sync') return sync(io, f);
  if (f.sub === 'status') return status(io);
  if (f.sub === 'prune') return prune(io, f.keep);
  if (f.sub === 'import-reports') {
    let limit = DEFAULT_LIMIT;
    if (f.limit !== undefined) {
      if (!/^\d+$/.test(f.limit) || Number(f.limit) < 1 || Number(f.limit) > MAX_LIMIT) throw invalid(`--limit must be a whole number from 1 to ${MAX_LIMIT}`);
      limit = Number(f.limit);
    }
    return importReports(io, { branch: f.branch, limit });
  }
  throw invalid(`unknown subcommand ${JSON.stringify(f.sub).slice(0, 40)} (init, export, off, sync, status, prune, import-reports)`);
}
