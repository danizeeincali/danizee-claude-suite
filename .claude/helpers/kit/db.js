/**
 * db — move the kit's state between the JSON files (the default) and one optional local SQLite file.
 *
 *   db init                 create this project's suite.db (in the per-user store folder, see below), run its migrations,
 *                           import the JSON stores once, set the store to sqlite
 *   db export [--overwrite] write every stored document back to its JSON file (the database stays in use)
 *   db off [--overwrite]    export, then set the store to json (suite.db is kept; a later `db init` re-imports the JSON files
 *                           over it); with no suite.db at all it only sets json
 *   db sync --from-files [--scope <file>]
 *                           MERGE the JSON files (all, or one) and the database three-way, row by row, against the copy
 *                           last synced, after the files changed under it (a git pull): additions and edits from either
 *                           side are taken; a row deleted on one side and unchanged on the other is deleted (listed in
 *                           `deleted` with the side that deleted it and the row); two different lessons that took the same
 *                           new id on both sides are both kept, the file's keeps its id and the database's is renumbered
 *                           (listed in `renumbered`); a row changed on both sides is a conflict (the newer timestamp wins,
 *                           else the database's; listed in `conflicts`, the losing row in `discarded`); with no copy last
 *                           synced (a database from an older kit) it takes the union and deletes nothing. Then the merged
 *                           document is written back to the file
 *   db status               store in use, engine, the store folder and the project it records, schema version, row counts
 *   db forget --scope <scope>
 *                           remove every document stored under that scope from the database (printed in full in the
 *                           output, so nothing is lost unseen), and its registration: the way out for a document whose
 *                           file is outside the project, which `db off` will not leave behind
 *   db prune [--keep <n>]   keep the newest n test runs per branch (default 200), with their cases
 *   db import-reports [--branch <b>] [--limit <n>]
 *                           import the junit.xml of the newest CI `test-results-*` artifacts of a branch (default: the
 *                           current git branch; newest 10 push runs of this repository) into test_runs/test_cases, each
 *                           artifact once, through the user's own `gh` login (see ./test-runs.js); needs the sqlite store
 *
 * See ./store.js for the layout, the engine choice (better-sqlite3, else node:sqlite), the write transactions and drift.
 * MACHINE-LOCAL: suite.db, the store choice (store.local.json), the registered scopes and the files journal live in a
 * per-user folder, `$DANIZEE_KIT_HOME/<id>/` or `~/.claude/kit-db/<id>/` (<id>: the first 16 hex digits of the sha256
 * of the project folder's real path; mode 0700; `project.json` there records the project path), never in the project.
 * A cloned repository cannot supply any of them; a stray `.claude/kit/suite.db` or `store.local.json` in the project is
 * ignored (never opened; `db status` names it). Two worktrees of one repository are two real paths: two separate stores.
 * `init` from the JSON files (the first time, or after `off`) imports `.claude/kit/lessons.json`, `.claude/kit/noise-ledger.json`,
 * `.claude/kit/triage.json`, the per-stream triage files `.claude/marathon/<run>/triage*.json` and every other document
 * the database already holds (a --state, --ledger or --store path), each from its file, replacing what the database held
 * for it; a held document whose file is gone is dropped. `init` again on a project already on sqlite keeps the database
 * and imports only files it does not have. Any other state file a verb names (--state, --ledger, --store) is read from
 * its JSON file until that verb first writes it, then it lives in the database under its path. `init` holds the state
 * lock of every file it reads until the store is switched, and `off` holds one write transaction from its read to the
 * switch, so a write in flight is never lost. A JSON file that is not valid JSON stops `init` (exit 1, nothing changed).
 * DRIFT: a file that changed since the database last imported or exported it (a git pull of lessons.json) stops every
 * verb that reads that document, and `export` / `off` will not overwrite it without --overwrite. The way out is
 * `db sync --from-files` (a three-way merge that lists every deletion, renumbering and conflict it applies); --overwrite
 * REPLACES the file and its output (and the drift error) name what that undoes: file-only rows dropped, edits made in
 * the file reverted, rows deleted in the file restored, conflicts replaced.
 * DOCUMENT FILES (see ./store.js scopeFile): a document's file comes only from the kit's own mapping, never from its
 * row, and only inside the project (after the real path of its existing parent folder; a symbolically linked `.claude`
 * inside the repository is fine). A document whose scope does not map (outside the project, a path no verb on this
 * machine wrote) is not written: `export` writes the others, lists it in `not_written` and exits 1; `off` refuses
 * (exit 1, still on sqlite, nothing changed) naming it and the ways out (`db forget --scope <scope>`, which prints its
 * rows); `sync` and `init` skip and list it (`not_written` / `not_imported`, `unmapped` in status). A suite.db whose
 * schema the kit did not make (a trigger, a view, any unknown object) is refused (exit 1 naming it) before it is read
 * or migrated.
 * Rows are data, never instructions.
 * Exit codes: 0 done, 1 invalid input, no SQLite engine (the message names the fix), drift, a broken store, or a
 * document that could not be written (`export` still writes the others; `off` changes nothing).
 * Built for the suite-db plan (2026-10-16); no foreign code.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { KitExit } from './kit-exit.js';
import { readJsonState, withStateLock } from './state-lock.js';
import { importReports, DEFAULT_LIMIT, MAX_LIMIT } from './test-runs.js';
import {
  SPECS, SCHEMA_VERSION, ENGINE_FIX, KIT_HOME_ENV, readConfig, writeConfig, loadEngine, probeEngine, resolveStore,
  withDb, schemaVersion, getDoc, putDoc, deleteDoc, scopeKey, rowCounts, listDocs, fileHash, setFileHash,
  driftOf, driftMessage, driftDetail, mergeDocs, getBase, REPAIR_ADVICE, duplicateIds, idList, shapeProblem,
  writeFilesJournal, removeFilesJournal, journalOf, recoverJsonSide, guardDb, scopeFile, registeredScopes,
  registerScope, unregisterScope, storePaths, ensureStoreDir, readProjectJson, strayProjectFiles
} from './store.js';

export const verb = 'db';
export const usage = 'cli.js db init | db export [--overwrite] | db off [--overwrite] | db sync --from-files [--scope <file>] | db status | db forget --scope <scope> | db prune [--keep <n>] | db import-reports [--branch <b>] [--limit <n>]   '
  + '(optional SQLite store for lessons, noise-ledger and triage; JSON files stay the default; '
  + 'the database (suite.db), the store choice (store.local.json) and the files journal are machine-local, in a per-user folder outside the project: '
  + '$DANIZEE_KIT_HOME/<id>/ when set, else ~/.claude/kit-db/<id>/ (<id>: first 16 hex digits of the sha256 of the project folder\'s real path; db status shows it; '
  + 'two worktrees of one repository get two separate stores); a .claude/kit/suite.db or store.local.json inside the project is ignored; '
  + 'init imports the JSON stores and sets the store to sqlite, export writes them back, off exports then sets json; '
  + 'a document whose file would be outside the project is never written: export lists it in not_written and exits 1, off refuses until it is removed with forget --scope (which prints its rows); '
  + 'a JSON file changed under the database (a git pull) stops the verbs: sync --from-files merges file and database three-way against the copy last synced (deletions made on one side are applied, two different lessons with one id are both kept and the database one renumbered, conflicts keep the newer row; every deletion, renumbering and conflict is listed), export --overwrite replaces the file with the database: it drops file-only rows, reverts edits made in the file and restores rows deleted there (the output names each); '
  + 'import-reports reads the CI test-results artifacts of a branch (push runs of this repository) through your own `gh` login; '
  + 'engine better-sqlite3 else node:sqlite (Node 22.13+); exit 0 done, 1 invalid input, no engine, drift, no sqlite store or no gh login)';

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
    if (a === '--overwrite' && (sub === 'export' || sub === 'off')) { f.overwrite = true; continue; }
    if (a === '--from-files' && sub === 'sync') { f.fromFiles = true; continue; }
    if (a === '--scope' && (sub === 'sync' || sub === 'forget')) {
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
  // better-sqlite3 from the project folder only for `db init` (the user opting in) or a project already on sqlite
  let onSqlite = false;
  try { onSqlite = readConfig(cwd, env).store === 'sqlite'; } catch { /* a broken config is reported by the verb itself */ }
  const engine = await loadEngine({ cwd, env, project: create || onSqlite });
  if (!engine.name) throw invalid(`no SQLite engine loads here (${engine.errors.join('; ') || 'none tried'}): ${ENGINE_FIX}`);
  const dbFile = storePaths(cwd, env).db;
  if (!create && !fs.existsSync(dbFile)) throw invalid(`${dbFile} does not exist: run \`db init\` first`);
  return { kind: 'sqlite', engine: engine.name, open: engine.open, dbFile, cwd, env };
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

/**
 * The source files plus every document the database holds ([{ store, scope }]), once each, each with its file from
 * the kit's own mapping (store.js scopeFile), never from the row: a document whose scope does not map (outside the
 * project, through a symbolic link, a path no verb on this machine wrote) is left out and listed in `.unmapped`
 * ([{ store, scope, reason }]). `allow`: paths named on this command line.
 */
function withHeld(cwd, env, found, held, allow = []) {
  const registered = registeredScopes(cwd, env);
  const out = [];
  const unmapped = [];
  const seen = new Set();
  for (const d of [...found.map((s) => ({ store: s.name, scope: s.scope })), ...held]) {
    if (!SPECS[d.store] || seen.has(`${d.store}\0${d.scope}`)) continue;
    seen.add(`${d.store}\0${d.scope}`);
    const m = scopeFile(cwd, d.store, d.scope, { allow, registered });
    if (m.file) out.push({ name: d.store, scope: d.scope, file: m.file });
    else unmapped.push({ store: d.store, scope: d.scope, reason: m.reason });
  }
  out.unmapped = unmapped;
  return out;
}

const unmappedList = (unmapped) => `${unmapped.slice(0, 10).map((u) => `${u.store} ${JSON.stringify(String(u.scope).slice(0, 120))} (${u.reason})`).join('; ')}${unmapped.length > 10 ? '; ...' : ''}`;
/** How to get rid of documents `db off` cannot write. */
const UNMAPPED_WAY_OUT = 'Their rows are only in the database. For each one, either keep its rows in a file inside the project '
  + '(while still on SQLite, write them with the verb itself to a path inside the project, such as the store\'s default file), '
  + 'or remove the document with `db forget --scope <scope>` (it prints the rows it removes, so you can keep them); `db export` writes every other document and lists these in `not_written`';

/** One stderr line naming the documents a run did not write (their scope does not map to a kit file). */
function reportUnmapped(what, unmapped) {
  if (!unmapped.length) return;
  process.stderr.write(`kit db: ${what} ${unmapped.length} document(s) whose file is not one the kit writes inside the project (they stay in the database only): ${unmappedList(unmapped)}\n`);
}

/** Hold the state lock of every file (in path order, so two callers never deadlock) while fn runs. */
async function withStateLocks(files, fn) {
  const list = [...new Set(files.map((f) => path.resolve(f)))].filter((f) => fs.existsSync(path.dirname(f))).sort();
  const step = (i) => (i >= list.length ? fn() : withStateLock(list[i], () => step(i + 1)));
  return step(0);
}

/**
 * A JSON store file as an object, or null when it does not exist; anything else is exit 1 telling to repair the file
 * in place and run `then` (the command that was running) again. A list holding one id twice is refused too: the
 * merge matches rows by id, and every verb refuses such a store.
 */
async function readSource(file, then, name) {
  let doc;
  try { doc = await readJsonState(file, { fallback: null }); } catch (e) {
    if (e instanceof KitExit) throw invalid(`${e.message}: ${REPAIR_ADVICE}; then run \`${then}\` again`);
    throw e;
  }
  if (doc === null) return null;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw invalid(`${file} is not a JSON object: ${REPAIR_ADVICE}; then run \`${then}\` again`);
  // the layout putDoc needs (a list or an object per part), checked before anything is written
  const bad = name ? shapeProblem(name, doc) : null;
  if (bad) throw invalid(`${file}: ${bad}: ${REPAIR_ADVICE}; then run \`${then}\` again. Nothing was changed`);
  const dup = name ? duplicateIds(name, doc) : [];
  if (dup.length) {
    throw invalid(`${file} holds the same id more than once (${dup.map((d) => d.id).join(', ')}): two rows cannot share an id. `
      + 'Repair the file in place: give one row of each duplicated id a new id (the next free one, the highest id in the file plus one), '
      + `or remove the duplicate when it is the same row twice; then run \`${then}\` again. Nothing was changed`);
  }
  return doc;
}

/**
 * The JSON files a database transaction writes, all or none. `add` queues a document (with the database document it
 * belongs to, none for the store choice) and returns the sha256 of the bytes it will write (to record in the
 * transaction); `commit`, the transaction's last step, writes every file to a temp file beside it (synced, the old
 * file's mode kept), then the files journal (store.js writeFilesJournal: each file's original bytes and new hash), and
 * only then renames them over the originals; if any step fails, every file already renamed gets its original bytes
 * back (or is removed when it did not exist) and the error is thrown on, so the transaction rolls back too. `restore`
 * (withDb's onRollback, run before ROLLBACK releases the write lock) undoes a commit whose transaction then did not
 * commit, putting back only files that still hold this run's bytes (one changed since is left alone and named); `done` (withDb's onCommit) removes the
 * journal. So files and database agree after every run that ends, failed or not. Only a run killed (SIGKILL, power
 * loss) between its first rename and the journal's removal leaves them apart, and only until the next database open:
 * it reads the journal (store.js recoverFilesJournal) and, when the COMMIT did not happen, puts back every file still
 * holding the new bytes (one changed since is left alone and named) before anything reads or checks drift.
 */
function fileBatch(ctx) {
  const queued = [];
  const done = [];
  let journal = false;
  const fail = (file, e) => (e instanceof KitExit ? e : invalid(`cannot write ${file}: ${e.code || e.message}; nothing was changed`));
  async function put(file, buf, mode) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const fh = await fsp.open(tmp, 'wx', mode === null ? 0o666 : 0o600);
      try {
        if (mode !== null) await fh.chmod(mode);
        await fh.writeFile(buf);
        await fh.sync();
      } finally { await fh.close(); }
      return tmp;
    } catch (e) { await fsp.unlink(tmp).catch(() => {}); throw e; }
  }
  const hashOf = async (file) => {
    try { return crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex'); } catch (e) { if (e.code === 'ENOENT') return 'absent'; throw e; }
  };
  async function restore() {
    let ok = true;
    const left = [];
    while (done.length) {
      const d = done.pop();
      try {
        // only a file that still holds this run's bytes: one changed since (another writer) is left alone and named
        if (await hashOf(d.file) !== d.sha) { left.push(d.file); continue; }
        if (d.before === null) await fsp.rm(d.file, { force: true });
        else await fsp.rename(await put(d.file, d.before, d.mode), d.file);
      } catch { ok = false; /* best effort: the rest are still restored, the journal is kept for the next open */ }
    }
    if (left.length) process.stderr.write(`kit db: not put back because they changed since this run wrote them: ${left.join(', ')} (they may now differ from the database: \`db sync --from-files\` merges them)\n`);
    if (ok && journal) {
      try { removeFilesJournal(ctx.dbFile); journal = false; } catch { /* the next open finds every file restored */ }
    }
  }
  return {
    add(file, doc, at = {}) {
      const buf = Buffer.from(JSON.stringify(doc, null, 2) + '\n');
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      queued.push({ file, buf, sha, store: at.store, scope: at.scope, storeChoice: !!at.storeChoice });
      return sha;
    },
    async commit() {
      const staged = [];
      try {
        for (const q of queued) {
          let before = null; let mode = null;
          try { before = await fsp.readFile(q.file); mode = (await fsp.stat(q.file)).mode & 0o7777; } catch (e) { if (e.code !== 'ENOENT') throw fail(q.file, e); }
          let tmp;
          try { tmp = await put(q.file, q.buf, mode); } catch (e) { throw fail(q.file, e); }
          staged.push({ ...q, before, mode, tmp });
        }
        if (staged.length) {
          try { writeFilesJournal(ctx.cwd, ctx.dbFile, staged); } catch (e) { throw fail(journalOf(ctx.dbFile), e); }
          journal = true;
        }
        for (const st of staged) {
          try { await fsp.rename(st.tmp, st.file); } catch (e) { throw fail(st.file, e); }
          st.tmp = null;
          done.push(st);
        }
      } catch (e) {
        for (const st of staged) if (st.tmp) await fsp.unlink(st.tmp).catch(() => {});
        await restore();
        throw e;
      }
    },
    restore,
    async done() {
      if (!journal) return;
      // committed: a journal that cannot be removed now is removed by the next open (it sees the COMMIT happened)
      try { removeFilesJournal(ctx.dbFile); journal = false; } catch (e) {
        process.stderr.write(`kit db: cannot remove ${journalOf(ctx.dbFile)} (${e.code || e.message}); the next database open removes it\n`);
      }
    }
  };
}

async function init(io) {
  // a broken config stops here, before anything is created
  { const { cwd, env } = ctxOf(io); readConfig(cwd, env); }
  const ctx = await sqliteCtx(io, { create: true });
  const { cwd, env } = ctx;
  // the per-user store folder (mode 0700, with project.json): nothing is written inside the project
  const paths = ensureStoreDir(cwd, env);
  // an existing suite.db is checked (only the kit's own schema) before its migrations run
  const held = fs.existsSync(ctx.dbFile) ? await withDb(ctx, (db) => listDocs(db), { write: false }) : [];
  const sources = withHeld(cwd, env, await sourceFiles(cwd), held);
  reportUnmapped('db init: did not import', sources.unmapped);
  // every source file stays locked from its read to the config write: a JSON writer waits, then sees sqlite
  return withStateLocks(sources.map((s) => s.file), async () => {
    // Coming from the JSON files (first init, or after `db off`), the files are the truth and replace what the
    // database holds for them; re-running init on sqlite keeps the database.
    const fromJson = readConfig(cwd).store !== 'sqlite';
    // read and parse every JSON store first: a broken one stops init before the database changes
    const found = [];
    for (const s of sources) found.push({ ...s, doc: await readSource(s.file, 'db init', s.name), sha: fileHash(s.file) });
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
        putDoc(db, s.name, s.scope, s.doc, s.sha, s.doc);
        imported.push({ store: s.name, scope: s.scope });
      }
      if (!db.get("SELECT value FROM meta WHERE key = 'initialized_at'")) db.run("INSERT INTO meta (key, value) VALUES ('initialized_at', ?)", new Date().toISOString());
      return { imported, already_in_db: kept, dropped, rows: rowCounts(db), schema_version: schemaVersion(db) };
    });
    await writeConfig(cwd, 'sqlite', env);
    return {
      store: 'sqlite', engine: ctx.engine, db: paths.db, config: paths.config, store_dir: paths.dir, ...res,
      ...(sources.unmapped.length ? { not_imported: sources.unmapped } : {})
    };
  });
}

/**
 * Inside a write transaction: queue every stored document for its file (`files`, a fileBatch the caller commits as
 * the transaction's last step) and record the hash the file will have. A file that changed since the database last
 * synced it is not overwritten without `overwrite` (exit 1 naming it, nothing written).
 */
function exportInTx(db, cwd, env, overwrite, files) {
  // each document's file only through the kit's own mapping: one whose scope does not map is skipped and reported
  const mapped = withHeld(cwd, env, [], listDocs(db));
  const docs = mapped.map((d) => ({ store: d.name, scope: d.scope, file: d.file }));
  reportUnmapped('did not write', mapped.unmapped);
  const drifted = docs.map((d) => driftOf(db, d.store, d.scope, d.file)).filter(Boolean)
    .map((d) => ({ ...d, detail: driftDetail(db, d.store, d.scope, d.file) }));
  if (drifted.length && !overwrite) throw invalid(drifted.map((d) => driftMessage(d.scope, d.detail)).join('\n'));
  const exported = [];
  for (const d of docs) {
    const doc = getDoc(db, d.store, d.scope);
    setFileHash(db, d.store, d.scope, files.add(d.file, doc, { store: d.store, scope: d.scope }), doc);
    exported.push({ store: d.store, scope: d.scope });
  }
  const rows = rowCounts(db);
  // what --overwrite undid, found with the sync merge against the stored base: the rows only the file had are gone,
  // the edits made in the file only are reverted, the rows the file deleted are back, every conflict has the database's side
  const ref = (x) => ({ part: x.part, id: x.id });
  const overwritten = drifted.map((d) => ({
    store: d.store,
    scope: d.scope,
    ...(d.detail.error
      ? { file_was: d.detail.error }
      : {
        dropped_file_rows: d.detail.file_only.length,
        dropped: d.detail.file_only,
        replaced_conflicts: d.detail.conflicts.length,
        replaced: d.detail.conflicts.map(ref),
        reverted_file_edits: d.detail.edited_in_file,
        restored_file_deletions: d.detail.deleted_in_file,
        ...(d.detail.base === null ? { base: 'unknown: edits and deletions made in the file cannot be told' } : {})
      })
  }));
  const dropped = overwritten.reduce((n, o) => n + (o.dropped_file_rows || 0), 0);
  const all = (k) => overwritten.flatMap((o) => o[k] || []);
  const undone = [
    all('reverted_file_edits').length ? `${all('reverted_file_edits').length} edit(s) made in the file were reverted${idList(all('reverted_file_edits'), 20)}` : '',
    all('restored_file_deletions').length ? `${all('restored_file_deletions').length} row(s) deleted in the file were restored${idList(all('restored_file_deletions'), 20)}` : '',
    all('replaced').length ? `the file's side of ${all('replaced').length} conflicting row(s) was replaced${idList(all('replaced'), 20)}` : '',
    overwritten.some((o) => o.base) ? `for ${overwritten.filter((o) => o.base).map((o) => o.scope).join(', ')} the database had no copy as last synced, so which edits and deletions made in the file were reverted is unknown` : ''
  ].filter(Boolean).map((x) => `${x}; `).join('');
  // test runs have no JSON store: they stay in the database only
  return {
    exported,
    ...(drifted.length ? {
      overwritten,
      warning: `--overwrite REPLACED ${drifted.length} changed file(s) with the database (${overwritten.map((o) => o.scope).join(', ')}): `
        + `${dropped} file-only row(s) were dropped from them${dropped ? ` (${overwritten.flatMap((o) => (o.dropped || []).map((x) => x.id)).slice(0, 20).join(', ')})` : ''}; `
        + undone
        + '`db sync --from-files` merges instead'
    } : {}),
    not_exported: { test_runs: rows.test_runs, test_cases: rows.test_cases },
    ...(mapped.unmapped.length ? { not_written: mapped.unmapped } : {})
  };
}

async function exportAll(io, overwrite) {
  const ctx = await sqliteCtx(io);
  const files = fileBatch(ctx);
  const r = await withDb(ctx, async (db) => {
    const x = exportInTx(db, ctx.cwd, ctx.env, overwrite, files);
    await files.commit(); // last: a failed write restores the files and rolls the database back
    return x;
  }, { onRollback: files.restore, onCommit: files.done });
  // the other documents are written; a skipped one makes the run exit 1 (its rows are only in the database)
  return r.not_written ? { ...r, exit: 1 } : r;
}

async function off(io, overwrite) {
  const { cwd, env } = ctxOf(io);
  if (readConfig(cwd, env).store !== 'sqlite') return { store: 'json', exported: [], note: 'already on the JSON files' };
  const ctx = await sqliteCtx(io, { create: true });
  if (!fs.existsSync(ctx.dbFile)) {
    await writeConfig(cwd, 'json', env);
    return { store: 'json', exported: [], note: 'no database here: nothing to export' };
  }
  // one write transaction from the read to the store switch: a writer waits for it, then sees json and writes the file.
  // The store choice is one more file of the batch, written with the exported files as the transaction's last step:
  // a failed write or COMMIT puts every one of them back, the choice included (still sqlite, nothing lost)
  const files = fileBatch(ctx);
  return withDb(ctx, async (db) => {
    const r = exportInTx(db, cwd, env, overwrite, files);
    // a document that cannot be written would be left in the database only: stay on sqlite, change nothing
    if (r.not_written) {
      throw invalid(`db off: ${r.not_written.length} document(s) cannot be written to a file inside the project, so the project stays on SQLite and nothing was changed: `
        + `${unmappedList(r.not_written)}. ${UNMAPPED_WAY_OUT}; then run \`db off\` again`);
    }
    const cfg = readConfig(cwd, env);
    files.add(cfg.file, { ...(cfg.config || {}), store: 'json' }, { storeChoice: true });
    await files.commit();
    return { store: 'json', ...r };
  }, { onRollback: files.restore, onCommit: files.done });
}

/**
 * sync --from-files: MERGE each JSON file and the database three-way against the document last synced (see store.js
 * mergeDocs): additions and edits from either side are taken, a row deleted on one side and unchanged on the other is
 * deleted, two different lessons that took one new id are both kept (the database's renumbered), a row changed on both
 * sides is a conflict (newer timestamp, else the database's). Every deletion (`deleted`, with the side that deleted it
 * and the row), renumbering (`renumbered`), conflict (`conflicts`) and losing row (`discarded`) is in the output. Then
 * the merged document is written back to the file and becomes the new base, so file and database match and the drift
 * hash is current.
 */
async function sync(io, f) {
  if (!f.fromFiles) throw invalid('db sync needs --from-files (merge the JSON files into the database)');
  const { cwd, env } = ctxOf(io);
  if (readConfig(cwd, env).store !== 'sqlite') throw invalid('this project is on the JSON files (no sqlite store configured): nothing to sync');
  const ctx = await resolveStore({ cwd, env });
  const found = await sourceFiles(cwd);
  const files = fileBatch(ctx);
  // --scope names a file on this command line: it may be written even when no verb here wrote it before
  const named = f.scope !== undefined ? scopeKey(cwd, f.scope) : null;
  return withDb(ctx, async (db) => {
    let targets = withHeld(cwd, env, found, listDocs(db), named ? [named] : []);
    let unmapped = targets.unmapped;
    if (named !== null) {
      const bad = unmapped.find((u) => u.scope === named);
      targets = targets.filter((t) => t.scope === named);
      unmapped = [];
      if (!targets.length && bad) throw invalid(`${f.scope}: ${bad.reason}: the kit writes only files inside the project`);
      if (!targets.length) throw invalid(`${f.scope} is not a kit store file the database knows (see the documents in \`db status\`)`);
      for (const t of targets) registerScope(cwd, t.name, t.scope, env);
    }
    reportUnmapped('did not sync', unmapped);
    // read and shape-check every file first: a broken one stops sync before any write. The database writes all happen
    // in this transaction and the files are written only at its end, all or none (fileBatch): a failure anywhere
    // rolls the database back and leaves every file as it was, so a retry merges against the same base
    const docs = [];
    for (const t of targets) docs.push({ ...t, doc: await readSource(t.file, 'db sync --from-files', t.name) });
    const synced = [];
    const kept = [];
    const conflicts = [];
    const deleted = [];
    const renumbered = [];
    const discarded = [];
    const counts = { kept: 0, added: 0, updated: 0, unchanged: 0, conflicts: 0, deleted: 0, renumbered: 0 };
    for (const t of docs) {
      if (t.doc === null) {
        if (f.scope !== undefined) throw invalid(`${t.file} does not exist`);
        if (getDoc(db, t.name, t.scope) !== null) kept.push({ store: t.name, scope: t.scope });
        continue;
      }
      const base = getBase(db, t.name, t.scope);
      const m = mergeDocs(t.name, getDoc(db, t.name, t.scope), t.doc, base);
      putDoc(db, t.name, t.scope, m.doc);
      const doc = getDoc(db, t.name, t.scope);
      // export: the file gets the merged document at the end (left as it is when it already holds exactly that)
      setFileHash(db, t.name, t.scope, JSON.stringify(doc) !== JSON.stringify(t.doc) ? files.add(t.file, doc, { store: t.name, scope: t.scope }) : fileHash(t.file), doc);
      const row = { kept: m.kept, added: m.added, updated: m.updated, unchanged: m.unchanged, conflicts: m.conflicts.length, deleted: m.deleted.length, renumbered: m.renumbered.length };
      synced.push({ store: t.name, scope: t.scope, ...row, ...(base === null ? { base: 'unknown: union, nothing deleted' } : {}) });
      const at = { store: t.name, scope: t.scope };
      for (const c of m.conflicts) conflicts.push({ ...at, ...c });
      for (const d of m.deleted) deleted.push({ ...at, ...d });
      for (const r of m.renumbered) renumbered.push({ ...at, from: r.from, to: r.to });
      for (const d of m.discarded) discarded.push({ ...at, ...d });
      for (const k of Object.keys(counts)) counts[k] += row[k];
    }
    const rows = rowCounts(db);
    await files.commit();
    return { merged: true, synced, counts, conflicts, deleted, renumbered, discarded, kept_without_file: kept, rows, ...(unmapped.length ? { not_written: unmapped } : {}) };
  }, { onRollback: files.restore, onCommit: files.done });
}

async function status(io) {
  const { cwd, env } = ctxOf(io);
  const cfg = readConfig(cwd, env);
  const paths = cfg.paths;
  const dbFile = paths.db;
  // on sqlite the engine resolveStore loads; on json a probe that loads nothing (never code from the project folder)
  const engine = cfg.store === 'sqlite' ? await loadEngine({ cwd, env, project: true }) : probeEngine({ env });
  const stray = strayProjectFiles(cwd);
  const out = {
    store: cfg.store,
    configured: cfg.configured,
    engine: engine.name,
    ...(engine.name ? {} : { engine_errors: engine.errors, fix: ENGINE_FIX }),
    store_dir: paths.dir,
    project: readProjectJson(paths)?.project ?? null,
    db: dbFile,
    db_exists: fs.existsSync(dbFile),
    schema_version: null,
    schema_target: SCHEMA_VERSION,
    rows: null,
    ...(stray.length ? {
      ignored_in_project: stray,
      ignored_note: `the kit keeps its database, store choice and files journal in ${paths.dir} (set ${KIT_HOME_ENV} to move it), never in the project: these files in the project are never opened or read (another kit build, or a clone, left them); delete them if you do not need them`
    } : {})
  };
  if (cfg.store === 'sqlite') {
    const ctx = await resolveStore({ cwd, env }); // exit 1 naming the fix when the engine or the file is missing
    Object.assign(out, await withDb(ctx, (db) => {
      const documents = listDocs(db);
      // drift only for documents the kit maps to a file (a row never makes the kit read a path it chose)
      const mapped = withHeld(cwd, env, [], documents);
      const drifted = mapped.filter((d) => driftOf(db, d.name, d.scope, d.file)).map((d) => ({ store: d.name, scope: d.scope }));
      return {
        schema_version: schemaVersion(db), rows: rowCounts(db), test_runs_by_branch: runsByBranch(db), documents, ...(drifted.length ? { drifted } : {}),
        ...(mapped.unmapped.length ? { unmapped: mapped.unmapped } : {})
      };
    }, { write: false }));
  } else if (out.db_exists && engine.name) {
    // json in use, a database left by `db off`: read it read-only, never migrated; trouble is a field, not an exit.
    // Only the kit's own engine opens it (the kit's better-sqlite3 or the built-in node:sqlite), never the project's
    let db = null;
    try {
      const own = await loadEngine({ cwd, env, project: false });
      if (!own.name) throw new Error(own.errors.join('; ') || 'no engine');
      db = own.open(dbFile, { readOnly: true });
      guardDb(db, own.open, dbFile); // a schema the kit did not make: exit 1 naming the object (below)
      out.schema_version = schemaVersion(db);
      if (out.schema_version > SCHEMA_VERSION) out.error = `schema version ${out.schema_version} is newer than this kit understands (${SCHEMA_VERSION})`;
      else Object.assign(out, { rows: rowCounts(db), test_runs_by_branch: runsByBranch(db) });
    } catch (e) {
      if (e instanceof KitExit && e.untrusted) throw e;
      out.error = `cannot read ${dbFile}: ${String(e && e.message).split('\n')[0].slice(0, 200)}`;
    } finally { try { db?.close(); } catch { /* not open */ } }
  }
  return out;
}

/**
 * forget --scope <scope>: remove every document stored under that scope (any store) from the database, and its
 * registration. The removed documents are in the output in full (`forgotten`), so nothing is lost unseen.
 */
async function forget(io, scope) {
  if (scope === undefined) throw invalid('db forget needs --scope <scope> (as `db status` lists it under documents)');
  const ctx = await sqliteCtx(io);
  if (readConfig(ctx.cwd, ctx.env).store !== 'sqlite') throw invalid('this project is on the JSON files (no sqlite store configured): nothing to forget');
  const forgotten = await withDb(ctx, (db) => {
    const docs = listDocs(db).filter((d) => d.scope === scope && SPECS[d.store]);
    if (!docs.length) throw invalid(`the database holds no document with scope ${JSON.stringify(scope).slice(0, 200)} (see the documents in \`db status\`)`);
    return docs.map((d) => {
      const doc = getDoc(db, d.store, d.scope);
      deleteDoc(db, d.store, d.scope);
      return { store: d.store, scope: d.scope, document: doc };
    });
  });
  for (const f of forgotten) unregisterScope(ctx.cwd, f.store, f.scope, ctx.env);
  return { forgotten };
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
    if (f.sub === undefined) throw invalid(`give a subcommand: init, export, off, sync, status, forget, prune or import-reports\n${usage}`);
    return { usage };
  }
  {
    // a files journal left by a `db off` stopped before its COMMIT is recovered first (the store choice is in it)
    const { cwd, env } = ctxOf(io);
    let onJson = true;
    try { onJson = readConfig(cwd, env).store !== 'sqlite'; } catch { /* a broken config is reported by the subcommand */ }
    if (onJson) await recoverJsonSide(cwd, env);
  }
  if (f.sub === 'init') return init(io);
  if (f.sub === 'export') {
    if (readConfig(ctxOf(io).cwd, ctxOf(io).env).store !== 'sqlite') throw invalid('this project is on the JSON files already (no sqlite store configured): nothing to export');
    return exportAll(io, f.overwrite);
  }
  if (f.sub === 'off') return off(io, f.overwrite);
  if (f.sub === 'sync') return sync(io, f);
  if (f.sub === 'status') return status(io);
  if (f.sub === 'forget') return forget(io, f.scope);
  if (f.sub === 'prune') return prune(io, f.keep);
  if (f.sub === 'import-reports') {
    let limit = DEFAULT_LIMIT;
    if (f.limit !== undefined) {
      if (!/^\d+$/.test(f.limit) || Number(f.limit) < 1 || Number(f.limit) > MAX_LIMIT) throw invalid(`--limit must be a whole number from 1 to ${MAX_LIMIT}`);
      limit = Number(f.limit);
    }
    return importReports(io, { branch: f.branch, limit });
  }
  throw invalid(`unknown subcommand ${JSON.stringify(f.sub).slice(0, 40)} (init, export, off, sync, status, forget, prune, import-reports)`);
}
