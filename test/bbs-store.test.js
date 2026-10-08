/**
 * Contract for src/lib/bbs/store.js + src/lib/bbs/config.js — stream `intake` of marathon 2026-10-07-bbs.
 * Run state under .claude/bbs/runs/<run-id>/, the ACTIVE pointer, JSON/JSONL helpers, the registry.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  runsDir, runDir, activeRunId, setActiveRun, clearActiveRun,
  appendJsonl, readJsonl, readJson, writeJson,
  registryPath, lookupSource, appendRegistry, writeTextAtomic
} from '../src/lib/bbs/store.js';
import { DEFAULT_CONFIG, loadConfig, LICENCE_CLASSES } from '../src/lib/bbs/config.js';

async function tmp(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `bbs-${name}-`));
  return dir;
}

describe('bbs config', () => {
  it('DEFAULT_CONFIG carries the limits, licence classes, sandbox rule and paths from the spec', () => {
    assert.equal(DEFAULT_CONFIG.limits.max_urls, 25);
    assert.equal(DEFAULT_CONFIG.limits.max_bytes, 20 * 1024 * 1024);
    assert.equal(DEFAULT_CONFIG.limits.max_powers, 12);
    assert.equal(DEFAULT_CONFIG.limits.max_redirects, 5);
    assert.equal(DEFAULT_CONFIG.limits.timeout_ms, 30000);
    assert.equal(DEFAULT_CONFIG.sandbox.required_for_use, true);
    assert.equal(DEFAULT_CONFIG.paths.runs, '.claude/bbs/runs');
    assert.equal(DEFAULT_CONFIG.paths.registry, '.claude/bbs/registry.jsonl');
    assert.equal(DEFAULT_CONFIG.paths.marathon_cli, '.claude/helpers/marathon/cli.js');
    assert.deepEqual(LICENCE_CLASSES, ['permissive', 'copyleft', 'commercial', 'none']);
    for (const c of ['permissive', 'copyleft', 'commercial']) {
      assert.ok(Array.isArray(DEFAULT_CONFIG.licences[c]) && DEFAULT_CONFIG.licences[c].length > 0, `licences.${c}`);
    }
    assert.ok(DEFAULT_CONFIG.licences.permissive.includes('Apache-2.0'));
    assert.ok(DEFAULT_CONFIG.licences.copyleft.includes('MPL-2.0'));
  });

  it('loadConfig merges .claude/bbs.json over the defaults (objects deep, arrays replace) and fails on bad JSON', async () => {
    const dir = await tmp('config');
    try {
      assert.deepEqual(await loadConfig(dir), DEFAULT_CONFIG);
      await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude', 'bbs.json'), JSON.stringify({ limits: { max_urls: 3 }, licences: { permissive: ['MIT'] } }));
      const cfg = await loadConfig(dir);
      assert.equal(cfg.limits.max_urls, 3);
      assert.equal(cfg.limits.max_bytes, DEFAULT_CONFIG.limits.max_bytes, 'untouched keys keep defaults');
      assert.deepEqual(cfg.licences.permissive, ['MIT'], 'arrays replace');
      assert.deepEqual(cfg.licences.copyleft, DEFAULT_CONFIG.licences.copyleft);
      await fs.writeFile(path.join(dir, '.claude', 'bbs.json'), '{ nope');
      await assert.rejects(() => loadConfig(dir), /invalid JSON/i);
      await fs.writeFile(path.join(dir, '.claude', 'bbs.json'), JSON.stringify({ __proto__: { polluted: true }, limits: 5 }));
      const cfg2 = await loadConfig(dir);
      assert.equal(({}).polluted, undefined, 'no prototype pollution');
      assert.equal(cfg2.limits, 5, 'a scalar replaces an object; the caller validates');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('bbs store — paths and ACTIVE', () => {
  it('runsDir/runDir follow config.paths.runs', () => {
    assert.equal(runsDir('/p'), path.join('/p', '.claude', 'bbs', 'runs'));
    assert.equal(runDir('/p', '2026-10-07-x'), path.join('/p', '.claude', 'bbs', 'runs', '2026-10-07-x'));
    assert.equal(runsDir('/p', { paths: { runs: 'data/bbs' } }), path.join('/p', 'data', 'bbs'));
  });

  it('ACTIVE is null until set, trimmed when read, and gone after clear', async () => {
    const dir = await tmp('active');
    try {
      assert.equal(await activeRunId(dir), null);
      await setActiveRun(dir, '2026-10-07-x');
      assert.equal(await fs.readFile(path.join(dir, '.claude', 'bbs', 'ACTIVE'), 'utf-8'), '2026-10-07-x\n');
      assert.equal(await activeRunId(dir), '2026-10-07-x');
      await clearActiveRun(dir);
      assert.equal(await activeRunId(dir), null);
      await clearActiveRun(dir); // idempotent
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('bbs store — JSON and JSONL', () => {
  let dir;
  before(async () => { dir = await tmp('json'); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('writeJson creates parent dirs and writes pretty JSON with a trailing newline; readJson returns the fallback when missing', async () => {
    const file = path.join(dir, 'a', 'b', 'x.json');
    assert.equal(await readJson(file, null), null);
    assert.deepEqual(await readJson(file, { d: 1 }), { d: 1 });
    await writeJson(file, { k: [1, 2] });
    const raw = await fs.readFile(file, 'utf-8');
    assert.ok(raw.endsWith('\n'));
    assert.ok(raw.includes('\n  "k"'), 'two-space indent');
    assert.deepEqual(await readJson(file), { k: [1, 2] });
  });

  it('readJson throws on corrupt JSON instead of returning the fallback', async () => {
    const file = path.join(dir, 'bad.json');
    await fs.writeFile(file, '{ nope');
    await assert.rejects(() => readJson(file, null), /bad\.json/);
  });

  it('writeJson is atomic: no partial file is left when the content cannot be serialised', async () => {
    const file = path.join(dir, 'atomic.json');
    await writeJson(file, { ok: 1 });
    const cyc = {}; cyc.self = cyc;
    await assert.rejects(() => writeJson(file, cyc));
    assert.deepEqual(await readJson(file), { ok: 1 }, 'previous content intact');
    const leftovers = (await fs.readdir(dir)).filter(f => f.startsWith('atomic.json.'));
    assert.deepEqual(leftovers, [], 'no temp file left behind');
  });

  it('appendJsonl adds ts when absent, one line per row; readJsonl returns rows in order, skips and reports corrupt lines', async () => {
    const file = path.join(dir, 'rows.jsonl');
    assert.deepEqual(await readJsonl(file), []);
    const a = await appendJsonl(file, { n: 1 });
    await appendJsonl(file, { n: 2, ts: '2026-01-01T00:00:00.000Z' });
    assert.ok(!Number.isNaN(Date.parse(a.ts)));
    await fs.appendFile(file, '{ broken\n');
    await appendJsonl(file, { n: 3 });
    const rows = await readJsonl(file);
    assert.deepEqual(rows.map(r => r.n), [1, 2, 3]);
    assert.equal(rows[1].ts, '2026-01-01T00:00:00.000Z', 'caller ts kept');
    const { rows: r2, corrupt } = await readJsonl(file, { report: true });
    assert.equal(r2.length, 3);
    assert.equal(corrupt, 1);
  });

  it('appendJsonl repairs a half-written last line by starting the new row on its own line', async () => {
    const file = path.join(dir, 'half.jsonl');
    await fs.writeFile(file, '{"n":1}\n{"n":2');
    await appendJsonl(file, { n: 3 });
    const rows = await readJsonl(file);
    assert.deepEqual(rows.map(r => r.n), [1, 3]);
  });
});

describe('bbs store — registry', () => {
  let dir;
  before(async () => { dir = await tmp('registry'); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('registryPath follows config.paths.registry', () => {
    assert.equal(registryPath(dir), path.join(dir, '.claude', 'bbs', 'registry.jsonl'));
  });

  it('lookupSource is null for an unknown identity and returns the LATEST row for a known one', async () => {
    assert.equal(await lookupSource(dir, 'sha256:abc'), null);
    await appendRegistry(dir, { identity: 'sha256:abc', type: 'paste', ref: 'paste', run: '2026-10-01-paste' });
    await appendRegistry(dir, { identity: 'sha256:abc', type: 'paste', ref: 'paste', run: '2026-10-02-paste' });
    await appendRegistry(dir, { identity: 'git:deadbeef', type: 'repo', ref: 'https://x/y.git', run: '2026-10-03-y' });
    const row = await lookupSource(dir, 'sha256:abc');
    assert.equal(row.run, '2026-10-02-paste');
    assert.ok(row.ts);
    assert.equal((await lookupSource(dir, 'git:deadbeef')).run, '2026-10-03-y');
  });

  it('appendRegistry refuses a row without identity, type or run', async () => {
    await assert.rejects(() => appendRegistry(dir, { type: 'url', run: 'r' }), /identity/);
    await assert.rejects(() => appendRegistry(dir, { identity: 'x', run: 'r' }), /type/);
    await assert.rejects(() => appendRegistry(dir, { identity: 'x', type: 'url' }), /run/);
  });

  it('lookupSource with a null or pending identity is always null (never matches a pending row)', async () => {
    await appendRegistry(dir, { identity: 'pending', type: 'url', ref: 'https://e.x/p', run: 'r-p' }).catch(() => {});
    assert.equal(await lookupSource(dir, null), null);
    assert.equal(await lookupSource(dir, 'pending'), null);
  });
});

describe('bbs config — review r1 regressions', () => {
  it('a non-object .claude/bbs.json (null, array, scalar) is refused with a clear message', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-config-r1-'));
    try {
      await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
      const file = path.join(dir, '.claude', 'bbs.json');
      for (const raw of ['null', '[]', '[1,2]', '5', '"x"', 'true']) {
        await fs.writeFile(file, raw);
        await assert.rejects(() => loadConfig(dir), (err) => err.message === `invalid config in ${file}: expected an object`, raw);
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('store — review r2 regressions', () => {
  it('readJsonl keeps only plain-object rows; null, arrays and scalars count as corrupt', async () => {
    const d = await tmp('nullrow');
    const f = path.join(d, 'x.jsonl');
    await fs.writeFile(f, '{"a":1}\nnull\n[1]\n5\n"s"\n{"b":2}\n');
    const r = await readJsonl(f, { report: true });
    assert.deepEqual(r.rows, [{ a: 1 }, { b: 2 }]);
    assert.equal(r.corrupt, 4);
    assert.deepEqual(await readJsonl(f), [{ a: 1 }, { b: 2 }]);
  });

  it('lookupSource ignores non-object registry rows', async () => {
    const d = await tmp('nullreg');
    await fs.mkdir(path.dirname(registryPath(d)), { recursive: true });
    await fs.writeFile(registryPath(d), 'null\n{"identity":"sha256:z","type":"paste","run":"r1"}\nnull\n');
    assert.equal((await lookupSource(d, 'sha256:z')).run, 'r1');
  });

  it('writeTextAtomic writes the exact bytes via tmp+rename and leaves no tmp file', async () => {
    const d = await tmp('atomic');
    const f = path.join(d, 'sub', 't.txt');
    await writeTextAtomic(f, Buffer.from([0xff, 0x00, 0x41]));
    assert.deepEqual([...await fs.readFile(f)], [0xff, 0x00, 0x41]);
    await writeTextAtomic(f, 'text');
    assert.equal(await fs.readFile(f, 'utf-8'), 'text');
    assert.deepEqual(await fs.readdir(path.dirname(f)), ['t.txt']);
  });
});

describe('bbs store — ACTIVE pointer is written atomically (review r3)', () => {
  it('a failing ACTIVE write leaves the prior pointer intact', async (t) => {
    if (process.getuid && process.getuid() === 0) return t.skip('root ignores directory permissions');
    const dir = await tmp('active-atomic');
    const bbs = path.join(dir, '.claude', 'bbs');
    try {
      await setActiveRun(dir, 'old-run');
      await fs.chmod(bbs, 0o555);
      await assert.rejects(() => setActiveRun(dir, 'new-run'));
      await fs.chmod(bbs, 0o755);
      assert.equal(await activeRunId(dir), 'old-run');
      assert.deepEqual((await fs.readdir(bbs)).sort(), ['ACTIVE']);
    } finally {
      await fs.chmod(bbs, 0o755).catch(() => {});
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('bbs config — review r4 regressions: paths stay under .claude/bbs', () => {
  it('the defaults pass and paths.runs / paths.registry escaping .claude/bbs are refused naming the key', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-config-r4-'));
    try {
      await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
      const file = path.join(dir, '.claude', 'bbs.json');
      await fs.writeFile(file, JSON.stringify({ paths: { runs: '.claude/bbs/runs', registry: '.claude/bbs/registry.jsonl' } }));
      assert.deepEqual(await loadConfig(dir), DEFAULT_CONFIG);
      await fs.writeFile(file, JSON.stringify({ paths: { runs: '.claude/bbs/other-runs', registry: '.claude/bbs/sub/reg.jsonl' } }));
      const ok = await loadConfig(dir);
      assert.equal(ok.paths.runs, '.claude/bbs/other-runs');
      assert.equal(ok.paths.registry, '.claude/bbs/sub/reg.jsonl');
      await fs.writeFile(file, JSON.stringify({ paths: { runs: '.claude/bbs' } }));
      assert.equal((await loadConfig(dir)).paths.runs, '.claude/bbs');
      const bad = [
        ['runs', '../escaped'], ['runs', '/tmp/abs-runs'], ['runs', ''], ['runs', 5], ['runs', '.claude/bbs/../../x'],
        ['runs', '.claude/bbsx'], ['runs', '.claude'],
        ['registry', '../reg.jsonl'], ['registry', '/tmp/reg.jsonl'], ['registry', ''], ['registry', '.claude/bbs'],
        ['registry', null]
      ];
      for (const [key, value] of bad) {
        await fs.writeFile(file, JSON.stringify({ paths: { [key]: value } }));
        await assert.rejects(() => loadConfig(dir),
          (err) => err.message === `invalid config in ${file}: paths.${key} "${value}" must stay under .claude/bbs`, `${key}=${value}`);
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('paths.marathon_cli must be a non-empty relative string', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-config-r4m-'));
    try {
      await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
      const file = path.join(dir, '.claude', 'bbs.json');
      for (const value of ['', '/usr/bin/cli.js', 7]) {
        await fs.writeFile(file, JSON.stringify({ paths: { marathon_cli: value } }));
        await assert.rejects(() => loadConfig(dir),
          (err) => err.message === `invalid config in ${file}: paths.marathon_cli "${value}" must be a non-empty relative path`, String(value));
      }
      await fs.writeFile(file, JSON.stringify({ paths: { marathon_cli: 'tools/cli.js' } }));
      assert.equal((await loadConfig(dir)).paths.marathon_cli, 'tools/cli.js');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
