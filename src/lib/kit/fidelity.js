/**
 * fidelity — score a rendered frame against a reference frame. A judge: it says whether the picture is close enough.
 *
 *   fidelity --ref <a.png> --actual <b.png> [--regions <f.json>] [--target 30] [--region-target 28] [--blur 1] [--diff-out <d.png>]
 *
 * Both PNGs are decoded with a small decoder of our own (node:zlib only): 8-bit gray, gray+alpha, RGB, RGBA and
 * palette (with tRNS), non-interlaced. 16-bit, sub-byte depths and interlaced files are refused with exit 1, as is a
 * file with a bad CRC. Pixels are composited on white, blurred (box blur of radius --blur, separable, edges clamped;
 * 0 means no blur) and compared with a luminance-weighted PSNR: the squared error of R, G and B is weighted
 * 0.299 / 0.587 / 0.114, then PSNR = 10 log10(255^2 / mse). Identical images have infinite PSNR, which is reported
 * as null with identical:true. The image sizes must match (else exit 1).
 *
 * --regions is a JSON array [{ id, x, y, w, h, target? }]; each region is scored on the same blurred images with its
 * own target (default --region-target). A region below target is retried at three times the blur (3 when --blur is 0)
 * and reported as structural_psnr, to tell a tiny offset (structure fine) from a misplaced layer (structure bad).
 * The retry is a diagnosis only: pass is decided by the first score, so a region never passes by blurring harder.
 *
 * Output { psnr, target, pass, identical, regions:[{ id, psnr, structural_psnr?, target, pass }], diff_out? }. The verb
 * exits 2 (returned as exit:2) when the frame or any region fails its target; 2 is only ever a product verdict here.
 * --diff-out writes the absolute difference amplified x4 and clamped as an RGB PNG (temp file + rename; a symlink or
 * non-regular target is refused with exit 1).
 * Inputs: regular files only, bounded reads (64 MiB per PNG, 8 MiB for regions), at most 50 megapixels decoded.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { KitExit } from './kit-exit.js';

export const verb = 'fidelity';
export const usage = 'cli.js fidelity --ref <a.png> --actual <b.png> [--regions <f.json>] [--target 30] [--region-target 28] [--blur 1] [--diff-out <d.png>]  (judge: exit 2 when the frame or any region is below target; PNG only)';

export const MAX_PNG_BYTES = 64 * 1048576;
export const MAX_JSON_BYTES = 8 * 1048576;
export const MAX_PIXELS = 50_000_000;
export const MAX_REGIONS = 1000;
export const MAX_BLUR = 64;
export const DEFAULT_TARGET = 30;
export const DEFAULT_REGION_TARGET = 28;
export const DEFAULT_BLUR = 1;
const WEIGHTS = [0.299, 0.587, 0.114];
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const bad = (m) => new KitExit(m, 1);

// ---- PNG ----------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Decode a PNG buffer to { width, height, rgba } (non-premultiplied RGBA bytes). Throws KitExit 1 on anything unsupported or damaged. */
export function decodePng(buf, name = 'image') {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw bad(`${name} is not a PNG file (bad signature)`);
  let pos = 8;
  let ihdr = null, plte = null, trns = null, ended = false;
  const idat = [];
  let idatBytes = 0;
  while (pos < buf.length && !ended) {
    if (pos + 12 > buf.length) throw bad(`${name} is truncated (incomplete chunk header)`);
    const len = buf.readUInt32BE(pos);
    if (len > 0x7fffffff || pos + 12 + len > buf.length) throw bad(`${name} is truncated (chunk runs past the end of the file)`);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) throw bad(`${name} has a bad CRC in its ${JSON.stringify(type)} chunk (damaged file)`);
    pos += 12 + len;
    if (!ihdr && type !== 'IHDR') throw bad(`${name} does not start with an IHDR chunk`);
    if (type === 'IHDR') {
      if (ihdr || len !== 13) throw bad(`${name} has a bad IHDR chunk`);
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], compression: data[10], filter: data[11], interlace: data[12] };
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') { idat.push(data); idatBytes += len; if (idatBytes > MAX_PNG_BYTES) throw bad(`${name} is too large`); }
    else if (type === 'IEND') ended = true;
  }
  if (!ihdr) throw bad(`${name} has no IHDR chunk`);
  if (!ended) throw bad(`${name} is truncated (no IEND chunk)`);
  if (!Object.hasOwn(CHANNELS, ihdr.color)) throw bad(`${name} has an unknown PNG colour type ${ihdr.color}`);
  if (ihdr.depth !== 8) throw bad(`${name} has bit depth ${ihdr.depth}; only 8-bit PNGs are supported (16-bit and sub-byte depths are refused; re-export as 8-bit)`);
  if (ihdr.interlace !== 0) throw bad(`${name} is interlaced (Adam7); only non-interlaced PNGs are supported (re-export without interlacing)`);
  if (ihdr.compression !== 0 || ihdr.filter !== 0) throw bad(`${name} uses an unknown compression or filter method`);
  const { width, height, color } = ihdr;
  if (!width || !height) throw bad(`${name} has a zero dimension`);
  if (width * height > MAX_PIXELS) throw bad(`${name} is ${width}x${height} = ${(width * height / 1e6).toFixed(1)} megapixels; the limit is ${MAX_PIXELS / 1e6} megapixels`);
  if (color === 3 && (!plte || plte.length % 3 || plte.length === 0 || plte.length > 768)) throw bad(`${name} is a palette image without a valid PLTE chunk`);
  const bpp = CHANNELS[color];
  const stride = width * bpp;
  const expected = (stride + 1) * height;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 }); } catch (e) { throw bad(`${name} has damaged or oversized pixel data (${e.code || e.message})`); }
  if (raw.length !== expected) throw bad(`${name} has the wrong amount of pixel data (${raw.length} bytes, expected ${expected})`);
  // Unfilter in place, row by row.
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    if (ft > 4) throw bad(`${name} has an unknown filter type ${ft} on row ${y}`);
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y > 0 ? out[prev + i] : 0;
      const c = y > 0 && i >= bpp ? out[prev + i - bpp] : 0;
      let v;
      if (ft === 0) v = x;
      else if (ft === 1) v = x + a;
      else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[dst + i] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  // tRNS: palette alpha per entry; gray / RGB a single colour key.
  let key = null;
  if (trns && color === 0 && trns.length >= 2) key = [trns.readUInt16BE(0) & 0xff];
  if (trns && color === 2 && trns.length >= 6) key = [trns.readUInt16BE(0) & 0xff, trns.readUInt16BE(2) & 0xff, trns.readUInt16BE(4) & 0xff];
  for (let p = 0, n = width * height; p < n; p++) {
    const s = p * bpp, d = p * 4;
    if (color === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = key && key[0] === out[s] ? 0 : 255; }
    else if (color === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = out[s + 1]; }
    else if (color === 2) { rgba[d] = out[s]; rgba[d + 1] = out[s + 1]; rgba[d + 2] = out[s + 2]; rgba[d + 3] = key && key[0] === out[s] && key[1] === out[s + 1] && key[2] === out[s + 2] ? 0 : 255; }
    else if (color === 6) { rgba[d] = out[s]; rgba[d + 1] = out[s + 1]; rgba[d + 2] = out[s + 2]; rgba[d + 3] = out[s + 3]; }
    else {
      const idx = out[s];
      if (idx * 3 + 2 >= plte.length) throw bad(`${name} uses palette index ${idx} beyond its palette`);
      rgba[d] = plte[idx * 3]; rgba[d + 1] = plte[idx * 3 + 1]; rgba[d + 2] = plte[idx * 3 + 2];
      rgba[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { width, height, rgba };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encode 8-bit RGB (channels 3) or RGBA (channels 4) bytes as a non-interlaced PNG (filter 0). */
export function encodePng(width, height, pixels, channels = 3) {
  if (channels !== 3 && channels !== 4) throw bad('encodePng: channels must be 3 or 4');
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = channels === 3 ? 2 : 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- scoring ------------------------------------------------------------------------------------------------

/** RGBA to float RGB composited on white. */
export function compositeOnWhite({ width, height, rgba }) {
  const out = new Float32Array(width * height * 3);
  for (let p = 0, n = width * height; p < n; p++) {
    const a = rgba[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out[p * 3 + c] = rgba[p * 4 + c] * a + 255 * (1 - a);
  }
  return out;
}

/** Separable box blur of radius r (window 2r+1, edges clamped) over interleaved 3-channel floats. r 0 returns the input. */
export function boxBlur(src, width, height, r) {
  if (r <= 0) return src;
  const win = 2 * r + 1;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const pass = (from, to, len, count, step, lineStep) => {
    for (let line = 0; line < count; line++) {
      for (let c = 0; c < 3; c++) {
        const base = line * lineStep * 3 + c;
        const at = (i) => from[base + Math.min(len - 1, Math.max(0, i)) * step * 3];
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += at(i);
        for (let i = 0; i < len; i++) {
          to[base + i * step * 3] = sum / win;
          sum += at(i + r + 1) - at(i - r);
        }
      }
    }
  };
  pass(src, tmp, width, height, 1, width);   // along x
  pass(tmp, out, height, width, width, 1);   // along y
  return out;
}

/** Luminance-weighted mean squared error over a rectangle of two float RGB images. */
export function mseRect(a, b, width, rect) {
  let sum = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; sum += WEIGHTS[c] * d * d; }
    }
  }
  return sum / (rect.w * rect.h);
}

/** PSNR in dB from an MSE; Infinity when the error is zero. */
export const psnrOf = (mse) => (mse <= 0 ? Infinity : 10 * Math.log10((255 * 255) / mse));
const round = (v) => Math.round(v * 10000) / 10000;
const report = (v) => (v === Infinity ? null : round(v));
const passes = (v, target) => v === Infinity || v >= target;

const REGION_KEYS = ['id', 'x', 'y', 'w', 'h', 'target'];
/** Validate a regions array against the image size; returns fresh objects. */
export function normalizeRegions(input, width, height, regionTarget) {
  const list = Array.isArray(input) ? input : null;
  if (!list) throw bad('regions must be a JSON array of { id, x, y, w, h, target? }');
  if (list.length > MAX_REGIONS) throw bad(`regions has ${list.length} entries; the limit is ${MAX_REGIONS}`);
  const seen = new Set();
  return list.map((r, i) => {
    const where = `regions[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad(`${where} must be an object`);
    for (const k of Object.keys(r)) if (!REGION_KEYS.includes(k)) throw bad(`unknown key "${k}" in ${where} (allowed: ${REGION_KEYS.join(', ')})`);
    if (typeof r.id !== 'string' || !r.id) throw bad(`${where}.id must be a non-empty string`);
    if (seen.has(r.id)) throw bad(`${where}.id "${r.id}" is repeated`);
    seen.add(r.id);
    for (const k of ['x', 'y']) if (!Number.isInteger(r[k]) || r[k] < 0) throw bad(`${where}.${k} must be a non-negative integer`);
    for (const k of ['w', 'h']) if (!Number.isInteger(r[k]) || r[k] < 1) throw bad(`${where}.${k} must be a positive integer`);
    if (r.x + r.w > width || r.y + r.h > height) throw bad(`${where} (${r.id}) lies outside the ${width}x${height} image`);
    if (r.target !== undefined && (typeof r.target !== 'number' || !Number.isFinite(r.target) || r.target <= 0)) throw bad(`${where}.target must be a positive number`);
    return { id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, target: r.target === undefined ? regionTarget : r.target };
  });
}

/** Compare two decoded images. Returns the verb's result without diff_out. */
export function compare(refImg, actImg, { target = DEFAULT_TARGET, regionTarget = DEFAULT_REGION_TARGET, blur = DEFAULT_BLUR, regions = [] } = {}) {
  if (refImg.width !== actImg.width || refImg.height !== actImg.height) throw bad(`image sizes differ: ref is ${refImg.width}x${refImg.height}, actual is ${actImg.width}x${actImg.height}`);
  const { width, height } = refImg;
  const rs = normalizeRegions(regions, width, height, regionTarget);
  const ref = compositeOnWhite(refImg), act = compositeOnWhite(actImg);
  const full = { x: 0, y: 0, w: width, h: height };
  const a = boxBlur(ref, width, height, blur), b = boxBlur(act, width, height, blur);
  const p = psnrOf(mseRect(a, b, width, full));
  let heavy = null;
  const out = rs.map((r) => {
    const rp = psnrOf(mseRect(a, b, width, r));
    const row = { id: r.id, psnr: report(rp), target: r.target, pass: passes(rp, r.target) };
    if (!row.pass) {
      if (!heavy) { const k = Math.min(MAX_BLUR, blur > 0 ? blur * 3 : 3); heavy = [boxBlur(ref, width, height, k), boxBlur(act, width, height, k)]; }
      row.structural_psnr = report(psnrOf(mseRect(heavy[0], heavy[1], width, r)));
    }
    return row;
  });
  const frameOk = passes(p, target);
  const pass = frameOk && out.every((r) => r.pass);
  // `pass` is the verdict for the whole check (frame and every region); frame_pass says only the frame.
  const result = { psnr: report(p), target, pass, frame_pass: frameOk, identical: p === Infinity, regions: out };
  if (!pass) result.exit = 2;
  return result;
}

/** Amplified (x4, clamped) absolute difference of the composited, unblurred images as an RGB PNG buffer. */
export function diffPng(refImg, actImg) {
  const ref = compositeOnWhite(refImg), act = compositeOnWhite(actImg);
  const px = new Uint8Array(ref.length);
  for (let i = 0; i < ref.length; i++) px[i] = Math.min(255, Math.round(Math.abs(ref[i] - act[i]) * 4));
  return encodePng(refImg.width, refImg.height, px, 3);
}

// ---- input and output ---------------------------------------------------------------------------------------

/** Read a regular file with a bounded read of at most max + 1 bytes; returns null-free Buffer or throws KitExit 1. */
export async function readBounded(file, flag, max) {
  let st;
  try { st = await fs.stat(file); } catch (e) { throw bad(`cannot read ${flag} ${file}: ${e.code || e.message}`); }
  if (!st.isFile()) throw bad(`${flag} ${file} is not a regular file`);
  if (st.size > max) throw bad(`${flag} ${file} is larger than ${max} bytes`);
  let fh;
  try { fh = await fs.open(file, 'r'); } catch (e) { throw bad(`cannot read ${flag} ${file}: ${e.code || e.message}`); }
  try {
    const buf = Buffer.alloc(Math.min(st.size, max) + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    if (n > max) throw bad(`${flag} ${file} is larger than ${max} bytes`);
    return buf.subarray(0, n);
  } finally { await fh.close(); }
}

/** Write a buffer to `out` through a temp file and a rename; a symlink or non-regular existing target is refused. */
export async function writeAtomic(out, data) {
  let st = null;
  try { st = await fs.lstat(out); } catch (e) { if (e.code !== 'ENOENT') throw bad(`cannot write ${out}: ${e.code || e.message}`); }
  if (st && st.isSymbolicLink()) throw bad(`--diff-out ${out} is a symlink; refusing to write through it`);
  if (st && !st.isFile()) throw bad(`--diff-out ${out} exists and is not a regular file`);
  const tmp = `${out}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, data, { flag: 'wx' });
    await fs.rename(tmp, out);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw bad(`cannot write ${out}: ${e.code || e.message}`);
  }
}

const VALUE = ['ref', 'actual', 'regions', 'target', 'region-target', 'blur', 'diff-out'];
export function parse(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    let a = args[i], inline = null;
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"\n${usage}`);
    const eq = a.indexOf('=');
    if (eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
    const k = a.slice(2);
    if (!VALUE.includes(k)) throw bad(`unknown flag --${k} (allowed: ${VALUE.map((f) => `--${f}`).join(', ')})`);
    if (Object.hasOwn(flags, k)) throw bad(`--${k} given twice`);
    let v = inline;
    if (v === null) { if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw bad(`--${k} needs a value`); v = args[++i]; }
    if (!v) throw bad(`--${k} needs a non-empty value`);
    flags[k] = v;
  }
  for (const k of ['ref', 'actual']) if (!flags[k]) throw bad(`--${k} is required\n${usage}`);
  const num = (k, def, min, max) => {
    if (flags[k] === undefined) return def;
    if (!/^\d+(\.\d+)?$/.test(flags[k])) throw bad(`--${k} must be a number, got ${JSON.stringify(flags[k])}`);
    const n = Number(flags[k]);
    if (!Number.isFinite(n) || n < min || n > max) throw bad(`--${k} must be between ${min} and ${max}, got ${flags[k]}`);
    return n;
  };
  return {
    flags,
    target: num('target', DEFAULT_TARGET, 0.01, 1000),
    regionTarget: num('region-target', DEFAULT_REGION_TARGET, 0.01, 1000),
    blur: num('blur', DEFAULT_BLUR, 0, MAX_BLUR / 3),
  };
}

export async function run(args, io = {}) {
  const { flags, target, regionTarget, blur } = parse(args);
  if (!Number.isInteger(blur)) throw bad(`--blur must be a whole number of pixels, got ${flags.blur}`);
  const cwd = io.cwd || process.cwd();
  const at = (f) => path.resolve(cwd, f);
  const refImg = decodePng(await readBounded(at(flags.ref), '--ref', MAX_PNG_BYTES), '--ref');
  const actImg = decodePng(await readBounded(at(flags.actual), '--actual', MAX_PNG_BYTES), '--actual');
  let regions = [];
  if (flags.regions) {
    const text = (await readBounded(at(flags.regions), '--regions', MAX_JSON_BYTES)).toString('utf-8').replace(/^﻿/, '');
    try { regions = JSON.parse(text); } catch { throw bad('--regions is not valid JSON'); }
  }
  const result = compare(refImg, actImg, { target, regionTarget, blur, regions });
  if (flags['diff-out']) {
    const out = at(flags['diff-out']);
    await writeAtomic(out, diffPng(refImg, actImg));
    result.diff_out = out;
  }
  return result;
}
