// The emitted decision deck in a real browser at phone size (390x844). Needs Playwright with Chromium; the tests
// skip cleanly where `require('playwright')` fails or Chromium will not launch.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emit, deckPaths } from '../src/lib/kit/decision-deck.js';

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

  async function open(t, init, { viewport = { width: 390, height: 844 }, deck = null, arg, clock = false } = {}) {
    if (!browser) { t.skip(`chromium will not launch: ${String(launchError && launchError.message).split('\n')[0]}`); return null; }
    let target = url;
    if (deck) {
      target = pathToFileURL(path.join(dir, `deck-${Math.random().toString(36).slice(2)}.html`)).href;
      fs.writeFileSync(fileURLToPath(target), emit(deck, { standalone: true }));
    }
    const ctx = await browser.newContext({ viewport, hasTouch: false });
    try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write']); } catch { /* fall back to the text box */ }
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) errors.push(`request: ${r.url()}`); });
    if (clock) await page.clock.install();
    if (init) await page.addInitScript(init, arg);
    await page.goto(target);
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
      await page.waitForTimeout(400);

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
      await page.waitForTimeout(400);

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
      for (let i = 0; i < 3; i++) { await page.waitForTimeout(400); await page.click('#later'); }
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
      await page.waitForTimeout(400);
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
    const { collection, progress } = deckPaths(JSON.parse(fs.readFileSync(FIXTURE, 'utf-8')));
    const init = ({ collection }) => {
      const touched = new Set();
      const writes = [];
      window.__touched = touched;
      window.__writes = writes;
      const db = {
        doc: (p) => ({ set: async (body) => { writes.push([p, body]); } }),
        collection: (p) => ({ get: async () => ({ docs: p === collection ? [{ id: 'f1', exists: true, data: () => ({ choice: 'no', note: 'from the cloud', at: 1 }) }] : [] }) }),
      };
      window.claude = new Proxy({ use: async (name) => (name === 'db' ? db : null) }, { get(target, k) { touched.add(String(k)); return target[k]; } });
    };
    const o = await open(t, init, { arg: { collection } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.click('#skip-story');
      await page.waitForFunction((pr) => window.__writes.some(([p]) => p === pr), progress);
      assert.equal(await text(page, '#progress'), '2 of 6', 'the card decided in the cloud is skipped');
      await page.click('.choice[data-choice="fix"]');
      await page.waitForTimeout(400);
      await page.waitForFunction((f) => window.__writes.some(([p]) => p === f), `${collection}/f2`);
      const writes = await page.evaluate(() => window.__writes);
      const f2 = writes.find(([p]) => p === `${collection}/f2`)[1];
      assert.equal(f2.choice, 'fix');
      assert.equal(f2.note, '');
      assert.equal(f2.title, 'Invoices say "draft" when they were already sent');
      assert.equal(typeof f2.at, 'number');
      assert.deepEqual(writes.filter(([p]) => p === progress).map(([, b]) => [b.decided, b.done, b.cards]), [[1, false, 6], [2, false, 6]]);
      for (let i = 0; i < 4; i++) { await page.keyboard.press('1'); await page.waitForTimeout(400); }
      assert.equal(await text(page, '#cloud-line'), 'Saved. The agent has your decisions.');
      await page.waitForFunction((pr) => window.__writes.some(([p, b]) => p === pr && b.done), progress);
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

  const longDeck = () => ({
    kind: 'decision-deck', v: 1, title: 'Long cards', choices: [{ id: 'fix', label: 'Fix' }, { id: 'later', label: 'Later' }, { id: 'no', label: 'No' }],
    cards: [
      { id: 'l1', title: 'A card with a lot to read before you can decide it properly', why: 'Because the owner could not tell what happened next. '.repeat(4).trim().slice(0, 215), quote: 'It kept happening and I could not tell why. '.repeat(3).trim().slice(0, 150), who: 'Owner, week three', stat: { value: '12', label: 'reports' }, tag: 'trust', recommend: 'fix', cost: 'About a week of work, plus a review.' },
      { id: 'l2', title: 'Second', why: 'Short.' },
    ],
  });
  const cardScroll = (page) => page.evaluate(() => {
    const c = document.getElementById('card'); const cost = document.getElementById('card-cost').getBoundingClientRect(); const box = c.getBoundingClientRect();
    return { scrollTop: c.scrollTop, scrollHeight: c.scrollHeight, clientHeight: c.clientHeight, costVisible: cost.top >= box.top && cost.bottom <= box.bottom + 1, touch: getComputedStyle(c).touchAction, overflowY: getComputedStyle(c).overflowY };
  });

  it('a long card scrolls at 360x640 (wheel, keyboard) so the cost line can be read, and a vertical drag decides nothing', async (t) => {
    const o = await open(t, null, { viewport: { width: 360, height: 640 }, deck: longDeck() });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      const before = await cardScroll(page);
      assert.ok(before.scrollHeight > before.clientHeight, 'the fixture card really is taller than its box');
      assert.equal(before.overflowY, 'auto');
      assert.equal(before.touch, 'pan-y');
      assert.equal(before.costVisible, false, 'the cost starts below the fold');

      // a vertical mouse drag (down, then up) neither swipes nor decides
      const box = await page.locator('#card').boundingBox();
      const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
      for (const dy of [180, -180]) {
        await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + dy, { steps: 6 }); await page.mouse.up();
      }
      await page.waitForTimeout(400);
      assert.equal(await text(page, '#progress'), '1 of 2', 'a vertical drag does not decide the card');
      assert.equal(await page.evaluate(() => document.getElementById('card').style.transform), '', 'and does not move it');

      // keyboard: the card is focusable and PageDown / Space scroll it
      await page.focus('#card');
      await page.keyboard.press('PageDown');
      await page.waitForFunction(() => document.getElementById('card').scrollTop > 0);
      for (let i = 0; i < 4; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(250); }
      await page.waitForFunction(() => { const k = document.getElementById('card-cost').getBoundingClientRect(); return k.bottom <= document.getElementById('card').getBoundingClientRect().bottom; });
      assert.equal((await cardScroll(page)).costVisible, true, 'the cost line scrolls into view by keyboard');
      assert.equal(await text(page, '#progress'), '1 of 2');

      // the wheel too, from the top
      await page.evaluate(() => { document.getElementById('card').scrollTop = 0; });
      assert.equal((await cardScroll(page)).costVisible, false);
      await page.mouse.move(cx, cy);
      for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(100); }
      await page.waitForFunction(() => { const k = document.getElementById('card-cost').getBoundingClientRect(); return k.bottom <= document.getElementById('card').getBoundingClientRect().bottom; });
      assert.equal((await cardScroll(page)).costVisible, true, 'the cost line scrolls into view by wheel');

      // a new card starts at the top
      await page.click('.choice[data-choice="later"]');
      assert.equal(await text(page, '#progress'), '2 of 2');
      assert.equal((await cardScroll(page)).scrollTop, 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('a pick made while the database read is still pending is not lost to an older row', async (t) => {
    const { collection, progress } = deckPaths(JSON.parse(fs.readFileSync(FIXTURE, 'utf-8')));
    const init = ({ collection }) => {
      const writes = [];
      window.__writes = writes;
      let release;
      const gate = new Promise((r) => { release = r; });
      window.__release = () => release();
      const rows = [
        { id: 'f1', exists: true, data: () => ({ choice: 'no', note: 'old cloud note', at: 1 }) },
        { id: 'f2', exists: true, data: () => ({ choice: 'later', note: '', at: 1 }) },
      ];
      const db = {
        doc: (p) => ({ set: async (body) => { writes.push([p, body]); } }),
        collection: (p) => ({ get: async () => { await gate; return { docs: p === collection ? rows : [] }; } }),
      };
      window.claude = { use: async () => db };
    };
    const o = await open(t, init, { arg: { collection } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.click('#skip-story');
      await page.fill('#note', 'newer local note');
      await page.keyboard.press('Escape');
      await page.click('.choice[data-choice="fix"]');
      assert.equal(await text(page, '#progress'), '2 of 6');
      await page.evaluate(() => window.__release());
      await page.waitForFunction((pr) => window.__writes.some(([p]) => p === pr), progress);
      const writes = await page.evaluate(() => window.__writes);
      const f1 = writes.filter(([p]) => p === `${collection}/f1`);
      assert.equal(f1.length, 1, 'the newer local pick is pushed over the stale row');
      assert.equal(f1[0][1].choice, 'fix');
      assert.equal(f1[0][1].note, 'newer local note');
      assert.equal(writes.filter(([p]) => p === `${collection}/f2`).length, 0, 'a row with no newer local pick is not rewritten');
      const local = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('decision-deck:')))));
      assert.equal(local.f1.choice, 'fix', 'the local pick survives the merge');
      assert.equal(local.f2.choice, 'later', 'a row with no local pick still resumes');
      assert.equal(await text(page, '#progress'), '2 of 6');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('a double click on Fix decides exactly one card; a held key and a fast second press decide nothing more', async (t) => {
    const o = await open(t);
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.click('#skip-story');
      await page.dblclick('.choice[data-choice="fix"]');
      await page.waitForTimeout(100);
      assert.equal(await text(page, '#progress'), '2 of 6', 'the second click of a double click does not decide the next card');
      assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('decision-deck:'))))).length), 1);

      await page.waitForTimeout(400);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', repeat: true, bubbles: true })));
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true })));
      assert.equal(await text(page, '#progress'), '2 of 6', 'a repeating keydown decides nothing');

      await page.keyboard.press('1');
      await page.keyboard.press('1');
      assert.equal(await text(page, '#progress'), '3 of 6', 'two quick presses decide one card');
      await page.waitForTimeout(400);
      await page.keyboard.press('1');
      assert.equal(await text(page, '#progress'), '4 of 6', 'and the next deliberate press works');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('focus lands on the next card after a pick (keys 1/2/3 and undo still work there), on the end title, and back on the edited row', async (t) => {
    const o = await open(t);
    if (!o) return;
    const { ctx, page, errors } = o;
    const active = () => page.evaluate(() => { const a = document.activeElement; return { id: a.id, label: a.getAttribute('aria-label') || '', labelledby: a.getAttribute('aria-labelledby'), describedby: a.getAttribute('aria-describedby') }; });
    try {
      await page.click('#skip-story');
      await page.click('.choice[data-choice="fix"]');
      let a = await active();
      assert.equal(a.id, 'card', 'focus moves to the next card');
      assert.equal(a.labelledby, 'card-title');
      assert.equal(a.describedby, 'card-why');
      await page.waitForTimeout(400);
      await page.keyboard.press('2');
      assert.equal(await text(page, '#progress'), '3 of 6', 'the number keys work with focus on the card');
      assert.equal((await active()).id, 'card');
      await page.keyboard.press('z');
      assert.equal(await text(page, '#progress'), '2 of 6', 'undo works with focus on the card');
      await page.waitForTimeout(400);
      await page.keyboard.press('3');
      assert.equal(await text(page, '#progress'), '3 of 6');
      await page.waitForTimeout(400);
      for (let i = 0; i < 4; i++) { await page.keyboard.press('1'); await page.waitForTimeout(400); }
      assert.equal(await page.locator('#end').isVisible(), true);
      assert.equal((await active()).id, 'end-title', 'the end screen takes focus on its title');
      assert.equal(await page.getAttribute('#end-title', 'tabindex'), '-1');

      await page.click('.pick >> text=Rename');
      await page.click('.choice[data-choice="no"]');
      assert.equal(await page.locator('#end').isVisible(), true);
      await page.waitForTimeout(300);
      a = await active();
      assert.match(a.label, /^Rename "Your team" to "Staff", No\. Change$/, 'focus returns to the row of the card just edited');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  /* ---- a configurable artifact database: rows by collection path, set() outcomes scripted per call ---- */
  const mockDb = (o) => {
    const writes = []; const calls = []; const reads = [];
    window.__writes = writes; window.__calls = calls; window.__reads = reads;
    window.__refuse = !!o.refuse;
    let release; const gate = new Promise((r) => { release = r; });
    window.__release = () => release();
    const fails = (o.fail || []).slice();
    const db = {
      doc: (p) => ({ set: (body) => {
        calls.push(p);
        if (o.hang === 'forever') return new Promise(() => {});
        const aimed = p.includes('/decisions/'); // scripted refusals hit the decision documents, not the progress one
        const code = aimed && fails.length ? fails.shift() : (window.__refuse ? o.refuse : null);
        if (code) return Promise.reject({ code, message: 'refused' });
        const done = () => { writes.push([p, body]); };
        if (o.hang === 'gate') return gate.then(done);
        done();
        return Promise.resolve();
      } }),
      collection: (p) => ({ get: async () => {
        reads.push(p);
        return { docs: ((o.rows || {})[p] || []).map((r) => ({ id: r.id, exists: true, data: () => r })) };
      } }),
    };
    window.claude = { use: (name) => new Promise((r) => setTimeout(() => { window.__resolved = true; r(name === 'db' ? db : null); }, o.delay || 0)) };
  };
  const quick = (n, title = `Quick ${n}`) => ({ kind: 'decision-deck', v: 1, title, cards: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `Card ${i}`, why: 'Because.' })) });
  const sampleDeck = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));

  it('a new deck republished to the same artifact does not resume another deck\'s picks', async (t) => {
    const deck = sampleDeck();
    const { collection } = deckPaths(deck);
    const f1 = { id: 'f1', choice: 'no', note: 'old', at: 1, title: deck.cards[0].title };
    const rows = {
      decisions: [f1],
      'decks/00000000/decisions': [f1],
      [collection]: [{ id: 'f2', choice: 'no', note: '', at: 1, title: 'A finding from last round' }],
    };
    const o = await open(t, mockDb, { arg: { rows } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.waitForFunction(() => window.__reads.length > 0);
      await page.waitForTimeout(150);
      await page.click('#skip-story');
      assert.deepEqual(await page.evaluate(() => window.__reads), [collection], 'the page reads only its own deck\'s collection');
      assert.equal(await text(page, '#progress'), '1 of 6', 'card 1 is undecided');
      assert.equal(await page.locator('.choice[aria-pressed="true"]').count(), 0);
      await page.keyboard.press('1');
      assert.equal(await text(page, '#progress'), '2 of 6', 'a row of this collection with another card title is not a pick either');
      assert.equal(await text(page, '#card-title'), deck.cards[1].title);
      await page.waitForFunction((f) => window.__writes.some(([p]) => p === f), `${collection}/f1`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('the database answering late keeps a typed note, the card scroll and a drag in progress', async (t) => {
    const deck = { ...longDeck(), cards: [...longDeck().cards, { id: 'l3', title: 'Third', why: 'Short.' }] };
    const { collection } = deckPaths(deck);
    const o = await open(t, mockDb, { viewport: { width: 360, height: 640 }, deck, arg: { delay: 1500, rows: { [collection]: [{ id: 'l2', choice: 'no', note: '', at: 1, title: 'Second' }] } } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.fill('#note', 'half a thought');
      await page.evaluate(() => { document.getElementById('card').scrollTop = 60; });
      const box = await page.locator('#card').boundingBox();
      const cx = box.x + box.width / 2; const cy = box.y + 120;
      await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 50, cy, { steps: 4 });
      assert.equal(await page.evaluate(() => window.__resolved === true), false, 'the drag started before the database answered');
      await page.waitForFunction(() => document.getElementById('track').style.width === '33%');
      assert.equal(await page.inputValue('#note'), 'half a thought', 'the unsaved note is kept');
      assert.equal(await page.evaluate(() => document.getElementById('card').scrollTop), 60, 'the card keeps its scroll');
      assert.notEqual(await page.evaluate(() => document.getElementById('card').style.transform), '', 'the drag is not reset');
      await page.mouse.up();
      assert.equal(await text(page, '#progress'), '1 of 3');
      await page.waitForTimeout(400);
      await page.click('.choice[data-choice="fix"]');
      assert.equal(await text(page, '#progress'), '3 of 3', 'the card decided in the database is skipped');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('the database deciding the card being typed on shows the pick but never touches the note', async (t) => {
    const deck = sampleDeck();
    const { collection } = deckPaths(deck);
    const o = await open(t, mockDb, { arg: { delay: 1500, rows: { [collection]: [{ id: 'f1', choice: 'no', note: 'from the cloud', at: 1, title: deck.cards[0].title }] } } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.click('#skip-story');
      await page.click('#note');
      await page.keyboard.type('typing while it loads');
      await page.waitForFunction(() => window.__resolved === true);
      await page.waitForFunction(() => document.querySelector('.choice[data-choice="no"]').getAttribute('aria-pressed') === 'true');
      assert.equal(await page.inputValue('#note'), 'typing while it loads');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'note', 'focus stays in the note');
      assert.equal(await text(page, '#progress'), '1 of 6', 'the owner is not moved off the card');
      await page.keyboard.type(', done');
      assert.equal(await page.inputValue('#note'), 'typing while it loads, done');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('says "Saving…" while a write is pending and the saved sentence only once it has landed', async (t) => {
    const deck = quick(1);
    const o = await open(t, mockDb, { deck, arg: { hang: 'gate' } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.waitForFunction(() => window.__resolved === true);
      await page.waitForTimeout(100);
      await page.keyboard.press('1');
      assert.equal(await page.locator('#end').isVisible(), true);
      assert.equal(await page.getAttribute('#cloud-line', 'role'), 'status');
      assert.equal(await text(page, '#cloud-line'), 'Saving…');
      await page.evaluate(() => window.__release());
      await page.waitForFunction(() => document.getElementById('cloud-line').textContent === 'Saved. The agent has your decisions.');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('a write that never settles times out after about 10 s and says so; later writes are not blocked', async (t) => {
    const deck = quick(1);
    const o = await open(t, mockDb, { deck, clock: true, arg: { hang: 'forever' } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.waitForFunction(() => window.__resolved === true);
      await page.waitForTimeout(100);
      await page.keyboard.press('1');
      assert.equal(await text(page, '#cloud-line'), 'Saving…');
      await page.clock.fastForward(11000);
      await page.waitForFunction(() => document.getElementById('cloud-line').textContent === 'Saved on this device only. Copy your decisions to send them.');
      assert.equal(await page.locator('#retry').isVisible(), true, 'the end screen offers to try again');
      const before = await page.evaluate(() => window.__calls.length);
      await page.click('#retry');
      await page.waitForFunction((n) => window.__calls.length > n, before);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('a write refused as unavailable is retried once and reaches the database', async (t) => {
    const deck = quick(1);
    const { collection } = deckPaths(deck);
    const o = await open(t, mockDb, { deck, arg: { fail: ['unavailable'] } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.waitForFunction(() => window.__resolved === true);
      await page.waitForTimeout(100);
      await page.keyboard.press('1');
      await page.waitForFunction((f) => window.__writes.some(([p, b]) => p === f && b.choice === 'fix'), `${collection}/c0`, { timeout: 5000 });
      assert.equal(await page.evaluate((f) => window.__calls.filter((p) => p === f).length, `${collection}/c0`), 2);
      await page.waitForFunction(() => document.getElementById('cloud-line').textContent === 'Saved. The agent has your decisions.');
      assert.equal(await text(page, '#save-line'), '');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('a write refused as resource_exhausted backs off and is retried', async (t) => {
    const deck = quick(1);
    const { collection } = deckPaths(deck);
    const o = await open(t, mockDb, { deck, arg: { fail: ['resource_exhausted'] } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.waitForFunction(() => window.__resolved === true);
      await page.waitForTimeout(100);
      const t0 = Date.now();
      await page.keyboard.press('1');
      await page.waitForFunction((f) => window.__writes.some(([p]) => p === f), `${collection}/c0`, { timeout: 8000 });
      assert.ok(Date.now() - t0 >= 1000, 'the retry waits longer after a rate signal');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('a finally refused pick does not turn the database off: later picks still go, and the refused one is pushed again', async (t) => {
    const deck = quick(2);
    const { collection } = deckPaths(deck);
    // two refusals: the first write of c0, and its re-push when the progress document lands
    const o = await open(t, mockDb, { deck, arg: { fail: ['invalid_argument', 'invalid_argument'] } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.waitForFunction(() => window.__resolved === true);
      await page.waitForTimeout(100);
      await page.keyboard.press('1');
      await page.waitForFunction(() => document.getElementById('save-line').textContent === 'Saved on this device only');
      await page.waitForTimeout(400);
      await page.keyboard.press('3');
      await page.waitForFunction((c) => window.__writes.some(([p]) => p === `${c}/c1`) && window.__writes.some(([p]) => p === `${c}/c0`), collection, { timeout: 5000 });
      const c0 = await page.evaluate((f) => window.__writes.find(([p]) => p === f)[1], `${collection}/c0`);
      assert.equal(c0.choice, 'fix');
      await page.waitForFunction(() => document.getElementById('cloud-line').textContent === 'Saved. The agent has your decisions.');
      assert.equal(await page.locator('#retry').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('"Try saving again" on the end screen pushes the refused picks once the database takes them', async (t) => {
    const deck = quick(1);
    const { collection } = deckPaths(deck);
    const o = await open(t, mockDb, { deck, arg: { refuse: 'quota_exceeded' } });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.waitForFunction(() => window.__resolved === true);
      await page.waitForTimeout(100);
      await page.keyboard.press('1');
      await page.waitForFunction(() => document.getElementById('cloud-line').textContent === 'Saved on this device only. Copy your decisions to send them.');
      assert.equal(await page.locator('#retry').isVisible(), true);
      assert.ok((await page.locator('#retry').boundingBox()).height >= 44);
      await page.evaluate(() => { window.__refuse = false; });
      await page.click('#retry');
      await page.waitForFunction(() => document.getElementById('cloud-line').textContent === 'Saved. The agent has your decisions.');
      assert.ok(await page.evaluate((f) => window.__writes.some(([p]) => p === f), `${collection}/c0`));
      assert.equal(await page.locator('#retry').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('when the browser cannot keep the picks it says "Not saved yet", never "Saved on this device"', async (t) => {
    const init = () => { Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; };
    const o = await open(t, init, { deck: quick(2) });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.keyboard.press('1');
      assert.equal(await text(page, '#save-line'), 'Not saved yet');
      assert.equal(await page.getAttribute('#save-line', 'aria-live'), 'polite');
      await page.waitForTimeout(400);
      await page.keyboard.press('1');
      assert.equal(await text(page, '#cloud-line'), 'Not saved yet. Copy your decisions to send them.');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('a card with the id "constructor" starts undecided', async (t) => {
    const deck = { kind: 'decision-deck', v: 1, title: 'Prototype names', cards: [{ id: 'constructor', title: 'Build the thing', why: 'W' }, { id: 'b', title: 'B', why: 'W' }] };
    const o = await open(t, null, { deck });
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      assert.equal(await page.locator('#deck').isVisible(), true);
      assert.equal(await text(page, '#progress'), '1 of 2');
      assert.equal(await text(page, '#card-title'), 'Build the thing');
      await page.keyboard.press('1');
      assert.equal(await text(page, '#progress'), '2 of 2');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  it('a double tap on Decide later skips one card; a fast second ArrowDown skips nothing more', async (t) => {
    const o = await open(t);
    if (!o) return;
    const { ctx, page, errors } = o;
    try {
      await page.click('#skip-story');
      await page.dblclick('#later');
      await page.waitForTimeout(100);
      assert.equal(await text(page, '#progress'), '2 of 6', 'the second tap of a double tap does not skip the next card');
      await page.waitForTimeout(400);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      assert.equal(await text(page, '#progress'), '3 of 6');
      await page.waitForTimeout(400);
      await page.click('#later');
      assert.equal(await text(page, '#progress'), '4 of 6', 'and the next deliberate tap works');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
});
