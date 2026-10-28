import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { lint, lintText, htmlToText, run } from '../src/lib/kit/sample-content.js';

const timed = fn => { const t = Date.now(); const r = fn(); return { r, ms: Date.now() - t }; };
const io = cwd => ({ cwd, stdin: async () => '', stdinIsTTY: true, env: {} });
const exit1 = p => assert.rejects(p, e => e instanceof KitExit && e.code === 1);

describe('sample-content review r2', () => {
  it('lineOf: 2 MB with thousands of findings lints in under 2 s with right lines', () => {
    const doc = Array.from({ length: 4000 }, (_, i) => `Pay $1,000 for 500 seats.\n${'filler text here '.repeat(8)}\n`.repeat(1) + 'x\n'.repeat(8)).join('');
    const big = doc + 'y'.repeat(Math.max(0, 2_000_000 - doc.length));
    const { r, ms } = timed(() => lint(big, { rules: ['round-figure'] }));
    assert.ok(ms < 2000, `took ${ms} ms`);
    assert.equal(r.counts['round-figure'], 8000);
    assert.equal(r.findings[0].line, 1);
    assert.equal(r.findings[2].line, 11);
    const dense = 'We use 100% of it.\n'.repeat(55000);
    const t2 = timed(() => lint(dense, { rules: ['round-figure'] }));
    assert.ok(t2.ms < 2000, `dense took ${t2.ms} ms`);
    assert.equal(t2.r.findings[54999].line, 55000);
  });

  it('vague-error: description words are not a next step', () => {
    for (const s of ['Something went wrong while we tried to add your card.', 'Something went wrong with your sign in.', 'An error occurred. Please']) {
      assert.equal(lintText(s, { rules: ['vague-error'] }).length, 1, s);
    }
    for (const s of ['Something went wrong. Try again in a minute.', 'An error occurred. Check your connection.', 'Something went wrong, please try again.', 'Something went wrong.\nContact support.']) {
      assert.equal(lintText(s, { rules: ['vague-error'] }).length, 0, s);
    }
  });

  it('unclosed html openers are linear (about 2 MB under 2 s)', () => {
    const cases = ['<b>x</b>' + '<script '.repeat(250_000), '<!-- '.repeat(400_000), '<a href=x>'.repeat(200_000), '<h1>'.repeat(500_000), '<a '.repeat(700_000), '<a class="btn">'.repeat(130_000)];
    for (const c of cases) {
      const { ms } = timed(() => lint(c, { format: 'html' }));
      assert.ok(ms < 2000, `${c.slice(0, 12)} took ${ms} ms`);
    }
    assert.equal(htmlToText('a<b>x</b>\n<!-- c\nd -->e').includes('c'), false);
    assert.equal(lintText('<h1>Sign Up For Free</h1>\n<h1>Plain heading here', { rules: ['title-case'], isHtml: true }).length, 1);
  });

  it('deeply nested JSON exits 1 naming the problem, not a RangeError', () => {
    const raw = '['.repeat(20000) + ']'.repeat(20000);
    assert.throws(() => lint(raw), e => e instanceof KitExit && e.code === 1 && /nested too deeply/.test(e.message));
    assert.equal(lint('[[["Lorem ipsum dolor"]]]').findings.length, 1);
  });

  it('file input: devices, /proc, FIFOs refused on the open handle', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sc-r2-'));
    try {
      await exit1(run(['lint', '--file', '/dev/stdin'], io(dir)));
      await exit1(run(['lint', '--file', '/dev/zero'], io(dir)));
      await exit1(run(['lint', '--file', '/proc/self/status'], io(dir)));
      await fs.symlink('/dev/zero', path.join(dir, 'z.md'));
      await exit1(run(['lint', '--file', 'z.md'], io(dir)));
      execFileSync('mkfifo', [path.join(dir, 'f.md')]);
      await exit1(run(['lint', '--file', 'f.md'], io(dir)));
      await fs.writeFile(path.join(dir, 'ok.md'), 'Lorem ipsum dolor\n');
      assert.equal((await run(['lint', '--file', 'ok.md'], io(dir))).findings.length, 1);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('r3: UTF-16 input is decoded by BOM, not read as NUL-interleaved UTF-8', async () => {
    const text = 'Lorem ipsum dolor. Acme Corp is revolutionary.';
    const le = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]);
    const be = Buffer.from(le.subarray(2)).swap16();
    const u8 = await run(['lint'], { stdinBytes: async () => Buffer.from(text), stdinIsTTY: false, env: {} });
    for (const b of [le, Buffer.concat([Buffer.from([0xFE, 0xFF]), be])]) {
      const r = await run(['lint'], { stdinBytes: async () => b, stdinIsTTY: false, env: {} });
      assert.ok(r.findings.length > 0);
      assert.deepEqual(r.findings, u8.findings);
    }
  });

  it('r3: CR-only line endings give per-line numbers and see headings', async () => {
    const r = await run(['lint'], { stdinBytes: async () => Buffer.from('Intro\r\rLorem ipsum here\r# Get Started With Us\r'), stdinIsTTY: false, env: {} });
    assert.equal(r.findings.find(f => f.rule === 'lorem').line, 3);
    assert.ok(r.findings.some(f => f.line === 4 && /title|case/i.test(f.rule)));
  });
});
