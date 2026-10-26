import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as fidelity from '../src/lib/kit/fidelity.js';
import { classify, PRODUCT_JUDGES } from '../src/lib/kit/exit-codes.js';

const { decodePng, encodePng, crc32, compare, run, boxBlur, compositeOnWhite } = fidelity;
const exit = (fn, code = 1, re) => assert.throws(fn, (e) => e instanceof KitExit && e.code === code && (!re || re.test(e.message)));
const exitAsync = (p, code = 1, re) => assert.rejects(p, (e) => e instanceof KitExit && e.code === code && (!re || re.test(e.message)));

// ---- a test encoder of our own: any colour type, any filter per row, palette + tRNS, optional damage ----
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type, data, badCrc = false) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE((crc32(Buffer.concat([head.subarray(4), data])) ^ (badCrc ? 1 : 0)) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** samples: Buffer of raw (unfiltered) scanlines data, width*channels*height bytes. filters(y) gives the filter type of row y. */
function png({ width, height, color, samples, filters = () => 0, plte, trns, depth = 8, interlace = 0, badCrc = false, extra = [] }) {
  const bpp = CH[color], stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const ft = filters(y);
    raw[y * (stride + 1)] = ft;
    for (let i = 0; i < stride; i++) {
      const x = samples[y * stride + i];
      const a = i >= bpp ? samples[y * stride + i - bpp] : 0;
      const b = y ? samples[(y - 1) * stride + i] : 0;
      const c = y && i >= bpp ? samples[(y - 1) * stride + i - bpp] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][ft];
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = depth; ihdr[9] = color; ihdr[12] = interlace;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), ...(plte ? [chunk('PLTE', Buffer.from(plte))] : []), ...(trns ? [chunk('tRNS', Buffer.from(trns))] : []),
    ...extra, chunk('IDAT', zlib.deflateSync(raw), badCrc), chunk('IEND', Buffer.alloc(0))]);
}
/** A deterministic noisy image so every filter has something to predict. */
const noise = (n, seed = 7) => { const b = Buffer.alloc(n); let s = seed; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; b[i] = (s >> 8) & 0xff; } return b; };
/** Solid RGB image of a gray level via the module's own encoder. */
const solid = (w, h, v) => encodePng(w, h, new Uint8Array(w * h * 3).fill(v), 3);
const rgbOf = (w, h, f) => { const px = new Uint8Array(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); px.set(v, (y * w + x) * 3); } return px; };

describe('decodePng', () => {
  const W = 7, H = 6;
  it('round-trips every colour type with all five filter types (one per row, cycling)', () => {
    for (const filterFor of [(y) => y % 5, (y) => (y + 2) % 5, (y) => 4 - (y % 5)]) {
      const g = noise(W * H, 1);
      const d0 = decodePng(png({ width: W, height: H, color: 0, samples: g, filters: filterFor }));
      for (let i = 0; i < W * H; i++) assert.deepEqual([...d0.rgba.subarray(i * 4, i * 4 + 4)], [g[i], g[i], g[i], 255]);
      const ga = noise(W * H * 2, 2);
      const d4 = decodePng(png({ width: W, height: H, color: 4, samples: ga, filters: filterFor }));
      for (let i = 0; i < W * H; i++) assert.deepEqual([...d4.rgba.subarray(i * 4, i * 4 + 4)], [ga[i * 2], ga[i * 2], ga[i * 2], ga[i * 2 + 1]]);
      const rgb = noise(W * H * 3, 3);
      const d2 = decodePng(png({ width: W, height: H, color: 2, samples: rgb, filters: filterFor }));
      for (let i = 0; i < W * H; i++) assert.deepEqual([...d2.rgba.subarray(i * 4, i * 4 + 4)], [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255]);
      const rgba = noise(W * H * 4, 4);
      const d6 = decodePng(png({ width: W, height: H, color: 6, samples: rgba, filters: filterFor }));
      assert.equal(d6.width, W); assert.equal(d6.height, H);
      assert.deepEqual([...d6.rgba], [...rgba]);
    }
  });
  it('uses all five filter types in the encoder (guard against a test that never exercises them)', () => {
    const buf = png({ width: W, height: H, color: 2, samples: noise(W * H * 3), filters: (y) => y % 5 });
    const idat = zlib.inflateSync(buf.subarray(buf.indexOf('IDAT') + 4, buf.indexOf('IEND') - 8));
    const stride = W * 3 + 1;
    assert.deepEqual([0, 1, 2, 3, 4, 0].map((_, y) => idat[y * stride]), [0, 1, 2, 3, 4, 0]);
  });
  it('decodes palette images with tRNS alpha and gray / RGB colour keys', () => {
    const idx = Buffer.from([0, 1, 2, 3, 0, 1, 2, 3, 3, 2, 1, 0]);
    const d = decodePng(png({ width: 4, height: 3, color: 3, samples: idx, filters: (y) => y + 1, plte: [255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30], trns: [0, 128] }));
    assert.deepEqual([...d.rgba.subarray(0, 8)], [255, 0, 0, 0, 0, 255, 0, 128]);
    assert.deepEqual([...d.rgba.subarray(8, 16)], [0, 0, 255, 255, 10, 20, 30, 255]);
    const k = decodePng(png({ width: 2, height: 1, color: 0, samples: Buffer.from([9, 10]), trns: [0, 9] }));
    assert.deepEqual([k.rgba[3], k.rgba[7]], [0, 255]);
    const k2 = decodePng(png({ width: 2, height: 1, color: 2, samples: Buffer.from([1, 2, 3, 4, 5, 6]), trns: [0, 1, 0, 2, 0, 3] }));
    assert.deepEqual([k2.rgba[3], k2.rgba[7]], [0, 255]);
  });
  it('composites alpha on white', () => {
    const d = decodePng(png({ width: 2, height: 1, color: 6, samples: Buffer.from([0, 0, 0, 0, 0, 0, 0, 255]) }));
    assert.deepEqual([...compositeOnWhite(d)], [255, 255, 255, 0, 0, 0]);
    const half = decodePng(png({ width: 1, height: 1, color: 4, samples: Buffer.from([0, 128]) }));
    assert.ok(Math.abs(compositeOnWhite(half)[0] - 127 * 1) < 1);
  });
  it('rejects a bad CRC, 16-bit, sub-byte depth, interlaced, bad signature, truncation, wrong data length, bad palette', () => {
    const base = { width: 3, height: 3, color: 2, samples: noise(27) };
    exit(() => decodePng(png({ ...base, badCrc: true })), 1, /bad CRC/);
    exit(() => decodePng(png({ ...base, depth: 16 })), 1, /16-bit/);
    exit(() => decodePng(png({ ...base, depth: 4 })), 1, /bit depth 4/);
    exit(() => decodePng(png({ ...base, interlace: 1 })), 1, /interlaced/);
    exit(() => decodePng(Buffer.from('not a png at all')), 1, /signature/);
    const ok = png(base);
    exit(() => decodePng(ok.subarray(0, ok.length - 20)), 1, /truncated/);
    exit(() => decodePng(ok.subarray(0, ok.length - 12)), 1, /IEND/);
    exit(() => decodePng(ok.subarray(0, 8)), 1);
    exit(() => decodePng(png({ width: 3, height: 3, color: 3, samples: Buffer.alloc(9) })), 1, /PLTE/);
    exit(() => decodePng(png({ width: 3, height: 3, color: 3, samples: Buffer.alloc(9, 5), plte: [1, 2, 3] })), 1, /beyond its palette/);
    // pixel data of the wrong length: header says 3x3 but data is for 3x2
    const forged = Buffer.from(png({ width: 3, height: 3, color: 2, samples: noise(27) }));
    const ihdr = forged.subarray(16, 29); ihdr.writeUInt32BE(4, 4); forged.writeUInt32BE(crc32(forged.subarray(12, 29)), 29);
    exit(() => decodePng(forged), 1, /pixel data/);
  });
  it('refuses an image over 50 megapixels before inflating it', () => {
    const buf = png({ width: 2, height: 2, color: 0, samples: Buffer.alloc(4) });
    const ihdr = buf.subarray(16, 29); ihdr.writeUInt32BE(8000, 0); ihdr.writeUInt32BE(8000, 4); buf.writeUInt32BE(crc32(buf.subarray(12, 29)), 29);
    exit(() => decodePng(buf), 1, /megapixels/);
  });
  it('encodePng output is a PNG that decodes back', () => {
    const px = rgbOf(5, 4, (x, y) => [x * 40, y * 60, 7]);
    const d = decodePng(encodePng(5, 4, px, 3));
    for (let i = 0; i < 20; i++) assert.deepEqual([...d.rgba.subarray(i * 4, i * 4 + 4)], [px[i * 3], px[i * 3 + 1], px[i * 3 + 2], 255]);
  });
});

describe('scoring', () => {
  const img = (w, h, v) => decodePng(solid(w, h, v));
  it('identical images: identical true, psnr null, pass', () => {
    const r = compare(img(8, 8, 90), img(8, 8, 90), {});
    assert.equal(r.identical, true); assert.equal(r.psnr, null); assert.equal(r.pass, true);
    assert.equal(r.exit, undefined);
    assert.equal(JSON.parse(JSON.stringify(r)).psnr, null);
  });
  it('a known PSNR, computed by hand: uniform gray 100 vs 110 is mse 100, 10*log10(65025/100) = 28.1315 dB', () => {
    const r = compare(img(6, 6, 100), img(6, 6, 110), { blur: 0, target: 28 });
    assert.equal(r.psnr, Math.round(10 * Math.log10(65025 / 100) * 1e4) / 1e4);
    assert.ok(Math.abs(r.psnr - 28.1315) < 1e-3);
    assert.equal(r.identical, false); assert.equal(r.pass, true);
  });
  it('luminance weighting: only red off by 10 gives mse 0.299*100 = 29.9', () => {
    const a = decodePng(encodePng(2, 2, rgbOf(2, 2, () => [100, 100, 100]), 3));
    const b = decodePng(encodePng(2, 2, rgbOf(2, 2, () => [110, 100, 100]), 3));
    const r = compare(a, b, { blur: 0, target: 1 });
    assert.ok(Math.abs(r.psnr - 10 * Math.log10(65025 / 29.9)) < 1e-3);
  });
  it('half the pixels differ by 20: mse 200, 25.1 dB', () => {
    const a = decodePng(encodePng(4, 2, rgbOf(4, 2, () => [50, 50, 50]), 3));
    const b = decodePng(encodePng(4, 2, rgbOf(4, 2, (x) => (x < 2 ? [70, 70, 70] : [50, 50, 50])), 3));
    const r = compare(a, b, { blur: 0, target: 25 });
    assert.ok(Math.abs(r.psnr - 10 * Math.log10(65025 / 200)) < 1e-3);
    assert.equal(r.pass, true);
    assert.equal(compare(a, b, { blur: 0, target: 26 }).pass, false);
  });
  it('box blur: the mean of a single bright pixel spreads over the window, edges clamp', () => {
    const src = new Float32Array(5 * 1 * 3);
    src[2 * 3] = 90;
    const o = boxBlur(src, 5, 1, 1);
    assert.deepEqual([0, 1, 2, 3, 4].map((x) => o[x * 3]), [0, 30, 30, 30, 0]);
    assert.equal(boxBlur(src, 5, 1, 0), src);
  });
  it('blur suppresses a 1px offset more than it suppresses a moved block', () => {
    const block = (x0) => decodePng(encodePng(40, 40, rgbOf(40, 40, (x, y) => (x >= x0 && x < x0 + 8 && y >= 16 && y < 24 ? [0, 0, 0] : [255, 255, 255])), 3));
    const ref = block(10);
    const shifted = block(11), moved = block(25);
    const gain = (other) => compare(ref, other, { blur: 2, target: 1 }).psnr - compare(ref, other, { blur: 0, target: 1 }).psnr;
    // 1px shift: 16 px change; 15px move: 128 px change. Compare the improvement blur buys, and the blurred score itself.
    assert.ok(gain(shifted) > gain(moved) + 3, `offset gain ${gain(shifted)} vs moved gain ${gain(moved)}`);
    assert.ok(compare(ref, shifted, { blur: 2, target: 1 }).psnr > compare(ref, moved, { blur: 2, target: 1 }).psnr + 8);
  });
  it('regions: scored separately, a failing one is retried at triple blur and reports structural_psnr', () => {
    const ref = decodePng(encodePng(40, 40, rgbOf(40, 40, (x, y) => (x >= 10 && x < 18 && y >= 16 && y < 24 ? [0, 0, 0] : [255, 255, 255])), 3));
    const act = decodePng(encodePng(40, 40, rgbOf(40, 40, (x, y) => (x >= 11 && x < 19 && y >= 16 && y < 24 ? [0, 0, 0] : [255, 255, 255])), 3));
    const r = compare(ref, act, {
      blur: 1, target: 20,
      regions: [{ id: 'card', x: 4, y: 10, w: 20, h: 20, target: 45 }, { id: 'footer', x: 0, y: 30, w: 40, h: 10 }, { id: 'loose', x: 4, y: 10, w: 20, h: 20, target: 10 }],
    });
    const [card, footer, loose] = r.regions;
    assert.equal(card.pass, false);
    assert.equal(typeof card.structural_psnr, 'number');
    assert.ok(card.structural_psnr > card.psnr, 'heavier blur should score the offset block higher');
    assert.equal(footer.pass, true); assert.equal(footer.psnr, null);
    assert.equal(footer.structural_psnr, undefined); assert.equal(footer.target, 28);
    assert.equal(loose.pass, true); assert.equal(loose.structural_psnr, undefined);
    assert.equal(r.pass, false); assert.equal(r.exit, 2);
    // the frame itself is fine: only the region fails the verdict
    assert.equal(r.frame_pass, true);
  });
  it('a region is not rescued by its structural score', () => {
    const ref = img(10, 10, 0), act = img(10, 10, 255);
    const r = compare(ref, act, { regions: [{ id: 'a', x: 0, y: 0, w: 5, h: 5 }] });
    assert.equal(r.regions[0].pass, false); assert.equal(r.exit, 2);
  });
  it('size mismatch is exit 1', () => {
    exit(() => compare(img(4, 4, 1), img(4, 5, 1), {}), 1, /sizes differ/);
  });
  it('validates regions', () => {
    const a = img(10, 10, 5);
    for (const regions of [{}, [1], [{ id: 'a', x: 0, y: 0, w: 11, h: 1 }], [{ id: 'a', x: -1, y: 0, w: 1, h: 1 }], [{ id: 'a', x: 0, y: 0, w: 0, h: 1 }],
      [{ id: 'a', x: 0, y: 0, w: 1, h: 1, bogus: 1 }], [{ id: '', x: 0, y: 0, w: 1, h: 1 }], [{ id: 'a', x: 0.5, y: 0, w: 1, h: 1 }],
      [{ id: 'a', x: 0, y: 0, w: 1, h: 1 }, { id: 'a', x: 0, y: 0, w: 1, h: 1 }], [{ id: 'a', x: 0, y: 0, w: 1, h: 1, target: 'x' }]]) {
      exit(() => compare(a, a, { regions }));
    }
  });
});

describe('run', () => {
  const tmp = async (fn) => { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'fid-')); try { return await fn(d); } finally { await fs.rm(d, { recursive: true, force: true }); } };
  const put = async (d, name, data) => { await fs.writeFile(path.join(d, name), data); return name; };
  it('passes identical images with exit unset, fails below target with exit 2', () => tmp(async (d) => {
    await put(d, 'a.png', solid(8, 8, 100)); await put(d, 'b.png', solid(8, 8, 100)); await put(d, 'c.png', solid(8, 8, 160));
    const ok = await run(['--ref', 'a.png', '--actual', 'b.png'], { cwd: d });
    assert.equal(ok.identical, true); assert.equal(ok.pass, true); assert.equal(ok.target, 30); assert.equal(ok.exit, undefined);
    const no = await run(['--ref', 'a.png', '--actual', 'c.png'], { cwd: d });
    assert.equal(no.pass, false); assert.equal(no.exit, 2);
    assert.ok(Math.abs(no.psnr - 10 * Math.log10(65025 / 3600)) < 1e-3);
    const lax = await run(['--ref=a.png', '--actual=c.png', '--target', '10'], { cwd: d });
    assert.equal(lax.pass, true);
  }));
  it('reads --regions and reports region results', () => tmp(async (d) => {
    await put(d, 'a.png', solid(8, 8, 100)); await put(d, 'c.png', solid(8, 8, 160));
    await put(d, 'r.json', JSON.stringify([{ id: 'hero', x: 0, y: 0, w: 4, h: 4 }]));
    const r = await run(['--ref', 'a.png', '--actual', 'c.png', '--regions', 'r.json', '--target', '5', '--region-target', '40'], { cwd: d });
    assert.equal(r.pass, false); assert.equal(r.exit, 2); assert.equal(r.frame_pass, true);
    assert.equal(r.regions[0].id, 'hero'); assert.equal(typeof r.regions[0].structural_psnr, 'number'); assert.equal(r.regions[0].target, 40);
    await put(d, 'bad.json', '{nope');
    await exitAsync(run(['--ref', 'a.png', '--actual', 'c.png', '--regions', 'bad.json'], { cwd: d }));
  }));
  it('size mismatch and damaged PNGs are exit 1 with the flag named', () => tmp(async (d) => {
    await put(d, 'a.png', solid(8, 8, 1)); await put(d, 'b.png', solid(8, 9, 1)); await put(d, 'bad.png', png({ width: 2, height: 2, color: 2, samples: noise(12), badCrc: true }));
    await exitAsync(run(['--ref', 'a.png', '--actual', 'b.png'], { cwd: d }), 1, /sizes differ/);
    await exitAsync(run(['--ref', 'a.png', '--actual', 'bad.png'], { cwd: d }), 1, /--actual.*bad CRC/);
    await exitAsync(run(['--ref', 'missing.png', '--actual', 'a.png'], { cwd: d }), 1, /cannot read --ref/);
  }));
  it('input rules: directories, FIFOs-like non-regular files, empty and repeated flags, unknown flags and bad numbers are exit 1', () => tmp(async (d) => {
    await put(d, 'a.png', solid(4, 4, 1)); await fs.mkdir(path.join(d, 'dir'));
    const bad = (args, re) => exitAsync(run(args, { cwd: d }), 1, re);
    await bad(['--ref', 'dir', '--actual', 'a.png'], /not a regular file/);
    await bad(['--ref', '', '--actual', 'a.png'], /non-empty/);
    await bad(['--ref', 'a.png', '--ref', 'a.png', '--actual', 'a.png'], /twice/);
    await bad(['--ref', 'a.png'], /--actual is required/);
    await bad(['--ref', 'a.png', '--actual', 'a.png', '--bogus', '1'], /unknown flag/);
    await bad(['--ref', 'a.png', '--actual', 'a.png', '--target', 'abc'], /number/);
    await bad(['--ref', 'a.png', '--actual', 'a.png', '--target', '0'], /between/);
    await bad(['--ref', 'a.png', '--actual', 'a.png', '--blur', '1.5'], /whole number/);
    await bad(['--ref', 'a.png', '--actual', 'a.png', '--blur', '-1'], /number/);
    await bad(['--ref', 'a.png', '--actual', 'a.png', 'stray'], /unexpected/);
  }));
  it('a PNG over 64 MiB is refused by size before it is read', () => tmp(async (d) => {
    const f = path.join(d, 'big.png');
    await fs.writeFile(f, ''); await fs.truncate(f, 64 * 1048576 + 1);
    await put(d, 'a.png', solid(4, 4, 1));
    await exitAsync(run(['--ref', 'big.png', '--actual', 'a.png'], { cwd: d }), 1, /larger than/);
  }));
  it('--diff-out writes an amplified, clamped difference as a valid PNG via temp + rename', () => tmp(async (d) => {
    await put(d, 'a.png', encodePng(2, 1, new Uint8Array([100, 100, 100, 200, 200, 200]), 3));
    await put(d, 'b.png', encodePng(2, 1, new Uint8Array([110, 100, 90, 200, 200, 200]), 3));
    const r = await run(['--ref', 'a.png', '--actual', 'b.png', '--diff-out', 'diff.png'], { cwd: d });
    assert.equal(r.diff_out, path.join(d, 'diff.png'));
    const dec = decodePng(await fs.readFile(path.join(d, 'diff.png')));
    assert.deepEqual([...dec.rgba], [40, 0, 40, 255, 0, 0, 0, 255]);
    assert.deepEqual((await fs.readdir(d)).filter((n) => n.endsWith('.tmp')), []);
    // clamp at 255
    await put(d, 'w.png', solid(1, 1, 0)); await put(d, 'x.png', solid(1, 1, 200));
    await run(['--ref', 'w.png', '--actual', 'x.png', '--diff-out', 'd2.png'], { cwd: d });
    assert.deepEqual([...decodePng(await fs.readFile(path.join(d, 'd2.png'))).rgba.subarray(0, 3)], [255, 255, 255]);
    // overwrites an existing regular file
    await run(['--ref', 'a.png', '--actual', 'a.png', '--diff-out', 'diff.png'], { cwd: d });
    assert.deepEqual([...decodePng(await fs.readFile(path.join(d, 'diff.png'))).rgba.subarray(0, 3)], [0, 0, 0]);
  }));
  it('--diff-out refuses a symlink target and leaves what it points at alone', () => tmp(async (d) => {
    await put(d, 'a.png', solid(2, 2, 1)); await put(d, 'victim.txt', 'keep');
    await fs.symlink('victim.txt', path.join(d, 'link.png'));
    await exitAsync(run(['--ref', 'a.png', '--actual', 'a.png', '--diff-out', 'link.png'], { cwd: d }), 1, /symlink/);
    assert.equal(await fs.readFile(path.join(d, 'victim.txt'), 'utf-8'), 'keep');
    assert.equal((await fs.lstat(path.join(d, 'link.png'))).isSymbolicLink(), true);
    await fs.symlink('nowhere', path.join(d, 'dangling.png'));
    await exitAsync(run(['--ref', 'a.png', '--actual', 'a.png', '--diff-out', 'dangling.png'], { cwd: d }), 1, /symlink/);
    await fs.mkdir(path.join(d, 'adir'));
    await exitAsync(run(['--ref', 'a.png', '--actual', 'a.png', '--diff-out', 'adir'], { cwd: d }), 1, /not a regular file/);
  }));
});

describe('exit-codes', () => {
  it('fidelity is a product judge and its exit 2 classifies as a blocking regression', () => {
    assert.ok(PRODUCT_JUDGES.includes('fidelity'));
    const c = classify({ code: 2, verb: 'fidelity' });
    assert.equal(c.class, 'regression'); assert.equal(c.blocks, true);
    assert.equal(classify({ code: 1, verb: 'fidelity' }).blocks, false);
  });
});
