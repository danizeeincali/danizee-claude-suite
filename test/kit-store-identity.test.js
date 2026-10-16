// The optional SQLite store's identity and file guards (review round 11). A project names its per-user store by a
// random id in its git-ignored marker `.claude/kit/store-id`, never by its path: a moved project keeps its store, a new
// project at an old path does not inherit one, a copy of the project folder must take its own (`db init --new`), and a
// marker the kit wrote whose store is gone is exit 1, never a silent fall back to the JSON files. A marker is only an
// id: junk or a planted one is ignored or refused, never a way to another store. DANIZEE_KIT_HOME must be absolute and
// outside the project. The SQLite store's own paths never read or write a store file through a symbolic link, and a
// link that leads nowhere counts as outside. node:sqlite here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { run as reflect } from '../src/lib/kit/reflect.js';
import { run as noise } from '../src/lib/kit/noise-ledger.js';
import { run as db } from '../src/lib/kit/db.js';
import { storePaths, locateStore, outsideProject, readMarker, MARKER_FILE } from '../src/lib/kit/store.js';

// the machine-local store lives in a per-user folder: here a temporary one (one sub-folder per store)
process.env.DANIZEE_KIT_HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), 'kit-home-'));
process.on('exit', () => { try { fsSync.rmSync(process.env.DANIZEE_KIT_HOME, { recursive: true, force: true }); } catch { /* best effort */ } });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '../src/lib/kit/cli.js');
const NODE_SQLITE = (() => { try { createRequire(import.meta.url)('node:sqlite'); return true; } catch { return false; } })();
const HAVE_GIT = spawnSync('git', ['--version']).status === 0;
const skip = !NODE_SQLITE;
const ENV = { KIT_SQLITE_ENGINE: 'node:sqlite' };
const LESSONS = '.claude/kit/lessons.json';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'kit-store-id-'));
const rm = (d) => fs.rm(d, { recursive: true, force: true });
const exists = (p) => fsSync.existsSync(p);
const marker = (dir) => path.join(dir, ...MARKER_FILE.split('/'));
const homeEntries = () => fsSync.readdirSync(process.env.DANIZEE_KIT_HOME).sort();

async function call(verb, args, cwd, env = ENV, stdin = '') {
  try { return { code: 0, out: await verb(args, { cwd, env, stdin: async () => stdin, stdinIsTTY: false }) }; } catch (e) { return { code: e.code ?? 99, err: e.message }; }
}

function cli(args, cwd, env = ENV) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => { let json = null; try { json = JSON.parse(out); } catch { /* raw */ } resolve({ code, out, err, json }); });
  });
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

const save = (dir, text, env = ENV) => call(reflect, ['lessons', 'save', '--role', 'r', '--session', 's', '--text', text], dir, env);
const lessonIds = async (dir, env = ENV) => {
  const r = await call(reflect, ['lessons', 'list'], dir, env);
  assert.equal(r.code, 0, r.err);
  return r.out.lessons.map((l) => `${l.id}:${l.text}`);
};

/** A project on sqlite: L1 in lessons.json and the database, L2 in the database only. */
async function onSqlite(dir) {
  assert.equal((await save(dir, 'Run the linter before every commit.', {})).code, 0);
  const init = await call(db, ['init'], dir);
  assert.equal(init.code, 0, init.err);
  assert.equal((await save(dir, 'Pin every dependency to an exact version.')).code, 0);
  assert.deepEqual(await lessonIds(dir), ['L1:Run the linter before every commit.', 'L2:Pin every dependency to an exact version.']);
  return init.out;
}

describe('a project names its store by the random id in its marker, not by its path (r11b-1, r11b-2, r11b-4)', () => {
  it('moved (renamed) on sqlite: the store follows it, nothing falls back to the JSON files, db status says so once (r11b-1)', { skip }, async () => {
    const root = await tmp();
    try {
      const p = path.join(root, 'P');
      const q = path.join(root, 'Q');
      await fs.mkdir(p);
      const init = await onSqlite(p);
      await fs.rename(p, q);
      assert.deepEqual(await lessonIds(q), ['L1:Run the linter before every commit.', 'L2:Pin every dependency to an exact version.'], 'the database-only lesson is still there');
      assert.equal((await save(q, 'Prefer small commits over one large commit.')).code, 0);
      assert.equal(JSON.parse(await fs.readFile(path.join(q, LESSONS), 'utf-8')).lessons.length, 1, 'no write went to the JSON file');
      const st = await call(db, ['status'], q);
      assert.equal(st.code, 0, st.err);
      assert.equal(st.out.store, 'sqlite');
      assert.equal(st.out.store_id, init.store_id);
      assert.equal(st.out.project, fsSync.realpathSync.native(q));
      assert.equal(st.out.moved.from, fsSync.realpathSync.native(root) + path.sep + 'P');
      assert.match(st.out.moved.note, /moved from .*P: its store followed it/);
      const again = await call(db, ['status'], q);
      assert.equal(again.out.moved, undefined, 'reported once');
      assert.equal(JSON.parse(await fs.readFile(path.join(init.store_dir, 'project.json'), 'utf-8')).path, fsSync.realpathSync.native(q));
    } finally { await rm(root); }
  });

  it('a new, unrelated project at the path of a deleted one does not inherit its store (r11b-2)', { skip }, async () => {
    const root = await tmp();
    try {
      const p = path.join(root, 'P');
      await fs.mkdir(p);
      const init = await onSqlite(p);
      await rm(p);
      await fs.mkdir(p);
      if (HAVE_GIT) git(p, 'init', '-q');
      assert.deepEqual(await lessonIds(p), [], 'none of the old project\'s lessons');
      const st = await call(db, ['status'], p);
      assert.equal(st.code, 0, st.err);
      assert.equal(st.out.store, 'json');
      assert.equal(st.out.store_dir, null);
      assert.ok(exists(init.db), 'the old store is left alone');
      // a lessons.json of its own is the JSON store, no drift message about another project's database
      await fs.mkdir(path.join(p, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(p, LESSONS), JSON.stringify({ version: 1, lessons: [] }));
      assert.equal((await save(p, 'Read the diff twice before writing any comment.')).code, 0);
      assert.equal(JSON.parse(await fs.readFile(path.join(p, LESSONS), 'utf-8')).lessons.length, 1);
    } finally { await rm(root); }
  });

  it('a copy of the project folder beside the original is exit 1 naming `db init --new`, which gives the copy its own store', { skip }, async () => {
    const root = await tmp();
    try {
      const p = path.join(root, 'P');
      const c = path.join(root, 'C');
      await fs.mkdir(p);
      const init = await onSqlite(p);
      await fs.cp(p, c, { recursive: true });
      assert.equal(readMarker(c).id, init.store_id);
      for (const args of [['reflect', 'lessons', 'list'], ['reflect', 'lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Saved in the copy.'], ['db', 'status'], ['db', 'export'], ['db', 'init']]) {
        const r = await cli(args, c);
        assert.equal(r.code, 1, args.join(' '));
        assert.match(r.err, /this project folder \(.*C\) is a copy of .*P, which uses the same SQLite store .*Run `db init --new` here/, args.join(' '));
      }
      // the original is untouched and keeps working
      assert.deepEqual(await lessonIds(p), ['L1:Run the linter before every commit.', 'L2:Pin every dependency to an exact version.']);
      const fresh = await call(db, ['init', '--new'], c);
      assert.equal(fresh.code, 0, fresh.err);
      assert.notEqual(fresh.out.store_id, init.store_id);
      assert.equal(fresh.out.new_store, true);
      assert.deepEqual(fresh.out.imported, [{ store: 'lessons', scope: LESSONS }]);
      assert.deepEqual(await lessonIds(c), ['L1:Run the linter before every commit.'], 'the copy starts from its JSON files');
      assert.equal((await save(c, 'Saved in the copy.')).code, 0);
      assert.deepEqual(await lessonIds(p), ['L1:Run the linter before every commit.', 'L2:Pin every dependency to an exact version.'], 'the two stores are apart');
      assert.equal(fsSync.statSync(marker(c)).mode & 0o777, 0o600);
    } finally { await rm(root); }
  });

  it('the same folder under another spelling (a recorded path that is a link to it, as a case variant would be) is the same project: no copy, no move', { skip }, async () => {
    const root = await tmp();
    try {
      const p = path.join(root, 'P');
      await fs.mkdir(p);
      const init = await onSqlite(p);
      await fs.symlink(p, path.join(root, 'Spelling'));
      const pj = path.join(init.store_dir, 'project.json');
      const doc = JSON.parse(await fs.readFile(pj, 'utf-8'));
      await fs.writeFile(pj, JSON.stringify({ ...doc, path: path.join(root, 'Spelling') }));
      assert.equal(locateStore(p).kind, 'store');
      assert.deepEqual(await lessonIds(p), ['L1:Run the linter before every commit.', 'L2:Pin every dependency to an exact version.']);
      const st = await call(db, ['status'], p);
      assert.equal(st.out.moved, undefined);
      assert.equal(JSON.parse(await fs.readFile(pj, 'utf-8')).path, path.join(root, 'Spelling'), 'not rewritten');
      // and the identity uses the file system's own spelling of the path
      const src = await fs.readFile(path.join(HERE, '../src/lib/kit/store.js'), 'utf-8');
      assert.match(src, /export function projectRoot\(cwd\) \{\n {2}try \{ return fs\.realpathSync\.native\(cwd\)/);
    } finally { await rm(root); }
  });
});

describe('a marker is only an id (r11b-1, r11b-2)', () => {
  it('no marker: the JSON files, and nothing is created anywhere', async () => {
    const dir = await tmp();
    try {
      const before = homeEntries();
      assert.equal((await save(dir, 'Run the linter before every commit.', {})).code, 0);
      assert.equal((await call(db, ['status'], dir)).out.store, 'json');
      assert.deepEqual(homeEntries(), before);
      assert.ok(!exists(marker(dir)));
    } finally { await rm(dir); }
  });

  it('a marker the kit wrote whose store is gone is exit 1 on every verb, never a silent fall back; db init starts a new one', { skip }, async () => {
    const dir = await tmp();
    try {
      const init = await onSqlite(dir);
      await rm(init.store_dir);
      for (const args of [['reflect', 'lessons', 'list'], ['reflect', 'lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Lost?'], ['db', 'status'], ['db', 'export'], ['db', 'off']]) {
        const r = await cli(args, dir);
        assert.equal(r.code, 1, args.join(' '));
        assert.match(r.err, /this project was on the SQLite store but its database is missing \(\.claude\/kit\/store-id names store [0-9a-f]{32}; .* does not exist\): run `db init` to start a new one \(imported from the JSON files\) or restore it/, args.join(' '));
      }
      assert.equal(JSON.parse(await fs.readFile(path.join(dir, LESSONS), 'utf-8')).lessons.length, 1, 'nothing was written to the JSON file');
      const re = await call(db, ['init'], dir);
      assert.equal(re.code, 0, re.err);
      assert.notEqual(re.out.store_id, init.store_id);
      assert.deepEqual(await lessonIds(dir), ['L1:Run the linter before every commit.']);
    } finally { await rm(dir); }
  });

  it('junk in the marker (not 32 hex digits) is ignored by the JSON verbs and named by db status; db init replaces it', { skip }, async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(marker(dir), '../../somewhere-else\n');
      assert.equal((await save(dir, 'Run the linter before every commit.', {})).code, 0);
      const st = await call(db, ['status'], dir);
      assert.equal(st.code, 0, st.err);
      assert.equal(st.out.store, 'json');
      assert.match(st.out.marker_ignored, /does not hold a store id `db init` writes \(32 hex digits\).*the project uses the JSON files/);
      const init = await call(db, ['init'], dir);
      assert.equal(init.code, 0, init.err);
      assert.equal(await fs.readFile(marker(dir), 'utf-8'), `${init.out.store_id}\n`);
    } finally { await rm(dir); }
  });

  it('a valid id committed to git (mode 0644) whose store this machine does not have: ignored, the JSON verbs work, db status warns', { skip: HAVE_GIT ? skip : 'needs git' }, async () => {
    const root = await tmp();
    try {
      const evil = path.join(root, 'evil');
      await fs.mkdir(path.join(evil, '.claude/kit'), { recursive: true });
      await fs.writeFile(marker(evil), `${'a'.repeat(32)}\n`, { mode: 0o644 });
      await fs.writeFile(path.join(evil, LESSONS), JSON.stringify({ version: 1, lessons: [] }));
      git(evil, 'init', '-q'); git(evil, 'add', '-A'); git(evil, 'commit', '-q', '-m', 'planted');
      git(root, 'clone', '-q', evil, 'clone');
      const clone = path.join(root, 'clone');
      const before = homeEntries();
      assert.equal((await save(clone, 'Run the linter before every commit.')).code, 0);
      assert.deepEqual(await lessonIds(clone), ['L1:Run the linter before every commit.']);
      const st = await call(db, ['status'], clone);
      assert.equal(st.code, 0, st.err);
      assert.equal(st.out.store, 'json');
      assert.match(st.out.marker_ignored, /names store a{32}, which this machine does not have, and its permissions \(06[46]4\) are not the 0600 `db init` writes \(committed to git\?\)/);
      assert.deepEqual(homeEntries(), before, 'nothing created');
    } finally { await rm(root); }
  });

  it('a marker naming another project\'s existing store (copied in) never reads it: exit 1 as a copy', { skip }, async () => {
    const root = await tmp();
    try {
      const a = path.join(root, 'A');
      const b = path.join(root, 'B');
      await fs.mkdir(a); await fs.mkdir(path.join(b, '.claude/kit'), { recursive: true });
      await onSqlite(a);
      await fs.copyFile(marker(a), marker(b));
      await fs.chmod(marker(b), 0o600);
      const r = await call(reflect, ['lessons', 'list'], b);
      assert.equal(r.code, 1);
      assert.match(r.err, /is a copy of .*A/);
    } finally { await rm(root); }
  });

  it('a marker that is a symbolic link is ignored by the JSON verbs and db init refuses it', { skip }, async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(root, 'id'), `${'b'.repeat(32)}\n`, { mode: 0o600 });
      await fs.symlink(path.join(root, 'id'), marker(dir));
      assert.equal(readMarker(fsSync.realpathSync.native(dir)).state, 'invalid');
      assert.equal((await save(dir, 'Run the linter before every commit.', {})).code, 0);
      assert.match((await call(db, ['status'], dir)).out.marker_ignored, /is a symbolic link/);
      const init = await call(db, ['init'], dir);
      assert.equal(init.code, 1);
      assert.match(init.err, /^db init: \.claude\/kit\/store-id is a symbolic link/);
      assert.equal(await fs.readFile(path.join(root, 'id'), 'utf-8'), `${'b'.repeat(32)}\n`, 'never written through');
    } finally { await rm(root); }
  });
});

describe('DANIZEE_KIT_HOME must be absolute and outside the project (r11a-5)', () => {
  it('a relative value is exit 1 for db init (nothing created) and for a project with a marker; a project without one is untouched', { skip }, async () => {
    const dir = await tmp();
    try {
      const rel = { ...ENV, DANIZEE_KIT_HOME: 'kit-home' };
      const r = await call(db, ['init'], dir, rel);
      assert.equal(r.code, 1);
      assert.match(r.err, /DANIZEE_KIT_HOME="kit-home" is not an absolute path/);
      assert.ok(!exists(path.join(dir, 'kit-home')));
      assert.ok(!exists(marker(dir)));
      assert.equal((await save(dir, 'Run the linter before every commit.', rel)).code, 0, 'no marker: the JSON files, no store needed');
      assert.equal((await call(db, ['init'], dir)).code, 0);
      const verb = await call(reflect, ['lessons', 'list'], dir, rel);
      assert.equal(verb.code, 1);
      assert.match(verb.err, /is not an absolute path/);
    } finally { await rm(dir); }
  });

  it('an absolute value inside the project (or through a link into it) is exit 1', { skip }, async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      await fs.mkdir(dir);
      for (const home of [path.join(dir, '.kit-home'), dir]) {
        const r = await call(db, ['init'], dir, { ...ENV, DANIZEE_KIT_HOME: home });
        assert.equal(r.code, 1, home);
        assert.match(r.err, /is inside the project folder .*: the per-user store must live outside the project/);
      }
      await fs.symlink(dir, path.join(root, 'link'));
      const viaLink = await call(db, ['init'], dir, { ...ENV, DANIZEE_KIT_HOME: path.join(root, 'link', 'h') });
      assert.equal(viaLink.code, 1);
      assert.match(viaLink.err, /is inside the project folder/);
      assert.ok(!exists(marker(dir)));
      assert.ok(!exists(path.join(dir, '.kit-home')));
    } finally { await rm(root); }
  });

  it('db init passes its own env to the store choice it reads (r11a-6): another home\'s choice never decides "files are the truth"', { skip }, async () => {
    const dir = await tmp();
    const other = await tmp();
    try {
      const mine = { ...ENV, DANIZEE_KIT_HOME: await tmp() };
      assert.equal((await save(dir, 'Run the linter before every commit.', {})).code, 0);
      const init = await call(db, ['init'], dir, mine);
      assert.equal(init.code, 0, init.err);
      assert.equal((await call(db, ['off'], dir, mine)).code, 0);
      // the process-wide home has a store of that id on sqlite (as a stale ~/.claude/kit-db could)
      const ghost = path.join(process.env.DANIZEE_KIT_HOME, init.out.store_id);
      await fs.mkdir(ghost, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(ghost, 'project.json'), JSON.stringify({ id: init.out.store_id, path: fsSync.realpathSync.native(dir) }));
      await fs.writeFile(path.join(ghost, 'store.local.json'), '{"store":"sqlite"}');
      // edit the file while on json: init from the JSON files must take the file over the database
      const doc = JSON.parse(await fs.readFile(path.join(dir, LESSONS), 'utf-8'));
      doc.lessons[0].text = 'Run the linter and the tests before every commit.';
      await fs.writeFile(path.join(dir, LESSONS), JSON.stringify(doc, null, 2));
      const re = await call(db, ['init'], dir, mine);
      assert.equal(re.code, 0, re.err);
      assert.deepEqual(re.out.imported, [{ store: 'lessons', scope: LESSONS }]);
      assert.deepEqual(await lessonIds(dir, mine), ['L1:Run the linter and the tests before every commit.']);
      await rm(mine.DANIZEE_KIT_HOME);
      await rm(ghost);
    } finally { await rm(dir); await rm(other); }
  });
});

describe('the SQLite store never reads or writes a store file through a symbolic link (r11a-2, r11a-4)', () => {
  it('a committed lessons.json linked to a secret outside: db init refuses, the secret never reaches the database or the working tree', { skip: HAVE_GIT ? skip : 'needs git' }, async () => {
    const root = await tmp();
    try {
      const outside = path.join(root, 'outside1');
      const dir = path.join(root, 'p');
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'config.json'), '{"lessons":[],"auths":{"registry":{"auth":"SECRET_MARKER_r11a"}}}');
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.symlink(path.join(outside, 'config.json'), path.join(dir, LESSONS));
      git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'linked');
      const init = await cli(['db', 'init'], dir);
      assert.equal(init.code, 1);
      assert.match(init.err, /db init: \.claude\/kit\/lessons\.json is a symbolic link .*the kit never reads or writes a store file through a link/);
      assert.ok(!exists(marker(dir)));
      for (const args of [['db', 'export'], ['db', 'off'], ['db', 'sync', '--from-files']]) await cli(args, dir);
      assert.equal(git(dir, 'status', '--porcelain'), '', 'the link is still a link, nothing else changed');
      assert.ok(fsSync.lstatSync(path.join(dir, LESSONS)).isSymbolicLink());
      for (const f of fsSync.readdirSync(process.env.DANIZEE_KIT_HOME)) {
        const p = path.join(process.env.DANIZEE_KIT_HOME, f, 'suite.db');
        if (exists(p)) assert.ok(!fsSync.readFileSync(p).includes('SECRET_MARKER_r11a'));
      }
    } finally { await rm(root); }
  });

  it('a per-stream triage file linked outside is not imported, never read; export leaves the link and its target alone', { skip }, async () => {
    const root = await tmp();
    try {
      const outside = path.join(root, 'outside');
      const dir = path.join(root, 'p');
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'secret.json'), '{"records":{},"scopes":{},"token":"SECRET_MARKER_triage"}');
      await fs.mkdir(path.join(dir, '.claude/marathon/r1'), { recursive: true });
      await fs.symlink(path.join(outside, 'secret.json'), path.join(dir, '.claude/marathon/r1/triage.json'));
      const init = await call(db, ['init'], dir);
      assert.equal(init.code, 0, init.err);
      assert.ok(init.out.not_imported.some((u) => u.scope === '.claude/marathon/r1/triage.json' && /is a symbolic link/.test(u.reason)));
      assert.ok(!fsSync.readFileSync(init.out.db).includes('SECRET_MARKER_triage'));
      const ex = await call(db, ['export'], dir);
      assert.equal(ex.code, 0, ex.err);
      assert.ok(fsSync.lstatSync(path.join(dir, '.claude/marathon/r1/triage.json')).isSymbolicLink());
      assert.match(await fs.readFile(path.join(outside, 'secret.json'), 'utf-8'), /SECRET_MARKER_triage/);
    } finally { await rm(root); }
  });

  it('lessons.json replaced by a link after init: the verbs refuse it (exit 1), export does not write through or over it', { skip }, async () => {
    const root = await tmp();
    try {
      const outside = path.join(root, 'outside');
      const dir = path.join(root, 'p');
      await fs.mkdir(outside); await fs.mkdir(dir);
      await onSqlite(dir);
      await fs.writeFile(path.join(outside, 'config.json'), '{"lessons":[],"auth":"SECRET_MARKER_late"}');
      await fs.rm(path.join(dir, LESSONS));
      await fs.symlink(path.join(outside, 'config.json'), path.join(dir, LESSONS));
      const list = await call(reflect, ['lessons', 'list'], dir);
      assert.equal(list.code, 1);
      assert.match(list.err, /lessons\.json is a symbolic link: the kit's SQLite store never reads or writes a store file through a link/);
      const ex = await call(db, ['export'], dir);
      assert.equal(ex.out.exit, 1);
      assert.ok(ex.out.not_written.some((u) => u.scope === LESSONS && /symbolic link/.test(u.reason)));
      assert.ok(fsSync.lstatSync(path.join(dir, LESSONS)).isSymbolicLink());
      assert.equal(await fs.readFile(path.join(outside, 'config.json'), 'utf-8'), '{"lessons":[],"auth":"SECRET_MARKER_late"}');
    } finally { await rm(root); }
  });

  it('a symbolic link that leads nowhere on the path counts as outside (r11a-4)', async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      await fs.mkdir(path.join(dir, '.claude/marathon'), { recursive: true });
      await fs.symlink('../../../out/newdir', path.join(dir, '.claude/marathon/r1'));
      assert.match(outsideProject(dir, '.claude/marathon/r1/triage.json'), /leads through a symbolic link that points nowhere \(.*r1\)/);
      await fs.symlink('../nowhere', path.join(dir, 'gone'));
      assert.match(outsideProject(dir, 'gone/deeper/x.json'), /points nowhere/);
      assert.equal(outsideProject(dir, '.claude/kit/lessons.json'), null, 'a plain missing path inside is fine');
      assert.ok(!exists(path.join(root, 'out')));
    } finally { await rm(root); }
  });

  it('the JSON store keeps reading a linked store file, as on base', async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      const other = path.join(root, 'o');
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.mkdir(other);
      assert.equal((await save(other, 'Run the linter before every commit.', {})).code, 0);
      await fs.symlink(path.join(other, LESSONS), path.join(dir, LESSONS));
      assert.deepEqual(await lessonIds(dir, {}), ['L1:Run the linter before every commit.']);
    } finally { await rm(root); }
  });
});

describe('messages and db forget (r11b-5, r11b-6, r11b-7, r11b-8)', () => {
  it('db off names every unmapped scope in full, once (r11b-7)', { skip }, async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      await fs.mkdir(dir);
      assert.equal((await call(db, ['init'], dir)).code, 0);
      const long = path.join(root, 'outside', `${'n'.repeat(150)}`, 'tri.json');
      assert.equal((await call(noise, ['accept', '--id', 'A', '--reason', 'r', '--ledger', long], dir)).code, 0);
      const off = await cli(['db', 'off'], dir);
      assert.equal(off.code, 1);
      const scope = long.split(path.sep).join('/');
      assert.equal(off.err.split(JSON.stringify(scope)).length - 1, 1, `the scope once, in full: ${off.err}`);
      assert.doesNotMatch(off.err, /did not write/);
      assert.match(off.err, /stays on SQLite/);
      const forget = await call(db, ['forget', '--scope', scope], dir);
      assert.equal(forget.code, 0, forget.err);
      assert.equal((await call(db, ['off'], dir)).code, 0);
    } finally { await rm(root); }
  });

  it('db forget: a JSON project has nothing to forget; a kit-mapped file inside the project is refused (r11b-8)', { skip }, async () => {
    const dir = await tmp();
    try {
      const j = await call(db, ['forget', '--scope', 'x'], dir);
      assert.equal(j.code, 1);
      assert.equal(j.err, 'this project is on the JSON files; nothing to forget');
      await onSqlite(dir);
      const own = await call(db, ['forget', '--scope', LESSONS], dir);
      assert.equal(own.code, 1);
      assert.match(own.err, /^\.claude\/kit\/lessons\.json is one of the kit's own files for lessons, inside the project: .*`db export` writes it/);
      assert.deepEqual(await lessonIds(dir), ['L1:Run the linter before every commit.', 'L2:Pin every dependency to an exact version.'], 'nothing forgotten');
    } finally { await rm(dir); }
  });

  it('db init adds the marker\'s .gitignore rule, but never through a linked .gitignore (r11b-6)', { skip }, async () => {
    const root = await tmp();
    try {
      const dir = path.join(root, 'p');
      await fs.mkdir(dir);
      await fs.writeFile(path.join(root, 'global-ignore'), 'x\n');
      await fs.symlink(path.join(root, 'global-ignore'), path.join(dir, '.gitignore'));
      const r = await cli(['db', 'init'], dir);
      assert.equal(r.code, 0, r.err);
      assert.match(r.err, /\.gitignore is not a regular file \(a symbolic link\?\), so \.claude\/kit\/store-id was not added to it/);
      assert.equal(await fs.readFile(path.join(root, 'global-ignore'), 'utf-8'), 'x\n');
      const src = await fs.readFile(path.join(HERE, '../src/lib/kit/db.js'), 'utf-8');
      assert.match(src, /addGitignoreRules\(root, \[MARKER_FILE\], MARKER_RULE_COMMENT, \{ noFollow: true \}\)/);
    } finally { await rm(root); }
  });

  it('the engine fix names this machine and the package\'s optional dependency, not `db off` elsewhere (r11b-5)', async () => {
    const { ENGINE_FIX } = await import('../src/lib/kit/store.js');
    assert.match(ENGINE_FIX, /this machine's store needs a SQLite engine on this machine/);
    assert.match(ENGINE_FIX, /optional dependency better-sqlite3/);
    assert.doesNotMatch(ENGINE_FIX, /db off|npm install better-sqlite3. in the project/);
  });
});

describe('storePaths without a store', () => {
  it('returns no folder and creates nothing', async () => {
    const dir = await tmp();
    try {
      const p = storePaths(dir);
      assert.equal(p.kind, 'none');
      assert.equal(p.db, null);
      assert.equal(fsSync.readdirSync(dir).length, 0);
    } finally { await rm(dir); }
  });
});
