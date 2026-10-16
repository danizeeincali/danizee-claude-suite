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
import { withIndex, indexPaths } from '../src/lib/kit/store.js';
import { parseJunit, parseTap, parseTapSummary, MESSAGE_MAX, MAX_DEPTH, capBytes, ARTIFACT_MAX_BYTES, ARTIFACTS_PER_RUN, IMPORT_MAX_BYTES, JUNIT_MAX_BYTES, ZIP_MAX_RATIO, parseArtifactList, readJunitFromZip, recordRun, SECRETS_MAX_BYTES } from '../src/lib/kit/test-runs.js';
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

// Artifacts are zip files (root/artifacts/<run>/<name>.zip) with ids (root/ids.json). The listing (gh api .../runs/<id>/artifacts)
// is logged in api-calls.jsonl; everything else (zip downloads included) in calls.jsonl.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const root = process.env.FAKE_GH_ROOT; const a = process.argv.slice(2);
const listing = a[0] === 'api' && /^repos\\/\\{owner\\}\\/\\{repo\\}\\/actions\\/runs\\/(\\d+)\\/artifacts\\?per_page=100$/.exec(a[1] || '');
const zip = a[0] === 'api' && /^repos\\/\\{owner\\}\\/\\{repo\\}\\/actions\\/artifacts\\/(\\d+)\\/zip$/.exec(a[1] || '');
fs.appendFileSync(path.join(root, listing ? 'api-calls.jsonl' : 'calls.jsonl'), JSON.stringify(a) + '\\n');
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
      assert.deepEqual(calls[0], ['auth', 'status']);
      // push runs only (a fork's pull_request run can carry the same head branch name)
      assert.deepEqual(calls[1], ['run', 'list', '--branch', 'feat/x', '--event', 'push', '--workflow', 'test.yml', '--limit', '5', '--json', 'databaseId,headSha,createdAt,conclusion,event,headBranch']);
      // each test-results artifact by its id, after its run's listing (sizes and ids); never `gh run download`, never not-ours
      assert.deepEqual(gh.listings(), [302, 301, 300]);
      const ids = gh.ids;
      assert.deepEqual(gh.zips(), ['302/test-results-node-20', '302/test-results-node-22', '302/test-results-node-24', '301/test-results-node-20', '301/test-results-node-22'].map((k) => ids[k]));
      assert.ok(calls.slice(2).every((c) => c.length === 2 && c[0] === 'api' && /^repos\/\{owner\}\/\{repo\}\/actions\/artifacts\/\d+\/zip$/.test(c[1])), JSON.stringify(calls));
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
      assert.deepEqual(api, ['302', '301', '300'].map((id) => ['api', `repos/{owner}/{repo}/actions/runs/${id}/artifacts?per_page=100`]));
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
      assert.deepEqual(gh.calls()[0], ['auth', 'status'], 'the gh on PATH ran');
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

  it('a secrets file that is a FIFO, a link or too large is skipped with one stderr line; import-reports and recordRun finish', { skip: !NODE_SQLITE, timeout: 180000 }, async () => {
    const dir = await project();
    const gh = fakeGh();
    const secrets = path.join(dir, '.claude', 'kit', 'secrets');
    try {
      for (const [label, make, reason] of [
        ['fifo', () => assert.equal(spawnSync('mkfifo', [secrets]).status, 0), 'not a regular file'],
        ['link', () => fs.symlinkSync('/dev/zero', secrets), 'a symbolic link'],
        ['large', () => { fs.writeFileSync(secrets, ''); fs.truncateSync(secrets, SECRETS_MAX_BYTES + 1); }, `larger than ${SECRETS_MAX_BYTES} bytes`]
      ]) {
        fs.rmSync(secrets, { force: true });
        make();
        for (const [what, code] of [['import-reports', IMPORT(['import-reports', '--branch', 'feat/x', '--limit', '5'])], ['recordRun', RECORD]]) {
          const r = child(code, dir, gh.env);
          assert.ok(!r.killed && r.ms < 30000, `${label} ${what}: ${r.ms} ms`);
          assert.equal(r.res?.code, 0, `${label} ${what}: ${JSON.stringify(r)}`);
          const notes = r.stderr.split('\n').filter((l) => /secrets file/.test(l));
          assert.equal(notes.length, 1, `${label} ${what}: ${r.stderr}`);
          assert.ok(notes[0].includes(`(${reason})`), notes[0]);
        }
      }
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
