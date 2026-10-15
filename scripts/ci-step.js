// CI helpers for .github/workflows/test.yml (job node-test). The workflow imports the kit modules and passes the entry
// functions in, so each step names its power and this file holds the logic:
//   planStep(planTests)        advisory: print which tests the change touches, with a reason per item. Never fails.
//   runStep(classify)          blocking: run the test command; only a product failure fails the job.
//   reportStep(renderJunit, renderSarif)  advisory: write the results as JUnit (and SARIF when tests failed) files. Never fails.
// No network, no token, nothing is posted anywhere: files are written locally and their paths printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const posix = (p) => p.split(path.sep).join('/');
const tmpRoot = (env) => env.RUNNER_TEMP || os.tmpdir();
export const outputFile = (env = process.env) => env.CI_TEST_OUTPUT || path.join(tmpRoot(env), 'test-output.txt');
export const resultsDir = (env = process.env) => env.CI_RESULTS_DIR || path.join(tmpRoot(env), 'test-results');

/** Local files each test file imports (relative specifiers only), as repo-relative paths. */
export function testTargets(cwd = process.cwd()) {
  const dir = path.join(cwd, 'test');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort() : [];
  return files.map((f) => {
    const id = `test/${f}`;
    const text = fs.readFileSync(path.join(dir, f), 'utf-8');
    const deps = new Set([id]);
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      deps.add(posix(path.relative(cwd, path.resolve(dir, m[1]))));
    }
    return { id, files: [...deps] };
  });
}

function changedFiles(env, cwd) {
  if (env.CI_CHANGED_FILES !== undefined) return env.CI_CHANGED_FILES.split('\n').map((s) => s.trim()).filter(Boolean);
  const r = spawnSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd, encoding: 'utf-8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Advisory. Prints the plan; any problem is printed as a note and the step still succeeds. */
export function planStep(planTests, { env = process.env, cwd = process.cwd(), log = console.log } = {}) {
  try {
    const changed = changedFiles(env, cwd);
    const plan = planTests({ targets: testTargets(cwd) }, changed ?? [], { emptySource: !changed || changed.length === 0 });
    log(`Test plan for this change: ${plan.plan.length} of ${plan.coverage.targets_total} test files, ${plan.coverage.changed_total} changed file(s), ${plan.coverage.changed_mapped} mapped to a test.`);
    if (!changed) log('note: could not read the change set from git (shallow checkout?); the smoke set below is a fallback.');
    if (plan.low_confidence) log(`low confidence: ${plan.low_confidence_reason}`);
    for (const item of plan.plan.slice(0, 40)) log(`  ${item.reason.padEnd(16)} ${item.id}${item.via ? `  (via ${[].concat(item.via).join(', ')})` : ''}`);
    if (plan.plan.length > 40) log(`  ... and ${plan.plan.length - 40} more`);
    log('This is a report only: the full test run below is unchanged.');
    return plan;
  } catch (e) {
    log(`test plan unavailable (${e.message}); the full test run below is unchanged.`);
    return null;
  }
}

/**
 * Blocking. Runs the test command (env CI_TEST_COMMAND, default `npm test`), tees its output to outputFile, and
 * decides with the exit-code contract. A nonzero exit that the contract calls infrastructure (timeout, signal,
 * crash, status >= 128) or a missing prerequisite (126/127) is reported as a warning and does not fail the job:
 * it says nothing about the product. Any other nonzero exit is the test runner's product verdict and fails it.
 * Resolves to the exit status the step should end with.
 */
export function runStep(classify, { env = process.env, log = console.log } = {}) {
  const command = env.CI_TEST_COMMAND || 'npm test';
  const out = fs.createWriteStream(outputFile(env));
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], env });
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { process.stdout.write(d); out.write(d); });
    child.on('error', (e) => { out.end(); log(`::warning::could not start "${command}": ${e.message} (infrastructure, not a product failure)`); resolve(0); });
    child.on('close', (code, signal) => {
      out.end();
      if (code === 0) return resolve(0);
      const c = classify({ code, signal });
      if (c.class === 'infrastructure' || c.class === 'precondition') {
        log(`::warning::"${command}" ended with ${signal ? `signal ${signal}` : `status ${code}`}: ${c.class}, not a product failure. ${c.description} The tests did not give a verdict; the job is not failed for this.`);
        return resolve(0);
      }
      log(`"${command}" failed with status ${code}: a product failure (${c.class}). The job fails.`);
      resolve(code || 1);
    });
  });
}

/** Failed and passed test names from the test runner's TAP or spec output (top-level entries only). */
export function parseResults(text) {
  const pass = new Set();
  const fail = new Set();
  for (const line of text.split('\n')) {
    let m = /^(not ok|ok) \d+ - (.+?)(?: # .*)?$/.exec(line);
    if (m) { (m[1] === 'ok' ? pass : fail).add(m[2].trim()); continue; }
    m = /^(✔|✖) (.+?)(?: \([\d.]+ms\))?$/.exec(line);
    if (m && !/^failing tests:?$/.test(m[2])) (m[1] === '✔' ? pass : fail).add(m[2].trim());
  }
  for (const n of fail) pass.delete(n);
  return { pass: [...pass], fail: [...fail] };
}

/** Advisory. Writes junit.xml (and results.sarif when a test failed) under resultsDir and prints the paths. */
export function reportStep(renderJunit, renderSarif, { env = process.env, log = console.log } = {}) {
  try {
    const file = outputFile(env);
    if (!fs.existsSync(file)) { log(`no test output at ${file}; no report written.`); return null; }
    const { pass, fail } = parseResults(fs.readFileSync(file, 'utf-8'));
    const input = {
      tool: 'node-test',
      tests: [...pass, ...fail].map((name) => ({ name, suite: 'node-test' })),
      findings: fail.map((name) => ({ message: `test failed: ${name}`, severity: 'blocking', id: 'test-failure', testCase: name, suite: 'node-test' }))
    };
    const dir = resultsDir(env);
    fs.mkdirSync(dir, { recursive: true });
    const written = [path.join(dir, 'junit.xml')];
    fs.writeFileSync(written[0], renderJunit(input));
    if (fail.length) {
      written.push(path.join(dir, 'results.sarif'));
      fs.writeFileSync(written[1], JSON.stringify(renderSarif(input), null, 2));
    }
    log(`test report: ${pass.length} passed, ${fail.length} failed.`);
    for (const w of written) log(`  wrote ${w}`);
    return written;
  } catch (e) {
    log(`test report unavailable (${e.message}).`);
    return null;
  }
}
