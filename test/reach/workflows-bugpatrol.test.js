// Reach test: each bugpatrol power is run by the INSTALLED workflow command file inside the approved step, and the
// call that step makes (same verb, same flags) is accepted by the kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stepSection, verbCall } from '../../src/lib/bbs/wiring.js';

const CLI = '.claude/helpers/kit/cli.js';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-bugpatrol-'));
const put = (name, data) => { const f = path.join(tmp, name); fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); return f; };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf-8', cwd: process.cwd() });
const ok = (r, codes = [0]) => assert.ok(codes.includes(r.status), `exit ${r.status}: ${r.stderr || r.stdout}`);

const FINDINGS = put('findings.json', [
  { id: 'a', rule: 'r1', severity: 'high', files: ['x.js'], locations: ['x.js'], failures: 0, reproductions: 0 },
  { id: 'b', rule: 'r1', severity: 'low', files: ['x.js', 'y.js'], locations: ['y.js'], failures: 2, reproductions: 0 }
]);
const VISIT = put('visit.json', { scopes: ['x.js'], enabled: ['r1'], violations: [{ scope: 'x.js', rule: 'r1', source: 'auto', element: 'e' }] });
const ROUTE = put('route.json', [{ id: 'f1', answer: { kind: 'fix', confidence: 0.9 }, deterministicRegression: false }]);
const MAP = put('map.json', { targets: [{ id: 't1', files: ['a.js'] }, { id: 't2', files: ['b.js'] }] });
const CHANGED = put('changed.txt', 'a.js\n');
const EVENTS = put('events.jsonl', '{"type":"tool","name":"Edit","input":{"path":"a"},"ok":false,"error":"x"}\n{"type":"stop","reason":"end_turn"}\n');
const RENDER = put('render.json', { findings: [{ message: 'm', severity: 'advisory', file: 'x.js', line: 1 }] });
const run1 = { steps: ['s'], outputs: { o: 1 } };
const GATE = put('gate.json', { verdicts: [{ id: 'diagnosis', decided_by: 'replay', outcome: 'fail', runs: [run1, run1] }] });

// What each step runs: the verb's own call, with the flags the step text uses.
const calls = {
  'noise-ledger': () => ok(run(['noise-ledger', 'apply', '--in', FINDINGS, '--ledger', path.join(tmp, 'ledger.json')].filter(Boolean)), [0, 1]),
  cluster: () => { const r = run(['cluster', '--file', FINDINGS]); ok(r); assert.ok(JSON.parse(r.stdout).clusters); },
  'threshold-route': () => { const r = run(['threshold-route', '--file', ROUTE]); ok(r); assert.match(r.stdout, /auto-fix/); },
  'test-plan': () => { const r = run(['test-plan', '--in', MAP, '--changed', CHANGED]); ok(r); assert.equal(JSON.parse(r.stdout).plan[0].id, 't1'); },
  triage: () => ok(run(['triage', 'visit', '--session', 's1', '--in', VISIT, '--state', path.join(tmp, 'triage.json')])),
  'shared-budget': () => {
    const state = path.join(tmp, `budget-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    ok(run(['shared-budget', 'open', '--state', state, '--steps', '5']));
    const g = run(['shared-budget', 'grant', '--state', state, '--helper', 'h1']); ok(g);
    ok(run(['shared-budget', 'spend', '--state', state, '--helper', 'h1', '--steps', '1', '--outcome', 'ok']));
  },
  reflect: () => ok(run(['reflect', 'trouble-log', '--in', EVENTS])),
  doctor: () => ok(run(['doctor', '--profile', 'marathon']), [0, 2]),
  render: () => { ok(run(['render', 'sarif', '--file', RENDER, '--out', path.join(tmp, 'o.sarif')])); ok(run(['render', 'junit', '--file', RENDER, '--out', path.join(tmp, 'o.xml')])); ok(run(['render', 'comment', '--file', RENDER, '--key', 'review', '--out', path.join(tmp, 'o.md')])); },
  'replay-gate': () => ok(run(['replay-gate', '--file', GATE]), [2])
};

const CP4 = '⛔ CHECKPOINT 4: Ralph Candidates (AUTO-PROCEED)';
const VER = '✅ VERIFICATION CHECKPOINT — Cross-Method Validation';
const rows = [
  ['w-review', CP4, 'noise-ledger'], ['w-review', CP4, 'triage'],
  ['w-review', '⛔ CHECKPOINT 1: Code Analysis', 'cluster'],
  ['w-review', VER, 'threshold-route'], ['w-review', VER, 'shared-budget'], ['w-review', VER, 'replay-gate'],
  ['w-review', '⛔ CHECKPOINT 5: Compound (MANDATORY - NEVER SKIP)', 'render'],
  ['w-bg-review', 'Phase 4: Ralph Candidates', 'cluster'],
  ['w-fix', VER, 'threshold-route'],
  ['w-fix', '⛔ CHECKPOINT 2: Fix Applied', 'test-plan'],
  ['w-fix', '⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)', 'reflect'],
  ['w-marathon', '⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met', 'shared-budget'],
  ['w-marathon', '⛔ CHECKPOINT 3: Arm', 'doctor'],
  ['w-bbs', '⛔ CHECKPOINT 6: Compound (MANDATORY)', 'reflect'],
  ['w-debug', '⛔ CHECKPOINT 2: Diagnosis (BLOCKING GATE)', 'replay-gate']
];

for (const [wf, heading, verb] of rows) {
  test(`${wf} · ${heading} runs kit/cli.js ${verb} and the call is accepted`, () => {
    const text = fs.readFileSync(`.claude/commands/.shortcuts/${wf}.md`, 'utf-8');
    const section = stepSection(text, heading);
    assert.notEqual(section, null, `heading "${heading}" is missing from ${wf}.md`);
    assert.match(section, verbCall(verb), `"${heading}" in ${wf}.md never runs kit/cli.js ${verb}`);
    calls[verb]();
  });
}
