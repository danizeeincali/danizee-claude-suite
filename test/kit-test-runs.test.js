// Test runs in the optional local kit index (src/lib/kit/test-runs.js; they live only there): local runs recorded by
// scripts/ci-step.js runStep, CI reports imported by `db import-reports` through a FAKE `gh` put first on PATH (never the
// real gh, never the network), the strict JUnit parser, `db status` reporting test runs and `db rebuild` keeping them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { run as db } from '../src/lib/kit/db.js';
import { withIndex, indexPaths, indexUsedBytes, diskFullReason, MAX_INDEX_DISK_BYTES } from '../src/lib/kit/store.js';
import { parseJunit, parseTap, parseTapSummary, MESSAGE_MAX, MAX_DEPTH, capBytes, ARTIFACT_MAX_BYTES, ARTIFACTS_PER_RUN, IMPORT_MAX_BYTES, JUNIT_MAX_BYTES, ZIP_MAX_RATIO, parseArtifactList, readJunitFromZip, recordRun, SECRETS_MAX_BYTES, MAX_CASES, IMPORT_MAX_CASES, PROJECT_MAX_CASES, parseRemoteUrl, displayUrl, canonicalHost, TRUNCATED, NAME_MAX, TEST_RUNS_MAX_BYTES, OUTPUT_MAX_BYTES, testRunBytes, printable, remoteLabel } from '../src/lib/kit/test-runs.js';
import { renderJunit } from '../src/lib/kit/render.js';
import { runStep, recordStep, readBounded } from '../scripts/ci-step.js';

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
  g('remote', 'add', 'origin', 'https://github.com/o/r.git');
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
      assert.ok(Buffer.byteLength(msg) <= MESSAGE_MAX && Buffer.byteLength(msg) > MESSAGE_MAX - 20, String(Buffer.byteLength(msg)));
      assert.ok(msg.endsWith(TRUNCATED), 'a cut message says so');
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

// Artifacts are zip files (root/artifacts/<run>/<name>.zip) with ids (root/ids.json), of the repository o/r (the projects'
// remote). The listing (gh api repos/o/r/actions/runs/<id>/artifacts) is logged in api-calls.jsonl; everything else (zip
// downloads included) in calls.jsonl; every call's folder, GH_REPO, GH_HOST and whether an enterprise token variable was
// passed in cwds.jsonl.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const root = process.env.FAKE_GH_ROOT; const a = process.argv.slice(2);
const listing = a[0] === 'api' && /^repos\\/o\\/r\\/actions\\/runs\\/(\\d+)\\/artifacts\\?per_page=100$/.exec(a[1] || '');
const zip = a[0] === 'api' && /^repos\\/o\\/r\\/actions\\/artifacts\\/(\\d+)\\/zip$/.exec(a[1] || '');
fs.appendFileSync(path.join(root, listing ? 'api-calls.jsonl' : 'calls.jsonl'), JSON.stringify(a) + '\\n');
fs.appendFileSync(path.join(root, 'cwds.jsonl'), JSON.stringify([process.cwd(), process.env.GH_REPO || null, process.env.GH_HOST || null, Boolean(process.env.GH_ENTERPRISE_TOKEN || process.env.GITHUB_ENTERPRISE_TOKEN)]) + '\\n');
const ids = fs.existsSync(path.join(root, 'ids.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'ids.json'), 'utf-8')) : {};
if (a[0] === 'api') {
  if (a.length !== 2 || !(listing || zip)) { process.stderr.write('fake gh: bad api call\\n'); process.exit(2); }
  if (listing) {
    const src = path.join(root, 'artifacts', listing[1]);
    const sizes = fs.existsSync(path.join(root, 'sizes.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'sizes.json'), 'utf-8')) : {};
    const artifacts = fs.existsSync(src) ? fs.readdirSync(src).sort().map((f) => { const n = f.replace(/\\.zip$/, ''); const k = listing[1] + '/' + n; return { id: ids[k], name: n, size_in_bytes: sizes[k] ?? fs.statSync(path.join(src, f)).size, expired: false }; }) : [];
    process.stdout.write(JSON.stringify({ total_count: artifacts.length, artifacts })); process.exit(0);
  }
  const k = Object.keys(ids).find((x) => String(ids[x]) === zip[1]);
  if (!k) { process.stderr.write('HTTP 404: Not Found\\n'); process.exit(1); }
  const failing = fs.existsSync(path.join(root, 'fail-ids.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'fail-ids.json'), 'utf-8')) : [];
  if (failing.includes(Number(zip[1]))) { process.stderr.write('HTTP 502: Bad Gateway\\n'); process.exit(1); }
  process.stdout.write(fs.readFileSync(path.join(root, 'artifacts', k + '.zip')));
  return;
}
if (a[0] === 'auth' && a[1] === 'status') { if (fs.existsSync(path.join(root, 'logged-out'))) { process.stderr.write('You are not logged into any GitHub hosts.\\n'); process.exit(1); } process.exit(0); }
if (a[0] === 'run' && a[1] === 'list') { process.stdout.write(fs.readFileSync(path.join(root, 'runs.json'))); process.exit(0); }
if (a[0] === 'repo' && a[1] === 'view' && fs.existsSync(path.join(root, 'default-branch'))) { process.stdout.write(JSON.stringify({ defaultBranchRef: { name: fs.readFileSync(path.join(root, 'default-branch'), 'utf-8').trim() } })); process.exit(0); }
process.stderr.write('fake gh: unexpected ' + a.join(' ') + '\\n'); process.exit(2);
`;

const junit = (cases) => `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="node-test"><testsuite name="node-test">${cases}</testsuite></testsuites>\n`;

/**
 * A zip archive written here, byte by byte (so it can lie): entries { name, data, method (8 deflate, 0 stored),
 * raw (the compressed bytes as given), usize (the declared uncompressed size), mode (unix mode), flags, crc }.
 */
function makeZip(entries) {
  const locals = []; const centrals = []; let off = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '');
    const method = e.method ?? 8;
    const comp = e.raw ?? (method === 8 ? zlib.deflateRawSync(data) : data);
    const crc = (e.crc ?? zlib.crc32(data)) >>> 0;
    const usize = e.usize ?? data.length;
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.flags ?? 0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.flags ?? 0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((e.mode ?? 0o100644) * 65536) >>> 0, 38); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, comp); centrals.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

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
  const ids = {};
  /** An artifact zip of a run, with its id; entries as makeZip takes them (or a Buffer: the whole download). */
  const art = (run, name, entries) => {
    const d = path.join(root, 'artifacts', String(run));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${name}.zip`), Buffer.isBuffer(entries) ? entries : makeZip(entries));
    ids[`${run}/${name}`] = run * 100 + Object.keys(ids).filter((k) => k.startsWith(`${run}/`)).length + 1;
    fs.writeFileSync(path.join(root, 'ids.json'), JSON.stringify(ids));
    return ids[`${run}/${name}`];
  };
  art(302, 'test-results-node-20', [{ name: 'junit.xml', data: junit(`<testcase name="good" classname="node-test"/><testcase name="bad" classname="node-test"><failure message="test failed: bad ${SECRET} ${TOKEN}">${'y'.repeat(6000)}</failure></testcase>`) }, { name: 'results.sarif', data: '{}' }]);
  art(302, 'test-results-node-22', [{ name: 'junit.xml', data: '<!DOCTYPE lol [<!ENTITY a "aaaa">]><testsuites>&a;</testsuites>' }]);
  art(302, 'test-results-node-24', [{ name: 'results.sarif', data: '{}' }]);
  art(302, 'not-ours', [{ name: 'junit.xml', data: junit('<testcase name="ignored"/>') }]);
  art(301, 'test-results-node-20', [{ name: 'junit.xml', data: junit('<testcase name="good" classname="node-test" time="0.5"/>'), method: 0 }]);
  // a symbolic link entry named junit.xml: never followed, never read as a report
  art(301, 'test-results-node-22', [{ name: 'junit.xml', data: '/etc/passwd', mode: 0o120777 }]);
  // run 300 has no artifacts (before the upload step existed)
  const env = { FAKE_GH_ROOT: root, PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`, ...ENGINE };
  const lines = (f) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const calls = () => lines('calls.jsonl');
  /** The artifact ids downloaded (gh api .../artifacts/<id>/zip), in order. */
  const zips = () => calls().filter((c) => c[0] === 'api').map((c) => Number(/artifacts\/(\d+)\/zip$/.exec(c[1])[1]));
  const listings = () => lines('api-calls.jsonl').map((c) => Number(/runs\/(\d+)\//.exec(c[1])[1]));
  return { root, env, calls, zips, listings, ids, art };
}

/** db with io extras (importLimits: the download caps, lowered for a test). */
async function callIo(args, cwd, env, extra) {
  try { return { code: 0, out: await db(args, { cwd, env, ...extra }) }; } catch (e) { return { code: e.code ?? 99, err: e.message }; }
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
      assert.deepEqual(calls[0], ['auth', 'status', '--hostname', 'github.com']);
      // push runs only (a fork's pull_request run can carry the same head branch name)
      assert.deepEqual(calls[1], ['run', 'list', '-R', 'github.com/o/r', '--branch', 'feat/x', '--event', 'push', '--workflow', 'test.yml', '--limit', '5', '--json', 'databaseId,headSha,createdAt,conclusion,event,headBranch']);
      // each test-results artifact by its id, after its run's listing (sizes and ids); never `gh run download`, never not-ours
      assert.deepEqual(gh.listings(), [302, 301, 300]);
      const ids = gh.ids;
      assert.deepEqual(gh.zips(), ['302/test-results-node-20', '302/test-results-node-22', '302/test-results-node-24', '301/test-results-node-20', '301/test-results-node-22'].map((k) => ids[k]));
      assert.ok(calls.slice(2).every((c) => c.length === 2 && c[0] === 'api' && /^repos\/o\/r\/actions\/artifacts\/\d+\/zip$/.test(c[1])), JSON.stringify(calls));
      assert.ok(!calls.some((c) => c[1] === 'download'));

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
      // checked per artifact (review wt-2b M1): an imported one is never downloaded again, the ones that failed are retried
      assert.deepEqual(again.out.skipped.filter((s) => s.reason === 'already imported').map((s) => s.artifact), ['test-results-node-20', 'test-results-node-20']);
      assert.deepEqual(gh.zips().slice(5), ['302/test-results-node-22', '302/test-results-node-24', '301/test-results-node-22'].map((k) => ids[k]), 'only the artifacts that failed are downloaded again');
      assert.ok(!gh.zips().slice(5).some((id) => [ids['302/test-results-node-20'], ids['301/test-results-node-20']].includes(id)), 'nothing imported is downloaded again');
      assert.deepEqual(gh.listings(), [302, 301, 300, 302, 301, 300]);
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
      assert.deepEqual(api, ['302', '301', '300'].map((id) => ['api', `repos/o/r/actions/runs/${id}/artifacts?per_page=100`]));
      // run 302: only the small test-results artifacts, each by its id; never the big one
      const ids = gh.ids;
      assert.deepEqual(gh.zips(), [ids['302/test-results-node-22'], ids['302/test-results-node-24'], ids['301/test-results-node-20'], ids['301/test-results-node-22']]);
      assert.ok(!gh.zips().includes(ids['302/test-results-node-20']));
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
      const downloads = gh.zips().length;
      const again = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(again.code, 0, again.err);
      assert.deepEqual(again.out.imported, [], 'the pruned run 301 is not imported again');
      assert.deepEqual(again.out.skipped.filter((s) => s.reason === 'already imported').map((s) => s.run_id), [302, 301]);
      const ids = gh.ids;
      assert.ok(!gh.zips().slice(downloads).some((id) => [ids['302/test-results-node-20'], ids['301/test-results-node-20']].includes(id)), 'the imported (and the pruned) artifacts are not downloaded again');
      assert.deepEqual(gh.zips().slice(downloads), ['302/test-results-node-22', '302/test-results-node-24', '301/test-results-node-22'].map((k) => ids[k]), 'only the ones that failed are retried');
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
      const poisoned = [310, 311, 312, 313].map((id) => gh.art(id, 'test-results-node-20', [{ name: 'junit.xml', data: junit('<testcase name="poisoned" classname="node-test"/>') }]));
      const r = await call(['import-reports', '--branch', 'feat/x', '--limit', '10'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.out.imported.map((x) => x.run_id), [302, 301]);
      for (const id of [310, 311, 312, 313]) assert.ok(r.out.skipped.some((x) => x.run_id === id && /not a push run/.test(x.reason)), String(id));
      const calls = gh.calls();
      assert.ok(calls[1].includes('--event') && calls[1][calls[1].indexOf('--event') + 1] === 'push');
      assert.ok(calls[1][calls[1].indexOf('--json') + 1].split(',').includes('event'));
      assert.ok(!gh.zips().some((id) => poisoned.includes(id)), 'a foreign run is never downloaded');
      assert.ok(!gh.listings().some((id) => [310, 311, 312, 313].includes(id)), 'nor listed');
      assert.equal((await rows(dir, "SELECT COUNT(*) AS n FROM test_cases WHERE name = 'poisoned'"))[0].n, 0);
    } finally { rm(dir); rm(gh.root); }
  });

  it('crafted artifacts through gh: a zip bomb, traversal names, a download past its size and junk are refused; nothing is written by entry name (review wt-1a)', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-zip-outside-'));
    try {
      const runs = [{ databaseId: 400, headSha: 'd'.repeat(40), createdAt: '2026-10-17T12:00:00Z', conclusion: 'success', event: 'push', headBranch: 'feat/x' }];
      fs.writeFileSync(path.join(gh.root, 'runs.json'), JSON.stringify(runs));
      const big = Buffer.alloc(16 * 1024 * 1024, 0x3c);
      gh.art(400, 'test-results-bomb', [{ name: 'junit.xml', data: big }]);
      gh.art(400, 'test-results-liar', [{ name: 'junit.xml', data: big, usize: 100 }]);
      gh.art(400, 'test-results-paths', ['../junit.xml', '../../junit.xml', path.join(outside, 'junit.xml'), 'a/../junit.xml', 'sub/junit.xml', './junit.xml']
        .map((name) => ({ name, data: junit('<testcase name="escaped"/>') })));
      gh.art(400, 'test-results-junk', Buffer.from('this is not a zip archive at all, only text'));
      gh.art(400, 'test-results-twice', [{ name: 'junit.xml', data: junit('<testcase name="a"/>') }, { name: 'junit.xml', data: junit('<testcase name="b"/>') }]);
      const r = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.out.imported, []);
      const why = Object.fromEntries(r.out.skipped.map((x) => [x.artifact, x.reason]));
      assert.match(why['test-results-bomb'], new RegExp(`expand \\d+ times, more than ${ZIP_MAX_RATIO}: refused`));
      assert.equal(why['test-results-liar'], `junit.xml larger than ${JUNIT_MAX_BYTES} bytes`, 'the inflate is bounded whatever the directory says');
      assert.equal(why['test-results-paths'], 'no junit.xml');
      assert.equal(why['test-results-junk'], 'not a zip archive');
      assert.match(why['test-results-twice'], /more than one junit\.xml/);
      assert.deepEqual(fs.readdirSync(outside), [], 'nothing written outside');
      assert.ok(!fs.existsSync(path.join(path.dirname(dir), 'junit.xml')) && !fs.existsSync(path.join(dir, 'junit.xml')) && !fs.existsSync(path.join(dir, 'sub')));
      assert.equal((await rows(dir, "SELECT COUNT(*) AS n FROM test_cases WHERE name = 'escaped'"))[0].n, 0);
      assert.ok(!fs.readdirSync(os.tmpdir()).some((f) => f.startsWith('kit-import-reports-') && fs.existsSync(path.join(os.tmpdir(), f, 'junit.xml'))));

      // the list says 10 bytes, the download goes on: cut off at the cap, not read
      fs.writeFileSync(path.join(gh.root, 'runs.json'), JSON.stringify([{ ...runs[0], databaseId: 401 }]));
      const noise = crypto.randomBytes(8000).toString('hex');
      gh.art(401, 'test-results-long', [{ name: 'junit.xml', data: junit(`<testcase name="x"><failure message="${noise}"/></testcase>`), method: 0 }]);
      fs.writeFileSync(path.join(gh.root, 'sizes.json'), JSON.stringify({ '401/test-results-long': 10 }));
      const r2 = await callIo(['import-reports', '--limit', '5'], dir, gh.env, { importLimits: { artifactBytes: 4096 } });
      assert.equal(r2.code, 0, r2.err);
      assert.deepEqual(r2.out.imported, []);
      assert.deepEqual(r2.out.skipped, [{ run_id: 401, artifact: 'test-results-long', reason: 'download passed 4096 bytes (the artifact list said 10): stopped, not read' }]);
      // limits from io only ever lower the caps
      const r3 = await callIo(['import-reports', '--limit', '5'], dir, gh.env, { importLimits: { artifactBytes: ARTIFACT_MAX_BYTES * 10 } });
      assert.equal(r3.out.imported.length, 1, 'the default cap: the 16 KB artifact is read');
    } finally { rm(dir); rm(gh.root); rm(outside); }
  });

  it(`at most ${ARTIFACTS_PER_RUN} artifacts per run and ${IMPORT_MAX_BYTES} bytes per call are downloaded; the rest are listed as skipped`, { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      fs.writeFileSync(path.join(gh.root, 'runs.json'), JSON.stringify([500, 501].map((id) => ({ databaseId: id, headSha: 'e'.repeat(40), createdAt: '2026-10-17T12:00:00Z', conclusion: 'success', event: 'push', headBranch: 'feat/x' }))));
      for (let i = 0; i < ARTIFACTS_PER_RUN + 2; i++) gh.art(500, `test-results-n${i}`, [{ name: 'junit.xml', data: junit(`<testcase name="t${i}"/>`) }]);
      const r = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.imported.length, ARTIFACTS_PER_RUN);
      assert.deepEqual(r.out.skipped.filter((x) => /more than 5 test-results artifacts in this run: not downloaded/.test(x.reason)).map((x) => x.artifact), ['test-results-n5', 'test-results-n6']);
      assert.equal(gh.zips().length, ARTIFACTS_PER_RUN);

      // a call's budget: once used up, later artifacts are not downloaded
      for (let i = 0; i < 3; i++) gh.art(501, `test-results-m${i}`, [{ name: 'junit.xml', data: junit(`<testcase name="m${i}"/>`), method: 0 }]);
      const one = fs.statSync(path.join(gh.root, 'artifacts', '501', 'test-results-m0.zip')).size;
      const both = fs.readFileSync(path.join(gh.root, 'runs.json'));
      fs.writeFileSync(path.join(gh.root, 'runs.json'), JSON.stringify(JSON.parse(both).filter((x) => x.databaseId === 501)));
      const before = gh.zips().length;
      const r2 = await callIo(['import-reports', '--limit', '5'], dir, gh.env, { importLimits: { totalBytes: one * 2 + 10 } });
      assert.equal(r2.code, 0, r2.err);
      assert.deepEqual(r2.out.imported.map((x) => x.artifact), ['test-results-m0', 'test-results-m1']);
      assert.deepEqual(r2.out.skipped.filter((x) => x.run_id === 501), [{ run_id: 501, artifact: 'test-results-m2', reason: `the download budget of one import (${one * 2 + 10} bytes) is used up: not downloaded` }]);
      assert.equal(gh.zips().length, before + 2);

      // the artifacts left out by a cap are not 'already imported': the next import gets them (review wt-2b M1)
      fs.writeFileSync(path.join(gh.root, 'runs.json'), both);
      const r3 = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(r3.code, 0, r3.err);
      assert.deepEqual(r3.out.imported.map((x) => x.artifact), ['test-results-n5', 'test-results-n6', 'test-results-m2']);
      assert.equal(r3.out.skipped.filter((x) => x.reason === 'already imported').length, ARTIFACTS_PER_RUN + 2);
    } finally { rm(dir); rm(gh.root); }
  });

  it('no push runs on the branch: says so and names the default branch to try (gh repo view, else main) (review wt-1b L3)', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      fs.writeFileSync(path.join(gh.root, 'runs.json'), '[]');
      let r = await call(['import-reports'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.runs_listed, 0);
      assert.equal(r.out.hint, 'no push runs of test.yml on feat/x: CI test results come from push runs, which run on main; try --branch main');
      fs.writeFileSync(path.join(gh.root, 'default-branch'), 'trunk\n');
      r = await call(['import-reports'], dir, gh.env);
      assert.match(r.out.hint, /run on trunk; try --branch trunk$/);
      assert.ok(gh.calls().some((c) => c[0] === 'repo' && c[1] === 'view'));
      r = await call(['import-reports', '--branch', 'trunk'], dir, gh.env);
      assert.equal(r.out.hint, 'no push runs of test.yml on trunk yet');
      // with runs: no hint
      fs.writeFileSync(path.join(gh.root, 'runs.json'), JSON.stringify([{ databaseId: 300, headSha: '9'.repeat(40), createdAt: '2026-10-13T12:00:00Z', conclusion: 'success', event: 'push', headBranch: 'feat/x' }]));
      r = await call(['import-reports'], dir, gh.env);
      assert.equal(r.out.hint, undefined);
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
      assert.deepEqual(gh.calls(), [['auth', 'status', '--hostname', 'github.com']]);
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

describe('readJunitFromZip reads the central directory itself (node:zlib only)', () => {
  const doc = junit('<testcase name="ok"/>');
  it('reads junit.xml at the root, stored or deflated', () => {
    for (const method of [0, 8]) assert.deepEqual(readJunitFromZip(makeZip([{ name: 'results.sarif', data: '{}' }, { name: 'junit.xml', data: doc, method }])), { text: doc });
  });
  for (const [label, entries, re] of [
    ['an entry declaring more than 64 MB', [{ name: 'other.bin', data: 'x', usize: 65 * 1024 * 1024 }], /more than 67108864: refused/],
    ['an entry expanding more than the ratio', [{ name: 'other.bin', data: Buffer.alloc(4 * 1024 * 1024) }], /expand \d+ times/],
    ['a junit.xml over 5 MB (stored)', [{ name: 'junit.xml', data: Buffer.from(`<a>${'x '.repeat(3 * 1024 * 1024)}</a>`), method: 0 }], /junit\.xml larger than 5242880 bytes/],
    ['a smaller declared size than inflated', [{ name: 'junit.xml', data: doc, usize: 10 }], /not the size its zip directory declares/],
    ['a bad CRC', [{ name: 'junit.xml', data: doc, crc: 1 }], /CRC/],
    ['an encrypted entry', [{ name: 'junit.xml', data: doc, flags: 1 }], /encrypted/],
    ['a link entry', [{ name: 'junit.xml', data: '/etc/passwd', mode: 0o120777 }], /not a regular file/],
    ['a directory entry', [{ name: 'junit.xml', data: '', mode: 0o040755 }], /not a regular file/],
    ['an unknown method', [{ name: 'junit.xml', data: doc, method: 12 }], /compression method 12/],
    ['damaged deflate data', [{ name: 'junit.xml', data: doc, raw: Buffer.from([0xff, 0xff, 0xff, 0xff]) }], /cannot be inflated/]
  ]) {
    it(`refuses ${label}`, () => {
      const r = readJunitFromZip(makeZip(entries));
      assert.ok(r.error && re.test(r.error), JSON.stringify(r));
    });
  }
  it('a zip64 marker, a multi-part archive, a damaged directory and too many entries are not read', () => {
    const z = makeZip([{ name: 'junit.xml', data: doc }]);
    const at = z.length - 22;
    const edit = (off, v, bytes = 2) => { const c = Buffer.from(z); if (bytes === 2) c.writeUInt16LE(v, at + off); else c.writeUInt32LE(v, at + off); return c; };
    assert.match(readJunitFromZip(edit(16, 0xffffffff, 4)).error, /zip64/);
    assert.match(readJunitFromZip(edit(4, 1)).error, /multi-part/);
    assert.match(readJunitFromZip(edit(16, 5, 4)).error, /damaged/);
    const many = makeZip(Array.from({ length: 1001 }, (_, i) => ({ name: `f${i}`, data: '', method: 0 })));
    assert.match(readJunitFromZip(many).error, /more than 1000 entries/);
    assert.deepEqual(readJunitFromZip(makeZip([{ name: 'JUNIT.XML', data: doc }, { name: '/junit.xml', data: doc }, { name: 'x/junit.xml', data: doc }])), { missing: true });
  });
});

describe('readJunitFromZip and archives made by real tools (review wt-2b L4)', () => {
  const doc = junit(Array.from({ length: 50 }, (_, i) => `<testcase name="t${i}" classname="node-test" time="0.01"/>`).join(''));
  const HAS_ZIP = spawnSync('zip', ['-v'], { encoding: 'utf-8' }).status === 0;
  it('a Unix entry with permission bits and no file-type bits (Python writestr) is a regular file', () => {
    assert.deepEqual(readJunitFromZip(makeZip([{ name: 'junit.xml', data: doc, mode: 0o600 }])), { text: doc });
    assert.match(readJunitFromZip(makeZip([{ name: 'junit.xml', data: '/etc/passwd', mode: 0o120777 }])).error, /not a regular file/);
  });
  it('reads what the zip tool makes: a plain archive, -fd (data descriptors) and one streamed to a pipe', { skip: !HAS_ZIP }, () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-real-zip-'));
    try {
      fs.writeFileSync(path.join(d, 'junit.xml'), doc);
      fs.writeFileSync(path.join(d, 'results.sarif'), '{}');
      const made = {};
      for (const [label, file, args] of [['plain', 'a.zip', ['junit.xml', 'results.sarif']], ['fd', 'b.zip', ['-fd', 'results.sarif', 'junit.xml']]]) {
        const r = spawnSync('zip', ['-q', file, ...args], { cwd: d });
        assert.equal(r.status, 0, String(r.stderr));
        made[label] = fs.readFileSync(path.join(d, file));
      }
      const piped = spawnSync('zip', ['-q', '-', 'junit.xml'], { cwd: d, maxBuffer: 1024 * 1024 });
      assert.equal(piped.status, 0, String(piped.stderr));
      made.pipe = piped.stdout;
      // general purpose flag bit 3 (sizes in a data descriptor after the data) in the -fd and piped archives
      const flagOf = (buf) => buf.readUInt16LE(buf.indexOf(Buffer.from('PK\x03\x04', 'latin1')) + 6);
      assert.equal(flagOf(made.fd) & 8, 8);
      assert.equal(flagOf(made.pipe) & 8, 8);
      for (const [label, buf] of Object.entries(made)) assert.deepEqual(readJunitFromZip(buf), { text: doc }, label);
    } finally { rm(d); }
  });
});

describe('import-reports and recordRun: no program from the project, git through safe-git, bounded secrets (review wt-2a-2 / wt-2a-3, wt-2b M1 / L5)', () => {
  const DB = JSON.stringify(new URL('../src/lib/kit/db.js', import.meta.url).href);
  const TR = JSON.stringify(new URL('../src/lib/kit/test-runs.js', import.meta.url).href);
  const IMPORT = (args) => `const { run } = await import(${DB}); try { console.log(JSON.stringify({ code: 0, out: await run(${JSON.stringify(args)}, { cwd: process.cwd() }) })); } catch (e) { console.log(JSON.stringify({ code: e.code, err: e.message })); }`;
  const RECORD = `const { recordRun } = await import(${TR}); const t = new Date().toISOString(); try { console.log(JSON.stringify({ code: 0, out: await recordRun({ cwd: process.cwd() }, { output: 'ok 1 - a\\n', code: 0, started_at: t, finished_at: t }) })); } catch (e) { console.log(JSON.stringify({ code: e.code, err: e.message })); }`;
  /** Run `code` in a child node (so a hang is a timeout, not a stuck test runner): { res, stderr, ms, killed }. */
  const child = (code, cwd, env) => {
    const t = Date.now();
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, env: { ...process.env, ...env }, encoding: 'utf-8', timeout: 60000, killSignal: 'SIGKILL' });
    const last = String(r.stdout).trim().split('\n').pop();
    let res = null;
    try { res = JSON.parse(last); } catch { /* none */ }
    return { res, stderr: String(r.stderr).split('\n').filter((l) => l && !/ExperimentalWarning|--trace-warnings/.test(l)).join('\n'), ms: Date.now() - t, killed: r.signal === 'SIGKILL' };
  };
  const runRows = (dir) => rows(dir, 'SELECT branch, commit_sha FROM test_runs ORDER BY id');

  it('a gh or git in the project folder is never run, even with . and an empty entry first on PATH', { skip: !NODE_SQLITE, timeout: 120000 }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      for (const name of ['gh', 'git']) fs.writeFileSync(path.join(dir, name), `#!/bin/sh\\ntouch ${JSON.stringify(path.join(dir, `MARKER-${name}`))}\\nexit 0\\n`, { mode: 0o755 });
      const env = { ...gh.env, PATH: `.${path.delimiter}${path.delimiter}${gh.env.PATH}` };
      const imp = child(IMPORT(['import-reports', '--limit', '5']), dir, env);
      assert.equal(imp.res?.code, 0, JSON.stringify(imp));
      assert.equal(imp.res.out.branch, 'feat/x', 'the branch, read through safe-git');
      assert.equal(imp.res.out.imported.length, 2);
      const rec = child(RECORD, dir, env);
      assert.equal(rec.res?.code, 0, JSON.stringify(rec));
      assert.equal(rec.res.out.recorded, true);
      const [local] = await rows(dir, "SELECT branch, commit_sha FROM test_runs WHERE source = 'local'");
      assert.deepEqual([local.branch, local.commit_sha], ['feat/x', spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).stdout.trim()]);
      assert.ok(!fs.existsSync(path.join(dir, 'MARKER-gh')) && !fs.existsSync(path.join(dir, 'MARKER-git')), 'nothing from the project folder ran');
      assert.deepEqual(gh.calls()[0], ['auth', 'status', '--hostname', 'github.com'], 'the gh on PATH ran');
    } finally { rm(dir); rm(gh.root); }
  });

  it('a repository config [include] path naming a FIFO hangs neither import-reports nor recordRun', { skip: !NODE_SQLITE, timeout: 180000 }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      assert.equal(spawnSync('mkfifo', [path.join(dir, '.git', 'inc')]).status, 0);
      fs.appendFileSync(path.join(dir, '.git', 'config'), '[include]\n\tpath = inc\n');
      // (plain git in this folder would now block on the FIFO: nothing below may run it)
      const imp = child(IMPORT(['import-reports', '--limit', '5']), dir, gh.env);
      assert.ok(!imp.killed && imp.ms < 30000, `import-reports took ${imp.ms} ms`);
      assert.equal(imp.res?.code, 0, JSON.stringify(imp));
      assert.equal(imp.res.out.branch, 'feat/x');
      const rec = child(RECORD, dir, gh.env);
      assert.ok(!rec.killed && rec.ms < 30000, `recordRun took ${rec.ms} ms`);
      assert.equal(rec.res?.code, 0, JSON.stringify(rec));
      assert.equal(rec.res.out.recorded, true);
    } finally { rm(dir); rm(gh.root); }
  });

  it('a secrets file that is a FIFO, a link or too large fails closed: import-reports exits 1 naming it, recordRun stores nothing with one stderr line (review wt-3a L3 / wt-3b L3)', { skip: !NODE_SQLITE, timeout: 180000 }, async () => {
    const dir = await project();
    const gh = fakeGh();
    const secrets = path.join(dir, '.claude', 'kit', 'secrets');
    const shared = path.join(gh.root, 'shared-secrets');
    fs.writeFileSync(shared, `${SECRET}\n`);
    try {
      for (const [label, make, reason] of [
        ['fifo', () => assert.equal(spawnSync('mkfifo', [secrets]).status, 0), 'not a regular file'],
        ['link', () => fs.symlinkSync(shared, secrets), 'a symbolic link'],
        ['dangling link', () => fs.symlinkSync(path.join(gh.root, 'nowhere'), secrets), 'a symbolic link'],
        ['large', () => { fs.writeFileSync(secrets, ''); fs.truncateSync(secrets, SECRETS_MAX_BYTES + 1); }, `larger than ${SECRETS_MAX_BYTES} bytes`]
      ]) {
        fs.rmSync(secrets, { force: true });
        make();
        const imp = child(IMPORT(['import-reports', '--branch', 'feat/x', '--limit', '5']), dir, gh.env);
        assert.ok(!imp.killed && imp.ms < 30000, `${label} import: ${imp.ms} ms`);
        assert.equal(imp.res?.code, 1, `${label} import: ${JSON.stringify(imp)}`);
        assert.ok(imp.res.err.startsWith(`the secrets file ${fs.realpathSync(dir)}${path.sep}.claude${path.sep}kit${path.sep}secrets cannot be read safely (${reason})`), imp.res.err);
        assert.ok(!fs.existsSync(path.join(gh.root, 'calls.jsonl')), `${label}: gh is never called`);
        const rec = child(RECORD, dir, gh.env);
        assert.ok(!rec.killed && rec.ms < 30000, `${label} recordRun: ${rec.ms} ms`);
        assert.equal(rec.res?.code, 0, `${label} recordRun: ${JSON.stringify(rec)}`);
        assert.equal(rec.res.out.recorded, false);
        const notes = rec.stderr.split('\n').filter(Boolean);
        assert.equal(notes.length, 1, `${label} recordRun: ${rec.stderr}`);
        assert.match(notes[0], /^kit: test run not recorded in the kit index: the secrets file .* cannot be read safely/);
        assert.ok(notes[0].includes(`(${reason})`), notes[0]);
      }
      assert.equal((await rows(dir, 'SELECT COUNT(*) AS n FROM test_runs'))[0].n, 0, 'nothing stored without the secrets');
      // runStep: the step's exit status is unchanged, and it says nothing more than recordRun's one line
      for (const [cmd, want] of [["echo 'not ok 1 - x'; exit 1", 1], ["echo 'ok 1 - fine'", 0]]) {
        const lines = [];
        const code = await runStep(() => ({ class: 'product' }), { cwd: dir, env: { ...process.env, ...ENGINE, CI_TEST_OUTPUT: path.join(gh.root, 'o.txt'), CI_TEST_COMMAND: cmd }, log: (l) => lines.push(l) });
        assert.equal(code, want);
        assert.ok(!lines.some((l) => /kit index/.test(l)), lines.join('\n'));
      }
      // a regular secrets file again: recorded, and redacted
      fs.rmSync(secrets, { force: true });
      fs.writeFileSync(secrets, `${SECRET}\n`);
      const rec = await recordRun({ cwd: dir, env: ENGINE }, { output: `not ok 1 - leaks ${SECRET}\n`, code: 1, started_at: '2026-10-16T00:00:00Z', finished_at: '2026-10-16T00:00:01Z' });
      assert.equal(rec.recorded, true);
      assert.ok(!JSON.stringify(await rows(dir, 'SELECT name FROM test_cases')).includes(SECRET));
    } finally { rm(dir); rm(gh.root); }
  });

  it('an artifact whose download failed is retried by the next import; the imported one is not downloaded again (M1)', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      fs.writeFileSync(path.join(gh.root, 'runs.json'), JSON.stringify([{ databaseId: 101, headSha: 'a'.repeat(40), createdAt: '2026-10-17T12:00:00Z', conclusion: 'success', event: 'push', headBranch: 'feat/x' }]));
      const a = gh.art(101, 'test-results-node-20', [{ name: 'junit.xml', data: junit('<testcase name="a"/>') }]);
      const b = gh.art(101, 'test-results-node-22', [{ name: 'junit.xml', data: junit('<testcase name="b"/>') }]);
      fs.writeFileSync(path.join(gh.root, 'fail-ids.json'), JSON.stringify([b]));
      const r1 = await call(['import-reports'], dir, gh.env);
      assert.equal(r1.code, 0, r1.err);
      assert.deepEqual(r1.out.imported.map((x) => x.artifact), ['test-results-node-20']);
      assert.match(r1.out.skipped.find((x) => x.artifact === 'test-results-node-22').reason, /^download failed: HTTP 502/);
      fs.rmSync(path.join(gh.root, 'fail-ids.json'));
      const r2 = await call(['import-reports'], dir, gh.env);
      assert.equal(r2.code, 0, r2.err);
      assert.deepEqual(r2.out.imported.map((x) => x.artifact), ['test-results-node-22']);
      assert.deepEqual(r2.out.skipped, [{ run_id: 101, artifact: 'test-results-node-20', reason: 'already imported' }]);
      assert.deepEqual(gh.zips(), [a, b, b]);
    } finally { rm(dir); rm(gh.root); }
  });

  it('no commits yet and a detached HEAD: import-reports says which and asks for --branch; recordRun records (no commits yet) / (detached) (L5)', { skip: !NODE_SQLITE }, async () => {
    const gh = fakeGh();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-test-runs-unborn-'));
    const det = await project();
    try {
      spawnSync('git', ['init', '-q', '-b', 'feat/y'], { cwd: dir });
      assert.equal((await call(['init'], dir, ENGINE)).code, 0);
      let r = await call(['import-reports'], dir, gh.env);
      assert.equal(r.code, 1);
      assert.equal(r.err, 'cannot tell the current git branch (no commits yet): pass --branch <b>');
      let rec = await recordRun({ cwd: dir, env: ENGINE }, { output: 'ok 1 - a\n', code: 0, started_at: '2026-10-16T00:00:00Z', finished_at: '2026-10-16T00:00:01Z' });
      assert.equal(rec.recorded, true);
      assert.deepEqual((await runRows(dir)).map((x) => [x.branch, x.commit_sha]), [['(no commits yet)', null]]);

      spawnSync('git', ['checkout', '-q', '--detach'], { cwd: det });
      r = await call(['import-reports'], det, gh.env);
      assert.equal(r.code, 1);
      assert.equal(r.err, 'cannot tell the current git branch (HEAD is detached (detached)): pass --branch <b>');
      rec = await recordRun({ cwd: det, env: ENGINE }, { output: 'ok 1 - a\n', code: 0, started_at: '2026-10-16T00:00:00Z', finished_at: '2026-10-16T00:00:01Z' });
      assert.equal(rec.recorded, true);
      const [run] = await runRows(det);
      assert.equal(run.branch, '(detached)');
      assert.equal(run.commit_sha, spawnSync('git', ['rev-parse', 'HEAD'], { cwd: det, encoding: 'utf-8' }).stdout.trim());
      assert.ok(!fs.existsSync(path.join(gh.root, 'calls.jsonl')), 'gh is never called without a branch');
    } finally { rm(dir); rm(det); rm(gh.root); }
  });
});

describe('import-reports: bounded work per call and per project, gh never in the project (review wt-3a M1 / L4)', () => {
  /** n runs of `per` artifacts, each a junit.xml of `cases` test cases (the reviewer's shape, at a reduced scale). */
  function manyRuns(gh, n, per, cases, from = 1000) {
    const runs = [];
    for (let r = from; r < from + n; r++) {
      runs.push({ databaseId: r, headSha: 'a'.repeat(40), createdAt: new Date(Date.UTC(2026, 9, 1) + r * 60000).toISOString(), conclusion: 'success', event: 'push', headBranch: 'feat/x' });
      for (let k = 0; k < per; k++) {
        gh.art(r, `test-results-n${k}`, [{ name: 'junit.xml', data: junit(Array.from({ length: cases }, (_, i) => `<testcase classname="s${'a'.repeat(60)}" name="t${r}-${k}-${i}"/>`).join('')) }]);
      }
    }
    fs.writeFileSync(path.join(gh.root, 'runs.json'), JSON.stringify(runs.reverse()));
  }

  it('each artifact is stored as it is read; at most `cases` per call (the rest: later calls), and the project ceiling stops the import with a note naming db prune', { skip: !NODE_SQLITE, timeout: 120000 }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      manyRuns(gh, 10, 5, 20);
      const limits = { importLimits: { artifactCases: 20, cases: 60, projectCases: 150 } };
      const count = async () => Number((await rows(dir, 'SELECT COUNT(*) AS n FROM test_cases'))[0].n);
      let r = await callIo(['import-reports', '--limit', '10'], dir, gh.env, limits);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.imported.length, 3);
      assert.equal(await count(), 60);
      assert.equal(gh.zips().length, 3, 'once the call\'s case budget is used up nothing more is downloaded');
      const budget = r.out.skipped.filter((x) => /^the case budget of one import \(60 test cases\) is used up: not downloaded \(a later import takes it\)$/.test(x.reason));
      assert.equal(budget.length, 47);
      assert.equal(r.out.note, undefined);
      r = await callIo(['import-reports', '--limit', '10'], dir, gh.env, limits);
      assert.equal(r.out.imported.length, 3);
      assert.equal(await count(), 120);
      // 120 stored: one more artifact fits under 150, the next would pass it: the import stops, with a note
      r = await callIo(['import-reports', '--limit', '10'], dir, gh.env, limits);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.imported.length, 1);
      assert.equal(await count(), 140);
      assert.match(r.out.note, /^the index holds 140 test cases; at most 150 are kept per project, so the import stopped: run `db prune --keep <n>`/);
      const downloads = gh.zips().length;
      r = await callIo(['import-reports', '--limit', '10'], dir, gh.env, limits);
      assert.equal(r.out.imported.length, 0);
      assert.match(r.out.note, /db prune/);
      assert.equal(gh.zips().length, downloads + 1, 'stopped after the first artifact that would not fit');
      // db prune makes room; the next import goes on
      const p = await call(['prune', '--keep', '2'], dir, ENGINE);
      assert.equal(p.code, 0, p.err);
      assert.equal(await count(), 40);
      r = await callIo(['import-reports', '--limit', '10'], dir, gh.env, limits);
      assert.equal(r.out.imported.length, 3);
      assert.equal(r.out.note, undefined);
      // over the per-artifact case cap: refused, never stored
      manyRuns(gh, 1, 1, 21, 5000);
      r = await callIo(['import-reports', '--limit', '1'], dir, gh.env, limits);
      assert.deepEqual(r.out.skipped, [{ run_id: 5000, artifact: 'test-results-n0', reason: 'junit.xml: more than 20 test cases' }]);
    } finally { rm(dir); rm(gh.root); }
  });

  it('the case caps: per artifact <= per call <= per project', () => {
    assert.equal(MAX_CASES, 20000);
    assert.equal(IMPORT_MAX_CASES, 200000);
    assert.equal(PROJECT_MAX_CASES, 1000000);
    assert.ok(MAX_CASES <= IMPORT_MAX_CASES && IMPORT_MAX_CASES <= PROJECT_MAX_CASES);
  });

  it('another writer of the index is not locked out while an import downloads', { skip: !NODE_SQLITE, timeout: 120000 }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      manyRuns(gh, 2, 2, 5);
      // the fake gh writes a lesson through the kit (its own process, a 2 s busy wait) during every download
      const CLI = JSON.stringify(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'lib', 'kit', 'cli.js'));
      const hook = `if (zip) { const r = require('child_process').spawnSync(process.execPath, [${CLI}, 'reflect', 'lessons', 'save', '--role', 'r', '--session', 's' + zip[1], '--text', 'Lesson number ' + zip[1] + ' about checking every exit status.', '--distinct'], { cwd: process.env.KIT_PROJECT, encoding: 'utf-8' }); fs.appendFileSync(path.join(root, 'writer.jsonl'), JSON.stringify(r.stderr) + '\\n'); }\n`;
      const ghFile = path.join(gh.root, 'bin', 'gh');
      fs.writeFileSync(ghFile, fs.readFileSync(ghFile, 'utf-8').replace("if (a[0] === 'api') {", `${hook}if (a[0] === 'api') {`));
      const r = await call(['import-reports', '--limit', '5'], dir, { ...gh.env, KIT_PROJECT: dir });
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.imported.length, 4);
      const writer = fs.readFileSync(path.join(gh.root, 'writer.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(writer.length, 4);
      assert.ok(writer.every((e) => !/kit index: not updated/.test(e)), writer.join('\n'));
      assert.equal((await rows(dir, 'SELECT COUNT(*) AS n FROM lessons'))[0].n, 4);
    } finally { rm(dir); rm(gh.root); }
  });

  it('the repository comes from remote.origin.url read as data; gh runs outside the project with it named (-R, GH_REPO, explicit API paths)', { skip: !NODE_SQLITE, timeout: 120000 }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      const r = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.repo, 'o/r');
      const cwds = fs.readFileSync(path.join(gh.root, 'cwds.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
      const real = fs.realpathSync(dir);
      assert.ok(cwds.length > 3);
      for (const [cwd, repo] of cwds) {
        assert.ok(!cwd.startsWith(real + path.sep) && !cwd.startsWith(dir + path.sep) && cwd !== real && cwd !== dir, `gh ran in ${cwd}`);
        assert.ok(path.basename(cwd).startsWith('kit-import-reports-'), cwd);
        assert.equal(repo, 'github.com/o/r');
      }
      assert.ok(gh.calls().filter((c) => c[0] === 'api').every((c) => c[1].startsWith('repos/o/r/')));

      const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf-8' });
      // a GitHub Enterprise remote in scp form: refused unless the user names its host (--host); then -R host/owner/repo, GH_HOST
      g('remote', 'set-url', 'origin', 'git@ghe.example.com:o/r.git');
      fs.rmSync(path.join(gh.root, 'calls.jsonl'));
      const refused = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(refused.code, 1);
      assert.match(refused.err, /the origin remote is on ghe\.example\.com, not github\.com: .*rerun with --host <host> yourself/);
      assert.ok(!refused.err.includes('--host ghe.example.com'), 'the remote\'s host is never offered as a ready flag');
      assert.ok(!fs.existsSync(path.join(gh.root, 'calls.jsonl')), 'gh is never called');
      fs.rmSync(path.join(gh.root, 'cwds.jsonl'));
      const e = await call(['import-reports', '--limit', '5', '--host', 'ghe.example.com'], dir, gh.env);
      assert.equal(e.code, 0, e.err);
      assert.equal(e.out.repo, 'ghe.example.com/o/r');
      assert.deepEqual(gh.calls()[1].slice(0, 4), ['run', 'list', '-R', 'ghe.example.com/o/r']);
      for (const [, repo, host] of fs.readFileSync(path.join(gh.root, 'cwds.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l))) {
        assert.equal(repo, 'ghe.example.com/o/r');
        assert.equal(host, 'ghe.example.com');
      }
      // no remote, or one that does not name owner/repo: exit 1 before gh runs
      for (const [setup, re] of [
        [() => g('remote', 'set-url', 'origin', 'https://github.com/o/r;touch x'), /cannot tell the GitHub repository from the remote URL/],
        [() => g('remote', 'set-url', 'origin', '/srv/git/r.git'), /cannot tell the GitHub repository from the remote URL/],
        [() => g('remote', 'remove', 'origin'), /needs the GitHub repository: no git remote/]
      ]) {
        setup();
        fs.rmSync(path.join(gh.root, 'calls.jsonl'), { force: true });
        const bad = await call(['import-reports', '--branch', 'feat/x'], dir, gh.env);
        assert.equal(bad.code, 1);
        assert.match(bad.err, re);
        assert.ok(!fs.existsSync(path.join(gh.root, 'calls.jsonl')), 'gh is never called');
      }
      // not a git repository at all
      const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-test-runs-plain-'));
      try {
        assert.equal((await call(['init'], plain, ENGINE)).code, 0);
        const np = await call(['import-reports', '--branch', 'main'], plain, gh.env);
        assert.equal(np.code, 1);
        assert.match(np.err, /needs a git repository with a GitHub remote/);
      } finally { rm(plain); }
    } finally { rm(dir); rm(gh.root); }
  });

  it('parseRemoteUrl: the forms git writes, and nothing else', () => {
    const ok = { host: 'github.com', owner: 'o-1', repo: 'r.js' };
    for (const u of ['https://github.com/o-1/r.js.git', 'https://github.com/o-1/r.js', 'https://user@github.com/o-1/r.js/', 'ssh://git@github.com/o-1/r.js.git', 'ssh://git@github.com:22/o-1/r.js', 'git@github.com:o-1/r.js.git', 'github.com:o-1/r.js', 'git://github.com/o-1/r.js.git', 'HTTPS://GitHub.com/o-1/r.js'.replace('HTTPS', 'https')]) {
      assert.deepEqual(parseRemoteUrl(u), ok, u);
    }
    assert.deepEqual(parseRemoteUrl('git@github-work:o/r.git'), { host: 'github-work', owner: 'o', repo: 'r' });
    for (const u of ['', '/srv/r.git', 'file:///srv/o/r.git', 'https://github.com/o/r/extra', 'https://github.com/o', 'https://github.com/../r', 'https://github.com/o/r;x', 'git@github.com:/o/r', 'https://github.com/o/r x', 'ext::sh -c touch% /tmp/x', 'https://-x/o/r']) {
      assert.equal(parseRemoteUrl(u), null, u);
    }
  });
});

describe('import-reports: the repository never chooses the host gh talks to (review wt-4a H1 / L1 / L2, wt-4b M1 / L2 / L3)', () => {
  const g = (dir, ...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf-8' });
  /** Every gh call's [cwd, GH_REPO, GH_HOST, enterprise token passed] (see FAKE_GH). */
  const ghEnvs = (gh) => (fs.existsSync(path.join(gh.root, 'cwds.jsonl')) ? fs.readFileSync(path.join(gh.root, 'cwds.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const spawned = (gh) => fs.existsSync(path.join(gh.root, 'cwds.jsonl')) || fs.existsSync(path.join(gh.root, 'calls.jsonl')) || fs.existsSync(path.join(gh.root, 'api-calls.jsonl'));
  const reset = (gh) => { for (const f of ['cwds.jsonl', 'calls.jsonl', 'api-calls.jsonl']) fs.rmSync(path.join(gh.root, f), { force: true }); };
  const HOSTILE = { GH_HOST: 'evil.example.com', GH_ENTERPRISE_TOKEN: 'ENTERPRISE-SECRET-123', GITHUB_ENTERPRISE_TOKEN: 'ENTERPRISE-SECRET-456' };

  it('a remote on another host is exit 1 naming the host and --host, and gh is never spawned, whatever GH_HOST says', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      for (const url of ['https://evil.example.com/o/r.git', 'git@evil.example.com:o/r.git', 'ssh://git@evil.example.com:2222/o/r.git', 'https://10.0.0.1/o/r.git', 'https://gitlab.com/o/r.git']) {
        g(dir, 'remote', 'set-url', 'origin', url);
        for (const env of [gh.env, { ...gh.env, ...HOSTILE }]) {
          reset(gh);
          const r = await call(['import-reports', '--branch', 'feat/x'], dir, env);
          assert.equal(r.code, 1, url);
          const host = parseRemoteUrl(url).host;
          assert.ok(r.err.includes(`the origin remote is on ${host}, not github.com`), r.err);
          // the remote's host is never pre-filled into the flag (an agent would just rerun with it): the user names it
          assert.ok(!r.err.includes(`--host ${host}`), r.err);
          assert.ok(r.err.includes('rerun with --host <host> yourself'), r.err);
          assert.ok(r.err.includes('an agent must ask the user before passing --host'), r.err);
          assert.ok(!/gh auth login/.test(r.err), r.err);
          assert.ok(!spawned(gh), `gh was spawned for ${url}`);
        }
      }
    } finally { rm(dir); rm(gh.root); }
  });

  it('github.com: GH_HOST is always set to github.com (an inherited one is ignored), -R and GH_REPO are host-qualified, no enterprise token is passed', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      for (const url of ['https://github.com/o/r.git', 'ssh://git@ssh.github.com:443/o/r.git', 'git@www.github.com:o/r.git']) {
        g(dir, 'remote', 'set-url', 'origin', url);
        reset(gh);
        const r = await call(['import-reports', '--limit', '5'], dir, { ...gh.env, ...HOSTILE });
        assert.equal(r.code, 0, `${url}: ${r.err}`);
        assert.equal(r.out.repo, 'o/r');
        assert.equal(r.out.repo_from, 'the origin remote');
        const envs = ghEnvs(gh);
        assert.ok(envs.length > 3);
        for (const [, repo, host, token] of envs) {
          assert.equal(host, 'github.com');
          assert.equal(repo, 'github.com/o/r');
          assert.equal(token, false, 'no enterprise token reaches gh for github.com');
        }
        assert.deepEqual(gh.calls()[1].slice(0, 4), ['run', 'list', '-R', 'github.com/o/r']);
      }
    } finally { rm(dir); rm(gh.root); }
  });

  it('--host <h> is the only way to another host: it must match the remote (else --repo), GH_HOST is set to it, and the login hint names it', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      g(dir, 'remote', 'set-url', 'origin', 'https://ghe.corp.example/team/r.git');
      reset(gh);
      const r = await call(['import-reports', '--limit', '5', '--host', 'GHE.corp.example'], dir, { ...gh.env, ...HOSTILE });
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.repo, 'ghe.corp.example/team/r');
      for (const [, repo, host, token] of ghEnvs(gh)) {
        assert.equal(host, 'ghe.corp.example');
        assert.equal(repo, 'ghe.corp.example/team/r');
        assert.equal(token, true, 'the user named this host: its token is theirs to send');
      }
      assert.deepEqual(gh.calls()[1].slice(0, 4), ['run', 'list', '-R', 'ghe.corp.example/team/r']);
      // the remote on github.com, --host another: refused before gh
      g(dir, 'remote', 'set-url', 'origin', 'https://github.com/o/r.git');
      reset(gh);
      let bad = await call(['import-reports', '--branch', 'feat/x', '--host', 'ghe.corp.example'], dir, gh.env);
      assert.equal(bad.code, 1);
      assert.match(bad.err, /the origin remote is on github\.com, not on --host ghe\.corp\.example: pass --repo <owner>\/<repo>/);
      assert.ok(!spawned(gh));
      // --host with --repo: no remote is read
      const r2 = await call(['import-reports', '--branch', 'feat/x', '--host', 'ghe.corp.example', '--repo', 'team/r'], dir, gh.env);
      assert.equal(r2.code, 0, r2.err);
      assert.equal(r2.out.repo, 'ghe.corp.example/team/r');
      assert.equal(r2.out.repo_from, '--repo');
      // not logged in to that host: the hint names it
      fs.writeFileSync(path.join(gh.root, 'logged-out'), '');
      bad = await call(['import-reports', '--branch', 'feat/x', '--host', 'ghe.corp.example', '--repo', 'team/r'], dir, gh.env);
      assert.equal(bad.code, 1);
      assert.match(bad.err, /run `gh auth login --hostname ghe\.corp\.example`/);
      bad = await call(['import-reports', '--branch', 'feat/x'], dir, gh.env);
      assert.match(bad.err, /run `gh auth login`$/);
      // bad --host values: exit 1 before gh
      fs.rmSync(path.join(gh.root, 'logged-out'));
      reset(gh);
      for (const h of ['https://ghe.corp.example', 'ghe.corp.example:443', 'u@ghe.corp.example', 'nodot', '', '-x.com', 'a..b', 'ghe.corp.example/x']) {
        const x = await call(['import-reports', '--branch', 'feat/x', '--host', h], dir, gh.env);
        assert.equal(x.code, 1, h);
        assert.match(x.err, /--host must be a host name/, h);
      }
      assert.ok(!spawned(gh));
    } finally { rm(dir); rm(gh.root); }
  });

  it('a multi-valued remote url: the first value (the one git fetches from) is used', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      g(dir, 'config', '--add', 'remote.origin.url', 'https://evil.example.com/o/r.git');
      let r = await call(['import-reports', '--limit', '5'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.repo, 'o/r');
      assert.ok(ghEnvs(gh).every(([, , host]) => host === 'github.com'));
      g(dir, 'config', '--unset-all', 'remote.origin.url');
      g(dir, 'config', 'remote.origin.url', 'https://evil.example.com/o/r.git');
      g(dir, 'config', '--add', 'remote.origin.url', 'https://github.com/o/r.git');
      reset(gh);
      r = await call(['import-reports', '--branch', 'feat/x'], dir, gh.env);
      assert.equal(r.code, 1);
      assert.match(r.err, /the origin remote is on evil\.example\.com/);
      assert.ok(!spawned(gh));
    } finally { rm(dir); rm(gh.root); }
  });

  it('an upstream remote is preferred over origin (a fork checkout), and --repo overrides the remotes', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      fs.writeFileSync(path.join(gh.root, 'runs.json'), '[]');
      g(dir, 'remote', 'add', 'upstream', 'git@github.com:up/stream.git');
      let r = await call(['import-reports', '--branch', 'main'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.repo, 'up/stream');
      assert.equal(r.out.repo_from, 'the upstream remote');
      assert.deepEqual(gh.calls()[1].slice(0, 4), ['run', 'list', '-R', 'github.com/up/stream']);
      // an upstream on another host is refused: never a silent fall back to origin
      g(dir, 'remote', 'set-url', 'upstream', 'https://evil.example.com/up/stream.git');
      reset(gh);
      r = await call(['import-reports', '--branch', 'main'], dir, gh.env);
      assert.equal(r.code, 1);
      assert.match(r.err, /the upstream remote is on evil\.example\.com/);
      assert.ok(!spawned(gh));
      // --repo: the remotes are not read at all (none here, more than one, or one on another host)
      r = await call(['import-reports', '--branch', 'main', '--repo', 'other/name.js'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.repo, 'other/name.js');
      assert.equal(r.out.repo_from, '--repo');
      assert.ok(ghEnvs(gh).every(([, repo, host]) => repo === 'github.com/other/name.js' && host === 'github.com'));
      g(dir, 'remote', 'remove', 'upstream');
      g(dir, 'remote', 'remove', 'origin');
      reset(gh);
      r = await call(['import-reports', '--branch', 'main'], dir, gh.env);
      assert.equal(r.code, 1);
      assert.match(r.err, /no git remote .*or pass --repo <owner>\/<repo>/);
      assert.ok(!spawned(gh));
      r = await call(['import-reports', '--branch', 'main', '--repo', 'other/name.js'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      for (const v of ['o', 'o/r/x', '../r', 'o/..', '-o/r', 'o/-r', 'o/r;x', '', 'o/', '/r', 'github.com/o/r']) {
        reset(gh);
        const x = await call(['import-reports', '--branch', 'main', '--repo', v], dir, gh.env);
        assert.equal(x.code, 1, v);
        assert.match(x.err, /--repo must be <owner>\/<repo>/, v);
        assert.ok(!spawned(gh), v);
      }
      assert.equal((await call(['import-reports', '--repo'], dir, gh.env)).code, 1);
      assert.equal((await call(['import-reports', '--host'], dir, gh.env)).code, 1);
      assert.equal((await call(['prune', '--repo', 'o/r'], dir, gh.env)).code, 1);
      // the usage names the new flags and the upstream preference
      const help = await call(['--help'], dir);
      assert.match(help.out.usage, /\[--repo <owner>\/<repo>\] \[--host <h>\]/);
      assert.match(help.out.usage, /else the upstream remote, else origin/);
      assert.match(help.out.usage, /never one a remote names/);
    } finally { rm(dir); rm(gh.root); }
  });

  it('a remote URL in a message never shows its userinfo (a token in it)', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      for (const [url, shown] of [
        ['https://oauth2:glpat-SECRETTOKEN@gitlab.com/grp/sub/proj.git', 'https://gitlab.com/grp/sub/proj.git'],
        [`https://x-access-token:${TOKEN}@ghe.corp.com/team/sub/repo.git`, 'https://ghe.corp.com/team/sub/repo.git'],
        ['https://user:p@ss@host.example/a/b/c', 'https://host.example/a/b/c'],
        ['deploy:glpat-SECRETTOKEN@host.example:a/b/c', 'host.example:a/b/c']
      ]) {
        g(dir, 'remote', 'set-url', 'origin', url);
        const r = await call(['import-reports', '--branch', 'feat/x'], dir, gh.env);
        assert.equal(r.code, 1);
        for (const secret of ['glpat-SECRETTOKEN', TOKEN, 'oauth2', 'x-access-token', 'p@ss', 'deploy']) assert.ok(!r.err.includes(secret), `${secret} in: ${r.err}`);
        assert.ok(r.err.includes(JSON.stringify(shown)), r.err);
      }
      // parsed, on another host: only the host is named
      g(dir, 'remote', 'set-url', 'origin', `https://x-access-token:${TOKEN}@ghe.corp.com/o/r.git`);
      const r = await call(['import-reports', '--branch', 'feat/x'], dir, gh.env);
      assert.equal(r.code, 1);
      assert.ok(!r.err.includes(TOKEN) && !r.err.includes('x-access-token'), r.err);
      assert.match(r.err, /the origin remote is on ghe\.corp\.com/);
      assert.ok(!spawned(gh));
    } finally { rm(dir); rm(gh.root); }
  });

  it('displayUrl and canonicalHost', () => {
    assert.equal(displayUrl('https://a:b@h.example/x'), 'https://h.example/x');
    assert.equal(displayUrl('ssh://git@h.example:22/x'), 'ssh://h.example:22/x');
    assert.equal(displayUrl('git@h.example:o/r'), 'h.example:o/r');
    assert.equal(displayUrl(`https://h.example/${TOKEN}`).includes(TOKEN), false, 'credential-masked too');
    assert.equal(displayUrl(`https://h.example/${SECRET}`, [SECRET]).includes(SECRET), false, 'redacted with the project secrets');
    assert.equal(canonicalHost('SSH.GitHub.com'), 'github.com');
    assert.equal(canonicalHost('www.github.com'), 'github.com');
    assert.equal(canonicalHost('github-work'), 'github-work', 'an ssh alias is not assumed to be github.com');
    assert.equal(canonicalHost('github.com.evil.example'), 'github.com.evil.example');
  });
});

describe('local runs: the per-run and per-project case caps apply to recordRun too (review wt-4b L4)', () => {
  const tap = (n) => `${Array.from({ length: n }, (_, i) => `ok ${i + 1} - t${i}`).join('\n')}\n# tests ${n}\n# pass ${n}\n# fail 0\n`;
  const at = { code: 0, started_at: '2026-10-16T00:00:00Z', finished_at: '2026-10-16T00:00:01Z' };
  async function stderrOf(fn) {
    const orig = process.stderr.write;
    let out = '';
    process.stderr.write = function (chunk, ...rest) { out += String(chunk); return typeof rest[rest.length - 1] === 'function' ? (rest[rest.length - 1](), true) : true; };
    try { return { value: await fn(), stderr: out }; } finally { process.stderr.write = orig; }
  }

  it(`parseTap keeps at most ${MAX_CASES} cases (the rest of the output is not read) and says so`, () => {
    const all = parseTap(tap(MAX_CASES + 5));
    assert.equal(all.length, MAX_CASES);
    assert.equal(all.truncated, true);
    assert.equal(parseTap(tap(3)).truncated, false);
    const few = parseTap(tap(5), undefined, { maxCases: 3 });
    assert.deepEqual(few.map((c) => c.name), ['t0', 't1', 't2']);
    assert.equal(few.truncated, true);
    const spec = parseTap('✔ a (1ms)\n✔ b (1ms)\n✖ c (1ms)\n', undefined, { maxCases: 2 });
    assert.equal(spec.length, 2);
    assert.equal(spec.truncated, true);
  });

  it('recordRun stores at most the per-run cap (counts from the runner summary) and nothing past the project ceiling, with one stderr line naming db prune', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    try {
      const io = { cwd: dir, env: ENGINE, importLimits: { artifactCases: 3, projectCases: 7 } };
      let { value: rec, stderr } = await stderrOf(() => recordRun(io, { ...at, output: tap(5) }));
      assert.equal(stderr, '');
      assert.equal(rec.recorded, true);
      assert.equal(rec.cases, 3);
      assert.equal(rec.truncated, true);
      const [run] = await rows(dir, 'SELECT total, passed, data FROM test_runs WHERE id = ?', rec.id);
      assert.equal(run.total, 5, 'the counts are the runner summary');
      assert.match(JSON.parse(run.data).cases_truncated, /only the first 3 test cases are stored/);
      assert.equal((await rows(dir, 'SELECT COUNT(*) AS n FROM test_cases'))[0].n, 3);
      ({ value: rec, stderr } = await stderrOf(() => recordRun(io, { ...at, output: tap(3) })));
      assert.equal(rec.recorded, true);
      assert.equal(stderr, '');
      // 6 stored: 3 more would pass the ceiling of 7
      ({ value: rec, stderr } = await stderrOf(() => recordRun(io, { ...at, output: tap(3) })));
      assert.equal(rec.recorded, false);
      const lines = stderr.split('\n').filter(Boolean);
      assert.equal(lines.length, 1, stderr);
      assert.match(lines[0], /^kit: test run not recorded in the kit index: the index holds 6 test cases and this run has 3; at most 7 are kept per project: run `db prune --keep <n>`/);
      assert.equal((await rows(dir, 'SELECT COUNT(*) AS n FROM test_runs'))[0].n, 2);
      // db prune makes room
      assert.equal((await call(['prune', '--keep', '1'], dir, ENGINE)).code, 0);
      ({ value: rec } = await stderrOf(() => recordRun(io, { ...at, output: tap(3) })));
      assert.equal(rec.recorded, true);
    } finally { rm(dir); }
  });

  it(`runStep at the real project ceiling (${PROJECT_MAX_CASES} cases): the step's exit status is unchanged and nothing is stored`, { skip: !NODE_SQLITE, timeout: 120000 }, async () => {
    const dir = await project();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-ceiling-'));
    try {
      await withIndex({ cwd: dir, env: ENGINE }, (d) => {
        d.run("INSERT INTO test_runs (branch, started_at, status) VALUES ('filler', '2026-01-01T00:00:00Z', 'passed')");
        d.exec(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${PROJECT_MAX_CASES}) INSERT INTO test_cases (run_id, name, status) SELECT 1, 'n', 'pass' FROM c`);
      });
      for (const [cmd, want] of [["echo 'not ok 1 - x'; exit 1", 1], ["echo 'ok 1 - fine'", 0]]) {
        const lines = [];
        const { value: code, stderr } = await stderrOf(() => runStep(() => ({ class: 'product' }), { cwd: dir, env: { ...process.env, ...ENGINE, CI_TEST_OUTPUT: path.join(out, 'o.txt'), CI_TEST_COMMAND: cmd }, log: (l) => lines.push(l) }));
        assert.equal(code, want);
        assert.ok(!lines.some((l) => /recorded in the kit index/.test(l)), lines.join('\n'));
        assert.equal(stderr.split('\n').filter((l) => /kit: test run not recorded/.test(l)).length, 1, stderr);
        assert.match(stderr, /db prune/);
      }
      assert.equal((await rows(dir, 'SELECT COUNT(*) AS n FROM test_runs'))[0].n, 1);
    } finally { rm(dir); rm(out); }
  });
});

describe('test runs are held to their share of the index file (review wt-5a M1 / wt-5b M1)', () => {
  /** A case of the reviewers' shape: classname, name and file at the old 1 KB cap, a 4 KB failure message, all unique. */
  const fat = (i) => {
    const u = `${i}-${crypto.randomBytes(8).toString('hex')}`;
    return `<testcase classname="${u}${'c'.repeat(1000)}" name="${u}${'n'.repeat(1000)}" file="${u}${'f'.repeat(1000)}"><failure message="${u}">${'m'.repeat(4000)}</failure></testcase>`;
  };
  const fatTap = (n) => `TAP version 13\n${Array.from({ length: n }, (_, i) => {
    const u = `${i}-${crypto.randomBytes(8).toString('hex')}`;
    return `not ok ${i + 1} - ${u}${'n'.repeat(1000)}\n  ---\n  duration_ms: 1\n  error: '${u}${'m'.repeat(4000)}'\n  ...`;
  }).join('\n')}\n# tests ${n}\n# pass 0\n# fail ${n}\n`;
  const at = { code: 1, started_at: '2026-10-16T00:00:00Z', finished_at: '2026-10-16T00:00:01Z' };
  async function quiet(fn) {
    const orig = process.stderr.write;
    let out = '';
    process.stderr.write = function (chunk, ...rest) { out += String(chunk); return typeof rest[rest.length - 1] === 'function' ? (rest[rest.length - 1](), true) : true; };
    try { return { value: await fn(), stderr: out }; } finally { process.stderr.write = orig; }
  }
  const usedBytes = (dir, extra = {}) => withIndex({ cwd: dir, env: ENGINE, ...extra }, (d) => ({ disk: indexUsedBytes(d), runs: testRunBytes(d) }));

  it('the caps: test runs take at most half of the index file; names 256 bytes, messages 1 KB, output 64 MB', () => {
    assert.equal(TEST_RUNS_MAX_BYTES, 256 * 1024 * 1024);
    assert.ok(TEST_RUNS_MAX_BYTES <= MAX_INDEX_DISK_BYTES / 2);
    assert.equal(NAME_MAX, 256);
    assert.equal(MESSAGE_MAX, 1024);
    assert.equal(OUTPUT_MAX_BYTES, 64 * 1024 * 1024);
  });

  it('import-reports of fat unique cases (imp-bytes.mjs, scaled down): stored strings are capped and marked, the import stops at the test runs\' share with a note naming db prune --keep <n>, and prune makes room', { skip: !NODE_SQLITE, timeout: 120000 }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      const runs = [];
      for (let r = 0; r < 6; r++) {
        const id = 500 + r;
        runs.push({ databaseId: id, headSha: 'd'.repeat(40), createdAt: `2026-10-${String(10 + r).padStart(2, '0')}T12:00:00Z`, conclusion: 'failure', event: 'push', headBranch: 'feat/x' });
        gh.art(id, 'test-results-node-22', [{ name: 'junit.xml', data: junit(Array.from({ length: 40 }, (_, i) => fat(r * 1000 + i)).join('')) }]);
      }
      fs.writeFileSync(path.join(gh.root, 'runs.json'), JSON.stringify(runs.reverse()));
      const cap = 500 * 1024;
      const limits = { importLimits: { runBytes: cap } };
      const before = await usedBytes(dir);
      const r = await callIo(['import-reports', '--limit', '10'], dir, gh.env, limits);
      assert.equal(r.code, 0, r.err);
      assert.ok(r.out.imported.length >= 1 && r.out.imported.length < 6, JSON.stringify(r.out.imported));
      assert.match(r.out.note, /^the import stopped: test runs would take about \d+ bytes of the index; at most 512000 are kept per project \(the rest is for the kit's JSON state files\): run `db prune --keep <n>`/);
      assert.ok(r.out.skipped.some((x) => /share of the index \(see note\)/.test(x.reason)), JSON.stringify(r.out.skipped));
      const after = await usedBytes(dir);
      assert.ok(after.runs <= cap, `test runs ${after.runs} > ${cap}`);
      // the estimate is an upper bound of what the rows take in the file
      assert.ok(after.disk - before.disk <= after.runs, `grew ${after.disk - before.disk}, estimated ${after.runs}`);
      const cases = await rows(dir, 'SELECT suite, name, file, message FROM test_cases');
      assert.equal(cases.length, r.out.imported.length * 40);
      for (const c of cases) {
        for (const v of [c.suite, c.name, c.file]) { assert.ok(Buffer.byteLength(v) <= NAME_MAX, String(Buffer.byteLength(v))); assert.ok(v.endsWith(TRUNCATED)); }
        assert.ok(Buffer.byteLength(c.message) <= MESSAGE_MAX && c.message.endsWith(TRUNCATED));
      }
      // plain prune keeps 200 per branch: nothing; --keep 1 makes room and the next import goes on
      const n = r.out.imported.length;
      const again = await callIo(['import-reports', '--limit', '10'], dir, gh.env, limits);
      assert.equal(again.out.imported.length, 0);
      assert.match(again.out.note, /db prune --keep <n>/);
      assert.equal((await call(['prune', '--keep', '1'], dir, ENGINE)).out.pruned_runs, n - 1);
      const more = await callIo(['import-reports', '--limit', '10'], dir, gh.env, limits);
      assert.ok(more.out.imported.length >= 1, JSON.stringify(more.out));
      assert.ok((await usedBytes(dir)).runs <= cap);
    } finally { rm(dir); rm(gh.root); }
  });

  it('import-reports stops before the index file\'s own cap (indexLimits.maxDiskBytes), whatever the test runs\' share', { skip: !NODE_SQLITE, timeout: 120000 }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      const runs = [];
      for (let r = 0; r < 6; r++) {
        const id = 600 + r;
        runs.push({ databaseId: id, headSha: 'e'.repeat(40), createdAt: `2026-10-${String(10 + r).padStart(2, '0')}T12:00:00Z`, conclusion: 'failure', event: 'push', headBranch: 'feat/x' });
        gh.art(id, 'test-results-node-22', [{ name: 'junit.xml', data: junit(Array.from({ length: 40 }, (_, i) => fat(r * 1000 + i)).join('')) }]);
      }
      fs.writeFileSync(path.join(gh.root, 'runs.json'), JSON.stringify(runs.reverse()));
      const maxDisk = (await usedBytes(dir)).disk + 600 * 1024;
      const r = await callIo(['import-reports', '--limit', '10'], dir, gh.env, { indexLimits: { maxDiskBytes: maxDisk } });
      assert.equal(r.code, 0, r.err);
      assert.ok(r.out.imported.length >= 1 && r.out.imported.length < 6, JSON.stringify(r.out.imported));
      assert.match(r.out.note, new RegExp(`^the import stopped: the index file holds \\d+ bytes in use and this needs up to \\d+ more; it holds at most ${maxDisk} per project: run \`db prune --keep <n>\``));
      assert.ok((await usedBytes(dir)).disk <= maxDisk);
    } finally { rm(dir); rm(gh.root); }
  });

  it('recordRun: a local run past the test runs\' share is not stored (one stderr line naming db prune --keep <n>); a JSON file skipped because the index file was full is retried by the next open after db prune, no rebuild', { skip: !NODE_SQLITE, timeout: 120000 }, async () => {
    const dir = await project();
    try {
      // the test runs' share
      let io = { cwd: dir, env: ENGINE, importLimits: { runBytes: 250 * 1024 } };
      let { value: rec, stderr } = await quiet(() => recordRun(io, { ...at, output: fatTap(40) }));
      assert.equal(rec.recorded, true, stderr);
      ({ value: rec, stderr } = await quiet(() => recordRun(io, { ...at, output: fatTap(60) })));
      assert.equal(rec.recorded, false);
      const lines = stderr.split('\n').filter(Boolean);
      assert.equal(lines.length, 1, stderr);
      assert.match(lines[0], /^kit: test run not recorded in the kit index: test runs would take about \d+ bytes of the index; at most 256000 are kept per project .*run `db prune --keep <n>`/);
      const [c] = await rows(dir, "SELECT name, message FROM test_cases WHERE status = 'fail' LIMIT 1");
      assert.ok(Buffer.byteLength(c.name) <= NAME_MAX && c.name.endsWith(TRUNCATED));
      assert.ok(Buffer.byteLength(c.message) <= MESSAGE_MAX && c.message.endsWith(TRUNCATED));

      // the index file's own cap: runs fill it, then a lessons file does not fit and is skipped as full
      const maxDisk = (await usedBytes(dir)).disk + 700 * 1024;
      const limits = { maxDiskBytes: maxDisk };
      io = { cwd: dir, env: ENGINE, indexLimits: limits };
      let stored = 1;
      for (let i = 0; i < 20; i++) {
        ({ value: rec, stderr } = await quiet(() => recordRun(io, { ...at, output: fatTap(100) })));
        if (!rec.recorded) { assert.match(stderr, /the index file holds \d+ bytes in use .*it holds at most \d+ per project: run `db prune --keep <n>`/); break; }
        stored++;
      }
      assert.equal(rec.recorded, false, 'the index file cap was reached');
      assert.ok((await usedBytes(dir, { indexLimits: limits })).disk <= maxDisk);
      const lessons = { lessons: Array.from({ length: 150 }, (_, i) => ({ id: `L${i}`, role: 'reviewer', status: 'active', text: 'x'.repeat(400) })) };
      fs.writeFileSync(path.join(dir, '.claude', 'kit', 'lessons.json'), JSON.stringify(lessons));
      let st = await db(['status'], { cwd: dir, env: ENGINE, indexLimits: limits });
      assert.ok(st.skipped.some((x) => x.file.endsWith('lessons.json') && x.reason === diskFullReason(maxDisk)), JSON.stringify(st.skipped));
      assert.equal(st.rows.lessons, 0);
      // still skipped, not re-read, on the next open
      st = await db(['status'], { cwd: dir, env: ENGINE, indexLimits: limits });
      assert.equal(st.rows.lessons, 0);
      const pr = await db(['prune', '--keep', '1'], { cwd: dir, env: ENGINE, indexLimits: limits });
      assert.equal(pr.pruned_runs, stored - 1);
      assert.equal(pr.files_to_retry, 1);
      st = await db(['status'], { cwd: dir, env: ENGINE, indexLimits: limits });
      assert.equal(st.rows.lessons, 150, JSON.stringify(st.skipped));
      assert.ok(!st.skipped.some((x) => x.file.endsWith('lessons.json')));
      assert.ok((await usedBytes(dir, { indexLimits: limits })).disk <= maxDisk);
    } finally { rm(dir); }
  });

  it('recordStep reads at most OUTPUT_MAX_BYTES (here lowered) of the test output, cut at a line, and records the run as truncated (review wt-5b L2)', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-bound-'));
    try {
      const file = path.join(out, 'o.txt');
      const text = `TAP version 13\n${Array.from({ length: 200 }, (_, i) => `ok ${i + 1} - t${i}`).join('\n')}\n# tests 200\n# pass 200\n`;
      fs.writeFileSync(file, text);
      const b = readBounded(file, 100);
      assert.equal(b.truncated, 100);
      assert.ok(Buffer.byteLength(b.text) <= 100 && b.text.endsWith('\n'));
      assert.deepEqual(readBounded(file, text.length), { text, truncated: 0 });
      assert.deepEqual(readBounded(path.join(out, 'none.txt'), 10), { text: '', truncated: 0 });
      const lines = [];
      const r = await recordStep({ command: 'npm test', code: 0, started_at: at.started_at, finished_at: at.finished_at }, { env: { ...process.env, ...ENGINE, CI_TEST_OUTPUT: file }, cwd: dir, log: (l) => lines.push(l), maxBytes: 200 });
      assert.equal(r.recorded, true, lines.join('\n'));
      assert.equal(r.output_truncated, true);
      assert.ok(r.cases > 0 && r.cases < 200, String(r.cases));
      const [run] = await rows(dir, 'SELECT data FROM test_runs WHERE id = ?', r.id);
      assert.match(JSON.parse(run.data).output_truncated, /only the first 200 bytes of the test output were read/);
    } finally { rm(dir); rm(out); }
  });
});

describe('import-reports: messages and hosts (review wt-5a L1 / L2 / L3, wt-5b L1)', () => {
  const g = (dir, ...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf-8' });
  const spawned = (gh) => ['cwds.jsonl', 'calls.jsonl', 'api-calls.jsonl'].some((f) => fs.existsSync(path.join(gh.root, f)));
  const reset = (gh) => { for (const f of ['cwds.jsonl', 'calls.jsonl', 'api-calls.jsonl']) fs.rmSync(path.join(gh.root, f), { force: true }); };

  it('a dotless ssh alias host is not taken as github.com: exit 1 asking for --repo, gh never spawned; ssh.github.com and www.github.com stay github.com', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      for (const url of ['git@github-work:o/r.git', 'myghe:team/app', 'ssh://git@myghe/team/app.git']) {
        g(dir, 'remote', 'set-url', 'origin', url);
        for (const extra of [[], ['--host', 'ghe.corp.example']]) {
          reset(gh);
          const r = await call(['import-reports', '--branch', 'feat/x', ...extra], dir, gh.env);
          assert.equal(r.code, 1, url);
          assert.match(r.err, /the origin remote's host \S+ has no dot \(an ssh alias\?\), so it does not say which GitHub host the repository is on: pass --repo <owner>\/<repo>/, r.err);
          assert.ok(!spawned(gh), url);
        }
      }
      // --repo names it: the remote is not read
      reset(gh);
      const r = await call(['import-reports', '--limit', '5', '--repo', 'o/r'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.repo_from, '--repo');
      for (const url of ['git@ssh.github.com:o/r.git', 'https://www.github.com/o/r']) {
        g(dir, 'remote', 'set-url', 'origin', url);
        reset(gh);
        const ok = await call(['import-reports', '--limit', '5'], dir, gh.env);
        assert.equal(ok.code, 0, ok.err);
        assert.equal(ok.out.repo, 'o/r');
      }
    } finally { rm(dir); rm(gh.root); }
  });

  it('a remote name with terminal escapes or 3 KB of text is shown printable and capped; the host is never pre-filled into --host', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      g(dir, 'remote', 'remove', 'origin');
      const name = `\u001b]0;PWNED\u0007\u001b[2J${'A'.repeat(3000)}`;
      fs.appendFileSync(path.join(dir, '.git', 'config'), `[remote "${name}"]\n\turl = https://evil.example.com/o/r\n`);
      const r = await call(['import-reports', '--branch', 'feat/x'], dir, gh.env);
      assert.equal(r.code, 1);
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[\u0000-\u001f\u007f]/.test(r.err), JSON.stringify(r.err.slice(0, 200)));
      assert.ok(Buffer.byteLength(r.err) < 800, String(Buffer.byteLength(r.err)));
      assert.match(r.err, /^the "\?\]0;PWNED\?\?\[2JAAA+…\[truncated\]" remote is on evil\.example\.com, not github\.com/);
      assert.ok(!r.err.includes('--host evil.example.com'));
      assert.ok(!spawned(gh));
      // the URL form of the message too
      fs.appendFileSync(path.join(dir, '.git', 'config'), '[remote "origin"]\n\turl = "https://github.com/o/\\033[2Jr x"\n');
      const u = await call(['import-reports', '--branch', 'feat/x'], dir, gh.env);
      assert.equal(u.code, 1);
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[\u0000-\u001f\u007f]/.test(u.err), JSON.stringify(u.err));
      assert.equal(remoteLabel('origin'), 'origin');
      assert.equal(remoteLabel('a b'), '"a b"');
      assert.equal(printable('a\u001b[2J‮b\u0085c'), 'a?[2J?b?c');
      assert.ok(Buffer.byteLength(printable('x'.repeat(500), 50)) <= 50);
    } finally { rm(dir); rm(gh.root); }
  });

  it('gh auth status is asked about the chosen host only (--hostname), so a stale login elsewhere does not stop the import', { skip: !NODE_SQLITE }, async () => {
    const dir = await project();
    const gh = fakeGh();
    try {
      let r = await call(['import-reports', '--branch', 'feat/x'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(gh.calls()[0], ['auth', 'status', '--hostname', 'github.com']);
      reset(gh);
      r = await call(['import-reports', '--branch', 'feat/x', '--host', 'ghe.corp.example', '--repo', 'o/r'], dir, gh.env);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(gh.calls()[0], ['auth', 'status', '--hostname', 'ghe.corp.example']);
    } finally { rm(dir); rm(gh.root); }
  });

  it('the usage tells agents to ask the user before passing --host', async () => {
    const help = await call(['--help'], os.tmpdir());
    assert.match(help.out.usage, /an agent must ask the user before passing --host/);
    assert.match(help.out.usage, /db prune --keep <n> makes room/);
  });
});
