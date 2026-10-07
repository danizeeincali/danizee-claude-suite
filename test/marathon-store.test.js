/**
 * Tests for src/lib/marathon/store.js + config.js
 * AC 1–3: JSONL append/read, helper folding, config load/merge, active run.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TABLES, append, readAll, readAllWithReport, storePath, foldHelpers } from '../src/lib/marathon/store.js';
import {
  DEFAULT_CONFIG, loadConfig, runsDir, runDir, activeRunId, setActiveRun
} from '../src/lib/marathon/config.js';

describe('marathon store — JSONL tables', () => {
  let dir;
  before(async () => {
    dir = path.join(os.tmpdir(), `marathon-store-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
  });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('exposes the seven tables', () => {
    assert.deepEqual(
      [...TABLES].sort(),
      ['compactions', 'findings', 'helpers', 'measurements', 'promotions', 'reviews', 'runs']
    );
  });

  it('append writes one JSON line per row and adds id + ts', async () => {
    const a = await append(dir, 'runs', { kind: 'unit', status: 'green' });
    const b = await append(dir, 'runs', { kind: 'e2e', status: 'red' });
    assert.ok(a.id && b.id && a.id !== b.id, 'ids assigned and distinct');
    assert.ok(!Number.isNaN(Date.parse(a.ts)), 'ts is ISO');
    const raw = await fs.readFile(storePath(dir, 'runs'), 'utf-8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).kind, 'unit');
  });

  it('readAll returns rows in write order; missing table reads as []', async () => {
    const rows = await readAll(dir, 'runs');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, 'unit');
    assert.equal(rows[1].kind, 'e2e');
    assert.deepEqual(await readAll(dir, 'reviews'), []);
  });

  it('append preserves a caller-supplied id', async () => {
    const r = await append(dir, 'findings', { id: 'f-fixed', severity: 'low' });
    assert.equal(r.id, 'f-fixed');
    const rows = await readAll(dir, 'findings');
    assert.equal(rows[0].id, 'f-fixed');
  });

  it('rejects an unknown table', async () => {
    await assert.rejects(() => append(dir, 'lessons', {}), /unknown table/i);
  });

  it('g5: append after a file without a trailing newline keeps rows separate', async () => {
    const d2 = path.join(os.tmpdir(), `marathon-store-g5-${Date.now()}`);
    await fs.mkdir(path.join(d2, 'store'), { recursive: true });
    await fs.writeFile(storePath(d2, 'reviews'), '{"id":"half","pass":false,"counts":{"hi'); // truncated, no newline
    await append(d2, 'reviews', { id: 'next', pass: true });
    const report = await readAllWithReport(d2, 'reviews');
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].id, 'next');
    assert.equal(report.corrupt, 1);
    await fs.rm(d2, { recursive: true });
  });

  it('g4: repairTable quarantines corrupt lines into <table>.jsonl.corrupt and keeps the valid rows', async () => {
    const d3 = path.join(os.tmpdir(), `marathon-store-g4-${Date.now()}`);
    await append(d3, 'runs', { id: 'a' });
    await fs.appendFile(storePath(d3, 'runs'), 'garbage\n');
    await append(d3, 'runs', { id: 'b' });
    const { repairTable } = await import('../src/lib/marathon/store.js');
    const r = await repairTable(d3, 'runs');
    assert.equal(r.removed, 1);
    assert.equal((await readAllWithReport(d3, 'runs')).corrupt, 0);
    assert.deepEqual((await readAll(d3, 'runs')).map(x => x.id), ['a', 'b']);
    assert.match(await fs.readFile(storePath(d3, 'runs') + '.corrupt', 'utf-8'), /garbage/);
    await fs.rm(d3, { recursive: true });
  });

  it('m9: a corrupt line is skipped and counted, never fatal', async () => {
    await fs.appendFile(storePath(dir, 'runs'), '{not json\n', 'utf-8');
    const rows = await readAll(dir, 'runs');
    assert.equal(rows.length, 2, 'valid rows still read');
    const report = await readAllWithReport(dir, 'runs');
    assert.equal(report.rows.length, 2);
    assert.equal(report.corrupt, 1);
    const clean = await readAllWithReport(dir, 'findings');
    assert.equal(clean.corrupt, 0);
  });
});

describe('marathon store — foldHelpers', () => {
  it('pairs spawn/done rows and flags over_budget', () => {
    const rows = [
      { event: 'spawn', id: 'h1', budget: 100, model: 'sonnet', stream: 'a' },
      { event: 'spawn', id: 'h2', budget: 200, model: 'opus', stream: 'a' },
      { event: 'done', helper_id: 'h1', tokens: 150 }
    ];
    const folded = foldHelpers(rows);
    const h1 = folded.get('h1');
    assert.equal(h1.budget, 100);
    assert.equal(h1.tokens, 150);
    assert.equal(h1.done, true);
    assert.equal(h1.over_budget, true);
    const h2 = folded.get('h2');
    assert.equal(h2.done, false);
    assert.equal(h2.tokens, null);
    assert.equal(h2.over_budget, false);
    assert.equal(h2.model, 'opus');
  });
});

describe('marathon config', () => {
  let project;
  before(async () => {
    project = path.join(os.tmpdir(), `marathon-config-${Date.now()}`);
    await fs.mkdir(path.join(project, '.claude'), { recursive: true });
  });
  after(async () => { try { await fs.rm(project, { recursive: true }); } catch {} });

  it('DEFAULT_CONFIG carries the agreed defaults', () => {
    assert.equal(DEFAULT_CONFIG.ceiling_pct, 70);
    assert.equal(DEFAULT_CONFIG.run_token_budget, 20_000_000);
    assert.equal(DEFAULT_CONFIG.helper_budget.default, 150_000);
    assert.equal(DEFAULT_CONFIG.helper_budget.max, 200_000);
    assert.equal(DEFAULT_CONFIG.models.build, 'sonnet');
    assert.equal(DEFAULT_CONFIG.models.review, 'opus');
    assert.equal(DEFAULT_CONFIG.models.routine, 'haiku');
    assert.equal(DEFAULT_CONFIG.streams.isolation, 'worktree');
    assert.equal(DEFAULT_CONFIG.review.backend, 'agent');
    assert.ok(DEFAULT_CONFIG.review.categories.includes('correctness'));
    assert.equal(DEFAULT_CONFIG.bc.prune_below_pct, 50);
    assert.equal(DEFAULT_CONFIG.bc.clear_above_pct, 80);
    assert.equal(DEFAULT_CONFIG.bc.context_window, 1_000_000);
    assert.equal(DEFAULT_CONFIG.bc.push, false);
    assert.equal(DEFAULT_CONFIG.paths.runs, '.claude/marathon');
  });

  it('loadConfig returns defaults when marathon.json is absent', async () => {
    const cfg = await loadConfig(project);
    assert.deepEqual(cfg, DEFAULT_CONFIG);
  });

  it('loadConfig deep-merges marathon.json over defaults', async () => {
    await fs.writeFile(
      path.join(project, '.claude', 'marathon.json'),
      JSON.stringify({ ceiling_pct: 55, bc: { clear_above_pct: 90 } }),
      'utf-8'
    );
    const cfg = await loadConfig(project);
    assert.equal(cfg.ceiling_pct, 55);
    assert.equal(cfg.bc.clear_above_pct, 90);
    assert.equal(cfg.bc.prune_below_pct, 50, 'untouched nested default kept');
    assert.equal(cfg.models.build, 'sonnet');
  });

  it('runsDir / runDir resolve under paths.runs', async () => {
    const cfg = await loadConfig(project);
    assert.equal(runsDir(project, cfg), path.join(project, '.claude', 'marathon'));
    assert.equal(runDir(project, '2026-10-07-bbs', cfg), path.join(project, '.claude', 'marathon', '2026-10-07-bbs'));
  });

  it('activeRunId is null until setActiveRun', async () => {
    const cfg = await loadConfig(project);
    assert.equal(await activeRunId(project, cfg), null);
    await setActiveRun(project, '2026-10-07-bbs', cfg);
    assert.equal(await activeRunId(project, cfg), '2026-10-07-bbs');
  });
});
