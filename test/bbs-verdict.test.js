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
  computeVerdicts, recordProbe, recordDecisions
} from '../src/lib/bbs/verdict.js';
import { DEFAULT_CONFIG } from '../src/lib/bbs/config.js';
import { intake } from '../src/lib/bbs/intake.js';
import { writeInventory } from '../src/lib/bbs/inventory.js';
import { buildMap, recordJudgments } from '../src/lib/bbs/harness-map.js';
import { readJson, readJsonl, lookupSource } from '../src/lib/bbs/store.js';

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
    const ok = await detectSandbox({ exec, platform: 'darwin' });
    assert.deepEqual(ok, { present: true, kind: 'docker', reason: 'docker info succeeded' });
    assert.deepEqual(calls[0], ['docker', 'info']);
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
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now });
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

  it('probe --force clean → found clears a recorded `use` decision with a warning; labels.jsonl is history and is left untouched', async () => {
    const r = await prepared('clr', [power()], { 'drift-monitor': 'missing' });
    await computeVerdicts(dir, { run: r.runId, sandbox, now });
    await recordProbe(dir, { run: r.runId, power: 'drift-monitor', result: 'clean', now });
    await recordDecisions(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'use' }), now });
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
    assert.ok((await fs.readFile(labelsFile)).equals(labelsBefore), 'labels.jsonl byte-identical');
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
