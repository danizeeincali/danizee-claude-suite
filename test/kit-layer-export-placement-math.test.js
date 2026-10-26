import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { plan, run, imageMatches, MAX_INPUT_BYTES, verb } from '../src/lib/kit/layer-place.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';

const frame = { x: 100, y: 50 };
const L = (o = {}) => ({ id: 'a', z: 0, bounds: { x: 110, y: 70, w: 40, h: 20 }, ...o });
const one = (layer, fr = frame) => plan({ frame: fr, layers: [layer] });
const exit1 = fn => assert.throws(fn, e => e instanceof KitExit && e.code === 1);
const exit1Async = p => assert.rejects(p, e => e instanceof KitExit && e.code === 1);

describe('layer-place decision table', () => {
  it('exports the verb name', () => assert.equal(verb, 'layer-place'));

  it('rule 1: arc, rotated and mask use absolute bounds, even when everything else would match', () => {
    for (const shape of ['arc', 'rotated', 'mask']) {
      const r = one(L({ shape, render_bounds: { x: 110, y: 70, w: 40, h: 20 }, image: { w: 40, h: 20, scale: 1 }, clipped_by_parent: true }));
      assert.equal(r.placements[0].rule, 'absolute-bounds');
      assert.deepEqual([r.placements[0].left, r.placements[0].top, r.placements[0].width, r.placements[0].height], [10, 20, 40, 20]);
      assert.deepEqual(r.warnings, []);
    }
  });

  it('rule 2: image matching render bounds places at render bounds', () => {
    const r = one(L({ render_bounds: { x: 106, y: 66, w: 48, h: 28 }, image: { w: 48, h: 28, scale: 1 } }));
    assert.equal(r.placements[0].rule, 'render-bounds');
    assert.deepEqual([r.placements[0].left, r.placements[0].top, r.placements[0].width, r.placements[0].height], [6, 16, 48, 28]);
  });

  it('rule 2 beats rule 3 (clipped and even effects) when the image matches', () => {
    const r = one(L({ render_bounds: { x: 106, y: 66, w: 48, h: 28 }, image: { w: 48, h: 28, scale: 1 }, clipped_by_parent: true, effects_even: true }));
    assert.equal(r.placements[0].rule, 'render-bounds');
  });

  it('image size is render bounds x scale, within 1px per side, not beyond', () => {
    const rb = { x: 0, y: 0, w: 48, h: 28 };
    assert.ok(imageMatches({ w: 96, h: 56, scale: 2 }, rb));
    assert.ok(imageMatches({ w: 97, h: 55, scale: 2 }, rb));
    assert.ok(!imageMatches({ w: 98, h: 56, scale: 2 }, rb));
    assert.ok(!imageMatches({ w: 96, h: 54, scale: 2 }, rb));
    assert.ok(!imageMatches({ w: 48, h: 28, scale: 2 }, rb), 'unscaled size does not match a 2x export');
    assert.ok(imageMatches({ w: 73, h: 42, scale: 1.5 }, rb));
    assert.ok(!imageMatches(undefined, rb));
    const r = one(L({ render_bounds: rb, image: { w: 97, h: 55, scale: 2 } }));
    assert.equal(r.placements[0].rule, 'render-bounds');
    assert.equal(r.placements[0].width, 48, 'size is in layout px, not image px');
    const miss = one(L({ render_bounds: rb, image: { w: 98, h: 56, scale: 2 } }));
    assert.equal(miss.placements[0].rule, 'bounds');
  });

  it('rule 3: clipped by parent offsets by the overhang (positive overhang)', () => {
    const r = one(L({ render_bounds: { x: 104, y: 64, w: 50, h: 32 }, clipped_by_parent: true }));
    const p = r.placements[0];
    assert.equal(p.rule, 'overhang-offset');
    assert.deepEqual(p.overhang, { left: 6, top: 6, right: 4, bottom: 6 });
    assert.deepEqual([p.left, p.top, p.width, p.height], [4, 14, 50, 32]);
  });

  it('rule 3: negative overhang (render bounds inside bounds) is computed exactly', () => {
    const r = one(L({ render_bounds: { x: 112, y: 73, w: 36, h: 15 }, clipped_by_parent: true }));
    const p = r.placements[0];
    assert.deepEqual(p.overhang, { left: -2, top: -3, right: -2, bottom: -2 });
    assert.deepEqual([p.left, p.top, p.width, p.height], [12, 23, 36, 15]);
  });

  it('rule 3: even effects with an even overhang', () => {
    const r = one(L({ render_bounds: { x: 100, y: 60, w: 60, h: 40 }, effects_even: true }));
    const p = r.placements[0];
    assert.equal(p.rule, 'overhang-offset');
    assert.deepEqual(p.overhang, { left: 10, top: 10, right: 10, bottom: 10 });
    assert.deepEqual([p.left, p.top, p.width, p.height], [0, 10, 60, 40]);
  });

  it('rule 3 needs render bounds; without them clipped falls through to the fallback', () => {
    const r = one(L({ clipped_by_parent: true }));
    assert.equal(r.placements[0].rule, 'bounds');
    assert.equal(r.warnings.length, 1);
  });

  it('effects_even with an uneven overhang does not take rule 3; stroke geometry takes it', () => {
    const rb = { x: 100, y: 70, w: 55, h: 20 };
    const sg = { x: 108, y: 68, w: 44, h: 24 };
    const r = one(L({ render_bounds: rb, effects_even: true, stroke_geometry: sg }));
    const p = r.placements[0];
    assert.equal(p.rule, 'stroke-geometry');
    assert.deepEqual([p.left, p.top, p.width, p.height], [8, 18, 44, 24]);
    assert.deepEqual(p.overhang, { left: 10, top: 0, right: 5, bottom: 0 });
  });

  it('rule 3 beats rule 4 when clipped_by_parent, even with an uneven overhang', () => {
    const r = one(L({ render_bounds: { x: 100, y: 70, w: 70, h: 20 }, clipped_by_parent: true, stroke_geometry: { x: 0, y: 0, w: 1, h: 1 } }));
    assert.equal(r.placements[0].rule, 'overhang-offset');
  });

  it('rule 4: uneven overhang with stroke geometry', () => {
    const r = one(L({ render_bounds: { x: 104, y: 70, w: 50, h: 20 }, stroke_geometry: { x: 108, y: 70, w: 40, h: 20 } }));
    assert.equal(r.placements[0].rule, 'stroke-geometry');
  });

  it('rule 4 needs render bounds to see an overhang', () => {
    const r = one(L({ stroke_geometry: { x: 108, y: 70, w: 40, h: 20 } }));
    assert.equal(r.placements[0].rule, 'bounds');
  });

  it('rule 5: fallback places at bounds with a warning naming the layer', () => {
    const r = one(L({ id: 'logo' }));
    assert.equal(r.placements[0].rule, 'bounds');
    assert.deepEqual([r.placements[0].left, r.placements[0].top], [10, 20]);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /"logo"/);
  });

  it('even overhang without effects_even or clipping and no stroke geometry falls back', () => {
    const r = one(L({ render_bounds: { x: 100, y: 60, w: 60, h: 40 } }));
    assert.equal(r.placements[0].rule, 'bounds');
    assert.equal(r.warnings.length, 1);
  });

  it('shape "plain" behaves like no shape', () => {
    assert.equal(one(L({ shape: 'plain' })).placements[0].rule, 'bounds');
  });

  it('every placement carries a why', () => {
    const r = one(L({ render_bounds: { x: 106, y: 66, w: 48, h: 28 }, image: { w: 48, h: 28, scale: 1 } }));
    assert.equal(typeof r.placements[0].why, 'string');
    assert.ok(r.placements[0].why.length > 0);
  });
});

describe('layer-place positions, order and flags', () => {
  it('positions are relative to the frame, including negative and fractional offsets', () => {
    const r = plan({ frame: { x: 200.5, y: -30 }, layers: [{ id: 'a', z: 1, bounds: { x: 100.25, y: -50, w: 10, h: 5 } }] });
    assert.equal(r.placements[0].left, -100.25);
    assert.equal(r.placements[0].top, -20);
  });

  it('a layer at the frame origin has no negative zero', () => {
    const r = plan({ frame: { x: 5, y: 5 }, layers: [{ id: 'a', z: 0, bounds: { x: 5, y: 5, w: 1, h: 1 } }] });
    assert.ok(Object.is(r.placements[0].left, 0) && Object.is(r.placements[0].top, 0));
  });

  it('sorts by original z; ties keep input order', () => {
    const mk = (id, z) => ({ id, z, bounds: { x: 0, y: 0, w: 1, h: 1 } });
    const r = plan({ frame: { x: 0, y: 0 }, layers: [mk('d', 3), mk('a', 1), mk('b', 1), mk('c', 1), mk('e', -2), mk('f', 3)] });
    assert.deepEqual(r.placements.map(p => p.id), ['e', 'a', 'b', 'c', 'd', 'f']);
    assert.deepEqual(r.placements.map(p => p.z), [-2, 1, 1, 1, 3, 3]);
  });

  it('children_move flags the placement and the plan for a CSS rebuild', () => {
    const r = plan({ frame, layers: [L({ id: 'card', children_move: true }), L({ id: 'x', z: 1 })] });
    assert.equal(r.placements[0].rebuild_container_in_css, true);
    assert.equal(r.placements[1].rebuild_container_in_css, undefined);
    assert.equal(r.rebuild_container_in_css, true);
    assert.deepEqual(r.rebuild_container_ids, ['card']);
  });

  it('without children_move there is no rebuild flag', () => {
    const r = one(L());
    assert.equal(r.rebuild_container_in_css, undefined);
    assert.equal(r.placements[0].rebuild_container_in_css, undefined);
  });

  it('empty layers give an empty plan', () => {
    assert.deepEqual(plan({ frame, layers: [] }), { placements: [], warnings: [] });
  });
});

describe('layer-place validation', () => {
  it('rejects non-finite numbers', () => {
    exit1(() => one(L({ bounds: { x: Infinity, y: 0, w: 1, h: 1 } })));
    exit1(() => one(L({ bounds: { x: 0, y: -Infinity, w: 1, h: 1 } })));
    exit1(() => one(L({ z: Infinity })));
    exit1(() => one(L({ z: NaN })));
    exit1(() => one(L(), { x: NaN, y: 0 }));
    exit1(() => one(L({ image: { w: 1, h: 1, scale: Infinity } })));
  });

  it('rejects negative sizes in every box and the image', () => {
    exit1(() => one(L({ bounds: { x: 0, y: 0, w: -1, h: 1 } })));
    exit1(() => one(L({ bounds: { x: 0, y: 0, w: 1, h: -1 } })));
    exit1(() => one(L({ render_bounds: { x: 0, y: 0, w: -1, h: 1 } })));
    exit1(() => one(L({ stroke_geometry: { x: 0, y: 0, w: 1, h: -0.5 } })));
    exit1(() => one(L({ image: { w: -1, h: 1, scale: 1 } })));
  });

  it('rejects scale of zero or less', () => {
    exit1(() => one(L({ image: { w: 1, h: 1, scale: 0 } })));
    exit1(() => one(L({ image: { w: 1, h: 1, scale: -2 } })));
  });

  it('rejects duplicate ids, naming the id', () => {
    assert.throws(() => plan({ frame, layers: [L({ id: 'x' }), L({ id: 'x', z: 2 })] }), e => e instanceof KitExit && e.code === 1 && /"x"/.test(e.message));
  });

  it('rejects wrong types, unknown keys and bad shapes naming the field', () => {
    exit1(() => plan([]));
    exit1(() => plan({ frame }));
    exit1(() => plan({ frame, layers: {} }));
    exit1(() => plan({ frame, layers: [], extra: 1 }));
    exit1(() => plan({ frame: { x: 0 }, layers: [] }));
    exit1(() => plan({ frame: { x: '0', y: 0 }, layers: [] }));
    exit1(() => one(L({ id: '' })));
    exit1(() => one(L({ id: 5 })));
    exit1(() => one(L({ wat: 1 })));
    exit1(() => one(L({ shape: 'blob' })));
    exit1(() => one(L({ clipped_by_parent: 'yes' })));
    exit1(() => one(L({ children_move: 1 })));
    exit1(() => one(L({ bounds: { x: 0, y: 0, w: 1 } })));
    exit1(() => one(L({ bounds: { x: 0, y: 0, w: 1, h: 1, d: 1 } })));
    exit1(() => one(L({ image: { w: 1, h: 1 } })));
    assert.throws(() => one(L({ bounds: { x: 0, y: 0, w: '1', h: 1 } })), /layers\[0\]\.bounds\.w/);
  });
});

describe('layer-place input reading', () => {
  const good = JSON.stringify({ frame, layers: [L()] });
  const ioOf = (buf, seen = {}) => ({ cwd: os.tmpdir(), stdinBytes: async o => { seen.opts = o; return buf; } });

  it('reads stdin through stdinBytes with a byte cap of MAX + 1 (happy path)', async () => {
    const seen = {};
    const r = await run([], ioOf(Buffer.from(good), seen));
    assert.equal(r.placements[0].id, 'a');
    assert.deepEqual(seen.opts, { maxBytes: MAX_INPUT_BYTES + 1 });
  });

  it('strips a BOM on stdin', async () => {
    const r = await run([], ioOf(Buffer.from('﻿' + good)));
    assert.equal(r.placements.length, 1);
  });

  it('counts the cap in bytes: multibyte text under the character cap but over the byte cap is refused', async () => {
    const chars = Math.floor(MAX_INPUT_BYTES / 3) + 1; // 3 bytes each, so fewer than MAX characters
    const text = '€'.repeat(chars);
    const buf = Buffer.from(text);
    assert.ok(text.length < MAX_INPUT_BYTES && buf.length > MAX_INPUT_BYTES);
    await exit1Async(run([], ioOf(buf)));
  });

  it('accepts input of exactly the cap in bytes (then fails as JSON, not as size)', async () => {
    const buf = Buffer.alloc(MAX_INPUT_BYTES, 0x20);
    await assert.rejects(run([], ioOf(buf)), e => e.code === 1 && /no input/.test(e.message));
  });

  it('refuses empty stdin, whitespace and invalid JSON', async () => {
    await exit1Async(run([], ioOf(Buffer.alloc(0))));
    await exit1Async(run([], ioOf(Buffer.from('  \n'))));
    await exit1Async(run([], ioOf(Buffer.from('{nope'))));
  });

  it('1e999 in the JSON is refused as non-finite', async () => {
    const txt = '{"frame":{"x":0,"y":0},"layers":[{"id":"a","z":0,"bounds":{"x":1e999,"y":0,"w":1,"h":1}}]}';
    await exit1Async(run([], ioOf(Buffer.from(txt))));
  });

  describe('--file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-place-'));
    const f = path.join(dir, 'in.json');
    fs.writeFileSync(f, good);
    const noStdin = { cwd: dir, stdinBytes: async () => { throw new Error('stdin must not be read'); } };

    it('reads a regular file, relative to cwd, same result as stdin', async () => {
      const a = await run(['--file', 'in.json'], noStdin);
      const b = await run([], ioOf(Buffer.from(good)));
      assert.deepEqual(a, b);
    });

    it('refuses a directory, a missing file, an empty value, a repeated flag, an unknown flag, a stray argument', async () => {
      await exit1Async(run(['--file', dir], noStdin));
      await exit1Async(run(['--file', path.join(dir, 'missing.json')], noStdin));
      await exit1Async(run(['--file', ''], noStdin));
      await exit1Async(run(['--file', f, '--file', f], noStdin));
      await exit1Async(run(['--file'], noStdin));
      await exit1Async(run(['--bogus', 'x'], noStdin));
      await exit1Async(run(['in.json'], noStdin));
    });

    it('refuses a FIFO without hanging', async () => {
      const fifo = path.join(dir, 'fifo');
      const { spawnSync } = await import('child_process');
      if (spawnSync('mkfifo', [fifo]).status !== 0) assert.fail('mkfifo unavailable');
      await exit1Async(run(['--file', fifo], noStdin));
    });

    it('refuses a file over the byte cap (multibyte) and an empty file', async () => {
      const big = path.join(dir, 'big.json');
      fs.writeFileSync(big, '€'.repeat(Math.floor(MAX_INPUT_BYTES / 3) + 1));
      await exit1Async(run(['--file', big], noStdin));
      const empty = path.join(dir, 'empty.json');
      fs.writeFileSync(empty, '');
      await exit1Async(run(['--file', empty], noStdin));
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
