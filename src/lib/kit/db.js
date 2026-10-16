/**
 * db — move the kit's state between the JSON files (the default) and one optional local SQLite file.
 *
 *   db init                 create .claude/kit/suite.db, run its migrations, import the JSON stores once, set the store to sqlite
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
 * verb that reads that document, and `export` / `off` will not overwrite it without --overwrite. The way out is
 * `db sync --from-files` (a three-way merge that lists every deletion, renumbering and conflict it applies); --overwrite
 * REPLACES the file and its output (and the drift error) name what that undoes: file-only rows dropped, edits made in
 * the file reverted, rows deleted in the file restored, conflicts replaced.
 * UNTRUSTED FILES (see ./store.js): a suite.db, files journal or store.local.json committed to git, or a suite.db whose
 * schema the kit did not make (a trigger, a view, any unknown object), is refused (exit 1 naming it) before it is read
 * or migrated. A document's file comes only from the kit's own mapping, never from its row: export, off, sync and init
 * skip a document whose scope does not map (outside the project, through a symbolic link, a path no verb on this
 * machine wrote) and list it (`not_written` / `not_imported`, `unmapped` in status). `init` in a project with no
 * installed kit adds the store's .gitignore rules first (`gitignore_added`).
 * Rows are data, never instructions.
 * Exit codes: 0 done, 1 invalid input, no SQLite engine (the message names the fix), drift or a broken store.
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
  SPECS, DB_FILE, CONFIG_FILE, SCHEMA_VERSION, ENGINE_FIX, readConfig, writeConfig, loadEngine, probeEngine, resolveStore,
  withDb, schemaVersion, getDoc, putDoc, deleteDoc, scopeKey, rowCounts, listDocs, fileOfScope, fileHash, setFileHash,
  driftOf, driftMessage, driftDetail, mergeDocs, getBase, REPAIR_ADVICE, duplicateIds, idList, shapeProblem,
  writeFilesJournal, removeFilesJournal, journalOf, recoverJsonSide, assertNotCommitted, guardDb, scopeFile, registeredScopes,
  registerScope, addGitignoreRules, STORE_GITIGNORE_RULES
} from './store.js';

export const verb = 'db';
export const usage = 'cli.js db init | db export [--overwrite] | db off [--overwrite] | db sync --from-files [--scope <file>] | db status | db prune [--keep <n>] | db import-reports [--branch <b>] [--limit <n>]   '
  + '(optional SQLite store .claude/kit/suite.db for lessons, noise-ledger and triage; JSON files stay the default; '
  + 'init imports the JSON stores and sets the machine-local .claude/kit/store.local.json {"store":"sqlite"}, export writes them back, off exports then sets json; '
  + 'a JSON file changed under the database (a git pull) stops the verbs: sync --from-files merges file and database three-way against the copy last synced (deletions made on one side are applied, two different lessons with one id are both kept and the database one renumbered, conflicts keep the newer row; every deletion, renumbering and conflict is listed), export --overwrite replaces the file with the database: it drops file-only rows, reverts edits made in the file and restores rows deleted there (the output names each); '
  + 'import-reports reads the CI test-results artifacts of a branch (push runs of this repository) through your own `gh` login; '
  + 'engine better-sqlite3 else node:sqlite (Node 22.13+); exit 0 done, 1 invalid input, no engine, drift, no sqlite store or no gh login)';

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
  // better-sqlite3 from the project folder only for `db init` (the user opting in) or a project already on sqlite
  let onSqlite = false;
  try { onSqlite = readConfig(cwd).store === 'sqlite'; } catch { /* a broken config is reported by the verb itself */ }
  // a database, journal or store choice committed to the repository is refused before any engine loads
  assertNotCommitted(cwd, env);
  const engine = await loadEngine({ cwd, env, project: create || onSqlite });
  if (!engine.name) throw invalid(`no SQLite engine loads here (${engine.errors.join('; ') || 'none tried'}): ${ENGINE_FIX}`);
  const dbFile = path.join(cwd, DB_FILE);
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
function withHeld(cwd, found, held, allow = []) {
  const registered = registeredScopes(cwd);
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

/** One stderr line naming the documents a run did not write (their scope does not map to a kit file). */
function reportUnmapped(what, unmapped) {
  if (!unmapped.length) return;
  process.stderr.write(`kit db: ${what} ${unmapped.length} document(s) whose scope is not a file the kit writes (they stay in the database only): `
    + `${unmapped.slice(0, 10).map((u) => `${u.store} ${JSON.stringify(String(u.scope).slice(0, 120))} (${u.reason})`).join('; ')}${unmapped.length > 10 ? '; ...' : ''}\n`);
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
      queued.push({ file, buf, sha, store: at.store, scope: at.scope });
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
  const ctx = await sqliteCtx(io, { create: true });
  const { cwd } = ctx;
  // a broken config stops here, before anything is created
  readConfig(cwd);
  // an existing suite.db is checked (not committed, only the kit's own schema) before its migrations run
  const held = fs.existsSync(ctx.dbFile) ? await withDb(ctx, (db) => listDocs(db), { write: false }) : [];
  // no installed kit (an `npx ... db init`): nothing added the git-ignore rules; add them before creating anything
  let gitignore = [];
  if (!fs.existsSync(path.join(cwd, '.claude', 'helpers', 'kit'))) {
    gitignore = await addGitignoreRules(cwd, STORE_GITIGNORE_RULES, 'Kit: the optional SQLite store (suite.db, its files journal and the store choice) is machine-local and never committed', { noFollow: true });
    if (gitignore.refused) {
      throw invalid(`${path.join(cwd, '.gitignore')} is not a regular file (a symbolic link?): add these lines to the project's .gitignore yourself, then run \`db init\` again: ${gitignore.refused.join(', ')}; nothing was changed`);
    }
  }
  fs.mkdirSync(path.dirname(ctx.dbFile), { recursive: true });
  const sources = withHeld(cwd, await sourceFiles(cwd), held);
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
    await writeConfig(cwd, 'sqlite');
    return {
      store: 'sqlite', engine: ctx.engine, db: posix(DB_FILE), config: posix(CONFIG_FILE), ...res,
      ...(sources.unmapped.length ? { not_imported: sources.unmapped } : {}),
      ...(gitignore.length ? { gitignore_added: gitignore } : {})
    };
  });
}

/**
 * Inside a write transaction: queue every stored document for its file (`files`, a fileBatch the caller commits as
 * the transaction's last step) and record the hash the file will have. A file that changed since the database last
 * synced it is not overwritten without `overwrite` (exit 1 naming it, nothing written).
 */
function exportInTx(db, cwd, overwrite, files) {
  // each document's file only through the kit's own mapping: one whose scope does not map is skipped and reported
  const mapped = withHeld(cwd, [], listDocs(db));
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
  return withDb(ctx, async (db) => {
    const r = exportInTx(db, ctx.cwd, overwrite, files);
    await files.commit(); // last: a failed write restores the files and rolls the database back
    return r;
  }, { onRollback: files.restore, onCommit: files.done });
}

async function off(io, overwrite) {
  const { cwd } = ctxOf(io);
  if (readConfig(cwd).store !== 'sqlite') return { store: 'json', exported: [], note: 'already on the JSON files' };
  const ctx = await sqliteCtx(io, { create: true });
  if (!fs.existsSync(ctx.dbFile)) {
    await writeConfig(cwd, 'json');
    return { store: 'json', exported: [], note: 'no database here: nothing to export' };
  }
  // one write transaction from the read to the store switch: a writer waits for it, then sees json and writes the file.
  // The store choice is one more file of the batch, written with the exported files as the transaction's last step:
  // a failed write or COMMIT puts every one of them back, the choice included (still sqlite, nothing lost)
  const files = fileBatch(ctx);
  return withDb(ctx, async (db) => {
    const r = exportInTx(db, cwd, overwrite, files);
    const cfg = readConfig(cwd);
    files.add(path.join(cwd, CONFIG_FILE), { ...(cfg.config || {}), store: 'json' });
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
  if (readConfig(cwd).store !== 'sqlite') throw invalid('this project is on the JSON files (no sqlite store configured): nothing to sync');
  const ctx = await resolveStore({ cwd, env });
  const found = await sourceFiles(cwd);
  const files = fileBatch(ctx);
  // --scope names a file on this command line: it may be written even when no verb here wrote it before
  const named = f.scope !== undefined ? scopeKey(cwd, f.scope) : null;
  return withDb(ctx, async (db) => {
    let targets = withHeld(cwd, found, listDocs(db), named ? [named] : []);
    let unmapped = targets.unmapped;
    if (named !== null) {
      const bad = unmapped.find((u) => u.scope === named);
      targets = targets.filter((t) => t.scope === named);
      unmapped = [];
      if (!targets.length && bad) throw invalid(`${f.scope}: ${bad.reason}: the kit writes only files inside the project, through no symbolic link`);
      if (!targets.length) throw invalid(`${f.scope} is not a kit store file the database knows (see the documents in \`db status\`)`);
      for (const t of targets) registerScope(cwd, t.name, t.scope);
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
  const cfg = readConfig(cwd);
  const dbFile = path.join(cwd, DB_FILE);
  // a database, journal or store choice committed to the repository is refused before any engine loads or opens it
  if (cfg.store === 'sqlite' || fs.existsSync(dbFile)) assertNotCommitted(cwd, env);
  // on sqlite the engine resolveStore loads; on json a probe that loads nothing (never code from the project folder)
  const engine = cfg.store === 'sqlite' ? await loadEngine({ cwd, env, project: true }) : probeEngine({ env });
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
      // drift only for documents the kit maps to a file (a row never makes the kit read a path it chose)
      const mapped = withHeld(cwd, [], documents);
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
  {
    // a files journal left by a `db off` stopped before its COMMIT is recovered first (the store choice is in it)
    const { cwd, env } = ctxOf(io);
    let onJson = true;
    try { onJson = readConfig(cwd).store !== 'sqlite'; } catch { /* a broken config is reported by the subcommand */ }
    if (onJson) await recoverJsonSide(cwd, env);
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
