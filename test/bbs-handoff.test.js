/**
 * Contract for src/lib/bbs/handoff.js and the `handoff` verb — stream `handoff` of marathon 2026-10-07-bbs.
 * Approved powers become streams of a /w-marathon run with a 5-check finish line each, written BEFORE the build;
 * one brief per power, idea-only, no source code; buy → memo; skip → listed. Nothing is pushed, nothing is built here.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync, execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import {
  CHECKS, slugPower, buildFinishLine, renderBrief, renderMemo, buildHandoff, evidenceLocations, claimJson, marathonSlug
} from '../src/lib/bbs/handoff.js';
import { validateFinishLine } from '../src/lib/marathon/gate.js';
import { intake } from '../src/lib/bbs/intake.js';
import { writeInventory } from '../src/lib/bbs/inventory.js';
import { buildMap, recordJudgments } from '../src/lib/bbs/harness-map.js';
import { computeVerdicts, recordDecisions, POWERS_CHANGED } from '../src/lib/bbs/verdict.js';
import { readJson, withMapLock } from '../src/lib/bbs/store.js';
import { DEFAULT_CONFIG } from '../src/lib/bbs/config.js';

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

// ---------------------------------------------------------------------------------------------------------------
// Review handoff-r1 regressions — one per finding, written red before the fix.

describe('handoff — review r1 regressions', () => {
  const TOL = { high: 0, medium: 2, low: 5, passes_in_a_row: 2 };
  const exists = (p) => fs.stat(p).then(() => true, () => false);
  const bbsRun = (d, id) => path.join(d, '.claude', 'bbs', 'runs', id);
  const marathonCli = (d) => path.join(d, '.claude', 'helpers', 'marathon', 'cli.js');
  /** The real installed marathon CLI, as the default runner calls it; `onCall` sees every argv first. */
  const realRunner = (d, onCall = () => {}) => (args, cwd) => {
    onCall(args);
    const r = spawnSync(process.execPath, [marathonCli(d), ...args], { cwd, encoding: 'utf-8' });
    if (r.status !== 0) { const e = new Error(r.stderr || `exit ${r.status}`); e.stderr = r.stderr; throw e; }
    return r.stdout;
  };
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hor1-')); await makeHarness(dir, { withMarathon: true }); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('[high] refuses while any power has no decision, naming the undecided power and the --decide command; writes no handoff.json', async () => {
    const r = await decided(dir, 'u1', [power(), power({ name: 'budget guard', idea: 'ceiling check' })],
      { 'drift-monitor': 'missing', 'budget guard': 'missing' }, { 'drift-monitor': 'rebuild' });
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now }),
      /^Error: verdict first — undecided powers: budget guard \(cli\.js verdict --decide <power>=<verdict>\)$/);
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'handoff.json')), false);
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'briefs')), false, 'nothing written before the refusal');
  });

  it('[high] refuses when powers.json changed since the verdicts were computed (powers_ts mismatch)', async () => {
    const r = await decided(dir, 'u2', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const pj = path.join(bbsRun(dir, r.runId), 'powers.json');
    const powers = await readJson(pj);
    await fs.writeFile(pj, JSON.stringify({ ...powers, ts: '2030-01-01T00:00:00.000Z' }));
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now }), (err) => err.message === POWERS_CHANGED);
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'handoff.json')), false);
  });

  it('[high] the marathon slug is the bbs run id minus its date prefix: two sources sharing a last segment get distinct marathon runs', async () => {
    const a = await decided(dir, 'claude-suite', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const b = await decided(dir, 'other-suite', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const outA = await buildHandoff(dir, { run: a.runId, now, marathon: true });
    const outB = await buildHandoff(dir, { run: b.runId, now, marathon: true });
    assert.match(outA.marathonRun, /^\d{4}-\d{2}-\d{2}-bbs-claude-suite$/);
    assert.match(outB.marathonRun, /^\d{4}-\d{2}-\d{2}-bbs-other-suite$/);
    assert.notEqual(outA.marathonRun, outB.marathonRun);
    const kA = await fs.readFile(path.join(dir, '.claude', 'marathon', outA.marathonRun, 'kickoff.md'), 'utf-8');
    assert.ok(kA.includes(a.runId) && !kA.includes(b.runId), 'the first run still names only its own source');
  });

  it('[high] a marathon run that already holds a hand-off is refused without --force (ACTIVE restored) and refilled with --force', async () => {
    const r = await decided(dir, 'twice', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const first = await buildHandoff(dir, { run: r.runId, now, marathon: true });
    await fs.rm(path.join(bbsRun(dir, r.runId), 'handoff.json'));
    const other = await decided(dir, 'elsewhere', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const otherOut = await buildHandoff(dir, { run: other.runId, now, marathon: true });
    const activeFile = path.join(dir, '.claude', 'marathon', 'ACTIVE');
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true }),
      new RegExp(`marathon run ${first.marathonRun} already holds a hand-off — pass --force to refill it or pick another source slug`));
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'handoff.json')), false);
    assert.equal((await fs.readFile(activeFile, 'utf-8')).trim(), otherOut.marathonRun, 'a refusal leaves ACTIVE where it was');
    const again = await buildHandoff(dir, { run: r.runId, now, marathon: true, force: true });
    assert.equal(again.marathonRun, first.marathonRun);
    const streams = await readJson(path.join(dir, '.claude', 'marathon', first.marathonRun, 'streams.json'));
    assert.deepEqual((streams.streams || streams).filter(s => s.name !== '_meta').map(s => s.name), ['drift-monitor']);
  });

  it('[high] the queued stream plan is a project-relative path that exists; kickoff.md names the bbs run, its dir and each brief under ## Source', async () => {
    const r = await decided(dir, 'plan', [power(), power({ name: 'budget guard', idea: 'ceiling check' })],
      { 'drift-monitor': 'missing', 'budget guard': 'missing' }, { 'drift-monitor': 'rebuild', 'budget guard': 'rebuild' });
    const out = await buildHandoff(dir, { run: r.runId, now, marathon: true });
    const mDir = path.join(dir, '.claude', 'marathon', out.marathonRun);
    const streams = await readJson(path.join(mDir, 'streams.json'));
    const rows = (streams.streams || streams).filter(s => s.name !== '_meta');
    assert.equal(rows[0].plan, `.claude/bbs/runs/${r.runId}/briefs/drift-monitor.md`);
    await fs.stat(path.join(dir, rows[0].plan));
    await fs.stat(path.join(dir, rows[1].plan));
    const kickoff = await fs.readFile(path.join(mDir, 'kickoff.md'), 'utf-8');
    const src = kickoff.slice(kickoff.indexOf('## Source'));
    assert.ok(kickoff.indexOf('## Source') > kickoff.indexOf('## Never'), '## Source follows ## Never');
    assert.ok(src.includes(r.runId));
    assert.ok(src.includes(`.claude/bbs/runs/${r.runId}`));
    assert.ok(src.includes(rows[0].plan) && src.includes(rows[1].plan));
  });

  it('[medium] a failure after marathon init names the ACTIVE half-filled run and the recovery; --force then refills it', async () => {
    const r = await decided(dir, 'half', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const real = realRunner(dir);
    const failOnStream = (args, cwd) => { if (args[0] === 'stream') throw new Error('stream exploded'); return real(args, cwd); };
    let runId;
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: failOnStream }), (err) => {
      const m = /marathon run (\S+) was created and is ACTIVE but incomplete — re-run cli\.js handoff --marathon --force to refill it, or remove \.claude\/marathon\/(\S+)/.exec(err.message);
      assert.ok(m, err.message);
      assert.equal(m[1], m[2]);
      assert.match(err.message, /stream exploded/, 'the cause is named');
      runId = m[1];
      return true;
    });
    assert.match(runId, /-bbs-half$/);
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'handoff.json')), false);
    const out = await buildHandoff(dir, { run: r.runId, now, marathon: true, force: true });
    assert.equal(out.marathonRun, runId);
  });

  it('[medium] slug collisions across rebuild, use and buy are refused before anything is written, naming both powers', async () => {
    const r = await decided(dir, 'coll', [power({ name: 'X Y', licence: 'Commercial' }), power({ name: 'x-y', licence: 'Commercial' })],
      { 'X Y': 'missing', 'x-y': 'missing' }, { 'X Y': 'buy', 'x-y': 'buy' });
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now }), /slug collision: "X Y" and "x-y" both slug to x-y/);
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'memos')), false);
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'handoff.json')), false);
    const mixed = await decided(dir, 'coll2', [power({ name: 'X Y' }), power({ name: 'x-y', licence: 'Commercial' })],
      { 'X Y': 'missing', 'x-y': 'missing' }, { 'X Y': 'rebuild', 'x-y': 'buy' });
    await assert.rejects(() => buildHandoff(dir, { run: mixed.runId, now }), /slug collision: "X Y" and "x-y"/);
    assert.equal(await exists(path.join(bbsRun(dir, mixed.runId), 'briefs')), false);
  });

  it('[medium] per-power lines are exact: powers "b" and "a_b" never share checks (buildFinishLine.byPower, briefs, handoff.json)', async () => {
    const fl = buildFinishLine([{ name: 'b', verdict: 'rebuild' }, { name: 'a_b', verdict: 'rebuild' }], { tolerance: TOL });
    assert.deepEqual(Object.keys(fl), ['tolerance', 'lines', 'byPower']);
    assert.deepEqual(fl.byPower.b.map(l => l.id), ['tests_green_b', 'egress_zero_b', 'six_sigma_b', 'callers_b', 'packaged_b']);
    assert.deepEqual(fl.byPower.a_b.map(l => l.id), ['tests_green_a_b', 'egress_zero_a_b', 'six_sigma_a_b', 'callers_a_b', 'packaged_a_b']);
    const r = await decided(dir, 'ab', [power({ name: 'b' }), power({ name: 'a_b' })], { b: 'missing', a_b: 'missing' }, { b: 'rebuild', a_b: 'rebuild' });
    const out = await buildHandoff(dir, { run: r.runId, now });
    const pb = out.powers.find(p => p.name === 'b');
    assert.deepEqual(pb.lines.map(l => l.id), ['tests_green_b', 'egress_zero_b', 'six_sigma_b', 'callers_b', 'packaged_b']);
    const brief = await fs.readFile(path.join(bbsRun(dir, r.runId), 'briefs', 'b.md'), 'utf-8');
    assert.ok(!brief.includes('tests_green_a_b'), 'b\'s brief does not list a_b\'s checks');
  });

  it('[medium] evidence: only location tokens are kept, under a labelled Provenance bullet; code before the location never lands', () => {
    assert.deepEqual(evidenceLocations('return a+b; src/x.js:3'), ['src/x.js:3']);
    assert.deepEqual(evidenceLocations('src/a.js:1-4 and src/a.js:1-4, see https://x.test/p'), ['src/a.js:1-4', 'https://x.test/p']);
    assert.deepEqual(evidenceLocations('const x = 1; y()'), []);
    const ctx = { source: null, row: { licence_class: 'permissive', decision: 'rebuild' }, lines: [], decided_at: 'now' };
    const md = renderBrief(power({ evidence: 'return a+b; src/x.js:3' }), ctx);
    assert.ok(!md.includes('return a+b'), 'code before the location is stripped');
    const prov = md.slice(md.indexOf('## Provenance'), md.indexOf('## What we have'));
    assert.match(prov, /\n- Evidence: src\/x\.js:3\n/);
    assert.match(renderBrief(power({ evidence: 'function f(){}' }), ctx), /\n- Evidence: \(no location given\)\n/);
  });

  it('[medium] the marathon run dir comes from init and is validated: a runId of ../../evil is refused and nothing is written; every stream call passes --run', async () => {
    const r = await decided(dir, 'evil', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const evil = () => JSON.stringify({ runId: '../../evil', runDir: '.claude/marathon/../../evil' });
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: evil }), /marathon.*\.\.\/\.\.\/evil/);
    assert.equal(await exists(path.join(dir, 'evil')), false);
    assert.equal(await exists(path.join(dir, '..', 'evil')), false);
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'handoff.json')), false);
    const outside = () => JSON.stringify({ runId: 'fine', runDir: 'elsewhere/fine' });
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: outside }), /elsewhere\/fine.*\.claude\/marathon/);
    assert.equal(await exists(path.join(dir, 'elsewhere')), false);
    const calls = [];
    const out = await buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: realRunner(dir, a => calls.push(a)) });
    const streamCalls = calls.filter(a => a[0] === 'stream');
    assert.equal(streamCalls.length, 1);
    for (const a of streamCalls) assert.deepEqual(a.slice(a.indexOf('--run'), a.indexOf('--run') + 2), ['--run', out.marathonRun]);
  });

  it('[medium] tolerance file: absent → default; corrupt → error naming the file; invalid tolerance → error prefixed with the file path', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hotol-'));
    try {
      await makeHarness(d);
      const r = await decided(d, 't1', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
      const out = await buildHandoff(d, { run: r.runId, now });
      assert.deepEqual((await readJson(path.join(bbsRun(d, r.runId), 'handoff.json'))).finish_line.tolerance, TOL, 'absent file → default');
      assert.equal(out.next, 'done');
      const ex = path.join(d, '.claude', 'marathon', 'finish-line.example.json');
      await fs.mkdir(path.dirname(ex), { recursive: true });
      await fs.writeFile(ex, '{ not json');
      await assert.rejects(() => buildHandoff(d, { run: r.runId, now, force: true }), /corrupt JSON in .*finish-line\.example\.json/);
      await fs.writeFile(ex, JSON.stringify({ tolerance: { high: 0 }, lines: [] }));
      await assert.rejects(() => buildHandoff(d, { run: r.runId, now, force: true }), /^Error: .*finish-line\.example\.json: tolerance/);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });

  it('[low] kickoff.md keeps init\'s title, Budget and Models; fills the four sections in place; ## Source comes after ## Never', async () => {
    const r = await decided(dir, 'kick', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const out = await buildHandoff(dir, { run: r.runId, now, marathon: true });
    const kickoff = await fs.readFile(path.join(dir, '.claude', 'marathon', out.marathonRun, 'kickoff.md'), 'utf-8');
    assert.match(kickoff, new RegExp(`^# Kickoff — ${out.marathonRun}\n`));
    assert.match(kickoff, /## Budget\n- Run token budget: /);
    assert.match(kickoff, /## Models\n- Lead: /);
    const heads = kickoff.split('\n').filter(l => l.startsWith('## '));
    assert.deepEqual(heads, ['## Done means', '## You may decide on your own', '## Ask me before', '## Never', '## Source', '## Budget', '## Models']);
    assert.ok(!/\n- \n/.test(kickoff), 'no empty "- " placeholder is left');
  });

  it('[low] the buy memo names source ref, run, network and licence; "why buy" comes from the licence class / data reason, never the idea text', () => {
    const src = { type: 'repo', ref: 'https://github.com/a/b', identity: 'git:abc', run: '2026-10-07-b' };
    const md = renderMemo(power({ name: 'exporter', licence: 'Commercial', network: 'outbound', data_needed: 'uploads usage to the vendor', idea: 'IDEA-TEXT' }),
      { source: src, row: { licence_class: 'commercial', decision: 'buy' } });
    assert.match(md, /https:\/\/github\.com\/a\/b/);
    assert.match(md, /2026-10-07-b/);
    assert.match(md, /Network: outbound/);
    assert.match(md, /Commercial \(commercial\)/);
    const why = md.slice(md.indexOf('## Why buy'), md.indexOf('\n## ', md.indexOf('## Why buy') + 1));
    assert.ok(!why.includes('IDEA-TEXT'), 'why buy does not repeat the idea');
    assert.match(why, /commercial/);
    assert.match(why, /uploads usage to the vendor/);
  });
});

describe('handoff — review r2 regressions', () => {
  const exists = (p) => fs.stat(p).then(() => true, () => false);
  const bbsRun = (d, id) => path.join(d, '.claude', 'bbs', 'runs', id);
  const marathonCli = (d) => path.join(d, '.claude', 'helpers', 'marathon', 'cli.js');
  const realRunner = (d, onCall = () => {}) => (args, cwd) => {
    onCall(args);
    const r = spawnSync(process.execPath, [marathonCli(d), ...args], { cwd, encoding: 'utf-8' });
    if (r.status !== 0) { const e = new Error(r.stderr || `exit ${r.status}`); e.stderr = r.stderr; throw e; }
    return r.stdout;
  };
  const activeOf = async (d) => (await fs.readFile(path.join(d, '.claude', 'marathon', 'ACTIVE'), 'utf-8')).trim();
  const rowsOf = async (d, id) => {
    const s = await readJson(path.join(d, '.claude', 'marathon', id, 'streams.json'));
    return (s.streams || s).filter(x => x.name !== '_meta');
  };
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hor2-')); await makeHarness(dir, { withMarathon: true }); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('[medium] init printing non-JSON is refused naming what it printed and the ACTIVE pointer; ACTIVE goes back to its prior value', async () => {
    const prior = await decided(dir, 'prior', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const pOut = await buildHandoff(dir, { run: prior.runId, now, marathon: true });
    const r = await decided(dir, 'nojson', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const real = realRunner(dir);
    const runner = (args, cwd) => { if (args[0] === 'init') { real(args, cwd); return 'not json'; } return real(args, cwd); };
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: runner }),
      /marathon init printed no JSON \(not json\) — check \.claude\/marathon\/ACTIVE/);
    assert.equal(await activeOf(dir), pOut.marathonRun, 'ACTIVE is back where it was');
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'handoff.json')), false);
  });

  for (const file of ['finish-line.json', 'streams.json']) {
    it(`[medium] a corrupt ${file} in the marathon run: refused without --force (ACTIVE restored, nothing written); with --force it is moved aside and the hand-off completes`, async () => {
      const slug = `corrupt-${file.split('.')[0]}`;
      const r = await decided(dir, slug, [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
      const real = realRunner(dir);
      let mDir;
      const runner = (args, cwd) => {
        const o = real(args, cwd);
        if (args[0] === 'init') { mDir = path.join(dir, '.claude', 'marathon', JSON.parse(o).runId); require_corrupt(mDir); }
        return o;
      };
      const require_corrupt = (d) => fsSync.writeFileSync(path.join(d, file), '{ not json');
      const before0 = await activeOf(dir);
      await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: runner }),
        new RegExp(`${file.replace('.', '\\.')}.*(corrupt|not valid JSON).*--force`, 's'));
      assert.equal(await activeOf(dir), before0, 'a refusal leaves ACTIVE where it was');
      assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'handoff.json')), false);
      // a fresh run (init cannot reuse a run whose streams.json is already corrupt), forced
      const r2 = await decided(dir, `${slug}-f`, [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
      const out = await buildHandoff(dir, { run: r2.runId, now, marathon: true, force: true, marathonRunner: runner });
      const names = await fs.readdir(mDir);
      assert.ok(names.some(n => n.startsWith(`${file}.stale-`) && n.endsWith('.json')), `corrupt ${file} was moved aside: ${names}`);
      assert.deepEqual(validateFinishLine(await readJson(path.join(mDir, 'finish-line.json'))), []);
      assert.deepEqual((await rowsOf(dir, out.marathonRun)).map(s => s.name), ['drift-monitor']);
    });
  }

  it('[medium] a forced refill blocks the stream rows of powers no longer rebuild/use, deletes their briefs/memos, and lists both in the result and handoff.json', async () => {
    const two = [power(), power({ name: 'budget guard', idea: 'ceiling check' })];
    const r = await decided(dir, 'refill', two, { 'drift-monitor': 'missing', 'budget guard': 'missing' }, { 'drift-monitor': 'rebuild', 'budget guard': 'rebuild' });
    const first = await buildHandoff(dir, { run: r.runId, now, marathon: true });
    const briefBG = path.join(bbsRun(dir, r.runId), 'briefs', 'budget-guard.md');
    assert.equal(await exists(briefBG), true);
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'budget guard': 'skip' }), now, force: true });
    const out = await buildHandoff(dir, { run: r.runId, now, marathon: true, force: true });
    assert.equal(out.marathonRun, first.marathonRun);
    const rows = await rowsOf(dir, out.marathonRun);
    const bg = rows.find(s => s.name === 'budget-guard');
    assert.equal(bg.state, 'blocked');
    assert.match(bg.next, /dropped by a forced hand-off refill on .*: this power is now skip/);
    assert.equal(rows.find(s => s.name === 'drift-monitor').state, 'queued');
    assert.equal(await exists(briefBG), false, 'stale brief deleted');
    assert.deepEqual(out.stale_streams, ['budget-guard']);
    assert.deepEqual(out.removed_files, [`.claude/bbs/runs/${r.runId}/briefs/budget-guard.md`]);
    const hj = await readJson(path.join(bbsRun(dir, r.runId), 'handoff.json'));
    assert.deepEqual(hj.stale_streams, ['budget-guard']);
    assert.deepEqual(hj.removed_files, out.removed_files);
  });

  it('[medium] a forced refill with no approved power blocks every row of the previous marathon run and names that run in the note', async () => {
    const r = await decided(dir, 'refill0', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const first = await buildHandoff(dir, { run: r.runId, now, marathon: true });
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'skip' }), now, force: true });
    const out = await buildHandoff(dir, { run: r.runId, now, marathon: true, force: true });
    const rows = await rowsOf(dir, first.marathonRun);
    assert.deepEqual(rows.map(s => s.state), ['blocked']);
    assert.ok(out.note.includes(first.marathonRun), out.note);
    assert.deepEqual(out.stale_streams, ['drift-monitor']);
    assert.equal((await readJson(path.join(bbsRun(dir, r.runId), 'handoff.json'))).note, out.note);
  });

  it('[medium] a null tolerance limit (unlimited, as the marathon gate allows) is accepted and passed through to finish-line.json; a bad passes_in_a_row names the file', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hotol2-'));
    try {
      await makeHarness(d, { withMarathon: true });
      const ex = path.join(d, '.claude', 'marathon', 'finish-line.example.json');
      await fs.writeFile(ex, JSON.stringify({ tolerance: { high: 0, medium: 1, low: null, passes_in_a_row: 2 }, lines: [] }));
      const r = await decided(d, 'nulltol', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
      const out = await buildHandoff(d, { run: r.runId, now, marathon: true });
      const fl = await readJson(path.join(d, '.claude', 'marathon', out.marathonRun, 'finish-line.json'));
      assert.deepEqual(fl.tolerance, { high: 0, medium: 1, low: null, passes_in_a_row: 2 });
      assert.deepEqual(validateFinishLine(fl), []);
      assert.equal(buildFinishLine([], { tolerance: { high: null, medium: null, low: null, passes_in_a_row: 1 } }).tolerance.high, null);
      assert.throws(() => buildFinishLine([], { tolerance: { high: -1, medium: 0, low: 0, passes_in_a_row: 1 } }), /tolerance\.high/);
      assert.throws(() => buildFinishLine([], { tolerance: { high: 0, medium: 0, low: 0, passes_in_a_row: 0 } }), /passes_in_a_row/);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });

  it('[medium] buildHandoff runs under the run lock: with map.lock held it fails with the locked error and writes nothing', async () => {
    const r = await decided(dir, 'locked', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const rd = bbsRun(dir, r.runId);
    await fs.writeFile(path.join(rd, 'map.lock'), `${process.pid} held\n`);
    try {
      await assert.rejects(() => buildHandoff(dir, { run: r.runId, now }), /map\.json is locked by another bbs command/);
      assert.equal(await exists(path.join(rd, 'handoff.json')), false);
      assert.equal(await exists(path.join(rd, 'briefs')), false, 'no brief written');
    } finally { await fs.rm(path.join(rd, 'map.lock'), { force: true }); }
    await buildHandoff(dir, { run: r.runId, now });
    assert.equal(await exists(path.join(rd, 'handoff.json')), true);
    assert.equal(await exists(path.join(rd, 'map.lock')), false, 'the lock is released');
  });
});

describe('handoff — review r3 regressions', () => {
  const exists = (p) => fs.stat(p).then(() => true, () => false);
  const bbsRun = (d, id) => path.join(d, '.claude', 'bbs', 'runs', id);
  const marathonCli = (d) => path.join(d, '.claude', 'helpers', 'marathon', 'cli.js');
  const realRunner = (d, onCall = () => {}) => (args, cwd) => {
    onCall(args);
    const r = spawnSync(process.execPath, [marathonCli(d), ...args], { cwd, encoding: 'utf-8' });
    if (r.status !== 0) { const e = new Error(r.stderr || `exit ${r.status}`); e.stderr = r.stderr; throw e; }
    return r.stdout;
  };
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const D = [{ 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' }];
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hor3-')); await makeHarness(dir, { withMarathon: true }); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('[medium] from a linked git worktree every marathon call passes --project <worktree>: the run lands under the worktree\'s .claude/marathon, the main checkout\'s is untouched', async () => {
    const main = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hor3-main-'));
    const wt = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hor3-wt-')), 'checkout');
    try {
      await makeHarness(main, { withMarathon: true });
      const g = (...a) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: main, encoding: 'utf-8' }); assert.equal(r.status, 0, r.stderr); };
      g('add', '-A'); g('commit', '-q', '-m', 'harness'); g('worktree', 'add', '-q', wt);
      assert.equal(await exists(path.join(wt, '.claude', 'helpers', 'marathon', 'cli.js')), true);
      const r = await decided(wt, 'wt', [power()], ...D);
      const calls = [];
      const real = realRunner(wt, a => calls.push(a));
      const out = await buildHandoff(wt, { run: r.runId, now, marathon: true, marathonRunner: real });
      for (const a of calls) {
        const i = a.indexOf('--project');
        assert.ok(i > 0, `--project in ${a.join(' ')}`);
        assert.equal(a[i + 1], wt);
      }
      assert.ok(calls.some(a => a[0] === 'init') && calls.some(a => a[0] === 'stream'));
      assert.equal(await exists(path.join(wt, '.claude', 'marathon', out.marathonRun, 'finish-line.json')), true);
      assert.equal(await exists(path.join(wt, '.claude', 'marathon', out.marathonRun, 'kickoff.md')), true);
      assert.equal(await exists(path.join(main, '.claude', 'marathon', out.marathonRun)), false, 'main checkout has no such run');
      assert.deepEqual((await fs.readdir(path.join(main, '.claude', 'marathon'))).sort(), ['finish-line.example.json', 'rules.md']);
      assert.equal(await exists(path.join(bbsRun(wt, r.runId), 'handoff.json')), true);
    } finally {
      spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: main });
      await fs.rm(main, { recursive: true, force: true });
      await fs.rm(path.dirname(wt), { recursive: true, force: true });
    }
  });

  it('[medium] the default runner is async and each call stays under the stale window: an async injected runner awaited 50 ms per call across 3 powers keeps the lock (staleMs 120, refreshMs 30)', async () => {
    const r = await decided(dir, 'asyncrun', [power({ name: 'one' }), power({ name: 'two' }), power({ name: 'three' })],
      { one: 'missing', two: 'missing', three: 'missing' }, { one: 'rebuild', two: 'rebuild', three: 'rebuild' });
    const rd = bbsRun(dir, r.runId);
    const execFileP = promisify(execFile);
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    let steals = 0;
    let calls = 0;
    const runner = async (args, cwd) => {
      calls++;
      await sleep(50);
      // a rival command trying to take the lock mid-run must still find it held (fresh), never stale
      if (calls >= 3) { try { await withMapLock(rd, async () => {}); steals++; } catch { /* held: good */ } }
      return (await execFileP(process.execPath, [marathonCli(dir), ...args], { cwd, encoding: 'utf-8' })).stdout;
    };
    const out = await buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: runner, lockOpts: { staleMs: 120, refreshMs: 30 } });
    assert.equal(out.warning, undefined, 'the lock is still ours at the end');
    assert.equal(steals, 0);
    assert.equal(calls, 4);
    assert.equal(out.powers.length, 3);
  });

  it('[medium] a failed init restores ACTIVE (prior value, or cleared) and names the run dir init may have created', async () => {
    const activeFile = path.join(dir, '.claude', 'marathon', 'ACTIVE');
    const real = realRunner(dir);
    const failAfterInit = (args, cwd) => { if (args[0] === 'init') { real(args, cwd); const e = new Error('spawnSync ETIMEDOUT'); e.stderr = 'init timed out\nsecond line'; throw e; } return real(args, cwd); };
    const prior = await decided(dir, 'initfail-prior', [power()], ...D);
    const pOut = await buildHandoff(dir, { run: prior.runId, now, marathon: true });
    const r = await decided(dir, 'initfail', [power()], ...D);
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: failAfterInit }), (err) => {
      const rel = `.claude/marathon/${todayStr()}-${marathonSlug(r.runId)}`;
      assert.match(err.message, /^marathon: init timed out — ACTIVE was restored to /);
      assert.ok(err.message.includes(`restored to ${pOut.marathonRun};`), err.message);
      assert.ok(err.message.includes(`a run dir ${rel} may have been created and may need removing`), err.message);
      assert.ok(!err.message.includes('second line'));
      return true;
    });
    assert.equal((await fs.readFile(activeFile, 'utf-8')).trim(), pOut.marathonRun, 'ACTIVE is back');
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'handoff.json')), false);
    // no prior ACTIVE: cleared
    const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hor3-bare-'));
    try {
      await makeHarness(bare, { withMarathon: true });
      const r2 = await decided(bare, 'initfail2', [power()], ...D);
      const real2 = realRunner(bare);
      const fail2 = (args, cwd) => { if (args[0] === 'init') { real2(args, cwd); throw Object.assign(new Error('x'), { stderr: 'boom' }); } return real2(args, cwd); };
      await assert.rejects(() => buildHandoff(bare, { run: r2.runId, now, marathon: true, marathonRunner: fail2 }), /marathon: boom — ACTIVE was restored to cleared; a run dir \S+ may have been created and may need removing/);
      assert.equal(await exists(path.join(bare, '.claude', 'marathon', 'ACTIVE')), false, 'ACTIVE cleared');
    } finally { await fs.rm(bare, { recursive: true, force: true }); }
  });

  it('[low] claimJson: when the no-hard-link fallback fails mid-write it removes the file it created; an existing file is left alone', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hor3-claim-'));
    try {
      const file = path.join(d, 'handoff.json');
      const noLink = async () => { throw Object.assign(new Error('no links'), { code: 'EPERM' }); };
      const realOpen = fs.open.bind(fs);
      const failingOpen = async (f, flags) => {
        const fh = await realOpen(f, flags);
        return { writeFile: async () => { await fh.writeFile('{"par'); throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); }, sync: () => fh.sync(), close: () => fh.close() };
      };
      await assert.rejects(() => claimJson(file, { a: 1 }, { link: noLink, open: failingOpen }), /disk full/);
      assert.equal(await exists(file), false, 'no partial handoff.json left behind');
      assert.deepEqual(await fs.readdir(d), [], 'no temp file left either');
      // a pre-existing file is refused and not removed
      await fs.writeFile(file, '{"keep":true}');
      await assert.rejects(() => claimJson(file, { a: 1 }, { link: noLink, open: failingOpen }), /handoff\.json exists/);
      assert.equal(await fs.readFile(file, 'utf-8'), '{"keep":true}');
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });

  it('[low] a refused init output names the run dir it may have left behind: the raw runDir when given, else the likely <runs>/<today>-bbs-<slug>', async () => {
    const r = await decided(dir, 'refused', [power()], ...D);
    const outside = () => JSON.stringify({ runId: 'fine', runDir: 'elsewhere/fine' });
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: outside }),
      /elsewhere\/fine.*may need removing/s);
    const nothing = () => JSON.stringify({});
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true, marathonRunner: nothing }), (err) => {
      assert.ok(err.message.includes(`.claude/marathon/${todayStr()}-${marathonSlug(r.runId)}`), err.message);
      assert.match(err.message, /may need removing/);
      return true;
    });
  });
});

describe('handoff — review r4 regressions', () => {
  const exists = (p) => fs.stat(p).then(() => true, () => false);
  const bbsRun = (d, id) => path.join(d, '.claude', 'bbs', 'runs', id);
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hor4-')); await makeHarness(dir, { withMarathon: true }); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('[medium] evidence: URLs are kept only redacted, a bare dotted token needs a / or a :line, token-shaped strings never land', () => {
    const ev = 'src/a.js:3 calls https://u:pw@api.x.com/v1?api_key=SECRET and eyJhbGciOi.eyJzdWIi.sig_abc';
    assert.deepEqual(evidenceLocations(ev), ['src/a.js:3', 'https://api.x.com/v1?api_key=<redacted>']);
    const ctx = { source: null, row: { licence_class: 'permissive', decision: 'rebuild' }, lines: [], decided_at: 'now' };
    for (const md of [renderBrief(power({ evidence: ev }), ctx), renderMemo(power({ evidence: ev }), { source: null, row: { licence_class: 'commercial', decision: 'buy' } })]) {
      assert.ok(md.includes('- Evidence: src/a.js:3, https://api.x.com/v1?api_key=<redacted>'), md);
      for (const bad of ['pw', 'SECRET', 'eyJ']) assert.ok(!md.includes(bad), `${bad} in ${md}`);
    }
    // the switch: a dotted token with a line suffix or a slash is kept, a bare one is not, a long base64-url segment is dropped
    assert.deepEqual(evidenceLocations('README.md:4 lib/x.ts README.md a.b'), ['README.md:4', 'lib/x.ts']);
    assert.deepEqual(evidenceLocations('src/abcdefghijABCDEFGHIJ.js:3 src/abcdefghijABCDEFGHI.js:3'), ['src/abcdefghijABCDEFGHI.js:3']);
    assert.deepEqual(evidenceLocations('https://h.test/hook/abcdefghijABCDEFGHIJ'), []);
  });

  it('[medium] a forced refill removes only the briefs/memos the previous handoff.json listed: a foreign .md survives, a skipped power\'s brief goes, a directory x.md is skipped and reported', async () => {
    const three = [power(), power({ name: 'budget guard', idea: 'ceiling check' }), power({ name: 'x', idea: 'x idea' })];
    const J = { 'drift-monitor': 'missing', 'budget guard': 'missing', x: 'missing' };
    const r = await decided(dir, 'r4clean', three, J, { 'drift-monitor': 'rebuild', 'budget guard': 'rebuild', x: 'rebuild' });
    await buildHandoff(dir, { run: r.runId, now, marathon: true });
    const rd = bbsRun(dir, r.runId);
    const notes = path.join(rd, 'briefs', 'notes.md');
    const memoNotes = path.join(rd, 'memos', 'mine.md');
    await fs.writeFile(notes, '# my notes\n');
    await fs.writeFile(memoNotes, '# my memo notes\n');
    const xBrief = path.join(rd, 'briefs', 'x.md');
    await fs.rm(xBrief);
    await fs.mkdir(xBrief);
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'budget guard': 'skip', x: 'skip' }), now, force: true });
    const out = await buildHandoff(dir, { run: r.runId, now, marathon: true, force: true });
    assert.equal(await exists(notes), true, 'foreign briefs/notes.md survives --force');
    assert.equal(await exists(memoNotes), true, 'foreign memos/mine.md survives --force');
    assert.equal(await exists(path.join(rd, 'briefs', 'budget-guard.md')), false, 'the skipped power\'s brief is removed');
    assert.equal((await fs.stat(xBrief)).isDirectory(), true, 'the directory is left alone');
    assert.deepEqual(out.removed_files, [`.claude/bbs/runs/${r.runId}/briefs/budget-guard.md`]);
    assert.deepEqual(out.skipped_files, [`.claude/bbs/runs/${r.runId}/briefs/x.md`]);
    const hj = await readJson(path.join(rd, 'handoff.json'));
    assert.deepEqual(hj.removed_files, out.removed_files);
    assert.deepEqual(hj.skipped_files, out.skipped_files);
  });

  it('[medium] a previous handoff.json listing a path outside briefs/ or memos/ never deletes it; it is reported in skipped_files', async () => {
    const r = await decided(dir, 'r4escape', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    await buildHandoff(dir, { run: r.runId, now });
    const rd = bbsRun(dir, r.runId);
    const victim = path.join(rd, 'source.json');
    const hjPath = path.join(rd, 'handoff.json');
    const hj = await readJson(hjPath);
    hj.powers.push({ name: 'evil', slug: 'evil', brief: '../source.json' });
    hj.memos.push({ name: 'evil2', slug: 'evil2', memo: 'memos/../../../../../escape.md' });
    await fs.writeFile(hjPath, JSON.stringify(hj));
    const out = await buildHandoff(dir, { run: r.runId, now, force: true });
    assert.equal(await exists(victim), true, 'source.json is not deleted');
    assert.deepEqual(out.removed_files, []);
    assert.deepEqual(out.skipped_files, ['../source.json', 'memos/../../../../../escape.md']);
  });

  it('[low] a paths.marathon_cli resolving outside the project is refused before anything runs', async () => {
    const r = await decided(dir, 'r4cli', [power()], { 'drift-monitor': 'missing' }, { 'drift-monitor': 'rebuild' });
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.paths.marathon_cli = '../../elsewhere/cli.js';
    let calls = 0;
    await assert.rejects(() => buildHandoff(dir, { run: r.runId, now, marathon: true, cfg, marathonRunner: () => { calls++; return '{}'; } }),
      (err) => err.message === 'marathon: paths.marathon_cli "../../elsewhere/cli.js" must stay under the project');
    assert.equal(calls, 0);
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'briefs')), false, 'nothing written');
    assert.equal(await exists(path.join(bbsRun(dir, r.runId), 'handoff.json')), false);
  });
});
