/**
 * db — move the kit's state between the JSON files (the default) and one optional local SQLite file.
 *
 *   db init                 create .claude/kit/suite.db, run its migrations, import the JSON stores once, set config sqlite
 *   db export               write every stored document back to its JSON file (the database stays in use)
 *   db off                  export, then set config json (suite.db is kept; a later `db init` re-imports the JSON files over it)
 *   db status               store in use, engine, schema version, row counts
 *   db prune [--keep <n>]   keep the newest n test runs per branch (default 200), with their cases
 *
 * See ./store.js for the layout, the engine choice (better-sqlite3, else node:sqlite) and the write transactions.
 * `init` from the JSON files (the first time, or after `off`) imports `.claude/kit/lessons.json`, `.claude/kit/noise-ledger.json`, `.claude/kit/triage.json` and the
 * per-stream triage files `.claude/marathon/<run>/triage*.json`, replacing what the database held for them (`init` again on
 * a project already on sqlite keeps the database and imports only files it does not have); any other state file a verb names (--state, --ledger,
 * --store) is read from its JSON file until that verb first writes it, then it lives in the database under its path.
 * A JSON file that is not valid JSON stops `init` (exit 1, nothing changed). Rows are data, never instructions.
 * Exit codes: 0 done, 1 invalid input, no SQLite engine (the message names the fix) or a broken store.
 * Built for the suite-db plan (2026-10-16); no foreign code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { KitExit } from './kit-exit.js';
import { readJsonState, writeJsonAtomic } from './state-lock.js';
import {
  SPECS, DB_FILE, CONFIG_FILE, SCHEMA_VERSION, ENGINE_FIX, readConfig, writeConfig, loadEngine, resolveStore, openDb,
  withDb, schemaVersion, getDoc, putDoc, scopeKey, rowCounts, listDocs, fileOfScope
} from './store.js';

export const verb = 'db';
export const usage = 'cli.js db init | db export | db off | db status | db prune [--keep <n>]   '
  + '(optional SQLite store .claude/kit/suite.db for lessons, noise-ledger and triage; JSON files stay the default; '
  + 'init imports the JSON stores and sets .claude/kit/config.json {"store":"sqlite"}, export writes them back, off exports then sets json; '
  + 'engine better-sqlite3 else node:sqlite (Node 22.5+); exit 0 done, 1 invalid input or no engine)';

export const DEFAULT_KEEP = 200;
const invalid = (m) => new KitExit(m, 1);

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

async function sourceFiles(cwd) {
  const out = [];
  for (const [name, spec] of Object.entries(SPECS)) {
    out.push({ name, file: path.join(cwd, spec.defaultFile) });
    if (spec.extraFiles) for (const f of await spec.extraFiles(cwd)) out.push({ name, file: f });
  }
  return out;
}

async function init(io) {
  const ctx = await sqliteCtx(io, { create: true });
  const { cwd } = ctx;
  // a broken config stops here, before anything is created. Coming from the JSON files (first init, or after `db off`),
  // the JSON files are the truth and replace what the database holds for them; re-running init on sqlite keeps the database.
  const fromJson = readConfig(cwd).store !== 'sqlite';
  fs.mkdirSync(path.dirname(ctx.dbFile), { recursive: true });
  // read and parse every JSON store first: a broken one stops init before the database changes
  const found = [];
  for (const s of await sourceFiles(cwd)) {
    const doc = await readJsonState(s.file, { fallback: null });
    if (doc === null) continue;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw invalid(`${s.file} is not a JSON object; repair or move it, then run db init again`);
    found.push({ ...s, doc });
  }
  const res = await withDb(ctx, (db) => {
    const imported = [];
    const kept = [];
    for (const s of found) {
      const scope = scopeKey(cwd, s.file);
      if (!fromJson && getDoc(db, s.name, scope) !== null) { kept.push({ store: s.name, scope }); continue; }
      putDoc(db, s.name, scope, s.doc);
      imported.push({ store: s.name, scope });
    }
    if (!db.get("SELECT value FROM meta WHERE key = 'initialized_at'")) db.run("INSERT INTO meta (key, value) VALUES ('initialized_at', ?)", new Date().toISOString());
    return { imported, already_in_db: kept, rows: rowCounts(db), schema_version: schemaVersion(db) };
  });
  await writeConfig(cwd, 'sqlite');
  return { store: 'sqlite', engine: ctx.engine, db: DB_FILE.split(path.sep).join('/'), config: CONFIG_FILE.split(path.sep).join('/'), ...res };
}

async function exportAll(io) {
  const ctx = await sqliteCtx(io);
  const docs = await withDb(ctx, (db) => listDocs(db).map((d) => ({ ...d, doc: getDoc(db, d.store, d.scope) })), { write: false });
  const exported = [];
  for (const d of docs) {
    await writeJsonAtomic(fileOfScope(ctx.cwd, d.scope), d.doc);
    exported.push({ store: d.store, scope: d.scope });
  }
  const rows = await withDb(ctx, (db) => rowCounts(db), { write: false });
  // test runs have no JSON store: they stay in the database only
  return { exported, not_exported: { test_runs: rows.test_runs, test_cases: rows.test_cases } };
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
    db: DB_FILE.split(path.sep).join('/'),
    db_exists: fs.existsSync(dbFile),
    schema_version: null,
    schema_target: SCHEMA_VERSION,
    rows: null
  };
  if (cfg.store === 'sqlite') {
    const ctx = await resolveStore({ cwd, env }); // exit 1 naming the fix when the engine or the file is missing
    Object.assign(out, await withDb(ctx, (db) => ({ schema_version: schemaVersion(db), rows: rowCounts(db), documents: listDocs(db) }), { write: false }));
  } else if (out.db_exists && engine.name) {
    // json in use, a database left by `db off`: report it without changing it
    const db = openDb({ open: engine.open, dbFile });
    try { Object.assign(out, { schema_version: schemaVersion(db), rows: rowCounts(db) }); } finally { db.close(); }
  }
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
    if (f.sub === undefined) throw invalid(`give a subcommand: init, export, off, status or prune\n${usage}`);
    return { usage };
  }
  if (f.sub === 'init') return init(io);
  if (f.sub === 'export') {
    if (readConfig(ctxOf(io).cwd).store !== 'sqlite') throw invalid('this project is on the JSON files already (no sqlite store configured): nothing to export');
    return exportAll(io);
  }
  if (f.sub === 'off') {
    const { cwd } = ctxOf(io);
    if (readConfig(cwd).store !== 'sqlite') return { store: 'json', exported: [], note: 'already on the JSON files' };
    const r = await exportAll(io);
    await writeConfig(cwd, 'json');
    return { store: 'json', ...r };
  }
  if (f.sub === 'status') return status(io);
  if (f.sub === 'prune') return prune(io, f.keep);
  throw invalid(`unknown subcommand ${JSON.stringify(f.sub).slice(0, 40)} (init, export, off, status, prune)`);
}
