// The optional SQLite store against a repository that is not trusted (review rounds 9 and 10). The database, the files
// journal, the store choice and the registered scopes live in a per-user folder outside the project, so a cloned
// repository cannot supply any of them: crafted in-project files are simply ignored. A database the kit did not make
// (a trigger, a view, a sqlite_stat table, any unknown object) is still refused before anything reads or migrates it;
// a document's file is only one the kit maps, inside the project; the project's own better-sqlite3 is loaded only when
// it is npm-installed (inside the project, in a git repository, untracked); triage list gives the store's own errors as
// they are; the Node version that has node:sqlite. node:sqlite here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import crypto from 'crypto';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { run as reflect } from '../src/lib/kit/reflect.js';
import { run as triage } from '../src/lib/kit/triage.js';
import { run as db } from '../src/lib/kit/db.js';
import { run as noise } from '../src/lib/kit/noise-ledger.js';
import { storeCheck, nodeSqliteSupport, registeredScopes, storePaths, projectEngineCheck, STRAY_PROJECT_FILES } from '../src/lib/kit/store.js';

// the machine-local store lives in a per-user folder: here a temporary one (one sub-folder per project)
process.env.DANIZEE_KIT_HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), 'kit-home-'));
process.on('exit', () => { try { fsSync.rmSync(process.env.DANIZEE_KIT_HOME, { recursive: true, force: true }); } catch { /* best effort */ } });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '../src/lib/kit/cli.js');
const req = createRequire(import.meta.url);
const NODE_SQLITE = (() => { try { req('node:sqlite'); return true; } catch { return false; } })();
const HAVE_GIT = spawnSync('git', ['--version']).status === 0;
const BETTER_IN_KIT = (() => { try { createRequire(path.join(HERE, '../package.json')).resolve('better-sqlite3'); return true; } catch { return false; } })();
const ENV = { KIT_SQLITE_ENGINE: 'node:sqlite' };
const UNPINNED = { KIT_SQLITE_ENGINE: '' };
const skip = !NODE_SQLITE;
const skipGit = !NODE_SQLITE || !HAVE_GIT ? 'needs node:sqlite and git' : false;

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'kit-store-untrusted-'));
const rm = (d) => fs.rm(d, { recursive: true, force: true });
const exists = (p) => fsSync.existsSync(p);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const b64 = (t) => Buffer.from(t).toString('base64');
const DB = (dir) => storePaths(dir).db;
const JOURNAL = (dir) => storePaths(dir).journal;
const LESSONS = '.claude/kit/lessons.json';

async function call(verb, args, cwd, env = {}, stdin = '') {
  try { return { code: 0, out: await verb(args, { cwd, env, stdin: async () => stdin, stdinIsTTY: false }) }; } catch (e) { return { code: e.code ?? 99, err: e.message }; }
}

function cli(args, cwd, env = {}, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out, err, ms: Date.now() - started }); });
  });
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'core.symlinks=true', ...args], { cwd, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** Every file under `dir` (not .git) with its bytes' hash, or its link target: what a run must leave as it was. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fsSync.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (rel === '.git') continue;
      if (e.isSymbolicLink()) out[rel] = `-> ${fsSync.readlinkSync(p)}`;
      else if (e.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p); } else out[rel] = sha(fsSync.readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

/** A raw node:sqlite connection to a database file, with no kit check (to craft a database). */
function raw(file) {
  const { DatabaseSync } = req('node:sqlite');
  return new DatabaseSync(file);
}
/** Close a crafted database as one self-contained file (no -wal / -shm beside it). */
function closeFlat(d) {
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  d.exec('PRAGMA journal_mode = DELETE');
  d.close();
}

const save = (dir, text, extra = [], env = ENV) => call(reflect, ['lessons', 'save', '--role', 'r', '--session', 's', '--text', text, ...extra], dir, env);

/** A project made by the kit (one lesson, db init, then back to json so its suite.db is one file), to be tampered with. */
async function kitMade(dir) {
  assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
  assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
  const off = await call(db, ['off'], dir, ENV);
  assert.equal(off.code, 0, off.err);
  closeFlat(raw(DB(dir)));
}

/** The r9a-1 trigger: every lesson a `db init` imports plants a noise-ledger document at `target`. */
function plantTrigger(file, target) {
  const d = raw(file);
  const data = JSON.stringify({ keys: ['hooks'], fields: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'id > /tmp/x' }] }] } } });
  d.exec(`CREATE TRIGGER plant AFTER INSERT ON lessons BEGIN
    INSERT OR REPLACE INTO store_docs (store, scope, data, updated_at, file_sha256) VALUES ('noise-ledger', '${target}', '${data}', '2026-01-01', NULL);
  END`);
  closeFlat(d);
}

/** A better-sqlite3 stand-in that leaves a PWNED marker in the project when its code runs, and works as an engine. */
async function fakeBetterSqlite(modDir, projectDir) {
  await fs.mkdir(modDir, { recursive: true });
  await fs.writeFile(path.join(modDir, 'package.json'), '{"name":"better-sqlite3","main":"index.js"}');
  await fs.writeFile(path.join(modDir, 'index.js'), `require('fs').writeFileSync(${JSON.stringify(path.join(projectDir, 'PWNED'))}, 'ran');\nmodule.exports = class { close() {} };\n`);
}

describe('nothing in a cloned repository supplies a database, journal, store choice or scope (r10a-1, r10a-2, r9a-1, r9a-3)', () => {
  it('a clone carrying .claude/kit/suite.db (with a trigger), store.local.json (sqlite, scopes) and a files journal: all ignored, the trigger never runs, nothing outside the kit\'s files is written', { skip: skipGit }, async () => {
    const root = await tmp();
    try {
      const evil = path.join(root, 'evil');
      const clone = path.join(root, 'clone');
      const scratch = path.join(root, 'scratch');
      const home = path.join(root, 'home', '.claude');
      for (const d of [evil, scratch, home]) await fs.mkdir(d, { recursive: true });
      const target = path.join(home, 'settings.json');
      await fs.writeFile(target, '{"theme":"dark"}\n');
      // a database the kit made elsewhere, with the trigger planted, committed as the clone's .claude/kit/suite.db
      await kitMade(scratch);
      plantTrigger(DB(scratch), target);
      await fs.mkdir(path.join(evil, '.claude/kit'), { recursive: true });
      await fs.copyFile(DB(scratch), path.join(evil, '.claude/kit/suite.db'));
      await fs.copyFile(path.join(scratch, LESSONS), path.join(evil, LESSONS));
      await fs.writeFile(path.join(evil, 'package.json'), '{"name":"victim"}\n');
      // the store choice with a registered scope, and a journal that would restore package.json
      await fs.writeFile(path.join(evil, '.claude/kit/store.local.json'), JSON.stringify({ store: 'sqlite', scopes: { lessons: ['package.json'] } }));
      await fs.writeFile(path.join(evil, '.claude/kit/suite.db-files-journal'), JSON.stringify({ version: 1, files: [{ path: 'package.json', store: 'lessons', scope: 'package.json', new_sha256: sha('{"name":"victim"}\n'), original: { base64: b64('{"name":"victim","scripts":{"postinstall":"evil"}}') } }] }));
      git(evil, 'init', '-q');
      git(evil, 'add', '-A');
      git(evil, 'commit', '-q', '-m', 'evil');
      git(root, 'clone', '-q', evil, clone);
      const before = snapshot(clone);
      const homeBefore = snapshot(path.dirname(home));
      // on the JSON files: the in-project store choice means nothing
      const st = await cli(['db', 'status'], clone, ENV);
      assert.equal(st.code, 0, st.err);
      const s = JSON.parse(st.out);
      assert.equal(s.store, 'json');
      assert.equal(s.configured, false);
      assert.equal(s.db, DB(clone));
      assert.equal(s.db_exists, false);
      assert.deepEqual(s.ignored_in_project, ['.claude/kit/suite.db', '.claude/kit/suite.db-files-journal', '.claude/kit/store.local.json']);
      for (const args of [['reflect', 'lessons', 'list'], ['db', 'off'], ['db', 'sync', '--from-files']]) {
        const r = await cli(args, clone, ENV);
        assert.doesNotMatch(r.err, /put back|refusing the files journal/, args.join(' '));
      }
      assert.equal(JSON.parse((await cli(['reflect', 'lessons', 'list'], clone, ENV)).out).lessons.length, 1);
      const check = await storeCheck({ cwd: clone, env: { ...process.env, ...ENV } });
      assert.equal(check.store, 'json');
      assert.equal(check.fatal, false);
      // the user's own db init makes a fresh database in the per-user folder; the committed one is never opened
      const init = await cli(['db', 'init'], clone, ENV);
      assert.equal(init.code, 0, init.err);
      assert.deepEqual(JSON.parse(init.out).imported, [{ store: 'lessons', scope: LESSONS }]);
      assert.equal(JSON.parse(init.out).not_imported, undefined, 'no registered scope came from the clone');
      assert.equal((await cli(['reflect', 'lessons', 'save', '--role', 'r', '--session', 's2', '--text', 'Saved in the database of this machine.'], clone, ENV)).code, 0);
      const st2 = JSON.parse((await cli(['db', 'status'], clone, ENV)).out);
      assert.deepEqual(st2.documents, [{ store: 'lessons', scope: LESSONS }]);
      assert.deepEqual(registeredScopes(clone), {});
      // nothing in the clone changed (the kit wrote only its own folder), the trigger never ran
      assert.deepEqual(snapshot(clone), before);
      assert.deepEqual(snapshot(path.dirname(home)), homeBefore, 'the user settings are untouched');
      assert.equal(await fs.readFile(target, 'utf-8'), '{"theme":"dark"}\n');
      // db off writes lessons.json only
      assert.equal((await cli(['db', 'off'], clone, ENV)).code, 0);
      const after = snapshot(clone);
      assert.notEqual(after[LESSONS], before[LESSONS]);
      assert.deepEqual({ ...after, [LESSONS]: null }, { ...before, [LESSONS]: null });
      assert.equal(await fs.readFile(path.join(clone, 'package.json'), 'utf-8'), '{"name":"victim"}\n');
    } finally { await rm(root); }
  });

  it('a committed symbolic link .claude -> real/ or an upper-case SUITE.DB changes nothing: the project is never asked', { skip }, async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(path.join(dir, 'real/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, 'real/kit/store.local.json'), '{"store":"sqlite"}');
      await fs.writeFile(path.join(dir, 'real/kit/SUITE.DB'), 'not opened');
      await fs.writeFile(path.join(dir, 'real/kit/STORE.LOCAL.JSON'), '{"store":"sqlite"}');
      await fs.symlink('real', path.join(dir, '.claude'));
      const before = snapshot(dir);
      const st = await call(db, ['status'], dir, ENV);
      assert.equal(st.code, 0, st.err);
      assert.equal(st.out.store, 'json');
      assert.deepEqual(st.out.ignored_in_project, ['.claude/kit/store.local.json']);
      assert.equal((await call(reflect, ['lessons', 'list'], dir, ENV)).code, 0);
      assert.deepEqual(snapshot(dir), before);
    } finally { await rm(dir); }
  });

  it('a sqlite verb never runs git (no tracked checks to bypass, or to break under safe.directory or a translated git)', { skip }, async () => {
    const dir = await tmp();
    const bin = await tmp();
    try {
      const marker = path.join(bin, 'GIT-RAN');
      await fs.writeFile(path.join(bin, 'git'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(marker)}\necho 'fatal: detected dubious ownership in repository' >&2\nexit 128\n`, { mode: 0o755 });
      const env = { ...ENV, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      // (reflect lessons save asks git where the secrets file is: that is the redaction, not the store)
      assert.equal((await save(dir, 'Run the linter before every commit.')).code, 0);
      for (const args of [['reflect', 'lessons', 'list'], ['reflect', 'lessons', 'keep', '--id', 'L1'], ['db', 'status'], ['db', 'export'], ['db', 'sync', '--from-files'], ['db', 'off'], ['db', 'init'], ['db', 'prune']]) {
        const r = await cli(args, dir, env);
        assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`);
      }
      assert.ok(!exists(marker), `git ran: ${exists(marker) ? fsSync.readFileSync(marker, 'utf-8') : ''}`);
    } finally { await rm(dir); await rm(bin); }
  });
});

describe('the project\'s better-sqlite3 is loaded only when npm-installed: inside the project, in a git repository, untracked (r10a-1, r10a-2, r9a-2)', () => {
  /** A project on sqlite (store choice set on this machine) whose node_modules holds the stand-in. */
  async function onSqlite(dir) {
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"cloned"}');
    const p = storePaths(dir);
    await fs.mkdir(p.dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(p.config, '{"store":"sqlite"}');
  }
  /** check, db status, a verb and db init: none runs the module (no PWNED), each uses node:sqlite or nothing. */
  async function assertNotLoaded(dir, why) {
    assert.match(projectEngineCheck(dir).why || '', why);
    const c = await storeCheck({ cwd: dir, env: { ...process.env, ...UNPINNED } });
    assert.notEqual(c.engine, 'better-sqlite3');
    for (const args of [['db', 'status'], ['reflect', 'lessons', 'list'], ['db', 'init']]) {
      await cli(args, dir, UNPINNED);
      assert.ok(!exists(path.join(dir, 'PWNED')), `${args.join(' ')} ran the project's better-sqlite3`);
    }
    const init = await cli(['db', 'init'], dir, UNPINNED);
    assert.equal(init.code, 0, init.err);
    assert.equal(JSON.parse(init.out).engine, 'node:sqlite');
  }

  it('committed through a symbolic link: node_modules -> vendor with vendor/better-sqlite3 committed is not loaded', { skip: skipGit }, async () => {
    const dir = await tmp();
    try {
      await onSqlite(dir);
      await fakeBetterSqlite(path.join(dir, 'vendor', 'better-sqlite3'), dir);
      await fs.symlink('vendor', path.join(dir, 'node_modules'));
      git(dir, 'init', '-q');
      git(dir, 'add', 'package.json', 'vendor', 'node_modules');
      git(dir, 'commit', '-q', '-m', 'vendored');
      assert.equal(git(dir, 'ls-files', '--', 'node_modules/better-sqlite3'), '', 'a plain pathspec does not see it (the r10a-1 bypass)');
      await assertNotLoaded(dir, /committed to git/);
    } finally { await rm(dir); }
  });

  it('committed under another case (Node_Modules/Better-Sqlite3 in the index, as on a case-insensitive disk) is not loaded', { skip: skipGit }, async () => {
    const dir = await tmp();
    try {
      await onSqlite(dir);
      await fakeBetterSqlite(path.join(dir, 'node_modules', 'better-sqlite3'), dir);
      git(dir, 'init', '-q');
      for (const f of ['package.json', 'index.js']) {
        const blob = git(dir, 'hash-object', '-w', path.join('node_modules/better-sqlite3', f)).trim();
        git(dir, 'update-index', '--add', '--cacheinfo', `100644,${blob},Node_Modules/Better-Sqlite3/${f}`);
      }
      git(dir, 'commit', '-q', '-m', 'vendored');
      assert.equal(git(dir, 'ls-files', '--', 'node_modules/better-sqlite3'), '', 'a plain pathspec does not see it (the r10a-2 bypass)');
      await assertNotLoaded(dir, /committed to git/);
    } finally { await rm(dir); }
  });

  it('in a project that is not a git repository (a tarball, degit) it is not loaded', { skip }, async () => {
    const dir = await tmp();
    try {
      await onSqlite(dir);
      await fakeBetterSqlite(path.join(dir, 'node_modules', 'better-sqlite3'), dir);
      await assertNotLoaded(dir, /cannot tell whether git tracks it/);
    } finally { await rm(dir); }
  });

  it('a git that fails (dubious ownership) means not loaded, and the verbs still work on node:sqlite', { skip: skipGit }, async () => {
    const dir = await tmp();
    const bin = await tmp();
    try {
      await onSqlite(dir);
      await fakeBetterSqlite(path.join(dir, 'node_modules', 'better-sqlite3'), dir);
      git(dir, 'init', '-q');
      await fs.writeFile(path.join(bin, 'git'), "#!/bin/sh\necho 'fatal: detected dubious ownership in repository' >&2\nexit 128\n", { mode: 0o755 });
      const env = { ...UNPINNED, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
      assert.match(projectEngineCheck(dir, { ...process.env, ...env }).why, /git rev-parse exited 128: fatal: detected dubious ownership/);
      const init = await cli(['db', 'init'], dir, env);
      assert.equal(init.code, 0, init.err);
      assert.equal(JSON.parse(init.out).engine, 'node:sqlite');
      assert.equal((await cli(['reflect', 'lessons', 'list'], dir, env)).code, 0);
      assert.ok(!exists(path.join(dir, 'PWNED')));
    } finally { await rm(dir); await rm(bin); }
  });

  it('a node_modules above the project (outside its folder) is not loaded', { skip: skipGit }, async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      await fs.mkdir(dir);
      await onSqlite(dir);
      await fakeBetterSqlite(path.join(root, 'node_modules', 'better-sqlite3'), dir);
      git(dir, 'init', '-q');
      await assertNotLoaded(dir, /outside the project folder/);
    } finally { await rm(root); }
  });

  it('npm-installed (git does not track it) in a git repository: loaded, the documented `npm install better-sqlite3` fix', { skip: BETTER_IN_KIT ? 'better-sqlite3 is installed in the kit, which is tried first' : skipGit }, async () => {
    const dir = await tmp();
    try {
      await onSqlite(dir);
      await fakeBetterSqlite(path.join(dir, 'node_modules', 'better-sqlite3'), dir);
      git(dir, 'init', '-q');
      await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'init');
      assert.ok(projectEngineCheck(dir).base);
      // a fresh process (this one caches the engine it loaded per project)
      const url = JSON.stringify(new URL(`file://${path.join(HERE, '../src/lib/kit/store.js')}`).href);
      const d = spawnSync(process.execPath, ['--input-type=module', '-e', `import { storeCheck } from ${url}; process.stdout.write(JSON.stringify(await storeCheck({ cwd: process.cwd() })));`], { cwd: dir, env: { ...process.env, ...UNPINNED }, encoding: 'utf-8' });
      assert.equal(JSON.parse(d.stdout).engine, 'better-sqlite3', 'an npm-installed (untracked) better-sqlite3 is the user\'s choice');
      assert.ok(exists(path.join(dir, 'PWNED')));
    } finally { await rm(dir); }
  });

  it('a project on the JSON files never loads it, even npm-installed', { skip: skipGit }, async () => {
    const dir = await tmp();
    try {
      await fs.writeFile(path.join(dir, 'package.json'), '{"name":"cloned"}');
      await fakeBetterSqlite(path.join(dir, 'node_modules', 'better-sqlite3'), dir);
      git(dir, 'init', '-q');
      for (const args of [['db', 'status'], ['reflect', 'lessons', 'list'], ['db', 'export'], ['db', 'off']]) await cli(args, dir, UNPINNED);
      assert.equal((await storeCheck({ cwd: dir, env: { ...process.env, ...UNPINNED } })).store, 'json');
      assert.ok(!exists(path.join(dir, 'PWNED')));
    } finally { await rm(dir); }
  });
});

describe('a database the kit did not make is refused before it is read or migrated (defence in depth; r9a-1, r9a-4, r10a-4)', () => {
  it('a trigger: db init exits 1 naming it, migrates nothing, and the target stays untouched; off and export refuse too', { skip }, async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      await fs.mkdir(dir);
      const target = path.join(root, 'settings.json');
      await fs.writeFile(target, '{"theme":"dark"}\n');
      await kitMade(dir);
      plantTrigger(DB(dir), target);
      const before = await fs.readFile(DB(dir));
      const r = await cli(['db', 'init'], dir, ENV);
      assert.equal(r.code, 1);
      assert.match(r.err, /suite\.db holds a trigger "plant" that is not in the kit's own schema, so the kit did not make it: refusing it/);
      assert.deepEqual(await fs.readFile(DB(dir)), before, 'not migrated, not written');
      await fs.writeFile(storePaths(dir).config, '{"store":"sqlite"}');
      for (const args of [['db', 'off'], ['db', 'export'], ['db', 'status'], ['reflect', 'lessons', 'list']]) {
        const x = await cli(args, dir, ENV);
        assert.equal(x.code, 1, args.join(' '));
        assert.match(x.err, /trigger "plant"/, args.join(' '));
      }
      assert.equal(await fs.readFile(target, 'utf-8'), '{"theme":"dark"}\n');
    } finally { await rm(root); }
  });

  it('a recursive view in place of store_docs fails fast (exit 1 naming it) on the JSON side and in db status', { skip }, async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(storePaths(dir).dir, { recursive: true, mode: 0o700 });
      const d = raw(DB(dir));
      d.exec("CREATE VIEW store_docs AS WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT 'lessons' AS store, 'a.json' AS scope, NULL AS file_sha256 FROM c WHERE x < 0");
      closeFlat(d);
      await fs.writeFile(path.join(dir, 'a.json'), '{}');
      await fs.writeFile(JOURNAL(dir), JSON.stringify({ version: 1, files: [{ path: 'a.json', store: 'lessons', scope: 'a.json', new_sha256: sha('{}'), original: { base64: b64('{"x":1}') } }] }));
      for (const args of [['reflect', 'lessons', 'list'], ['db', 'status']]) {
        const r = await cli(args, dir, {}, { timeout: 20000 });
        assert.equal(r.signal, null, `${args.join(' ')} hung`);
        assert.equal(r.code, 1, args.join(' '));
        assert.match(r.err, /holds a view "store_docs" that is not in the kit's own schema/);
        assert.ok(r.ms < 15000, `${r.ms} ms`);
      }
      assert.equal(await fs.readFile(path.join(dir, 'a.json'), 'utf-8'), '{}');
    } finally { await rm(dir); }
  });

  it('an unknown table, a virtual table, a kit table with other SQL and ANALYZE\'s sqlite_stat tables are refused; the kit\'s own older schema is not', { skip }, async () => {
    const dir = await tmp();
    try {
      await kitMade(dir);
      const pristine = await fs.readFile(DB(dir));
      for (const [sql, reason] of [
        ['CREATE TABLE extra (x)', /table "extra" that is not in/],
        ['CREATE VIRTUAL TABLE v USING json_each', /not in the kit's own schema|cannot set up|no such module/],
        ['DROP INDEX lessons_role; CREATE INDEX lessons_role ON lessons (scope)', /index "lessons_role" that differs from the kit's own schema/],
        ["ALTER TABLE lessons ADD COLUMN g TEXT GENERATED ALWAYS AS (data || 'x') VIRTUAL", /table "lessons" that differs from the kit's own schema/],
        ['ANALYZE', /table "sqlite_stat1" that is not in the kit's own schema/]
      ]) {
        await fs.writeFile(DB(dir), pristine);
        const d = raw(DB(dir));
        let made = true;
        try { d.exec(sql); } catch { made = false; }
        if (sql === 'ANALYZE') assert.ok(d.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'sqlite_stat%'").all().length > 0, 'ANALYZE made a sqlite_stat table');
        closeFlat(d);
        if (!made) continue; // this SQLite build has no such feature
        const r = await call(db, ['status'], dir, ENV);
        assert.equal(r.code, 1, sql);
        assert.match(r.err, reason, sql);
      }
      await fs.writeFile(DB(dir), pristine);
      const ok = await call(db, ['status'], dir, ENV);
      assert.equal(ok.code, 0, ok.err);
      assert.equal(ok.out.rows.lessons, 1);
    } finally { await rm(dir); }
  });

  it('the schema check source names no sqlite_stat exception', async () => {
    const src = await fs.readFile(path.join(HERE, '../src/lib/kit/store.js'), 'utf-8');
    assert.doesNotMatch(src, /sqlite_stat\[1-4\]/);
  });
});

describe('a document\'s file is one the kit maps, inside the project; one that is not stops db off (r10b-1, r9a-1, r9a-3)', () => {
  /** A project on sqlite with rows planted for an absolute path, a `..` path, package.json and .claude/settings.json. */
  async function planted() {
    const root = await tmp();
    const dir = path.join(root, 'p');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"victim"}\n');
    assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
    assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
    const abs = path.join(root, 'home', 'settings.json');
    const d = raw(DB(dir));
    const ins = d.prepare('INSERT INTO store_docs (store, scope, data, updated_at, file_sha256) VALUES (?, ?, ?, ?, NULL)');
    const doc = JSON.stringify({ keys: ['hooks'], fields: { hooks: { Stop: 'evil' } } });
    for (const [store, scope] of [['noise-ledger', abs], ['lessons', '../outside/new.json'], ['lessons', 'package.json'], ['triage', '.claude/settings.json']]) ins.run(store, scope, doc, '2026-01-01');
    d.close();
    return { root, dir, abs };
  }
  const SCOPES = (out) => out.map((u) => u.scope).sort();

  it('export writes the mapped documents and exits 1 listing the others; off refuses (still sqlite, nothing changed) until they are forgotten', { skip }, async () => {
    const { root, dir, abs } = await planted();
    try {
      const st = await call(db, ['status'], dir, ENV);
      assert.equal(st.code, 0, st.err);
      assert.equal(st.out.unmapped.length, 4);
      const ex = await cli(['db', 'export'], dir, ENV);
      assert.equal(ex.code, 1, 'a skipped document makes export exit 1');
      const exOut = JSON.parse(ex.out);
      assert.deepEqual(exOut.exported, [{ store: 'lessons', scope: LESSONS }]);
      assert.deepEqual(SCOPES(exOut.not_written), ['.claude/settings.json', '../outside/new.json', abs.split(path.sep).join('/'), 'package.json'].sort());
      assert.match(exOut.not_written.find((u) => u.scope === 'package.json').reason, /not a file the kit writes for lessons/);
      const sy = await call(db, ['sync', '--from-files'], dir, ENV);
      assert.equal(sy.code, 0, sy.err);
      assert.equal(sy.out.not_written.length, 4);
      const named = await call(db, ['sync', '--from-files', '--scope', abs], dir, ENV);
      assert.equal(named.code, 1);
      assert.match(named.err, /is outside the project folder/);
      const lessonsBefore = await fs.readFile(path.join(dir, LESSONS));
      const off = await call(db, ['off'], dir, ENV);
      assert.equal(off.code, 1);
      assert.match(off.err, /^db off: 4 document\(s\) cannot be written to a file inside the project, so the project stays on SQLite and nothing was changed: .*db forget --scope <scope>.*then run `db off` again$/s);
      assert.equal((await call(db, ['status'], dir, ENV)).out.store, 'sqlite');
      assert.deepEqual(await fs.readFile(path.join(dir, LESSONS)), lessonsBefore);
      assert.ok(!exists(storePaths(dir).journal));
      for (const scope of SCOPES(exOut.not_written)) {
        const f = await call(db, ['forget', '--scope', scope], dir, ENV);
        assert.equal(f.code, 0, f.err);
        assert.equal(f.out.forgotten.length, 1);
        assert.deepEqual(f.out.forgotten[0].document, { hooks: { Stop: 'evil' } }, 'the removed rows are printed');
      }
      assert.equal((await call(db, ['forget', '--scope', 'package.json'], dir, ENV)).code, 1, 'nothing left to forget');
      const off2 = await call(db, ['off'], dir, ENV);
      assert.equal(off2.code, 0, off2.err);
      assert.ok(!exists(abs) && !exists(path.join(root, 'outside')) && !exists(path.join(dir, '.claude/settings.json')));
      assert.equal(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'), '{"name":"victim"}\n');
      assert.equal(JSON.parse(await fs.readFile(path.join(dir, LESSONS), 'utf-8')).lessons.length, 1);
    } finally { await rm(root); }
  });

  it('a --ledger path outside the project: export exits 1 and lists it, off refuses and names it; forget, then off works', { skip }, async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      await fs.mkdir(dir);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await call(noise, ['accept', '--id', 'n1', '--reason', 'flaky upstream', '--ledger', '../outside/l.json'], dir, ENV)).code, 0);
      const scope = path.join(root, 'outside', 'l.json').split(path.sep).join('/');
      const ex = await call(db, ['export'], dir, ENV);
      assert.equal(ex.out.exit, 1);
      assert.deepEqual(SCOPES(ex.out.not_written), [scope]);
      assert.match(ex.out.not_written[0].reason, /is outside the project folder/);
      const off = await call(db, ['off'], dir, ENV);
      assert.equal(off.code, 1);
      assert.ok(off.err.includes(scope));
      assert.ok(!exists(path.join(root, 'outside')));
      const f = await call(db, ['forget', '--scope', scope], dir, ENV);
      assert.equal(f.code, 0, f.err);
      assert.deepEqual(f.out.forgotten[0].document.entries.map((e) => e.id), ['n1']);
      assert.deepEqual(registeredScopes(dir), {});
      assert.equal((await call(db, ['off'], dir, ENV)).code, 0);
    } finally { await rm(root); }
  });

  it('a .claude that is a symbolic link inside the repository is fine: init imports, export and off write through it', { skip }, async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(path.join(dir, 'dotfiles/.claude'), { recursive: true });
      await fs.symlink('dotfiles/.claude', path.join(dir, '.claude'));
      assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
      const init = await call(db, ['init'], dir, ENV);
      assert.equal(init.code, 0, init.err);
      assert.deepEqual(init.out.imported, [{ store: 'lessons', scope: LESSONS }]);
      assert.equal(init.out.not_imported, undefined);
      assert.equal((await save(dir, 'Pin every dependency to an exact version.')).code, 0);
      const ex = await call(db, ['export'], dir, ENV);
      assert.equal(ex.code, 0, ex.err);
      assert.equal(ex.out.exit, undefined);
      const off = await call(db, ['off'], dir, ENV);
      assert.equal(off.code, 0, off.err);
      assert.equal((await call(reflect, ['lessons', 'list'], dir, {})).out.lessons.length, 2);
      assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'dotfiles/.claude/kit/lessons.json'), 'utf-8')).lessons.length, 2);
    } finally { await rm(dir); }
  });

  it('a .claude that is a symbolic link to a folder outside the project: not imported, export exits 1, off refuses', { skip }, async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      await fs.mkdir(path.join(root, 'shared/.claude'), { recursive: true });
      await fs.mkdir(dir);
      await fs.symlink('../shared/.claude', path.join(dir, '.claude'));
      assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
      const init = await call(db, ['init'], dir, ENV);
      assert.equal(init.code, 0, init.err);
      assert.deepEqual(init.out.imported, []);
      assert.ok(init.out.not_imported.some((u) => u.scope === LESSONS && /outside the project folder/.test(u.reason)));
      assert.equal((await save(dir, 'Pin every dependency to an exact version.')).code, 0);
      assert.equal((await call(db, ['export'], dir, ENV)).out.exit, 1);
      const off = await call(db, ['off'], dir, ENV);
      assert.equal(off.code, 1);
      assert.match(off.err, /stays on SQLite/);
      assert.equal((await call(db, ['status'], dir, ENV)).out.store, 'sqlite');
      assert.equal(JSON.parse(await fs.readFile(path.join(root, 'shared/.claude/kit/lessons.json'), 'utf-8')).lessons.length, 1, 'nothing written outside');
    } finally { await rm(root); }
  });

  it('db init re-imports only mapped documents (no state lock or read beside a planted path)', { skip }, async () => {
    const { root, dir, abs } = await planted();
    try {
      for (const scope of ['../outside/new.json', 'package.json', '.claude/settings.json', abs.split(path.sep).join('/')]) assert.equal((await call(db, ['forget', '--scope', scope], dir, ENV)).code, 0);
      assert.equal((await call(db, ['off'], dir, ENV)).code, 0);
      // plant them again in the database left by off, then init from the JSON files
      const d = raw(DB(dir));
      const ins = d.prepare('INSERT INTO store_docs (store, scope, data, updated_at, file_sha256) VALUES (?, ?, ?, ?, NULL)');
      for (const [store, scope] of [['noise-ledger', abs], ['lessons', '../outside/new.json'], ['lessons', 'package.json'], ['triage', '.claude/settings.json']]) ins.run(store, scope, '{"keys":[],"fields":{}}', '2026-01-01');
      d.close();
      await fs.mkdir(path.dirname(abs), { recursive: true });
      const init = await call(db, ['init'], dir, ENV);
      assert.equal(init.code, 0, init.err);
      assert.equal(init.out.not_imported.length, 4);
      assert.deepEqual(await fs.readdir(path.dirname(abs)), [], 'no lock file next to the planted path');
    } finally { await rm(root); }
  });

  it('a journal entry for package.json is refused even with a store_docs row naming it (the r9a-3 repro, now in the per-user folder)', { skip }, async () => {
    const dir = await tmp();
    try {
      await fs.writeFile(path.join(dir, 'package.json'), '{"name":"victim"}');
      await kitMade(dir);
      const d = raw(DB(dir));
      d.prepare("INSERT INTO store_docs (store, scope, data, updated_at, file_sha256) VALUES ('lessons', 'package.json', '{\"keys\":[],\"fields\":{}}', 'x', 'zz')").run();
      d.close();
      await fs.writeFile(JOURNAL(dir), JSON.stringify({ version: 1, files: [{ path: 'package.json', store: 'lessons', scope: 'package.json', new_sha256: sha('{"name":"victim"}'), original: { base64: b64('{"name":"victim","scripts":{"postinstall":"evil"}}') } }] }));
      const r = await cli(['reflect', 'lessons', 'list'], dir);
      assert.equal(r.code, 0, r.err);
      assert.match(r.err, /refusing the files journal .*package\.json is not a file the kit writes for lessons/);
      assert.equal(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'), '{"name":"victim"}');
    } finally { await rm(dir); }
  });

  it('a --store path a verb on this machine wrote is registered in the per-user store.local.json, and export writes it', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await save(dir, 'Keep the side store apart from the main one.', ['--store', 'side/a.json'])).code, 0);
      assert.deepEqual(registeredScopes(dir), { lessons: ['side/a.json'] });
      assert.deepEqual(JSON.parse(await fs.readFile(storePaths(dir).config, 'utf-8')).scopes, { lessons: ['side/a.json'] });
      const ex = await call(db, ['export'], dir, ENV);
      assert.equal(ex.code, 0, ex.err);
      assert.equal(ex.out.not_written, undefined);
      assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'side/a.json'), 'utf-8')).lessons.length, 1);
    } finally { await rm(dir); }
  });
});

describe('triage list gives the store\'s own errors as they are (r9b-1)', () => {
  it('drift, no engine and a missing suite.db are not "corrupt or unreadable"; a corrupt file still is', { skip }, async () => {
    const dir = await tmp();
    try {
      const VISIT = JSON.stringify({ enabled: ['r'], violations: [{ scope: 'a.js', rule: 'r', source: 'auto' }] });
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await call(triage, ['visit', '--session', 's1'], dir, ENV, VISIT)).code, 0);
      assert.equal((await call(db, ['export'], dir, ENV)).code, 0);
      const f = path.join(dir, '.claude/kit/triage.json');
      const doc = JSON.parse(await fs.readFile(f, 'utf-8'));
      doc.extra = 'edited after the export';
      await fs.writeFile(f, JSON.stringify(doc));
      const drift = await call(triage, ['list'], dir, ENV);
      assert.equal(drift.code, 1);
      assert.match(drift.err, /^\.claude\/kit\/triage\.json changed since the database last synced/);
      assert.doesNotMatch(drift.err, /corrupt or unreadable/);
      const none = await call(triage, ['list'], dir, { KIT_SQLITE_ENGINE: 'none' });
      assert.equal(none.code, 1);
      assert.match(none.err, /^this project keeps its kit state in SQLite/);
      await fs.rm(DB(dir));
      const missing = await call(triage, ['list'], dir, ENV);
      assert.equal(missing.code, 1);
      assert.match(missing.err, /suite\.db is missing/);
      assert.doesNotMatch(missing.err, /corrupt or unreadable/);
      // on the JSON files a broken state file keeps its label
      const j = await tmp();
      try {
        await fs.mkdir(path.join(j, '.claude/kit'), { recursive: true });
        await fs.writeFile(path.join(j, '.claude/kit/triage.json'), '{not json');
        const bad = await call(triage, ['list'], j);
        assert.equal(bad.code, 1);
        assert.match(bad.err, /corrupt or unreadable/);
      } finally { await rm(j); }
    } finally { await rm(dir); }
  });
});

describe('the Node version that has node:sqlite (r9b-2)', () => {
  it('unflagged from 22.13 and 23.4; 22.5 to 22.12 only with --experimental-sqlite; older never', () => {
    for (const v of ['22.13.0', '22.22.1', '23.4.0', '24.0.0', '25.1.0']) assert.equal(nodeSqliteSupport(v, []).ok, true, v);
    for (const v of ['22.5.0', '22.12.0', '23.3.0']) {
      assert.equal(nodeSqliteSupport(v, []).ok, false, v);
      assert.match(nodeSqliteSupport(v, []).why, /Node 22\.13\+ \/ 23\.4\+.*--experimental-sqlite/);
      assert.equal(nodeSqliteSupport(v, ['--experimental-sqlite']).ok, true, v);
    }
    for (const v of ['20.18.0', '22.4.0', '18.0.0']) assert.equal(nodeSqliteSupport(v, ['--experimental-sqlite']).ok, false, v);
  });

  it('every engine message names 22.13+', async () => {
    const src = await fs.readFile(path.join(HERE, '../src/lib/kit/store.js'), 'utf-8');
    assert.doesNotMatch(src.replace(/on Node 22\.5\+ before 22\.13 only with --experimental-sqlite/g, '').replace(/on 22\.5 to 22\.12 only with --experimental-sqlite/g, '').replace(/22\.5 to 22\.12 \(and 23\.0 to 23\.3\)/g, ''), /22\.5\+/);
    const dbSrc = await fs.readFile(path.join(HERE, '../src/lib/kit/db.js'), 'utf-8');
    assert.match(dbSrc, /Node 22\.13\+/);
  });
});

describe('db init writes nothing in the project (r9b-3 superseded: no .gitignore rule is needed)', () => {
  it('init, a save and status leave the project as it was; the store folder is 0700', { skip }, async () => {
    const dir = await tmp();
    try {
      await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules');
      const before = snapshot(dir);
      const r = await call(db, ['init'], dir, ENV);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.gitignore_added, undefined);
      assert.equal((await save(dir, 'Run the linter before every commit.')).code, 0);
      assert.equal((await call(db, ['status'], dir, ENV)).code, 0);
      assert.deepEqual(snapshot(dir), before);
      for (const f of STRAY_PROJECT_FILES) assert.ok(!exists(path.join(dir, f)), f);
      assert.equal(fsSync.statSync(storePaths(dir).dir).mode & 0o777, 0o700);
      if (HAVE_GIT) {
        git(dir, 'init', '-q');
        git(dir, 'add', '-A');
        assert.doesNotMatch(git(dir, 'ls-files'), /suite\.db|store\.local\.json/);
      }
    } finally { await rm(dir); }
  });
});
