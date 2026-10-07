/**
 * Integration tests from review round 3 (operator's-path angle).
 * The run must not stall at stream boundaries, a clean streak must certify all the code, the bar
 * must be validated and persist, and the fallback must actually be able to run.
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

function run(cwd, args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', env: { ...process.env, ...env } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}
const sh = (cwd, cmd, args) => spawnSync(cmd, args, { cwd, encoding: 'utf-8' }).stdout.trim();

async function makeProject(name, { gitInit = true } = {}) {
  const dir = path.join(os.tmpdir(), `marathon-r3-${name}-${Date.now()}`);
  await fs.mkdir(path.join(dir, '.claude', 'marathon', 'reviewer'), { recursive: true });
  if (gitInit) {
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    await fs.writeFile(path.join(dir, 'a.txt'), 'hi\n');
    spawnSync('git', ['add', '.'], { cwd: dir });
    spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  }
  for (const f of ['severity.md', 'angles.md']) {
    await fs.copyFile(path.join(TEMPLATES, 'reviewer', f), path.join(dir, '.claude', 'marathon', 'reviewer', f));
  }
  await fs.copyFile(path.join(TEMPLATES, 'rules.md'), path.join(dir, '.claude', 'marathon', 'rules.md'));
  await fs.copyFile(path.join(TEMPLATES, 'finish-line.example.json'), path.join(dir, '.claude', 'marathon', 'finish-line.example.json'));
  return dir;
}
const CLEAN = 'counts={"high":0,"medium":0,"low":0}';
const OVER = 'counts={"high":1,"medium":0,"low":0}';

describe('round 3 — the run does not stall at a stream boundary', () => {
  let dir, runId;
  before(async () => { dir = await makeProject('boundary'); runId = run(dir, ['init', 'boundary-run', '--isolation', 'folder']).json.runId; });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('h1: with a queued stream and nothing active, resume names the next stream and the hook speaks', () => {
    run(dir, ['stream', 'alpha-s', 'state=queued', 'next=start alpha']);
    run(dir, ['stream', 'beta-s', 'state=queued', 'next=start beta']);
    run(dir, ['stream', 'alpha-s', 'state=active']);
    run(dir, ['stream', 'alpha-s', 'state=done']);
    const plain = run(dir, ['resume', '--plain']);
    assert.equal(plain.code, 0);
    assert.match(plain.out, /"beta-s"/, 'k11: names the next queued stream, not the run id');
    assert.match(plain.out, /\/w-marathon --resume/, 'm11: tells a fresh session to load the protocol');
    const hook = run(dir, ['resume', '--if-active']);
    assert.notEqual(hook.out.trim(), '', 'queued work remaining → the hook speaks');
    const cron = run(dir, ['wake', '--cron']);
    assert.match(cron.json.prompt, /queued/i, 'm10: the cron prompt takes the next queued stream');
    assert.match(cron.json.prompt, /cli\.js/, 'm10: and says to use the CLI, not to edit status.md');
    assert.ok(!/update status\.md/i.test(cron.json.prompt));
  });

  it('h1/k8: when every stream is done but the run is not finished, every wake path says how to close it', () => {
    run(dir, ['stream', 'beta-s', 'state=active']);
    run(dir, ['stream', 'beta-s', 'state=done']);
    const hook = run(dir, ['resume', '--if-active']).out;
    assert.match(hook, /all streams are done|no stream left/i, 'the hook speaks so CHECKPOINT 5 is reached');
    assert.match(hook, /cli\.js finish/);
    assert.match(run(dir, ['resume', '--plain']).out, /all streams are done|no stream left/i);
  });

  it('m14: status.md tells a returning human what to do next', async () => {
    const st = run(dir, ['status']);
    assert.match(st.out, /Next for you/i);
    assert.match(st.out, /cli\.js gate|cli\.js finish|\/w-marathon/);
  });
});

describe('round 3 — the bar is validated, persists, and a streak certifies all the code', () => {
  let dir, runId, wt;
  before(async () => {
    dir = await makeProject('bar');
    runId = run(dir, ['init', 'bar']).json.runId;
    wt = path.join(dir, 'wt-a');
    spawnSync('git', ['worktree', 'add', '-q', wt, '-b', 'marathon/bar/a'], { cwd: dir });
    run(dir, ['stream', 'a', 'state=active', `isolation=${wt}`]);
    await fs.writeFile(path.join(wt, 'code.js'), 'export const x = 1;\n');
    spawnSync('git', ['add', '.'], { cwd: wt }); spawnSync('git', ['commit', '-qm', 'code'], { cwd: wt });
  });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('h3: tolerance keys and values are validated — a miscased key is an error, not an unlimited severity', async () => {
    const fl = path.join(dir, '.claude', 'marathon', runId, 'finish-line.json');
    const good = JSON.parse(await fs.readFile(fl, 'utf-8'));
    for (const tol of [{ high: 0, Medium: 2, low: 5 }, { high: 0, medium: '2', low: 5 }, { high: 0, medium: -1, low: 5 }, { high: 0, medium: 2, low: 5, severe: 0 }]) {
      await fs.writeFile(fl, JSON.stringify({ ...good, tolerance: { ...tol, passes_in_a_row: 2 } }));
      const g = run(dir, ['gate']);
      assert.equal(g.code, 1, JSON.stringify(tol));
      assert.match(g.err + g.out, /tolerance/);
      assert.notEqual(run(dir, ['record', 'review', 'stream=a', CLEAN]).code, 0, 'no review can be graded against a broken tolerance');
    }
    await fs.writeFile(fl, JSON.stringify({ ...good, tolerance: { high: 0, medium: null, low: 5, passes_in_a_row: 2 } }));
    assert.equal(run(dir, ['gate']).json.error, null, 'explicit null = unlimited is allowed');
    await fs.writeFile(fl, JSON.stringify(good));
  });

  it('h4: a line value must match its type (number lines need a number, bool lines a boolean with op is)', async () => {
    const fl = path.join(dir, '.claude', 'marathon', runId, 'finish-line.json');
    const good = JSON.parse(await fs.readFile(fl, 'utf-8'));
    const write = (line) => fs.writeFile(fl, JSON.stringify({ tolerance: good.tolerance, lines: [line] }));
    await write({ id: 'x', type: 'number', op: 'at_most', value: true, owner: 'build', source: 'findings.open:high' });
    let g = run(dir, ['gate']); assert.equal(g.code, 1); assert.match(g.err + g.out, /value/);
    await write({ id: 'y', type: 'bool', op: 'at_least', value: true, owner: 'human', source: 'checklist:deployed' });
    g = run(dir, ['gate']); assert.equal(g.code, 1); assert.match(g.err + g.out, /op|bool/);
    await write({ id: 'z', type: 'bool', op: 'is', value: 0, owner: 'human', source: 'checklist:deployed' });
    g = run(dir, ['gate']); assert.equal(g.code, 1); assert.match(g.err + g.out, /value/);
    await fs.writeFile(fl, JSON.stringify(good));
  });

  it('h2: every round of a stream diffs from the last certified point — an over round never narrows the next review', async () => {
    assert.equal(run(dir, ['record', 'review', 'stream=a', OVER]).code, 0);
    await fs.writeFile(path.join(wt, 'fix.js'), 'export const y = 2;\n');
    spawnSync('git', ['add', '.'], { cwd: wt }); spawnSync('git', ['commit', '-qm', 'fix'], { cwd: wt });
    const b2 = run(dir, ['review-brief', '--stream', 'a']);
    assert.equal(b2.code, 0, b2.err);
    assert.match(b2.out, /code\.js/, 'code seen only by a failed round is still under review');
    assert.match(b2.out, /fix\.js/);
    // two clean rounds complete the streak → that HEAD is certified and becomes the new base
    assert.equal(run(dir, ['record', 'review', 'stream=a', CLEAN]).code, 0);
    assert.equal(run(dir, ['record', 'review', 'stream=a', CLEAN]).code, 0);
    await fs.writeFile(path.join(wt, 'more.js'), 'export const z = 3;\n');
    spawnSync('git', ['add', '.'], { cwd: wt }); spawnSync('git', ['commit', '-qm', 'more'], { cwd: wt });
    const b4 = run(dir, ['review-brief', '--stream', 'a']);
    assert.match(b4.out, /more\.js/);
    assert.ok(!/code\.js/.test(b4.out), 'certified code is not re-read');
  });

  it('h5: a review with wrong counts is replaced, not re-recorded twice — the streak counts one round', () => {
    const r1 = run(dir, ['record', 'review', 'stream=a', 'counts={"high":0,"medium":0,"low":1}']).json;
    run(dir, ['record', 'finding', `review_id=${r1.id}`, 'severity=low', 'category=docs', 'title=l']);
    run(dir, ['record', 'finding', `review_id=${r1.id}`, 'severity=medium', 'category=docs', 'title=m']);
    const w = run(dir, ['review-writeup', '--review', r1.id]);
    assert.equal(w.code, 1);
    assert.ok(!/re-record/i.test(w.err), 'never suggests re-recording');
    assert.match(w.err, /replaces=/);
    const before = run(dir, ['gate', '--stream', 'a']).json.score.passes;
    const r2 = run(dir, ['record', 'review', 'stream=a', 'counts={"high":0,"medium":1,"low":1}', `replaces=${r1.id}`]);
    assert.equal(r2.code, 0, r2.err);
    assert.equal(r2.json.round, r1.round, 'same round number');
    const after = run(dir, ['gate', '--stream', 'a']).json.score.passes;
    assert.equal(after, before, 'replacing does not add a pass');
    const w2 = run(dir, ['review-writeup', '--review', r2.json.id]);
    assert.equal(w2.code, 0, w2.err + ' — findings follow the replacing review');
    assert.notEqual(run(dir, ['record', 'review', 'stream=a', CLEAN, `replaces=${r1.id}`]).code, 0, 'a voided review cannot be replaced again');
  });

  it('m4: stream= must name a stream that exists', () => {
    assert.notEqual(run(dir, ['record', 'finding', 'stream=aa', 'severity=high', 'category=security', 'title=typo']).code, 0);
    assert.notEqual(run(dir, ['record', 'run', 'stream=aa', 'kind=unit', 'status=green']).code, 0);
    assert.notEqual(run(dir, ['record', 'review', 'stream=aa', CLEAN]).code, 0);
  });

  it('m6: a bare --stream is an error, never the run-wide verdict', () => {
    assert.equal(run(dir, ['gate', '--stream']).code, 1);
    assert.equal(run(dir, ['gate', '--stream', '']).code, 1);
  });

  it('m3: the passes needed shown in status comes from the reviews.streak line', async () => {
    const fl = path.join(dir, '.claude', 'marathon', runId, 'finish-line.json');
    const good = JSON.parse(await fs.readFile(fl, 'utf-8'));
    const { passes_in_a_row, ...tol } = good.tolerance;
    const lines = good.lines.map(l => l.source === 'reviews.streak' ? { ...l, value: 3 } : l);
    await fs.writeFile(fl, JSON.stringify({ tolerance: tol, lines }));
    const g = run(dir, ['gate']);
    assert.equal(g.json.score.needed, 3);
    await fs.writeFile(fl, JSON.stringify(good));
  });

  it('h10: a stream diff larger than 1 MiB is reviewable (lockfiles excluded, size capped), not a crash', async () => {
    await fs.writeFile(path.join(wt, 'package-lock.json'), '{"x":"' + 'a'.repeat(1_900_000) + '"}\n');
    await fs.writeFile(path.join(wt, 'big.txt'), 'line\n'.repeat(400_000));
    spawnSync('git', ['add', '.'], { cwd: wt }); spawnSync('git', ['commit', '-qm', 'big'], { cwd: wt });
    const b = run(dir, ['review-brief', '--stream', 'a']);
    assert.equal(b.code, 0, b.err);
    assert.ok(!/package-lock\.json[\s\S]*aaaaaaaaaa/.test(b.out), 'lockfile content excluded');
    assert.match(b.out, /big\.txt/);
    assert.match(b.out, /truncated|--stat|omitted/i, 'oversize diff is summarised, not dumped');
    assert.ok(b.out.length < 400_000, `brief is capped (${b.out.length} chars)`);
  });

  it('m5: record honours --cwd and finding-fixed needs no checkout', async () => {
    const r1 = run(dir, ['record', 'review', 'stream=a', OVER]).json;
    const f = run(dir, ['record', 'finding', `review_id=${r1.id}`, 'severity=high', 'category=security', 'title=x']).json;
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: dir });
    const fixed = run(dir, ['record', 'finding-fixed', `id=${f.id}`]);
    assert.equal(fixed.code, 0, fixed.err);
    const withCwd = run(dir, ['record', 'run', 'stream=a', 'kind=unit', 'status=green', '--cwd', '.']);
    assert.equal(withCwd.code, 0, withCwd.err);
    const missing = run(dir, ['record', 'run', 'stream=a', 'kind=unit', 'status=green']);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /--cwd|commit=/);
  });
});

describe('round 3 — the ceiling pause persists and the fallback can run', () => {
  let dir, runId;
  before(async () => { dir = await makeProject('pause'); runId = run(dir, ['init', 'p', '--isolation', 'folder']).json.runId; run(dir, ['stream', 'a', 'state=active']); });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('h6: a ceiling hit pauses the run until a fresh reading below the ceiling or an explicit unpause', async () => {
    await fs.writeFile(path.join(dir, '.claude', 'marathon.json'), JSON.stringify({ usage_reading_ttl_minutes: 0.001 }));
    assert.equal(run(dir, ['budget', '--usage-pct', '95']).code, 2);
    await new Promise(r => setTimeout(r, 120));
    const later = run(dir, ['budget']);
    assert.notEqual(later.code, 0, 'the pause does not expire with the reading');
    assert.match(later.json.reason, /paused/i);
    assert.equal(run(dir, ['resume', '--if-active', '--idle-minutes', '0']).out.trim(), '', 'a paused run never wakes the fallback');
    assert.match(run(dir, ['status']).out, /PAUSED/);
    assert.equal(run(dir, ['budget', '--usage-pct', '95']).code, 2, 'a fresh reading above the ceiling keeps it paused');
    assert.equal(run(dir, ['budget', '--usage-pct', '40']).code, 0, 'a fresh reading below the ceiling clears it');
    assert.equal(run(dir, ['budget', '--usage-pct', '95']).code, 2);
    const up = run(dir, ['unpause']);
    assert.equal(up.code, 0, up.err);
    await new Promise(r => setTimeout(r, 120)); // let the 95% reading age past the tiny TTL
    assert.equal(run(dir, ['budget']).code, 0);
    await fs.unlink(path.join(dir, '.claude', 'marathon.json'));
  });

  it('h9: a bare --helper-budget returns the configured default', () => {
    const r = run(dir, ['budget', '--usage-pct', '10', '--helper-budget']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.helper_budget, 150000);
  });

  it('h11: the fallback embeds absolute node and claude paths and logs when they are missing', () => {
    const w = run(dir, ['wake', '--fallback']);
    assert.equal(w.code, 0, w.err);
    assert.ok(w.out.includes(process.execPath), 'absolute node path');
    assert.ok(!/(^|\s)node \.claude/.test(w.out), 'no bare node');
    assert.match(w.out, /claude not found|not found/i, 'logs a missing binary instead of exiting silently');
    assert.match(w.out, /--idle-minutes (4[5-9]|[5-9]\d|\d{3,})/, 'h8: guard longer than the 30-minute cron period');
  });

  it('l4: a bad --idle-minutes keeps the fallback quiet', () => {
    for (const bad of ['abc', '-5', '']) {
      const r = run(dir, ['resume', '--if-active', '--idle-minutes', bad]);
      assert.equal(r.code, 1, bad);
      assert.equal(r.out.trim(), '');
    }
  });

  it('l5: init refuses a finished run id', () => {
    assert.equal(run(dir, ['finish']).code, 0);
    const again = run(dir, ['init', 'p', '--run', runId]);
    assert.equal(again.code, 1);
    assert.match(again.err, /finished/i);
  });
});

describe('round 3 — where state lives', () => {
  it('h7: a project nested in a larger git repo keeps its own .claude state and budget', async () => {
    const mono = await makeProject('mono');
    const app = path.join(mono, 'packages', 'app');
    await fs.mkdir(path.join(app, '.claude', 'marathon', 'reviewer'), { recursive: true });
    await fs.writeFile(path.join(app, '.claude', 'marathon.json'), JSON.stringify({ run_token_budget: 1000, ceiling_pct: 10 }));
    const r = run(app, ['init', 'nested']);
    assert.equal(r.code, 0, r.err);
    await fs.access(path.join(app, '.claude', 'marathon', 'ACTIVE'));
    await assert.rejects(fs.access(path.join(mono, '.claude', 'marathon', 'ACTIVE')), 'nothing written at the enclosing root');
    const b = run(app, ['budget', '--usage-pct', '50']);
    assert.equal(b.code, 2, 'the nested project\'s ceiling (10%) applies');
    await fs.rm(mono, { recursive: true });
  });

  it('h7: a linked worktree of a project still resolves to that project\'s main checkout', async () => {
    const dir = await makeProject('wtres');
    const runId = run(dir, ['init', 'w']).json.runId;
    const wt = path.join(dir, 'wt-x');
    spawnSync('git', ['worktree', 'add', '-q', wt, '-b', 'x'], { cwd: dir });
    run(dir, ['stream', 'x', 'state=active', `isolation=${wt}`]);
    const r = run(wt, ['record', 'run', 'kind=unit', 'status=red', 'stream=x']);
    assert.equal(r.code, 0, r.err);
    assert.match(await fs.readFile(path.join(dir, '.claude', 'marathon', runId, 'store', 'runs.jsonl'), 'utf-8'), /"red"/);
    await fs.rm(dir, { recursive: true });
  });

  it('m8: context looks for the transcript of the directory the session was launched in', () => {
    const r = run(ROOT, ['context', '--transcript', '/nonexistent/x.jsonl']);
    assert.equal(r.code, 1);
    // No transcript given → the slug must come from cwd / CLAUDE_PROJECT_DIR, not the resolved state dir.
    const hinted = run(ROOT, ['context'], { CLAUDE_PROJECT_DIR: '/definitely/not/here' });
    assert.equal(hinted.code, 1);
    assert.match(hinted.err, /-definitely-not-here/, 'k12: the slug comes from CLAUDE_PROJECT_DIR');
  });

  it('l1: a JSON-valid non-object row is corrupt, and repair removes it', async () => {
    const dir = await makeProject('nonobj');
    const runId = run(dir, ['init', 'n']).json.runId;
    await fs.appendFile(path.join(dir, '.claude', 'marathon', runId, 'store', 'measurements.jsonl'), 'null\n42\n');
    const st = run(dir, ['status']);
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /corrupt/i);
    const rep = run(dir, ['repair']);
    assert.equal(rep.code, 0, rep.err);
    assert.equal(rep.json.removed, 2);
    await fs.rm(dir, { recursive: true });
  });
});
