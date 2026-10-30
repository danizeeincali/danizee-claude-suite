import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { run, verb, decide, checkSentence, buildPrompt, colorWord } from '../src/lib/kit/visual-direction.js';

const io = (stdin, cwd) => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
const exit = async p => assert.rejects(Promise.resolve().then(p), e => e instanceof KitExit && e.code === 1);
const call = (cmd, obj, extra = []) => run([cmd, ...extra], io(typeof obj === 'string' ? obj : JSON.stringify(obj)));
const GOOD = 'A potter shapes a clay bowl at a wooden bench in low morning sun.';
const P = { sentence: GOOD, style: 'photo', palette: ['#1A2B3C', '#f5eedc'], aspect: '16:9' };

describe('decide', () => {
  const base = { screen: 'landing', has_product_ui: false, works_without_visual: true };
  it('verb name', () => assert.equal(verb, 'visual-direction'));
  it('landing hero without product UI gets a scene from the world', () => {
    const r = decide({ ...base, direction: { world: 'pottery studio', character: 'warm' } });
    assert.deepEqual([r.needed, r.kind, r.slot], [true, 'scene', 'hero']);
    assert.match(r.next, /pottery studio/);
    assert.deepEqual(r.direction, { world: 'pottery studio', character: 'warm' });
  });
  it('asks for a world when none is given', () => assert.match(decide(base).next, /direction\.world/));
  it('a product with a UI gets a product shot', () => assert.equal(decide({ ...base, has_product_ui: true }).kind, 'product-shot'));
  it('a section slot without UI gets one object', () => assert.equal(decide({ ...base, slot: 'section' }).kind, 'object'));
  it('empty state without UI gets an object, with UI a product shot', () => {
    assert.equal(decide({ ...base, screen: 'empty-state' }).kind, 'object');
    assert.equal(decide({ ...base, screen: 'empty-state', has_product_ui: true }).kind, 'product-shot');
  });
  it('dashboards and apps get none unless empty-state slot', () => {
    for (const screen of ['dashboard', 'app']) {
      const r = decide({ ...base, screen, has_product_ui: true });
      assert.deepEqual([r.needed, r.kind], [false, 'none']);
      assert.equal(decide({ ...base, screen, slot: 'empty-state' }).needed, true);
    }
  });
  it('a screen that does not work without the visual gets none, make it work first', () => {
    const r = decide({ ...base, works_without_visual: false, has_product_ui: true });
    assert.deepEqual([r.needed, r.kind], [false, 'none']);
    assert.match(r.next, /work first/);
  });
  it('rejects invalid fields', async () => {
    await exit(() => call('decide', { ...base, screen: 'poster' }));
    await exit(() => call('decide', { ...base, has_product_ui: 'yes' }));
    await exit(() => call('decide', { screen: 'landing', has_product_ui: true }));
    await exit(() => call('decide', { ...base, slot: 'footer' }));
    await exit(() => call('decide', { ...base, direction: 'x' }));
    await exit(() => call('decide', { ...base, direction: { world: '' } }));
  });
  it('run decide via stdin', async () => assert.equal((await call('decide', base)).kind, 'scene'));
});

describe('sentence', () => {
  it('accepts a good sentence', () => {
    const r = checkSentence(GOOD);
    assert.equal(r.ok, true);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.hints, []);
    assert.equal(r.words, 14);
  });
  it('flags banned words, including glow and 3D blob', () => {
    for (const s of ['A stunning futuristic city of neon towers at night.', 'A glowing orb floats above a desk.', 'A 3D blob floats in a room.', 'A sleek kettle on a shelf in 8k.', 'A gradient wash behind a teapot.'])
      assert.ok(checkSentence(s).problems.some(p => p.id === 'banned-words'), s);
  });
  it('flags more than one sentence and over 30 words', () => {
    assert.ok(checkSentence('A kettle on a stove. A cat sits nearby.').problems.some(p => p.id === 'not-one-sentence'));
    const long = 'A potter ' + 'carefully '.repeat(30) + 'shapes a bowl.';
    assert.ok(checkSentence(long).problems.some(p => p.id === 'too-long'));
    assert.ok(!checkSentence('A kettle on a stove at 3.5 litres in morning sun.').problems.some(p => p.id === 'not-one-sentence'));
  });
  it('flags a missing concrete subject and empty text', () => {
    assert.ok(checkSentence('A feeling of innovation and the future.').problems.some(p => p.id === 'no-concrete-subject'));
    assert.ok(checkSentence('   ').problems.some(p => p.id === 'empty'));
  });
  it('hints at setting and light', () => {
    const h = checkSentence('A brass kettle').hints;
    assert.equal(h.length, 2);
  });
  it('run: advisory exit 0 with problems, exit 1 for a missing sentence', async () => {
    assert.equal((await call('sentence', { sentence: 'neon' })).ok, false);
    await exit(() => call('sentence', {}));
    await exit(() => call('sentence', { sentence: 5 }));
  });
});

describe('prompt', () => {
  it('builds every fixed part', () => {
    const r = buildPrompt(P);
    assert.deepEqual(r.size, { w: 1600, h: 900 });
    assert.equal(r.aspect, '16:9');
    for (const part of [GOOD.replace(/\.$/, ''), 'natural photograph', 'charcoal #1a2b3c', 'cream #f5eedc', 'light:', 'composition:', 'negative space on the left', 'subject placed on the right', 'aspect ratio 16:9'])
      assert.ok(r.prompt.includes(part), part);
    for (const n of ['text', 'logos', 'watermarks', 'glows', 'gradients', 'extra fingers']) assert.ok(r.negative.includes(n), n);
  });
  it('headline on the right flips the composition and placement', () => {
    const r = buildPrompt({ ...P, headline_side: 'right', light: 'lamp light', avoid: ['Text', 'people'], radius_px: 24 });
    assert.match(r.prompt, /subject placed on the left/);
    assert.match(r.prompt, /light: lamp light/);
    assert.equal(r.placement.object_position, 'left center');
    assert.equal(r.placement.radius_px, 24);
    assert.equal(r.negative.filter(n => n.toLowerCase() === 'text').length, 1);
    assert.ok(r.negative.includes('people'));
  });
  it('sizes per aspect and from display_width', () => {
    assert.deepEqual(buildPrompt({ ...P, aspect: '4:3' }).size, { w: 1600, h: 1200 });
    assert.deepEqual(buildPrompt({ ...P, aspect: '1:1' }).size, { w: 1200, h: 1200 });
    assert.deepEqual(buildPrompt({ ...P, aspect: '3:4' }).size, { w: 1200, h: 1600 });
    const r = buildPrompt({ ...P, display_width: 600 });
    assert.deepEqual(r.size, { w: 1200, h: 675 });
    assert.deepEqual(r.placement.display, { w: 600, h: 338 });
  });
  it('placement: cover, alt from the sentence, edge fade', () => {
    const p = buildPrompt(P).placement;
    assert.equal(p.object_fit, 'cover');
    assert.equal(p.radius_px, 12);
    assert.equal(p.alt, GOOD.replace(/\.$/, ''));
    assert.match(p.edge_fade, /page background color/);
  });
  it('color words', () => {
    assert.equal(colorWord('#000'), 'black');
    assert.equal(colorWord('#FFFFFF'), 'white');
  });
  it('rejects bad fields and a failing sentence', async () => {
    for (const bad of [
      { ...P, style: 'oil' }, { ...P, aspect: '2:1' }, { ...P, palette: [] }, { ...P, palette: ['red'] }, { ...P, palette: Array(7).fill('#fff') },
      { ...P, avoid: 'text' }, { ...P, avoid: [''] }, { ...P, headline_side: 'top' }, { ...P, radius_px: -1 }, { ...P, display_width: 50 },
      { ...P, display_width: 1.5 }, { ...P, light: '' }, { ...P, sentence: 'A neon glowing orb.' }, { ...P, sentence: 7 }, { style: 'photo' },
    ]) await exit(() => call('prompt', bad));
  });
});

describe('input handling', () => {
  it('reads --file relative to cwd and agrees with stdin', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-'));
    try {
      await fs.writeFile(path.join(dir, 'c.json'), JSON.stringify(P));
      const viaFile = await run(['prompt', '--file', 'c.json'], io('', dir));
      assert.deepEqual(viaFile, await call('prompt', P));
      await exit(() => run(['prompt', '--file', 'nope.json'], io('', dir)));
      await exit(() => run(['prompt', '--file', '.'], io('', dir)));
      await exit(() => run(['prompt', '--file', '/dev/null'], io('', dir)));
      await fs.writeFile(path.join(dir, 'b.json'), Buffer.from([123, 0, 125]));
      await exit(() => run(['prompt', '--file', 'b.json'], io('', dir)));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('rejects empty, binary, oversize, invalid, non-object input', async () => {
    await exit(() => call('decide', ''));
    await exit(() => call('decide', '   \n'));
    await exit(() => call('decide', '{"a":\0}'));
    await exit(() => call('decide', 'x'.repeat(8 * 1024 * 1024 + 2)));
    await exit(() => call('decide', '{not json'));
    await exit(() => call('decide', '[]'));
    await exit(() => call('decide', 'null'));
  });
  it('rejects unknown subcommand, unknown and duplicate flags', async () => {
    await exit(() => run([], io('{}')));
    await exit(() => run(['nope'], io('{}')));
    await exit(() => run(['decide', '--bogus'], io('{}')));
    await exit(() => run(['decide', '--file'], io('{}')));
    await exit(() => run(['decide', '--file', 'a', '--file', 'b'], io('{}')));
    await exit(() => run(['decide', '--file', ''], io('{}')));
  });
  it('accepts a BOM', async () => assert.equal((await call('sentence', '﻿' + JSON.stringify({ sentence: GOOD }))).ok, true));
});
