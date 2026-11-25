import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as dd from '../src/lib/kit/decision-deck.js';

const { check, emit, read, run, verb, swipeIntent, exportText, mergeResume, deckKey, deckPaths, nextOpen, pageTitle, parseDecisions, embedJson } = dd;
/** A map with no prototype, as the page's id-keyed maps are. */
const bare = (o) => Object.assign(Object.create(null), o);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'decision-deck', 'sample.json');
const sample = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
const io = (stdin, cwd) => ({ cwd, stdin: async () => Buffer.from(stdin ?? ''), stdinIsTTY: false, env: {} });
const exit1 = (p) => assert.rejects(Promise.resolve().then(p), (e) => e instanceof KitExit && e.code === 1);
const paths = (r) => r.problems.map((p) => p.path);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'decision-deck-'));
const mini = (over = {}) => ({ kind: 'decision-deck', v: 1, title: 'Round 2', cards: [{ id: 'a', title: 'Do A', why: 'Because.' }], ...over });

/** A real PNG of w x h grey pixels, as a data: URI. */
function png(w = 2, h = 2, noise = false) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  if (noise) for (let i = 0; i < raw.length; i++) raw[i] = i % (w + 1) === 0 ? 0 : (i * 2654435761) >>> 24;
  const data = zlib.deflateSync(raw, { level: noise ? 0 : 9 });
  const buf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

describe('decision-deck — check', () => {
  it('is a registered verb and the fixture passes', () => {
    assert.equal(verb, 'decision-deck');
    const r = check(sample());
    assert.deepEqual(r, { ok: true, cards: 6, problems: [] });
  });

  it('every problem carries path, message and fix', () => {
    const r = check({});
    assert.equal(r.ok, false);
    for (const p of r.problems) { assert.equal(typeof p.path, 'string'); assert.ok(p.message); assert.ok(p.fix); }
    assert.deepEqual(check([]).problems.map((p) => p.path), ['']);
  });

  it('kind, v, title and lede bounds', () => {
    assert.ok(paths(check(mini({ kind: 'deck' }))).includes('kind'));
    assert.ok(paths(check(mini({ v: 2 }))).includes('v'));
    assert.ok(paths(check(mini({ title: '' }))).includes('title'));
    assert.ok(paths(check(mini({ title: 'x'.repeat(61) }))).includes('title'));
    assert.equal(check(mini({ title: 'x'.repeat(60) })).ok, true);
    assert.ok(paths(check(mini({ title: undefined }))).includes('title'));
    assert.ok(paths(check(mini({ lede: 'x'.repeat(141) }))).includes('lede'));
    assert.equal(check(mini({ lede: 'x'.repeat(140) })).ok, true);
    assert.ok(paths(check(mini({ extra: 1 }))).includes('extra'));
    // characters, not bytes
    assert.equal(check(mini({ title: 'é'.repeat(60) })).ok, true);
  });

  it('choices: 2-4, ids, labels, unique, the reserved word', () => {
    assert.ok(paths(check(mini({ choices: [{ id: 'a', label: 'A' }] }))).includes('choices'));
    assert.ok(paths(check(mini({ choices: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, label: 'C' })) }))).includes('choices'));
    assert.ok(paths(check(mini({ choices: 'fix' }))).includes('choices'));
    assert.ok(paths(check(mini({ choices: [{ id: 'A!', label: 'A' }, { id: 'b', label: 'B' }] }))).includes('choices[0].id'));
    assert.ok(paths(check(mini({ choices: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }))).includes('choices[1].id'));
    assert.ok(paths(check(mini({ choices: [{ id: 'a', label: '' }, { id: 'b', label: 'B' }] }))).includes('choices[0].label'));
    assert.ok(paths(check(mini({ choices: [{ id: 'a', label: 'x'.repeat(21) }, { id: 'b', label: 'B' }] }))).includes('choices[0].label'));
    assert.ok(paths(check(mini({ choices: [{ id: 'undecided', label: 'U' }, { id: 'b', label: 'B' }] }))).includes('choices[0].id'));
    assert.ok(paths(check(mini({ choices: [{ id: 'a', label: 'A', color: 'red' }, { id: 'b', label: 'B' }] }))).includes('choices[0].color'));
    assert.equal(check(mini({ choices: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] })).ok, true);
  });

  it('cards: at least one, ids unique and well-formed, every text bound', () => {
    assert.ok(paths(check(mini({ cards: [] }))).includes('cards'));
    assert.ok(paths(check(mini({ cards: 'x' }))).includes('cards'));
    const many = Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, title: 'T', why: 'W' }));
    assert.ok(paths(check(mini({ cards: many }))).includes('cards'));
    const card = (over) => mini({ cards: [{ id: 'a', title: 'T', why: 'W', ...over }] });
    assert.ok(paths(check(card({ id: 'A' }))).includes('cards[0].id'));
    assert.ok(paths(check(card({ id: 'x'.repeat(41) }))).includes('cards[0].id'));
    assert.equal(check(card({ id: 'x'.repeat(40) })).ok, true);
    assert.ok(paths(check(mini({ cards: [{ id: 'a', title: 'T', why: 'W' }, { id: 'a', title: 'T', why: 'W' }] }))).includes('cards[1].id'));
    for (const [k, max] of [['title', 90], ['why', 220], ['quote', 160], ['who', 60], ['tag', 20], ['cost', 60]]) {
      assert.equal(check(card({ [k]: 'x'.repeat(max) })).ok, true, `${k} at ${max}`);
      assert.ok(paths(check(card({ [k]: 'x'.repeat(max + 1) }))).includes(`cards[0].${k}`), `${k} over ${max}`);
      assert.ok(paths(check(card({ [k]: 5 }))).includes(`cards[0].${k}`), `${k} as a number`);
    }
    assert.ok(paths(check(mini({ cards: [{ id: 'a', title: 'T' }] }))).includes('cards[0].why'));
    assert.ok(paths(check(mini({ cards: [{ id: 'a', why: 'W' }] }))).includes('cards[0].title'));
    assert.ok(paths(check(card({ link: 'x' }))).includes('cards[0].link'));
    assert.ok(paths(check(mini({ cards: [null] }))).includes('cards[0]'));
  });

  it('stat and recommend', () => {
    const card = (over) => mini({ cards: [{ id: 'a', title: 'T', why: 'W', ...over }] });
    assert.equal(check(card({ stat: { value: '8/12', label: 'walks' } })).ok, true);
    assert.equal(check(card({ stat: { value: '8/12' } })).ok, true);
    assert.ok(paths(check(card({ stat: '8' }))).includes('cards[0].stat'));
    assert.ok(paths(check(card({ stat: { label: 'walks' } }))).includes('cards[0].stat.value'));
    assert.ok(paths(check(card({ stat: { value: 'x'.repeat(13) } }))).includes('cards[0].stat.value'));
    assert.ok(paths(check(card({ stat: { value: '1', label: 'x'.repeat(31) } }))).includes('cards[0].stat.label'));
    assert.equal(check(card({ recommend: 'later' })).ok, true);
    assert.ok(paths(check(card({ recommend: 'maybe' }))).includes('cards[0].recommend'));
    const custom = mini({ choices: [{ id: 'y', label: 'Yes' }, { id: 'n', label: 'No' }], cards: [{ id: 'a', title: 'T', why: 'W', recommend: 'fix' }] });
    assert.ok(paths(check(custom)).includes('cards[0].recommend'), 'recommend is held to the deck\'s own choices');
  });

  it('images: data: URIs of png/jpeg/webp only, real bytes, at most 400 KB', () => {
    const card = (image) => mini({ cards: [{ id: 'a', title: 'T', why: 'W', image }] });
    assert.equal(check(card(png())).ok, true);
    assert.equal(check(card(null)).ok, true);
    assert.ok(paths(check(card('https://example.com/a.png'))).includes('cards[0].image'));
    assert.ok(paths(check(card('data:image/svg+xml;base64,PHN2Zz4='))).includes('cards[0].image'));
    assert.ok(paths(check(card('data:image/gif;base64,R0lGODlh'))).includes('cards[0].image'));
    assert.ok(paths(check(card(png().replace('image/png', 'image/jpeg')))).includes('cards[0].image'), 'the bytes must match the type');
    const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString('base64')}`;
    assert.equal(check(card(jpeg)).ok, true);
    const webp = `data:image/webp;base64,${Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]).toString('base64')}`;
    assert.equal(check(card(webp)).ok, true);
    const big = png(700, 600, true);
    const r = check(card(big));
    assert.ok(r.problems.some((p) => p.path === 'cards[0].image' && /over 400 KB/.test(p.message)));
  });

  it('story: up to 6 panels with a heading', () => {
    assert.equal(check(mini({ story: [{ heading: 'H', body: 'B', stat: { value: '9' }, image: png() }] })).ok, true);
    assert.ok(paths(check(mini({ story: Array(7).fill({ heading: 'H' }) }))).includes('story'));
    assert.ok(paths(check(mini({ story: [{ body: 'B' }] }))).includes('story[0].heading'));
    assert.ok(paths(check(mini({ story: [{ heading: 'H', body: 'x'.repeat(401) }] }))).includes('story[0].body'));
    assert.ok(paths(check(mini({ story: [{ heading: 'H', image: 'http://x/y.png' }] }))).includes('story[0].image'));
    assert.ok(paths(check(mini({ story: {} }))).includes('story'));
  });

  it('the whole page stays under 12 MB', () => {
    const img = png(560, 560, true); // just under 400 KB
    assert.equal(check(mini({ cards: [{ id: 'a', title: 'T', why: 'W', image: img }] })).ok, true);
    const cards = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, title: 'T', why: 'W', image: img }));
    const r = check(mini({ cards }));
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /over 12 MB/.test(p.message)));
  });
});

describe('decision-deck — emit', () => {
  const page = emit(sample());

  it('is self-contained: no http(s) URLs, no external src or href, no stylesheet links', () => {
    assert.doesNotMatch(page, /https?:\/\//i);
    const markup = page.replace(/<script\b[^>]*>[^]*?<\/script>/gi, '');
    assert.doesNotMatch(markup, /\b(src|href)\s*=\s*["']?(?!data:|#)[^"'\s>]/i);
    assert.doesNotMatch(markup, /<(img|script|iframe|link|object|embed|video|audio|source)\b[^>]*\b(src|href)=/i);
    // the script sets src only from a card's or panel's image, which check holds to data: URIs
    assert.deepEqual(page.match(/\.src = [^;]+;/g), ['.src = s.image;', '.src = c.image;']);
    assert.doesNotMatch(page, /<link\b/i);
    assert.doesNotMatch(page, /@import|url\(/i);
    assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
  });

  it('follows the artifact page contract: title, both dark-mode selectors, body background, gutter, no orange', () => {
    const t = /<title>([^<]*)<\/title>/.exec(page)[1];
    const words = t.split(/\s+/);
    assert.ok(words.length >= 2 && words.length <= 4, t);
    assert.ok(page.indexOf('<title>') < 8192);
    assert.match(page, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\)/);
    assert.match(page, /:root\[data-theme="dark"\] \{/);
    assert.match(page, /color-scheme: dark/);
    assert.match(page, /body \{[^}]*background: var\(--bg\)/);
    assert.match(page, /padding-left: max\(16px, env\(safe-area-inset-left, 0px\)\)/);
    assert.match(page, /padding-right: max\(16px, env\(safe-area-inset-right, 0px\)\)/);
    assert.match(page, /<meta name="claude:viewport-fit-sides" content="cover">/);
    assert.match(page, /prefers-reduced-motion: reduce/);
    assert.doesNotMatch(page, /<!doctype|<html|<head|<body/i, 'the artifact host adds the skeleton');
    assert.doesNotMatch(page, /orange/i);
    // no hue in the orange band (20-45 degrees with real saturation) among the colours
    for (const hex of page.match(/#[0-9a-f]{6}\b/gi)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
      if (d < 0.15) continue;
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      assert.ok(h < 15 || h > 50, `${hex} reads as orange`);
    }
  });

  it('sets all dynamic text with textContent, never innerHTML', () => {
    assert.doesNotMatch(page, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.match(page, /textContent/);
  });

  it('only ever calls window.claude.use, and only for "db"', () => {
    const uses = page.match(/(window\.)?claude\.[a-zA-Z_]+/g);
    assert.deepEqual([...new Set(uses)].sort(), ['window.claude.use']);
    assert.match(page, /window\.claude\.use\('db'\)/);
    assert.match(page, /collection\(COLL\)\.get\(\)/);
    assert.match(page, /var COLL = 'decks\/' \+ SEG \+ '\/decisions';/);
    assert.match(page, /COLL \+ '\/' \+ card\.id/);
    assert.match(page, /var PROGRESS = 'decks\/' \+ SEG;/);
    assert.doesNotMatch(page, /'decks\/meta'|collection\('decisions'\)|'decisions\/'/, 'no unscoped paths are left');
  });

  it('embeds the cards safely: a </script> in a title cannot break out', () => {
    const deck = mini({ title: 'Evil </script><script>alert(1)</script>', cards: [{ id: 'a', title: '</script><img src=x onerror=alert(1)>', why: '<!-- x' }] });
    const html = emit(deck);
    assert.equal((html.match(/<\/script>/gi) || []).length, 2, 'only the two real closing tags');
    const json = /<script type="application\/json" id="deck-data">([^]*?)<\/script>/.exec(html)[1];
    assert.doesNotMatch(json, /</);
    assert.equal(JSON.parse(json).cards[0].title, '</script><img src=x onerror=alert(1)>');
    assert.doesNotMatch(/<title>([^]*?)<\/title>/.exec(html)[1], /</);
    assert.equal(JSON.parse(embedJson(mini({ title: 'a\u2028b' }))).title, 'a\u2028b');
    assert.doesNotMatch(embedJson(mini({ title: 'a\u2028b' })), /\u2028/);
  });

  it('fills in the default choices and the page script parses', () => {
    const html = emit(mini());
    const json = JSON.parse(/id="deck-data">([^]*?)<\/script>/.exec(html)[1]);
    assert.deepEqual(json.choices.map((c) => c.id), ['fix', 'later', 'no']);
    const script = /<script>\n([^]*?)<\/script>/.exec(html)[1];
    assert.doesNotThrow(() => new Function(script));
  });

  it('refuses a deck that is not ok; --standalone adds its own skeleton', () => {
    assert.throws(() => emit(mini({ title: '' })), (e) => e instanceof KitExit && e.code === 1 && /title/.test(e.message));
    const s = emit(sample(), { standalone: true });
    assert.match(s, /^<!doctype html>\n<html lang="en">/);
    assert.match(s, /<meta charset="utf-8">/);
    assert.match(s, /viewport-fit=cover/);
  });

  it('pageTitle gives two to four words', () => {
    assert.equal(pageTitle('Round 1: what the testers found'), 'Round 1 decisions');
    assert.equal(pageTitle('Launch'), 'Launch decisions');
    assert.equal(pageTitle('What we heard from five cafe owners'), 'What we heard from');
    assert.equal(pageTitle('!!!'), 'Decision deck');
  });
});

describe('decision-deck — page logic (pure functions embedded in the page)', () => {
  const three = ['fix', 'later', 'no'];
  it('swipeIntent: right = first, left = last, up = middle of three, threshold commits', () => {
    assert.deepEqual(swipeIntent(10, 0, 360, 600, three), { choice: null, commit: false });
    assert.deepEqual(swipeIntent(60, 5, 360, 600, three), { choice: 'fix', commit: false });
    assert.deepEqual(swipeIntent(110, 5, 360, 600, three), { choice: 'fix', commit: true });
    assert.deepEqual(swipeIntent(-110, 5, 360, 600, three), { choice: 'no', commit: true });
    assert.deepEqual(swipeIntent(-90, 5, 360, 600, three), { choice: 'no', commit: false });
    assert.deepEqual(swipeIntent(5, -60, 360, 600, three), { choice: 'later', commit: false });
    assert.deepEqual(swipeIntent(5, -120, 360, 600, three), { choice: 'later', commit: true });
    assert.deepEqual(swipeIntent(5, 200, 360, 600, three), { choice: null, commit: false }, 'down means nothing');
    assert.deepEqual(swipeIntent(5, -200, 360, 600, ['y', 'n']), { choice: null, commit: false }, 'no up with two choices');
    assert.deepEqual(swipeIntent(200, 0, 360, 600, ['a', 'b', 'c', 'd']), { choice: 'a', commit: true });
    assert.deepEqual(swipeIntent(-200, 0, 360, 600, ['a', 'b', 'c', 'd']), { choice: 'd', commit: true });
    assert.equal(swipeIntent(85, 0, 200, 600, three).commit, true, 'the threshold is at least 80 px');
  });

  it('exportText: one line per card, id | choice | note', () => {
    const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const text = exportText(cards, { a: { choice: 'fix', note: 'soon\nplease' }, c: { choice: 'no', note: '' } });
    assert.equal(text, 'a | fix | soon please\nb | undecided | \nc | no | ');
  });

  it('mergeResume: cloud wins, null clears, unknown ids and choices are dropped', () => {
    const local = { a: { choice: 'fix', note: 'L', at: 1 }, b: { choice: 'no', note: '', at: 1 }, z: { choice: 'fix' }, c: { choice: 'maybe' } };
    const rows = [{ id: 'a', choice: 'later', note: 'C', at: 2 }, { id: 'b', choice: null }, { id: 'q', choice: 'fix' }];
    assert.deepEqual(mergeResume(local, rows, ['a', 'b', 'c'], three), bare({ a: { choice: 'later', note: 'C', at: 2 } }));
    assert.deepEqual(mergeResume(null, [], ['a'], three), bare({}));
    assert.deepEqual(mergeResume({ a: { choice: 'fix', note: 'x', at: 3 } }, [], ['a'], three), bare({ a: { choice: 'fix', note: 'x', at: 3 } }));
  });

  it('mergeResume: the newer of local and cloud wins by `at`; a cloud tie or a row without `at` goes to the cloud', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const local = { a: { choice: 'fix', note: 'L', at: 50 }, b: { choice: 'fix', note: 'L', at: 50 }, c: { choice: 'fix', note: 'L', at: 50 }, d: { choice: 'fix', note: 'L', at: 50 } };
    const rows = [
      { id: 'a', choice: 'no', note: 'C', at: 10 },
      { id: 'b', choice: 'no', note: 'C', at: 50 },
      { id: 'c', choice: null, note: '', at: 10 },
      { id: 'd', choice: 'no', note: 'C' },
    ];
    assert.deepEqual(mergeResume(local, rows, ids, three), bare({
      a: { choice: 'fix', note: 'L', at: 50 },
      b: { choice: 'no', note: 'C', at: 50 },
      c: { choice: 'fix', note: 'L', at: 50 },
      d: { choice: 'no', note: 'C', at: 0 },
    }));
    assert.deepEqual(mergeResume({ a: { choice: 'fix', note: '', at: 5 } }, [{ id: 'a', choice: null, at: 9 }], ['a'], three), bare({}), 'a newer clear still clears');
  });

  it('deckKey and nextOpen', () => {
    assert.equal(deckKey('T', ['a', 'b']), deckKey('T', ['a', 'b']));
    assert.notEqual(deckKey('T', ['a', 'b']), deckKey('T', ['a', 'c']));
    assert.match(deckKey('T', ['a']), /^decision-deck:[0-9a-f]{8}$/);
    const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.equal(nextOpen(cards, { a: {} }, 0), 1);
    assert.equal(nextOpen(cards, { a: {}, b: {}, c: {} }, 0), -1);
    assert.equal(nextOpen(cards, {}, 2), 2);
  });

  it('a card id that is a prototype name ("constructor") is never taken as decided', () => {
    const cards = [{ id: 'constructor' }, { id: 'b' }];
    assert.equal(nextOpen(cards, {}, 0), 0, 'a plain {} has an inherited constructor, but no pick');
    assert.equal(exportText(cards, {}), 'constructor | undecided | \nb | undecided | ');
    const none = mergeResume(null, [], ['constructor', 'b'], three);
    assert.equal(Object.getPrototypeOf(none), null);
    assert.equal(none.constructor, undefined);
    assert.equal(nextOpen(cards, none, 0), 0);
    const local = JSON.parse('{"constructor": {"choice": "fix", "note": "n", "at": 2}}');
    assert.deepEqual(mergeResume(local, [], ['constructor'], three), bare({ constructor: { choice: 'fix', note: 'n', at: 2 } }));
    assert.deepEqual(mergeResume(null, [{ id: 'constructor', choice: 'no', note: '', at: 3 }], ['constructor'], three), bare({ constructor: { choice: 'no', note: '', at: 3 } }));
    assert.deepEqual(mergeResume(null, [{ id: 'toString', choice: 'no' }, { id: '__proto__', choice: 'no' }], ['constructor'], three), bare({}));
  });

  it('mergeResume: a row whose title is not the card\'s title belongs to another deck and is ignored', () => {
    const rows = [{ id: 'a', choice: 'no', note: '', at: 9, title: 'Something else' }, { id: 'b', choice: 'fix', note: '', at: 9, title: 'B' }, { id: 'c', choice: 'fix', note: '', at: 9 }];
    assert.deepEqual(mergeResume(null, rows, ['a', 'b', 'c'], three, ['A', 'B', 'C']), bare({ b: { choice: 'fix', note: '', at: 9 }, c: { choice: 'fix', note: '', at: 9 } }));
  });

  it('deckKey and deckPaths: one key per deck JSON, a different key when a card\'s title changes, legal path segments', () => {
    assert.notEqual(deckKey('T', ['a'], ['Do A']), deckKey('T', ['a'], ['Do B']));
    assert.equal(deckKey('T', ['a'], ['Do A']), deckKey('T', ['a'], ['Do A']));
    const p = deckPaths(sample());
    assert.deepEqual(p, deckPaths(sample()));
    assert.match(p.collection, /^decks\/[0-9a-f]{8}\/decisions$/);
    assert.equal(p.progress, p.collection.replace(/\/decisions$/, ''));
    assert.equal(p.key, `decision-deck:${p.progress.slice('decks/'.length)}`);
    for (const seg of p.collection.split('/')) assert.match(seg, /^[A-Za-z0-9_\-.~:@+]+$/);
    const s2 = sample(); s2.cards[0].title = 'A different finding with the same id';
    assert.notEqual(deckPaths(s2).collection, p.collection, 'a new deck with the same title and card ids gets its own collection');
    const s3 = sample(); s3.cards[0].why = 'Reworded evidence.';
    assert.equal(deckPaths(s3).collection, p.collection, 'rewording the evidence keeps the picks');
  });
});

describe('decision-deck — read', () => {
  const deck = sample();
  it('reads the copied text', () => {
    const r = read(deck, 'f1 | fix | ask Sam | today\nf2 | undecided | \nf3 | later |\n\nf5 | no | ');
    assert.deepEqual(r.decided, [
      { id: 'f1', title: deck.cards[0].title, choice: 'fix', note: 'ask Sam | today' },
      { id: 'f3', title: deck.cards[2].title, choice: 'later', note: '' },
      { id: 'f5', title: deck.cards[4].title, choice: 'no', note: '' },
    ]);
    assert.deepEqual(r.undecided, ['f2', 'f4', 'f6']);
    assert.deepEqual(r.byChoice, { fix: ['f1'], later: ['f3'], no: ['f5'] });
    assert.deepEqual(r.problems, []);
  });

  it('reads database rows (flat, nested under data, or by path) and skips the progress document', () => {
    const { collection, progress } = deckPaths(deck);
    const rows = [
      { id: 'f1', choice: 'fix', note: 'n', at: 1 },
      { path: `${collection}/f2`, data: { choice: 'no', note: '', at: 2, title: deck.cards[1].title } },
      { id: 'f3', data: { choice: null, note: '' } },
      { path: progress, data: { title: 'x', cards: 6, decided: 2 } },
    ];
    const r = read(deck, JSON.stringify(rows));
    assert.deepEqual(r.decided.map((d) => [d.id, d.choice]), [['f1', 'fix'], ['f2', 'no']]);
    assert.deepEqual(r.undecided, ['f3', 'f4', 'f5', 'f6']);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(read(deck, { documents: rows }).decided.length, 2);
  });

  it('rows of another deck (its collection, an old bare decisions/<id> path, or another title) are problems, not picks', () => {
    const { collection } = deckPaths(deck);
    const other = deckPaths({ ...deck, title: 'Round 0' }).collection;
    const rows = [
      { path: 'decisions/f1', data: { choice: 'no', note: 'old page', at: 1, title: deck.cards[0].title } },
      { path: `${other}/f2`, data: { choice: 'no', note: '', at: 1, title: deck.cards[1].title } },
      { path: `${collection}/f3`, data: { choice: 'no', note: '', at: 1, title: 'A finding from last round' } },
      { id: 'f4', choice: 'later', note: '', at: 1, title: 'Another old title' },
      { path: `${collection}/f5`, data: { choice: 'fix', note: '', at: 1, title: deck.cards[4].title } },
      { id: 'f6', choice: 'later', note: 'as given', at: 1 },
    ];
    const r = read(deck, JSON.stringify(rows));
    assert.deepEqual(r.decided.map((d) => [d.id, d.choice]), [['f5', 'fix'], ['f6', 'later']]);
    assert.deepEqual(r.undecided, ['f1', 'f2', 'f3', 'f4']);
    assert.equal(r.collection, collection);
    assert.deepEqual(r.problems.map((p) => p.path), ['[0]', '[1]', '[2]', '[3]']);
    assert.match(r.problems[0].message, /"decisions\/f1" belongs to another deck/);
    assert.match(r.problems[1].message, /belongs to another deck/);
    assert.ok(r.problems[1].message.includes(collection), 'the message names this deck\'s collection');
    assert.match(r.problems[2].message, /card "f3": the row's title "A finding from last round" is not this card's title/);
    assert.match(r.problems[3].message, /card "f4": the row's title/);
  });

  it('a card id "constructor" is read like any other', () => {
    const d = mini({ cards: [{ id: 'constructor', title: 'Build it', why: 'W' }, { id: 'b', title: 'B', why: 'W' }] });
    assert.deepEqual(read(d, 'b | fix |').undecided, ['constructor']);
    assert.deepEqual(read(d, JSON.stringify([{ id: 'constructor', choice: 'no', note: '', at: 1 }])).byChoice, { fix: [], later: [], no: ['constructor'] });
  });

  it('lists unknown ids, unknown choices and repeats under problems, never silently', () => {
    const r = read(deck, 'f1 | fix |\nf9 | fix |\nf2 | maybe |\nf1 | no | changed');
    assert.equal(r.problems.length, 3);
    assert.match(r.problems[0].message, /unknown card id "f9"/);
    assert.match(r.problems[1].message, /unknown choice "maybe"/);
    assert.match(r.problems[2].message, /more than once/);
    assert.deepEqual(r.decided.map((d) => [d.id, d.choice, d.note]), [['f1', 'no', 'changed']]);
    assert.ok(r.undecided.includes('f2'));
    assert.match(read(deck, '[1]').problems[0].message, /must be an object/);
  });

  it('read: a hostile note comes back as clean data of at most 500 characters, with a problem listed', () => {
    const deck = sample();
    const hostile = `ok\u001b[31m\u0000${'x'.repeat(200000)}\u202eend\n\tmore`;
    const forms = [
      read(deck, JSON.stringify([{ id: 'f1', choice: 'fix', note: hostile, at: 1 }])),
      read(deck, JSON.stringify([{ path: `${deckPaths(deck).collection}/f1`, data: { choice: 'fix', note: hostile } }])),
      read(deck, `f1 | fix | ${hostile.replace(/\n/g, ' ')}`),
    ];
    for (const r of forms) {
      const n = r.decided[0].note;
      assert.ok([...n].length <= 500);
      assert.ok(n.startsWith('ok'));
      assert.doesNotMatch(n, /[\p{Cc}\p{Cf}]/u);
      assert.ok(r.problems.some((p) => /note/.test(p.message)));
    }
    assert.equal(read(deck, JSON.stringify([{ id: 'f1', choice: 'fix', note: 'a\tb\nc' }])).decided[0].note, 'a b c');
    const clean = read(deck, JSON.stringify([{ id: 'f1', choice: 'fix', note: 'fine' }]));
    assert.equal(clean.decided[0].note, 'fine');
    assert.deepEqual(clean.problems, []);
  });

  it('read: hostile ids, titles, paths and choices are clipped in problem messages', () => {
    const deck = sample();
    const long = `${'A'.repeat(5000)}\u001b\u202e`;
    const r = read(deck, JSON.stringify([
      { id: long, choice: long },
      { id: 'f1', choice: long },
      { id: 'f2', choice: 'fix', title: long },
      { path: `${long}/f3`, choice: 'fix' },
    ]));
    assert.ok(r.problems.length >= 4);
    for (const p of r.problems) {
      assert.ok(p.message.length < 600, p.message.length);
      assert.doesNotMatch(p.message, /[\p{Cc}\p{Cf}]/u);
    }
  });

  it('read: a field inside data never overrides the listing\'s own id or path', () => {
    const deck = sample();
    const col = deckPaths(deck).collection;
    const r = read(deck, JSON.stringify([{ path: `${col}/f2`, data: { id: 'f1', choice: 'no' } }]));
    assert.deepEqual(r.byChoice.no, ['f2']);
    assert.ok(r.undecided.includes('f1'));
    const other = read(deck, JSON.stringify([{ path: 'decks/deadbeef/decisions/f1', data: { path: `${col}/f1`, choice: 'fix' } }]));
    assert.equal(other.decided.length, 0);
    assert.ok(other.problems.some((p) => /another deck/.test(p.message)));
    assert.deepEqual(read(deck, JSON.stringify([{ id: 'f1', doc_id: 'f3', data: { id: 'f2', choice: 'fix' } }])).byChoice.fix, ['f1']);
  });

  it('refuses unusable decisions', () => {
    assert.throws(() => parseDecisions('[1,'), (e) => e instanceof KitExit && e.code === 1);
    assert.throws(() => parseDecisions({ x: 1 }), (e) => e instanceof KitExit && e.code === 1);
  });
});

describe('decision-deck — run', () => {
  it('check prints {ok, problems} and exits 0 either way; unreadable input is exit 1', async () => {
    const dir = tmp();
    try {
      const good = await run(['check', '--file', FIXTURE], io('', dir));
      assert.equal(good.ok, true);
      assert.equal(good.collection, deckPaths(sample()).collection, 'check tells the agent which collection to list');
      assert.equal(good.progress, deckPaths(sample()).progress);
      const bad = await run(['check'], io(JSON.stringify(mini({ title: '' })), dir));
      assert.equal(bad.ok, false);
      assert.equal(bad.exit, undefined);
      await exit1(() => run(['check'], io('', dir)));
      await exit1(() => run(['check'], io('{nope', dir)));
      await exit1(() => run(['check'], io('[1]', dir)));
      await exit1(() => run(['check', '--file', path.join(dir, 'missing.json')], io('', dir)));
      await exit1(() => run(['check', '--file', dir], io('', dir)));
      await exit1(() => run(['check', '--file', FIXTURE, '--file', FIXTURE], io('', dir)));
      await exit1(() => run(['check', '--bogus'], io('', dir)));
      await exit1(() => run(['nope'], io('', dir)));
      await exit1(() => run(['check'], { cwd: dir, stdinIsTTY: true }));
      assert.ok((await run([], io('', dir))).usage);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('emit writes the page; a deck that is not ok, a missing --out or --out = --file is exit 1', async () => {
    const dir = tmp();
    try {
      const r = await run(['emit', '--file', FIXTURE, '--out', 'deck.html'], io('', dir));
      assert.equal(r.cards, 6);
      assert.equal(r.title, 'Round 1 decisions');
      assert.equal(r.collection, deckPaths(sample()).collection, 'emit prints the collection the page writes to');
      assert.equal(fs.readFileSync(path.join(dir, 'deck.html'), 'utf-8'), emit(sample()));
      const s = await run(['emit', '--out', 's.html', '--standalone'], io(fs.readFileSync(FIXTURE), dir));
      assert.equal(s.bytes, Buffer.byteLength(fs.readFileSync(path.join(dir, 's.html'))));
      await exit1(() => run(['emit', '--file', FIXTURE], io('', dir)));
      await exit1(() => run(['emit', '--out', 'x.html'], io(JSON.stringify(mini({ cards: [] })), dir)));
      fs.copyFileSync(FIXTURE, path.join(dir, 'd.json'));
      await exit1(() => run(['emit', '--file', 'd.json', '--out', 'd.json'], io('', dir)));
      assert.equal(fs.readFileSync(path.join(dir, 'd.json'), 'utf-8'), fs.readFileSync(FIXTURE, 'utf-8'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('read needs --deck and takes the decisions on stdin or --file', async () => {
    const dir = tmp();
    try {
      fs.writeFileSync(path.join(dir, 'picks.txt'), 'f1 | fix | ok\n');
      const a = await run(['read', '--file', 'picks.txt', '--deck', FIXTURE], io('', dir));
      assert.deepEqual(a.byChoice.fix, ['f1']);
      assert.equal(a.collection, deckPaths(sample()).collection);
      const b = await run(['read', '--deck', FIXTURE], io('f2 | no | ', dir));
      assert.deepEqual(b.byChoice.no, ['f2']);
      await exit1(() => run(['read', '--file', 'picks.txt'], io('', dir)));
      await exit1(() => run(['read', '--deck', 'missing.json'], io('f1 | fix |', dir)));
      fs.writeFileSync(path.join(dir, 'bad.json'), '{"cards": 3}');
      await exit1(() => run(['read', '--deck', 'bad.json'], io('f1 | fix |', dir)));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
