// The emitted decision deck in a real browser at phone size (390x844). Needs Playwright with Chromium; the tests
// skip cleanly where `require('playwright')` fails or Chromium will not launch.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emit } from '../src/lib/kit/decision-deck.js';

const require = createRequire(import.meta.url);
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'decision-deck', 'sample.json');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch { chromium = null; }

describe('decision-deck — in the browser', { skip: chromium ? false : 'playwright is not installed' }, () => {
  let browser = null;
  let dir;
  let url;
  let launchError = null;
  before(async () => {
    try { browser = await chromium.launch(); } catch (e) { launchError = e; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-deck-pw-'));
    const file = path.join(dir, 'deck.html');
    fs.writeFileSync(file, emit(JSON.parse(fs.readFileSync(FIXTURE, 'utf-8')), { standalone: true }));
    url = pathToFileURL(file).href;
  });
  after(async () => {
    if (browser) await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function open(t, init) {
    if (!browser) { t.skip(`chromium will not launch: ${String(launchError && launchError.message).split('\n')[0]}`); return null; }
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false });
    try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write']); } catch { /* fall back to the text box */ }
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) errors.push(`request: ${r.url()}`); });
    if (init) await page.addInitScript(init);
    await page.goto(url);
    return { ctx, page, errors };
  }
  const text = (page, sel) => page.locator(sel).innerText();

  it('decides by button, swipe and key, undoes one, ends with the right list and export', async (t) => {
    const o = await open(t);
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      assert.equal(await page.locator('#story').isVisible(), true, 'the story comes first');
      await page.click('#skip-story');
      assert.equal(await text(page, '#progress'), '1 of 6');
      assert.equal(await text(page, '#card-title'), 'Nobody knew what to press after the morning brief');
      assert.match(await text(page, '#card-suggested'), /Suggested: Fix/);
      assert.equal(await page.locator('.choice[aria-pressed="true"]').count(), 0, 'the suggestion is never pre-selected');
      const sizes = await page.$$eval('button:not([hidden])', (bs) => bs.filter((b) => b.offsetParent).map((b) => [b.textContent.trim(), b.getBoundingClientRect().height]));
      for (const [name, h] of sizes) assert.ok(h >= 44, `${name} is ${h}px tall`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');

      // 1. by button, with a note
      await page.fill('#note', 'Ask Sam first');
      await page.click('.choice[data-choice="fix"]');
      assert.equal(await text(page, '#progress'), '2 of 6');
      assert.equal(await page.inputValue('#note'), '');

      // 2. by swipe: drag left past the threshold
      const box = await page.locator('#card').boundingBox();
      const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx - 60, cy, { steps: 4 });
      assert.equal(await text(page, '#drag-label'), 'No', 'the drag shows which choice it means');
      await page.mouse.move(cx - 200, cy, { steps: 6 });
      await page.mouse.up();
      await page.waitForFunction(() => document.getElementById('progress').textContent === '3 of 6');

      // a short drag springs back and decides nothing
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 40, cy, { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(350);
      assert.equal(await text(page, '#progress'), '3 of 6');

      // 3. by key, then undo it and decide again with an arrow
      await page.keyboard.press('2');
      assert.equal(await text(page, '#progress'), '4 of 6');
      await page.keyboard.press('z');
      assert.equal(await text(page, '#progress'), '3 of 6');
      assert.equal(await text(page, '#card-title'), 'Add a dark theme to the schedule');
      await page.keyboard.press('n');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'note');
      await page.keyboard.type('Only if cheap');
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowRight');
      assert.equal(await text(page, '#progress'), '4 of 6');

      // the rest: decide later
      for (let i = 0; i < 3; i++) await page.click('#later');
      assert.equal(await page.locator('#end').isVisible(), true);
      assert.equal(await text(page, '#end-title'), '3 decided, 3 left');
      assert.deepEqual(await page.$$eval('#counts li', (ls) => ls.map((l) => l.textContent)), ['2Fix', '0Later', '1No']);
      assert.deepEqual(await page.$$eval('.group h2', (hs) => hs.map((h) => h.textContent)), ['Fix · 2', 'No · 1', 'Not decided yet · 3']);
      assert.match(await text(page, '#groups'), /Note: Ask Sam first/);
      assert.match(await text(page, '#cloud-line'), /Saved on this device/);

      await page.click('#copy');
      const expected = 'f1 | fix | Ask Sam first\nf2 | no | \nf3 | fix | Only if cheap\nf4 | undecided | \nf5 | undecided | \nf6 | undecided | ';
      let copied = null;
      try { copied = await page.evaluate(() => navigator.clipboard.readText()); } catch { copied = null; }
      assert.equal(copied ?? await page.inputValue('#export'), expected);
      assert.equal(await page.inputValue('#export'), expected);

      // tap a row to change it, then back to the list
      await page.click('.pick >> text=Rename');
      assert.equal(await text(page, '#card-title'), 'Rename "Your team" to "Staff"');
      await page.click('.choice[data-choice="later"]');
      assert.equal(await text(page, '#end-title'), '4 decided, 2 left');

      // a reload resumes at the first open card
      await page.reload();
      assert.equal(await page.locator('#deck').isVisible(), true, 'a resumed deck skips the story');
      assert.equal(await text(page, '#progress'), '4 of 6');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('as a Claude artifact: resumes from the database, writes each pick, touches only claude.use', async (t) => {
    const init = () => {
      const touched = new Set();
      const writes = [];
      window.__touched = touched;
      window.__writes = writes;
      const db = {
        doc: (p) => ({ set: async (body) => { writes.push([p, body]); } }),
        collection: (p) => ({ get: async () => ({ docs: p === 'decisions' ? [{ id: 'f1', exists: true, data: () => ({ choice: 'no', note: 'from the cloud', at: 1 }) }] : [] }) }),
      };
      window.claude = new Proxy({ use: async (name) => (name === 'db' ? db : null) }, { get(target, k) { touched.add(String(k)); return target[k]; } });
    };
    const o = await open(t, init);
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.click('#skip-story');
      await page.waitForFunction(() => window.__writes.some(([p]) => p === 'decks/meta'));
      assert.equal(await text(page, '#progress'), '2 of 6', 'the card decided in the cloud is skipped');
      await page.click('.choice[data-choice="fix"]');
      await page.waitForFunction(() => window.__writes.some(([p]) => p === 'decisions/f2'));
      const writes = await page.evaluate(() => window.__writes);
      const f2 = writes.find(([p]) => p === 'decisions/f2')[1];
      assert.equal(f2.choice, 'fix');
      assert.equal(f2.note, '');
      assert.equal(f2.title, 'Invoices say "draft" when they were already sent');
      assert.equal(typeof f2.at, 'number');
      assert.deepEqual(writes.filter(([p]) => p === 'decks/meta').map(([, b]) => [b.decided, b.done, b.cards]), [[1, false, 6], [2, false, 6]]);
      for (let i = 0; i < 4; i++) await page.keyboard.press('1');
      assert.equal(await text(page, '#cloud-line'), 'Saved. The agent has your decisions.');
      await page.waitForFunction(() => window.__writes.some(([p, b]) => p === 'decks/meta' && b.done));
      assert.match(await text(page, '#groups'), /Note: from the cloud/);
      assert.deepEqual([...await page.evaluate(() => [...window.__touched])], ['use']);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('a database that refuses writes leaves one quiet line and keeps working', async (t) => {
    const init = () => {
      const db = { doc: () => ({ set: async () => { throw { code: 'invalid_argument', message: 'no' }; } }), collection: () => ({ get: async () => ({ docs: [] }) }) };
      window.claude = { use: async () => db };
    };
    const o = await open(t, init);
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.click('#skip-story');
      await page.keyboard.press('1');
      await page.waitForFunction(() => document.getElementById('save-line').textContent === 'Saved on this device only');
      assert.equal(await text(page, '#progress'), '2 of 6');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
});
