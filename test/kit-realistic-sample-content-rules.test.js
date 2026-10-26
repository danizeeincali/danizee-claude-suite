import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { lint, lintText, isTitleCase, parseRules, RULES, run, verb } from '../src/lib/kit/sample-content.js';

const exit1 = p => assert.rejects(p, e => e instanceof KitExit && e.code === 1);
const hits = (text, rule, opts = {}) => lintText(text, { rules: [rule], ...opts });
const io = (cwd, stdin = '') => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });

describe('sample-content rules', () => {
  it('lorem: flags lorem ipsum, not ordinary prose', () => {
    const f = hits('Intro\nLorem ipsum dolor sit amet\n', 'lorem');
    assert.equal(f.length, 1);
    assert.equal(f[0].line, 2);
    assert.equal(hits('Our dolorous lorry arrives on time.', 'lorem').length, 0);
  });

  it('placeholder-person: flags John Doe, Foo Bar, Test User; not real-looking names', () => {
    const f = hits('a\nBy John Doe\nand Jane Doe\nFoo Bar\nTest User\n', 'placeholder-person');
    assert.deepEqual(f.map(x => x.line), [2, 3, 4, 5]);
    assert.equal(hits('Maya Okafor and John Dorsey met Barfoo Bar Lane.', 'placeholder-person').length, 0);
  });

  it('placeholder-company: flags Acme and Example Inc, not Acme inside a word', () => {
    assert.equal(hits('Trusted by Acme Corp.\nAcme', 'placeholder-company').length, 2);
    assert.equal(hits('Example Inc is here', 'placeholder-company').length, 1);
    assert.equal(hits('Pacmeria, Acmeist and acme-lite are words; so is Examples Incorporated.', 'placeholder-company').length, 0);
  });

  it('hype: flags hype words, not near-miss words', () => {
    const f = hits('x\nA seamless, cutting-edge platform to unlock value and supercharge teams.', 'hype');
    assert.deepEqual(f.map(x => x.text.toLowerCase()), ['seamless', 'cutting-edge', 'unlock', 'supercharge']);
    assert.ok(f.every(x => x.line === 2));
    assert.equal(hits('Sync your calendar in 2 clicks. The lock is unlocked-by-key leveraged? no.', 'hype').length, 0);
  });

  it('title-case: flags Title Case headings and buttons, not sentence case', () => {
    const md = '# Get Started With Our Product\n\n## Use GitHub with SSO\n### How it works\n## Pricing for Teams\n';
    const f = hits(md, 'title-case');
    assert.deepEqual(f.map(x => x.line), [1]);
    const html = '<h2>Build Your Perfect Dashboard</h2>\n<button class="x">Start Your Free Trial</button>\n<a class="btn btn-primary" href="#">Book A Demo Today</a>\n<a href="#">Read The Full Story</a>\n<h3>Use GitHub with SSO</h3>\n<button>Save changes</button>\n';
    const g = hits(html, 'title-case', { isHtml: true });
    assert.deepEqual(g.map(x => x.line), [1, 2, 3]);
    assert.equal(isTitleCase('Use GitHub with SSO'), false);
    assert.equal(isTitleCase('Connect to NASA APIs'), false);
    assert.equal(isTitleCase('Pricing'), false);
    assert.equal(isTitleCase('Get Started Today'), true);
  });

  it('title-case: ignores headings inside code fences', () => {
    assert.equal(hits('```\n# Get Started With Our Product\n```\n', 'title-case').length, 0);
  });

  it('round-figure: flags 100%, 50% off, $10,000, 1,000,000; leaves years, versions, 10x, odd numbers', () => {
    const f = hits('Save 50% off\nJoin 1,000,000 users\nFrom $10,000 a year\n100% uptime\n', 'round-figure');
    assert.deepEqual(f.map(x => x.line), [1, 2, 3, 4]);
    for (const ok of ['Founded in 2000.', 'Version 100.0 shipped', 'Ships 10x faster', 'Up 47% since 2024', '1,284 users and $9,840', 'Call 555-0100 ext 100x', 'colour #100000', 'v100 build', 'See https://x.test/1000/100%']) {
      assert.equal(hits(ok, 'round-figure').length, 0, ok);
    }
  });

  it('round-figure: ignores CSS in HTML style blocks and attributes', () => {
    const html = '<style>.a{width:100%}</style>\n<div style="width:100%"><p>Only 47 left</p></div>\n';
    assert.equal(hits(html, 'round-figure', { isHtml: true }).length, 0);
  });

  it('repeated-date: flags a date used 3+ times at its first line, not twice', () => {
    const f = hits('Due March 3, 2026\nx\nShipped March 3, 2026\nOn March 3, 2026 again\n', 'repeated-date');
    assert.equal(f.length, 1);
    assert.equal(f[0].line, 1);
    assert.match(f[0].hint, /3 times/);
    assert.equal(hits('2026-01-05\n2026-01-05\n2026-01-06\n', 'repeated-date').length, 0);
    assert.equal(hits('2026-01-05 a\n2026-01-05 b\n2026-01-05 c\n', 'repeated-date').length, 1);
  });

  it('vague-error: flags vague copy with no next step, not copy that gives one', () => {
    const f = hits('ok\nSomething went wrong\n\nAn error occurred.\n', 'vague-error');
    assert.deepEqual(f.map(x => x.line), [2, 4]);
    assert.equal(hits('Something went wrong. Try again in a minute.', 'vague-error').length, 0);
    assert.equal(hits('An error occurred\nCheck your connection and retry.', 'vague-error').length, 0);
    assert.equal(hits('We could not save your changes. Check your connection.', 'vague-error').length, 0);
  });

  it('every finding carries a concrete hint, a rule and a line', () => {
    const doc = 'Lorem ipsum\nJohn Doe at Acme Corp\nSeamless\n# Get Started With Our Product\n100% off\nSomething went wrong\nMarch 3, 2026 March 3, 2026 March 3, 2026\n';
    const { findings, counts } = lint(doc, { rules: RULES, name: 'a.md' });
    assert.deepEqual([...new Set(findings.map(f => f.rule))].sort(), [...RULES].sort());
    for (const f of findings) {
      assert.ok(Number.isInteger(f.line) && f.line >= 1);
      assert.ok(f.text);
      assert.ok(f.hint.length > 25, f.hint);
    }
    assert.equal(counts.total, findings.length);
    assert.equal(counts.hype, 1);
  });
});

describe('sample-content JSON and html input', () => {
  it('scans strings inside JSON values and reports their lines', () => {
    const raw = JSON.stringify({ title: 'Fine', items: [{ body: 'Lorem ipsum dolor', who: 'Jane Doe' }, { h: '# Get Started With Our Product' }] }, null, 2);
    const { findings } = lint(raw, { name: 'x.json' });
    const by = Object.fromEntries(findings.map(f => [f.rule, f.line]));
    assert.equal(by.lorem, raw.split('\n').findIndex(l => l.includes('Lorem')) + 1);
    assert.equal(by['placeholder-person'], raw.split('\n').findIndex(l => l.includes('Jane')) + 1);
    assert.ok(by['title-case']);
  });

  it('does not scan JSON keys, and rejects invalid JSON in a .json file', () => {
    assert.equal(lint('{"Lorem ipsum":"fine"}', { name: 'x.json' }).findings.length, 0);
    assert.throws(() => lint('{nope', { name: 'x.json' }), e => e instanceof KitExit && e.code === 1);
  });

  it('keeps line numbers through HTML scripts and comments', () => {
    const html = '<!-- a\nb -->\n<script>\nvar a = 100%;\n</script>\n<p>Revolutionary idea</p>\n';
    const { findings } = lint(html, { name: 'p.html' });
    assert.deepEqual(findings.map(f => [f.rule, f.line]), [['hype', 6]]);
  });
});

describe('sample-content run', () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sample-content-'));
    await fs.writeFile(path.join(dir, 'a.md'), '# Welcome\nLorem ipsum\nJohn Doe loves seamless things\n');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('exports the verb and lints a file', async () => {
    assert.equal(verb, 'sample-content');
    const r = await run(['lint', '--file', 'a.md'], io(dir));
    assert.equal(r.counts.total, 3);
    assert.deepEqual(r.findings.map(f => f.line), [2, 3, 3]);
    assert.equal(r.exit, undefined);
  });

  it('--rules limits the rules; an unknown rule or bad argument exits 1', async () => {
    const r = await run(['lint', '--file', 'a.md', '--rules', 'hype,lorem'], io(dir));
    assert.deepEqual(r.findings.map(f => f.rule).sort(), ['hype', 'lorem']);
    assert.deepEqual(r.rules, ['hype', 'lorem']);
    await exit1(run(['lint', '--file', 'a.md', '--rules', 'hype,bogus'], io(dir)));
    await exit1(run(['lint', '--file', 'a.md', '--rules', ''], io(dir)));
    await exit1(run(['lint', '--file', 'a.md', '--wat', 'x'], io(dir)));
    await exit1(run(['bogus'], io(dir)));
    await exit1(run(['lint', '--file', 'missing.md'], io(dir)));
    await exit1(run(['lint'], { ...io(dir, '  \n') }));
    assert.throws(() => parseRules('nope'), KitExit);
  });

  it('reads stdin and sniffs JSON', async () => {
    const r = await run(['lint'], io(dir, '{"a":"Acme Corp"}'));
    assert.equal(r.counts['placeholder-company'], 1);
    const t = await run(['lint'], io(dir, 'plain\nJohn Doe'));
    assert.equal(t.findings[0].line, 2);
  });

  it('rejects input over 8 MiB', async () => {
    await exit1(run(['lint'], io(dir, 'a'.repeat(8 * 1024 * 1024 + 1))));
  });
});
