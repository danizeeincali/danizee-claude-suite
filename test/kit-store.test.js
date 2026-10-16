// The optional SQLite store (src/lib/kit/store.js, the `db` verb): the same verb calls give the same output and exit
// codes on the JSON files and on SQLite (node:sqlite here; better-sqlite3 when it is installed).
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
import { run as db } from '../src/lib/kit/db.js';
import { storeCheck, loadEngine, GITIGNORE_RULES, SCHEMA_VERSION, resolveStore, withDb } from '../src/lib/kit/store.js';
import kitPlugin from '../src/plugins/kit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '../src/lib/kit/cli.js');
const NODE_SQLITE = (() => { try { createRequire(import.meta.url)('node:sqlite'); return true; } catch { return false; } })();
const BETTER = (() => { try { const D = createRequire(import.meta.url)('better-sqlite3'); new D(':memory:').close(); return true; } catch { return false; } })();
export const ENGINES_UNDER_TEST = [
  { name: 'node:sqlite', skip: NODE_SQLITE ? false : 'node:sqlite needs Node 22.5+' },
  { name: 'better-sqlite3', skip: BETTER ? false : 'better-sqlite3 is not installed' }
];

async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'kit-store-')); }
const exists = (p) => fsSync.existsSync(p);

/** Call a verb's run() in-process: { code, out } or { code, err }. */
export async function call(verb, args, cwd, env = {}, stdin = '') {
  try { return { code: 0, out: await verb(args, { cwd, env, stdin: async () => stdin, stdinIsTTY: false }) }; } catch (e) { return { code: e.code ?? 99, err: e.message }; }
}

/** Run the cli in a child process. */
export function cli(args, cwd, env = {}, input = '') {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => { let json = null; try { json = JSON.parse(out); } catch { /* raw */ } resolve({ code, out, err, json }); });
    p.stdin.end(input);
  });
}

/** Make a project use sqlite with the given engine. */
export async function goSqlite(dir, engine) {
  const r = await call(db, ['init'], dir, { KIT_SQLITE_ENGINE: engine });
  assert.equal(r.code, 0, r.err);
  return { KIT_SQLITE_ENGINE: engine };
}

// timestamps differ between two runs of the same steps
const TIME_KEYS = new Set(['created_at', 'last_kept', 'retired_at', 'added']);
export const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (TIME_KEYS.has(k) ? '<t>' : x)));

const LESSON_STEPS = [
  ['lessons', 'save', '--role', 'fixer', '--session', 's1', '--text', 'Run the full test suite before pushing a branch.'],
  ['lessons', 'save', '--role', 'fixer', '--session', 's1', '--text', 'Run the full test suite before you push a branch.'],
  ['lessons', 'save', '--role', 'fixer', '--session', 's1', '--text', 'Run the full test suite before you push a branch.', '--confirm', 'L1'],
  ['lessons', 'save', '--role', 'fixer', '--session', 's1', '--text', 'Run the full test suite before you push a branch.', '--distinct'],
  ['lessons', 'save', '--role', 'reviewer', '--session', 's1', '--text', 'Read the diff twice before writing any comment.'],
  ['lessons', 'save', '--role', 'reviewer', '--session', 's1', '--text', 'Check the lockfile whenever an install fails oddly.'],
  ['lessons', 'save', '--role', 'reviewer', '--session', 's2', '--text', 'The diff is long.'],
  ['lessons', 'save', '--role', 'reviewer', '--session', 's2', '--text', 'Use token ghp_abcdefghijklmnopqrstuvwxyz0123 for pushes.'],
  ['lessons', 'keep', '--id', 'L2'],
  ['lessons', 'keep', '--id', 'L99'],
  ['lessons', 'retire', '--id', 'L3', '--reason', 'superseded by a later lesson'],
  ['lessons', 'retire', '--id', 'L3', '--reason', 'again'],
  ['lessons', 'list'],
  ['lessons', 'list', '--all'],
  ['lessons', 'list', '--role', 'reviewer'],
  ['lessons', 'save', '--role', 'other', '--session', 's9', '--text', 'Keep the per-stream store apart from the main one.', '--store', 'streams/a.json'],
  ['lessons', 'list', '--store', 'streams/a.json'],
  ['lessons', 'list', '--store', 'streams/missing.json'],
  ['lessons', 'save', '--role', 'fixer', '--session', 's1', '--text', 'Pin the engine version in every lockfile you touch.', '--confirm', 'L1', '--distinct'],
];

async function runSteps(verb, steps, dir, env, stdinOf = () => '') {
  const out = [];
  for (const s of steps) {
    const r = await call(verb, s, dir, env, stdinOf(s));
    out.push({ args: s.join(' '), code: r.code, out: r.out === undefined ? undefined : strip(r.out), err: r.err });
  }
  return out;
}

describe('kit store: lessons give the same results on the JSON files and on SQLite', () => {
  for (const eng of ENGINES_UNDER_TEST) {
    it(`same outputs and exit codes (${eng.name})`, { skip: eng.skip }, async () => {
      const a = await tmp(); const b = await tmp();
      try {
        const json = await runSteps(reflect, LESSON_STEPS, a, {});
        const env = await goSqlite(b, eng.name);
        const sql = await runSteps(reflect, LESSON_STEPS, b, env);
        assert.deepEqual(sql, json);
        assert.ok(json.some((x) => x.code === 2) && json.some((x) => x.code === 1), 'the steps cover refusals and invalid input');
        // sqlite never writes the JSON files (no split brain)
        assert.ok(!exists(path.join(b, '.claude/kit/lessons.json')));
        assert.ok(!exists(path.join(b, 'streams/a.json')));
        assert.ok(exists(path.join(b, '.claude/kit/suite.db')));
        // and export writes exactly what the JSON run wrote
        const ex = await call(db, ['export'], b, env);
        assert.equal(ex.code, 0, ex.err);
        for (const f of ['.claude/kit/lessons.json', 'streams/a.json']) {
          assert.deepEqual(strip(JSON.parse(await fs.readFile(path.join(b, f), 'utf-8'))), strip(JSON.parse(await fs.readFile(path.join(a, f), 'utf-8'))), f);
        }
      } finally { await fs.rm(a, { recursive: true, force: true }); await fs.rm(b, { recursive: true, force: true }); }
    });
  }

  it('the cli gives the same stdout and exit code (node:sqlite, one process per call)', { skip: !NODE_SQLITE }, async () => {
    const a = await tmp(); const b = await tmp();
    try {
      const env = await goSqlite(b, 'node:sqlite');
      for (const s of LESSON_STEPS.slice(0, 8)) {
        const x = await cli(['reflect', ...s], a, {});
        const y = await cli(['reflect', ...s], b, env);
        assert.equal(y.code, x.code, s.join(' '));
        assert.deepEqual(strip(y.json), strip(x.json), s.join(' '));
        assert.equal(y.err, x.err, 'same stderr (no engine warning)');
      }
    } finally { await fs.rm(a, { recursive: true, force: true }); await fs.rm(b, { recursive: true, force: true }); }
  });

  it('parallel saves are all kept (in one process and across processes)', { skip: !NODE_SQLITE }, async () => {
    const dir = await tmp();
    try {
      const env = await goSqlite(dir, 'node:sqlite');
      const texts = ['Alpha lessons stay short and plain always.', 'Bravo checks run before every single merge.', 'Charlie logs get trimmed after each nightly run.', 'Delta builds pin each compiler release exactly.'];
      const inproc = await Promise.all(texts.map((t, i) => call(reflect, ['lessons', 'save', '--role', `r${i}`, '--session', `p${i}`, '--text', t], dir, env)));
      assert.deepEqual(inproc.map((r) => r.code), [0, 0, 0, 0]);
      const procs = await Promise.all(['Echo', 'Foxtrot', 'Golf', 'Hotel'].map((w, i) => cli(['reflect', 'lessons', 'save', '--role', `q${i}`, '--session', `x${i}`, '--text', `Remember ${w} whenever the queue backs up again.`], dir, env)));
      assert.deepEqual(procs.map((r) => r.code), [0, 0, 0, 0], procs.map((p) => p.err).join(''));
      const list = await call(reflect, ['lessons', 'list'], dir, env);
      assert.equal(list.out.lessons.length, 8);
      assert.equal(new Set(list.out.lessons.map((l) => l.id)).size, 8, 'ids stay unique');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('kit store: db verb', () => {
  it('init imports the JSON store once; a lessons file named later is read until first written; off exports and switches back', { skip: !NODE_SQLITE }, async () => {
    const dir = await tmp();
    try {
      const env = { KIT_SQLITE_ENGINE: 'node:sqlite' };
      assert.equal((await call(reflect, ['lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Write the failing test before the fix.'], dir, env)).code, 0);
      assert.equal((await call(reflect, ['lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Keep side stores apart from the main one.', '--store', 'side.json'], dir, env)).code, 0);
      const st0 = await call(db, ['status'], dir, env);
      assert.equal(st0.out.store, 'json');
      assert.equal(st0.out.engine, 'node:sqlite');
      assert.equal(st0.out.db_exists, false);
      const init = await call(db, ['init'], dir, env);
      assert.equal(init.code, 0, init.err);
      assert.deepEqual(init.out.imported, [{ store: 'lessons', scope: '.claude/kit/lessons.json' }]);
      assert.equal(init.out.rows.lessons, 1);
      assert.equal(init.out.schema_version, SCHEMA_VERSION);
      // the store choice is machine-local (git-ignored): .claude/kit/store.local.json, not the committed config.json
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, '.claude/kit/store.local.json'), 'utf-8')), { store: 'sqlite' });
      assert.ok(!exists(path.join(dir, '.claude/kit/config.json')));
      // side.json was not imported, but it is read from its file
      assert.equal((await call(reflect, ['lessons', 'list', '--store', 'side.json'], dir, env)).out.lessons.length, 1);
      assert.equal((await call(reflect, ['lessons', 'keep', '--id', 'L1', '--store', 'side.json'], dir, env)).code, 0);
      await fs.rm(path.join(dir, 'side.json'));
      const side = await call(reflect, ['lessons', 'list', '--store', 'side.json'], dir, env);
      assert.equal(side.out.lessons[0].kept, 1, 'after its first write the side store lives in the database');
      // re-running init on sqlite keeps the database
      const again = await call(db, ['init'], dir, env);
      assert.deepEqual(again.out.imported, []);
      const st = await call(db, ['status'], dir, env);
      assert.equal(st.out.store, 'sqlite');
      assert.equal(st.out.rows.lessons, 2);
      assert.deepEqual(st.out.documents.map((d) => d.scope), ['.claude/kit/lessons.json', 'side.json']);
      for (const t of ['test_runs', 'test_cases', 'noise_ledger', 'triage', 'triage_scopes']) assert.equal(st.out.rows[t], 0, t);
      // off: export then json
      assert.equal((await call(reflect, ['lessons', 'save', '--role', 'r', '--session', 't', '--text', 'Name the fix in every error message.'], dir, env)).code, 0);
      const off = await call(db, ['off'], dir, env);
      assert.equal(off.code, 0, off.err);
      assert.equal(off.out.store, 'json');
      assert.equal(JSON.parse(await fs.readFile(path.join(dir, '.claude/kit/lessons.json'), 'utf-8')).lessons.length, 2);
      assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'side.json'), 'utf-8')).lessons[0].kept, 1);
      // back on json: edits go to the file; a later init takes the file over the stale database
      assert.equal((await call(reflect, ['lessons', 'save', '--role', 'r', '--session', 'u', '--text', 'Prefer small commits over one large commit.'], dir, env)).code, 0);
      const re = await call(db, ['init'], dir, env);
      assert.equal(re.code, 0, re.err);
      assert.equal((await call(reflect, ['lessons', 'list'], dir, env)).out.lessons.length, 3);
      assert.deepEqual((await call(db, ['off'], dir, env)).code, 0);
      assert.deepEqual((await call(db, ['off'], dir, env)).out.note, 'already on the JSON files');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('a broken JSON store stops init with nothing changed', { skip: !NODE_SQLITE }, async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude/kit/lessons.json'), '{ not json');
      const r = await call(db, ['init'], dir, { KIT_SQLITE_ENGINE: 'node:sqlite' });
      assert.equal(r.code, 1);
      assert.match(r.err, /lessons\.json is not valid JSON/);
      assert.ok(!exists(path.join(dir, '.claude/kit/config.json')));
      assert.ok(!exists(path.join(dir, '.claude/kit/store.local.json')));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('sqlite configured and no engine: every store call exits 1 naming the fix, and never falls back to JSON', async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude/kit/store.local.json'), '{"store":"sqlite"}');
      const env = { KIT_SQLITE_ENGINE: 'none' };
      const save = await call(reflect, ['lessons', 'save', '--role', 'r', '--session', 's', '--text', 'Write the failing test before the fix.'], dir, env);
      assert.equal(save.code, 1);
      assert.match(save.err, /npm install better-sqlite3/);
      assert.match(save.err, /Node 22\.5\+/);
      assert.ok(!exists(path.join(dir, '.claude/kit/lessons.json')), 'no JSON fallback');
      assert.equal((await call(reflect, ['lessons', 'list'], dir, env)).code, 1);
      for (const sub of ['init', 'export', 'off', 'status', 'prune']) {
        const r = await call(db, [sub], dir, env);
        assert.equal(r.code, 1, sub);
        assert.match(r.err, /npm install better-sqlite3/, sub);
      }
      const c = await storeCheck({ cwd: dir, env });
      assert.equal(c.fatal, true);
      assert.match(c.line, /^kit store: sqlite, but no engine loads/);
      assert.match(c.fix, /npm install better-sqlite3/);
      // the trouble-log side of reflect has no store and still works
      assert.equal((await call(reflect, ['trouble-log'], dir, env, '{"type":"stop","reason":"x"}')).code, 0);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('sqlite configured but suite.db missing: exit 1 that says so', { skip: !NODE_SQLITE }, async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude/kit/store.local.json'), '{"store":"sqlite"}');
      const r = await call(reflect, ['lessons', 'list'], dir, { KIT_SQLITE_ENGINE: 'node:sqlite' });
      assert.equal(r.code, 1);
      assert.match(r.err, /suite\.db is missing/);
      assert.equal((await storeCheck({ cwd: dir, env: { KIT_SQLITE_ENGINE: 'node:sqlite' } })).fatal, true);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('a broken config is exit 1; status on json reports the store and engine', async () => {
    const dir = await tmp();
    try {
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude/kit/config.json'), '{"store":"mongo"}');
      const r = await call(reflect, ['lessons', 'list'], dir);
      assert.equal(r.code, 1);
      assert.match(r.err, /"store" must be "json" or "sqlite"/);
      await fs.writeFile(path.join(dir, '.claude/kit/config.json'), '{"store":"json"}');
      const c = await storeCheck({ cwd: dir });
      assert.equal(c.store, 'json');
      assert.equal(c.fatal, false);
      assert.match(c.line, /^kit store: json files/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('usage errors: unknown subcommand, unknown flag, bad --keep', async () => {
    const dir = await tmp();
    try {
      assert.equal((await call(db, [], dir)).code, 1);
      assert.equal((await call(db, ['frob'], dir)).code, 1);
      assert.equal((await call(db, ['status', '--keep', '3'], dir)).code, 1);
      assert.equal((await call(db, ['prune', '--keep', '0'], dir)).code, 1);
      assert.equal((await call(db, ['export'], dir)).code, 1, 'nothing to export on json');
      assert.ok((await call(db, ['--help'], dir)).out.usage.includes('db init'));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('the first migration creates every table; prune keeps the newest n runs per branch with their cases', { skip: !NODE_SQLITE }, async () => {
    const dir = await tmp();
    try {
      const env = await goSqlite(dir, 'node:sqlite');
      const ctx = await resolveStore({ cwd: dir, env: { ...process.env, ...env } });
      await withDb(ctx, (d) => {
        const tables = d.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
        for (const t of ['meta', 'store_docs', 'lessons', 'noise_ledger', 'triage', 'triage_scopes', 'test_runs', 'test_cases']) assert.ok(tables.includes(t), t);
        assert.equal(d.get('PRAGMA journal_mode').journal_mode, 'wal');
        for (const br of ['main', 'dev']) {
          for (let i = 0; i < 5; i++) {
            const id = Number(d.run('INSERT INTO test_runs (branch, started_at, total) VALUES (?, ?, 2)', br, `2026-10-0${i + 1}T00:00:00Z`).lastInsertRowid);
            d.run("INSERT INTO test_cases (run_id, name, status) VALUES (?, 'a', 'pass')", id);
            d.run("INSERT INTO test_cases (run_id, name, status) VALUES (?, 'b', 'fail')", id);
          }
        }
      });
      const p = await call(db, ['prune', '--keep', '2'], dir, env);
      assert.equal(p.code, 0, p.err);
      assert.deepEqual(p.out, { keep: 2, pruned_runs: 6, pruned_cases: 12, remaining_runs: 4 });
      await withDb(ctx, (d) => {
        assert.deepEqual(d.all("SELECT started_at FROM test_runs WHERE branch = 'main' ORDER BY started_at").map((r) => r.started_at), ['2026-10-04T00:00:00Z', '2026-10-05T00:00:00Z']);
        assert.equal(Number(d.get('SELECT COUNT(*) AS n FROM test_cases').n), 8);
      }, { write: false });
      assert.equal((await call(db, ['prune'], dir, env)).out.pruned_runs, 0, 'default keeps 200');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('a database with a newer schema is refused (exit 1)', { skip: !NODE_SQLITE }, async () => {
    const dir = await tmp();
    try {
      const env = await goSqlite(dir, 'node:sqlite');
      const ctx = await resolveStore({ cwd: dir, env: { ...process.env, ...env } });
      await withDb(ctx, (d) => { d.run("UPDATE meta SET value = '99' WHERE key = 'schema_version'"); });
      const r = await call(reflect, ['lessons', 'list'], dir, env);
      assert.equal(r.code, 1);
      assert.match(r.err, /schema version 99, newer than this kit/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('the engine loads lazily: better-sqlite3 when installed, else node:sqlite', async () => {
    const e = await loadEngine({ cwd: os.tmpdir(), env: {} });
    assert.equal(e.name, BETTER ? 'better-sqlite3' : NODE_SQLITE ? 'node:sqlite' : null);
  });
});

describe('kit store: git-ignore rules', () => {
  it('the repository ignores suite.db and its -wal/-shm', async () => {
    const lines = (await fs.readFile(path.join(HERE, '..', '.gitignore'), 'utf-8')).split('\n').map((l) => l.trim());
    for (const r of GITIGNORE_RULES) assert.ok(lines.includes(r), r);
    assert.deepEqual([...GITIGNORE_RULES], ['.claude/kit/suite.db', '.claude/kit/suite.db-wal', '.claude/kit/suite.db-shm']);
  });

  it('the kit installer adds them to the target project, once', async () => {
    const dir = await tmp();
    try {
      await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n.claude/kit/suite.db\n');
      await kitPlugin.install(path.join(dir, '.claude'), { targetDir: dir });
      await kitPlugin.install(path.join(dir, '.claude'), { targetDir: dir });
      const lines = (await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')).split('\n');
      for (const r of [...GITIGNORE_RULES, '.claude/kit/scrub-patterns.local']) assert.equal(lines.filter((l) => l === r).length, 1, r);
      assert.ok(exists(path.join(dir, '.claude/helpers/kit/store.js')));
      assert.ok(exists(path.join(dir, '.claude/helpers/kit/db.js')));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('kit store: npx danizee-claude-suite db and check', () => {
  const BIN = path.join(HERE, '..', 'bin', 'cli.js');
  const HAVE_DEPS = (() => { try { const r = createRequire(BIN); r.resolve('commander'); r.resolve('chalk'); r.resolve('ora'); return true; } catch { return false; } })();
  const bin = (args, cwd, env) => new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...env } });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });

  it('db <sub> is the kit verb', { skip: HAVE_DEPS ? false : 'the package dependencies (commander, chalk, ora) are not installed here' }, async () => {
    const dir = await tmp();
    try {
      const r = await bin(['db', 'status'], dir, { KIT_SQLITE_ENGINE: 'none' });
      assert.equal(r.code, 0, r.err);
      assert.equal(JSON.parse(r.out).store, 'json');
      assert.equal((await bin(['db', 'frob'], dir, {})).code, 1);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('check prints the store line and exits 4 when the sqlite engine cannot load', { skip: HAVE_DEPS ? false : 'the package dependencies (commander, chalk, ora) are not installed here' }, async () => {
    const dir = await tmp();
    try {
      const ok = await bin(['check', '--path', dir], dir, { KIT_SQLITE_ENGINE: 'none' });
      assert.match(ok.out, /kit store: json files/);
      await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude/kit/store.local.json'), '{"store":"sqlite"}');
      const bad = await bin(['check', '--path', dir], dir, { KIT_SQLITE_ENGINE: 'none' });
      assert.match(bad.out, /kit store: sqlite, but no engine loads/);
      assert.match(bad.out, /npm install better-sqlite3/);
      assert.equal(bad.code, 4);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('bin/cli.js routes db to the kit verb and prints the store line in check (source)', async () => {
    const src = await fs.readFile(BIN, 'utf-8');
    assert.match(src, /process\.argv\[2\] === 'db'/);
    assert.match(src, /storeCheck\(/);
  });
});

// ================================================================ step 2: noise-ledger and triage on the adapter
import { run as noise } from '../src/lib/kit/noise-ledger.js';
import { run as triage } from '../src/lib/kit/triage.js';

const FINDINGS = JSON.stringify([
  { id: 'a1', severity: 'high', locations: ['x.js', 'y.js'] },
  { id: 'b2', severity: 'low', failures: 2, reproductions: 0 },
  { id: 'c3', severity: 'medium', rule: 'r1', files: ['z.js'] },
  { id: 'd4', severity: 'medium' }
]);
const NOISE_STEPS = [
  ['apply', '--now', '2026-10-16'],
  ['accept', '--id', 'a1', '--reason', 'known, tracked elsewhere', '--now', '2026-10-16', '--expires', '2026-10-20'],
  ['accept', '--id', 'd4', '--reason', 'accepted forever', '--now', '2026-10-16'],
  ['accept', '--id', 'zz', '--reason', 'old', '--now', '2026-10-16', '--expires', '2026-10-01'],
  ['accept', '--id', 'c3', '--reason', 'short', '--now', '2026-10-16', '--expires', '2026-10-17'],
  ['apply', '--now', '2026-10-16', '--cap', '1'],
  ['apply', '--now', '2026-10-18', '--first-run'],
  ['prune', '--now', '2026-10-16'],
  ['prune', '--now', '2026-10-25'],
  ['apply', '--now', '2026-10-25'],
  ['accept', '--id', 'a1', '--reason', 'replaced reason', '--now', '2026-10-25'],
  ['apply', '--ledger', 'streams/missing.json', '--now', '2026-10-16'],
  ['accept', '--id', 's1', '--reason', 'stream ledger', '--ledger', 'streams/ledger.json', '--now', '2026-10-16'],
  ['apply', '--ledger', 'streams/ledger.json', '--now', '2026-10-16'],
  ['prune', '--ledger', 'streams/ledger.json', '--now', '2026-10-16'],
  ['accept', '--id', 'x', '--now', '2026-10-16'],
  ['frob'],
];

const visitOf = (n) => JSON.stringify({
  scopes: ['src/a.js', 'src/b.js'],
  enabled: ['no-eval', 'max-len'],
  violations: n === 1 ? [
    { scope: 'src/a.js', rule: 'no-eval', source: 'auto', location: 'src/a.js:12' },
    { scope: 'src/a.js', rule: 'no-eval', source: 'auto', location: 'src/a.js:80' },
    { scope: 'src/b.js', rule: 'max-len', source: 'agent', element: 'line 4000' },
    { scope: 'constructor', rule: 'max-len', source: 'auto', element: 'x' }
  ] : n === 2 ? [
    { scope: 'src/a.js', rule: 'no-eval', source: 'auto', location: 'src/a.js:13' }
  ] : []
});
const TRIAGE_STEPS = [
  ['visit', '--session', 's1'],
  ['visit', '--session', 's1'],
  ['list'],
  ['visit', '--session', 's2'],
  ['visit', '--session', 's3'],
  ['visit', '--session', 's4'],
  ['visit', '--session', 's5'],
  ['list', '--status', 'fixed'],
  ['visit', '--session', 's6', '--state', '.claude/marathon/run-1/triage-api.json'],
  ['visit', '--session', 's7', '--state', '.claude/marathon/run-1/triage-web.json'],
  ['list', '--state', '.claude/marathon/run-1/triage-api.json'],
  ['list', '--state', '.claude/marathon/run-1/triage-none.json'],
  ['list', '--status', 'bogus'],
  ['decide', '0000000000000000', '--as', 'filed'],
];
const triageStdin = (s) => (s[0] !== 'visit' ? '' : visitOf({ s1: 1, s2: 2, s6: 1, s7: 2 }[s[2]] ?? 3));

/** Replace the project folder in outputs so two folders compare equal. */
const unDir = (v, dir) => JSON.parse(JSON.stringify(v).split(JSON.stringify(dir).slice(1, -1)).join('<dir>'));

describe('kit store: noise-ledger and triage give the same results on the JSON files and on SQLite', () => {
  for (const eng of ENGINES_UNDER_TEST) {
    it(`noise-ledger: same outputs, exit codes and exported ledgers (${eng.name})`, { skip: eng.skip }, async () => {
      const a = await tmp(); const b = await tmp();
      try {
        const json = unDir(await runSteps(noise, NOISE_STEPS, a, {}, () => FINDINGS), a);
        const env = await goSqlite(b, eng.name);
        const sql = unDir(await runSteps(noise, NOISE_STEPS, b, env, () => FINDINGS), b);
        assert.deepEqual(sql, json);
        assert.ok(json.some((x) => x.code === 1) && json.some((x) => x.out && x.out.pruned && x.out.pruned.length));
        assert.ok(!exists(path.join(b, '.claude/kit/noise-ledger.json')) && !exists(path.join(b, 'streams/ledger.json')), 'sqlite writes no JSON file');
        assert.equal((await call(db, ['export'], b, env)).code, 0);
        for (const f of ['.claude/kit/noise-ledger.json', 'streams/ledger.json']) {
          assert.equal(await fs.readFile(path.join(b, f), 'utf-8'), await fs.readFile(path.join(a, f), 'utf-8'), f);
        }
      } finally { await fs.rm(a, { recursive: true, force: true }); await fs.rm(b, { recursive: true, force: true }); }
    });

    it(`triage: same outputs, exit codes and exported states; --state paths stay separate streams (${eng.name})`, { skip: eng.skip }, async () => {
      const a = await tmp(); const b = await tmp();
      try {
        const json = unDir(await runSteps(triage, TRIAGE_STEPS, a, {}, triageStdin), a);
        const env = await goSqlite(b, eng.name);
        const sql = unDir(await runSteps(triage, TRIAGE_STEPS, b, env, triageStdin), b);
        assert.deepEqual(sql, json);
        assert.ok(json.some((x) => x.out && x.out.closed && x.out.closed.length), 'the steps close a record by absence');
        const st = await call(db, ['status'], b, env);
        assert.deepEqual(st.out.documents.filter((d) => d.store === 'triage').map((d) => d.scope),
          ['.claude/kit/triage.json', '.claude/marathon/run-1/triage-api.json', '.claude/marathon/run-1/triage-web.json']);
        assert.ok(!exists(path.join(b, '.claude/kit/triage.json')) && !exists(path.join(b, '.claude/marathon')), 'sqlite writes no JSON file');
        assert.equal((await call(db, ['export'], b, env)).code, 0);
        for (const f of ['.claude/kit/triage.json', '.claude/marathon/run-1/triage-api.json', '.claude/marathon/run-1/triage-web.json']) {
          assert.equal(await fs.readFile(path.join(b, f), 'utf-8'), await fs.readFile(path.join(a, f), 'utf-8'), f);
        }
      } finally { await fs.rm(a, { recursive: true, force: true }); await fs.rm(b, { recursive: true, force: true }); }
    });
  }

  it('db init imports the ledger, the default triage state and the per-stream triage files; the verbs then read the database', { skip: !NODE_SQLITE }, async () => {
    const dir = await tmp();
    try {
      for (const s of NOISE_STEPS.slice(1, 3)) assert.equal((await call(noise, s, dir)).code, 0);
      assert.equal((await call(triage, ['visit', '--session', 's1'], dir, {}, visitOf(1))).code, 0);
      assert.equal((await call(triage, ['visit', '--session', 's1', '--state', '.claude/marathon/r1/triage-api.json'], dir, {}, visitOf(2))).code, 0);
      const before = {
        apply: (await call(noise, ['apply', '--now', '2026-10-16'], dir, {}, FINDINGS)).out,
        list: (await call(triage, ['list'], dir)).out,
        api: (await call(triage, ['list', '--state', '.claude/marathon/r1/triage-api.json'], dir)).out
      };
      const env = { KIT_SQLITE_ENGINE: 'node:sqlite' };
      const init = await call(db, ['init'], dir, env);
      assert.equal(init.code, 0, init.err);
      assert.deepEqual(init.out.imported, [
        { store: 'lessons', scope: '.claude/kit/lessons.json' },
        { store: 'noise-ledger', scope: '.claude/kit/noise-ledger.json' },
        { store: 'triage', scope: '.claude/kit/triage.json' },
        { store: 'triage', scope: '.claude/marathon/r1/triage-api.json' }
      ].filter((x) => x.store !== 'lessons'));
      assert.equal(init.out.rows.noise_ledger, 2);
      assert.ok(init.out.rows.triage >= 3);
      // the JSON files are gone from the picture: move them away and the answers stay the same
      await fs.rename(path.join(dir, '.claude/kit/noise-ledger.json'), path.join(dir, 'ledger.bak'));
      await fs.rename(path.join(dir, '.claude/kit/triage.json'), path.join(dir, 'triage.bak'));
      await fs.rm(path.join(dir, '.claude/marathon'), { recursive: true });
      assert.deepEqual((await call(noise, ['apply', '--now', '2026-10-16'], dir, env, FINDINGS)).out, before.apply);
      assert.deepEqual((await call(triage, ['list'], dir, env)).out, before.list);
      assert.deepEqual((await call(triage, ['list', '--state', '.claude/marathon/r1/triage-api.json'], dir, env)).out, before.api);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('a corrupt triage state or ledger file is exit 1 on sqlite too (read from the file before it is in the database)', { skip: !NODE_SQLITE }, async () => {
    const dir = await tmp();
    try {
      const env = await goSqlite(dir, 'node:sqlite');
      await fs.mkdir(path.join(dir, 's'), { recursive: true });
      await fs.writeFile(path.join(dir, 's/t.json'), JSON.stringify({ version: 2, records: {}, scopes: {} }));
      const t = await call(triage, ['visit', '--session', 'x', '--state', 's/t.json'], dir, env, visitOf(2));
      assert.equal(t.code, 1);
      assert.match(t.err, /triage state is corrupt: unsupported version 2/);
      await fs.writeFile(path.join(dir, 's/l.json'), JSON.stringify({ version: 9, entries: [] }));
      const l = await call(noise, ['accept', '--id', 'a', '--reason', 'r', '--ledger', 's/l.json'], dir, env);
      assert.equal(l.code, 1);
      assert.match(l.err, /ledger version 9 is newer/);
      const st = await call(db, ['status'], dir, env);
      assert.equal(st.out.rows.triage + st.out.rows.noise_ledger, 0, 'nothing was stored');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('the default triage path through a symbolic link is refused (exit 2) on sqlite too', { skip: !NODE_SQLITE }, async () => {
    const dir = await tmp(); const elsewhere = await tmp();
    try {
      const env = await goSqlite(dir, 'node:sqlite');
      await fs.symlink(path.join(elsewhere, 'triage.json'), path.join(dir, '.claude/kit/triage.json'));
      const r = await call(triage, ['list'], dir, env);
      assert.equal(r.code, 2);
    } finally { await fs.rm(dir, { recursive: true, force: true }); await fs.rm(elsewhere, { recursive: true, force: true }); }
  });

  it('parallel triage visits and ledger accepts across processes are all kept', { skip: !NODE_SQLITE }, async () => {
    const dir = await tmp();
    try {
      const env = await goSqlite(dir, 'node:sqlite');
      const procs = await Promise.all([
        ...[0, 1, 2, 3].map((i) => cli(['triage', 'visit', '--session', `p${i}`], dir, env, JSON.stringify({ enabled: ['r'], violations: [{ scope: `f${i}.js`, rule: 'r', source: 'auto' }] }))),
        ...[0, 1, 2, 3].map((i) => cli(['noise-ledger', 'accept', '--id', `n${i}`, '--reason', 'parallel'], dir, env))
      ]);
      assert.deepEqual(procs.map((p) => p.code), [0, 0, 0, 0, 0, 0, 0, 0], procs.map((p) => p.err).join(''));
      assert.equal((await call(triage, ['list'], dir, env)).out.records.length, 4);
      const st = await call(db, ['status'], dir, env);
      assert.equal(st.out.rows.noise_ledger, 4);
      assert.equal(st.out.rows.triage_scopes, 4);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
