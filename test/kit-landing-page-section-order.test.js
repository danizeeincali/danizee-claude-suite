import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as ls from '../src/lib/kit/landing-sections.js';

const { PLAN, planSections, checkText, canonical, run, verb } = ls;
const io = (stdin, cwd) => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
const exit = async (p, code = 1) => assert.rejects(Promise.resolve().then(p), e => e instanceof KitExit && e.code === code);

const IDS = ['hero', 'problem-solution', 'benefits', 'how-it-works', 'tagline', 'social-proof', 'faq', 'risk-reversal', 'final-cta'];

describe('plan', () => {
  it('lists the nine canonical sections in order with the hero above the fold', () => {
    const { sections } = planSections();
    assert.deepEqual(sections.map(s => s.id), IDS);
    assert.deepEqual(sections.filter(s => s.above_fold).map(s => s.id), ['hero']);
    for (const s of sections) {
      assert.equal(typeof s.label, 'string');
      assert.equal(typeof s.must, 'boolean');
    }
    assert.equal(sections[0].must, true);
    assert.ok(sections.find(s => s.id === 'final-cta').must);
    assert.equal(sections.find(s => s.id === 'tagline').must, false);
  });
  it('run plan returns the same object and rejects extra args', async () => {
    assert.deepEqual(await run(['plan'], io('')), planSections());
    await exit(() => run(['plan', '--file', 'x'], io('')));
    await exit(() => run([], io('')));
    await exit(() => run(['bogus'], io('')));
  });
});

describe('aliases', () => {
  it('maps common names to canonical ids', () => {
    assert.equal(canonical('Testimonials'), 'social-proof');
    assert.equal(canonical('Pricing Guarantee'), 'risk-reversal');
    assert.equal(canonical('money_back_guarantee'), 'risk-reversal');
    assert.equal(canonical('How it works'), 'how-it-works');
    assert.equal(canonical('Frequently Asked Questions'), 'faq');
    assert.equal(canonical('Get started today'), 'final-cta');
    assert.equal(canonical('Features'), 'benefits');
    assert.equal(canonical('The problem'), 'problem-solution');
    assert.equal(canonical('Our team'), null);
  });
});

const MD_GOOD = `# Landing page spec

## Hero
Headline: Ship faster
[Start free trial](/signup)

## Problem and solution
Text

## Benefits
- a

## How it works
1. a 2. b 3. c

## Tagline
One line

## Testimonials
Quote

## FAQ
Q

## Pricing guarantee
30 days

## Final CTA
[Start free trial](/signup)
`;

describe('check — markdown', () => {
  it('finds every section in order for a complete spec', () => {
    const r = checkText(MD_GOOD, 'md');
    assert.deepEqual(r.found, IDS);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.out_of_order, []);
    assert.deepEqual(r.cta, { hero: true, final: true, mirrors: true });
  });
  it('reports missing must sections but not optional ones', () => {
    const r = checkText('## Hero\n[Go](/x)\n\n## Benefits\nx\n\n## FAQ\nx\n', 'md');
    assert.deepEqual(r.found, ['hero', 'benefits', 'faq']);
    assert.deepEqual(r.missing, ['problem-solution', 'how-it-works', 'social-proof', 'final-cta']);
    assert.deepEqual(r.cta, { hero: true, final: false, mirrors: false });
  });
  it('flags out-of-order sections with the id they belong after', () => {
    const md = '## Hero\n\n## Benefits\n\n## Problem\n\n## How it works\n\n## Final CTA\n\n## Testimonials\n';
    const r = checkText(md, 'md');
    assert.deepEqual(r.out_of_order, [
      { id: 'problem-solution', expected_after: 'hero' },
      { id: 'social-proof', expected_after: 'tagline' },
    ]);
  });
  it('detects a final CTA that does not mirror the hero', () => {
    const md = '## Hero\n[Start free trial](/a)\n\n## Final CTA\n[Contact sales](/b)\n';
    assert.equal(checkText(md, 'md').cta.mirrors, false);
    const md2 = '## Hero\n[Start Free Trial!](/a)\n\n## Final CTA\n[start free trial](/a)\n';
    assert.deepEqual(checkText(md2, 'md').cta, { hero: true, final: true, mirrors: true });
  });
  it('accepts CTA: lines and ignores headings inside code fences', () => {
    const md = '## Hero\nPrimary CTA: Book a demo\n\n```\n## FAQ\n```\n\n## Final CTA\nCTA: Book a demo\n';
    const r = checkText(md, 'md');
    assert.deepEqual(r.found, ['hero', 'final-cta']);
    assert.equal(r.cta.mirrors, true);
  });
  it('ignores unknown headings and counts a repeated section once', () => {
    const r = checkText('# Title\n## Hero\n## About us\n## Hero again\n', 'md');
    assert.deepEqual(r.found, ['hero']);
  });
});

const HTML = `<!doctype html><html><body>
<header data-section="hero"><h1>Ship faster</h1><a class="btn" href="/s">Start free trial</a></header>
<section id="problem"><p>x</p></section>
<section id="benefits"></section>
<section data-section="how-it-works"></section>
<section id="testimonials"></section>
<section id="faq"></section>
<section id="guarantee"></section>
<section data-section="final-cta" id="whatever"><button>Start   free trial</button></section>
</body></html>`;

describe('check — html', () => {
  it('finds sections by id and data-section, data-section winning', () => {
    const r = checkText(HTML, 'html');
    assert.deepEqual(r.found, ['hero', 'problem-solution', 'benefits', 'how-it-works', 'social-proof', 'faq', 'risk-reversal', 'final-cta']);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.out_of_order, []);
    assert.deepEqual(r.cta, { hero: true, final: true, mirrors: true });
  });
  it('detects out-of-order html and a differing final CTA', () => {
    const h = '<div id="faq"></div><div id="hero"><a href="#" class="cta">Buy</a></div><div id="final-cta"><a class="cta">Talk</a></div>';
    const r = checkText(h, 'html');
    assert.deepEqual(r.found, ['faq', 'hero', 'final-cta']);
    assert.deepEqual(r.out_of_order, [{ id: 'hero', expected_after: null }]);
    assert.deepEqual(r.cta, { hero: true, final: true, mirrors: false });
  });
  it('ignores attributes inside comments, scripts and quoted values', () => {
    const h = '<!-- <div id="faq"> --><script>var s = \'<div id="hero">\';</script><div title=\'id="benefits"\' id="hero"></div>';
    assert.deepEqual(checkText(h, 'html').found, ['hero']);
  });
});

describe('run — input handling', () => {
  it('reads a file, sniffs html from stdin and rejects bad input with exit 1', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ls-'));
    try {
      await fs.writeFile(path.join(dir, 'spec.md'), MD_GOOD);
      await fs.writeFile(path.join(dir, 'page.html'), HTML);
      await fs.writeFile(path.join(dir, 'bin.md'), Buffer.from([65, 0, 66]));
      assert.deepEqual((await run(['check', '--file', 'spec.md'], io('', dir))).found, IDS);
      assert.equal((await run(['check', '--file', 'page.html'], io('', dir))).found.length, 8);
      assert.equal((await run(['check'], io(HTML, dir))).found.length, 8);
      assert.equal((await run(['check'], io(MD_GOOD, dir))).found.length, 9);
      await exit(() => run(['check', '--file', 'nope.md'], io('', dir)));
      await exit(() => run(['check', '--file', 'bin.md'], io('', dir)));
      await exit(() => run(['check', '--file', dir], io('', dir)));
      await exit(() => run(['check'], io('   ', dir)));
      await exit(() => run(['check', '--file'], io('', dir)));
      await exit(() => run(['check', '--wat', 'x'], io('', dir)));
      await exit(() => run(['check', 'stray'], io('', dir)));
      await exit(() => run(['check'], io('x'.repeat(8 * 1024 * 1024 + 1), dir)));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  const bytesIo = (buf, seen, cwd) => ({ cwd, stdinBytes: async o => { seen.push(o); return buf; }, stdin: async () => { throw new Error('text stdin must not be used'); }, stdinIsTTY: false, env: {} });
  it('stdin is read as bounded bytes and the cap counts bytes, not characters', async () => {
    const seen = [];
    const r = await run(['check'], bytesIo(Buffer.from(MD_GOOD), seen));
    assert.equal(r.found.length, 9);
    assert.deepEqual(seen, [{ maxBytes: 8 * 1024 * 1024 + 1 }]);
    const big = Buffer.from('é'.repeat(4.5 * 1024 * 1024));
    assert.ok(big.length > 8 * 1024 * 1024 && big.toString().length < 8 * 1024 * 1024);
    await exit(() => run(['check'], bytesIo(big, [])));
  });
  it('sniffs the same result for stdin as for --file: markdown with a fenced html snippet stays markdown', async () => {
    const md = '## Hero\n[Go](/a)\n\n## Benefits\n\n```html\n<section id="faq"></section>\n```\n\n## Final CTA\n[Go](/a)\n';
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ls-'));
    try {
      await fs.writeFile(path.join(dir, 'spec.md'), md);
      const viaFile = await run(['check', '--file', 'spec.md'], io('', dir));
      const viaStdin = await run(['check'], io(md, dir));
      assert.deepEqual(viaStdin, viaFile);
      assert.deepEqual(viaStdin.found, ['hero', 'benefits', 'final-cta']);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('refuses a repeated or empty --file', async () => {
    await exit(() => run(['check', '--file', 'a.md', '--file', 'b.md'], io('', process.cwd())));
    await exit(() => run(['check', '--file', ''], io(MD_GOOD, process.cwd())));
  });
  it('exports the verb contract', () => {
    assert.equal(verb, 'landing-sections');
    assert.match(ls.usage, /landing-sections/);
    assert.equal(PLAN.length, 9);
  });
});
