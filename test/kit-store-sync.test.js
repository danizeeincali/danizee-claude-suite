// The optional SQLite store against the JSON files it came from: re-import on init, drift after a git pull,
// the machine-local store choice (a clone without suite.db), concurrent writers during db off / db init, and
// db status on a leftover database. node:sqlite here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { run as reflect } from '../src/lib/kit/reflect.js';
import { run as noise } from '../src/lib/kit/noise-ledger.js';
import { run as triage } from '../src/lib/kit/triage.js';
import { run as db } from '../src/lib/kit/db.js';
import { storeCheck, loadEngine, openDb, getDoc, writeConfig, SCHEMA_VERSION, CONFIG_GITIGNORE_RULE } from '../src/lib/kit/store.js';
import { withStateLock } from '../src/lib/kit/state-lock.js';
import kitPlugin from '../src/plugins/kit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '../src/lib/kit/cli.js');
const NODE_SQLITE = (() => { try { createRequire(import.meta.url)('node:sqlite'); return true; } catch { return false; } })();
const ENV = { KIT_SQLITE_ENGINE: 'node:sqlite' };
const skip = !NODE_SQLITE;

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'kit-store-sync-'));
const rm = (d) => fs.rm(d, { recursive: true, force: true });
const exists = (p) => fsSync.existsSync(p);
const readJson = async (dir, f) => JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(verb, args, cwd, env = {}, stdin = '') {
  try { return { code: 0, out: await verb(args, { cwd, env, stdin: async () => stdin, stdinIsTTY: false }) }; } catch (e) { return { code: e.code ?? 99, err: e.message }; }
}

function cli(args, cwd, env = {}, input = '') {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
    p.stdin.end(input);
  });
}

const save = (dir, text, extra = [], env = ENV) => call(reflect, ['lessons', 'save', '--role', 'r', '--session', 's', '--text', text, ...extra], dir, env);
const lessonTexts = async (dir, extra = [], env = ENV) => {
  const r = await call(reflect, ['lessons', 'list', ...extra], dir, env);
  assert.equal(r.code, 0, r.err);
  return r.out.lessons.map((l) => l.text);
};
const ledgerIds = async (dir, f) => (await readJson(dir, f)).entries.map((e) => e.id);
const VISIT = (scope) => JSON.stringify({ enabled: ['r'], violations: [{ scope, rule: 'r', source: 'auto' }] });

/** A raw connection to the project's suite.db (migrated), closed by the caller. */
async function rawDb(dir) {
  const e = await loadEngine({ cwd: dir, env: { ...process.env, ...ENV } });
  return openDb({ open: e.open, dbFile: path.join(dir, '.claude/kit/suite.db') });
}

describe('db init from the JSON files re-imports every scope the database holds', () => {
  it('off -> edit the JSON files of custom --ledger / --store / --state paths -> init: the edits win, nothing stale comes back', { skip }, async () => {
    const dir = await tmp();
    try {
      // json: A in each custom store
      assert.equal((await call(noise, ['accept', '--id', 'A', '--reason', 'r', '--ledger', 'custom/l.json'], dir)).code, 0);
      assert.equal((await save(dir, 'Pin every dependency version in the lockfile.', ['--store', 'custom/side.json'], {})).code, 0);
      assert.equal((await call(triage, ['visit', '--session', 's1', '--state', 'custom/t.json'], dir, {}, VISIT('a.js'))).code, 0);
      assert.equal((await call(noise, ['accept', '--id', 'G', '--reason', 'r', '--ledger', 'custom/gone.json'], dir)).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      // sqlite: B in each (the custom stores enter the database at their first write)
      assert.equal((await call(noise, ['accept', '--id', 'B', '--reason', 'r', '--ledger', 'custom/l.json'], dir, ENV)).code, 0);
      assert.equal((await save(dir, 'Read the whole diff before you comment on it.', ['--store', 'custom/side.json'])).code, 0);
      assert.equal((await call(triage, ['visit', '--session', 's2', '--state', 'custom/t.json'], dir, ENV, VISIT('b.js'))).code, 0);
      assert.equal((await call(noise, ['accept', '--id', 'H', '--reason', 'r', '--ledger', 'custom/gone.json'], dir, ENV)).code, 0);
      const off = await call(db, ['off'], dir, ENV);
      assert.equal(off.code, 0, off.err);
      assert.deepEqual(await ledgerIds(dir, 'custom/l.json'), ['A', 'B']);
      // json again: C in each, and one store's file is deleted
      assert.equal((await call(noise, ['accept', '--id', 'C', '--reason', 'r', '--ledger', 'custom/l.json'], dir)).code, 0);
      assert.equal((await save(dir, 'Name the fix in each error message you write.', ['--store', 'custom/side.json'], {})).code, 0);
      assert.equal((await call(triage, ['visit', '--session', 's3', '--state', 'custom/t.json'], dir, {}, VISIT('c.js'))).code, 0);
      await fs.rm(path.join(dir, 'custom/gone.json'));
      const triageBefore = (await call(triage, ['list', '--state', 'custom/t.json'], dir)).out;
      const init = await call(db, ['init'], dir, ENV);
      assert.equal(init.code, 0, init.err);
      for (const scope of ['custom/l.json', 'custom/side.json', 'custom/t.json']) assert.ok(init.out.imported.some((x) => x.scope === scope), scope);
      assert.deepEqual(init.out.dropped, [{ store: 'noise-ledger', scope: 'custom/gone.json' }]);
      // the database now answers with the JSON edits
      assert.deepEqual(await lessonTexts(dir, ['--store', 'custom/side.json']), ['Pin every dependency version in the lockfile.', 'Read the whole diff before you comment on it.', 'Name the fix in each error message you write.']);
      assert.deepEqual((await call(triage, ['list', '--state', 'custom/t.json'], dir, ENV)).out, triageBefore);
      const ex = await call(db, ['export'], dir, ENV);
      assert.equal(ex.code, 0, ex.err);
      assert.deepEqual(await ledgerIds(dir, 'custom/l.json'), ['A', 'B', 'C']);
      assert.ok(!exists(path.join(dir, 'custom/gone.json')), 'a dropped scope is not written back');
      assert.ok(!(await call(db, ['status'], dir, ENV)).out.documents.some((d) => d.scope === 'custom/gone.json'));
    } finally { await rm(dir); }
  });
});

describe('drift: a shared JSON file changed under the database (a git pull)', () => {
  const L9 = { version: 1, lessons: [{ id: 'L9', role: 'r', text: 'Merge the teammate lesson from their machine.', status: 'active', session: 'tm', kept: 0, created_at: '2026-10-15T00:00:00.000Z' }] };
  // what a git pull brings: the committed file (as last exported: L1) plus the teammate's L9
  const pulledWithL9 = async (dir) => {
    const doc = await readJson(dir, '.claude/kit/lessons.json');
    return { ...doc, lessons: [...doc.lessons, ...L9.lessons] };
  };
  async function teammateScenario(beforePull = async () => {}) {
    const dir = await tmp();
    assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
    assert.equal((await save(dir, 'Save the first own lesson on sqlite.')).code, 0);
    assert.equal((await call(db, ['export'], dir, ENV)).code, 0);
    assert.equal((await save(dir, 'Save the second own lesson after the export.')).code, 0);
    await beforePull(dir);
    // a git pull replaces the committed file with the teammate's version
    await fs.writeFile(path.join(dir, '.claude/kit/lessons.json'), `${JSON.stringify(await pulledWithL9(dir), null, 2)}\n`);
    return dir;
  }
  const DRIFT = /\.claude\/kit\/lessons\.json changed since the database last synced \(a git pull\?\): run `db sync --from-files` to MERGE the file into the database by row id .*`db export --overwrite` instead REPLACES the file with the database and drops 1 file-only row\(s\) \(L9\)/;

  it('every read, write, export and off stops (exit 1 naming the file); the file keeps the teammate lesson', { skip }, async () => {
    const dir = await teammateScenario();
    try {
      for (const r of [
        await call(reflect, ['lessons', 'list'], dir, ENV),
        await save(dir, 'Never write a third lesson onto a stale copy.'),
        await call(db, ['export'], dir, ENV),
        await call(db, ['off'], dir, ENV),
        await cli(['reflect', 'lessons', 'list'], dir, ENV)
      ]) {
        assert.equal(r.code, 1);
        assert.match(r.err, DRIFT);
      }
      assert.deepEqual((await readJson(dir, '.claude/kit/lessons.json')).lessons.map((l) => l.id), ['L1', 'L9']);
      assert.equal((await call(db, ['status'], dir, ENV)).out.store, 'sqlite', 'off did not switch');
      assert.deepEqual((await call(db, ['status'], dir, ENV)).out.drifted, [{ store: 'lessons', scope: '.claude/kit/lessons.json' }]);
      // another scope is not affected
      assert.equal((await save(dir, 'Write a side lesson in a scope that did not drift.', ['--store', 'side.json'])).code, 0);
    } finally { await rm(dir); }
  });

  it('db sync --from-files merges the file by row id (L1, L2 and L9 all kept); then the verbs and off work again', { skip }, async () => {
    const dir = await teammateScenario();
    try {
      const bad = await call(db, ['sync', '--from-files', '--scope', 'nope.json'], dir, ENV);
      assert.equal(bad.code, 1);
      assert.equal((await call(db, ['sync'], dir, ENV)).code, 1, '--from-files is required');
      const s = await call(db, ['sync', '--from-files', '--scope', '.claude/kit/lessons.json'], dir, ENV);
      assert.equal(s.code, 0, s.err);
      assert.deepEqual(s.out.synced, [{ store: 'lessons', scope: '.claude/kit/lessons.json', kept: 1, added: 1, updated: 0, unchanged: 1, conflicts: 0, deleted: 0, renumbered: 0 }]);
      assert.deepEqual(s.out.counts, { kept: 1, added: 1, updated: 0, unchanged: 1, conflicts: 0, deleted: 0, renumbered: 0 });
      assert.deepEqual(s.out.conflicts, []);
      assert.deepEqual(s.out.deleted, []);
      assert.deepEqual(s.out.renumbered, []);
      assert.deepEqual(await lessonTexts(dir), ['Save the first own lesson on sqlite.', 'Save the second own lesson after the export.', 'Merge the teammate lesson from their machine.']);
      // exported: the file and the database match, the hash is current (no drift left)
      assert.deepEqual((await readJson(dir, '.claude/kit/lessons.json')).lessons.map((l) => l.id), ['L1', 'L2', 'L9']);
      assert.equal((await call(db, ['status'], dir, ENV)).out.drifted, undefined);
      assert.equal((await save(dir, 'Save another lesson after the sync.')).code, 0);
      const off = await call(db, ['off'], dir, ENV);
      assert.equal(off.code, 0, off.err);
      assert.deepEqual((await readJson(dir, '.claude/kit/lessons.json')).lessons.map((l) => l.id), ['L1', 'L2', 'L9', 'L10']);
      // sync with no --scope merges every file; a second sync changes nothing
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      const pulled = await readJson(dir, '.claude/kit/lessons.json');
      pulled.lessons.push({ ...L9.lessons[0], id: 'L11', text: 'Merge a second teammate lesson.', created_at: '2026-10-15T01:00:00.000Z' });
      await fs.writeFile(path.join(dir, '.claude/kit/lessons.json'), `${JSON.stringify(pulled, null, 2)}\n`);
      const all = await call(db, ['sync', '--from-files'], dir, ENV);
      assert.equal(all.code, 0, all.err);
      assert.equal(all.out.counts.added, 1);
      assert.equal(all.out.counts.unchanged, 4);
      assert.equal((await lessonTexts(dir)).length, 5);
      const again = await call(db, ['sync', '--from-files'], dir, ENV);
      assert.equal(again.code, 0, again.err);
      assert.deepEqual(again.out.counts, { kept: 0, added: 0, updated: 0, unchanged: 5, conflicts: 0, deleted: 0, renumbered: 0 });
    } finally { await rm(dir); }
  });

  it('a lesson changed on both sides is a listed conflict: the newer timestamp wins, else the database row', { skip }, async () => {
    // L1 is kept (a database edit) before the pull
    const dir = await teammateScenario(async (d) => assert.equal((await call(reflect, ['lessons', 'keep', '--id', 'L1'], d, ENV)).code, 0));
    try {
      const pulled = await readJson(dir, '.claude/kit/lessons.json'); // the teammate file (L1 as last synced, L9)
      const conn = await rawDb(dir);
      let dbDoc;
      try { dbDoc = getDoc(conn, 'lessons', '.claude/kit/lessons.json'); } finally { conn.close(); }
      const [, l2] = dbDoc.lessons;
      const [l1, l9] = pulled.lessons;
      // the teammate retired L1 (a newer retired_at) and rewrote L2 (same created_at and session: the same lesson, so
      // a conflict, not two lessons; same timestamps: the database keeps its L2)
      const theirs = {
        ...pulled,
        lessons: [
          { ...l1, status: 'retired', retire_reason: 'obsolete', retired_at: '2999-01-01T00:00:00.000Z' },
          { ...l2, text: 'A teammate rewrote the second lesson.' },
          l9
        ]
      };
      await fs.writeFile(path.join(dir, '.claude/kit/lessons.json'), `${JSON.stringify(theirs, null, 2)}\n`);
      const drift = await call(db, ['export'], dir, ENV);
      assert.equal(drift.code, 1);
      assert.match(drift.err, /drops 1 file-only row\(s\) \(L9\) and the file's side of 2 conflicting row\(s\)/);
      const s = await call(db, ['sync', '--from-files'], dir, ENV);
      assert.equal(s.code, 0, s.err);
      assert.deepEqual(s.out.counts, { kept: 0, added: 1, updated: 0, unchanged: 0, conflicts: 2, deleted: 0, renumbered: 0 });
      assert.deepEqual(s.out.conflicts, [
        { store: 'lessons', scope: '.claude/kit/lessons.json', part: 'lessons', id: 'L1', kept: 'file', reason: 'the file row is newer' },
        { store: 'lessons', scope: '.claude/kit/lessons.json', part: 'lessons', id: 'L2', kept: 'database', reason: 'same timestamp: the database row' }
      ]);
      // the losing side of each conflict is in the output in full
      assert.deepEqual(s.out.discarded.map((x) => [x.id, x.side, x.row.status, x.row.text]), [
        ['L1', 'database', 'active', 'Save the first own lesson on sqlite.'],
        ['L2', 'file', 'active', 'A teammate rewrote the second lesson.']
      ]);
      assert.deepEqual(s.out.renumbered, []);
      const byId = Object.fromEntries((await readJson(dir, '.claude/kit/lessons.json')).lessons.map((l) => [l.id, l]));
      assert.equal(byId.L1.status, 'retired');
      assert.equal(byId.L2.text, 'Save the second own lesson after the export.');
      assert.ok(byId.L9);
      assert.deepEqual(await lessonTexts(dir), ['Save the second own lesson after the export.', 'Merge the teammate lesson from their machine.']);
    } finally { await rm(dir); }
  });

  it('noise-ledger and triage drift merge the same way (by entry id, by record key)', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await call(noise, ['accept', '--id', 'A', '--reason', 'r'], dir, ENV)).code, 0);
      assert.equal((await call(triage, ['visit', '--session', 's1'], dir, ENV, VISIT('a.js'))).code, 0);
      assert.equal((await call(db, ['export'], dir, ENV)).code, 0);
      assert.equal((await call(noise, ['accept', '--id', 'B', '--reason', 'r'], dir, ENV)).code, 0);
      assert.equal((await call(triage, ['visit', '--session', 's2'], dir, ENV, VISIT('b.js'))).code, 0);
      // a pull brings a teammate's ledger entry T and a triage record of theirs
      const ledger = await readJson(dir, '.claude/kit/noise-ledger.json');
      ledger.entries.push({ id: 'T', reason: 'teammate', added: '2026-10-15' });
      await fs.writeFile(path.join(dir, '.claude/kit/noise-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
      const tri = await readJson(dir, '.claude/kit/triage.json');
      tri.records.teammatefp = { fingerprint: 'teammatefp', scope: 't.js', rule: 'r', status: 'new', issue: null, members: [], agent: false, absent_visits: 0, occurrences: 1, sessions: ['tm'], first_session: 'tm' };
      await fs.writeFile(path.join(dir, '.claude/kit/triage.json'), `${JSON.stringify(tri, null, 2)}\n`);
      assert.equal((await call(noise, ['accept', '--id', 'C', '--reason', 'r'], dir, ENV)).code, 1, 'ledger drift stops the write');
      assert.equal((await call(triage, ['list'], dir, ENV)).code, 1, 'triage drift stops the read');
      const s = await call(db, ['sync', '--from-files'], dir, ENV);
      assert.equal(s.code, 0, s.err);
      assert.equal(s.out.counts.conflicts, 0);
      assert.deepEqual(await ledgerIds(dir, '.claude/kit/noise-ledger.json'), ['A', 'B', 'T']);
      const recs = (await readJson(dir, '.claude/kit/triage.json')).records;
      assert.ok(recs.teammatefp);
      assert.equal(Object.values(recs).filter((r) => r.scope === 'a.js' || r.scope === 'b.js').length, 2, 'both own records kept');
      assert.equal((await call(noise, ['accept', '--id', 'C', '--reason', 'r'], dir, ENV)).code, 0);
    } finally { await rm(dir); }
  });

  it('db export --overwrite replaces the file and says how many file-only rows it dropped', { skip }, async () => {
    const dir = await teammateScenario();
    try {
      const ex = await call(db, ['export', '--overwrite'], dir, ENV);
      assert.equal(ex.code, 0, ex.err);
      assert.deepEqual(ex.out.overwritten, [{ store: 'lessons', scope: '.claude/kit/lessons.json', dropped_file_rows: 1, dropped: [{ part: 'lessons', id: 'L9' }], replaced_conflicts: 0, replaced: [], reverted_file_edits: [], restored_file_deletions: [] }]);
      assert.match(ex.out.warning, /REPLACED 1 changed file\(s\) .*1 file-only row\(s\) were dropped from them \(L9\); `db sync --from-files` merges instead/);
      assert.equal((await readJson(dir, '.claude/kit/lessons.json')).lessons.length, 2);
      assert.equal((await lessonTexts(dir)).length, 2);
      assert.equal((await call(db, ['off'], dir, ENV)).code, 0, 'no drift left after the export');
    } finally { await rm(dir); }
  });

  it('db off --overwrite warns the same way; a corrupt file is named as such', { skip }, async () => {
    const dir = await teammateScenario();
    try {
      await fs.writeFile(path.join(dir, '.claude/kit/lessons.json'), '{ not json');
      const r = await call(reflect, ['lessons', 'list'], dir, ENV);
      assert.equal(r.code, 1);
      assert.match(r.err, /lessons\.json changed since the database last synced \(a git pull\?\) and is not valid JSON: repair the file/);
      await fs.writeFile(path.join(dir, '.claude/kit/lessons.json'), `${JSON.stringify(L9, null, 2)}\n`);
      const off = await call(db, ['off', '--overwrite'], dir, ENV);
      assert.equal(off.code, 0, off.err);
      assert.equal(off.out.overwritten[0].dropped_file_rows, 1);
      assert.match(off.out.warning, /dropped/);
    } finally { await rm(dir); }
  });

  it('a file deleted under the database is not drift (the database keeps the document)', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Keep this lesson in the main store.', [], {})).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      await fs.rm(path.join(dir, '.claude/kit/lessons.json'));
      assert.deepEqual(await lessonTexts(dir), ['Keep this lesson in the main store.']);
      assert.equal((await call(db, ['off'], dir, ENV)).code, 0);
      assert.equal((await readJson(dir, '.claude/kit/lessons.json')).lessons.length, 1);
    } finally { await rm(dir); }
  });
});

describe('db sync --from-files is a three-way merge against the copy last synced', () => {
  const LESSONS = '.claude/kit/lessons.json';
  const LEDGER = '.claude/kit/noise-ledger.json';
  const writeJson = (dir, f, v) => fs.writeFile(path.join(dir, f), `${JSON.stringify(v, null, 2)}\n`);
  const lessonsIn = async (dir) => (await readJson(dir, LESSONS)).lessons.map((l) => [l.id, l.text]);
  const theirLesson = (id, text) => ({ id, role: 'r', text, scope: '', session: 'tm', status: 'active', kept: 0, created_at: '2026-10-15T00:00:00.000Z' });
  const sync = async (dir) => {
    const s = await call(db, ['sync', '--from-files'], dir, ENV);
    assert.equal(s.code, 0, s.err);
    return s.out;
  };

  it('both sides add L2 after the same base: both lessons survive, the database\'s is renumbered and listed', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await save(dir, 'Check database migrations against a copy of production.')).code, 0);
      // the teammate's own L2 arrives with a pull (their nextId was L2 too)
      const pulled = await readJson(dir, LESSONS);
      pulled.lessons.push(theirLesson('L2', 'Pin every dependency to an exact version.'));
      await writeJson(dir, LESSONS, pulled);
      assert.equal((await call(reflect, ['lessons', 'list'], dir, ENV)).code, 1, 'drift');
      const out = await sync(dir);
      assert.deepEqual(out.renumbered, [{ store: 'lessons', scope: LESSONS, from: 'L2', to: 'L3' }]);
      assert.deepEqual(out.conflicts, []);
      assert.deepEqual(out.deleted, []);
      assert.equal(out.counts.renumbered, 1);
      const want = [['L1', 'Run the linter before every commit.'], ['L2', 'Pin every dependency to an exact version.'], ['L3', 'Check database migrations against a copy of production.']];
      assert.deepEqual(await lessonsIn(dir), want, 'the file keeps the teammate L2; the local lesson is L3');
      assert.deepEqual(await lessonTexts(dir), want.map(([, t]) => t));
      // the next id after the merge is L4, and a second sync changes nothing
      assert.equal((await save(dir, 'Write the next lesson after the merge.')).code, 0);
      assert.deepEqual((await call(db, ['export'], dir, ENV)).code, 0);
      assert.deepEqual((await lessonsIn(dir)).map(([id]) => id), ['L1', 'L2', 'L3', 'L4']);
      assert.deepEqual((await sync(dir)).renumbered, []);
    } finally { await rm(dir); }
  });

  it('on sqlite before any lessons.json existed, the teammate\'s first file bringing L1 keeps both L1s', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await save(dir, 'Check database migrations against a copy of production.')).code, 0);
      await writeJson(dir, LESSONS, { version: 1, lessons: [theirLesson('L1', 'Pin every dependency to an exact version.')] });
      const out = await sync(dir);
      assert.deepEqual(out.renumbered, [{ store: 'lessons', scope: LESSONS, from: 'L1', to: 'L2' }]);
      assert.deepEqual(await lessonsIn(dir), [['L1', 'Pin every dependency to an exact version.'], ['L2', 'Check database migrations against a copy of production.']]);
    } finally { await rm(dir); }
  });

  it('a lesson deleted in the file is deleted in the database and listed; it does not come back', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
      assert.equal((await save(dir, 'Paste the staging password into the ticket.', [], {})).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      const pulled = await readJson(dir, LESSONS);
      const gone = pulled.lessons[1];
      pulled.lessons = pulled.lessons.slice(0, 1);
      await writeJson(dir, LESSONS, pulled);
      const out = await sync(dir);
      assert.deepEqual(out.deleted, [{ store: 'lessons', scope: LESSONS, part: 'lessons', id: 'L2', deleted_in: 'file', row: gone }]);
      assert.equal(out.counts.deleted, 1);
      assert.deepEqual((await lessonsIn(dir)).map(([id]) => id), ['L1']);
      assert.deepEqual(await lessonTexts(dir), ['Run the linter before every commit.']);
      assert.equal((await call(db, ['export'], dir, ENV)).code, 0);
      assert.deepEqual((await lessonsIn(dir)).map(([id]) => id), ['L1'], 'export does not write it back');
      assert.deepEqual((await sync(dir)).deleted, []);
    } finally { await rm(dir); }
  });

  it('a lesson retired in the database and deleted in the file keeps the edit and lists the conflict', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
      assert.equal((await save(dir, 'Paste the staging password into the ticket.', [], {})).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await call(reflect, ['lessons', 'retire', '--id', 'L2', '--reason', 'unsafe'], dir, ENV)).code, 0);
      const pulled = await readJson(dir, LESSONS);
      pulled.lessons = pulled.lessons.slice(0, 1);
      await writeJson(dir, LESSONS, pulled);
      const out = await sync(dir);
      assert.deepEqual(out.conflicts, [{ store: 'lessons', scope: LESSONS, part: 'lessons', id: 'L2', kept: 'database', reason: 'changed in the database, deleted in the file: the edit is kept' }]);
      assert.deepEqual(out.deleted, []);
      const byId = Object.fromEntries((await readJson(dir, LESSONS)).lessons.map((l) => [l.id, l]));
      assert.equal(byId.L2.status, 'retired');
    } finally { await rm(dir); }
  });

  it('a lesson changed on one side only takes that side, without a conflict', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
      assert.equal((await save(dir, 'Read the whole diff before you comment on it.', [], {})).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await call(reflect, ['lessons', 'keep', '--id', 'L1'], dir, ENV)).code, 0);
      const pulled = await readJson(dir, LESSONS);
      pulled.lessons[1] = { ...pulled.lessons[1], status: 'retired', retire_reason: 'obsolete', retired_at: '2026-10-15T00:00:00.000Z' };
      await writeJson(dir, LESSONS, pulled);
      const out = await sync(dir);
      assert.deepEqual(out.conflicts, []);
      assert.equal(out.counts.updated, 1);
      assert.equal(out.counts.kept, 1);
      const byId = Object.fromEntries((await readJson(dir, LESSONS)).lessons.map((l) => [l.id, l]));
      assert.equal(byId.L1.kept, 1, 'the database edit');
      assert.equal(byId.L2.status, 'retired', 'the file edit');
    } finally { await rm(dir); }
  });

  it('no base (a database synced by an older kit): union, nothing deleted; same id: kept both unless the same created_at', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
      assert.equal((await save(dir, 'Read the whole diff before you comment on it.', [], {})).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await save(dir, 'Check database migrations against a copy of production.')).code, 0);
      // as an older kit left it: a file hash and no document last synced
      const raw = await rawDb(dir);
      try { raw.run("UPDATE store_docs SET synced_doc = NULL WHERE store = 'lessons'"); } finally { raw.close(); }
      const pulled = await readJson(dir, LESSONS);
      const [, l2] = pulled.lessons;
      // the teammate deleted L1, retired L2 (same created_at: an edit) and added their own L3
      pulled.lessons = [{ ...l2, status: 'retired', retire_reason: 'obsolete', retired_at: '2999-01-01T00:00:00.000Z' }, theirLesson('L3', 'Pin every dependency to an exact version.')];
      await writeJson(dir, LESSONS, pulled);
      const out = await sync(dir);
      assert.equal(out.synced[0].base, 'unknown: union, nothing deleted');
      assert.deepEqual(out.deleted, []);
      assert.deepEqual(out.conflicts.map((c) => [c.id, c.kept]), [['L2', 'file']]);
      assert.deepEqual(out.renumbered, [{ store: 'lessons', scope: LESSONS, from: 'L3', to: 'L4' }]);
      const byId = Object.fromEntries((await readJson(dir, LESSONS)).lessons.map((l) => [l.id, l]));
      assert.deepEqual(Object.keys(byId).sort(), ['L1', 'L2', 'L3', 'L4']);
      assert.equal(byId.L1.text, 'Run the linter before every commit.', 'never deleted without a base');
      assert.equal(byId.L2.status, 'retired');
      assert.equal(byId.L3.text, 'Pin every dependency to an exact version.');
      assert.equal(byId.L4.text, 'Check database migrations against a copy of production.');
      // the sync stored a base: a deletion now applies
      const next = await readJson(dir, LESSONS);
      next.lessons = next.lessons.filter((l) => l.id !== 'L1');
      await writeJson(dir, LESSONS, next);
      assert.deepEqual((await sync(dir)).deleted.map((d) => [d.id, d.deleted_in]), [['L1', 'file']]);
    } finally { await rm(dir); }
  });

  it('noise-ledger: an entry deleted in the file is deleted; one pruned in the database is not resurrected; a file edit beats a prune', { skip }, async () => {
    const dir = await tmp();
    try {
      for (const [id, exp] of [['F1', '2026-01-01'], ['F2', null], ['F3', '2026-01-01'], ['D', null]]) {
        assert.equal((await call(noise, ['accept', '--id', id, '--reason', 'r', '--now', '2025-12-01', ...(exp ? ['--expires', exp] : [])], dir)).code, 0);
      }
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await call(noise, ['prune', '--now', '2026-06-01'], dir, ENV)).code, 0, 'prunes F1 and F3 in the database');
      // the pull: the teammate deleted D, extended F3 and added T; F1 is still in the file as it was
      const pulled = await readJson(dir, LEDGER);
      pulled.entries = pulled.entries.filter((e) => e.id !== 'D').map((e) => (e.id === 'F3' ? { ...e, expires: '2027-01-01' } : e));
      pulled.entries.push({ id: 'T', reason: 'teammate', added: '2026-10-15' });
      await writeJson(dir, LEDGER, pulled);
      const out = await sync(dir);
      assert.deepEqual(out.deleted.map((d) => [d.store, d.id, d.deleted_in]), [['noise-ledger', 'D', 'file'], ['noise-ledger', 'F1', 'database']]);
      assert.deepEqual(out.conflicts.map((c) => [c.id, c.kept, c.reason]), [['F3', 'file', 'changed in the file, deleted in the database: the edit is kept']]);
      assert.deepEqual((await ledgerIds(dir, LEDGER)).sort(), ['F2', 'F3', 'T']);
      assert.equal((await call(noise, ['accept', '--id', 'C', '--reason', 'r'], dir, ENV)).code, 0, 'no drift left');
    } finally { await rm(dir); }
  });

  it('triage: a record deleted in the file is deleted and listed; a record removed in the database is not resurrected', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await call(triage, ['visit', '--session', 's1'], dir, {}, VISIT('a.js'))).code, 0);
      assert.equal((await call(triage, ['visit', '--session', 's2'], dir, {}, VISIT('b.js'))).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      const pulled = await readJson(dir, '.claude/kit/triage.json');
      const [fpA, fpB] = Object.keys(pulled.records).sort((x, y) => (pulled.records[x].scope < pulled.records[y].scope ? -1 : 1));
      assert.equal(pulled.records[fpA].scope, 'a.js');
      delete pulled.records[fpB];
      await writeJson(dir, '.claude/kit/triage.json', pulled);
      const out = await sync(dir);
      assert.deepEqual(out.deleted.filter((d) => d.part === 'records').map((d) => [d.store, d.id, d.deleted_in]), [['triage', fpB, 'file']]);
      const recs = (await readJson(dir, '.claude/kit/triage.json')).records;
      assert.ok(recs[fpA]);
      assert.equal(recs[fpB], undefined);
      assert.equal((await call(db, ['export'], dir, ENV)).code, 0);
      assert.equal((await readJson(dir, '.claude/kit/triage.json')).records[fpB], undefined, 'not written back');
      // removed in the database (raw, as a verb that drops a record would), unchanged in the file: stays removed
      const conn = await rawDb(dir);
      try { conn.run("DELETE FROM triage WHERE stream = '.claude/kit/triage.json' AND key = ?", fpA); } finally { conn.close(); }
      const again = await readJson(dir, '.claude/kit/triage.json');
      again.records.teammatefp = { fingerprint: 'teammatefp', scope: 't.js', rule: 'r', status: 'new', issue: null, members: [], agent: false, absent_visits: 0, occurrences: 1, sessions: ['tm'], first_session: 'tm' };
      await writeJson(dir, '.claude/kit/triage.json', again);
      const out2 = await sync(dir);
      assert.deepEqual(out2.deleted.filter((d) => d.part === 'records').map((d) => [d.id, d.deleted_in]), [[fpA, 'database']]);
      const recs2 = (await readJson(dir, '.claude/kit/triage.json')).records;
      assert.equal(recs2[fpA], undefined);
      assert.ok(recs2.teammatefp);
    } finally { await rm(dir); }
  });
});

describe('a store file that is not a JSON object: repair it in place, then sync (never move it, never db init)', () => {
  const LESSONS = '.claude/kit/lessons.json';
  async function onSqlite() {
    const dir = await tmp();
    assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
    assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
    return dir;
  }
  const CONFLICTED = '{\n  "version": 1,\n<<<<<<< HEAD\n  "lessons": []\n=======\n  "lessons": [{"id": "L2"}]\n>>>>>>> theirs\n}\n';

  it('db sync on a non-object file and on a git-conflicted file says to repair it and run sync again', { skip }, async () => {
    const dir = await onSqlite();
    try {
      for (const text of ['[]\n', CONFLICTED]) {
        await fs.writeFile(path.join(dir, LESSONS), text);
        const r = await call(db, ['sync', '--from-files'], dir, ENV);
        assert.equal(r.code, 1);
        assert.match(r.err, /lessons\.json is not (a JSON object|valid JSON): repair the file in place \(after a git pull with a conflict: resolve the conflict markers and keep the rows of both sides; where both sides added the same id, keep both rows and give one of them the next free id, the highest id in the file plus one\)/);
        assert.match(r.err, /then run `db sync --from-files` again$/);
        assert.doesNotMatch(r.err, /db init|or move|repair or move/);
        assert.match(r.err, /do not move it away/);
      }
      // repaired in place: sync works
      const fixed = { version: 1, lessons: [{ id: 'L1', role: 'r', text: 'Run the linter before every commit.', scope: '', session: 's', status: 'active', kept: 0, created_at: '2026-10-15T00:00:00.000Z' }] };
      await fs.writeFile(path.join(dir, LESSONS), JSON.stringify(fixed));
      assert.equal((await call(db, ['sync', '--from-files'], dir, ENV)).code, 0);
    } finally { await rm(dir); }
  });

  it('the drift message for an unreadable file says to resolve the conflict markers and sync, not to move it', { skip }, async () => {
    const dir = await onSqlite();
    try {
      await fs.writeFile(path.join(dir, LESSONS), CONFLICTED);
      const r = await call(reflect, ['lessons', 'list'], dir, ENV);
      assert.equal(r.code, 1);
      assert.match(r.err, /lessons\.json changed since the database last synced \(a git pull\?\) and is not valid JSON: repair the file in place \(after a git pull with a conflict: resolve the conflict markers and keep the rows of both sides; where both sides added the same id, keep both rows and give one of them the next free id, the highest id in the file plus one\); do not move it away.*then run `db sync --from-files` to merge it with the database$/);
      assert.doesNotMatch(r.err, /or move it away|the database keeps its copy/);
    } finally { await rm(dir); }
  });
});

describe('db export --overwrite names everything it undoes (the sync merge against the base, dry run)', () => {
  const LESSONS = '.claude/kit/lessons.json';
  const writeJson = (dir, f, v) => fs.writeFile(path.join(dir, f), `${JSON.stringify(v, null, 2)}\n`);
  // L1 and L2 saved, db init; the teammate's file deletes L2 and retires L1
  async function deletedAndRetired() {
    const dir = await tmp();
    assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
    assert.equal((await save(dir, 'Read the whole diff before you comment.', [], {})).code, 0);
    assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
    const pulled = await readJson(dir, LESSONS);
    const [l1] = pulled.lessons;
    pulled.lessons = [{ ...l1, status: 'retired', retired_at: '2026-10-16T01:00:00.000Z', retire_reason: 'obsolete' }];
    await writeJson(dir, LESSONS, pulled);
    return dir;
  }

  it('the teammate deleted one lesson and retired another: the drift message and the overwrite output name both', { skip }, async () => {
    const dir = await deletedAndRetired();
    try {
      const ex = await call(db, ['export'], dir, ENV);
      assert.equal(ex.code, 1);
      assert.match(ex.err, /drops 0 file-only row\(s\), reverts 1 edit\(s\) made in the file \(L1\), restores 1 row\(s\) deleted in the file \(L2\)/);
      assert.doesNotMatch(ex.err, /unknown/);
      const ow = await call(db, ['export', '--overwrite'], dir, ENV);
      assert.equal(ow.code, 0, ow.err);
      assert.deepEqual(ow.out.overwritten, [{
        store: 'lessons', scope: LESSONS, dropped_file_rows: 0, dropped: [], replaced_conflicts: 0, replaced: [],
        reverted_file_edits: [{ part: 'lessons', id: 'L1' }], restored_file_deletions: [{ part: 'lessons', id: 'L2' }]
      }]);
      assert.match(ow.out.warning, /0 file-only row\(s\) were dropped from them; 1 edit\(s\) made in the file were reverted \(L1\); 1 row\(s\) deleted in the file were restored \(L2\); `db sync --from-files` merges instead/);
      // what the warning says is what happened: L2 is back, L1 active again
      const file = await readJson(dir, LESSONS);
      assert.deepEqual(file.lessons.map((l) => [l.id, l.status]), [['L1', 'active'], ['L2', 'active']]);
    } finally { await rm(dir); }
  });

  it('db off --overwrite reports the same; without a base it says the effect beyond file-only rows is unknown', { skip }, async () => {
    const dir = await deletedAndRetired();
    try {
      const raw = await rawDb(dir);
      try { raw.run("UPDATE store_docs SET synced_doc = NULL WHERE store = 'lessons'"); } finally { raw.close(); }
      const ex = await call(db, ['export'], dir, ENV);
      assert.equal(ex.code, 1);
      assert.match(ex.err, /drops 0 file-only row\(s\) and the file's side of 1 conflicting row\(s\) \(L1\); the database has no copy of the file as last synced .*which edits and deletions made in the file it would also revert is unknown/);
      const off = await call(db, ['off', '--overwrite'], dir, ENV);
      assert.equal(off.code, 0, off.err);
      assert.equal(off.out.overwritten[0].base, 'unknown: edits and deletions made in the file cannot be told');
      assert.match(off.out.warning, /the database had no copy as last synced, so which edits and deletions made in the file were reverted is unknown/);
    } finally { await rm(dir); }
  });

  it('with a base, off --overwrite lists the reverted edit and the restored deletion', { skip }, async () => {
    const dir = await deletedAndRetired();
    try {
      const off = await call(db, ['off', '--overwrite'], dir, ENV);
      assert.equal(off.code, 0, off.err);
      assert.deepEqual(off.out.overwritten[0].reverted_file_edits, [{ part: 'lessons', id: 'L1' }]);
      assert.deepEqual(off.out.overwritten[0].restored_file_deletions, [{ part: 'lessons', id: 'L2' }]);
      assert.match(off.out.warning, /reverted \(L1\).*restored \(L2\)/);
    } finally { await rm(dir); }
  });
});

describe('a lesson id reused after a deletion is another lesson, never merged into the old one', () => {
  const LESSONS = '.claude/kit/lessons.json';
  const writeJson = (dir, f, v) => fs.writeFile(path.join(dir, f), `${JSON.stringify(v, null, 2)}\n`);
  const OLD = 'Read the whole diff before you comment.';
  const NEW = 'Pin every dependency to an exact version.';
  const teammateL2 = (createdAt) => ({ id: 'L2', role: 'r', text: NEW, scope: '', session: 'tm', status: 'active', kept: 0, created_at: createdAt });

  for (const [label, createdAt] of [['the teammate saved first', '2026-01-01T00:00:00.000Z'], ['the teammate saved after the local keep', '2099-01-01T00:00:00.000Z']]) {
    it(`the teammate deletes L2 and saves a new L2; the local database kept L2 (${label}): both lessons survive, listed`, { skip }, async () => {
      const dir = await tmp();
      try {
        assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
        assert.equal((await save(dir, OLD, [], {})).code, 0);
        assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
        assert.equal((await call(reflect, ['lessons', 'keep', '--id', 'L2'], dir, ENV)).code, 0);
        const pulled = await readJson(dir, LESSONS);
        pulled.lessons = [pulled.lessons[0], teammateL2(createdAt)];
        await writeJson(dir, LESSONS, pulled);
        const s = await call(db, ['sync', '--from-files'], dir, ENV);
        assert.equal(s.code, 0, s.err);
        assert.deepEqual(s.out.renumbered, [{ store: 'lessons', scope: LESSONS, from: 'L2', to: 'L3' }]);
        assert.deepEqual(s.out.discarded, []);
        assert.deepEqual(s.out.conflicts.map((c) => [c.id, c.kept, c.reason]), [['L2', 'database', 'changed in the database, deleted in the file: the edit is kept']]);
        const file = await readJson(dir, LESSONS);
        assert.deepEqual(file.lessons.map((l) => [l.id, l.text]), [['L1', 'Run the linter before every commit.'], ['L2', NEW], ['L3', OLD]]);
        assert.equal(file.lessons[2].kept, 1, 'the old lesson keeps its local keep');
        assert.equal(file.lessons[2].session, 's');
        assert.deepEqual(await lessonTexts(dir), ['Run the linter before every commit.', NEW, OLD]);
      } finally { await rm(dir); }
    });
  }

  it('the local database retired the old L2: the new L2 survives and the old one stays retired as L3', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
      assert.equal((await save(dir, OLD, [], {})).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await call(reflect, ['lessons', 'retire', '--id', 'L2', '--reason', 'superseded by review rules'], dir, ENV)).code, 0);
      const pulled = await readJson(dir, LESSONS);
      pulled.lessons = [pulled.lessons[0], teammateL2('2026-01-01T00:00:00.000Z')];
      await writeJson(dir, LESSONS, pulled);
      const s = await call(db, ['sync', '--from-files'], dir, ENV);
      assert.equal(s.code, 0, s.err);
      assert.deepEqual(s.out.renumbered.map((r) => [r.from, r.to]), [['L2', 'L3']]);
      const file = await readJson(dir, LESSONS);
      assert.deepEqual(file.lessons.map((l) => [l.id, l.text, l.status]), [['L1', 'Run the linter before every commit.', 'active'], ['L2', NEW, 'active'], ['L3', OLD, 'retired']]);
    } finally { await rm(dir); }
  });

  it('the local database left the old L2 unchanged: it is deleted (the teammate deleted it), the new L2 is taken, nothing renumbered', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
      assert.equal((await save(dir, OLD, [], {})).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      const pulled = await readJson(dir, LESSONS);
      pulled.lessons = [pulled.lessons[0], teammateL2('2026-01-01T00:00:00.000Z')];
      await writeJson(dir, LESSONS, pulled);
      const s = await call(db, ['sync', '--from-files'], dir, ENV);
      assert.equal(s.code, 0, s.err);
      assert.deepEqual(s.out.renumbered, []);
      assert.deepEqual(s.out.deleted.map((d) => [d.id, d.deleted_in, d.row.text]), [['L2', 'file', OLD]]);
      assert.deepEqual((await readJson(dir, LESSONS)).lessons.map((l) => [l.id, l.text]), [['L1', 'Run the linter before every commit.'], ['L2', NEW]]);
    } finally { await rm(dir); }
  });
});

describe('a store file with one id twice is refused: give one a new id, then sync', () => {
  const LESSONS = '.claude/kit/lessons.json';
  const teammate = (id, text, session) => ({ id, role: 'r', text, scope: '', session, status: 'active', kept: 0, created_at: '2026-10-15T00:00:00.000Z' });

  it('db sync --from-files exits 1 naming the duplicated id, changes nothing; renumbered by hand it merges', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Run the linter before every commit.', [], {})).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await save(dir, 'Check database migrations against a copy of production.')).code, 0);
      const pulled = await readJson(dir, LESSONS);
      pulled.lessons.push(teammate('L2', 'Ask a teammate before you merge on a Friday.', 'ta'), teammate('L2', 'Write the rollback step before the deploy step.', 'tb'));
      const text = `${JSON.stringify(pulled, null, 2)}\n`;
      await fs.writeFile(path.join(dir, LESSONS), text);
      const before = await rawDb(dir);
      let dbBefore;
      try { dbBefore = getDoc(before, 'lessons', LESSONS); } finally { before.close(); }
      const r = await call(db, ['sync', '--from-files'], dir, ENV);
      assert.equal(r.code, 1);
      assert.match(r.err, /lessons\.json holds the same id more than once \(L2\): two rows cannot share an id\. Repair the file in place: give one row of each duplicated id a new id \(the next free one, the highest id in the file plus one\), or remove the duplicate when it is the same row twice; then run `db sync --from-files` again\. Nothing was changed/);
      assert.doesNotMatch(r.err, /or move|db init/);
      assert.equal(await fs.readFile(path.join(dir, LESSONS), 'utf-8'), text, 'the file is untouched');
      const after = await rawDb(dir);
      try { assert.deepEqual(getDoc(after, 'lessons', LESSONS), dbBefore, 'the database is untouched'); } finally { after.close(); }
      // the advice followed: the second L2 becomes L3; sync keeps all four lessons
      pulled.lessons[2].id = 'L3';
      await fs.writeFile(path.join(dir, LESSONS), `${JSON.stringify(pulled, null, 2)}\n`);
      const s = await call(db, ['sync', '--from-files'], dir, ENV);
      assert.equal(s.code, 0, s.err);
      assert.deepEqual(s.out.renumbered.map((x) => [x.from, x.to]), [['L2', 'L4']]);
      assert.deepEqual((await readJson(dir, LESSONS)).lessons.map((l) => l.id), ['L1', 'L2', 'L3', 'L4']);
      assert.equal((await lessonTexts(dir)).length, 4);
    } finally { await rm(dir); }
  });

  it('db init refuses a file with a duplicate id the same way', { skip }, async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, LESSONS), JSON.stringify({ version: 1, lessons: [teammate('L1', 'Run the linter before every commit.', 'a'), teammate('L1', 'Read the whole diff before you comment.', 'b')] }));
      const r = await call(db, ['init'], dir, ENV);
      assert.equal(r.code, 1);
      assert.match(r.err, /holds the same id more than once \(L1\).*then run `db init` again\. Nothing was changed/);
    } finally { await rm(dir); }
  });

  it("reflect's own duplicate-id error says to repair the file in place, not to move it", async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, LESSONS), JSON.stringify({ version: 1, lessons: [teammate('L1', 'Run the linter before every commit.', 'a'), teammate('L1', 'Read the whole diff before you comment.', 'b')] }));
      const r = await call(reflect, ['lessons', 'list'], dir, {});
      assert.equal(r.code, 1);
      assert.match(r.err, /has duplicate id L1: repair the file in place: give one of the two lessons a new id \(the next free one, the highest id plus one\), or remove the duplicate/);
      assert.doesNotMatch(r.err, /or move/);
    } finally { await rm(dir); }
  });
});

describe('the store choice is machine-local', () => {
  it('a clone with only the committed files (an old config.json saying sqlite, the JSON stores) stays on json and every verb works', { skip }, async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude/kit/config.json'), '{"store":"sqlite"}\n');
      await fs.writeFile(path.join(dir, '.claude/kit/lessons.json'), JSON.stringify({ version: 1, lessons: [] }));
      await fs.writeFile(path.join(dir, '.claude/kit/noise-ledger.json'), JSON.stringify({ version: 1, entries: [] }));
      for (const env of [ENV, { KIT_SQLITE_ENGINE: 'none' }]) {
        const st = await call(db, ['status'], dir, env);
        assert.equal(st.code, 0, st.err);
        assert.equal(st.out.store, 'json');
        const c = await storeCheck({ cwd: dir, env: { ...process.env, ...env } });
        assert.equal(c.fatal, false);
        assert.equal(c.store, 'json');
      }
      assert.equal((await save(dir, 'Save this lesson in the clone.', [], {})).code, 0);
      assert.equal((await lessonTexts(dir, [], {})).length, 1);
      assert.equal((await call(noise, ['accept', '--id', 'n1', '--reason', 'r'], dir)).code, 0);
      assert.equal((await call(triage, ['visit', '--session', 's1'], dir, {}, VISIT('a.js'))).code, 0);
      assert.equal((await call(triage, ['list'], dir)).code, 0);
      assert.equal((await cli(['reflect', 'lessons', 'list'], dir)).code, 0);
      assert.equal((await call(db, ['off'], dir, ENV)).code, 0);
      assert.equal((await readJson(dir, '.claude/kit/lessons.json')).lessons.length, 1);
      assert.deepEqual(await ledgerIds(dir, '.claude/kit/noise-ledger.json'), ['n1']);
      assert.ok(!exists(path.join(dir, '.claude/kit/suite.db')));
      assert.ok(!exists(path.join(dir, '.claude/kit/store.local.json')));
      // opting in on this machine writes the local file only
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.deepEqual(await readJson(dir, '.claude/kit/store.local.json'), { store: 'sqlite' });
      assert.equal(await fs.readFile(path.join(dir, '.claude/kit/config.json'), 'utf-8'), '{"store":"sqlite"}\n', 'the committed file is not touched');
    } finally { await rm(dir); }
  });

  it('an old config.json store key on the machine that has suite.db is taken once into store.local.json', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Save this lesson before the store moved.', [], {})).code, 0);
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      await fs.rm(path.join(dir, '.claude/kit/store.local.json'));
      await fs.writeFile(path.join(dir, '.claude/kit/config.json'), '{"store":"sqlite"}');
      const st = await call(db, ['status'], dir, ENV);
      assert.equal(st.out.store, 'sqlite');
      assert.deepEqual(await readJson(dir, '.claude/kit/store.local.json'), { store: 'sqlite' });
      // from now on the local file decides
      await fs.writeFile(path.join(dir, '.claude/kit/config.json'), '{"store":"json"}');
      assert.equal((await call(db, ['status'], dir, ENV)).out.store, 'sqlite');
    } finally { await rm(dir); }
  });

  it('db off with the database missing just sets json', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      await fs.rm(path.join(dir, '.claude/kit/suite.db'));
      assert.equal((await call(reflect, ['lessons', 'list'], dir, ENV)).code, 1);
      const off = await call(db, ['off'], dir, ENV);
      assert.equal(off.code, 0, off.err);
      assert.equal(off.out.store, 'json');
      assert.deepEqual(await readJson(dir, '.claude/kit/store.local.json'), { store: 'json' });
      assert.equal((await call(reflect, ['lessons', 'list'], dir, ENV)).code, 0);
    } finally { await rm(dir); }
  });

  it('store.local.json is git-ignored in the repository and by the kit installer', async () => {
    const lines = (await fs.readFile(path.join(HERE, '..', '.gitignore'), 'utf-8')).split('\n').map((l) => l.trim());
    assert.ok(lines.includes(CONFIG_GITIGNORE_RULE));
    assert.equal(CONFIG_GITIGNORE_RULE, '.claude/kit/store.local.json');
    const dir = await tmp();
    try {
      await kitPlugin.install(path.join(dir, '.claude'), { targetDir: dir });
      await kitPlugin.install(path.join(dir, '.claude'), { targetDir: dir });
      const gi = (await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')).split('\n');
      assert.equal(gi.filter((l) => l === CONFIG_GITIGNORE_RULE).length, 1);
    } finally { await rm(dir); }
  });
});

describe('concurrency: writers in flight while the store switches', () => {
  it('a write committed while db off waits is exported (child-process off behind an open writer)', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await call(noise, ['accept', '--id', 'A', '--reason', 'r'], dir, ENV)).code, 0);
      let offP;
      // the writer's transaction is open; db off starts in another process and must wait for it
      const r = await call((args, io) => import('../src/lib/kit/store.js').then(({ updateDoc }) => updateDoc(io, 'noise-ledger', path.join(dir, '.claude/kit/noise-ledger.json'), async ({ load, save: put }) => {
        const doc = await load({ fallback: { version: 1, entries: [] } });
        offP = cli(['db', 'off'], dir, ENV);
        await sleep(700);
        doc.entries.push({ id: 'B', reason: 'written while off waited' });
        await put(doc);
        return 'ok';
      })), [], dir, ENV);
      assert.equal(r.code, 0, r.err);
      const off = await offP;
      assert.equal(off.code, 0, off.err);
      assert.deepEqual(await ledgerIds(dir, '.claude/kit/noise-ledger.json'), ['A', 'B']);
    } finally { await rm(dir); }
  });

  it('a child writer that waited behind db off\'s transaction writes the JSON file, not the abandoned database', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await save(dir, 'Save this lesson before the switch.')).code, 0);
      // stand in for db off: hold BEGIN IMMEDIATE, start a writer, then export and switch before committing
      const raw = await rawDb(dir);
      try {
        raw.exec('BEGIN IMMEDIATE');
        const writer = cli(['reflect', 'lessons', 'save', '--role', 'r', '--session', 'w', '--text', 'Write this lesson while the store switches.'], dir, ENV);
        await sleep(700);
        const doc = getDoc(raw, 'lessons', '.claude/kit/lessons.json');
        await fs.writeFile(path.join(dir, '.claude/kit/lessons.json'), JSON.stringify(doc, null, 2));
        await writeConfig(dir, 'json');
        raw.exec('COMMIT');
        const w = await writer;
        assert.equal(w.code, 0, w.err);
      } finally { raw.close(); }
      assert.deepEqual((await readJson(dir, '.claude/kit/lessons.json')).lessons.map((l) => l.text), ['Save this lesson before the switch.', 'Write this lesson while the store switches.']);
      const check = await rawDb(dir);
      try { assert.equal(getDoc(check, 'lessons', '.claude/kit/lessons.json').lessons.length, 1, 'nothing went to the database'); } finally { check.close(); }
    } finally { await rm(dir); }
  });

  it('a child JSON writer that waited behind db init\'s state lock writes the database', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Save this lesson on the JSON store.', [], {})).code, 0);
      // a database exists but the store is json (as after db off)
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await call(db, ['off'], dir, ENV)).code, 0);
      const file = path.join(dir, '.claude/kit/lessons.json');
      // stand in for db init: hold the state lock, start a writer, then switch to sqlite before releasing it
      let writer;
      await withStateLock(file, async () => {
        writer = cli(['reflect', 'lessons', 'save', '--role', 'r', '--session', 'w', '--text', 'Write this lesson while init holds the lock.'], dir, ENV);
        await sleep(700);
        await writeConfig(dir, 'sqlite');
      });
      const w = await writer;
      assert.equal(w.code, 0, w.err);
      assert.equal((await readJson(dir, '.claude/kit/lessons.json')).lessons.length, 1, 'the JSON file was not written');
      assert.deepEqual(await lessonTexts(dir), ['Save this lesson on the JSON store.', 'Write this lesson while init holds the lock.']);
    } finally { await rm(dir); }
  });

  it('real db init and a JSON writer racing in two processes: the write is never lost', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await save(dir, 'Save this lesson on the JSON store.', [], {})).code, 0);
      const [w, i] = await Promise.all([
        cli(['reflect', 'lessons', 'save', '--role', 'r', '--session', 'w', '--text', 'Race this lesson against db init.'], dir, ENV),
        cli(['db', 'init'], dir, ENV)
      ]);
      assert.equal(w.code, 0, w.err);
      assert.equal(i.code, 0, i.err);
      assert.deepEqual(await lessonTexts(dir), ['Save this lesson on the JSON store.', 'Race this lesson against db init.']);
    } finally { await rm(dir); }
  });
});

describe('db status on the JSON store reads a leftover database without changing it', () => {
  it('a newer schema is an error field, an older one is reported and not migrated (exit 0)', { skip }, async () => {
    const dir = await tmp();
    try {
      assert.equal((await call(db, ['init'], dir, ENV)).code, 0);
      assert.equal((await call(db, ['off'], dir, ENV)).code, 0);
      let raw = await rawDb(dir);
      raw.run("UPDATE meta SET value = ? WHERE key = 'schema_version'", String(SCHEMA_VERSION + 1));
      raw.close();
      const st = await call(db, ['status'], dir, ENV);
      assert.equal(st.code, 0, st.err);
      assert.equal(st.out.store, 'json');
      assert.equal(st.out.schema_version, SCHEMA_VERSION + 1);
      assert.match(st.out.error, /newer than this kit/);
      // older: reported as it is, and still that version afterwards
      const e = await loadEngine({ cwd: dir, env: { ...process.env, ...ENV } });
      raw = e.open(path.join(dir, '.claude/kit/suite.db'));
      raw.run("UPDATE meta SET value = '2' WHERE key = 'schema_version'");
      raw.close();
      const old = await call(db, ['status'], dir, ENV);
      assert.equal(old.code, 0, old.err);
      assert.equal(old.out.schema_version, 2);
      assert.equal(old.out.error, undefined);
      assert.equal(old.out.rows.lessons, 0);
      raw = e.open(path.join(dir, '.claude/kit/suite.db'), { readOnly: true });
      try { assert.equal(raw.get("SELECT value FROM meta WHERE key = 'schema_version'").value, '2'); } finally { raw.close(); }
      // not a database at all: still exit 0, with an error field
      await fs.writeFile(path.join(dir, '.claude/kit/suite.db'), 'not a database');
      await fs.rm(path.join(dir, '.claude/kit/suite.db-wal'), { force: true });
      await fs.rm(path.join(dir, '.claude/kit/suite.db-shm'), { force: true });
      const junk = await call(db, ['status'], dir, ENV);
      assert.equal(junk.code, 0, junk.err);
      assert.match(junk.out.error, /cannot read/);
    } finally { await rm(dir); }
  });
});
