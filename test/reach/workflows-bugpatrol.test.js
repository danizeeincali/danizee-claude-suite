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
  'noise-ledger': () => {
    // The step passes no --ledger: the default ledger is used and a missing one is fine.
    const r = run(['noise-ledger', 'apply', '--in', FINDINGS]); ok(r);
    const out = JSON.parse(r.stdout);
    assert.ok(out.filed.some(f => f.id === 'a'), 'finding a is filed');
    assert.ok(out.quarantined.some(f => f.id === 'b'), 'finding b never reproduced on retry: quarantined');
  },
  cluster: () => { const r = run(['cluster', '--file', FINDINGS]); ok(r); assert.ok(JSON.parse(r.stdout).clusters); },
  'threshold-route': () => { const r = run(['threshold-route', '--file', ROUTE]); ok(r); assert.match(r.stdout, /auto-fix/); },
  'test-plan': () => { const r = run(['test-plan', '--in', MAP, '--changed', CHANGED]); ok(r); assert.equal(JSON.parse(r.stdout).plan[0].id, 't1'); },
  triage: () => ok(run(['triage', 'visit', '--session', 's1', '--in', VISIT, '--state', path.join(tmp, 'triage.json')])),
  'shared-budget': () => {
    const state = path.join(tmp, `budget-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    ok(run(['shared-budget', 'open', '--state', state, '--steps', '5']));
    const g = run(['shared-budget', 'grant', '--state', state, '--helper', 'h1', '--steps', '2']); ok(g);
    ok(run(['shared-budget', 'grant', '--state', state, '--helper', 'h2', '--steps', '2'])); // a second concurrent helper is not skipped
    ok(run(['shared-budget', 'release', '--state', state, '--helper', 'h2']));
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
  ['w-debug', '⛔ CHECKPOINT 2: Diagnosis (BLOCKING GATE)', 'replay-gate'],
  // /pt and /mt are the owner's daily workflows: the same powers, in their normal flow.
  ['w-plan-tdd-swarm', '⛔ CHECKPOINT 5: Build', 'test-plan'],
  ['w-plan-tdd-swarm', '⛔ CHECKPOINT 6: Review', 'cluster'], ['w-plan-tdd-swarm', '⛔ CHECKPOINT 6: Review', 'noise-ledger'], ['w-plan-tdd-swarm', '⛔ CHECKPOINT 6: Review', 'triage'],
  ['w-plan-tdd-swarm', VER, 'threshold-route'], ['w-plan-tdd-swarm', VER, 'replay-gate'],
  ['w-plan-tdd-swarm', '⛔ CHECKPOINT 7: Compound (MANDATORY - NEVER SKIP)', 'reflect'],
  ['w-marathon', '⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met', 'cluster'], ['w-marathon', '⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met', 'triage'],
  ['w-marathon', '⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met', 'threshold-route'], ['w-marathon', '⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met', 'replay-gate'], ['w-marathon', '⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met', 'test-plan']
];

for (const [wf, heading, verb] of rows) {
  test(`${wf} · ${heading} runs kit/cli.js ${verb} and the call is accepted`, () => {
    const text = fs.readFileSync(`.claude/commands/.shortcuts/${wf}.md`, 'utf-8');
    const section = stepSection(text, heading);
    assert.notEqual(section, null, `heading "${heading}" is missing from ${wf}.md`);
    assert.match(section, verbCall(verb), `"${heading}" in ${wf}.md never runs kit/cli.js ${verb}`);
    // The step must be reached top-down before the section hands off: before its first AUTO-PROCEED / REQUIRED OUTPUT / "proceed" line.
    const lines = section.split(/\r?\n/);
    const call = verbCall(verb);
    const at = lines.findIndex(l => call.test(l));
    const stop = lines.findIndex((l, i) => i > 0 && /AUTO-PROCEED|REQUIRED OUTPUT|\bproceed\b/i.test(l));
    assert.ok(at >= 0, `no line of "${heading}" runs kit/cli.js ${verb}`);
    if (stop >= 0) assert.ok(at < stop, `"${heading}" in ${wf}.md runs ${verb} at line ${at + 1}, after its handoff line ${stop + 1}: ${lines[stop].slice(0, 70)}`);
    calls[verb]();
  });
}

// Budget and gate wording: what the step text must say, proved on the installed command files.
const installed = (wf) => fs.readFileSync(`.claude/commands/.shortcuts/${wf}.md`, 'utf-8');

test('w-marathon 4.1a: state per run and stream, opened at 4.2, explicit grant amount, --state on every call, release, wait vs used up', () => {
  const t = installed('w-marathon');
  const a = t.indexOf('**4.1a Shared helper allowance');
  const b = t.indexOf('**4.2 Isolate', a);
  assert.ok(a >= 0 && b > a);
  const sec = t.slice(a, b);
  assert.match(sec, /\.claude\/marathon\/<run-id>\/helper-budget-<stream>\.json/, 'state path carries run id and stream');
  assert.doesNotMatch(t, /\.claude\/marathon\/helper-budget\.json/, 'no fixed shared state path');
  assert.match(sec, /shared-budget grant --state "\$S" --helper <id> --steps <[^>]+> --cost <[^>]+>/, 'grant passes an amount');
  assert.match(sec, /shared-budget spend --state "\$S"/, 'spend line carries --state');
  assert.doesNotMatch(sec, /--time-ms/, 'no wall-clock allowance');
  assert.match(sec, /shared-budget status --state "\$S"[^\n]*depth[^\n]*stop --state "\$S"[^\n]*until depth is 0/, 'resume drains depth');
  assert.match(sec, /shared-budget release --state "\$S" --helper <id>/, 'release for a helper that ends without a spend');
  assert.match(sec, /fully reserved by other sub-sessions[^\n]*\*\*wait\*\*/, 'a reserved skip means wait');
  assert.match(sec, /exhausted[^\n]*CHECKPOINT 5/, 'only an exhausted limit goes to CHECKPOINT 5');
  const s42 = t.slice(b, b + 4000);
  assert.match(s42, /shared-budget open --state "\$S"/, 'allowance is opened when the stream is activated (4.2)');
});

test('w-review claim budget: state lives under a fresh mktemp -d, removed at the end of the checkpoint', () => {
  const sec = stepSection(installed('w-review'), VER);
  assert.match(sec, /D=\$\(mktemp -d\)/);
  assert.match(sec, /B=<printed dir>\/review-budget\.json/);
  assert.match(sec, /Shell variables do not persist between Bash calls/);
  assert.match(sec, /rm -rf "\$D"/);
  assert.doesNotMatch(sec, /\.claude\/kit\/review-budget\.json/, 'no fixed state file');
  assert.match(sec, /shared-budget grant --state "\$B" --helper <id> --steps <n>/);
  assert.match(sec, /shared-budget release --state "\$B"/);
});

test('w-review replay gate: exit 1 or a missing kit is FAIL, never PASS', () => {
  const sec = stepSection(installed('w-review'), VER);
  assert.match(sec, /Exit 1[^\n]*or a missing kit[^\n]*FAIL[^\n]*replay gate could not run: <reason>[^\n]*never PASS/);
  assert.doesNotMatch(sec, /nothing fails the check on unreplayed evidence/);
  assert.match(sec, /fails closed \(FAIL, "replay gate could not run: kit not installed"\)/);
});

test('reflect steps (w-fix, w-bbs): lessons go in by --text-file / --reason-file, never in a quoted shell argument', () => {
  for (const [wf, heading] of [['w-fix', '⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)'], ['w-bbs', '⛔ CHECKPOINT 6: Compound (MANDATORY)'], ['w-plan-tdd-swarm', '⛔ CHECKPOINT 7: Compound (MANDATORY - NEVER SKIP)']]) {
    const sec = stepSection(installed(wf), heading);
    assert.match(sec, /reflect lessons save --role <role> --text-file </, `${wf} saves with --text-file`);
    assert.match(sec, /retire --id <id> --reason-file </, `${wf} retires with --reason-file`);
    assert.match(sec, /mktemp -d/, `${wf} writes the lesson under a mktemp directory`);
    assert.match(sec, /shell variables do not persist/, `${wf} uses the printed path literally`);
    assert.doesNotMatch(sec, /--text "/, `${wf} no longer puts the lesson in --text "..."`);
    assert.doesNotMatch(sec, /--reason "/, `${wf} no longer puts the reason in --reason "..."`);
  }
});

test('w-review render step: redact --keep-lines sits before any post, outputs go to a mktemp directory, no repo-root reports/', () => {
  const sec = stepSection(installed('w-review'), '⛔ CHECKPOINT 5: Compound (MANDATORY - NEVER SKIP)');
  const lines = sec.split(/\r?\n/);
  const render = lines.findIndex(l => /cli\.js render /.test(l));
  const redact = lines.findIndex(l => /cli\.js redact --keep-lines </.test(l));
  const post = lines.findIndex(l => /post `?\$W\/review-comment\.md/.test(l));
  assert.ok(render >= 0 && redact > render && post > redact, `render ${render}, redact ${redact}, post ${post}`);
  assert.match(sec, /redact exits non-zero|`redact` exits non-zero/);
  assert.match(sec, /do not post/);
  assert.match(sec, /mktemp -d/);
  assert.match(sec, /--out "\$W\/raw"/);
  assert.doesNotMatch(sec, /--out reports\//);
  assert.doesNotMatch(sec, /mkdir -p reports/);
  assert.doesNotMatch(sec, /`reports\/review/);
});

// /w-marathon: cluster and triage only annotate the reviewer's rows; the review steps sit in 4.5 before the rows are
// recorded, the fix checks in 4.7 territory before the 4.8 gate.
test('w-marathon 4.5: cluster and triage run before record review, and never lower the recorded counts', () => {
  const t = installed('w-marathon');
  const a = t.indexOf('**4.5 Review round');
  const rec = t.indexOf('Then: `cli.js record review stream=', a);
  const gate = t.indexOf('**4.8 Gate.**', a);
  assert.ok(a >= 0 && rec > a && gate > rec);
  const sec = t.slice(a, rec);
  for (const v of ['cluster', 'triage']) assert.match(sec, verbCall(v), `4.5 runs ${v} before the rows are recorded`);
  assert.match(sec, /recorded counts stay the reviewer's real counts/);
  assert.match(sec, /never removes a row or lowers a count/);
  assert.match(sec, /mktemp -d/);
  assert.match(sec, /Shell variables do not persist between Bash calls/);
  const fix = t.slice(t.indexOf('**4.7 Fix round.**'), gate);
  for (const v of ['test-plan', 'threshold-route', 'replay-gate']) assert.match(fix, verbCall(v), `4.7 runs ${v} before the 4.8 gate`);
  assert.ok(fix.indexOf('cli.js test-plan') < fix.indexOf('cli.js threshold-route'), 'tests are picked before claimed fixes are routed');
  assert.match(fix, /`block` \(a failing regression test\) can never be overridden/);
});

test('w-plan-tdd-swarm: review inputs go through files written with the Write tool, noise-ledger severities mapped, replay gate fails closed', () => {
  const t = installed('w-plan-tdd-swarm');
  const rev = stepSection(t, '⛔ CHECKPOINT 6: Review');
  assert.match(rev, /critical to high and info to low/);
  assert.match(rev, /never goes in a shell argument/);
  assert.match(rev, /P=<printed dir>/);
  assert.ok(rev.indexOf('cli.js noise-ledger') < rev.indexOf('cli.js triage visit'), 'ledger before triage');
  const ver = stepSection(t, VER);
  assert.match(ver, /Exit 1[^\n]*or a missing kit[^\n]*FAIL[^\n]*replay gate could not run: <reason>[^\n]*never PASS/);
  const build = stepSection(t, '⛔ CHECKPOINT 5: Build');
  assert.match(build, /test-plan --in "\$P\/test-map\.json" --changed "\$P\/changed\.txt"/);
});

test('the new /pt and /mt kit blocks parse with bash -n', () => {
  const blocks = [];
  const pt = installed('w-plan-tdd-swarm');
  for (const h of ['⛔ CHECKPOINT 5: Build', '⛔ CHECKPOINT 6: Review', VER, '⛔ CHECKPOINT 7: Compound (MANDATORY - NEVER SKIP)']) {
    for (const m of stepSection(pt, h).matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)) if (/kit\/cli\.js (test-plan|cluster|noise-ledger|triage|threshold-route|replay-gate|reflect)\b/.test(m[1])) blocks.push(m[1]);
  }
  const mt = stepSection(installed('w-marathon'), '⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met');
  for (const m of mt.matchAll(/```bash\n([\s\S]*?)```/g)) if (/kit\/cli\.js (test-plan|cluster|triage|threshold-route|replay-gate)\b/.test(m[1])) blocks.push(m[1]);
  assert.equal(blocks.length, 12, 'pt: test-plan, cluster, noise-ledger, triage, threshold-route, replay-gate, reflect; mt: cluster, triage, test-plan, threshold-route, replay-gate');
  for (const b of blocks) {
    const r = spawnSync('bash', ['-n'], { input: b, encoding: 'utf-8' });
    assert.equal(r.status, 0, `bash -n failed: ${r.stderr}\n${b}`);
  }
});
