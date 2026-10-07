/**
 * Tests for src/lib/marathon/status.js — AC 25–26.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  readStreams, writeStreams, setStream, readHandoff, stampHandoff, renderStatus, normalizeTasks
} from '../src/lib/marathon/status.js';
import { DEFAULT_CONFIG } from '../src/lib/marathon/config.js';

describe('status — streams.json', () => {
  let dir;
  before(async () => {
    dir = path.join(os.tmpdir(), `marathon-status-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
  });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('readStreams on an empty run dir is []', async () => {
    assert.deepEqual(await readStreams(dir), []);
    assert.equal(await readHandoff(dir), null);
  });

  it('write/read round trip and setStream patches by name (creating if missing)', async () => {
    await writeStreams(dir, [{ name: 'intake', state: 'queued', next: 'start' }]);
    assert.equal((await readStreams(dir))[0].state, 'queued');
    await setStream(dir, 'intake', { state: 'active', phase: 'Tests', skill: 'pt' });
    await setStream(dir, 'fetch', { state: 'queued', next: 'later' });
    const streams = await readStreams(dir);
    assert.equal(streams.length, 2);
    assert.equal(streams[0].state, 'active');
    assert.equal(streams[0].phase, 'Tests');
    assert.equal(streams[1].name, 'fetch');
  });

  it('f1: tasks are normalised to an array on write, and renderers never see a string', async () => {
    assert.deepEqual(normalizeTasks('[t1,t2]'), ['t1', 't2']);
    assert.deepEqual(normalizeTasks('t1, t2'), ['t1', 't2']);
    assert.deepEqual(normalizeTasks('["t1"]'), ['t1']);
    assert.deepEqual(normalizeTasks(['t1']), ['t1']);
    assert.deepEqual(normalizeTasks(''), []);
    assert.deepEqual(normalizeTasks(undefined), []);
    assert.deepEqual(normalizeTasks(42), []);
    const s = await setStream(dir, 'intake', { tasks: '[t9]' });
    assert.deepEqual(s.tasks, ['t9']);
    const md = renderStatus({
      runId: 'r', config: DEFAULT_CONFIG,
      gate: { buildGateMet: false, gateMet: false, failing: [], waitingOnHuman: [], lines: [] },
      budget: { spent: 0, remaining: 1, usage_pct: null, ok: true }, score: { passes: 0, needed: 2 },
      streams: [{ name: 'x', state: 'active', tasks: '[oops]' }], escapes: 0, handoff: null
    });
    assert.match(md, /oops/);
  });

  it('g19: an empty or null streams.json is an error that names the file', async () => {
    const d2 = path.join(os.tmpdir(), `marathon-status-g19-${Date.now()}`);
    await fs.mkdir(d2, { recursive: true });
    await fs.writeFile(path.join(d2, 'streams.json'), '');
    await assert.rejects(() => readStreams(d2), /streams\.json/);
    await fs.writeFile(path.join(d2, 'streams.json'), 'null');
    await assert.rejects(() => readStreams(d2), /streams\.json/);
    await fs.rm(d2, { recursive: true });
  });

  it('g8: concurrent setStream calls never lose a row', async () => {
    const d3 = path.join(os.tmpdir(), `marathon-status-g8-${Date.now()}`);
    await fs.mkdir(d3, { recursive: true });
    await Promise.all(Array.from({ length: 12 }, (_, i) => setStream(d3, `s${i}`, { state: 'queued' })));
    const names = (await readStreams(d3)).map(s => s.name).sort();
    assert.equal(names.length, 12, names.join(','));
    await fs.rm(d3, { recursive: true });
  });

  it('m9: renderStatus warns about corrupt store lines when told', () => {
    const md = renderStatus({
      runId: 'r', config: DEFAULT_CONFIG,
      gate: { buildGateMet: false, gateMet: false, failing: [], waitingOnHuman: [], lines: [] },
      budget: { spent: 0, remaining: 1, usage_pct: null, ok: true }, score: { passes: 0, needed: 2 },
      streams: [], escapes: 0, handoff: null, corrupt: 3, state: 'FINISHED'
    });
    assert.match(md, /corrupt.*3|3.*corrupt/i);
    assert.match(md, /FINISHED/);
  });

  it('AC26: stampHandoff persists trigger, branch, commit, uncommitted, tasks and a timestamp', async () => {
    const h = await stampHandoff(dir, { trigger: 'auto', branch: 'main', commit: 'abc1234', uncommitted: 3, tasks: ['t1'] });
    assert.ok(h.ts);
    const back = await readHandoff(dir);
    assert.equal(back.trigger, 'auto');
    assert.equal(back.branch, 'main');
    assert.equal(back.commit, 'abc1234');
    assert.equal(back.uncommitted, 3);
    assert.deepEqual(back.tasks, ['t1']);
    assert.equal((await readStreams(dir)).length, 2, 'streams untouched');
  });
});

describe('status — renderStatus', () => {
  const gate = {
    buildGateMet: false, gateMet: false, failing: ['e2e'], waitingOnHuman: ['deployed'],
    lines: [
      { id: 'e2e', label: 'Green e2e runs in a row', status: 'failing', actual: 3, value: 6, op: 'at_least', owner: 'build' },
      { id: 'deployed', label: 'Deployed', status: 'waiting_on_human', actual: false, value: true, op: 'is', owner: 'human' }
    ]
  };
  const streams = [
    { name: 'intake', isolation: '../wt/intake', plan: '.claude/plans/x.md', state: 'active', phase: 'Build', skill: 'pt', next: 'make tests pass', tasks: ['t1'], escapes: 1 },
    { name: 'fetch', isolation: '../wt/fetch', plan: '', state: 'queued', next: 'start', tasks: [], escapes: 0 }
  ];

  it('AC25: header shows state, spend, allowance (unknown), gate score, escapes; one row per stream', () => {
    const md = renderStatus({
      runId: '2026-10-07-bbs', config: DEFAULT_CONFIG, gate,
      budget: { spent: 1_234_567, remaining: 18_765_433, usage_pct: null, ok: true },
      score: { passes: 1, needed: 2 }, streams, escapes: 1, handoff: null
    });
    assert.match(md, /2026-10-07-bbs/);
    assert.match(md, /RUNNING|ACTIVE/i);
    assert.match(md, /1[,.]?234[,.]?567/);
    assert.match(md, /20[,.]?000[,.]?000/);
    assert.match(md, /unknown/i);
    assert.match(md, /1\/2/);
    assert.match(md, /escapes.*1/i);
    assert.match(md, /\| *intake *\|/);
    assert.match(md, /\| *fetch *\|/);
    assert.match(md, /make tests pass/);
    assert.match(md, /Build/);
    assert.match(md, /t1/);
    assert.match(md, /Green e2e runs in a row/);
    assert.match(md, /waiting on human|waitingOnHuman/i);
  });

  it('shows PAUSED (budget) when the budget check failed and the allowance pct when known', () => {
    const md = renderStatus({
      runId: 'r', config: DEFAULT_CONFIG, gate,
      budget: { spent: 20_000_000, remaining: 0, usage_pct: 72, ok: false, reason: 'ceiling 72% ≥ 70%' },
      score: { passes: 0, needed: 2 }, streams, escapes: 0, handoff: { ts: '2026-10-07T10:00:00Z', trigger: 'auto', branch: 'main', commit: 'abc1234', uncommitted: 0, tasks: [] }
    });
    assert.match(md, /PAUSED/);
    assert.match(md, /72%/);
    assert.match(md, /abc1234/);
    assert.match(md, /auto/);
  });
});
