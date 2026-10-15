// CI helpers for .github/workflows/test.yml (job node-test). The workflow imports the kit modules and passes the entry
// functions in, so each step names its power and this file holds the logic:
//   planStep(planTests)        advisory: print which tests the change touches, with a reason per item. Never fails.
//   runStep(classify)          blocking, fails closed: any nonzero exit of the test command fails; classify only labels the failure.
//   reportStep(renderJunit, renderSarif)  advisory: write the results as JUnit (and SARIF when tests failed) files. Never fails.
// No network, no token, nothing is posted anywhere: files are written locally and their paths printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const posix = (p) => p.split(path.sep).join('/');
const tmpRoot = (env) => env.RUNNER_TEMP || os.tmpdir();
export const outputFile = (env = process.env) => env.CI_TEST_OUTPUT || path.join(tmpRoot(env), 'test-output.txt');
export const resultsDir = (env = process.env) => env.CI_RESULTS_DIR || path.join(tmpRoot(env), 'test-results');

/** Local files each test file imports (relative specifiers only), as repo-relative paths. */
export function testTargets(cwd = process.cwd()) {
  const out = [];
  for (const sub of ['test', 'test/reach']) {
    const dir = path.join(cwd, sub);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort() : [];
    for (const f of files) {
      const id = `${sub}/${f}`;
      const text = fs.readFileSync(path.join(dir, f), 'utf-8');
      const deps = new Set([id]);
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        deps.add(posix(path.relative(cwd, path.resolve(dir, m[1]))));
      }
      out.push({ id, files: [...deps] });
    }
  }
  return out;
}

// `node scripts/ci-step.js --print-targets` prints the test map {"targets":[...]} that CI passes to test-plan, so a workflow can
// generate it mechanically instead of writing it by hand.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--print-targets') {
  process.stdout.write(`${JSON.stringify({ targets: testTargets() }, null, 2)}\n`);
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
 * Blocking, and fail closed. Runs the test command (env CI_TEST_COMMAND, default `npm test`), tees its output to
 * outputFile, and fails the step on ANY nonzero exit. The exit-code contract (classify) is called only to label the
 * failure in the ::error:: annotation, so a reader can tell a product failure from an infrastructure one (timeout,
 * killed by a signal: rerun) or a precondition one (the test command could not start). `npm test` is not a kit verb,
 * so no class is trusted to mean "the product is fine": a run that gave no verdict must not turn the job green.
 * Resolves to the exit status the step should end with.
 */
export function runStep(classify, { env = process.env, log = console.log } = {}) {
  const command = env.CI_TEST_COMMAND || 'npm test';
  const out = fs.createWriteStream(outputFile(env));
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], env });
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { process.stdout.write(d); out.write(d); });
    child.on('error', (e) => { out.end(); log(`::error::precondition: the test command could not start: "${command}": ${e.message}. The job fails; check the test script and the node install.`); resolve(1); });
    child.on('close', (code, signal) => {
      out.end();
      if (code === 0) return resolve(0);
      const c = classify({ code, signal });
      const ended = signal ? `signal ${signal}` : `status ${code}`;
      // Only a timeout (124), a signal death or a status >= 128 is labelled "timed out / killed by a signal"; any other status gets the neutral label.
      const killed = Boolean(signal) || code === 124 || code >= 128;
      const label = c.class === 'infrastructure' && !killed ? `infrastructure: test command failed with status ${code}`
        : c.class === 'infrastructure' ? 'infrastructure: timed out / killed by a signal, rerun'
        : c.class === 'precondition' ? (code === 126 || code === 127 ? 'precondition: the test command could not start' : `precondition: test command failed with status ${code}`)
        : 'product failure: tests failed';
      const next = c.class === 'infrastructure' ? 'rerun the job'
        : c.class === 'precondition' ? 'check the test script and the node install'
        : 'see the failing tests above';
      log(`::error::"${command}" ended with ${ended}: ${label}. The job fails; ${next}.`);
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
