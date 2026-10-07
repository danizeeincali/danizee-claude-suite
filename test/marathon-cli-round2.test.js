/**
 * Integration tests from review round 2 (failure-conditions angle).
 * Design rule they enforce: validate at every boundary, fail closed on any store damage,
 * lock the read-modify-write, resolve state to the main worktree, diff a streak from its start.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
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
const runAsync = (cwd, args) => new Promise(resolve => {
  const p = spawn(process.execPath, [CLI, ...args], { cwd });
  let out = '', err = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
  p.on('close', code => resolve({ code, out, err }));
});
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf-8' }).stdout.trim();

async function makeProject(name) {
  const dir = path.join(os.tmpdir(), `marathon-r2-${name}-${Date.now()}`);
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
const CLEAN = 'counts={"high":0,"medium":0,"low":0}';

describe('round 2 — input validation at the boundary', () => {
  let dir, runId;
  before(async () => { dir = await makeProject('valid'); runId = run(dir, ['init', 'v', '--isolation', 'folder']).json.runId; run(dir, ['stream', 'a', 'state=active', 'next=x']); });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('g1: counts must have exactly high, medium, low — nothing else, nothing missing, no other case', () => {
    for (const bad of ['counts={}', 'counts={"foo":3}', 'counts={"High":3,"Medium":4,"Low":9}', 'counts={"high":0,"medium":0}', 'counts={"high":0,"medium":0,"low":0,"critical":1}']) {
      const r = run(dir, ['record', 'review', 'stream=a', bad]);
      assert.notEqual(r.code, 0, bad);
      assert.match(r.err, /counts/);
    }
    assert.equal(run(dir, ['record', 'review', 'stream=a', CLEAN]).code, 0);
  });

  it('g2: finish-line lines are schema-checked (owner, op, type, source) and a build gate needs a build line', async () => {
    const fl = path.join(dir, '.claude', 'marathon', runId, 'finish-line.json');
    const good = JSON.parse(await fs.readFile(fl, 'utf-8'));
    const write = (lines) => fs.writeFile(fl, JSON.stringify({ tolerance: good.tolerance, lines }));
    await write([{ id: 'x', type: 'number', op: 'at_least', value: 1, owner: 'Build', source: 'runs.streak:e2e' }]);
    let g = run(dir, ['gate']);
    assert.equal(g.code, 1); assert.match(g.err + g.out, /owner/);
    await write([{ id: 'x', type: 'number', op: 'gte', value: 1, owner: 'build', source: 'runs.streak:e2e' }]);
    g = run(dir, ['gate']); assert.equal(g.code, 1); assert.match(g.err + g.out, /op/);
    await write([{ id: 'x', type: 'count', op: 'at_least', value: 1, owner: 'build', source: 'runs.streak:e2e' }]);
    g = run(dir, ['gate']); assert.equal(g.code, 1); assert.match(g.err + g.out, /type/);
    await write([{ id: 'x', type: 'number', op: 'at_least', value: 1, owner: 'build', source: 'nope.thing' }]);
    g = run(dir, ['gate']); assert.equal(g.code, 1); assert.match(g.err + g.out, /source/);
    await write([{ id: 'dep', type: 'bool', op: 'is', value: true, owner: 'human', source: 'checklist:deployed' }]);
    g = run(dir, ['gate']);
    assert.equal(g.code, 1, 'a human-only finish line never meets the build gate');
    assert.equal(g.json.buildGateMet, false);
    await fs.writeFile(fl, JSON.stringify(good));
  });

  it('g13: passes_in_a_row and a reviews.streak line must agree', async () => {
    const fl = path.join(dir, '.claude', 'marathon', runId, 'finish-line.json');
    const good = JSON.parse(await fs.readFile(fl, 'utf-8'));
    await fs.writeFile(fl, JSON.stringify({ ...good, tolerance: { ...good.tolerance, passes_in_a_row: 3 } }));
    const g = run(dir, ['gate']);
    assert.equal(g.code, 1);
    assert.match(g.err + g.out, /passes_in_a_row/);
    await fs.writeFile(fl, JSON.stringify(good));
  });

  it('g3: usage readings are validated on the way in, a bare --usage-pct is an error, a bad TTL is an error', async () => {
    for (const bad of ['value=95%', 'value=150', 'value=-1', 'value=', 'value=abc']) {
      const r = run(dir, ['record', 'measure', 'key=usage_pct', bad]);
      assert.notEqual(r.code, 0, bad);
    }
    const bare = run(dir, ['budget', '--usage-pct']);
    assert.equal(bare.code, 1, 'bare flag is a state problem, not a ceiling');
    assert.match(bare.json?.reason ?? bare.err, /invalid/i);
    assert.equal(run(dir, ['record', 'measure', 'key=usage_pct', 'value=40']).code, 0);
    assert.equal(run(dir, ['budget']).json.usage_pct, 40);
    const cfgPath = path.join(dir, '.claude', 'marathon.json');
    await fs.writeFile(cfgPath, JSON.stringify({ usage_reading_ttl_minutes: 'thirty' }));
    const ttl = run(dir, ['budget']);
    assert.equal(ttl.code, 1); assert.match(ttl.json?.reason ?? ttl.err, /invalid/i);
    await fs.unlink(cfgPath);
  });

  it('g23: a usage reading older than the TTL is unknown again', async () => {
    const p = path.join(dir, '.claude', 'marathon', runId, 'store', 'measurements.jsonl');
    const old = new Date(Date.now() - 2 * 3600_000).toISOString();
    await fs.writeFile(p, JSON.stringify({ id: 'm-old', ts: old, key: 'usage_pct', value: 99 }) + '\n');
    const r = run(dir, ['budget']);
    assert.equal(r.json.usage_pct, null);
    assert.equal(r.code, 0);
  });

  it('g12: invalid input exits 1, only the ceiling/budget exit 2', () => {
    assert.equal(run(dir, ['budget', '--usage-pct', '85%']).code, 1);
    assert.equal(run(dir, ['budget', '--usage-pct', '85']).code, 2);
  });

  it('g15: --helper-budget must be a positive integer', () => {
    for (const bad of ['abc', '-5', '0', '1.5']) assert.equal(run(dir, ['budget', '--usage-pct', '10', '--helper-budget', bad]).code, 1, bad);
    const ok = run(dir, ['budget', '--usage-pct', '10', '--helper-budget', '50000']);
    assert.equal(ok.code, 0); assert.equal(ok.json.helper_budget, 50000);
  });

  it('g16/g21: stream names are required and validated', () => {
    assert.notEqual(run(dir, ['stream', 'state=active', 'next=build']).code, 0);
    assert.notEqual(run(dir, ['stream', '../evil', 'state=queued']).code, 0);
    assert.notEqual(run(dir, ['stream', 'has space', 'state=queued']).code, 0);
    assert.equal(run(dir, ['stream', 'ok-name_1', 'state=queued']).code, 0);
  });

  it('g17: record finding always opens a new finding; it cannot rewrite or close an existing one', () => {
    const rid = run(dir, ['record', 'review', 'stream=a', 'counts={"high":1,"medium":0,"low":0}']).json.id;
    const f = run(dir, ['record', 'finding', `review_id=${rid}`, 'stream=a', 'severity=high', 'category=security', 'title=x', 'status=deferred']);
    assert.equal(f.code, 0);
    assert.equal(f.json.status, 'open', 'status is forced open');
    const dup = run(dir, ['record', 'finding', `id=${f.json.id}`, 'review_id=' + rid, 'stream=a', 'severity=low', 'category=docs', 'title=downgrade']);
    assert.notEqual(dup.code, 0, 'an existing id cannot be rewritten through record finding');
    assert.equal(run(dir, ['gate']).json.lines.find(l => l.id === 'open_high').actual, 1);
  });

  it('g7: a finding without stream= inherits it from its review; with neither it is refused', () => {
    const rid = run(dir, ['record', 'review', 'stream=a', 'counts={"high":1,"medium":0,"low":0}']).json.id;
    const f = run(dir, ['record', 'finding', `review_id=${rid}`, 'severity=high', 'category=security', 'title=sqli']);
    assert.equal(f.code, 0, f.err);
    assert.equal(f.json.stream, 'a');
    assert.notEqual(run(dir, ['record', 'finding', 'severity=high', 'category=security', 'title=orphan']).code, 0);
    const g = run(dir, ['gate', '--stream', 'a']);
    assert.ok(g.json.lines.find(l => l.id === 'open_high').actual >= 1, 'scoped gate sees the inherited finding');
  });

  it('g22: record helper is always a spawn row', () => {
    const r = run(dir, ['record', 'helper', 'stream=a', 'event=done', 'helper_id=zzz', 'tokens=oops']);
    assert.equal(r.code, 0);
    assert.equal(r.json.event, 'spawn');
    assert.equal(r.json.helper_id, undefined);
    assert.equal(r.json.tokens, undefined);
  });

  it('g20: all-digit shas and task ids stay strings', () => {
    const r = run(dir, ['record', 'run', 'kind=unit', 'status=green', 'stream=a', 'commit=0123456']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.commit, '0123456');
    const s = run(dir, ['stream', 'a', 'tasks=12345']);
    assert.deepEqual(s.json.tasks, ['12345']);
    assert.notEqual(run(dir, ['record', 'run', 'kind=unit', 'status=green', 'stream=a', 'commit=not-a-sha']).code, 0, 'l3: commit must be a sha');
  });

  it('g24: a missing transcript is reported as missing', () => {
    const r = run(dir, ['context', '--transcript', '/nonexistent/t.jsonl']);
    assert.equal(r.code, 1);
    assert.match(r.err, /not found|missing|cannot read/i);
  });
});

describe('round 2 — store damage fails closed and is repairable', () => {
  let dir, runId;
  before(async () => { dir = await makeProject('store'); runId = run(dir, ['init', 's', '--isolation', 'folder']).json.runId; run(dir, ['stream', 'a', 'state=active', 'next=x']); });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('g5: appending after a half-written last line never glues rows together', async () => {
    const p = path.join(dir, '.claude', 'marathon', runId, 'store', 'reviews.jsonl');
    run(dir, ['record', 'review', 'stream=a', CLEAN]);
    await fs.appendFile(p, '{"id":"half","stream":"a","pass":false,"counts":{"high":2,"med'); // no newline
    const r = run(dir, ['record', 'review', 'stream=a', CLEAN]);
    assert.equal(r.code, 0, r.err);
    const lines = (await fs.readFile(p, 'utf-8')).split('\n').filter(Boolean);
    assert.equal(lines.length, 3, 'half line + new row stay separate');
    assert.doesNotThrow(() => JSON.parse(lines[2]));
  });

  it('g4: a corrupt line in the store makes the gate not met and the budget invalid, and says so in the JSON', () => {
    const g = run(dir, ['gate']);
    assert.equal(g.code, 1);
    assert.ok(g.json.corrupt >= 1, 'gate JSON reports corrupt lines');
    assert.equal(g.json.buildGateMet, false);
    const b = run(dir, ['budget', '--usage-pct', '10']);
    assert.equal(b.code, 1);
    assert.match(b.json.reason, /corrupt|invalid/i);
    const st = run(dir, ['status']);
    assert.equal(st.code, 0);
    assert.match(st.out, /corrupt/i);
  });

  it('g4: cli.js repair quarantines corrupt lines and the gate answers again', async () => {
    const r = run(dir, ['repair']);
    assert.equal(r.code, 0, r.err);
    assert.ok(r.json.removed >= 1);
    const quarantine = path.join(dir, '.claude', 'marathon', runId, 'store', 'reviews.jsonl.corrupt');
    assert.match(await fs.readFile(quarantine, 'utf-8'), /half/);
    const g = run(dir, ['gate']);
    assert.equal(g.json.corrupt, 0);
    const b = run(dir, ['budget', '--usage-pct', '10']);
    assert.equal(b.code, 0, b.err);
  });

  it('g19: an empty or null streams.json names the file in its error', async () => {
    const p = path.join(dir, '.claude', 'marathon', runId, 'streams.json');
    const good = await fs.readFile(p, 'utf-8');
    await fs.writeFile(p, '');
    let r = run(dir, ['status']);
    assert.equal(r.code, 1); assert.match(r.err, /streams\.json/);
    await fs.writeFile(p, 'null');
    r = run(dir, ['status']);
    assert.equal(r.code, 1); assert.match(r.err, /streams\.json/);
    await fs.writeFile(p, good);
  });

  it('g8: concurrent stream writes all survive (locked read-modify-write)', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => runAsync(dir, ['stream', `s${i}`, 'state=queued', `next=step${i}`])));
    assert.ok(results.every(r => r.code === 0), results.map(r => r.err).join('\n'));
    const streams = JSON.parse(await fs.readFile(path.join(dir, '.claude', 'marathon', runId, 'streams.json'), 'utf-8')).streams;
    for (let i = 0; i < 8; i++) assert.ok(streams.some(s => s.name === `s${i}`), `s${i} lost`);
  });
});

describe('round 2 — reviews see the right code, state lives in the main worktree', () => {
  let dir, runId, wt;
  before(async () => {
    dir = await makeProject('wt');
    runId = run(dir, ['init', 'wt']).json.runId;
    wt = path.join(dir, 'wt-a');
    spawnSync('git', ['worktree', 'add', '-q', wt, '-b', 'marathon/wt/a'], { cwd: dir });
    run(dir, ['stream', 'a', 'state=active', `isolation=${wt}`]);
    await fs.writeFile(path.join(wt, 'code.js'), 'export const x = 1;\n');
    spawnSync('git', ['add', '.'], { cwd: wt }); spawnSync('git', ['commit', '-qm', 'code'], { cwd: wt });
  });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('g6: every review in a streak diffs from where the streak began, so the second clean review sees the same code', () => {
    const b1 = run(dir, ['review-brief', '--stream', 'a']);
    assert.equal(b1.code, 0, b1.err); assert.match(b1.out, /code\.js/);
    assert.equal(run(dir, ['record', 'review', 'stream=a', CLEAN]).code, 0);
    const b2 = run(dir, ['review-brief', '--stream', 'a']);
    assert.equal(b2.code, 0, b2.err);
    assert.match(b2.out, /code\.js/, 'round 2 of a streak must not be an empty diff');
    assert.match(b2.out, /Round 2/);
  });

  it('g6/h2: an over review never narrows the next brief — code a failed round saw is still under review', async () => {
    assert.equal(run(dir, ['record', 'review', 'stream=a', 'counts={"high":1,"medium":0,"low":0}']).code, 0);
    await fs.writeFile(path.join(wt, 'fix.js'), 'export const y = 2;\n');
    spawnSync('git', ['add', '.'], { cwd: wt }); spawnSync('git', ['commit', '-qm', 'fix'], { cwd: wt });
    const b = run(dir, ['review-brief', '--stream', 'a']);
    assert.match(b.out, /fix\.js/);
    assert.match(b.out, /code\.js/, 'only a completed clean streak certifies code; a failed round certifies nothing');
  });

  it('g6: a git failure or an empty range is an error, not an empty brief that passes', async () => {
    const r = run(dir, ['review-brief', '--stream', 'a', '--base', 'deadbeef1']);
    assert.equal(r.code, 1);
    assert.match(r.err, /git|diff/i);
    const noGit = path.join(os.tmpdir(), `marathon-nogit-${Date.now()}`);
    await fs.mkdir(path.join(noGit, '.claude', 'marathon'), { recursive: true });
    run(noGit, ['init', 'n']); run(noGit, ['stream', 'a', 'state=active']);
    const n = run(noGit, ['review-brief', '--stream', 'a']);
    assert.equal(n.code, 1);
    await fs.rm(noGit, { recursive: true });
  });

  it('g9: a CLI call from inside a stream worktree writes to the main checkout\'s ledger', () => {
    const r = run(wt, ['record', 'run', 'kind=unit', 'status=red', 'stream=a']);
    assert.equal(r.code, 0, r.err);
    const main = run(dir, ['gate']);
    assert.equal(main.json.lines.find(l => l.id === 'unit_streak').actual, 0, 'red run visible from main');
    const mainRuns = spawnSync('cat', [path.join(dir, '.claude', 'marathon', runId, 'store', 'runs.jsonl')], { encoding: 'utf-8' }).stdout;
    assert.match(mainRuns, /"status":"red"/);
  });

  it('g14: gate --stream never rewrites status.md with a scoped verdict', async () => {
    run(dir, ['stream', 'b', 'state=active', '--no-isolation']);
    for (let i = 0; i < 2; i++) run(dir, ['record', 'review', 'stream=b', CLEAN]);
    run(dir, ['gate', '--stream', 'b']);
    const md = await fs.readFile(path.join(dir, '.claude', 'marathon', runId, 'status.md'), 'utf-8');
    const unscoped = run(dir, ['gate']).json;
    assert.match(md, new RegExp(`Gate[^\\n]*: ${unscoped.score.passes}/${unscoped.score.needed}`), 'status header carries the run-wide score, not the scoped one');
  });

  it('g11: a stream whose worktree is gone is an error, not a silent fallback to main', async () => {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: dir });
    const r = run(dir, ['review-brief', '--stream', 'a']);
    assert.equal(r.code, 1);
    assert.match(r.err, /worktree|isolation/i);
    const rec = run(dir, ['record', 'review', 'stream=a', CLEAN]);
    assert.equal(rec.code, 1);
  });

  it('g10: after finish, --if-active is silent even with an explicit --run; a fresh status.md keeps the fallback quiet', async () => {
    run(dir, ['stream', 'b', 'state=active', '--no-isolation']);
    assert.equal(run(dir, ['resume', '--if-active', '--run', runId, '--idle-minutes', '60']).out.trim(), '', 'live session wrote status.md recently');
    assert.notEqual(run(dir, ['resume', '--if-active', '--run', runId, '--idle-minutes', '0.0001']).out.trim(), '');
    assert.equal(run(dir, ['finish']).code, 0);
    assert.equal(run(dir, ['resume', '--if-active', '--run', runId]).out.trim(), '');
  });
});
