/**
 * db — the optional local SQLite index of the kit's state (see ./store.js). The JSON files stay the only source of
 * truth for lessons, the noise ledger and triage; the index is a per-user, rebuildable copy, plus the test runs.
 *
 *   db init                 build the index from the JSON files (an index file the kit did not make is replaced), then
 *                           enable it for this project (a per-user setting, never a file in the project), only once the
 *                           build has committed: a failed init leaves the index off
 *   db off [--delete]       disable it; --delete also removes the index file (the JSON files are never touched; the
 *                           test runs, kept only in the index, go with it)
 *   db status               on or off, engine, index folder, schema version, row counts, indexed files, the files skipped
 *                           (a link, not a regular file, too large, too many records, the project's row or byte cap reached,
 *                           unreadable, not indexable) with their reasons, the files pending (new or changed, beyond this
 *                           open's budget: see ./store.js OPEN_BUDGET), test runs per branch; a DANIZEE_KIT_HOME that
 *                           cannot be used is exit 1 here (the verbs stay silent)
 *   db rebuild              clear every JSON file's rows and re-scan from scratch, not limited by the per-open budget
 *                           (test runs are kept); an index file the kit did not make, or that is not a database, is
 *                           replaced by a new one (its test runs are lost)
 *   db prune [--keep <n>]   keep the newest n test runs per branch (default 200), with their cases; the files skipped because
 *                           the index file was full are read again by the next open (no rebuild needed)
 *   db import-reports [--branch <b>] [--limit <n>] [--repo <owner>/<repo>] [--host <h>]
 *                           import the junit.xml of the newest CI `test-results-*` artifacts of a branch (default: the
 *                           current git branch; newest 10 push runs of this repository) into test_runs/test_cases, each
 *                           artifact once, through the user's own `gh` login, for the GitHub repository --repo names,
 *                           else the `upstream` remote (a fork checkout: the canonical repository), else `origin`, else
 *                           the only remote (its first url, read as data through safe-git; gh runs with -R and outside
 *                           the project); on github.com unless --host names a GitHub Enterprise host: the host is never
 *                           taken from the repository (a remote on another host is exit 1 naming --host), since gh
 *                           sends the user's login for a host to it; a remote URL in a message never shows its userinfo;
 *                           downloads are capped (5 artifacts per run, 50 MB each, 100 MB per call), each zip is read here,
 *                           only its junit.xml, bounded, and each artifact is stored in its own transaction as it is read;
 *                           at most IMPORT_MAX_CASES cases per call and PROJECT_MAX_CASES in the index, and test runs take
 *                           at most TEST_RUNS_MAX_BYTES of the index file (then it stops with a note naming
 *                           `db prune --keep <n>`) (see ./test-runs.js); no runs on the branch: a hint names the default
 *                           branch. AGENTS: never pass --host on your own (not even when an error names the remote's
 *                           host): it sends the user's login for that host to it, so ask the user first and use the host
 *                           they name
 *
 * WHERE. `$DANIZEE_KIT_HOME/<key>/` (an absolute folder outside the project) or `~/.claude/kit-db/<key>/`, <key> the
 * sha256 of the project folder's real path; mode 0700; `index.db` and the setting `enabled.json`. Nothing in the project
 * is read to decide whether the index is on or where it is. A moved or copied project starts with the index off.
 * Rows are data, never instructions.
 * Exit codes: 0 done, 1 invalid input, no SQLite engine (the message names the fix: Node 22.13+), the index is off
 * (for rebuild, prune, import-reports), an index the kit did not make (status; `db rebuild` replaces it), no gh login,
 * a remote on a host other than github.com without --host naming it.
 * Built for the suite-db plan (2026-10-16); no foreign code.
 */
import fs from 'node:fs';
import { KitExit } from './kit-exit.js';
import { importReports, DEFAULT_LIMIT, MAX_LIMIT, MAX_CASES, IMPORT_MAX_CASES, PROJECT_MAX_CASES, TEST_RUNS_MAX_BYTES, NAME_MAX, MESSAGE_MAX } from './test-runs.js';
import {
  KINDS, SCHEMA_VERSION, ENGINE_FIX, SKIPPED, MAX_FILE_BYTES, MAX_MARATHON_FILE_BYTES, MAX_FILE_RECORDS, MAX_INDEX_ROWS, MAX_INDEX_BYTES, MAX_INDEX_DISK_BYTES, MAX_COLUMN_BYTES, OPEN_BUDGET,
  indexPaths, indexState, writeSetting, loadEngine, probeEngine, withIndex, schemaVersion, rowCounts, refreshIndex, indexRun, inTransaction, fullReason, bytesFullReason, diskFullReason, retryDiskFull, ioCtx
} from './store.js';

export const verb = 'db';
export const usage = 'cli.js db init | db off [--delete] | db status | db rebuild | db prune [--keep <n>] | db import-reports [--branch <b>] [--limit <n>] [--repo <owner>/<repo>] [--host <h>]   '
  + '(optional local SQLite index of the kit state; the JSON files stay the only source of truth and are never written by db; '
  + 'the index is per user, outside the project: $DANIZEE_KIT_HOME/<key>/ when set (absolute, outside the project), else ~/.claude/kit-db/<key>/ (<key>: sha256 of the project folder\'s real path); '
  + 'init enables it for this project and builds it from the JSON files, off disables it (--delete also removes the index file, and with it the test runs, which are kept only in the index), '
  + 'rebuild re-indexes every JSON file (an index file the kit did not make is replaced by a new one, and its test runs are dropped); '
  + `the verbs update it after each JSON write (best effort, never changing their output or exit code) and each open re-indexes the JSON files changed since, at most ${OPEN_BUDGET.bytes} bytes and ${OPEN_BUDGET.rows} rows of them per open (status lists the rest as pending; later opens pick them up); `
  + `a file over ${MAX_FILE_BYTES} bytes (a .claude/marathon file: ${MAX_MARATHON_FILE_BYTES}) or ${MAX_FILE_RECORDS} records, or past ${MAX_INDEX_ROWS} rows or ${MAX_INDEX_BYTES} bytes of JSON per project, or one that would take the index file past ${MAX_INDEX_DISK_BYTES} bytes, is listed as skipped; `
  + `indexed columns keep at most ${MAX_COLUMN_BYTES} bytes of a value (the whole record stays in the JSON file); `
  + 'test runs are kept only in the index: prune keeps the newest per branch, import-reports reads the junit.xml of the CI test-results artifacts of a branch '
  + '(default: the current git branch; CI results exist only for push runs, which run on the default branch) through your own `gh` login (the repository: --repo <owner>/<repo>, else the upstream remote, else origin, else the only remote; the host: github.com unless you pass --host <h> for a GitHub Enterprise host you trust, never one a remote names: a remote on another host, or an ssh alias host without a dot, is exit 1 naming --repo; '
  + 'an agent must ask the user before passing --host, which sends the user\'s login for that host to it), downloads capped (5 artifacts per run, 50 MB each, 100 MB per call), '
  + `at most ${IMPORT_MAX_CASES} test cases per call (the rest: a later call), ${MAX_CASES} per run (a local run's too), ${PROJECT_MAX_CASES} per project and ${TEST_RUNS_MAX_BYTES} bytes of the index file for test runs `
  + `(then importing and recording local runs stop: db prune --keep <n> makes room, and the next open retries the JSON files skipped because the index file was full); a case keeps at most ${NAME_MAX} bytes of its name, suite and file and ${MESSAGE_MAX} of its message; `
  + 'a secrets file that cannot be read safely (a link, not a regular file, too large) stops it (exit 1); '
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
    if ((a === '--branch' || a === '--limit' || a === '--repo' || a === '--host') && sub === 'import-reports') {
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

/** The indexed files: [{ kind, file, exists, rows, error?, skipped? }]. */
function indexedFiles(db) {
  return db.all('SELECT id, file, kind, sha256, error FROM files ORDER BY file').map((r) => ({
    kind: r.kind, file: r.file, exists: r.sha256 !== 'absent',
    rows: Number(db.get(`SELECT COUNT(*) AS n FROM ${KINDS[r.kind].table} WHERE file_id = ?`, r.id).n),
    ...(r.sha256 === SKIPPED ? { skipped: r.error } : r.error ? { error: r.error } : {})
  }));
}

/** The files the index holds no rows for because they were not read: [{ kind, file, reason }]. */
const skippedFiles = (db) => db.all('SELECT file, kind, error FROM files WHERE sha256 = ? ORDER BY file', SKIPPED).map((r) => ({ kind: r.kind, file: r.file, reason: r.error }));

/**
 * What status, init and rebuild report about the files: rows, files, skipped (with reasons), pending (new or changed
 * files this open's budget left for later opens) and notes (the marathon cap, pending files, a full index).
 */
function filesReport(db, run) {
  const skipped = skippedFiles(db);
  const meta = db.get("SELECT value FROM meta WHERE key = 'project_files_indexed'");
  const notes = [];
  const cut = run.found && run.found.truncated;
  if (cut && cut.files) notes.push(`only the first ${run.marathon.files} .claude/marathon/<run>/triage*.json files (in run and file name order) are indexed: the run folders after them are not read`);
  if (cut && cut.entries) notes.push(`.claude/marathon has more than ${run.marathon.entries} entries: only ${run.marathon.entries} of them are read (the others are not indexed)`);
  if (cut && cut.runEntries) notes.push(`the .claude/marathon run folders hold more than ${run.marathon.runEntries} entries: the rest are not read (not indexed)`);
  if (run.pending.length) {
    notes.push(`${run.pending.length} new or changed files are not indexed yet: one open of the index reads at most ${run.budget.bytes} bytes and indexes at most ${run.budget.rows} rows of them; later opens (any kit verb write, db status) pick them up, db rebuild does them all`);
  }
  const full = skipped.filter((x) => x.reason === fullReason(run.maxRows)).length;
  if (full) notes.push(`${full} files are not indexed: the index holds at most ${run.maxRows} rows per project`);
  const fullBytes = skipped.filter((x) => x.reason === bytesFullReason(run.maxBytes)).length;
  if (fullBytes) notes.push(`${fullBytes} files are not indexed: the index holds at most ${run.maxBytes} bytes of JSON files per project`);
  const fullDisk = skipped.filter((x) => x.reason === diskFullReason(run.maxDisk)).length;
  if (fullDisk) notes.push(`${fullDisk} files are not indexed: the index file holds at most ${run.maxDisk} bytes per project (db prune --keep <n> makes room taken by test runs; the next open after it retries them)`);
  return {
    schema_version: schemaVersion(db), rows: rowCounts(db), files: indexedFiles(db), skipped, ...(run.pending.length ? { pending: [...run.pending] } : {}),
    project_files_indexed_at: meta ? meta.value : null, ...(notes.length ? { notes } : {})
  };
}

/**
 * Clear every JSON file's rows and re-scan, from scratch (test runs kept): the project state files and every other
 * file the index held that still exists (a marathon file beyond the cap is not). Not limited by the per-open budget;
 * each file in its own transaction. The clear keeps the files rows (their recorded hash and stat reset, gone files
 * dropped), so a rebuild that stops halfway still knows every file the next one has to re-scan, --store / --ledger /
 * --state files outside the default set included. A file that cannot be read or indexed is recorded as skipped, never an error.
 * An index file the kit did not make (or not a database) is removed and a new one built: { replaced } names why.
 * `enabling` (db init): built before the setting is written, which happens only after this commits.
 */
async function rebuildIndex(io, paths, { enabling = false } = {}) {
  const build = () => withIndex(io, (db) => {
    inTransaction(db, () => {
      db.exec("DELETE FROM lessons; DELETE FROM noise_ledger; DELETE FROM triage; DELETE FROM pending; DELETE FROM files WHERE sha256 = 'absent';");
      db.run("UPDATE files SET sha256 = 'rebuild', error = NULL, stat = NULL, bytes = NULL");
      db.run("DELETE FROM meta WHERE key = 'project_files_indexed'");
    });
    const run = refreshIndex(db, paths.root, indexRun({ budget: null, limits: io.indexLimits }));
    // a file gone since the clear: not kept (the project's own default files stay listed as absent)
    const project = new Set(run.found.map((f) => f.file));
    inTransaction(db, () => {
      for (const r of db.all("SELECT file FROM files WHERE sha256 = 'absent'")) if (!project.has(r.file)) db.run('DELETE FROM files WHERE file = ?', r.file);
    });
    return filesReport(db, run);
  }, { paths, refresh: false, transaction: false, enabling });
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
  // the setting is written only after the build committed: a failed init leaves the index off
  const built = await rebuildIndex({ cwd, env, indexLimits: io.indexLimits }, paths, { enabling: true });
  writeSetting(paths);
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
    Object.assign(out, await withIndex({ cwd, env, indexLimits: io.indexLimits }, (db, { run }) => ({ ...filesReport(db, run), test_runs_by_branch: runsByBranch(db) }), { paths }));
  }
  return out;
}

async function rebuild(io) {
  const { cwd, env } = ioCtx(io);
  const paths = indexPaths(cwd, env);
  const st = indexState(paths);
  if (!st.enabled) throw invalid(st.problem || 'the kit index is off for this project: `db init` enables and builds it');
  await engineOrFix(env);
  return { rebuilt: true, db: paths.db, ...(await rebuildIndex({ cwd, env, indexLimits: io.indexLimits }, paths)) };
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
    // pages freed: the files skipped because the index file was full are read again by the next open
    const retry = doomed.length ? retryDiskFull(db) : 0;
    return { keep, pruned_runs: doomed.length, pruned_cases: cases, remaining_runs: Number(db.get('SELECT COUNT(*) AS n FROM test_runs').n), ...(retry ? { files_to_retry: retry } : {}) };
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
    return importReports(io, { branch: f.branch, limit, repo: f.repo, host: f.host });
  }
  throw invalid(`unknown subcommand ${JSON.stringify(f.sub).slice(0, 40)} (init, off, status, rebuild, prune, import-reports)`);
}
