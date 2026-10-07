/**
 * Integration tests for src/lib/marathon/cli.js — the documented invocations run against the
 * real CLI in a throwaway git project. Written from review-round-1 findings: every case here is a
 * way the gate, the budget or the loop could silently pass or stall.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const CLI = path.join(ROOT, 'src', 'lib', 'marathon', 'cli.js');
const TEMPLATES = path.join(ROOT, 'src', 'templates', 'marathon');

function run(cwd, args, input) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf-8' }).stdout.trim();
}

async function makeProject(name) {
  const dir = path.join(os.tmpdir(), `marathon-cli-${name}-${Date.now()}`);
  await fs.mkdir(path.join(dir, '.claude', 'marathon', 'reviewer'), { recursive: true });
  spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  await fs.writeFile(path.join(dir, 'a.txt'), 'hi\n');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  for (const f of ['severity.md', 'angles.md']) {
    await fs.copyFile(path.join(TEMPLATES, 'reviewer', f), path.join(dir, '.claude', 'marathon', 'reviewer', f));
  }
  await fs.copyFile(path.join(TEMPLATES, 'rules.md'), path.join(dir, '.claude', 'marathon', 'rules.md'));
  await fs.copyFile(path.join(TEMPLATES, 'finish-line.example.json'), path.join(dir, '.claude', 'marathon', 'finish-line.example.json'));
  return dir;
}

describe('cli — no run yet (what /bc hits in an ordinary project)', () => {
  let dir;
  before(async () => { dir = await makeProject('norun'); });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('keeplist works without a run (f8)', () => {
    const r = run(dir, ['keeplist']);
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.startsWith('/compact '), r.out);
    assert.ok(!r.out.includes('\n' + '\n'));
  });

  it('resume works without a run and --if-active prints nothing (f8, m4)', () => {
    const r = run(dir, ['resume']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /no marathon run|no active run/i);
    const q = run(dir, ['resume', '--if-active']);
    assert.equal(q.code, 0);
    assert.equal(q.out.trim(), '');
  });

  it('budget without a run still answers (token budget only) rather than crashing', () => {
    const r = run(dir, ['budget']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.usage_pct, null);
  });

  it('init rejects an unsafe --run id (l2)', () => {
    const r = run(dir, ['init', 'x', '--run', '../../escape']);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /run id/i);
  });
});

describe('cli — a run with streams, reviews, findings and the gate', () => {
  let dir, runId, reviewId;
  before(async () => {
    dir = await makeProject('run');
    const r = run(dir, ['init', 'bbs', '--isolation', 'folder']);
    assert.equal(r.code, 0, r.err);
    runId = r.json.runId;
  });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('stream tasks=[a,b] (unquoted-style) is stored as an array and status still renders (f1)', () => {
    const r = run(dir, ['stream', 'intake', 'state=active', 'next=write tests', 'tasks=[t1,t2]']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.tasks, ['t1', 't2']);
    const s = run(dir, ['stream', 'fetch', 'state=queued', 'next=start', 'tasks=t3']);
    assert.deepEqual(s.json.tasks, ['t3']);
    const st = run(dir, ['status']);
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /t1, t2/);
  });

  it('stream state=active records a base commit for the first review (f10)', () => {
    const r = run(dir, ['stream', 'intake']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.json.base, /^[0-9a-f]{7,40}$/);
  });

  it('record run requires kind and status (m13)', () => {
    assert.notEqual(run(dir, ['record', 'run', 'stream=intake']).code, 0);
    assert.notEqual(run(dir, ['record', 'run', 'kind=e2e', 'stream=intake']).code, 0);
    assert.notEqual(run(dir, ['record', 'run', 'kind=e2e', 'status=maybe', 'stream=intake']).code, 0);
    for (let i = 0; i < 6; i++) {
      assert.equal(run(dir, ['record', 'run', 'kind=e2e', 'status=green', 'stream=intake']).code, 0);
    }
    for (let i = 0; i < 3; i++) {
      assert.equal(run(dir, ['record', 'run', 'kind=unit', 'status=green', 'stream=intake']).code, 0);
    }
  });

  it('record review rejects missing, malformed or negative counts and a caller-supplied pass (f3)', () => {
    assert.notEqual(run(dir, ['record', 'review', 'stream=intake']).code, 0, 'missing counts');
    assert.notEqual(run(dir, ['record', 'review', 'stream=intake', 'counts={high:3}']).code, 0, 'malformed counts');
    assert.notEqual(run(dir, ['record', 'review', 'stream=intake', 'counts={"high":-1,"medium":0,"low":0}']).code, 0, 'negative');
    assert.notEqual(run(dir, ['record', 'review', 'stream=intake', 'counts={"high":0,"medium":0,"low":0}', 'pass=true']).code, 0, 'pass override');
    const r = run(dir, ['record', 'review', 'stream=intake', 'counts={"high":1,"medium":0,"low":0}', 'angle=failure conditions', 'tokens=1000']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.pass, false);
    reviewId = r.json.id;
  });

  it('review-writeup refuses when counts disagree with the finding rows (f3)', () => {
    assert.equal(run(dir, ['record', 'finding', `review_id=${reviewId}`, 'stream=intake', 'severity=high', 'category=security', 'file=src/a.js', 'line=3', 'title=Egress']).code, 0);
    assert.equal(run(dir, ['record', 'finding', `review_id=${reviewId}`, 'stream=intake', 'severity=high', 'category=correctness', 'file=src/b.js', 'line=9', 'title=Off by one']).code, 0);
    const w = run(dir, ['review-writeup', '--review', reviewId]);
    assert.notEqual(w.code, 0, 'two high rows vs counts.high=1 must be refused');
    assert.match(w.err + w.out, /mismatch/i);
  });

  it('record finding-fixed closes a finding so open lines can be met (f5)', () => {
    const before = run(dir, ['gate']);
    const openHigh = before.json.lines.find(l => l.id === 'open_high');
    assert.equal(openHigh.actual, 2);
    const findings = JSON.parse(spawnSync('node', ['-e', `
      const fs=require('fs');const p=process.argv[1];
      console.log(JSON.stringify(fs.readFileSync(p,'utf-8').trim().split('\\n').map(JSON.parse)));`,
      path.join(dir, '.claude', 'marathon', runId, 'store', 'findings.jsonl')], { encoding: 'utf-8' }).stdout);
    for (const f of findings) {
      assert.equal(run(dir, ['record', 'finding-fixed', `id=${f.id}`]).code, 0);
    }
    const after = run(dir, ['gate']);
    assert.equal(after.json.lines.find(l => l.id === 'open_high').actual, 0);
    const kl = run(dir, ['keeplist']);
    assert.ok(!kl.out.includes(findings[0].id), 'fixed finding no longer in the keep-list');
  });

  it('gate --stream scopes streaks to one stream (f6)', () => {
    run(dir, ['stream', 'fetch', 'state=active']);
    assert.equal(run(dir, ['record', 'review', 'stream=intake', 'counts={"high":0,"medium":0,"low":0}']).code, 0);
    assert.equal(run(dir, ['record', 'review', 'stream=intake', 'counts={"high":0,"medium":0,"low":0}']).code, 0);
    assert.equal(run(dir, ['record', 'review', 'stream=fetch', 'counts={"high":0,"medium":0,"low":0}']).code, 0);
    const all = run(dir, ['gate']);
    assert.equal(all.json.lines.find(l => l.id === 'clean_reviews').actual, 3, 'global streak');
    const fetch = run(dir, ['gate', '--stream', 'fetch']);
    assert.equal(fetch.json.lines.find(l => l.id === 'clean_reviews').actual, 1, 'per-stream streak');
    assert.equal(fetch.json.lines.find(l => l.id === 'e2e_streak').actual, 0, 'other stream runs do not count');
    assert.equal(fetch.json.stream, 'fetch');
  });

  it('gate fails closed on a corrupt or empty finish-line.json (f2)', async () => {
    const fl = path.join(dir, '.claude', 'marathon', runId, 'finish-line.json');
    const good = await fs.readFile(fl, 'utf-8');
    await fs.writeFile(fl, good.replace(/\}\s*$/, '},'));
    const r = run(dir, ['gate']);
    assert.equal(r.code, 1);
    assert.match(r.err + r.out, /finish-line\.json/);
    assert.ok(!r.json || r.json.buildGateMet === false);
    const rec = run(dir, ['record', 'review', 'stream=intake', 'counts={"high":0,"medium":0,"low":0}']);
    assert.notEqual(rec.code, 0, 'a review cannot be graded without a valid tolerance');
    await fs.writeFile(fl, JSON.stringify({ tolerance: { high: 0, medium: 2, low: 5, passes_in_a_row: 2 }, lines: [] }));
    const empty = run(dir, ['gate']);
    assert.equal(empty.code, 1, 'no lines = nothing checked = not met');
    await fs.writeFile(fl, good);
  });

  it('a measurement that is empty or null never meets a number line (f7)', async () => {
    const fl = path.join(dir, '.claude', 'marathon', runId, 'finish-line.json');
    const good = JSON.parse(await fs.readFile(fl, 'utf-8'));
    good.lines.push({ id: 'bundle', label: 'Bundle kB', type: 'number', op: 'at_most', value: 200, owner: 'build', source: 'measure:bundle' });
    await fs.writeFile(fl, JSON.stringify(good));
    run(dir, ['record', 'measure', 'key=bundle', 'value=']);
    let g = run(dir, ['gate']);
    assert.equal(g.json.lines.find(l => l.id === 'bundle').status, 'failing');
    run(dir, ['record', 'measure', 'key=bundle', 'value=null']);
    g = run(dir, ['gate']);
    assert.equal(g.json.lines.find(l => l.id === 'bundle').status, 'failing');
    run(dir, ['record', 'measure', 'key=bundle', 'value=150']);
    g = run(dir, ['gate']);
    assert.equal(g.json.lines.find(l => l.id === 'bundle').status, 'met');
  });

  it('budget fails closed on a non-numeric usage reading, clamps helper budgets, requires tokens (f4, m1)', () => {
    const bad = run(dir, ['budget', '--usage-pct', '85%']);
    assert.notEqual(bad.code, 0);
    assert.equal(bad.code, 1, 'g12: invalid input is a state problem (1), not the ceiling (2)');
    assert.match(bad.json.reason, /invalid/i);
    const h = run(dir, ['record', 'helper', 'stream=intake', 'role=build', 'model=haiku', 'budget=900000']);
    assert.equal(h.code, 0, h.err);
    assert.equal(h.json.budget, 200000, 'clamped to helper_budget.max');
    assert.notEqual(run(dir, ['record', 'helper-done', `helper_id=${h.json.id}`]).code, 0, 'tokens required');
    assert.notEqual(run(dir, ['record', 'helper-done', `helper_id=${h.json.id}`, 'tokens=12k']).code, 0, 'tokens must be an integer');
    assert.equal(run(dir, ['record', 'helper-done', `helper_id=${h.json.id}`, 'tokens=1200', 'outcome=red']).code, 0);
  });

  it('usage readings come from timestamped measurements, not a stale handoff (m3)', () => {
    const none = run(dir, ['budget']);
    assert.equal(none.json.usage_pct, null);
    assert.equal(run(dir, ['record', 'measure', 'key=usage_pct', 'value=72']).code, 0);
    const fresh = run(dir, ['budget']);
    assert.equal(fresh.json.usage_pct, 72);
    assert.equal(fresh.code, 2);
    const st = run(dir, ['status']);
    assert.match(st.out, /PAUSED/);
  });

  it('a corrupt store line is reported by status, blocks the gate until repaired (m9 + g4)', async () => {
    const p = path.join(dir, '.claude', 'marathon', runId, 'store', 'runs.jsonl');
    await fs.appendFile(p, '{not json\n');
    const st = run(dir, ['status']);
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /corrupt/i);
    const g = run(dir, ['gate']);
    assert.ok(g.json, 'gate still answers');
    assert.equal(g.code, 1);
    assert.equal(g.json.corrupt, 1);
    assert.equal(run(dir, ['repair']).code, 0);
    assert.equal(run(dir, ['gate']).json.corrupt, 0);
  });

  it('finish clears ACTIVE and the hook then prints nothing (m4)', async () => {
    const r = run(dir, ['finish']);
    assert.equal(r.code, 0, r.err);
    await assert.rejects(fs.access(path.join(dir, '.claude', 'marathon', 'ACTIVE')));
    const q = run(dir, ['resume', '--if-active']);
    assert.equal(q.out.trim(), '');
    const st = run(dir, ['status', '--run', runId]);
    assert.match(st.out, /FINISHED/);
  });
});

describe('cli — review commits and diffs come from the stream checkout (f10)', () => {
  let dir;
  before(async () => { dir = await makeProject('wt'); run(dir, ['init', 'wt']); });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('record review/run stamp the commit of the stream\'s isolation checkout, and the first brief diffs from the stream base', async () => {
    const wt = path.join(dir, 'wt-intake');
    spawnSync('git', ['worktree', 'add', '-q', wt, '-b', 'marathon/wt/intake'], { cwd: dir });
    const s = run(dir, ['stream', 'intake', 'state=active', `isolation=${wt}`]);
    assert.equal(s.code, 0, s.err);
    const base = s.json.base;
    await fs.writeFile(path.join(wt, 'b.txt'), 'one\n');
    spawnSync('git', ['add', '.'], { cwd: wt }); spawnSync('git', ['commit', '-qm', 'one'], { cwd: wt });
    await fs.writeFile(path.join(wt, 'c.txt'), 'two\n');
    spawnSync('git', ['add', '.'], { cwd: wt }); spawnSync('git', ['commit', '-qm', 'two'], { cwd: wt });
    const wtHead = git(wt, ['rev-parse', '--short', 'HEAD']);
    const mainHead = git(dir, ['rev-parse', '--short', 'HEAD']);
    assert.notEqual(wtHead, mainHead);

    const brief = run(dir, ['review-brief', '--stream', 'intake']);
    assert.equal(brief.code, 0, brief.err);
    assert.match(brief.out, /b\.txt/, 'first commit of the stream is in the first review');
    assert.match(brief.out, /c\.txt/);
    assert.match(brief.out, new RegExp(base.slice(0, 7)));

    const r = run(dir, ['record', 'review', 'stream=intake', 'counts={"high":0,"medium":0,"low":0}']);
    assert.equal(r.json.commit, wtHead, 'review commit is the worktree HEAD');
    const runRow = run(dir, ['record', 'run', 'kind=unit', 'status=green', 'stream=intake']);
    assert.equal(runRow.json.commit, wtHead);
  });
});
