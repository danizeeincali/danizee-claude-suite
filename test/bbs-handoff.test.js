/**
 * Contract for src/lib/bbs/handoff.js and the `handoff` verb — stream `handoff` of marathon 2026-10-07-bbs.
 * Approved powers become streams of a /w-marathon run with a 5-check finish line each, written BEFORE the build;
 * one brief per power, idea-only, no source code; buy → memo; skip → listed. Nothing is pushed, nothing is built here.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  CHECKS, slugPower, buildFinishLine, renderBrief, renderMemo, buildHandoff
} from '../src/lib/bbs/handoff.js';
import { validateFinishLine } from '../src/lib/marathon/gate.js';
import { intake } from '../src/lib/bbs/intake.js';
import { writeInventory } from '../src/lib/bbs/inventory.js';
import { buildMap, recordJudgments } from '../src/lib/bbs/harness-map.js';
import { computeVerdicts, recordDecisions } from '../src/lib/bbs/verdict.js';
import { readJson } from '../src/lib/bbs/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const CLI = path.join(ROOT, 'src', 'lib', 'bbs', 'cli.js');
const MARATHON_LIB = path.join(ROOT, 'src', 'lib', 'marathon');
const now = () => new Date('2026-10-07T12:00:00Z');
const noSandbox = { present: false, kind: null, reason: 'no sandbox on this machine' };

const power = (over = {}) => ({
  name: 'drift-monitor', what: 'Detects config drift between runs', evidence: 'src/drift.js:12', dependencies: [],
  data_needed: 'none', network: 'none', size: 'small', licence: 'MIT', idea: 'Hash the effective config each run and diff against the last hash.', ...over
});

async function makeHarness(dir, { withMarathon = false } = {}) {
  const w = async (rel, text) => { const p = path.join(dir, rel); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, text); };
  await w('.claude/commands/.shortcuts/w-review.md', '# /w-review\n\nFull Review - agents analyze code for defects and drift.\n');
  await w('scripts/check-drift.sh', '#!/bin/bash\n# compare config hash with the last run\n');
  if (withMarathon) {
    // the real marathon helper library, as the suite installer copies it
    for (const f of await fs.readdir(MARATHON_LIB)) {
      if (f.endsWith('.js')) await fs.copyFile(path.join(MARATHON_LIB, f), path.join(dir, '.claude', 'helpers', 'marathon', f)).catch(async () => {
        await fs.mkdir(path.join(dir, '.claude', 'helpers', 'marathon'), { recursive: true });
        await fs.copyFile(path.join(MARATHON_LIB, f), path.join(dir, '.claude', 'helpers', 'marathon', f));
      });
    }
    await w('.claude/marathon/finish-line.example.json', JSON.stringify({ tolerance: { high: 0, medium: 1, low: 3, passes_in_a_row: 2 }, lines: [] }));
    await w('.claude/marathon/rules.md', '# Standing rules\n\n- Never weaken an assertion.\n');
  }
  spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
}

async function decided(dir, slug, powers, judgments, decisions) {
  const r = await intake(dir, '-', { stdin: 'a tool ' + slug, now, slug });
  await writeInventory(dir, { run: r.runId, input: JSON.stringify(powers), now });
  await buildMap(dir, { run: r.runId, now });
  await recordJudgments(dir, { run: r.runId, input: JSON.stringify(judgments), now });
  await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
  await recordDecisions(dir, { run: r.runId, input: JSON.stringify(decisions), now });
  return r;
}

describe('handoff — slugs and finish line', () => {
  it('slugPower gives a marathon-safe id: lower-case [a-z0-9_-], collapsed, never empty', () => {
    assert.equal(slugPower('drift-monitor'), 'drift-monitor');
    assert.equal(slugPower('Drift Monitor 2'), 'drift-monitor-2');
    assert.equal(slugPower('  weird..name__x '), 'weird-name__x');
    assert.equal(slugPower('ünïcode'), 'unicode');
    assert.equal(slugPower('!!!'), 'power');
    assert.ok(slugPower('x'.repeat(100)).length <= 40);
  });

  it('CHECKS are the five per-power checks in order', () => {
    assert.deepEqual(CHECKS, ['tests_green', 'egress_zero', 'six_sigma_claim', 'callers_ge_1', 'packaged_check']);
  });

  it('buildFinishLine writes five typed lines per approved power plus the three standard lines, and the result validates against the marathon gate schema', () => {
    const fl = buildFinishLine([{ name: 'drift-monitor', verdict: 'rebuild' }, { name: 'Budget Guard', verdict: 'use' }, { name: 'x', verdict: 'skip' }, { name: 'y', verdict: 'buy' }],
      { tolerance: { high: 0, medium: 2, low: 5, passes_in_a_row: 2 } });
    const ids = fl.lines.map(l => l.id);
    assert.deepEqual(ids, [
      'tests_green_drift-monitor', 'egress_zero_drift-monitor', 'six_sigma_drift-monitor', 'callers_drift-monitor', 'packaged_drift-monitor',
      'tests_green_budget-guard', 'egress_zero_budget-guard', 'six_sigma_budget-guard', 'callers_budget-guard', 'packaged_budget-guard',
      'clean_reviews', 'latest_high', 'open_high'
    ]);
    const by = Object.fromEntries(fl.lines.map(l => [l.id, l]));
    assert.deepEqual(by['tests_green_drift-monitor'], { id: 'tests_green_drift-monitor', label: 'drift-monitor: green unit runs in a row', type: 'number', op: 'at_least', value: 1, owner: 'build', source: 'runs.streak:unit' });
    assert.deepEqual(by['egress_zero_drift-monitor'], { id: 'egress_zero_drift-monitor', label: 'drift-monitor: zero egress in the packaged check', type: 'bool', op: 'is', value: true, owner: 'build', source: 'measure:egress_zero_drift-monitor' });
    assert.deepEqual(by['six_sigma_drift-monitor'], { id: 'six_sigma_drift-monitor', label: 'drift-monitor: clean reviews in a row', type: 'number', op: 'at_least', value: 2, owner: 'build', source: 'reviews.streak' });
    assert.deepEqual(by['callers_drift-monitor'], { id: 'callers_drift-monitor', label: 'drift-monitor: callers in the harness', type: 'number', op: 'at_least', value: 1, owner: 'build', source: 'measure:callers_drift-monitor' });
    assert.deepEqual(by['packaged_drift-monitor'], { id: 'packaged_drift-monitor', label: 'drift-monitor: packaged check passes', type: 'bool', op: 'is', value: true, owner: 'build', source: 'measure:packaged_drift-monitor' });
    assert.equal(by.clean_reviews.value, 2, 'clean_reviews follows passes_in_a_row');
    assert.deepEqual(fl.tolerance, { high: 0, medium: 2, low: 5, passes_in_a_row: 2 });
    assert.deepEqual(validateFinishLine(fl), [], 'the marathon gate accepts every line');
  });

  it('buildFinishLine refuses when two powers slug to the same id, and with no approved power returns only the standard lines', () => {
    assert.throws(() => buildFinishLine([{ name: 'a b', verdict: 'rebuild' }, { name: 'a-b', verdict: 'rebuild' }], { tolerance: { high: 0, medium: 2, low: 5, passes_in_a_row: 2 } }), /slug.*a-b/);
    const none = buildFinishLine([{ name: 'x', verdict: 'skip' }], { tolerance: { high: 0, medium: 2, low: 5, passes_in_a_row: 2 } });
    assert.deepEqual(none.lines.map(l => l.id), ['clean_reviews', 'latest_high', 'open_high']);
    assert.throws(() => buildFinishLine([{ name: 'x', verdict: 'rebuild' }], { tolerance: { high: 0 } }), /tolerance/);
  });
});

describe('handoff — briefs and memos', () => {
  const ctx = {
    source: { type: 'repo', ref: 'https://github.com/a/b', identity: 'git:abcdef1234567890abcdef1234567890abcdef12', run: '2026-10-07-b' },
    row: { licence: 'MIT', licence_class: 'permissive', judgment: { status: 'partial', tool: 'script:scripts/check-drift.sh', why: 'hashes but no alerting' }, decision: 'rebuild', probe: null, removed: [{ verdict: 'use', reason: 'no sandbox on this machine' }] },
    lines: buildFinishLine([{ name: 'drift-monitor', verdict: 'rebuild' }], { tolerance: { high: 0, medium: 2, low: 5, passes_in_a_row: 2 } }).lines.slice(0, 5),
    decided_at: '2026-10-07T12:00:00.000Z'
  };

  it('renderBrief: idea in our words, provenance, harness judgment, the five checks, kickoff and never lines; never the evidence text as code, never a code block', () => {
    const md = renderBrief(power({ evidence: 'src/drift.js:12 — `function diff(a,b){return a!==b}`' }), ctx);
    assert.match(md, /^# drift-monitor — rebuild\n/);
    assert.match(md, /## Idea \(in our words\)\n+Hash the effective config each run/);
    assert.match(md, /## Provenance/);
    assert.match(md, /https:\/\/github\.com\/a\/b/);
    assert.match(md, /git:abcdef1/);
    assert.match(md, /MIT \(permissive\)/);
    assert.match(md, /verdict: rebuild/i);
    assert.match(md, /2026-10-07-b/);
    assert.match(md, /## What we have/);
    assert.match(md, /partial.*check-drift\.sh.*hashes but no alerting/);
    assert.match(md, /## Finish line \(5 checks, written before the build\)/);
    for (const id of ['tests_green_drift-monitor', 'egress_zero_drift-monitor', 'six_sigma_drift-monitor', 'callers_drift-monitor', 'packaged_drift-monitor']) assert.match(md, new RegExp(id));
    assert.match(md, /## Kickoff lines/);
    assert.match(md, /Done means/);
    assert.match(md, /Never/);
    assert.match(md, /never (copy|paste) (the )?source code/i);
    assert.match(md, /never execute/i);
    assert.match(md, /src\/drift\.js:12/, 'the evidence LOCATION is kept');
    assert.ok(!md.includes('function diff'), 'code in the evidence string is stripped');
    assert.ok(!md.includes('```'), 'no code block in a brief');
    assert.ok(!md.includes('undefined'));
  });

  it('renderBrief for a `use` verdict adds the wrapping rule (our interface, our tests, in the sandbox) and the probe result', () => {
    const md = renderBrief(power(), { ...ctx, row: { ...ctx.row, decision: 'use', probe: { result: 'clean', evidence: 'no sockets' }, removed: [] } });
    assert.match(md, /^# drift-monitor — use\n/);
    assert.match(md, /## Wrapping rule/);
    assert.match(md, /behind our interface/i);
    assert.match(md, /our tests/i);
    assert.match(md, /sandbox/i);
    assert.match(md, /probe: clean/i);
  });

  it('renderMemo for a `buy` verdict: what it is, why buy, what data would leave, licence, and "no account was created, nothing was signed"', () => {
    const md = renderMemo(power({ name: 'exporter', licence: 'Commercial', network: 'outbound', data_needed: 'uploads usage to the vendor' }), { ...ctx, row: { ...ctx.row, licence: 'Commercial', licence_class: 'commercial', decision: 'buy' } });
    assert.match(md, /^# exporter — buy memo\n/);
    assert.match(md, /Commercial \(commercial\)/);
    assert.match(md, /uploads usage to the vendor/);
    assert.match(md, /no account was created/i);
    assert.match(md, /nothing was signed/i);
    assert.ok(!md.includes('undefined'));
  });
});

describe('handoff — buildHandoff without marathon', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-ho-')); await makeHarness(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('writes briefs for rebuild, memos for buy, lists skips, and handoff.json; marathonRun null; next done', async () => {
    const r = await decided(dir, 'h1',
      [power(), power({ name: 'exporter', licence: 'Commercial', what: 'exports data', idea: 'csv dump of the run' }), power({ name: 'dup', what: 'review agents', idea: 'a full review' })],
      { 'drift-monitor': 'missing', exporter: 'missing', dup: { status: 'have', tool: 'command:.claude/commands/.shortcuts/w-review.md', why: 'same' } },
      { 'drift-monitor': 'rebuild', exporter: 'buy', dup: 'skip' });
    const out = await buildHandoff(dir, { run: r.runId, now });
    assert.equal(out.marathonRun, null);
    assert.deepEqual(out.powers.map(p => [p.name, p.slug, p.verdict, p.brief]), [['drift-monitor', 'drift-monitor', 'rebuild', 'briefs/drift-monitor.md']]);
    assert.equal(out.powers[0].lines.length, 5);
    assert.deepEqual(out.memos.map(m => [m.name, m.memo]), [['exporter', 'memos/exporter.md']]);
    assert.deepEqual(out.skipped, ['dup']);
    assert.equal(out.next, 'done');
    assert.equal(out.resume_line, null);
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    const hj = await readJson(path.join(runDir, 'handoff.json'));
    assert.equal(hj.run, r.runId);
    assert.equal(hj.marathonRun, null);
    assert.equal(hj.source.identity, r.identity);
    assert.equal(hj.powers.length, 1);
    assert.deepEqual(hj.finish_line.lines.map(l => l.id).slice(-3), ['clean_reviews', 'latest_high', 'open_high']);
    assert.match(await fs.readFile(path.join(runDir, 'briefs', 'drift-monitor.md'), 'utf-8'), /^# drift-monitor — rebuild/);
    assert.match(await fs.readFile(path.join(runDir, 'memos', 'exporter.md'), 'utf-8'), /buy memo/);
    const status = await fs.readFile(path.join(runDir, 'status.md'), 'utf-8');
    assert.match(status, /- Next: done\n/);
    assert.match(status, /\| handoff \| done \|/);
    assert.match(status, /- Summary: found=3 approved=2 skipped=1 buy=1 marathon=none/);
  });

  it('refuses before every decision is recorded, refuses to overwrite without force, and with zero approved powers still writes handoff.json with a note', async () => {
    const r = await intake(dir, '-', { stdin: 'x', now, slug: 'h2' });
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now }), /verdict/);
    const done = await decided(dir, 'h3', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    await buildHandoff(dir, { run: done.runId, now });
    await assert.rejects(() => buildHandoff(dir, { run: done.runId, now }), /handoff\.json exists.*--force/);
    // a `have` judgment must name the candidate that has it (harness-map r1)
    const skipAll = await decided(dir, 'h4', [power()], { 'drift-monitor': { status: 'have', tool: 'command:.claude/commands/.shortcuts/w-review.md', why: 'the review command already checks drift' } }, { 'drift-monitor': 'skip' });
    const out = await buildHandoff(dir, { run: skipAll.runId, now, marathon: true });
    assert.equal(out.marathonRun, null);
    assert.match(out.note, /no approved power/i);
    assert.deepEqual(out.skipped, ['drift-monitor']);
  });
});

describe('handoff — buildHandoff with the marathon bridge', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hom-')); await makeHarness(dir, { withMarathon: true }); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('with --marathon and the real marathon helpers: inits a run, writes its finish-line.json (tolerance from the example), fills kickoff.md, queues one stream per power, prints the resume line', async () => {
    const r = await decided(dir, 'm1', [power(), power({ name: 'budget guard', what: 'stops spawning', idea: 'ceiling check' })], { 'drift-monitor': 'missing', 'budget guard': 'missing' }, { 'drift-monitor': 'rebuild', 'budget guard': 'rebuild' });
    const out = await buildHandoff(dir, { run: r.runId, now, marathon: true });
    assert.match(out.marathonRun, /^\d{4}-\d{2}-\d{2}-bbs-m1$/);
    assert.equal(out.resume_line, `/w-marathon --resume ${out.marathonRun}`);
    assert.equal(out.next, 'done');
    const mDir = path.join(dir, '.claude', 'marathon', out.marathonRun);
    const fl = await readJson(path.join(mDir, 'finish-line.json'));
    assert.deepEqual(fl.tolerance, { high: 0, medium: 1, low: 3, passes_in_a_row: 2 }, 'tolerance from the project example');
    assert.equal(fl.lines.filter(l => l.id.startsWith('tests_green_')).length, 2);
    assert.deepEqual(validateFinishLine(fl), []);
    const kickoff = await fs.readFile(path.join(mDir, 'kickoff.md'), 'utf-8');
    assert.match(kickoff, /## Done means\n- drift-monitor: /);
    assert.match(kickoff, /## Never\n(- .*\n)*- Never execute fetched foreign code/);
    assert.match(kickoff, /## Ask me before/);
    assert.match(kickoff, /## You may decide on your own/);
    assert.match(kickoff, /Source: paste/);
    const streams = await readJson(path.join(mDir, 'streams.json'));
    const rows = (streams.streams || streams).filter(s => s.name !== '_meta');
    assert.deepEqual(rows.map(s => [s.name, s.state]), [['drift-monitor', 'queued'], ['budget-guard', 'queued']]);
    assert.match(rows[0].plan, /briefs\/drift-monitor\.md$/);
    assert.match(rows[0].next, /brief/);
    const status = spawnSync(process.execPath, [path.join(dir, '.claude', 'helpers', 'marathon', 'cli.js'), 'status', '--run', out.marathonRun], { cwd: dir, encoding: 'utf-8' });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /\| drift-monitor \|/);
    const hj = await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'handoff.json'));
    assert.equal(hj.marathonRun, out.marathonRun);
    const bbsStatus = await fs.readFile(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'status.md'), 'utf-8');
    assert.match(bbsStatus, new RegExp(`- Next: done — /w-marathon --resume ${out.marathonRun}`));
    assert.match(bbsStatus, new RegExp(`marathon=${out.marathonRun}`));
  });

  it('a second --marathon handoff for another source gets its own run id; the marathon ACTIVE pointer moves to it', async () => {
    const r = await decided(dir, 'm2', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const out = await buildHandoff(dir, { run: r.runId, now, marathon: true });
    assert.match(out.marathonRun, /-bbs-m2$/);
    assert.equal((await fs.readFile(path.join(dir, '.claude', 'marathon', 'ACTIVE'), 'utf-8')).trim(), out.marathonRun);
  });

  it('when the marathon helpers are absent, --marathon fails loudly and writes no handoff.json; the marathon init failing leaves no half-run', async () => {
    const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hobare-'));
    try {
      await makeHarness(bare);
      const r = await decided(bare, 'm3', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
      await assert.rejects(() => buildHandoff(bare, { run: r.runId, now, marathon: true }), /marathon helpers.*\.claude\/helpers\/marathon\/cli\.js/);
      await assert.rejects(() => fs.stat(path.join(bare, '.claude', 'bbs', 'runs', r.runId, 'handoff.json')));
    } finally { await fs.rm(bare, { recursive: true, force: true }); }
    const r = await decided(dir, 'm4', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const failingRunner = () => { const e = new Error('marathon: boom'); e.status = 1; throw e; };
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: failingRunner }), /marathon.*boom/);
    await assert.rejects(() => fs.stat(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'handoff.json')));
  });
});

describe('handoff — cli verb', () => {
  let dir;
  function run(cwd, args, input, env = {}) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input, env: { ...process.env, BBS_SANDBOX: 'absent', ...env } });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hcli-'));
    await makeHarness(dir, { withMarathon: true });
    run(dir, ['intake', '-', '--slug', 'c1'], 'a tool');
    run(dir, ['inventory', '--from', '-'], JSON.stringify([power()]));
    run(dir, ['map']);
    run(dir, ['map', '--from', '-'], JSON.stringify({ 'drift-monitor': 'missing' }));
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('usage lists handoff [--marathon] [--force]; handoff before the decisions exits 1 naming verdict', () => {
    const u = run(dir, ['nope']);
    assert.match(u.err, /cli\.js handoff \[--marathon\] \[--force\] \[--run <id>\] \[--project <dir>\]/);
    assert.match(u.err, /usage: cli\.js <intake\|fetch\|inventory\|map\|verdict\|handoff\|status\|report> \.\.\./);
    const early = run(dir, ['handoff']);
    assert.equal(early.code, 1);
    assert.match(early.err, /verdict/);
  });

  it('handoff --marathon after the decisions creates the marathon run, prints the resume line, and report names the run', () => {
    const computed = run(dir, ['verdict']);
    assert.equal(computed.code, 0, computed.err);
    const v = run(dir, ['verdict', '--decide', 'drift-monitor=rebuild']);
    assert.equal(v.code, 0, v.err);
    const h = run(dir, ['handoff', '--marathon']);
    assert.equal(h.code, 0, h.err);
    assert.match(h.json.marathonRun, /-bbs-c1$/);
    assert.equal(h.json.resume_line, `/w-marathon --resume ${h.json.marathonRun}`);
    assert.equal(run(dir, ['status', '--next']).out.trim(), 'done');
    assert.equal(run(dir, ['report']).out.trim(), `found=1 approved=1 skipped=0 buy=0 marathon=${h.json.marathonRun}`);
    const again = run(dir, ['handoff']);
    assert.equal(again.code, 1);
    assert.match(again.err, /--force/);
    const pos = run(dir, ['handoff', 'extra']);
    assert.equal(pos.code, 1);
    assert.match(pos.err, /unexpected argument "extra"/);
  });
});
