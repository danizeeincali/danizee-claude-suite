/**
 * Contract for src/lib/bbs/verdict.js and the `verdict` verb — stream `verdict` of marathon 2026-10-07-bbs.
 * legalVerdicts + defaultVerdict from the licence policy, the harness judgment, the sandbox check and the network probe;
 * one table, one question; every decision recorded with a label (approve = 1, skip = 0); the registry row when all are decided.
 * Two rules cannot change: safety first; our rules always win.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  VERDICTS, PROBES, PolicyRefused, licenceClass, detectSandbox, legalVerdicts, defaultVerdict, verdictTable,
  computeVerdicts, recordProbe, recordDecisions, defaultExec, SANDBOX_STDERR_MAX_CHARS, sanitizeEvidence
} from '../src/lib/bbs/verdict.js';
import { DEFAULT_CONFIG } from '../src/lib/bbs/config.js';
import { intake } from '../src/lib/bbs/intake.js';
import { writeInventory } from '../src/lib/bbs/inventory.js';
import { buildMap, recordJudgments } from '../src/lib/bbs/harness-map.js';
import { readJson, readJsonl, lookupSource, appendRegistry, appendJsonl, registryPath } from '../src/lib/bbs/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(path.dirname(__dirname), 'src', 'lib', 'bbs', 'cli.js');
const now = () => new Date('2026-10-07T12:00:00Z');
const noSandbox = { present: false, kind: null, reason: 'no sandbox on this machine: docker is not running and unshare is unavailable' };
const sandbox = { present: true, kind: 'docker', reason: 'docker info succeeded' };

const power = (over = {}) => ({
  name: 'drift-monitor', what: 'Detects config drift between runs', evidence: 'src/drift.js:12', dependencies: [],
  data_needed: 'none', network: 'none', size: 'small', licence: 'MIT', idea: 'Hash the effective config each run and diff against the last hash.', ...over
});

async function makeHarness(dir) {
  const w = async (rel, text) => { const p = path.join(dir, rel); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, text); };
  await w('.claude/commands/.shortcuts/w-review.md', '# /w-review\n\nFull Review - agents analyze code for defects and drift.\n');
  await w('scripts/check-drift.sh', '#!/bin/bash\n# compare config hash with the last run\n');
}

describe('verdict — licence classes', () => {
  it('maps SPDX ids case-insensitively, families by prefix, "all rights reserved" to commercial, unknown/empty to none', () => {
    const cfg = DEFAULT_CONFIG;
    for (const [l, c] of [['MIT', 'permissive'], ['apache-2.0', 'permissive'], ['BSD-3-Clause', 'permissive'], ['0BSD', 'permissive'], ['Unlicense', 'permissive'],
      ['GPL-3.0-only', 'copyleft'], ['GPL-2.0-or-later', 'copyleft'], ['AGPL-3.0', 'copyleft'], ['LGPL-2.1', 'copyleft'], ['MPL-2.0', 'copyleft'], ['EUPL-1.2', 'copyleft'], ['CC-BY-SA-4.0', 'copyleft'], ['SSPL-1.0', 'copyleft'], ['OSL-3.0', 'copyleft'],
      ['Commercial', 'commercial'], ['proprietary', 'commercial'], ['BUSL-1.1', 'commercial'], ['Elastic-2.0', 'commercial'], ['All Rights Reserved', 'commercial'], ['Copyright 2024 Acme. All rights reserved.', 'commercial'],
      ['unknown', 'none'], ['', 'none'], ['   ', 'none'], ['WTFPL', 'none'], ['see LICENSE file', 'none']]) {
      assert.equal(licenceClass(l, cfg), c, l);
    }
    assert.equal(licenceClass(undefined, cfg), 'none');
    assert.equal(licenceClass(42, cfg), 'none');
  });

  it('a project config can add ids to a class; a dual licence "MIT OR Apache-2.0" takes the most permissive part, "GPL-2.0 AND MIT" the most restrictive', () => {
    const cfg = { ...DEFAULT_CONFIG, licences: { ...DEFAULT_CONFIG.licences, permissive: [...DEFAULT_CONFIG.licences.permissive, 'WTFPL'] } };
    assert.equal(licenceClass('WTFPL', cfg), 'permissive');
    assert.equal(licenceClass('MIT OR Apache-2.0', DEFAULT_CONFIG), 'permissive');
    assert.equal(licenceClass('GPL-3.0 OR Commercial', DEFAULT_CONFIG), 'copyleft', 'OR picks the most permissive available: copyleft beats commercial');
    assert.equal(licenceClass('GPL-2.0 AND MIT', DEFAULT_CONFIG), 'copyleft');
    assert.equal(licenceClass('MIT AND Proprietary', DEFAULT_CONFIG), 'commercial');
  });
});

describe('verdict — detectSandbox', () => {
  it('docker present and `docker info` exits 0 → present; docker missing or failing and no unshare → absent with a reason; unshare on linux → present', async () => {
    const calls = [];
    const exec = (cmd, args) => { calls.push([cmd, ...args]); if (cmd === 'docker') return { status: 0 }; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
    const ok = await detectSandbox({ exec, platform: 'darwin', env: {} });
    assert.deepEqual(ok, { present: true, kind: 'docker', reason: 'docker info succeeded' });
    // r3 decision (lead, 2026-10-07): safety first — the endpoint is inspected BEFORE any daemon is contacted,
    // so a remote context never receives `docker info`. An empty inspect answer with DOCKER_HOST unset counts as local.
    assert.deepEqual(calls[0].slice(0, 3), ['docker', 'context', 'inspect']);
    assert.deepEqual(calls[1], ['docker', 'info']);
    const noDocker = await detectSandbox({ exec: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }, platform: 'darwin' });
    assert.equal(noDocker.present, false);
    assert.equal(noDocker.kind, null);
    assert.match(noDocker.reason, /docker/);
    assert.match(noDocker.reason, /no sandbox/i);
    const dockerDown = await detectSandbox({ exec: (cmd) => { if (cmd === 'docker') return { status: 1, stderr: 'Cannot connect to the Docker daemon' }; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }, platform: 'darwin' });
    assert.equal(dockerDown.present, false);
    assert.match(dockerDown.reason, /not running|daemon/i);
    const linux = await detectSandbox({ exec: (cmd) => { if (cmd === 'unshare') return { status: 0 }; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }, platform: 'linux' });
    assert.deepEqual(linux, { present: true, kind: 'unshare', reason: 'unshare is available' });
    const macUnshare = await detectSandbox({ exec: (cmd) => { if (cmd === 'unshare') return { status: 0 }; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }, platform: 'darwin' });
    assert.equal(macUnshare.present, false, 'unshare only counts on linux');
    const hang = await detectSandbox({ exec: () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }, platform: 'darwin' });
    assert.equal(hang.present, false);
    assert.match(hang.reason, /timeout/i);
  });
});

describe('verdict — legalVerdicts and defaultVerdict', () => {
  const judg = (status) => ({ status, tool: status === 'missing' ? null : 'script:scripts/check-drift.sh', why: 'x' });

  it('VERDICTS is the preference order and PROBES the probe results', () => {
    assert.deepEqual(VERDICTS, ['rebuild', 'use', 'buy', 'skip']);
    assert.deepEqual(PROBES, ['clean', 'found', 'incomplete']);
  });

  it('permissive + sandbox + clean probe → rebuild, use, skip; without a sandbox `use` is removed with the sandbox reason; without a probe `use` needs one', () => {
    const full = legalVerdicts(power(), { judgment: judg('missing'), licenceClass: 'permissive', sandbox, probe: 'clean' });
    assert.deepEqual(full.legal, ['rebuild', 'use', 'skip']);
    assert.deepEqual(full.removed, []);
    assert.equal(full.needs_probe, false);
    const noBox = legalVerdicts(power(), { judgment: judg('missing'), licenceClass: 'permissive', sandbox: noSandbox, probe: null });
    assert.deepEqual(noBox.legal, ['rebuild', 'skip']);
    assert.equal(noBox.removed.length, 1);
    assert.equal(noBox.removed[0].verdict, 'use');
    assert.match(noBox.removed[0].reason, /no sandbox/i);
    const unprobed = legalVerdicts(power(), { judgment: judg('missing'), licenceClass: 'permissive', sandbox, probe: null });
    assert.deepEqual(unprobed.legal, ['rebuild', 'use', 'skip']);
    assert.equal(unprobed.needs_probe, true, 'use stays a candidate until the probe says clean, but cannot be decided yet');
  });

  it('a probe that found a hidden network call, or could not finish, removes `use` with the probe result in the reason', () => {
    for (const probe of ['found', 'incomplete']) {
      const r = legalVerdicts(power(), { judgment: judg('missing'), licenceClass: 'permissive', sandbox, probe });
      assert.deepEqual(r.legal, ['rebuild', 'skip'], probe);
      assert.match(r.removed[0].reason, new RegExp(probe));
      assert.equal(r.needs_probe, false);
    }
    assert.throws(() => legalVerdicts(power(), { judgment: judg('missing'), licenceClass: 'permissive', sandbox, probe: 'maybe' }), /probe/);
  });

  it('copyleft and none → rebuild, skip; commercial → buy, rebuild, skip; `use` is never legal outside permissive', () => {
    assert.deepEqual(legalVerdicts(power(), { judgment: judg('missing'), licenceClass: 'copyleft', sandbox, probe: 'clean' }).legal, ['rebuild', 'skip']);
    assert.deepEqual(legalVerdicts(power(), { judgment: judg('missing'), licenceClass: 'none', sandbox, probe: 'clean' }).legal, ['rebuild', 'skip']);
    const com = legalVerdicts(power(), { judgment: judg('missing'), licenceClass: 'commercial', sandbox, probe: 'clean' });
    assert.deepEqual(com.legal, ['rebuild', 'buy', 'skip']);
    assert.ok(com.removed.some(r => r.verdict === 'use' && /licen/i.test(r.reason)));
    assert.throws(() => legalVerdicts(power(), { judgment: judg('missing'), licenceClass: 'weird', sandbox }), /licence class/);
  });

  it('skip is always legal and is the default for a power the harness already has; otherwise rebuild when legal; buy for commercial; `use` is never the default', () => {
    const base = { sandbox, probe: 'clean' };
    assert.equal(defaultVerdict(power(), { judgment: judg('have'), licenceClass: 'permissive', ...base }), 'skip');
    assert.equal(defaultVerdict(power(), { judgment: judg('partial'), licenceClass: 'permissive', ...base }), 'rebuild');
    assert.equal(defaultVerdict(power(), { judgment: judg('missing'), licenceClass: 'copyleft', ...base }), 'rebuild');
    assert.equal(defaultVerdict(power(), { judgment: judg('missing'), licenceClass: 'commercial', ...base }), 'buy');
    assert.equal(defaultVerdict(power({ network: 'outbound', data_needed: 'uploads usage data to the vendor cloud' }), { judgment: judg('missing'), licenceClass: 'permissive', ...base }), 'buy', 'a free service that moves our data off the machine is a buy memo');
    assert.equal(defaultVerdict(power({ network: 'outbound', data_needed: 'none' }), { judgment: judg('missing'), licenceClass: 'permissive', ...base }), 'rebuild');
  });

  it('verdictTable renders one markdown row per power with escaped pipes and no undefined', () => {
    const rows = {
      'drift-monitor': { licence: 'MIT', licence_class: 'permissive', judgment: { status: 'partial', tool: 'script:scripts/check-drift.sh' }, legal: ['rebuild', 'skip'], default: 'rebuild', removed: [{ verdict: 'use', reason: 'no sandbox on this machine' }], needs_probe: false, probe: null, decision: null },
      'a|b': { licence: 'unknown', licence_class: 'none', judgment: { status: 'missing', tool: null }, legal: ['rebuild', 'skip'], default: 'rebuild', removed: [], needs_probe: false, probe: null, decision: 'skip' }
    };
    const md = verdictTable(rows);
    assert.match(md, /\| Power \| Harness \| Licence \| Legal \| Default \| Decision \| Why \|/);
    assert.match(md, /\| drift-monitor \| partial \(check-drift\.sh\) \| MIT \(permissive\) \| rebuild, skip \| rebuild \| — \| use removed: no sandbox on this machine \|/);
    assert.match(md, /\| a\\\|b \| missing \| unknown \(none\) \| rebuild, skip \| rebuild \| skip \|/);
    assert.ok(!md.includes('undefined'));
  });
});

describe('verdict — computeVerdicts, recordProbe, recordDecisions', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-verd-')); await makeHarness(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  async function prepared(slug, powers, judgments) {
    const r = await intake(dir, '-', { stdin: 'a tool ' + slug, now, slug });
    await writeInventory(dir, { run: r.runId, input: JSON.stringify(powers), now });
    await buildMap(dir, { run: r.runId, now });
    await recordJudgments(dir, { run: r.runId, input: JSON.stringify(judgments), now });
    return r;
  }

  it('computeVerdicts needs every judgment, writes verdicts.json with rows, the sandbox result and empty decisions, and returns the table', async () => {
    const r = await prepared('v1', [power(), power({ name: 'exporter', licence: 'GPL-3.0', what: 'exports data', idea: 'csv dump' })], { 'drift-monitor': 'missing', exporter: 'missing' });
    const out = await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    assert.equal(out.next, 'verdict');
    assert.deepEqual(Object.keys(out.rows).sort(), ['drift-monitor', 'exporter']);
    assert.deepEqual(out.rows['drift-monitor'].legal, ['rebuild', 'skip']);
    assert.equal(out.rows['drift-monitor'].default, 'rebuild');
    assert.equal(out.rows['drift-monitor'].licence_class, 'permissive');
    assert.equal(out.rows['drift-monitor'].removed[0].verdict, 'use');
    assert.equal(out.rows.exporter.licence_class, 'copyleft');
    assert.match(out.table, /\| drift-monitor \|/);
    const vj = await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'verdicts.json'));
    assert.deepEqual(vj.sandbox, noSandbox);
    assert.deepEqual(vj.decisions, {});
    assert.equal(vj.source_identity, r.identity);
    assert.equal(vj.run, r.runId);
    const half = await prepared('v2', [power(), power({ name: 'b' })], { 'drift-monitor': 'missing' });
    await assert.rejects(() => computeVerdicts(dir, { run: half.runId, sandbox: noSandbox, now }), /judg.*b/);
    const noMap = await intake(dir, '-', { stdin: 'x', now, slug: 'v3' });
    await assert.rejects(() => computeVerdicts(dir, { run: noMap.runId, sandbox: noSandbox, now }), /map|inventory/);
  });

  it('with a sandbox present a permissive power needs a probe before `use` can be decided; the probe result is recorded and recomputes legal', async () => {
    const r = await prepared('v4', [power()], { 'drift-monitor': 'missing' });
    const out = await computeVerdicts(dir, { run: r.runId, sandbox, now });
    assert.deepEqual(out.rows['drift-monitor'].legal, ['rebuild', 'use', 'skip']);
    assert.equal(out.rows['drift-monitor'].needs_probe, true);
    assert.deepEqual(out.needs_probe, ['drift-monitor']);
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now }), (e) => e instanceof PolicyRefused && /probe/.test(e.message));
    const p = await recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'found', evidence: 'src/drift.js:40 posts to telemetry.example.com', now });
    assert.deepEqual(p.legal, ['rebuild', 'skip']);
    assert.equal(p.needs_probe, false);
    const vj = await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'verdicts.json'));
    assert.equal(vj.rows['drift-monitor'].probe.result, 'found');
    assert.match(vj.rows['drift-monitor'].probe.evidence, /telemetry/);
    assert.ok(vj.rows['drift-monitor'].removed.some(x => x.verdict === 'use' && /found/.test(x.reason)));
    await assert.rejects(() => recordProbe(dir, { run: r.runId, power: 'nope', result: 'clean', now }), /unknown power "nope"/);
    await assert.rejects(() => recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'maybe', now }), /clean\|found\|incomplete/);
    await assert.rejects(() => recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'clean', now }), /already probed.*--force/);
  });

  it('recordDecisions accepts only legal verdicts (PolicyRefused otherwise), writes labels (approve 1 / skip 0), and appends the registry row when every power is decided', async () => {
    const r = await prepared('v5', [power(), power({ name: 'exporter', licence: 'Commercial', what: 'exports data', idea: 'csv dump' }), power({ name: 'dup', what: 'review agents', idea: 'full review' })], { 'drift-monitor': 'missing', exporter: 'missing', dup: { status: 'have', tool: 'command:.claude/commands/.shortcuts/w-review.md', why: 'same thing' } });
    await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    assert.equal(await lookupSource(dir, r.identity), null, 'nothing in the registry before the decisions');
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now }), (e) => e instanceof PolicyRefused && e.code === 'POLICY_REFUSED' && /use.*not legal.*drift-monitor/.test(e.message));
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ exporter: 'build' }), now }), /rebuild\|use\|buy\|skip/);
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ nope: 'skip' }), now }), /unknown power "nope"/);
    const one = await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'rebuild' }), now });
    assert.equal(one.decided, 1);
    assert.deepEqual(one.remaining.sort(), ['dup', 'exporter']);
    assert.equal(one.next, 'verdict');
    assert.equal(one.registry_written, false);
    const rest = await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ decisions: { exporter: 'buy', dup: 'skip' } }), now });
    assert.equal(rest.decided, 3);
    assert.deepEqual(rest.remaining, []);
    assert.equal(rest.next, 'handoff');
    assert.equal(rest.registry_written, true);
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    const labels = await readJsonl(path.join(runDir, 'labels.jsonl'));
    assert.deepEqual(labels.map(l => [l.power, l.verdict, l.label]), [['drift-monitor', 'rebuild', 1], ['exporter', 'buy', 1], ['dup', 'skip', 0]]);
    assert.ok(labels.every(l => l.run === r.runId && l.ts));
    const reg = await lookupSource(dir, r.identity);
    assert.equal(reg.run, r.runId);
    assert.equal(reg.type, 'paste');
    assert.equal(reg.powers, 3);
    assert.deepEqual(reg.decisions, { 'drift-monitor': 'rebuild', exporter: 'buy', dup: 'skip' });
    const status = await fs.readFile(path.join(runDir, 'status.md'), 'utf-8');
    assert.match(status, /- Next: `cli\.js handoff`/);
    assert.match(status, /- Summary: found=3 approved=2 skipped=1 buy=1 marathon=none/);
  });

  it('a decision cannot be changed without force; with force the label row is appended again and the registry row is appended anew', async () => {
    const r = await prepared('v6', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'rebuild' }), now });
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'skip' }), now }), /already decided.*--force/);
    const out = await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'skip' }), now, force: true });
    assert.equal(out.decided, 1);
    const labels = await readJsonl(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'labels.jsonl'));
    assert.deepEqual(labels.map(l => l.label), [1, 0], 'labels are append-only history');
    assert.deepEqual((await lookupSource(dir, r.identity)).decisions, { 'drift-monitor': 'skip' });
  });

  it('computeVerdicts re-run keeps existing probes and decisions unless force', async () => {
    const r = await prepared('v7', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    await recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'clean', now });
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, sandbox });
    const again = await computeVerdicts(dir, { run: r.runId, sandbox, now });
    assert.equal(again.rows['drift-monitor'].probe.result, 'clean');
    assert.equal(again.rows['drift-monitor'].decision, 'use');
    const reset = await computeVerdicts(dir, { run: r.runId, sandbox, now, force: true });
    assert.equal(reset.rows['drift-monitor'].probe, null);
    assert.equal(reset.rows['drift-monitor'].decision, null);
    assert.equal(reset.dropped.probes, 1);
    assert.equal(reset.dropped.decisions, 1);
  });
});

describe('verdict — cli verb', () => {
  let dir;
  function run(cwd, args, input, env = {}) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input, env: { ...process.env, ...env } });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-vcli-'));
    await makeHarness(dir);
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
    run(dir, ['intake', '-', '--slug', 'c1'], 'a tool');
    run(dir, ['inventory', '--from', '-'], JSON.stringify([power()]));
    run(dir, ['map']);
    run(dir, ['map', '--from', '-'], JSON.stringify({ 'drift-monitor': 'missing' }));
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('usage lists verdict with [--table | --probe <power>=<result> [--evidence <t>] | --decide <power>=<verdict> | --from <file|->] [--force]; BBS_SANDBOX overrides detection', () => {
    const u = run(dir, ['nope']);
    assert.match(u.err, /cli\.js verdict \[--table \| --probe <power>=<clean\|found\|incomplete> \[--evidence <text>\] \| --decide <power>=<verdict> \| --from <file\|->\] \[--force\] \[--run <id>\] \[--project <dir>\]/);
    assert.match(u.err, /usage: cli\.js <intake\|fetch\|inventory\|map\|verdict\|status\|report> \.\.\./);
    const v = run(dir, ['verdict'], undefined, { BBS_SANDBOX: 'absent' });
    assert.equal(v.code, 0, v.err);
    assert.equal(v.json.sandbox.present, false);
    assert.deepEqual(v.json.rows['drift-monitor'].legal, ['rebuild', 'skip']);
    assert.equal(v.json.next, 'verdict');
    const t = run(dir, ['verdict', '--table']);
    assert.equal(t.code, 0, t.err);
    assert.equal(t.json, null);
    assert.match(t.out, /^\| Power \| Harness \|/m);
  });

  it('an illegal decision exits 2 with `bbs: refused:`; a legal one records and moves next to handoff; --decide and --from are exclusive', () => {
    const bad = run(dir, ['verdict', '--decide', 'drift-monitor=use']);
    assert.equal(bad.code, 2);
    assert.match(bad.err, /^bbs: refused: .*use.*not legal/);
    const both = run(dir, ['verdict', '--decide', 'drift-monitor=skip', '--from', 'x']);
    assert.equal(both.code, 1);
    const malformed = run(dir, ['verdict', '--decide', 'drift-monitor']);
    assert.equal(malformed.code, 1);
    assert.match(malformed.err, /<power>=<verdict>/);
    const ok = run(dir, ['verdict', '--decide', 'drift-monitor=rebuild']);
    assert.equal(ok.code, 0, ok.err);
    assert.equal(ok.json.decided, 1);
    assert.equal(ok.json.next, 'handoff');
    assert.equal(ok.json.registry_written, true);
    assert.equal(run(dir, ['status', '--next']).out.trim(), 'handoff');
    assert.equal(run(dir, ['report']).out.trim(), 'found=1 approved=1 skipped=0 buy=0 marathon=none');
  });

  it('--probe records a probe result with evidence; a probe on an unknown power exits 1; positionals are rejected', () => {
    const p = run(dir, ['verdict', '--probe', 'drift-monitor=clean', '--evidence', 'read every file: no sockets, no http clients', '--force']);
    assert.equal(p.code, 0, p.err);
    assert.equal(p.json.probe.result, 'clean');
    const unk = run(dir, ['verdict', '--probe', 'nope=clean']);
    assert.equal(unk.code, 1);
    assert.match(unk.err, /unknown power "nope"/);
    const pos = run(dir, ['verdict', 'extra']);
    assert.equal(pos.code, 1);
    assert.match(pos.err, /unexpected argument "extra"/);
  });

  it('a second intake of the same content is known and reuses the verdicts run', () => {
    const again = run(dir, ['intake', '-', '--slug', 'c2'], 'a tool');
    assert.equal(again.code, 0, again.err);
    assert.equal(again.json.known, true);
    assert.match(again.json.reuse_from, /-c1$/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Review r1 (ff26cdf4) regressions: grouped SPDX expressions, BBS_SANDBOX, sandbox.required_for_use, probe evidence,
// and the input shapes and switches the contract names.

describe('verdict r1 — SPDX expressions with precedence and grouping', () => {
  const cfg = DEFAULT_CONFIG;
  it('a parenthesised OR beside an AND binds as a group: strictest of AND, most permissive of OR', () => {
    assert.equal(licenceClass('(MIT OR Apache-2.0) AND Proprietary', cfg), 'commercial');
    assert.equal(licenceClass('(MIT OR GPL-3.0) AND BUSL-1.1', cfg), 'commercial');
    assert.equal(licenceClass('GPL-3.0 AND (MIT OR Apache-2.0)', cfg), 'copyleft');
  });

  it('nested groups evaluate over the tree; AND binds tighter than OR without parentheses', () => {
    assert.equal(licenceClass('((MIT OR GPL-3.0) AND (Apache-2.0 OR BSD-3-Clause)) OR Proprietary', cfg), 'permissive');
    assert.equal(licenceClass('((MIT OR GPL-3.0) AND (GPL-2.0 OR Proprietary)) OR BUSL-1.1', cfg), 'copyleft');
    assert.equal(licenceClass('((MIT AND GPL-3.0) OR (Proprietary AND MIT))', cfg), 'copyleft');
    assert.equal(licenceClass('MIT OR GPL-3.0 AND Proprietary', cfg), 'permissive', 'MIT OR (GPL-3.0 AND Proprietary)');
    assert.equal(licenceClass('Proprietary AND MIT OR GPL-3.0', cfg), 'copyleft', '(Proprietary AND MIT) OR GPL-3.0');
  });

  it('unbalanced parentheses or a parse error → none; OR/AND are case-insensitive; WITH <exception> is ignored', () => {
    for (const bad of ['(MIT', 'MIT)', '(MIT OR Apache-2.0', 'MIT OR', 'AND MIT', 'MIT AND AND GPL-3.0', '()', 'MIT GPL-3.0', 'MIT WITH', 'MIT OR (', 'MIT, Apache-2.0']) {
      assert.equal(licenceClass(bad, cfg), 'none', bad);
    }
    assert.equal(licenceClass('mit or gpl-3.0', cfg), 'permissive');
    assert.equal(licenceClass('Proprietary and MIT', cfg), 'commercial');
    assert.equal(licenceClass('GPL-2.0-only WITH Classpath-exception-2.0', cfg), 'copyleft');
    assert.equal(licenceClass('(GPL-2.0-or-later WITH Classpath-exception-2.0) OR MIT', cfg), 'permissive');
    assert.equal(licenceClass('Apache-2.0 WITH LLVM-exception AND Proprietary', cfg), 'commercial');
    assert.equal(licenceClass('(MIT OR Apache-2.0) AND All Rights Reserved', cfg), 'commercial', '"all rights reserved" anywhere is commercial');
  });

  it('a none part: ignored under OR unless all parts are none; under AND it makes the AND none unless another part is copyleft or commercial', () => {
    assert.equal(licenceClass('WTFPL OR GPL-3.0', cfg), 'copyleft');
    assert.equal(licenceClass('WTFPL OR Foo-1.0', cfg), 'none');
    assert.equal(licenceClass('MIT AND WTFPL', cfg), 'none');
    assert.equal(licenceClass('GPL-3.0 AND WTFPL', cfg), 'copyleft');
    assert.equal(licenceClass('WTFPL AND Proprietary', cfg), 'commercial');
  });

  it('a grouped licence with a binding proprietary term never makes `use` legal', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-vspdx-'));
    try {
      await makeHarness(d);
      const r = await intake(d, '-', { stdin: 'spdx tool', now, slug: 'spdx' });
      await writeInventory(d, { run: r.runId, input: JSON.stringify([power({ licence: '(MIT OR Apache-2.0) AND Proprietary' })]), now });
      await buildMap(d, { run: r.runId, now });
      await recordJudgments(d, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now });
      const out = await computeVerdicts(d, { run: r.runId, sandbox, now });
      assert.equal(out.rows['drift-monitor'].licence_class, 'commercial');
      assert.deepEqual(out.rows['drift-monitor'].legal, ['rebuild', 'buy', 'skip']);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
});

describe('verdict r1 — library: sandbox.required_for_use, probe evidence, probe --force clearing a decision', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-vr1-')); await makeHarness(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const runDir = (id) => path.join(dir, '.claude', 'bbs', 'runs', id);
  const CFG_WARNING = 'sandbox.required_for_use=false in .claude/bbs.json is ignored — use always requires a sandbox';

  async function prepared(slug, powers, judgments) {
    const r = await intake(dir, '-', { stdin: 'r1 tool ' + slug, now, slug });
    await writeInventory(dir, { run: r.runId, input: JSON.stringify(powers), now });
    await buildMap(dir, { run: r.runId, now });
    await recordJudgments(dir, { run: r.runId, input: JSON.stringify(judgments), now });
    return r;
  }

  it('legalVerdicts ignores a requireSandbox:false option: use always needs a present sandbox', () => {
    const r = legalVerdicts(power(), { judgment: { status: 'missing' }, licenceClass: 'permissive', sandbox: noSandbox, probe: 'clean', requireSandbox: false });
    assert.deepEqual(r.legal, ['rebuild', 'skip']);
    assert.match(r.removed[0].reason, /no sandbox/i);
  });

  it('sandbox.required_for_use:false in the config still removes `use` without a sandbox and records a warning naming .claude/bbs.json', async () => {
    const r = await prepared('rfu', [power()], { 'drift-monitor': 'missing' });
    const cfg = { ...DEFAULT_CONFIG, sandbox: { required_for_use: false } };
    const out = await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now, cfg });
    assert.deepEqual(out.rows['drift-monitor'].legal, ['rebuild', 'skip']);
    assert.ok(out.rows['drift-monitor'].removed.some(x => x.verdict === 'use' && /no sandbox/i.test(x.reason)));
    assert.deepEqual(out.warnings, [CFG_WARNING]);
    assert.ok(out.warning.includes(CFG_WARNING));
    await recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'clean', now, cfg });
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, cfg }), (e) => e instanceof PolicyRefused);
    const plain = await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    assert.equal(plain.warnings, undefined, 'the default config records no warning');
  });

  it('probe evidence is stripped of control characters, URL credentials and token values are redacted, and it is capped at 2048 chars', async () => {
    const r = await prepared('evid', [power(), power({ name: 'b' }), power({ name: 'c' })], { 'drift-monitor': 'missing', b: 'missing', c: 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    const p = await recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'found', evidence: 'src/a.js:3 posts to https://u:p@h/x?token=abc\x07\x1b[31m and\nline two', now });
    const vj = await readJson(path.join(runDir(r.runId), 'verdicts.json'));
    for (const ev of [p.probe.evidence, vj.rows['drift-monitor'].probe.evidence]) {
      assert.ok(!ev.includes('abc'), ev);
      assert.ok(!ev.includes('u:p'), ev);
      assert.ok(!/[\x00-\x09\x0b-\x1f\x7f]/.test(ev), 'no control characters except \\n');
      assert.match(ev, /https:\/\/h\/x\?token=<redacted>/);
      assert.match(ev, /and\nline two$/);
    }
    const atCap = await recordProbe(dir, { run: r.runId, power: 'b', result: 'found', evidence: 'a'.repeat(2048), now });
    assert.equal(atCap.probe.evidence, 'a'.repeat(2048), 'N = 2048 is kept whole');
    const over = await recordProbe(dir, { run: r.runId, power: 'c', result: 'found', evidence: 'a'.repeat(2049), now });
    assert.equal(over.probe.evidence, 'a'.repeat(2048) + ' …[truncated]', 'N + 1 is truncated');
  });

  it('probe --force clean → found clears a recorded `use` decision with a warning; labels.jsonl is append-only history: the old rows stay and exactly one withdrawal row is added', async () => {
    const r = await prepared('clr', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    await recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'clean', now });
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, sandbox });
    const labelsFile = path.join(runDir(r.runId), 'labels.jsonl');
    const labelsBefore = await fs.readFile(labelsFile);
    await assert.rejects(() => recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'found', now }), /already probed.*--force/);
    const p = await recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'found', evidence: 'opens a socket', now, force: true });
    assert.match(p.warning, /decision use for drift-monitor is no longer legal and was cleared/);
    assert.equal(p.decision, null);
    const vj = await readJson(path.join(runDir(r.runId), 'verdicts.json'));
    assert.equal(vj.rows['drift-monitor'].decision, null);
    assert.deepEqual(vj.decisions, {});
    assert.deepEqual(vj.rows['drift-monitor'].legal, ['rebuild', 'skip']);
    // r2 decision (lead, 2026-10-07): labels are the router's training data, so a withdrawn verdict must be on record.
    const after = await fs.readFile(labelsFile);
    assert.ok(after.subarray(0, labelsBefore.length).equals(labelsBefore), 'previous label rows are untouched');
    const added = after.toString('utf-8').slice(labelsBefore.length).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.equal(added.length, 1, 'exactly one row appended');
    assert.equal(added[0].power, 'drift-monitor');
    assert.equal(added[0].verdict, null);
    assert.equal(added[0].label, null);
    assert.equal(added[0].withdrawn, 'use');
    assert.match(added[0].reason, /found/);
    assert.equal(added[0].run, r.runId);
    assert.ok(added[0].ts);
  });
});

describe('verdict r1 — cli verb input shapes and switches', () => {
  const dirs = [];
  after(async () => { for (const d of dirs) await fs.rm(d, { recursive: true, force: true }); });
  function cli(d, args, input, env = {}) {
    const base = { ...process.env };
    delete base.BBS_SANDBOX;
    const r = spawnSync(process.execPath, [CLI, ...args, '--project', d], { cwd: d, encoding: 'utf-8', input, env: { ...base, ...env } });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  async function project(slug, powers, judgments, { compute = true, sb = noSandbox } = {}) {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-vr1cli-'));
    dirs.push(d);
    await makeHarness(d);
    const r = await intake(d, '-', { stdin: 'cli tool ' + slug, now, slug });
    await writeInventory(d, { run: r.runId, input: JSON.stringify(powers), now });
    await buildMap(d, { run: r.runId, now });
    await recordJudgments(d, { run: r.runId, input: JSON.stringify(judgments), now });
    if (compute) await computeVerdicts(d, { run: r.runId, sandbox: sb, now });
    const rd = path.join(d, '.claude', 'bbs', 'runs', r.runId);
    return { d, run: r.runId, verdicts: path.join(rd, 'verdicts.json'), labels: path.join(rd, 'labels.jsonl') };
  }
  const SANDBOX_ONLY_ABSENT = 'bbs: BBS_SANDBOX may only be "absent" (the sandbox can be assumed missing, never present); unset it to run real detection';

  it('BBS_SANDBOX=present (or any value but absent) exits 1 naming the rule; absent overrides detection with a stderr warning', async () => {
    const p = await project('env', [power()], { 'drift-monitor': 'missing' }, { compute: false });
    for (const v of ['present', 'yes', 'PRESENT']) {
      for (const args of [['verdict'], ['verdict', '--table'], ['verdict', '--table', '--force']]) {
        const r = cli(p.d, [...args, '--run', p.run], undefined, { BBS_SANDBOX: v });
        assert.equal(r.code, 1, `${v} ${args.join(' ')}`);
        assert.equal(r.err.trim(), SANDBOX_ONLY_ABSENT);
      }
    }
    await assert.rejects(() => fs.stat(p.verdicts), { code: 'ENOENT' }, 'a refused BBS_SANDBOX writes nothing');
    const a = cli(p.d, ['verdict', '--run', p.run], undefined, { BBS_SANDBOX: 'absent' });
    assert.equal(a.code, 0, a.err);
    assert.match(a.err, /^bbs: warning: sandbox detection overridden by BBS_SANDBOX=absent$/m);
    assert.equal(a.json.sandbox.present, false);
    assert.deepEqual(a.json.rows['drift-monitor'].legal, ['rebuild', 'skip']);
  });

  it('sandbox.required_for_use:false in .claude/bbs.json is ignored with a stderr warning naming the file', async () => {
    const p = await project('rfu', [power()], { 'drift-monitor': 'missing' }, { compute: false });
    await fs.writeFile(path.join(p.d, '.claude', 'bbs.json'), JSON.stringify({ sandbox: { required_for_use: false } }));
    const r = cli(p.d, ['verdict', '--run', p.run], undefined, { BBS_SANDBOX: 'absent' });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.rows['drift-monitor'].legal, ['rebuild', 'skip']);
    assert.match(r.err, /bbs: warning: .*sandbox\.required_for_use=false in \.claude\/bbs\.json is ignored — use always requires a sandbox/);
  });

  it('--from <file>, --from - (stdin) and a missing --from file', async () => {
    const p = await project('from', [power(), power({ name: 'b' })], { 'drift-monitor': 'missing', b: 'missing' });
    const file = path.join(p.d, 'decisions.json');
    await fs.writeFile(file, JSON.stringify({ 'drift-monitor': 'rebuild' }));
    const f = cli(p.d, ['verdict', '--from', file, '--run', p.run]);
    assert.equal(f.code, 0, f.err);
    assert.equal(f.json.decided, 1);
    assert.deepEqual(f.json.remaining, ['b']);
    const missing = path.join(p.d, 'nope.json');
    const m = cli(p.d, ['verdict', '--from', missing, '--run', p.run]);
    assert.equal(m.code, 1);
    assert.equal(m.err.trim(), `bbs: file not found: ${missing}`);
    const s = cli(p.d, ['verdict', '--from', '-', '--run', p.run], JSON.stringify({ decisions: { b: 'skip' } }));
    assert.equal(s.code, 0, s.err);
    assert.equal(s.json.decided, 2);
    assert.equal(s.json.next, 'handoff');
    const labels = await readJsonl(p.labels);
    assert.deepEqual(labels.map(l => [l.power, l.verdict]), [['drift-monitor', 'rebuild'], ['b', 'skip']]);
    const badStdin = cli(p.d, ['verdict', '--from', '-', '--run', p.run, '--force'], 'not json');
    assert.equal(badStdin.code, 1);
    assert.match(badStdin.err, /--from - \(stdin\)/);
  });

  it('--evidence without --probe is a usage error (exit 1)', async () => {
    const p = await project('ev', [power()], { 'drift-monitor': 'missing' });
    const before = await fs.readFile(p.verdicts);
    const r = cli(p.d, ['verdict', '--evidence', 'x', '--run', p.run]);
    assert.equal(r.code, 1);
    assert.match(r.err, /^usage: cli\.js verdict/);
    assert.match(r.err, /--evidence goes with --probe/);
    assert.ok((await fs.readFile(p.verdicts)).equals(before));
  });

  it('--table after a probe changed legality shows the new legal set; --table --force recomputes', async () => {
    const p = await project('tbl', [power()], { 'drift-monitor': 'missing' }, { sb: sandbox });
    const t0 = cli(p.d, ['verdict', '--table', '--run', p.run]);
    assert.equal(t0.code, 0, t0.err);
    assert.match(t0.out, /\| drift-monitor \| missing \| MIT \(permissive\) \| rebuild, use, skip \|/);
    const pr = cli(p.d, ['verdict', '--probe', 'drift-monitor=found', '--evidence', 'posts to https://u:p@h/x?token=abc', '--run', p.run]);
    assert.equal(pr.code, 0, pr.err);
    assert.ok(!pr.out.includes('abc') && !pr.out.includes('u:p'), 'printed evidence is redacted');
    assert.ok(!(await fs.readFile(p.verdicts, 'utf-8')).includes('abc'), 'stored evidence is redacted');
    const t1 = cli(p.d, ['verdict', '--table', '--run', p.run]);
    assert.equal(t1.code, 0, t1.err);
    assert.match(t1.out, /\| drift-monitor \| missing \| MIT \(permissive\) \| rebuild, skip \| rebuild \| — \| use removed: network probe found/);
    const t2 = cli(p.d, ['verdict', '--table', '--force', '--run', p.run], undefined, { BBS_SANDBOX: 'absent' });
    assert.equal(t2.code, 0, t2.err);
    assert.match(t2.out, /\| rebuild, skip \| rebuild \| — \| use removed: no sandbox on this machine: BBS_SANDBOX=absent \|/);
    assert.ok(!/probe found/.test(t2.out), '--force dropped the probe and recomputed');
    assert.equal((await readJson(p.verdicts)).rows['drift-monitor'].probe, null);
  });

  it('a refused --decide (and a refused --from with one illegal entry) leaves verdicts.json and labels.jsonl byte-identical', async () => {
    const p = await project('ref', [power(), power({ name: 'b' })], { 'drift-monitor': 'missing', b: 'missing' });
    assert.equal(cli(p.d, ['verdict', '--decide', 'b=skip', '--run', p.run]).code, 0);
    const vBefore = await fs.readFile(p.verdicts);
    const lBefore = await fs.readFile(p.labels);
    const r = cli(p.d, ['verdict', '--decide', 'drift-monitor=use', '--run', p.run]);
    assert.equal(r.code, 2);
    assert.match(r.err, /^bbs: refused: /);
    const file = path.join(p.d, 'mixed.json');
    await fs.writeFile(file, JSON.stringify({ 'drift-monitor': 'rebuild', b: 'buy' }));
    const m = cli(p.d, ['verdict', '--from', file, '--force', '--run', p.run]);
    assert.equal(m.code, 2);
    assert.ok((await fs.readFile(p.verdicts)).equals(vBefore), 'verdicts.json byte-identical');
    assert.ok((await fs.readFile(p.labels)).equals(lBefore), 'labels.jsonl byte-identical');
  });
});

describe('verdict r1 — cli --table that recomputes names ignored config on stderr', () => {
  it('--table --force with sandbox.required_for_use:false prints the table and the warning', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-vr1tbl-'));
    try {
      await makeHarness(d);
      const r = await intake(d, '-', { stdin: 'tbl tool', now, slug: 'tblw' });
      await writeInventory(d, { run: r.runId, input: JSON.stringify([power()]), now });
      await buildMap(d, { run: r.runId, now });
      await recordJudgments(d, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now });
      await fs.writeFile(path.join(d, '.claude', 'bbs.json'), JSON.stringify({ sandbox: { required_for_use: false } }));
      const env = { ...process.env, BBS_SANDBOX: 'absent' };
      const t = spawnSync(process.execPath, [CLI, 'verdict', '--table', '--force', '--run', r.runId, '--project', d], { cwd: d, encoding: 'utf-8', env });
      assert.equal(t.status, 0, t.stderr);
      assert.match(t.stdout, /\| drift-monitor \| missing \| MIT \(permissive\) \| rebuild, skip \|/);
      assert.match(t.stderr, /bbs: warning: .*sandbox\.required_for_use=false in \.claude\/bbs\.json is ignored/);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Review r2 (e152092e) regressions: cleared decisions vs the registry, idempotent repair of failed appends,
// inventory --force under map.lock + powers_ts, corrupt verdicts.json, sandbox reasons, duplicate keys.

describe('verdict r2 — registry, repair, powers_ts, corrupt verdicts.json, duplicate keys', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-vr2-')); await makeHarness(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const runDir = (id) => path.join(dir, '.claude', 'bbs', 'runs', id);
  const REPAIR = 're-run cli.js verdict --from <same file> to append the missing rows';
  const registryRows = async (identity) => (await readJsonl(registryPath(dir))).filter(x => x.identity === identity);

  async function prepared(slug, powers, judgments) {
    const r = await intake(dir, '-', { stdin: 'r2 tool ' + slug, now, slug });
    await writeInventory(dir, { run: r.runId, input: JSON.stringify(powers), now });
    await buildMap(dir, { run: r.runId, now });
    await recordJudgments(dir, { run: r.runId, input: JSON.stringify(judgments), now });
    return r;
  }

  it('a probe --force that clears a recorded decision appends a superseding registry row (cleared power → null, complete: false)', async () => {
    const r = await prepared('clrreg', [power(), power({ name: 'b' })], { 'drift-monitor': 'missing', b: 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    await recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'clean', now });
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use', b: 'rebuild' }), now, sandbox });
    const full = await lookupSource(dir, r.identity);
    assert.deepEqual(full.decisions, { 'drift-monitor': 'use', b: 'rebuild' });
    assert.equal(full.complete, true);
    await recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'found', now, force: true });
    const latest = await lookupSource(dir, r.identity);
    assert.equal(latest.run, r.runId);
    assert.equal(latest.decisions['drift-monitor'], null);
    assert.equal(latest.decisions.b, 'rebuild');
    assert.equal(latest.complete, false);
    assert.equal(latest.type, full.type);
    assert.equal(latest.powers, 2);
    // nothing changed since: a recompute appends no further row
    const n = (await registryRows(r.identity)).length;
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    assert.equal((await registryRows(r.identity)).length, n);
  });

  it('a recompute after the sandbox disappears clears `use` and supersedes the registry row; a failed append warns and the next recompute appends it', async () => {
    const r = await prepared('clrsb', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    await recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'clean', now });
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, sandbox });
    const failing = async () => { throw new Error('disk full'); };
    const out = await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now, appendRegistryImpl: failing });
    assert.equal(out.rows['drift-monitor'].decision, null);
    assert.match(out.warning, /registry row could not be written: disk full — re-run cli\.js verdict to append it/);
    assert.equal((await lookupSource(dir, r.identity)).decisions['drift-monitor'], 'use', 'the failed append left the old row latest');
    await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    const latest = await lookupSource(dir, r.identity);
    assert.equal(latest.decisions['drift-monitor'], null);
    assert.equal(latest.complete, false);
  });

  it('every clearing path appends one withdrawal label naming the cause: sandbox gone, --force, corrupt file replaced; a retry appends nothing more', async () => {
    const withdrawals = async (id) => (await readJsonl(path.join(runDir(id), 'labels.jsonl'))).filter(l => l.withdrawn != null);
    // sandbox disappears
    const a = await prepared('wsb', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: a.runId, sandbox, now });
    await recordProbe(dir, { run: a.runId, power: 'drift-monitor', result: 'clean', now });
    await recordDecisions(dir, { run: a.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, sandbox });
    await computeVerdicts(dir, { run: a.runId, sandbox: noSandbox, now });
    let w = await withdrawals(a.runId);
    assert.equal(w.length, 1);
    assert.deepEqual({ ...w[0], reason: undefined }, { run: a.runId, power: 'drift-monitor', verdict: null, label: null, withdrawn: 'use', reason: undefined, ts: w[0].ts });
    assert.match(w[0].reason, /no sandbox on this machine/);
    await computeVerdicts(dir, { run: a.runId, sandbox: noSandbox, now });
    assert.equal((await withdrawals(a.runId)).length, 1, 'a recompute does not withdraw twice');
    // --force drops a legal decision
    const b = await prepared('wforce', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: b.runId, sandbox: noSandbox, now });
    await recordDecisions(dir, { run: b.runId, input: JSON.stringify({ 'drift-monitor': 'skip' }), now });
    await computeVerdicts(dir, { run: b.runId, sandbox: noSandbox, now, force: true });
    w = await withdrawals(b.runId);
    assert.equal(w.length, 1);
    assert.equal(w[0].withdrawn, 'skip');
    assert.match(w[0].reason, /forced recompute/);
    // re-deciding after a withdrawal records a fresh label (the withdrawal counts as no label)
    await recordDecisions(dir, { run: b.runId, input: JSON.stringify({ 'drift-monitor': 'skip' }), now });
    assert.deepEqual((await readJsonl(path.join(runDir(b.runId), 'labels.jsonl'))).map(l => [l.verdict, l.withdrawn ?? null]), [['skip', null], [null, 'skip'], ['skip', null]]);
    // corrupt verdicts.json replaced
    const c = await prepared('wcorrupt', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: c.runId, sandbox: noSandbox, now });
    await recordDecisions(dir, { run: c.runId, input: JSON.stringify({ 'drift-monitor': 'rebuild' }), now });
    await fs.writeFile(path.join(runDir(c.runId), 'verdicts.json'), '{ broken');
    await computeVerdicts(dir, { run: c.runId, sandbox: noSandbox, now, force: true });
    w = await withdrawals(c.runId);
    assert.equal(w.length, 1);
    assert.equal(w[0].withdrawn, 'rebuild');
    assert.match(w[0].reason, /corrupt/);
  });

  it('a failed withdrawal append is a warning and the next recompute appends it once; a decision with no label row behind it is not withdrawn', async () => {
    const r = await prepared('wfail', [power(), power({ name: 'b' })], { 'drift-monitor': 'missing', b: 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    const noLabelForB = async (file, row) => { if (row.power === 'b') throw new Error('EIO'); return appendJsonl(file, row); };
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'rebuild', b: 'skip' }), now, appendLabel: noLabelForB });
    const failing = async () => { throw new Error('disk full'); };
    const out = await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now, force: true, appendLabel: failing });
    assert.match(out.warning, /withdrawal label could not be written to labels\.jsonl for drift-monitor \(disk full\) — re-run cli\.js verdict to append it/);
    const labelsFile = path.join(runDir(r.runId), 'labels.jsonl');
    assert.equal((await readJsonl(labelsFile)).filter(l => l.withdrawn != null).length, 0);
    await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    const w = (await readJsonl(labelsFile)).filter(l => l.withdrawn != null);
    assert.deepEqual(w.map(l => [l.power, l.withdrawn]), [['drift-monitor', 'rebuild']], 'b had no label row: nothing to withdraw');
    assert.match(w[0].reason, /no longer recorded in verdicts\.json/);
  });

  it('a failed registry append is repaired by resubmitting the same decisions: the row is written once, labels are not duplicated', async () => {
    const r = await prepared('repreg', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    let calls = 0;
    const throwOnce = async (...args) => { if (calls++ === 0) throw new Error('EACCES registry'); return appendRegistry(...args); };
    const input = JSON.stringify({ 'drift-monitor': 'rebuild' });
    const first = await recordDecisions(dir, { run: r.runId, input, now, appendRegistryImpl: throwOnce });
    assert.equal(first.registry_written, false);
    assert.ok(first.warning.includes(`registry row could not be written: EACCES registry — ${REPAIR}`), first.warning);
    assert.equal(await lookupSource(dir, r.identity), null);
    const retry = await recordDecisions(dir, { run: r.runId, input, now, appendRegistryImpl: throwOnce });
    assert.equal(retry.registry_written, true);
    assert.equal(retry.warning, undefined);
    assert.deepEqual((await lookupSource(dir, r.identity)).decisions, { 'drift-monitor': 'rebuild' });
    const again = await recordDecisions(dir, { run: r.runId, input, now });
    assert.equal(again.registry_written, false, 'nothing missing: nothing appended');
    assert.equal((await registryRows(r.identity)).length, 1);
    assert.equal((await readJsonl(path.join(runDir(r.runId), 'labels.jsonl'))).length, 1);
    // a resubmission with --force of the same decision duplicates nothing either
    await recordDecisions(dir, { run: r.runId, input, now, force: true });
    assert.equal((await registryRows(r.identity)).length, 1);
    assert.equal((await readJsonl(path.join(runDir(r.runId), 'labels.jsonl'))).length, 1);
  });

  it('a failed label append is repaired by resubmitting the same decisions: only the missing label row is appended', async () => {
    const r = await prepared('replab', [power(), power({ name: 'b' })], { 'drift-monitor': 'missing', b: 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    let calls = 0;
    const throwOnceForB = async (file, row) => { if (row.power === 'b' && calls++ === 0) throw new Error('EIO labels'); return appendJsonl(file, row); };
    const input = JSON.stringify({ 'drift-monitor': 'rebuild', b: 'skip' });
    const first = await recordDecisions(dir, { run: r.runId, input, now, appendLabel: throwOnceForB });
    assert.ok(first.warning.includes(`label for b could not be written to labels.jsonl: EIO labels — ${REPAIR}`), first.warning);
    assert.equal(first.registry_written, true);
    const labelsFile = path.join(runDir(r.runId), 'labels.jsonl');
    assert.deepEqual((await readJsonl(labelsFile)).map(l => l.power), ['drift-monitor']);
    const retry = await recordDecisions(dir, { run: r.runId, input, now, appendLabel: throwOnceForB });
    assert.equal(retry.warning, undefined);
    assert.equal(retry.registry_written, false);
    assert.deepEqual((await readJsonl(labelsFile)).map(l => [l.power, l.verdict, l.label]), [['drift-monitor', 'rebuild', 1], ['b', 'skip', 0]]);
    assert.equal((await registryRows(r.identity)).length, 1);
    // a different verdict for a decided power is still refused without --force
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ b: 'rebuild' }), now }), /b already decided — pass --force to change it/);
  });

  it('inventory --force waits for no one: it refuses while map.lock is held and moves nothing aside', async () => {
    const r = await prepared('lock', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    const rd = runDir(r.runId);
    const powersBefore = await fs.readFile(path.join(rd, 'powers.json'));
    await fs.writeFile(path.join(rd, 'map.lock'), '1 someoneelse\n');
    await assert.rejects(() => writeInventory(dir, { run: r.runId, input: JSON.stringify([power({ name: 'z' })]), now, force: true }), /locked by another bbs command \(map\.lock\)/);
    assert.ok((await fs.readFile(path.join(rd, 'powers.json'))).equals(powersBefore), 'powers.json untouched');
    await fs.stat(path.join(rd, 'verdicts.json'));
    await fs.stat(path.join(rd, 'map.json'));
    await fs.rm(path.join(rd, 'map.lock'));
    const ok = await writeInventory(dir, { run: r.runId, input: JSON.stringify([power({ name: 'z' })]), now, force: true });
    assert.deepEqual([...ok.stale_moved].sort(), ['map.json', 'verdicts.json']);
    await assert.rejects(() => fs.stat(path.join(rd, 'map.lock')), { code: 'ENOENT' }, 'the lock is released');
  });

  it('verdicts.json stores powers_ts; recordProbe and recordDecisions refuse when powers.json changed since', async () => {
    const r = await prepared('pts', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    const rd = runDir(r.runId);
    const pj = await readJson(path.join(rd, 'powers.json'));
    assert.equal((await readJson(path.join(rd, 'verdicts.json'))).powers_ts, pj.ts);
    await fs.writeFile(path.join(rd, 'powers.json'), JSON.stringify({ ...pj, ts: '2026-10-07T13:00:00.000Z' }));
    const vBefore = await fs.readFile(path.join(rd, 'verdicts.json'));
    const MSG = { message: 'powers.json changed since the verdicts were computed — run cli.js verdict first' };
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'rebuild' }), now }), MSG);
    await assert.rejects(() => recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'clean', now }), MSG);
    assert.ok((await fs.readFile(path.join(rd, 'verdicts.json'))).equals(vBefore), 'verdicts.json byte-identical');
    await assert.rejects(() => fs.stat(path.join(rd, 'labels.jsonl')), { code: 'ENOENT' });
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    const vj = await readJson(path.join(rd, 'verdicts.json'));
    delete vj.powers_ts;
    await fs.writeFile(path.join(rd, 'verdicts.json'), JSON.stringify(vj));
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'rebuild' }), now }),
      { message: 'verdicts.json does not record which powers.json it was computed from (no powers_ts) — run cli.js verdict first' });
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    const ok = await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'rebuild' }), now });
    assert.equal(ok.decided, 1);
  });

  it('a corrupt verdicts.json: the hint names --force; --force moves it aside and reports dropped as unknown; an unreadable one is a plain error', async () => {
    const r = await prepared('corrupt', [power()], { 'drift-monitor': 'missing' });
    const rd = runDir(r.runId);
    await fs.writeFile(path.join(rd, 'verdicts.json'), '{ not json');
    await assert.rejects(() => computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now }), /corrupt JSON in .*verdicts\.json.* — pass --force to rebuild it \(probes and decisions are dropped\)/);
    const out = await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now, force: true });
    assert.deepEqual(out.dropped, { probes: null, decisions: null, corrupt_replaced: true });
    const aside = (await fs.readdir(rd)).filter(f => /^verdicts\.json\.stale-.*\.json$/.test(f));
    assert.equal(aside.length, 1);
    assert.equal(await fs.readFile(path.join(rd, aside[0]), 'utf-8'), '{ not json');
    assert.ok((await readJson(path.join(rd, 'verdicts.json'))).rows['drift-monitor']);
    const clean = await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now, force: true });
    assert.deepEqual(clean.dropped, { probes: 0, decisions: 0 }, 'a readable file still reports counts');
    await fs.rm(path.join(rd, 'verdicts.json'));
    await fs.mkdir(path.join(rd, 'verdicts.json'));
    for (const force of [false, true]) {
      await assert.rejects(() => computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now, force }), (e) => /EISDIR|illegal operation on a directory/.test(e.message) && !/--force/.test(e.message));
    }
  });

  it('a power named twice in the decisions input is refused naming the power; nothing is written', async () => {
    const r = await prepared('dup', [power(), power({ name: 'b' })], { 'drift-monitor': 'missing', b: 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox: noSandbox, now });
    const rd = runDir(r.runId);
    const vBefore = await fs.readFile(path.join(rd, 'verdicts.json'));
    for (const input of [
      '{"drift-monitor":"rebuild","drift-monitor":"skip"}',
      '{"decisions":{"drift-monitor":"skip","b":"skip","drift-monitor":"rebuild"}}',
      '```json\n{ "drift-monitor" : "rebuild" , "drift-monitor":"rebuild" }\n```',
      '{"drift-monitor":"rebuild","drift\\u002dmonitor":"skip"}'
    ]) {
      await assert.rejects(() => recordDecisions(dir, { run: r.runId, input, now }), { message: 'duplicate power "drift-monitor" in decisions' }, input);
    }
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: Buffer.from('{"b":"skip","b":"rebuild"}'), now, label: '--from d.json' }), { message: 'duplicate power "b" in --from d.json' });
    assert.ok((await fs.readFile(path.join(rd, 'verdicts.json'))).equals(vBefore));
    await assert.rejects(() => fs.stat(path.join(rd, 'labels.jsonl')), { code: 'ENOENT' });
    // distinct keys are not duplicates; an object input cannot carry one
    const ok = await recordDecisions(dir, { run: r.runId, input: '{"drift-monitor":"rebuild","b":"skip"}', now });
    assert.equal(ok.decided, 2);
  });
});

describe('verdict r2 — sandbox reasons', () => {
  const enoent = () => { throw Object.assign(new Error('spawnSync x ENOENT'), { code: 'ENOENT' }); };
  const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

  it('docker stderr in the reason is stripped of control characters and capped at SANDBOX_STDERR_MAX_CHARS (200)', async () => {
    assert.equal(SANDBOX_STDERR_MAX_CHARS, 200);
    // r4 decision (lead, 2026-10-07): only `docker info` fails here; `context inspect` is ENOENT (no contexts),
    // so a generic inspect failure can fail CLOSED without this test standing in the way.
    const dockerSays = (stderr) => detectSandbox({ exec: (cmd, args) => { if (cmd === 'docker' && args[0] === 'info') return { status: 1, stderr }; return enoent(); }, platform: 'darwin', env: {} });
    const dirty = await dockerSays('\u001b[31mCannot connect\u0007 to the daemon\u001b[0m\nsecond line');
    assert.ok(!CONTROL.test(dirty.reason), dirty.reason);
    assert.match(dirty.reason, /docker is not running \(\[31mCannot connect to the daemon\[0m\)/);
    const atCap = await dockerSays('e'.repeat(200));
    assert.ok(atCap.reason.includes(`(${'e'.repeat(200)})`), 'N = 200 is kept whole');
    const over = await dockerSays('e'.repeat(201));
    assert.ok(over.reason.includes(`(${'e'.repeat(200)} …[truncated])`), 'N + 1 is truncated');
    assert.ok(!over.reason.includes('e'.repeat(201)));
  });

  it('defaultExec spawns with stdin and stdout ignored and stderr piped, under the 5 s timeout', () => {
    const seen = [];
    const spawn = (cmd, args, opts) => { seen.push({ cmd, args, opts }); return { status: 0, stderr: '' }; };
    assert.deepEqual(defaultExec('docker', ['info'], { spawn }), { status: 0, stderr: '' });
    assert.deepEqual(seen[0].opts.stdio, ['ignore', 'ignore', 'pipe']);
    assert.equal(seen[0].opts.timeout, 5000);
    assert.throws(() => defaultExec('docker', ['info'], { spawn: () => ({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) }) }), { code: 'ENOENT' });
  });

  it('the unshare part of the reason says why: not installed, timed out, refused (first stderr line), or not linux', async () => {
    const withUnshare = (u) => detectSandbox({ exec: (cmd) => { if (cmd === 'docker') return enoent(); return u(); }, platform: 'linux' });
    assert.match((await withUnshare(enoent)).reason, /docker is not installed and unshare is not installed$/);
    assert.match((await withUnshare(() => { throw Object.assign(new Error('t'), { code: 'ETIMEDOUT' }); })).reason, /and unshare timed out \(5 s timeout\)$/);
    const refused = await withUnshare(() => ({ status: 1, stderr: 'unshare: unshare failed: Operation not permitted\u001b[0m\nline two' }));
    assert.match(refused.reason, /and unshare refused user namespaces \(unshare: unshare failed: Operation not permitted\[0m\)$/);
    assert.ok(!CONTROL.test(refused.reason));
    const mac = await detectSandbox({ exec: enoent, platform: 'darwin' });
    assert.match(mac.reason, /and unshare only counts on linux$/);
  });
});

describe('verdict r3 — a remote docker daemon is not a sandbox on this machine', () => {
  const enoent = () => { throw Object.assign(new Error('spawnSync x ENOENT'), { code: 'ENOENT' }); };
  const recorder = (inspectOut, { infoStatus = 0, inspectThrows = false } = {}) => {
    const calls = [];
    const exec = (cmd, args, opts) => {
      calls.push({ argv: [cmd, ...args], opts });
      if (cmd !== 'docker') return enoent();
      if (args[0] === 'context') { if (inspectThrows) return enoent(); return { status: 0, stdout: inspectOut, stderr: '' }; }
      if (args[0] === 'info') return { status: infoStatus, stderr: '' };
      return enoent();
    };
    return { calls, exec };
  };

  it('DOCKER_HOST=tcp://10.0.0.5:2375 \u2192 absent with the remote reason (host kept), docker info never asked', async () => {
    const { calls, exec } = recorder('unix:///var/run/docker.sock\n');
    const out = await detectSandbox({ exec, platform: 'darwin', env: { DOCKER_HOST: 'tcp://10.0.0.5:2375' } });
    assert.deepEqual(out, { present: false, kind: null, reason: 'docker daemon is remote (tcp://10.0.0.5:2375) — not a sandbox on this machine' });
    assert.ok(!calls.some(c => c.argv[0] === 'docker' && c.argv[1] === 'info'), JSON.stringify(calls));
  });

  it('DOCKER_HOST=ssh://user@h \u2192 absent, the userinfo is redacted from the reason', async () => {
    const { calls, exec } = recorder('');
    const out = await detectSandbox({ exec, platform: 'darwin', env: { DOCKER_HOST: 'ssh://user:pw@h' } });
    assert.equal(out.present, false);
    assert.equal(out.kind, null);
    assert.equal(out.reason, 'docker daemon is remote (ssh://h) — not a sandbox on this machine');
    assert.ok(!out.reason.includes('user@') && !out.reason.includes('pw'), out.reason);
    assert.ok(!calls.some(c => c.argv[1] === 'info'));
  });

  it('DOCKER_HOST unset and a remote docker context \u2192 absent with the redacted context endpoint', async () => {
    const { calls, exec } = recorder('ssh://deploy@build.example:22\n');
    const out = await detectSandbox({ exec, platform: 'darwin', env: {} });
    assert.equal(out.present, false);
    assert.equal(out.reason, 'docker daemon is remote (ssh://build.example:22) — not a sandbox on this machine');
    assert.deepEqual(calls.map(c => c.argv.slice(0, 3)), [['docker', 'context', 'inspect']], 'a remote context never receives docker info');
  });

  it('DOCKER_HOST unset, context endpoint unix:///var/run/docker.sock and docker info ok \u2192 present; docker gets DOCKER_CLI_HINTS=false and no SSH_ASKPASS', async () => {
    const { calls, exec } = recorder('unix:///var/run/docker.sock\n');
    const out = await detectSandbox({ exec, platform: 'darwin', env: { PATH: '/usr/bin', SSH_ASKPASS: '/bin/askpass', SSH_ASKPASS_REQUIRE: 'force' } });
    assert.deepEqual(out, { present: true, kind: 'docker', reason: 'docker info succeeded' });
    const inspect = calls.find(c => c.argv[1] === 'context');
    assert.deepEqual(inspect.argv, ['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
    assert.deepEqual(calls.map(c => c.argv[1]), ['context', 'info'], 'inspect runs before info');
    for (const c of calls.filter(c => c.argv[0] === 'docker')) {
      assert.equal(c.opts.env.DOCKER_CLI_HINTS, 'false');
      assert.equal(c.opts.env.PATH, '/usr/bin');
      assert.ok(!('SSH_ASKPASS' in c.opts.env) && !('SSH_ASKPASS_REQUIRE' in c.opts.env));
    }
  });

  it('DOCKER_HOST=unix:// or npipe:// is local; an empty or failing context inspect with DOCKER_HOST unset counts as local', async () => {
    for (const env of [{ DOCKER_HOST: 'unix:///run/user/1000/docker.sock' }, { DOCKER_HOST: 'npipe:////./pipe/docker_engine' }]) {
      const { exec } = recorder('');
      assert.equal((await detectSandbox({ exec, platform: 'darwin', env })).present, true, JSON.stringify(env));
    }
    assert.equal((await detectSandbox({ exec: recorder('').exec, platform: 'darwin', env: {} })).present, true);
    assert.equal((await detectSandbox({ exec: recorder('', { inspectThrows: true }).exec, platform: 'darwin', env: {} })).present, true);
  });

  it('defaultExec passes env through, keeps stdin and stdout ignored for docker info, and pipes stdout only when asked to capture it', () => {
    const seen = [];
    const spawn = (cmd, args, opts) => { seen.push(opts); return { status: 0, stdout: 'unix:///x\n', stderr: '' }; };
    defaultExec('docker', ['info'], { spawn, env: { A: '1' } });
    assert.deepEqual(seen[0].stdio, ['ignore', 'ignore', 'pipe']);
    assert.deepEqual(seen[0].env, { A: '1' });
    const r = defaultExec('docker', ['context', 'inspect'], { spawn, capture: true });
    assert.deepEqual(seen[1].stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(seen[1].timeout, 5000);
    assert.equal(r.stdout, 'unix:///x\n');
  });
});

describe('verdict r3 — Unicode format characters and code-point cuts', () => {
  const enoent = () => { throw Object.assign(new Error('spawnSync x ENOENT'), { code: 'ENOENT' }); };
  const dockerSays = (stderr) => detectSandbox({ exec: (cmd, args) => { if (cmd === 'docker' && args[0] === 'info') return { status: 1, stderr }; return enoent(); }, platform: 'darwin', env: {} });
  const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

  it('a U+202E (bidi override), U+200B, U+2028 and U+2029 in docker stderr are stripped from the reason', async () => {
    const out = await dockerSays('Cannot \u202Econnect\u200B to\u2028 the\u2029 daemon\u2066x\u2069');
    assert.ok(!/[\u202A-\u202E\u2066-\u2069\u200B\u2028\u2029]/.test(out.reason), JSON.stringify(out.reason));
    assert.match(out.reason, /docker is not running \(Cannot connect to the daemonx\)/);
  });

  it('an emoji at the 200-char boundary of a stderr line is not split: no lone surrogate in the stored JSON', async () => {
    const out = await dockerSays('e'.repeat(199) + '\u{1F600}' + 'tail');
    assert.ok(!LONE_SURROGATE.test(out.reason), JSON.stringify(out.reason));
    assert.ok(out.reason.includes('e'.repeat(199) + '\u{1F600} …[truncated]'), out.reason);
    assert.ok(!/\\ud[89a-f][0-9a-f]{2}/i.test(JSON.stringify(out.reason)));
    const whole = await dockerSays('e'.repeat(199) + '\u{1F600}');
    assert.ok(whole.reason.includes(`(${'e'.repeat(199)}\u{1F600})`), '200 code points are kept whole');
  });

  it('sanitizeEvidence strips U+202E / U+2028 / U+2029 (keeping \\n) and cuts by code point', () => {
    assert.equal(sanitizeEvidence('a\u202Eb\u2028c\u2029d\ne\uFEFF'), 'abcd\ne');
    const cut = sanitizeEvidence('a'.repeat(2047) + '\u{1F600}' + 'zz');
    assert.ok(!LONE_SURROGATE.test(cut), JSON.stringify(cut.slice(-20)));
    assert.equal(cut, 'a'.repeat(2047) + '\u{1F600} …[truncated]');
    assert.equal(sanitizeEvidence('a'.repeat(2047) + '\u{1F600}'), 'a'.repeat(2047) + '\u{1F600}');
  });
});

describe('verdict r4 — the `use` gate re-derives the row and re-checks the sandbox inside the lock', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-vr4-')); await makeHarness(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const runDir = (id) => path.join(dir, '.claude', 'bbs', 'runs', id);
  const noMit = { ...DEFAULT_CONFIG, licences: { ...DEFAULT_CONFIG.licences, permissive: DEFAULT_CONFIG.licences.permissive.filter(x => x !== 'MIT') } };

  async function probedClean(slug, powers = [power()], judgments = { 'drift-monitor': 'missing' }) {
    const r = await intake(dir, '-', { stdin: 'r4 tool ' + slug, now, slug });
    await writeInventory(dir, { run: r.runId, input: JSON.stringify(powers), now });
    await buildMap(dir, { run: r.runId, now });
    await recordJudgments(dir, { run: r.runId, input: JSON.stringify(judgments), now });
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    for (const p of powers) await recordProbe(dir, { run: r.runId, power: p.name, result: 'clean', now, sandbox });
    return r;
  }

  it('a stored present sandbox is not trusted: an injected absent check refuses use, updates vj.sandbox and recomputes the rows', async () => {
    const r = await probedClean('stale');
    const before = await readJson(path.join(runDir(r.runId), 'verdicts.json'));
    assert.deepEqual(before.rows['drift-monitor'].legal, ['rebuild', 'use', 'skip'], 'the stored row lists use');
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, sandbox: noSandbox }),
      (e) => e instanceof PolicyRefused && /use is not legal for drift-monitor/.test(e.message));
    const vj = await readJson(path.join(runDir(r.runId), 'verdicts.json'));
    assert.deepEqual(vj.sandbox, noSandbox, 'vj.sandbox updated from the fresh check');
    assert.deepEqual(vj.rows['drift-monitor'].legal, ['rebuild', 'skip']);
    assert.equal(vj.rows['drift-monitor'].decision, null);
    assert.deepEqual(vj.decisions, {});
  });

  it('without an injected sandbox the fresh check runs detectSandbox (exec injected): docker gone → use refused', async () => {
    const r = await probedClean('detect');
    const gone = () => { throw Object.assign(new Error('spawnSync docker ENOENT'), { code: 'ENOENT' }); };
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, exec: gone }), (e) => e instanceof PolicyRefused);
    const vj = await readJson(path.join(runDir(r.runId), 'verdicts.json'));
    assert.equal(vj.sandbox.present, false);
    assert.match(vj.sandbox.reason, /docker is not installed|docker daemon is remote/, 'the reason comes from detectSandbox (DOCKER_HOST, when set, is read from the real env)');
    const ok = (cmd, args) => (cmd === 'docker' && args[0] === 'info') || (cmd === 'docker' && args[0] === 'context') ? { status: 0, stdout: 'unix:///var/run/docker.sock\n', stderr: '' } : gone();
    // vj.sandbox is now absent: use stays refused even when the machine has a sandbox again, until cli.js verdict recomputes
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, exec: ok }), (e) => e instanceof PolicyRefused);
  });

  it('a fresh present check that differs from the stored one is recorded: use accepted and sandbox_changed: true', async () => {
    const r = await probedClean('changed');
    const unshare = { present: true, kind: 'unshare', reason: 'unshare is available' };
    const out = await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, sandbox: unshare });
    assert.equal(out.sandbox_changed, true);
    assert.equal(out.decided, 1);
    const vj = await readJson(path.join(runDir(r.runId), 'verdicts.json'));
    assert.deepEqual(vj.sandbox, unshare);
    assert.equal(vj.decisions['drift-monitor'], 'use');
    const same = await probedClean('same');
    const out2 = await recordDecisions(dir, { run: same.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, sandbox });
    assert.equal(out2.sandbox_changed, undefined, 'an unchanged sandbox is not reported as changed');
  });

  it('an absent fresh check clears a `use` already recorded on another row, with a withdrawal label naming the sandbox', async () => {
    const r = await probedClean('other', [power(), power({ name: 'b' })], { 'drift-monitor': 'missing', b: 'missing' });
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, sandbox });
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ b: 'use' }), now, sandbox: noSandbox }), (e) => e instanceof PolicyRefused);
    const vj = await readJson(path.join(runDir(r.runId), 'verdicts.json'));
    assert.equal(vj.rows['drift-monitor'].decision, null);
    assert.deepEqual(vj.decisions, {});
    const w = (await readJsonl(path.join(runDir(r.runId), 'labels.jsonl'))).filter(l => l.withdrawn != null);
    assert.equal(w.length, 1);
    assert.equal(w[0].power, 'drift-monitor');
    assert.equal(w[0].withdrawn, 'use');
    assert.match(w[0].reason, /no sandbox/);
  });

  it('the licence class is re-derived from the current cfg: MIT moved out of permissive → use refused (recordDecisions) and removed (recordProbe)', async () => {
    const r = await probedClean('lic');
    await assert.rejects(() => recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now, sandbox, cfg: noMit }),
      (e) => e instanceof PolicyRefused && /use is not legal/.test(e.message));
    const vj = await readJson(path.join(runDir(r.runId), 'verdicts.json'));
    assert.equal(vj.rows['drift-monitor'].licence_class, 'none');
    const r2 = await probedClean('lic2');
    const p = await recordProbe(dir, { run: r2.runId, power: 'drift-monitor', result: 'clean', now, force: true, cfg: noMit, sandbox });
    assert.equal(p.licence_class, 'none');
    assert.deepEqual(p.legal, ['rebuild', 'skip']);
  });

  it('cli: --decide use against a stale present verdicts.json with BBS_SANDBOX=absent exits 2 and records the absent sandbox', async () => {
    const r = await probedClean('cli');
    const base = { ...process.env };
    delete base.BBS_SANDBOX;
    const c = spawnSync(process.execPath, [CLI, 'verdict', '--decide', 'drift-monitor=use', '--run', r.runId, '--project', dir], { cwd: dir, encoding: 'utf-8', env: { ...base, BBS_SANDBOX: 'absent' } });
    assert.equal(c.status, 2, c.stderr);
    assert.match(c.stderr, /^bbs: refused: /m);
    const vj = await readJson(path.join(runDir(r.runId), 'verdicts.json'));
    assert.equal(vj.sandbox.present, false);
    assert.match(vj.sandbox.reason, /BBS_SANDBOX=absent/);
  });
});

describe('verdict r4 — a WITH exception is classified', () => {
  it('a permission-granting exception keeps the base class; a restrictive one never yields permissive', () => {
    const cfg = DEFAULT_CONFIG;
    assert.equal(licenceClass('Apache-2.0 WITH LLVM-exception', cfg), 'permissive');
    assert.equal(licenceClass('apache-2.0 with llvm-EXCEPTION', cfg), 'permissive', 'the allowlist is case-insensitive');
    assert.equal(licenceClass('GPL-2.0-only WITH Classpath-exception-2.0', cfg), 'copyleft');
    assert.equal(licenceClass('Apache-2.0 WITH Commons-Clause', cfg), 'none');
    assert.equal(licenceClass('MIT WITH GPL-3.0', cfg), 'copyleft');
    assert.equal(licenceClass('MIT WITH Proprietary', cfg), 'commercial');
    assert.equal(licenceClass('GPL-3.0 WITH Commons-Clause', cfg), 'copyleft');
    assert.equal(licenceClass('(Apache-2.0 WITH Commons-Clause) OR GPL-3.0', cfg), 'copyleft');
  });
});

describe('verdict r4 — a failed docker context inspect is not a local endpoint', () => {
  const enoent = () => { throw Object.assign(new Error('spawnSync x ENOENT'), { code: 'ENOENT' }); };
  const withInspect = (inspect) => {
    const calls = [];
    const exec = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd !== 'docker') return enoent();
      if (args[0] === 'context') return inspect();
      return { status: 0, stderr: '' };
    };
    return { calls, exec };
  };

  it('inspect timed out → absent naming the timeout; docker info is never run', async () => {
    const { calls, exec } = withInspect(() => { throw Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' }); });
    const out = await detectSandbox({ exec, platform: 'darwin', env: {} });
    assert.equal(out.present, false);
    assert.equal(out.reason, 'docker context inspect timed out (5 s timeout) — not treating the daemon as local');
    assert.ok(!calls.some(c => c[1] === 'info'), JSON.stringify(calls));
  });

  it('inspect failing to spawn (EACCES) → absent naming the error; docker info is never run', async () => {
    const { calls, exec } = withInspect(() => { throw Object.assign(new Error('spawnSync docker EACCES'), { code: 'EACCES' }); });
    const out = await detectSandbox({ exec, platform: 'darwin', env: {} });
    assert.equal(out.present, false);
    assert.equal(out.reason, 'docker context inspect failed (EACCES) — not treating the daemon as local');
    assert.ok(!calls.some(c => c[1] === 'info'), JSON.stringify(calls));
  });

  it('inspect exits non-zero with a generic error → absent naming the sanitised stderr line; docker info is never run', async () => {
    const { calls, exec } = withInspect(() => ({ status: 1, stdout: '', stderr: 'error: context "remote" does not exist at tcp://admin:pw@10.0.0.9:2376/x\nmore' }));
    const out = await detectSandbox({ exec, platform: 'darwin', env: {} });
    assert.equal(out.present, false);
    assert.equal(out.kind, null);
    assert.equal(out.reason, 'docker context inspect failed (error: context "remote" does not exist at tcp://10.0.0.9:2376) — not treating the daemon as local');
    assert.ok(!calls.some(c => c[1] === 'info'), JSON.stringify(calls));
    const silent = withInspect(() => ({ status: 3, stdout: '', stderr: '' }));
    const out2 = await detectSandbox({ exec: silent.exec, platform: 'darwin', env: {} });
    assert.equal(out2.reason, 'docker context inspect failed (exit 3) — not treating the daemon as local');
    assert.ok(!silent.calls.some(c => c[1] === 'info'));
  });

  it('inspect unknown to this docker (no contexts) → proceeds to docker info', async () => {
    for (const stderr of ["docker: 'context' is not a docker command.", 'unknown flag: --format', 'Error: unknown command "context" for "podman"']) {
      const { calls, exec } = withInspect(() => ({ status: 1, stdout: '', stderr }));
      const out = await detectSandbox({ exec, platform: 'darwin', env: {} });
      assert.deepEqual(out, { present: true, kind: 'docker', reason: 'docker info succeeded' }, stderr);
      assert.ok(calls.some(c => c[1] === 'info'));
    }
  });
});

describe('verdict r4 — sandbox stderr is redacted before it is stored', () => {
  const enoent = () => { throw Object.assign(new Error('spawnSync x ENOENT'), { code: 'ENOENT' }); };
  it('a home path becomes ~, URL credentials are masked, a remote endpoint in stderr keeps only scheme + host', async () => {
    const infoSays = (stderr, platform = 'darwin', unshare = enoent) => detectSandbox({
      exec: (cmd, args) => { if (cmd === 'docker' && args[0] === 'info') return { status: 1, stderr }; if (cmd === 'unshare') return unshare(); return enoent(); },
      platform, env: {}, homedir: '/Users/me'
    });
    const a = await infoSays('Cannot connect to the Docker daemon at unix:///Users/me/.docker/run/docker.sock. Is the docker daemon running?');
    assert.ok(a.reason.includes('~/.docker'), a.reason);
    assert.ok(!a.reason.includes('/Users/me'), a.reason);
    const b = await infoSays('error during connect: tcp://admin:s3cret@10.0.0.5:2376/v1.45/info: refused; see https://u:p@h.example/x?token=abc');
    assert.ok(!b.reason.includes('s3cret') && !b.reason.includes('admin'), b.reason);
    assert.ok(!b.reason.includes('u:p') && !b.reason.includes('abc'), b.reason);
    assert.ok(b.reason.includes('tcp://10.0.0.5:2376'), b.reason);
    const c = await infoSays('x', 'linux', () => ({ status: 1, stderr: 'unshare: cannot open /Users/me/.config/x: Permission denied' }));
    assert.ok(c.reason.includes('~/.config/x'), c.reason);
    assert.ok(!c.reason.includes('/Users/me'), c.reason);
    const d = await infoSays('no such file /Users/meow/x');
    assert.ok(d.reason.includes('/Users/meow/x'), 'only the home directory itself is replaced, not a prefix of another name');
  });
});
