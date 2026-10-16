// The optional SQLite store against a repository that is not trusted (review round 9): a suite.db, files journal or
// store choice committed to git is refused; a database the kit did not make (a trigger, a view, any unknown object)
// is refused before anything reads or migrates it; a row never chooses a path to write; a committed node_modules is
// never loaded; triage list gives the store's own errors as they are; db init git-ignores the store; the Node version
// that has node:sqlite. node:sqlite here.
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
import { storeCheck, nodeSqliteSupport, STORE_GITIGNORE_RULES, registeredScopes } from '../src/lib/kit/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '../src/lib/kit/cli.js');
const req = createRequire(import.meta.url);
const NODE_SQLITE = (() => { try { req('node:sqlite'); return true; } catch { return false; } })();
const HAVE_GIT = spawnSync('git', ['--version']).status === 0;
const ENV = { KIT_SQLITE_ENGINE: 'node:sqlite' };
const skip = !NODE_SQLITE;
const skipGit = !NODE_SQLITE || !HAVE_GIT ? 'needs node:sqlite and git' : false;

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'kit-store-untrusted-'));
const rm = (d) => fs.rm(d, { recursive: true, force: true });
const exists = (p) => fsSync.existsSync(p);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const b64 = (t) => Buffer.from(t).toString('base64');
const DB = '.claude/kit/suite.db';
const JOURNAL = '.claude/kit/suite.db-files-journal';
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
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** A raw node:sqlite connection to a project's suite.db, with no kit check (to craft a database). */
function raw(dir) {
  const { DatabaseSync } = req('node:sqlite');
  return new DatabaseSync(path.join(dir, DB));
}
/** Close a crafted database as one self-contained file (no -wal / -shm beside it). */
function closeFlat(d) {
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  d.exec('PRAGMA journal_mode = DELETE');
  d.close();
}

const save = (dir, text, extra = [], env = ENV) => call(reflect, ['lessons', 'save', '--role', 'r', '--session', 's', '--text', text, ...extra], dir, env);

/** A project made by the kit (one lesson, db init, then back to json so suite.db is one file), to be tampered with. */
async function kitMade(dir) {
  assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
  assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
  const off = await call(db, ['off'], dir, ENV);
  assert.equal(off.code, 0, off.err);
}

/** The r9a-1 trigger: every lesson the user's own `db init` imports plants a noise-ledger document at `target`. */
function plantTrigger(dir, target) {
  const d = raw(dir);
  const data = JSON.stringify({ keys: ['hooks'], fields: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'id > /tmp/x' }] }] } } });
  d.exec(`CREATE TRIGGER plant AFTER INSERT ON lessons BEGIN
    INSERT OR REPLACE INTO store_docs (store, scope, data, updated_at, file_sha256) VALUES ('noise-ledger', '${target}', '${data}', '2026-01-01', NULL);
  END`);
  closeFlat(d);
}

describe('a suite.db, files journal or store choice committed to git is refused (r9a-1, r9a-2)', () => {
  it('a cloned repository committing a suite.db with a trigger: init, off, export, sync and status exit 1 naming it; nothing outside is written', { skip: skipGit }, async () => {
    const root = await tmp();
    try {
      const evil = path.join(root, 'evil');
      const clone = path.join(root, 'clone');
      const home = path.join(root, 'home', '.claude');
      await fs.mkdir(evil, { recursive: true });
      await fs.mkdir(home, { recursive: true });
      const target = path.join(home, 'settings.json');
      await fs.writeFile(target, '{"theme":"dark"}\n');
      await kitMade(evil);
      plantTrigger(evil, target);
      await fs.rm(path.join(evil, '.claude/kit/store.local.json'));
      git(evil, 'init', '-q');
      git(evil, 'add', '-f', DB, LESSONS);
      git(evil, 'commit', '-q', '-m', 'evil');
      git(root, 'clone', '-q', evil, clone);
      assert.ok(exists(path.join(clone, DB)));
      for (const args of [['init'], ['status']]) {
        const r = await cli(['db', ...args], clone, ENV);
        assert.equal(r.code, 1, `db ${args.join(' ')}: ${r.out}`);
        assert.match(r.err, /\.claude\/kit\/suite\.db is committed to this git repository, so the database is not this machine's: refusing it .*git rm --cached .*run `db init`/);
      }
      // the store choice committed too (git add -f): every sqlite verb refuses, nothing loads or opens
      await fs.writeFile(path.join(clone, '.claude/kit/store.local.json'), '{"store":"sqlite"}');
      git(clone, 'add', '-f', '.claude/kit/store.local.json');
      git(clone, 'commit', '-q', '-m', 'sqlite');
      for (const args of [['db', 'off'], ['db', 'export'], ['db', 'sync', '--from-files'], ['db', 'status'], ['reflect', 'lessons', 'list'], ['db', 'init']]) {
        const r = await cli(args, clone, ENV);
        assert.equal(r.code, 1, args.join(' '));
        assert.match(r.err, /store\.local\.json.* committed to this git repository|committed to this git repository/, args.join(' '));
      }
      const check = await storeCheck({ cwd: clone, env: { ...process.env, ...ENV } });
      assert.equal(check.fatal, true);
      assert.match(check.line, /refused: .*committed to this git repository/);
      assert.equal(await fs.readFile(target, 'utf-8'), '{"theme":"dark"}\n', 'the user settings are untouched');
      assert.deepEqual(await fs.readdir(home), ['settings.json']);
    } finally { await rm(root); }
  });

  it('a committed files journal is refused on the JSON side too (exit 1); a journal git does not track is still recovered', { skip: skipGit }, async () => {
    const dir = await tmp();
    try {
      await kitMade(dir);
      git(dir, 'init', '-q');
      // an uncommitted run: lessons.json holds bytes the database never recorded, the journal its original bytes
      const before = await fs.readFile(path.join(dir, LESSONS));
      const now = Buffer.from('{"version":1,"lessons":[]}\n');
      await fs.writeFile(path.join(dir, LESSONS), now);
      await fs.writeFile(path.join(dir, JOURNAL), JSON.stringify({ version: 1, files: [{ path: LESSONS, store: 'lessons', scope: LESSONS, new_sha256: sha(now), original: { base64: before.toString('base64') } }] }));
      git(dir, 'add', '-f', JOURNAL);
      git(dir, 'commit', '-q', '-m', 'journal');
      const r = await cli(['reflect', 'lessons', 'list'], dir);
      assert.equal(r.code, 1);
      assert.match(r.err, /suite\.db-files-journal is committed to this git repository/);
      assert.deepEqual(await fs.readFile(path.join(dir, LESSONS)), now, 'nothing restored');
      git(dir, 'rm', '-q', '--cached', JOURNAL);
      const ok = await cli(['reflect', 'lessons', 'list'], dir);
      assert.equal(ok.code, 0, ok.err);
      assert.match(ok.err, /1 file\(s\) put back/);
      assert.deepEqual(await fs.readFile(path.join(dir, LESSONS)), before);
    } finally { await rm(dir); }
  });

  it('better-sqlite3 in a node_modules committed to git is never loaded; the same module installed (untracked) is', { skip: skipGit }, async () => {
    const BETTER_IN_KIT = (() => { try { createRequire(path.join(HERE, '../src/lib/kit/store.js')).resolve('better-sqlite3'); return true; } catch { return false; } })();
    const dir = await tmp();
    try {
      const mod = path.join(dir, 'node_modules', 'better-sqlite3');
      await fs.mkdir(mod, { recursive: true });
      await fs.writeFile(path.join(dir, 'package.json'), '{"name":"cloned"}');
      await fs.writeFile(path.join(mod, 'package.json'), '{"name":"better-sqlite3","main":"index.js"}');
      await fs.writeFile(path.join(mod, 'index.js'), "require('fs').writeFileSync(require('path').join(__dirname, '..', '..', 'PWNED'), 'ran');\nmodule.exports = class { close() {} };\n");
      git(dir, 'init', '-q');
      git(dir, 'add', 'package.json', 'node_modules');
      git(dir, 'commit', '-q', '-m', 'vendored');
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude/kit/store.local.json'), '{"store":"sqlite"}');
      const UNPINNED = { ...process.env, KIT_SQLITE_ENGINE: '' };
      const c = await storeCheck({ cwd: dir, env: UNPINNED });
      assert.notEqual(c.engine, 'better-sqlite3');
      assert.ok(!exists(path.join(dir, 'PWNED')), 'check ran the committed better-sqlite3');
      for (const args of [['db', 'status'], ['reflect', 'lessons', 'list'], ['db', 'init']]) {
        await cli(args, dir, { KIT_SQLITE_ENGINE: '' });
        assert.ok(!exists(path.join(dir, 'PWNED')), `${args.join(' ')} ran the committed better-sqlite3`);
      }
      if (BETTER_IN_KIT) return; // the kit's own better-sqlite3 is tried first: the project's is never reached
      git(dir, 'rm', '-q', '-r', '--cached', 'node_modules');
      // a fresh process (this one caches the engine it loaded per project)
      const url = JSON.stringify(new URL(`file://${path.join(HERE, '../src/lib/kit/store.js')}`).href);
      const d = spawnSync(process.execPath, ['--input-type=module', '-e', `import { storeCheck } from ${url}; process.stdout.write(JSON.stringify(await storeCheck({ cwd: process.cwd() })));`], { cwd: dir, env: UNPINNED, encoding: 'utf-8' });
      assert.equal(JSON.parse(d.stdout).engine, 'better-sqlite3', 'an npm-installed (untracked) better-sqlite3 is the user\'s choice');
      assert.ok(exists(path.join(dir, 'PWNED')));
    } finally { await rm(dir); }
  });
});

describe('a database the kit did not make is refused before it is read or migrated (r9a-1, r9a-4)', () => {
  it('a trigger: db init exits 1 naming it, migrates nothing, and the target stays untouched; off and export refuse too', { skip }, async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      await fs.mkdir(dir);
      const target = path.join(root, 'settings.json');
      await fs.writeFile(target, '{"theme":"dark"}\n');
      await kitMade(dir);
      plantTrigger(dir, target);
      const before = await fs.readFile(path.join(dir, DB));
      const r = await cli(['db', 'init'], dir, ENV);
      assert.equal(r.code, 1);
      assert.match(r.err, /suite\.db holds a trigger "plant" that is not in the kit's own schema, so the kit did not make it: refusing it/);
      assert.deepEqual(await fs.readFile(path.join(dir, DB)), before, 'not migrated, not written');
      await fs.writeFile(path.join(dir, '.claude/kit/store.local.json'), '{"store":"sqlite"}');
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
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      const d = raw(dir);
      d.exec("CREATE VIEW store_docs AS WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT 'lessons' AS store, 'a.json' AS scope, NULL AS file_sha256 FROM c WHERE x < 0");
      closeFlat(d);
      await fs.writeFile(path.join(dir, 'a.json'), '{}');
      await fs.writeFile(path.join(dir, JOURNAL), JSON.stringify({ version: 1, files: [{ path: 'a.json', store: 'lessons', scope: 'a.json', new_sha256: sha('{}'), original: { base64: b64('{"x":1}') } }] }));
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

  it('an unknown table, a virtual table and a kit table with other SQL are refused; the kit\'s own older schema is not', { skip }, async () => {
    const dir = await tmp();
    try {
      await kitMade(dir);
      const pristine = await fs.readFile(path.join(dir, DB));
      for (const [sql, reason] of [
        ['CREATE TABLE extra (x)', /table "extra" that is not in/],
        ['CREATE VIRTUAL TABLE v USING json_each', /not in the kit's own schema|cannot set up|no such module/],
        ['DROP INDEX lessons_role; CREATE INDEX lessons_role ON lessons (scope)', /index "lessons_role" that differs from the kit's own schema/],
        ["ALTER TABLE lessons ADD COLUMN g TEXT GENERATED ALWAYS AS (data || 'x') VIRTUAL", /table "lessons" that differs from the kit's own schema/]
      ]) {
        await fs.writeFile(path.join(dir, DB), pristine);
        const d = raw(dir);
        let made = true;
        try { d.exec(sql); } catch { made = false; }
        closeFlat(d);
        if (!made) continue; // this SQLite build has no such feature
        const r = await call(db, ['status'], dir, ENV);
        assert.equal(r.code, 1, sql);
        assert.match(r.err, reason, sql);
      }
      await fs.writeFile(path.join(dir, DB), pristine);
      const ok = await call(db, ['status'], dir, ENV);
      assert.equal(ok.code, 0, ok.err);
      assert.equal(ok.out.rows.lessons, 1);
    } finally { await rm(dir); }
  });
});

describe('a row never chooses a path to write (r9a-1, r9a-3)', () => {
  /** A project on sqlite with rows planted for an absolute path, a `..` path and package.json. */
  async function planted() {
    const root = await tmp();
    const dir = path.join(root, 'p');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"victim"}\n');
    assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
    assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
    const abs = path.join(root, 'home', 'settings.json');
    const d = raw(dir);
    const ins = d.prepare('INSERT INTO store_docs (store, scope, data, updated_at, file_sha256) VALUES (?, ?, ?, ?, NULL)');
    const doc = JSON.stringify({ keys: ['hooks'], fields: { hooks: { Stop: 'evil' } } });
    for (const [store, scope] of [['noise-ledger', abs], ['lessons', '../outside/new.json'], ['lessons', 'package.json'], ['triage', '.claude/settings.json']]) ins.run(store, scope, doc, '2026-01-01');
    d.close();
    return { root, dir, abs };
  }
  const UNMAPPED = (out) => out.map((u) => u.scope).sort();

  it('export, off and sync skip and report every document whose scope does not map; nothing outside or unmapped is written', { skip }, async () => {
    const { root, dir, abs } = await planted();
    try {
      const st = await call(db, ['status'], dir, ENV);
      assert.equal(st.code, 0, st.err);
      assert.equal(st.out.unmapped.length, 4);
      const ex = await call(db, ['export'], dir, ENV);
      assert.equal(ex.code, 0, ex.err);
      assert.deepEqual(ex.out.exported, [{ store: 'lessons', scope: LESSONS }]);
      assert.deepEqual(UNMAPPED(ex.out.not_written), ['.claude/settings.json', '../outside/new.json', abs.split(path.sep).join('/'), 'package.json'].sort());
      assert.match(ex.out.not_written.find((u) => u.scope === '../outside/new.json').reason, /not a plain path inside the project/);
      assert.match(ex.out.not_written.find((u) => u.scope === 'package.json').reason, /not a file the kit writes for lessons/);
      const sy = await call(db, ['sync', '--from-files'], dir, ENV);
      assert.equal(sy.code, 0, sy.err);
      assert.equal(sy.out.not_written.length, 4);
      const named = await call(db, ['sync', '--from-files', '--scope', abs], dir, ENV);
      assert.equal(named.code, 1);
      assert.match(named.err, /not a plain path inside the project/);
      const off = await call(db, ['off'], dir, ENV);
      assert.equal(off.code, 0, off.err);
      assert.equal(off.out.not_written.length, 4);
      assert.ok(!exists(abs) && !exists(path.join(root, 'outside')) && !exists(path.join(dir, '.claude/settings.json')));
      assert.equal(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'), '{"name":"victim"}\n');
      assert.equal(JSON.parse(await fs.readFile(path.join(dir, LESSONS), 'utf-8')).lessons.length, 1);
    } finally { await rm(root); }
  });

  it('db init re-imports only mapped documents (no state lock or read beside a planted path)', { skip }, async () => {
    const { root, dir, abs } = await planted();
    try {
      assert.equal((await call(db, ['off'], dir, ENV)).code, 0);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      const init = await call(db, ['init'], dir, ENV);
      assert.equal(init.code, 0, init.err);
      assert.equal(init.out.not_imported.length, 4);
      assert.deepEqual(await fs.readdir(path.dirname(abs)), [], 'no lock file next to the planted path');
    } finally { await rm(root); }
  });

  it('a journal entry for package.json is refused even with a store_docs row naming it (the r9a-3 repro)', { skip }, async () => {
    const dir = await tmp();
    try {
      await fs.writeFile(path.join(dir, 'package.json'), '{"name":"victim"}');
      await kitMade(dir);
      const d = raw(dir);
      d.prepare("INSERT INTO store_docs (store, scope, data, updated_at, file_sha256) VALUES ('lessons', 'package.json', '{\"keys\":[],\"fields\":{}}', 'x', 'zz')").run();
      d.close();
      await fs.writeFile(path.join(dir, JOURNAL), JSON.stringify({ version: 1, files: [{ path: 'package.json', store: 'lessons', scope: 'package.json', new_sha256: sha('{"name":"victim"}'), original: { base64: b64('{"name":"victim","scripts":{"postinstall":"evil"}}') } }] }));
      const r = await cli(['reflect', 'lessons', 'list'], dir);
      assert.equal(r.code, 0, r.err);
      assert.match(r.err, /refusing the files journal .*package\.json is not a file the kit writes for lessons/);
      assert.equal(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'), '{"name":"victim"}');
    } finally { await rm(dir); }
  });

  it('a --store / --ledger path a verb on this machine wrote is registered in store.local.json, and export writes it', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await save(dir, 'Keep the side store apart from the main one.', ['--store', 'side/a.json'])).code, 0);
      assert.deepEqual(registeredScopes(dir), { lessons: ['side/a.json'] });
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
      await fs.rm(path.join(dir, DB));
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

describe('db init git-ignores the store in a project with no installed kit (r9b-3)', () => {
  it('adds suite.db, -wal, -shm, the files journal and store.local.json once, before creating anything', { skip }, async () => {
    const dir = await tmp();
    try {
      await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules');
      const r = await call(db, ['init'], dir, ENV);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.out.gitignore_added, [...STORE_GITIGNORE_RULES]);
      assert.deepEqual([...STORE_GITIGNORE_RULES], ['.claude/kit/suite.db', '.claude/kit/suite.db-wal', '.claude/kit/suite.db-shm', '.claude/kit/suite.db-files-journal', '.claude/kit/store.local.json']);
      const again = await call(db, ['init'], dir, ENV);
      assert.equal(again.out.gitignore_added, undefined);
      const lines = (await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')).split('\n');
      assert.equal(lines[0], 'node_modules');
      for (const rule of STORE_GITIGNORE_RULES) assert.equal(lines.filter((l) => l === rule).length, 1, rule);
      if (HAVE_GIT) {
        git(dir, 'init', '-q');
        git(dir, 'add', '-A');
        const tracked = git(dir, 'ls-files');
        assert.doesNotMatch(tracked, /suite\.db|store\.local\.json/);
      }
    } finally { await rm(dir); }
  });

  it('a project with an installed kit is left to the installer; a .gitignore that is a symbolic link stops init with nothing created', { skip }, async () => {
    const dir = await tmp();
    const other = await tmp();
    try {
      await fs.mkdir(path.join(dir, '.claude/helpers/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude/helpers/kit/store.js'), '');
      const r = await call(db, ['init'], dir, ENV);
      assert.equal(r.code, 0, r.err);
      assert.ok(!exists(path.join(dir, '.gitignore')));
      await fs.writeFile(path.join(other, 'outside'), 'x\n');
      const p = await tmp();
      try {
        await fs.symlink(path.join(other, 'outside'), path.join(p, '.gitignore'));
        const s = await call(db, ['init'], p, ENV);
        assert.equal(s.code, 1);
        assert.match(s.err, /\.gitignore is not a regular file .*nothing was changed/);
        assert.equal(await fs.readFile(path.join(other, 'outside'), 'utf-8'), 'x\n');
        assert.ok(!exists(path.join(p, DB)) && !exists(path.join(p, '.claude/kit/store.local.json')));
      } finally { await rm(p); }
    } finally { await rm(dir); await rm(other); }
  });
});
