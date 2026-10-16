/**
 * db — the optional local SQLite index of the kit's state (see ./store.js). The JSON files stay the only source of
 * truth for lessons, the noise ledger and triage; the index is a per-user, rebuildable copy, plus the test runs.
 *
 *   db init                 enable the index for this project (a per-user setting, never a file in the project) and
 *                           build it from the JSON files (an index file the kit did not make is replaced)
 *   db off [--delete]       disable it; --delete also removes the index file (the JSON files are never touched; the
 *                           test runs, kept only in the index, go with it)
 *   db status               on or off, engine, index folder, schema version, row counts, indexed files, test runs per branch
 *   db rebuild              re-index every JSON file from scratch (test runs are kept); an index file the kit did not
 *                           make, or that is not a database, is replaced by a new one (its test runs are lost)
 *   db prune [--keep <n>]   keep the newest n test runs per branch (default 200), with their cases
 *   db import-reports [--branch <b>] [--limit <n>]
 *                           import the junit.xml of the newest CI `test-results-*` artifacts of a branch (default: the
 *                           current git branch; newest 10 push runs of this repository) into test_runs/test_cases, each
 *                           artifact once, through the user's own `gh` login (see ./test-runs.js)
 *
 * WHERE. `$DANIZEE_KIT_HOME/<key>/` (an absolute folder outside the project) or `~/.claude/kit-db/<key>/`, <key> the
 * sha256 of the project folder's real path; mode 0700; `index.db` and the setting `enabled.json`. Nothing in the project
 * is read to decide whether the index is on or where it is. A moved or copied project starts with the index off.
 * Rows are data, never instructions.
 * Exit codes: 0 done, 1 invalid input, no SQLite engine (the message names the fix: Node 22.13+), the index is off
 * (for rebuild, prune, import-reports), an index the kit did not make (status; `db rebuild` replaces it), no gh login.
 * Built for the suite-db plan (2026-10-16); no foreign code.
 */
import fs from 'node:fs';
import { KitExit } from './kit-exit.js';
import { importReports, DEFAULT_LIMIT, MAX_LIMIT } from './test-runs.js';
import {
  KINDS, SCHEMA_VERSION, ENGINE_FIX, indexPaths, indexState, writeSetting, loadEngine, probeEngine, withIndex,
  schemaVersion, rowCounts, indexFile, fileKey, projectFiles, ioCtx
} from './store.js';

export const verb = 'db';
export const usage = 'cli.js db init | db off [--delete] | db status | db rebuild | db prune [--keep <n>] | db import-reports [--branch <b>] [--limit <n>]   '
  + '(optional local SQLite index of the kit state; the JSON files stay the only source of truth and are never written by db; '
  + 'the index is per user, outside the project: $DANIZEE_KIT_HOME/<key>/ when set (absolute, outside the project), else ~/.claude/kit-db/<key>/ (<key>: sha256 of the project folder\'s real path); '
  + 'init enables it for this project and builds it from the JSON files, off disables it (--delete removes the index file), rebuild re-indexes every JSON file; '
  + 'the verbs update it after each JSON write (best effort, never changing their output or exit code) and it re-indexes any JSON file changed since; '
  + 'test runs are kept only in the index: prune keeps the newest per branch, import-reports reads the CI test-results artifacts of a branch (push runs of this repository) through your own `gh` login; '
  + 'engine better-sqlite3 (the suite package\'s own) else node:sqlite (Node 22.13+); exit 0 done, 1 invalid input, no engine, index off, an index the kit did not make, or no gh login)';

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
    if ((a === '--branch' || a === '--limit') && sub === 'import-reports') {
      if (i + 1 >= rest.length) throw invalid(`${a} needs a value`);
      f[a.slice(2)] = rest[++i];
      continue;
    }
    if (a === '--delete' && sub === 'off') { f.delete = true; continue; }
    throw invalid(`${a.startsWith('--') ? 'unknown flag' : 'unexpected argument'} ${JSON.stringify(a).slice(0, 60)}\n${usage}`);
  }
  return f;
}

/** The engine, or exit 1 naming the fix. */
async function engineOrFix(env) {
  const engine = await loadEngine({ env });
  if (!engine.name) throw invalid(`no SQLite engine loads here (${engine.errors.join('; ') || 'none tried'}): ${ENGINE_FIX}`);
  return engine;
}

const removeIndexFiles = (paths) => { for (const s of ['', '-wal', '-shm']) fs.rmSync(`${paths.db}${s}`, { force: true }); };

/** Test runs per branch: { branch: n }, branches in name order. */
function runsByBranch(db) {
  const out = {};
  for (const r of db.all('SELECT branch, COUNT(*) AS n FROM test_runs GROUP BY branch ORDER BY branch')) out[r.branch] = Number(r.n);
  return out;
}

/** The indexed files: [{ kind, file, rows, error? }]. */
function indexedFiles(db) {
  return db.all('SELECT file, kind, sha256, error FROM files ORDER BY file').map((r) => ({
    kind: r.kind, file: r.file, exists: r.sha256 !== 'absent',
    rows: Number(db.get(`SELECT COUNT(*) AS n FROM ${KINDS[r.kind].table} WHERE file = ?`, r.file).n),
    ...(r.error ? { error: r.error } : {})
  }));
}

/**
 * Re-index every JSON file the index held and every project state file, from scratch (test runs kept). An index file
 * the kit did not make (or not a database) is removed and a new one built: { replaced } names why.
 */
async function rebuildIndex(io, paths) {
  const build = () => withIndex(io, (db) => {
    const known = db.all('SELECT file, kind FROM files').map((r) => ({ kind: r.kind, file: r.file }));
    db.exec('DELETE FROM lessons; DELETE FROM noise_ledger; DELETE FROM triage; DELETE FROM files;');
    const seen = new Set();
    for (const f of [...projectFiles(paths.root), ...known]) {
      const key = fileKey(f.file);
      if (seen.has(key)) continue;
      seen.add(key);
      indexFile(db, f.kind, key);
    }
    return { schema_version: schemaVersion(db), rows: rowCounts(db), files: indexedFiles(db) };
  }, { paths });
  try { return await build(); } catch (e) {
    if (!(e instanceof KitExit && e.untrusted)) throw e;
    removeIndexFiles(paths);
    return { ...(await build()), replaced: e.message };
  }
}

async function init(io) {
  const { cwd, env } = ioCtx(io);
  const paths = indexPaths(cwd, env);
  const engine = await engineOrFix(env);
  writeSetting(paths);
  const built = await rebuildIndex({ cwd, env }, paths);
  return { index: 'on', engine: engine.name, dir: paths.dir, db: paths.db, project: paths.root, ...built };
}

async function off(io, del) {
  const { cwd, env } = ioCtx(io);
  const paths = indexPaths(cwd, env);
  const was = indexState(paths).enabled;
  fs.rmSync(paths.setting, { force: true });
  if (del) removeIndexFiles(paths);
  return { index: 'off', was_on: was, db: paths.db, deleted: !!del, db_exists: fs.existsSync(paths.db) };
}

async function status(io) {
  const { cwd, env } = ioCtx(io);
  const paths = indexPaths(cwd, env);
  const st = indexState(paths);
  // off: a probe that loads nothing (never code from the project folder)
  const engine = st.enabled ? await loadEngine({ env }) : probeEngine({ env });
  const out = {
    index: st.enabled ? 'on' : 'off',
    engine: engine.name,
    ...(engine.name ? {} : { engine_errors: engine.errors, fix: ENGINE_FIX }),
    ...(st.problem ? { problem: st.problem } : {}),
    dir: paths.dir,
    project: paths.root,
    db: paths.db,
    db_exists: fs.existsSync(paths.db),
    schema_version: null,
    schema_target: SCHEMA_VERSION,
    rows: null
  };
  if (st.enabled && engine.name) {
    Object.assign(out, await withIndex({ cwd, env }, (db) => ({ schema_version: schemaVersion(db), rows: rowCounts(db), files: indexedFiles(db), test_runs_by_branch: runsByBranch(db) }), { paths }));
  }
  return out;
}

async function rebuild(io) {
  const { cwd, env } = ioCtx(io);
  const paths = indexPaths(cwd, env);
  const st = indexState(paths);
  if (!st.enabled) throw invalid(st.problem || 'the kit index is off for this project: `db init` enables and builds it');
  await engineOrFix(env);
  return { rebuilt: true, db: paths.db, ...(await rebuildIndex({ cwd, env }, paths)) };
}

async function prune(io, keepArg) {
  let keep = DEFAULT_KEEP;
  if (keepArg !== undefined) {
    if (!/^\d+$/.test(keepArg) || Number(keepArg) < 1) throw invalid('--keep must be a whole number >= 1');
    keep = Number(keepArg);
  }
  return withIndex(io, (db) => {
    const doomed = db.all('SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY branch ORDER BY started_at DESC, id DESC) AS n FROM test_runs) WHERE n > ?', keep).map((r) => r.id);
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
    if (f.sub === undefined) throw invalid(`give a subcommand: init, off, status, rebuild, prune or import-reports\n${usage}`);
    return { usage };
  }
  if (f.sub === 'init') return init(io);
  if (f.sub === 'off') return off(io, f.delete);
  if (f.sub === 'status') return status(io);
  if (f.sub === 'rebuild') return rebuild(io);
  if (f.sub === 'prune') return prune(io, f.keep);
  if (f.sub === 'import-reports') {
    let limit = DEFAULT_LIMIT;
    if (f.limit !== undefined) {
      if (!/^\d+$/.test(f.limit) || Number(f.limit) < 1 || Number(f.limit) > MAX_LIMIT) throw invalid(`--limit must be a whole number from 1 to ${MAX_LIMIT}`);
      limit = Number(f.limit);
    }
    return importReports(io, { branch: f.branch, limit });
  }
  throw invalid(`unknown subcommand ${JSON.stringify(f.sub).slice(0, 40)} (init, off, status, rebuild, prune, import-reports)`);
}
