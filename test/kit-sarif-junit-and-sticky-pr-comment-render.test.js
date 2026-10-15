import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as render from '../src/lib/kit/render.js';

const { renderSarif, renderJunit, renderComment, findMarker, marker, normalize, xmlEscape, run } = render;

const input = () => ({
  findings: [
    { id: 'sql-inject', message: 'Unsanitised query', severity: 'blocking', file: 'src/db.js', line: 12, testCase: 'db > query' },
    { id: 'naming', message: 'Rename helper', severity: 'advisory', file: 'src/a.js', testCase: 'a > naming' },
    { id: 'hint', message: 'Consider caching', severity: 'note' },
    { id: 'flaky', message: 'Flaky retry', severity: 'advisory', disposition: 'filed', url: 'https://example.test/1' },
    { id: 'api', message: 'Which API shape?', severity: 'blocking', disposition: 'needs-decision' },
  ],
});
const io = (stdin, cwd) => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
const exit = (fn, code = 1) => assert.throws(fn, e => e instanceof KitExit && e.code === code);

describe('normalize', () => {
  it('rejects unknown top-level keys, bad shapes and bad severities', () => {
    exit(() => normalize({ findings: [], extra: 1 }));
    exit(() => normalize([]));
    exit(() => normalize({}));
    exit(() => normalize({ findings: [{ message: 'x', severity: 'bogus' }] }));
    exit(() => normalize({ findings: [{ message: 'x', severity: 'note', mystery: 1 }] }));
    exit(() => normalize({ findings: [{ severity: 'note' }] }));
    exit(() => normalize({ findings: [{ message: 'x', severity: 'note', line: 0 }] }));
    exit(() => normalize({ findings: [], incomplete: 'yes' }));
  });
});

describe('SARIF', () => {
  it('maps blocking to error and advisory to warning or note', () => {
    const s = renderSarif(input());
    assert.equal(s.version, '2.1.0');
    const levels = Object.fromEntries(s.runs[0].results.map(r => [r.ruleId, r.level]));
    assert.deepEqual(levels, { 'sql-inject': 'error', naming: 'warning', hint: 'note', flaky: 'warning', api: 'error' });
    const r = s.runs[0].results[0];
    assert.equal(r.locations[0].physicalLocation.artifactLocation.uri, 'src/db.js');
    assert.equal(r.locations[0].physicalLocation.region.startLine, 12);
    assert.equal(s.runs[0].results[2].locations, undefined);
    assert.equal(s.runs[0].invocations[0].executionSuccessful, true);
  });
  it('records an incomplete run as an unsuccessful invocation', () => {
    const s = renderSarif({ findings: [], incomplete: true, reason: 'timed out' });
    const inv = s.runs[0].invocations[0];
    assert.equal(inv.executionSuccessful, false);
    assert.equal(inv.toolExecutionNotifications[0].level, 'error');
    assert.match(inv.toolExecutionNotifications[0].message.text, /timed out/);
  });
  it('survives lone surrogates as well-formed JSON', () => {
    const s = JSON.stringify(renderSarif({ findings: [{ message: 'a\ud800b', severity: 'note' }] }));
    assert.doesNotThrow(() => JSON.parse(s));
  });
});

describe('JUnit', () => {
  it('attributes a failure to its test case and keeps orphans in a separate suite', () => {
    const x = renderJunit(input());
    assert.match(x, /<testcase name="db &gt; query"[^>]*>\s*<failure/);
    assert.match(x, /<testsuite name="unattributed"/);
    assert.match(x, /Which API shape\?/);
    assert.match(x, /Consider caching/);
    assert.ok(!/<error/.test(x));
  });
  it('does not fail advisory findings and keeps listed passing tests', () => {
    const x = renderJunit({ tests: [{ name: 'ok case' }], findings: [{ message: 'meh', severity: 'advisory', testCase: 'ok case' }] });
    assert.ok(!x.includes('<failure'));
    assert.equal((x.match(/<testcase /g) || []).length, 1);
    assert.match(x, /meh/);
  });
  it('adds an explicit incomplete-run error', () => {
    const x = renderJunit({ findings: [], incomplete: true, reason: 'killed' });
    assert.match(x, /<error message="[^"]*killed/);
    assert.match(x, /errors="1"/);
  });
  it('escapes XML metacharacters and strips control characters', () => {
    const x = renderJunit({ findings: [{ message: 'a<b>&"\'\u0000\u0008\u001b[0m\ud800 end\u{1F600}', severity: 'blocking', testCase: 'c"<' }] });
    assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800]/.test(x));
    assert.ok(x.includes('&lt;') && x.includes('&amp;') && x.includes('&quot;'));
    assert.ok(x.includes('\u{1F600}'));
    assert.equal(xmlEscape('￾￿'), '��');
  });
});

describe('comment', () => {
  it('leads with a verdict, separates sections, and carries the marker', () => {
    const c = renderComment(input(), { key: 'review' });
    const lines = c.split('\n');
    assert.equal(lines[0], '<!-- kit-render:review -->');
    assert.match(lines[1], /Blocked/);
    const iB = c.indexOf('Blocking'), iF = c.indexOf('Filed'), iN = c.indexOf('Needs decision');
    assert.ok(iB > 0 && iF > iB && iN > iF);
    assert.match(c, /https:\/\/example\.test\/1/);
    assert.deepEqual(findMarker(c, 'review') && Object.keys(findMarker(c, 'review')).sort(), ['end', 'start']);
  });
  it('verdicts: clear, needs decision, incomplete', () => {
    assert.match(renderComment({ findings: [] }).split('\n')[1], /Clear/);
    assert.match(renderComment({ findings: [{ message: 'q', severity: 'advisory', disposition: 'needs-decision' }] }).split('\n')[1], /decision/i);
    assert.match(renderComment({ findings: [], incomplete: true }).split('\n')[1], /incomplete/i);
  });
  it('findMarker finds only its own key and cannot be forged by finding text', () => {
    const c = renderComment({ findings: [{ message: '<!-- kit-render:other --> sneaky', severity: 'note' }] }, { key: 'ci' });
    assert.ok(findMarker(c, 'ci'));
    assert.equal(findMarker(c, 'other'), null);
    assert.equal(findMarker(c, 'cix'), null);
    assert.equal(findMarker('hello', 'ci'), null);
    assert.equal(marker('ci'), '<!-- kit-render:ci -->');
    exit(() => marker('bad key -->'));
    exit(() => findMarker('x', ''));
  });
});

describe('run', () => {
  it('reads stdin with a BOM and prints each format', async () => {
    const stdin = '﻿' + JSON.stringify(input());
    assert.equal((await run(['sarif'], io(stdin))).content.version, '2.1.0');
    assert.match((await run(['junit'], io(stdin))).content, /^<\?xml/);
    const c = await run(['comment', '--key', 'k2'], io(stdin));
    assert.match(c.content, /^<!-- kit-render:k2 -->/);
    assert.equal(c.counts.blocking, 2);
  });
  it('reads --file relative to cwd', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'render-'));
    try {
      await fs.writeFile(path.join(d, 'f.json'), '﻿' + JSON.stringify(input()));
      const r = await run(['sarif', '--file', 'f.json'], io('', d));
      assert.equal(r.content.runs[0].results.length, 5);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('exit 1 on bad input', async () => {
    for (const args of [[], ['yaml'], ['sarif', '--nope'], ['comment', '--key'], ['comment', '--key', 'a b'], ['sarif', 'extra'], ['sarif', '--key', 'x'], ['sarif', '--file', 'missing.json']]) {
      await assert.rejects(run(args, io('{"findings":[]}', os.tmpdir())), e => e instanceof KitExit && e.code === 1, args.join(' '));
    }
    await assert.rejects(run(['sarif'], io('not json')), e => e.code === 1);
    await assert.rejects(run(['sarif'], io('')), e => e.code === 1);
    await assert.rejects(run(['sarif'], io('{"findings":[],"bogus":1}')), e => e.code === 1);
  });
});
