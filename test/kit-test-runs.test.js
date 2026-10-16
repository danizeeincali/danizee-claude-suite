// Test runs in the optional local kit index (src/lib/kit/test-runs.js; they live only there): local runs recorded by
// scripts/ci-step.js runStep, CI reports imported by `db import-reports` through a FAKE `gh` put first on PATH (never the
// real gh, never the network), the strict JUnit parser, `db status` reporting test runs and `db rebuild` keeping them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { run as db } from '../src/lib/kit/db.js';
import { withIndex, indexPaths } from '../src/lib/kit/store.js';
import { parseJunit, parseTap, parseTapSummary, MESSAGE_MAX, MAX_DEPTH, capBytes, ARTIFACT_MAX_BYTES, parseArtifactList } from '../src/lib/kit/test-runs.js';
import { renderJunit } from '../src/lib/kit/render.js';
import { runStep } from '../scripts/ci-step.js';

const NODE_SQLITE = (() => { try { createRequire(import.meta.url)('node:sqlite'); return true; } catch { return false; } })();
const ENGINE = { KIT_SQLITE_ENGINE: 'node:sqlite' };
// the index lives in a per-user folder: here a temporary one (one sub-folder per project)
process.env.DANIZEE_KIT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-home-'));
process.on('exit', () => { try { fs.rmSync(process.env.DANIZEE_KIT_HOME, { recursive: true, force: true }); } catch { /* best effort */ } });
const SECRET = 'project-secret-value-42';
const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

async function call(args, cwd, env = {}) {
  try { return { code: 0, out: await db(args, { cwd, env }) }; } catch (e) { return { code: e.code ?? 99, err: e.message }; }
}

/** A git project with a secrets file; the index on unless asked otherwise. */
async function project({ index = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-test-runs-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf-8' });
  g('init', '-q', '-b', 'feat/x');
  g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(dir, '.claude', 'kit'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'kit', 'secrets'), `${SECRET}\n`);
  if (index) { const r = await call(['init'], dir, ENGINE); assert.equal(r.code, 0, r.err); }
  return dir;
}
const rows = (dir, sql, ...ps) => withIndex({ cwd: dir, env: ENGINE }, (d) => d.all(sql, ...ps));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
/** The environment without this runner's NODE_TEST_CONTEXT, so a nested `node --test` prints its own report. */
const freshEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; };

describe('the JUnit parser is small and strict', () => {
  it('reads cases, suites, times, failures, skips and the five entities', () => {
    const r = parseJunit(`<?xml version="1.0"?>
<!-- a comment -->
<testsuites><testsuite name="s">
  <testcase name="a &amp; b" classname="s" file="test/a.test.js" time="0.25"/>
  <testcase name="c" classname="s"><failure message="boom &lt;1&gt;">trace &#65;&#x42;<![CDATA[ <raw> ]]></failure></testcase>
  <testcase name='d' classname="s"><skipped/></testcase>
</testsuite></testsuites>`);
    assert.equal(r.suites, 1);
    assert.deepEqual(r.cases.map((c) => [c.name, c.status, c.file, c.duration_ms]), [['a & b', 'pass', 'test/a.test.js', 250], ['c', 'fail', null, null], ['d', 'skip', null, null]]);
    assert.equal(r.cases[1].message, 'boom <1>\ntrace AB <raw>');
  });
  it('reads what the kit renderer writes', () => {
    const xml = renderJunit({ tool: 'node-test', tests: [{ name: 'ok one', suite: 'node-test' }, { name: 'bad "two"', suite: 'node-test' }], findings: [{ message: 'test failed: bad "two"', severity: 'blocking', id: 'test-failure', testCase: 'bad "two"', suite: 'node-test' }] });
    const r = parseJunit(xml);
    assert.deepEqual(r.cases.map((c) => [c.suite, c.name, c.status]), [['node-test', 'ok one', 'pass'], ['node-test', 'bad "two"', 'fail']]);
    assert.match(r.cases[1].message, /test failed: bad "two"/);
  });
  for (const [label, xml, re] of [
    ['a DOCTYPE', '<!DOCTYPE x [<!ENTITY e "boom">]><testsuites>&e;</testsuites>', /DOCTYPE/],
    ['an entity declaration', '<testsuites><!ENTITY e "x"></testsuites>', /DOCTYPE or declaration/],
    ['an unknown entity', '<testsuites><testsuite name="&e;"/></testsuites>', /predefined/],
    ['a bare ampersand', '<testsuites>a & b</testsuites>', /bare/],
    ['a mismatched end tag', '<testsuites><testsuite></testcase></testsuites>', /does not close/],
    ['an unclosed element', '<testsuites><testsuite>', /never closed/],
    ['too deep', '<a>'.repeat(MAX_DEPTH + 1), /deeper/],
    ['a repeated attribute', '<testsuites><testcase name="a" name="b"/></testsuites>', /repeated/],
    ['text outside the root', 'hello<testsuites/>', /outside/],
    ['an out-of-range character reference', '<testsuites name="&#0;"/>', /out of range/]
  ]) {
    it(`refuses ${label}`, () => assert.throws(() => parseJunit(xml), (e) => e.code === 1 && re.test(e.message)));
  }
});

describe('parseTap', () => {
  it('reads top-level cases with duration, file and the error message', () => {
    const tap = ['TAP version 13', '# Subtest: good', 'ok 1 - good', '  ---', '  duration_ms: 1.6', "  type: 'test'", '  ...',
      'not ok 2 - bad', '  ---', '  duration_ms: 2.4', "  location: '/w/proj/test/a.test.js:2:27'", "  error: 'it''s broken'", '  ...',
      'not ok 3 - multi', '  ---', '  error: |-', '    line one', '    line two', '  ...',
      'ok 4 - skipped # SKIP nah', '# Subtest: grp', '    # Subtest: inner', '    ok 1 - inner', '    1..1', 'ok 5 - grp', '  ---', "  type: 'suite'", '  ...', '1..5'].join('\n');
    assert.deepEqual(parseTap(tap, '/w/proj'), [
      { suite: null, name: 'good', file: null, status: 'pass', duration_ms: 2, message: null },
      { suite: null, name: 'bad', file: 'test/a.test.js', status: 'fail', duration_ms: 2, message: "it's broken" },
      { suite: null, name: 'multi', file: null, status: 'fail', duration_ms: null, message: 'line one\nline two' },
      { suite: null, name: 'skipped', file: null, status: 'skip', duration_ms: null, message: null },
      // a nested test is a case under its suite path; the describe() itself is not a case
      { suite: 'grp', name: 'inner', file: null, status: 'pass', duration_ms: null, message: null }
    ]);
  });

  it('two files with a same-named test, one failing: two cases, the failure kept, counts equal the summary', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-tap-'));
    try {
      const head = "const { test, describe, it } = require('node:test');\n";
      fs.writeFileSync(path.join(dir, 'a.test.js'), `${head}test('usage errors', () => { throw new Error('a broke'); });\ndescribe('grp', () => { it('x', () => {}); it('y', { skip: true }, () => {}); });\ntest('parent', async (t) => { await t.test('child', () => {}); });\ntest('later', { todo: true }, () => {});\n`);
      fs.writeFileSync(path.join(dir, 'b.test.js'), `${head}test('usage errors', () => {});\ndescribe('grp', () => { it('x', () => {}); });\n`);
      const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'a.test.js', 'b.test.js'], { cwd: dir, encoding: 'utf-8', env: freshEnv() });
      assert.equal(r.status, 1, r.stderr);
      const cases = parseTap(r.stdout, dir);
      const usage = cases.filter((c) => c.name === 'usage errors');
      assert.deepEqual(usage.map((c) => [c.status, c.file]), [['fail', 'a.test.js'], ['pass', null]]);
      assert.equal(usage[0].message, 'a broke');
      assert.deepEqual(cases.filter((c) => c.name === 'x').map((c) => c.suite), ['grp', 'grp']);
      const sum = parseTapSummary(r.stdout);
      const n = (st) => cases.filter((c) => c.status === st).length;
      assert.equal(cases.length, sum.tests);
      assert.equal(n('pass'), sum.pass);
      assert.equal(n('fail'), sum.fail + sum.cancelled);
      assert.equal(n('skip'), sum.skipped + sum.todo);
    } finally { rm(dir); }
  });

  it('the spec reporter fallback does not count the failing-tests recap twice', () => {
    const spec = ['✖ usage errors (1.2ms)', '✔ usage errors (0.4ms)', 'ℹ tests 2', 'ℹ pass 1', 'ℹ fail 1', '', '✖ failing tests:', '', '✖ usage errors (1.2ms)'].join('\n');
    assert.deepEqual(parseTap(spec).map((c) => [c.name, c.status]), [['usage errors', 'fail'], ['usage errors', 'pass']]);
    assert.deepEqual(parseTapSummary(spec), { tests: 2, pass: 1, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
    assert.equal(parseTapSummary('ok 1 - x'), null);
  });
  it('capBytes never splits a character', () => assert.equal(capBytes('aé', 2), 'a'));
});

describe('local runs: scripts/ci-step.js runStep records into the kit index', () => {
  const failing = (msg) => `printf '%s\\n' 'TAP version 13' 'ok 1 - good' 'not ok 2 - bad' '  ---' '  duration_ms: 3' "  error: '${msg}'" '  ...'; exit 1`;

  it('records branch, commit, status and cases; the message is redacted, credential-masked and capped; the exit status is unchanged', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    try {
      const out = path.join(dir, 'out.txt');
      const lines = [];
      const long = `${SECRET} ${TOKEN} ${'x'.repeat(6000)}`;
      const code = await runStep(() => ({ class: 'product' }), { cwd: dir, env: { ...process.env, ...ENGINE, CI_TEST_OUTPUT: out, CI_TEST_COMMAND: failing(long) }, log: (l) => lines.push(l) });
      assert.equal(code, 1);
      assert.ok(lines.some((l) => /^test run recorded in the kit index \(run 1, 2 cases, failed\)\.$/.test(l)), lines.join('\n'));
      const [run] = await rows(dir, 'SELECT * FROM test_runs');
      const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).stdout.trim();
      assert.equal(run.branch, 'feat/x');
      assert.equal(run.commit_sha, head);
      assert.equal(run.status, 'failed');
      assert.equal(run.source, 'local');
      assert.deepEqual([run.total, run.passed, run.failed], [2, 1, 1]);
      assert.ok(run.started_at <= run.finished_at);
      const cases = await rows(dir, 'SELECT name, status, duration_ms, message FROM test_cases ORDER BY id');
      assert.deepEqual(cases.map((c) => [c.name, c.status]), [['good', 'pass'], ['bad', 'fail']]);
      assert.equal(cases[1].duration_ms, 3);
      const msg = cases[1].message;
      assert.ok(!msg.includes(SECRET) && !msg.includes(TOKEN), msg.slice(0, 100));
      assert.match(msg, /\[credential\]/);
      assert.ok(Buffer.byteLength(msg) <= MESSAGE_MAX && Buffer.byteLength(msg) > 4000);
      assert.ok(!JSON.stringify(run).includes(SECRET));
    } finally { rm(dir); }
  });

  it('a real two-file run with a same-named failing test: the run counts equal the TAP summary', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    try {
      const head = "const { test } = require('node:test');\n";
      fs.writeFileSync(path.join(dir, 'a.test.js'), `${head}test('usage errors', () => { throw new Error('a broke'); });\n`);
      fs.writeFileSync(path.join(dir, 'b.test.js'), `${head}test('usage errors', () => {});\ntest('other', () => {});\n`);
      const cmd = `cd ${JSON.stringify(dir)} && ${JSON.stringify(process.execPath)} --test --test-reporter=tap a.test.js b.test.js`;
      const code = await runStep(() => ({}), { cwd: dir, env: { ...freshEnv(), ...ENGINE, CI_TEST_OUTPUT: path.join(dir, 'o.txt'), CI_TEST_COMMAND: cmd }, log: () => {} });
      assert.equal(code, 1);
      const [run] = await rows(dir, 'SELECT status, total, passed, failed, skipped FROM test_runs');
      assert.deepEqual([run.status, run.total, run.passed, run.failed, run.skipped], ['failed', 3, 2, 1, 0]);
      const cases = await rows(dir, "SELECT name, status, file FROM test_cases WHERE name = 'usage errors' ORDER BY id");
      assert.deepEqual(cases.map((c) => [c.status, c.file]), [['fail', 'a.test.js'], ['pass', null]]);
    } finally { rm(dir); }
  });

  it('a passing run is recorded as passed', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    try {
      const code = await runStep(() => ({}), { cwd: dir, env: { ...process.env, ...ENGINE, CI_TEST_OUTPUT: path.join(dir, 'o.txt'), CI_TEST_COMMAND: "echo 'ok 1 - fine'" }, log: () => {} });
      assert.equal(code, 0);
      assert.deepEqual((await rows(dir, 'SELECT status, total FROM test_runs')).map((r) => [r.status, r.total]), [['passed', 1]]);
    } finally { rm(dir); }
  });

  it('with the index off nothing is recorded, nothing is created and nothing is printed about it', async () => {
    const dir = await project({ index: false });
    try {
      const lines = [];
      const code = await runStep(() => ({ class: 'product' }), { cwd: dir, env: { ...process.env, CI_TEST_OUTPUT: path.join(dir, 'o.txt'), CI_TEST_COMMAND: failing('x') }, log: (l) => lines.push(l) });
      assert.equal(code, 1);
      assert.ok(!lines.some((l) => /kit index/.test(l)), lines.join('\n'));
      assert.ok(!fs.existsSync(indexPaths(dir).db));
      assert.ok(!fs.existsSync(indexPaths(dir).dir));
      assert.deepEqual(fs.readdirSync(path.join(dir, '.claude', 'kit')), ['secrets']);
    } finally { rm(dir); }
  });

  it('an index that cannot be written never changes the exit status: one line', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    try {
      for (const [cmd, want] of [[failing('x'), 1], ["echo 'ok 1 - fine'", 0]]) {
        const lines = [];
        const code = await runStep(() => ({ class: 'product' }), { cwd: dir, env: { ...process.env, KIT_SQLITE_ENGINE: 'none', CI_TEST_OUTPUT: path.join(dir, 'o.txt'), CI_TEST_COMMAND: cmd }, log: (l) => lines.push(l) });
        assert.equal(code, want);
        const notes = lines.filter((l) => /kit index/.test(l));
        assert.equal(notes.length, 1);
        assert.match(notes[0], /^test run not recorded in the kit index: .*optional dependency better-sqlite3/);
      }
    } finally { rm(dir); }
  });
});

// ---------------------------------------------------------------- import-reports with a fake gh

const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const root = process.env.FAKE_GH_ROOT; const a = process.argv.slice(2);
// the artifact size listing (gh api) is logged apart from the other calls
fs.appendFileSync(path.join(root, a[0] === 'api' ? 'api-calls.jsonl' : 'calls.jsonl'), JSON.stringify(a) + '\\n');
if (a[0] === 'api') {
  const m = /^repos\\/\\{owner\\}\\/\\{repo\\}\\/actions\\/runs\\/(\\d+)\\/artifacts\\?per_page=100$/.exec(a[1] || '');
  if (!m || a.length !== 2) { process.stderr.write('fake gh: bad api call\\n'); process.exit(2); }
  const src = path.join(root, 'artifacts', m[1]);
  const sizes = fs.existsSync(path.join(root, 'sizes.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'sizes.json'), 'utf-8')) : {};
  const du = (p) => { const st = fs.lstatSync(p); return st.isDirectory() ? fs.readdirSync(p).reduce((n, x) => n + du(path.join(p, x)), 0) : st.size; };
  const artifacts = fs.existsSync(src) ? fs.readdirSync(src).sort().map((n) => ({ name: n, size_in_bytes: sizes[m[1] + '/' + n] ?? du(path.join(src, n)), expired: false })) : [];
  process.stdout.write(JSON.stringify({ total_count: artifacts.length, artifacts })); process.exit(0);
}
if (a[0] === 'auth' && a[1] === 'status') { if (fs.existsSync(path.join(root, 'logged-out'))) { process.stderr.write('You are not logged into any GitHub hosts.\\n'); process.exit(1); } process.exit(0); }
if (a[0] === 'run' && a[1] === 'list') { process.stdout.write(fs.readFileSync(path.join(root, 'runs.json'))); process.exit(0); }
if (a[0] === 'run' && a[1] === 'download') {
  const id = a[2]; const dest = a[a.indexOf('-D') + 1]; const src = path.join(root, 'artifacts', id);
  if (!fs.existsSync(src)) { process.stderr.write('no valid artifacts found to download\\n'); process.exit(1); }
  if (a.includes('-n')) { fs.cpSync(path.join(src, a[a.indexOf('-n') + 1]), dest, { recursive: true, verbatimSymlinks: true }); process.exit(0); }
  for (const n of fs.readdirSync(src)) fs.cpSync(path.join(src, n), path.join(dest, n), { recursive: true, verbatimSymlinks: true });
  process.exit(0);
}
process.stderr.write('fake gh: unexpected ' + a.join(' ') + '\\n'); process.exit(2);
`;

const junit = (cases) => `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="node-test"><testsuite name="node-test">${cases}</testsuite></testsuites>\n`;

function fakeGh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'runs.json'), JSON.stringify([
    { databaseId: 303, headSha: 'c'.repeat(40), createdAt: '2026-10-16T12:00:00Z', conclusion: '', event: 'push', headBranch: 'feat/x' },
    { databaseId: 302, headSha: 'b'.repeat(40), createdAt: '2026-10-15T12:00:00Z', conclusion: 'failure', event: 'push', headBranch: 'feat/x' },
    { databaseId: 301, headSha: 'a'.repeat(40), createdAt: '2026-10-14T12:00:00Z', conclusion: 'success', event: 'push', headBranch: 'feat/x' },
    { databaseId: 300, headSha: '9'.repeat(40), createdAt: '2026-10-13T12:00:00Z', conclusion: 'success', event: 'push', headBranch: 'feat/x' },
    { databaseId: 'nope', headSha: 'x', createdAt: 'never', conclusion: 'success', event: 'push', headBranch: 'feat/x' }
  ]));
  const art = (id, name, file, text) => { const d = path.join(root, 'artifacts', String(id), name); fs.mkdirSync(d, { recursive: true }); if (text !== undefined) fs.writeFileSync(path.join(d, file), text); return d; };
  art(302, 'test-results-node-20', 'junit.xml', junit(`<testcase name="good" classname="node-test"/><testcase name="bad" classname="node-test"><failure message="test failed: bad ${SECRET} ${TOKEN}">${'y'.repeat(6000)}</failure></testcase>`));
  art(302, 'test-results-node-22', 'junit.xml', '<!DOCTYPE lol [<!ENTITY a "aaaa">]><testsuites>&a;</testsuites>');
  art(302, 'test-results-node-24', 'results.sarif', '{}');
  art(302, 'not-ours', 'junit.xml', junit('<testcase name="ignored"/>'));
  const d = art(301, 'test-results-node-20', 'junit.xml', junit('<testcase name="good" classname="node-test" time="0.5"/>'));
  const link = art(301, 'test-results-node-22');
  fs.symlinkSync(path.join(d, 'junit.xml'), path.join(link, 'junit.xml'));
  // run 300 has no artifacts (before the upload step existed)
  const env = { FAKE_GH_ROOT: root, PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`, ...ENGINE };
  const calls = () => fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  return { root, env, calls };
}

describe('db import-reports', () => {
  it('imports the newest finished runs once each, redacted and capped, through gh spawned without a shell', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      const r = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.branch, 'feat/x', 'default: the current git branch');
      assert.equal(r.out.runs_listed, 4);
      assert.deepEqual(r.out.imported.map((x) => [x.run_id, x.artifact, x.cases, x.failed]), [[302, 'test-results-node-20', 2, 1], [301, 'test-results-node-20', 1, 0]]);
      const why = Object.fromEntries(r.out.skipped.map((s) => [`${s.run_id}${s.artifact ? `/${s.artifact}` : ''}`, s.reason]));
      assert.equal(why['303'], 'not finished');
      assert.match(why['302/test-results-node-22'], /DOCTYPE/);
      assert.equal(why['302/test-results-node-24'], 'no junit.xml');
      assert.equal(why['301/test-results-node-22'], 'junit.xml not a regular file');
      assert.equal(why['300'], 'no test-results artifact');
      assert.ok(!Object.keys(why).some((k) => k.includes('not-ours')));

      const calls = gh.calls();
      assert.deepEqual(calls[0], ['auth', 'status']);
      // push runs only (a fork's pull_request run can carry the same head branch name)
      assert.deepEqual(calls[1], ['run', 'list', '--branch', 'feat/x', '--event', 'push', '--workflow', 'test.yml', '--limit', '5', '--json', 'databaseId,headSha,createdAt,conclusion,event,headBranch']);
      assert.deepEqual(calls.slice(2).map((c) => c.slice(0, 5)), ['302', '301', '300'].map((id) => ['run', 'download', id, '-p', 'test-results-*']));

      const runs = await rows(dir, 'SELECT * FROM test_runs ORDER BY id');
      assert.deepEqual(runs.map((x) => [x.branch, x.commit_sha.slice(0, 1), x.source, x.status, x.run_key, x.started_at]), [
        ['feat/x', 'b', 'ci:test-results-node-20', 'failed', '302/test-results-node-20', '2026-10-15T12:00:00.000Z'],
        ['feat/x', 'a', 'ci:test-results-node-20', 'passed', '301/test-results-node-20', '2026-10-14T12:00:00.000Z']
      ]);
      const [bad] = await rows(dir, "SELECT message FROM test_cases WHERE name = 'bad'");
      assert.ok(!bad.message.includes(SECRET) && !bad.message.includes(TOKEN));
      assert.ok(Buffer.byteLength(bad.message) <= MESSAGE_MAX);
      assert.equal((await rows(dir, "SELECT duration_ms FROM test_cases WHERE run_id = 2"))[0].duration_ms, 500);

      // again: nothing new, nothing downloaded for the imported runs
      const again = await call(['import-reports', '--branch', 'feat/x', '--limit', '5'], dir, gh.env);
      assert.equal(again.code, 0, again.err);
      assert.deepEqual(again.out.imported, []);
      assert.deepEqual(again.out.skipped.filter((s) => s.reason === 'already imported').map((s) => s.run_id), [302, 301]);
      assert.equal(gh.calls().filter((c) => c[1] === 'download').length, 4, 'only run 300 was asked for again');
      assert.equal((await rows(dir, 'SELECT COUNT(*) AS n FROM test_runs'))[0].n, 2);

      // db status: test runs per branch; db rebuild re-indexes the JSON files and keeps the test runs
      const st = await call(['status'], dir, ENGINE);
      assert.deepEqual(st.out.test_runs_by_branch, { 'feat/x': 2 });
      const rb = await call(['rebuild'], dir, ENGINE);
      assert.equal(rb.code, 0, rb.err);
      assert.equal(rb.out.rows.test_runs, 2);
      assert.equal(rb.out.rows.test_cases, 3);
    } finally { rm(dir); rm(gh.root); }
  });

  it('an artifact over the size cap is skipped before any download: its size is read with gh api first (review round 9)', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      fs.writeFileSync(path.join(gh.root, 'sizes.json'), JSON.stringify({ '302/test-results-node-20': ARTIFACT_MAX_BYTES + 1 }));
      const r = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.out.imported.map((x) => [x.run_id, x.artifact]), [[301, 'test-results-node-20']]);
      const big = r.out.skipped.find((s) => s.run_id === 302 && s.artifact === 'test-results-node-20');
      assert.equal(big.reason, `artifact is ${ARTIFACT_MAX_BYTES + 1} bytes, more than ${ARTIFACT_MAX_BYTES}: not downloaded`);
      const api = fs.readFileSync(path.join(gh.root, 'api-calls.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
      assert.deepEqual(api, ['302', '301', '300'].map((id) => ['api', `repos/{owner}/{repo}/actions/runs/${id}/artifacts?per_page=100`]));
      const downloads = gh.calls().filter((c) => c[1] === 'download');
      // run 302: only the small test-results artifacts, each by name; never the big one, never by pattern
      const of302 = downloads.filter((c) => c[2] === '302');
      assert.deepEqual(of302.map((c) => c.slice(0, 5)), [['run', 'download', '302', '-n', 'test-results-node-22'], ['run', 'download', '302', '-n', 'test-results-node-24']]);
      assert.ok(!downloads.some((c) => c.includes('test-results-node-20') && c[2] === '302'));
      assert.deepEqual(downloads.filter((c) => c[2] === '301').map((c) => c.slice(0, 5)), [['run', 'download', '301', '-p', 'test-results-*']]);
      // a listing gh cannot give, or one with more artifacts than one page: the run is skipped, nothing downloaded
      assert.throws(() => parseArtifactList('{"total_count": 150, "artifacts": []}'), /150 artifacts/);
      assert.throws(() => parseArtifactList('{"artifacts": [{"name": "test-results-x"}]}'), /without a name and size/);
      assert.throws(() => parseArtifactList('nope'), /not JSON/);
    } finally { rm(dir); rm(gh.root); }
  });

  it('db prune keeps the import key of a pruned CI run: the next import-reports neither downloads nor imports it again', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      const r = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.imported.length, 2);
      const p = await call(['prune', '--keep', '1'], dir, ENGINE);
      assert.equal(p.code, 0, p.err);
      assert.equal(p.out.pruned_runs, 1);
      assert.deepEqual((await rows(dir, 'SELECT run_key FROM test_runs')).map((x) => x.run_key), ['302/test-results-node-20']);
      const downloads = gh.calls().filter((c) => c[1] === 'download').length;
      const again = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(again.code, 0, again.err);
      assert.deepEqual(again.out.imported, [], 'the pruned run 301 is not imported again');
      assert.deepEqual(again.out.skipped.filter((s) => s.reason === 'already imported').map((s) => s.run_id), [302, 301]);
      assert.equal(gh.calls().filter((c) => c[1] === 'download').length, downloads + 1, 'only run 300 (no artifact) was asked for again');
      assert.equal((await rows(dir, 'SELECT COUNT(*) AS n FROM test_runs'))[0].n, 1, 'the prune stays done');
    } finally { rm(dir); rm(gh.root); }
  });

  it('only push runs of this branch are imported: a fork pull_request run with the same head branch is never downloaded', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      const runs = JSON.parse(fs.readFileSync(path.join(gh.root, 'runs.json'), 'utf-8'));
      runs.unshift(
        { databaseId: 310, headSha: 'd'.repeat(40), createdAt: '2026-10-16T13:00:00Z', conclusion: 'success', event: 'pull_request', headBranch: 'feat/x' },
        { databaseId: 311, headSha: 'e'.repeat(40), createdAt: '2026-10-16T14:00:00Z', conclusion: 'success', event: 'pull_request_target', headBranch: 'feat/x' },
        { databaseId: 312, headSha: 'f'.repeat(40), createdAt: '2026-10-16T15:00:00Z', conclusion: 'success', headBranch: 'feat/x' },
        { databaseId: 313, headSha: '1'.repeat(40), createdAt: '2026-10-16T16:00:00Z', conclusion: 'success', event: 'push', headBranch: 'main' }
      );
      fs.writeFileSync(path.join(gh.root, 'runs.json'), JSON.stringify(runs));
      for (const id of [310, 311, 312, 313]) {
        const d = path.join(gh.root, 'artifacts', String(id), 'test-results-node-20');
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'junit.xml'), junit('<testcase name="poisoned" classname="node-test"/>'));
      }
      const r = await call(['import-reports', '--branch', 'feat/x', '--limit', '10'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.out.imported.map((x) => x.run_id), [302, 301]);
      for (const id of [310, 311, 312, 313]) assert.ok(r.out.skipped.some((x) => x.run_id === id && /not a push run/.test(x.reason)), String(id));
      const calls = gh.calls();
      assert.ok(calls[1].includes('--event') && calls[1][calls[1].indexOf('--event') + 1] === 'push');
      assert.ok(calls[1][calls[1].indexOf('--json') + 1].split(',').includes('event'));
      assert.ok(!calls.some((c) => c[1] === 'download' && ['310', '311', '312', '313'].includes(c[2])), 'a foreign run is never downloaded');
      assert.equal((await rows(dir, "SELECT COUNT(*) AS n FROM test_cases WHERE name = 'poisoned'"))[0].n, 0);
    } finally { rm(dir); rm(gh.root); }
  });

  it('needs the index on: exit 1 naming db init (gh is never called)', async () => {
    const dir = await project({ index: false });
    const gh = fakeGh();
    try {
      const r = await call(['import-reports', '--branch', 'main'], dir, gh.env);
      assert.equal(r.code, 1);
      assert.match(r.err, /`db init`/);
      assert.ok(!fs.existsSync(path.join(gh.root, 'calls.jsonl')));
    } finally { rm(dir); rm(gh.root); }
  });

  it('gh missing or not logged in: exit 1 naming gh auth login', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-gh-'));
    try {
      let r = await call(['import-reports', '--branch', 'main'], dir, { ...ENGINE, PATH: empty });
      assert.equal(r.code, 1);
      assert.match(r.err, /not installed or not on PATH.*`gh auth login`/);
      fs.writeFileSync(path.join(gh.root, 'logged-out'), '');
      r = await call(['import-reports', '--branch', 'main'], dir, gh.env);
      assert.equal(r.code, 1);
      assert.match(r.err, /not logged in.*run `gh auth login`/);
      assert.deepEqual(gh.calls(), [['auth', 'status']]);
    } finally { rm(dir); rm(gh.root); rm(empty); }
  });

  it('bad flags are exit 1', async () => {
    const dir = await project({ index: false });
    try {
      for (const args of [['import-reports', '--limit', '0'], ['import-reports', '--limit', '101'], ['import-reports', '--limit', 'x'], ['import-reports', '--branch'], ['import-reports', '--keep', '2'], ['prune', '--branch', 'x']]) {
        assert.equal((await call(args, dir)).code, 1, args.join(' '));
      }
      const r = await call(['import-reports', '--branch', '--upload-pack=x'], dir);
      assert.equal(r.code, 1);
    } finally { rm(dir); }
  });

  it('a branch that looks like a flag is refused before gh runs', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      const r = await call(['import-reports', '--branch', '-x'], dir, gh.env);
      assert.equal(r.code, 1);
      assert.match(r.err, /--branch must be a git branch name/);
      assert.ok(!fs.existsSync(path.join(gh.root, 'calls.jsonl')));
    } finally { rm(dir); rm(gh.root); }
  });
});
