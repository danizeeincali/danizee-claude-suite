import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPackaged } from './helpers/packaged.js';
import { deckPaths } from '../src/lib/kit/decision-deck.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'decision-deck', 'sample.json');

describe('decision-deck — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('checks, emits, reads back, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('decision-deck'));
    fs.copyFileSync(FIXTURE, path.join(pkg.dir, 'deck.json'));
    const deckText = fs.readFileSync(FIXTURE, 'utf-8');

    const c = pkg.kit(['decision-deck', 'check', '--file', 'deck.json']);
    assert.equal(c.code, 0, c.err);
    const { collection, progress } = deckPaths(JSON.parse(deckText));
    assert.match(collection, /^decks\/[0-9a-f]{8}\/decisions$/);
    assert.deepEqual(c.json, { ok: true, cards: 6, problems: [], collection, progress });
    assert.deepEqual(pkg.kit(['decision-deck', 'check'], deckText).json, c.json);

    const bad = pkg.kit(['decision-deck', 'check'], JSON.stringify({ ...JSON.parse(deckText), title: '' }));
    assert.equal(bad.code, 0);
    assert.equal(bad.json.ok, false);
    assert.equal(bad.json.problems[0].path, 'title');

    const e = pkg.kit(['decision-deck', 'emit', '--file', 'deck.json', '--out', 'deck.html']);
    assert.equal(e.code, 0, e.err);
    assert.equal(e.json.cards, 6);
    assert.equal(e.json.collection, collection);
    const html = fs.readFileSync(path.join(pkg.dir, 'deck.html'), 'utf-8');
    assert.doesNotMatch(html, /https?:\/\//);
    assert.match(html, /<title>Round 1 decisions<\/title>/);
    assert.equal(pkg.kit(['decision-deck', 'emit', '--out', 'x.html'], JSON.stringify({ ...JSON.parse(deckText), title: '' })).code, 1);
    assert.equal(fs.existsSync(path.join(pkg.dir, 'x.html')), false);

    const r = pkg.kit(['decision-deck', 'read', '--deck', 'deck.json'], 'f1 | fix | today\nf4 | no | \nf9 | fix |');
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.byChoice, { fix: ['f1'], later: [], no: ['f4'] });
    assert.equal(r.json.undecided.length, 4);
    assert.equal(r.json.problems.length, 1);
    const rows = pkg.kit(['decision-deck', 'read', '--deck', 'deck.json'], JSON.stringify([{ id: 'f2', choice: 'later', note: 'after launch', at: 1 }]));
    assert.deepEqual(rows.json.decided, [{ id: 'f2', title: JSON.parse(deckText).cards[1].title, choice: 'later', note: 'after launch' }]);
    assert.equal(rows.json.collection, collection);
    const old = pkg.kit(['decision-deck', 'read', '--deck', 'deck.json'], JSON.stringify([{ path: 'decisions/f2', data: { choice: 'later', note: '', at: 1 } }]));
    assert.deepEqual(old.json.decided, []);
    assert.match(old.json.problems[0].message, /belongs to another deck/);

    assert.equal(pkg.kit(['decision-deck', 'check', '--file', 'missing.json']).code, 1);
    assert.equal(pkg.kit(['decision-deck', 'check'], '').code, 1);
    assert.equal(pkg.kit(['decision-deck', 'check'], '[1]').code, 1);
    assert.equal(pkg.kit(['decision-deck', 'emit', '--file', 'deck.json']).code, 1);
    assert.equal(pkg.kit(['decision-deck', 'read'], 'f1 | fix |').code, 1);
    assert.equal(pkg.kit(['decision-deck', 'nope']).code, 1);
    assert.equal(pkg.kit(['decision-deck', 'check'], 'é'.repeat(8.5 * 1024 * 1024)).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
