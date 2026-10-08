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
