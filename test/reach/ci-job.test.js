// Reach test: the node-test job of .github/workflows/test.yml. The test parses the workflow, finds the steps, and runs
// the exact `run:` script of each step (through bash, at the repo root) on a tiny fixture, then checks the effect:
//   "Test plan for this change"  prints the plan with a reason per item and never fails
//   "npm test"                   fails closed: any nonzero exit fails; the ::error:: label tells the classes apart
//   "Render test results"        writes junit.xml (and results.sarif when a test failed) as local files
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf-8');

/** The steps of a job as { name, continueOnError, run } from the workflow text (no YAML library in this repo). */
function steps(job) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((l) => l === `  ${job}:`);
  assert.ok(start >= 0, `job ${job} not found`);
  const out = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^ {0,2}\S/.test(l)) break; // next job or top-level key
    let m = /^ {6}- (?:name: (.*)|(uses|run): (.*))$/.exec(l);
    if (m) { cur = { name: m[1] ?? null, continueOnError: false, run: null }; out.push(cur); if (m[2] === 'run') cur.run = m[3]; continue; }
    if (!cur) continue;
    if ((m = /^ {8}name: (.*)$/.exec(l))) cur.name = m[1];
    else if (/^ {8}continue-on-error: true$/.test(l)) cur.continueOnError = true;
    else if (/^ {8}run: \|$/.test(l)) {
      const body = [];
      while (i + 1 < lines.length && (/^ {10}/.test(lines[i + 1]) || lines[i + 1] === '')) body.push(lines[++i].slice(10));
      cur.run = body.join('\n').trimEnd() + '\n';
    } else if ((m = /^ {8}run: (.+)$/.exec(l))) cur.run = m[1];
  }
  return out;
}
const step = (name) => {
  const s = steps('node-test').find((x) => x.name === name);
  assert.ok(s && s.run, `step "${name}" with a run script not found`);
  return s;
};

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-job-'));
  return { dir, env: { ...process.env, RUNNER_TEMP: dir, CI_TEST_OUTPUT: path.join(dir, 'test-output.txt'), CI_RESULTS_DIR: path.join(dir, 'results') } };
}
const runStepScript = (s, env) => spawnSync('bash', ['-eo', 'pipefail', '-c', s.run], { cwd: root, env, encoding: 'utf-8' });

test('the job is wired: advisory steps cannot fail it, the test step can', () => {
  assert.equal(step('Test plan for this change').continueOnError, true);
  assert.equal(step('Render test results').continueOnError, true);
  assert.equal(step('npm test').continueOnError, false);
  assert.match(step('npm test').run, /exit-codes\.js/);
  assert.doesNotMatch(workflow, /secrets\.|GITHUB_TOKEN|gh pr comment|upload-artifact/);
});

test('test plan step prints a reason per item and exits 0', () => {
  const { env } = fixture();
  const r = runStepScript(step('Test plan for this change'), { ...env, CI_CHANGED_FILES: 'src/lib/kit/test-plan.js\nREADME.md' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Test plan for this change: \d+ of \d+ test files/);
  assert.match(r.stdout, /direct-change\s+test\/kit-[\w-]*test-plan[\w-]*\.test\.js/);
  assert.match(r.stdout, /the full test run below is unchanged/);
});

test('test plan step with an unreadable change set still exits 0 and says so', () => {
  const { env } = fixture();
  const r = runStepScript(step('Test plan for this change'), { ...env, CI_CHANGED_FILES: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /low confidence|smoke/);
});

test('test step: a product failure fails the job step and its output is kept', () => {
  const { env } = fixture();
  const r = runStepScript(step('npm test'), { ...env, CI_TEST_COMMAND: 'echo "ok 1 - good"; echo "not ok 2 - bad"; exit 1' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /product failure/);
  assert.match(r.stdout, /The job fails; see the failing tests above\./);
  assert.doesNotMatch(r.stdout, /never block/i);
  assert.match(fs.readFileSync(env.CI_TEST_OUTPUT, 'utf-8'), /not ok 2 - bad/);
});

test('test step: a passing run passes', () => {
  const { env } = fixture();
  const r = runStepScript(step('npm test'), { ...env, CI_TEST_COMMAND: 'echo "ok 1 - good"' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

for (const [label, command, pattern, next] of [
  ['a timeout (124)', 'exit 124', /status 124: infrastructure: timed out \/ killed by a signal, rerun/, /The job fails; rerun the job\./],
  ['a signal death', 'kill -9 $$', /infrastructure: timed out \/ killed by a signal, rerun/, /The job fails; rerun the job\./],
  ['a tool that is not found (127)', 'exit 127', /status 127: precondition: the test command could not start/, /The job fails; check the test script and the node install\./],
  ['exit 2', 'exit 2', /status 2: precondition: test command failed with status 2/, /The job fails; check the test script and the node install\./],
  ['an OOM kill (137)', 'exit 137', /status 137: infrastructure/, /The job fails; rerun the job\./],
]) {
  test(`test step: ${label} fails the step with a label`, () => {
    const { env } = fixture();
    const r = runStepScript(step('npm test'), { ...env, CI_TEST_COMMAND: command });
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /::error::/);
    assert.match(r.stdout, pattern);
    assert.match(r.stdout, next);
    assert.doesNotMatch(r.stdout, /never block/i);
    assert.doesNotMatch(r.stdout, /::warning::/);
  });
}

test('render step writes JUnit and SARIF files for a failing run, JUnit only for a clean one', () => {
  const { dir, env } = fixture();
  fs.writeFileSync(env.CI_TEST_OUTPUT, 'TAP version 13\nok 1 - good suite\nnot ok 2 - bad suite\n');
  let r = runStepScript(step('Render test results'), env);
  assert.equal(r.status, 0, r.stderr);
  const junit = fs.readFileSync(path.join(dir, 'results', 'junit.xml'), 'utf-8');
  assert.match(junit, /<testsuites name="node-test" tests="2" failures="1"/);
  assert.match(junit, /<failure message="test failed: bad suite"/);
  const sarif = JSON.parse(fs.readFileSync(path.join(dir, 'results', 'results.sarif'), 'utf-8'));
  assert.equal(sarif.runs[0].results.length, 1);
  assert.match(r.stdout, /wrote .*junit\.xml/);

  fs.rmSync(path.join(dir, 'results'), { recursive: true });
  fs.writeFileSync(env.CI_TEST_OUTPUT, 'ok 1 - good suite\n');
  r = runStepScript(step('Render test results'), env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'results', 'junit.xml')));
  assert.ok(!fs.existsSync(path.join(dir, 'results', 'results.sarif')));
});

test('render step with no test output exits 0 and writes nothing', () => {
  const { dir, env } = fixture();
  const r = runStepScript(step('Render test results'), env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no test output/);
  assert.ok(!fs.existsSync(path.join(dir, 'results')));
});

test('test step: a status that is not a timeout, a signal or >= 128 never gets the "timed out / killed by a signal" label, and the job still fails', async () => {
  const { runStep } = await import(path.join(root, 'scripts', 'ci-step.js'));
  const { env } = fixture();
  const lines = [];
  const code = await runStep(() => ({ class: 'infrastructure' }), { env: { ...env, CI_TEST_COMMAND: 'exit 3' }, log: (l) => lines.push(l) });
  assert.equal(code, 3);
  const out = lines.join('\n');
  assert.match(out, /status 3: infrastructure: test command failed with status 3/);
  assert.doesNotMatch(out, /timed out \/ killed by a signal/);
});

test('scripts/ci-step.js --print-targets prints the test map CI gives test-plan', () => {
  const r = spawnSync(process.execPath, ['scripts/ci-step.js', '--print-targets'], { cwd: root, encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  const map = JSON.parse(r.stdout);
  assert.ok(map.targets.length > 10);
  const t = map.targets.find((x) => x.id === 'test/reach/ci-job.test.js');
  assert.ok(t && t.files.includes('test/reach/ci-job.test.js'));
});
