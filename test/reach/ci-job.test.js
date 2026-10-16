// Reach test: the node-test job of .github/workflows/test.yml. The test parses the workflow, finds the steps, and runs
// the exact `run:` script of each step (through bash, at the repo root) on a tiny fixture, then checks the effect:
//   "Test plan for this change"  prints the plan with a reason per item and never fails
//   "npm test"                   fails closed: any nonzero exit fails; the ::error:: label tells the classes apart
//   "Render test results"        writes junit.xml (and results.sarif when a test failed) as local files
//   "Upload test results"        uploads those files (only them) as the run artifact test-results-node-<node>, always
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf-8');

/** The steps of a job as { name, continueOnError, run, uses, if, with } from the workflow text (no YAML library in this repo). */
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
    if (m) { cur = { name: m[1] ?? null, continueOnError: false, run: null, uses: null, if: null, with: {} }; out.push(cur); if (m[2] === 'run') cur.run = m[3]; if (m[2] === 'uses') cur.uses = m[3]; continue; }
    if (!cur) continue;
    if ((m = /^ {8}name: (.*)$/.exec(l))) cur.name = m[1];
    else if ((m = /^ {8}uses: (.*)$/.exec(l))) cur.uses = m[1];
    else if ((m = /^ {8}if: (.*)$/.exec(l))) cur.if = m[1];
    else if (/^ {8}with:$/.test(l)) { while (i + 1 < lines.length && (m = /^ {10}([\w-]+): (.*)$/.exec(lines[i + 1]))) { cur.with[m[1]] = m[2]; i++; } }
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

/**
 * A temp folder for one step run. HOME and DANIZEE_KIT_HOME point into it, so the real `npm test` step (which records
 * the run when the developer's kit index is on for this repository) never writes the developer's real index.
 */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-job-'));
  return { dir, env: { ...process.env, HOME: dir, DANIZEE_KIT_HOME: path.join(dir, 'kit-home'), RUNNER_TEMP: dir, CI_TEST_OUTPUT: path.join(dir, 'test-output.txt'), CI_RESULTS_DIR: path.join(dir, 'results') } };
}
const runStepScript = (s, env) => spawnSync('bash', ['-eo', 'pipefail', '-c', s.run], { cwd: root, env, encoding: 'utf-8' });

test('the job is wired: advisory steps cannot fail it, the test step can', () => {
  assert.equal(step('Test plan for this change').continueOnError, true);
  assert.equal(step('Render test results').continueOnError, true);
  assert.equal(steps('node-test').find((x) => x.name === 'Upload test results')?.continueOnError, true, 'a failed artifact upload never fails the job');
  assert.equal(step('npm test').continueOnError, false);
  assert.match(step('npm test').run, /exit-codes\.js/);
  // No token and nothing posted. The one artifact upload (owner-approved, 2026-10-16) is the step checked below and no other.
  assert.doesNotMatch(workflow, /secrets\.|GITHUB_TOKEN|gh pr comment/);
  assert.equal(steps('node-test').filter((x) => /upload-artifact/.test(x.uses || '')).length, 1);
  assert.equal((workflow.match(/upload-artifact/g) || []).length, 1);
});

test('the upload step always uploads only the rendered results, per node version, kept 90 days', () => {
  const all = steps('node-test');
  const names = all.map((x) => x.name);
  const up = all.find((x) => x.name === 'Upload test results');
  assert.ok(up, 'step "Upload test results" not found');
  assert.ok(names.indexOf('Upload test results') === names.indexOf('Render test results') + 1, 'it follows the render step');
  assert.equal(up.uses, 'actions/upload-artifact@v4');
  assert.equal(up.if, 'always()');
  assert.equal(up.continueOnError, true);
  assert.equal(up.run, null);
  assert.match(workflow, /matrix:\n\s+node: \[/, 'the matrix key the artifact name uses is `node`');
  assert.deepEqual(up.with, {
    name: 'test-results-node-${{ matrix.node }}',
    path: '${{ runner.temp }}/test-results',
    'retention-days': '90',
    'if-no-files-found': 'warn'
  });
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

test('the step fixture keeps the kit index away from the real home: HOME and DANIZEE_KIT_HOME are the temp folder, nothing recorded', () => {
  const { dir, env } = fixture();
  assert.equal(env.HOME, dir);
  assert.equal(env.DANIZEE_KIT_HOME, path.join(dir, 'kit-home'));
  const r = runStepScript(step('npm test'), { ...env, CI_TEST_COMMAND: 'echo "ok 1 - good"; echo "not ok 2 - bad"; exit 1' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /recorded in the kit index/);
  assert.ok(!fs.existsSync(path.join(dir, 'kit-home')), 'no index folder made (the index is off in the temp home)');
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

// Round 8: a test that starts code by path string (spawn, path.join, import) depends on that file.
test('testTargets: path strings passed to spawn, path.join and import count as dependencies (cli-check -> bin/cli.js, ci-job -> scripts/ci-step.js)', async () => {
  const { testTargets, spawnedPaths } = await import(pathToFileURL(path.join(root, 'scripts', 'ci-step.js')).href);
  const map = testTargets(root);
  const byId = (id) => map.find((x) => x.id === id);
  assert.ok(byId('test/reach/cli-check.test.js').files.includes('bin/cli.js'), 'cli-check.test.js starts bin/cli.js');
  assert.ok(byId('test/reach/ci-job.test.js').files.includes('scripts/ci-step.js'), 'ci-job.test.js runs scripts/ci-step.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-targets-'));
  fs.mkdirSync(path.join(dir, 'bin')); fs.mkdirSync(path.join(dir, 'scripts')); fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'bin', 'cli.js'), '');
  fs.writeFileSync(path.join(dir, 'scripts', 'tool.js'), '');
  fs.writeFileSync(path.join(dir, 'scripts', 'other.js'), '');
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), "spawnSync(process.execPath, ['bin/cli.js', 'x']); await import(path.join(root, 'scripts', 'tool.js')); path.join(root, 'nothing', 'here.js'); log('scripts/other.js');\n");
  const got = byId2(testTargets(dir), 'test/a.test.js');
  assert.deepEqual(got.files.sort(), ['bin/cli.js', 'scripts/tool.js', 'test/a.test.js'], 'spawn/join paths that resolve to a repo file count; a missing file and a plain log string do not');
  assert.deepEqual(spawnedPaths("execFile('../outside.js'); join('/etc', 'passwd')", dir), [], 'nothing outside the repo');
});
const byId2 = (map, id) => map.find((x) => x.id === id);
