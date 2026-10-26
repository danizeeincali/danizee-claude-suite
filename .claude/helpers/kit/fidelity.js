/**
 * fidelity — score a rendered frame against a reference frame. A judge: it says whether the picture is close enough.
 *
 *   fidelity --ref <a.png> --actual <b.png> [--regions <f.json>] [--target 30] [--region-target 28] [--blur 1] [--diff-out <d.png>]
 *
 * Both PNGs are decoded with a small decoder of our own (node:zlib only): 8-bit gray, gray+alpha, RGB, RGBA and
 * palette (with tRNS), non-interlaced. 16-bit, sub-byte depths and interlaced files are refused with exit 1, as is a
 * file with a bad CRC, an unknown critical chunk, or a PLTE / tRNS chunk after the pixel data. Pixels are composited on
 * white, blurred (gaussian blur of radius --blur: sigma = radius / 2, kernel cut at 3 sigma, separable, edges clamped;
 * 0 means no blur) and compared with a luminance-weighted PSNR: the squared error of R, G and B is weighted
 * 0.299 / 0.587 / 0.114, then PSNR = 10 log10(255^2 / mse). A gaussian is used, not a box, because a box window of
 * 2r+1 has exact spectral zeros: a period-(2r+1) stripe pattern would blur to nothing and pass as identical.
 * identical is decided on the raw composited pixels, never on the blurred ones: only identical images have infinite
 * PSNR (reported as null with identical:true); a difference the blur flattens completely still scores a finite PSNR
 * (at most about 148 dB). The image sizes must match (else exit 1).
 *
 * --regions is a JSON array [{ id, x, y, w, h, target? }]; each region is scored on the same blurred images with its
 * own target (default --region-target). A region below target is retried at three times the blur (3 when --blur is 0)
 * and reported as structural_psnr, to tell a tiny offset (structure fine) from a misplaced layer (structure bad).
 * The retry is a diagnosis only: pass is decided by the first score, so a region never passes by blurring harder.
 *
 * Output { psnr, target, pass, identical, regions:[{ id, psnr, structural_psnr?, target, pass }], diff_out? }. The verb
 * exits 2 (returned as exit:2) when the frame or any region fails its target; 2 is only ever a product verdict here.
 * --diff-out writes the absolute difference amplified x4 and clamped as an RGB PNG (temp file + rename). A --diff-out
 * that is the same file as --ref, --actual or --regions is refused with exit 1 before anything is scored. A symlink,
 * non-regular or unwritable target is exit 1 when the check passes; when it fails, the verdict wins: exit stays 2 and
 * the write problem is reported as diff_out_error (a missing artifacts folder must never let a failing frame through).
 * Inputs: regular files only (opened O_NONBLOCK, then checked with fstat on the open handle, so a FIFO swapped in
 * cannot hang the read), bounded reads (64 MiB per PNG, 8 MiB for regions), at most 16 megapixels decoded.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import crypto from 'crypto';
import { constants as FS } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { KitExit } from './kit-exit.js';

export const verb = 'fidelity';
export const usage = 'cli.js fidelity --ref <a.png> --actual <b.png> [--regions <f.json>] [--target 30] [--region-target 28] [--blur 1] [--diff-out <d.png>]  (judge: exit 2 when the frame or any region is below target; PNG only)';

export const MAX_PNG_BYTES = 64 * 1048576;
export const MAX_JSON_BYTES = 8 * 1048576;
export const MAX_PIXELS = 16_000_000;
export const MAX_REGIONS = 1000;
export const MAX_BLUR = 64;
export const DEFAULT_TARGET = 30;
export const DEFAULT_REGION_TARGET = 28;
export const DEFAULT_BLUR = 1;
const WEIGHTS = [0.299, 0.587, 0.114];
/** The smallest MSE used for a non-identical pair, so a difference the blur flattens never reads as identical (about 148 dB). */
const MIN_MSE = 1e-10;
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
  let idatBytes = 0, seenIdat = false;
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
    } else if (type === 'PLTE' || type === 'tRNS') {
      if (seenIdat) throw bad(`${name} has a ${type} chunk after its pixel data (IDAT); the chunks are out of order (damaged file)`);
      if (type === 'PLTE') plte = data; else trns = data;
    } else if (type === 'IDAT') { seenIdat = true; idat.push(data); idatBytes += len; if (idatBytes > MAX_PNG_BYTES) throw bad(`${name} is too large`); }
    else if (type === 'IEND') ended = true;
    // An unknown chunk whose first letter is uppercase is critical: the PNG spec says a decoder must refuse it.
    else if ((type.charCodeAt(0) & 0x20) === 0) throw bad(`${name} has an unknown critical chunk ${JSON.stringify(type)}; this decoder cannot interpret it`);
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
  idat.length = 0;
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
  raw = null; // free the filtered bytes before the RGBA buffer is allocated
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

/**
 * Separable box blur of radius r (window 2r+1, edges clamped) over interleaved 3-channel floats. r 0 returns the input.
 * Not used for scoring: a box window has exact spectral zeros (period 2r+1), so it can erase a real difference.
 */
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

/** Normalised gaussian kernel for blur radius r: sigma r/2, cut at ceil(3 sigma). Its spectrum has no zeros. */
export function gaussianKernel(r) {
  const sigma = r / 2, hw = Math.ceil(3 * sigma);
  const k = new Float64Array(2 * hw + 1);
  let s = 0;
  for (let i = -hw; i <= hw; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + hw] = v; s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

/**
 * Separable gaussian blur of radius r over interleaved 3-channel floats, edges clamped to the image. With `rect` only
 * that rectangle is computed (exactly as in a full blur) and a rect.w x rect.h buffer is returned; the rows it needs
 * around the rectangle are the only ones touched. r 0 on the full image returns the input.
 */
export function gaussianBlur(src, width, height, r, rect = null) {
  const R = rect || { x: 0, y: 0, w: width, h: height };
  if (r <= 0) {
    if (!rect) return src;
    const o = new Float32Array(R.w * R.h * 3);
    for (let y = 0; y < R.h; y++) o.set(src.subarray(((R.y + y) * width + R.x) * 3, ((R.y + y) * width + R.x + R.w) * 3), y * R.w * 3);
    return o;
  }
  const k = gaussianKernel(r), hw = (k.length - 1) / 2;
  const clamp = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  const ey0 = Math.max(0, R.y - hw), ey1 = Math.min(height, R.y + R.h + hw);
  const cw = R.w;
  let tmp = new Float32Array((ey1 - ey0) * cw * 3);
  for (let y = ey0; y < ey1; y++) {
    const row = y * width;
    for (let x = 0; x < cw; x++) {
      const X = R.x + x;
      let s0 = 0, s1 = 0, s2 = 0;
      for (let j = -hw; j <= hw; j++) { const w = k[j + hw], i = (row + clamp(X + j, width)) * 3; s0 += w * src[i]; s1 += w * src[i + 1]; s2 += w * src[i + 2]; }
      const o = ((y - ey0) * cw + x) * 3;
      tmp[o] = s0; tmp[o + 1] = s1; tmp[o + 2] = s2;
    }
  }
  const out = new Float32Array(R.h * cw * 3);
  for (let y = 0; y < R.h; y++) {
    const Y = R.y + y;
    for (let x = 0; x < cw; x++) {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let j = -hw; j <= hw; j++) { const w = k[j + hw], i = ((clamp(Y + j, height) - ey0) * cw + x) * 3; s0 += w * tmp[i]; s1 += w * tmp[i + 1]; s2 += w * tmp[i + 2]; }
      const o = (y * cw + x) * 3;
      out[o] = s0; out[o + 1] = s1; out[o + 2] = s2;
    }
  }
  tmp = null;
  return out;
}

/** Luminance-weighted mean squared error over a rectangle (image coordinates) of two float RGB images whose top-left pixel is (ox, oy). */
export function mseRect(a, b, width, rect, ox = 0, oy = 0) {
  let sum = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = ((y - oy) * width + (x - ox)) * 3;
      for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; sum += WEIGHTS[c] * d * d; }
    }
  }
  return sum / (rect.w * rect.h);
}

/** PSNR in dB from an MSE; Infinity when the error is zero. */
export const psnrOf = (mse) => (mse <= 0 ? Infinity : 10 * Math.log10((255 * 255) / mse));
/** PSNR from the blurred MSE, Infinity only when the raw pixels are identical (a flattened difference stays finite). */
const scoreOf = (rawMse, blurMse) => (rawMse <= 0 ? Infinity : psnrOf(Math.max(blurMse, MIN_MSE)));
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

const sameSize = (refImg, actImg) => {
  if (refImg.width !== actImg.width || refImg.height !== actImg.height) throw bad(`image sizes differ: ref is ${refImg.width}x${refImg.height}, actual is ${actImg.width}x${actImg.height}`);
};

/** Compare two decoded images. Returns the verb's result without diff_out. */
export function compare(refImg, actImg, opts = {}) {
  sameSize(refImg, actImg);
  const { width, height } = refImg;
  normalizeRegions(opts.regions || [], width, height, opts.regionTarget ?? DEFAULT_REGION_TARGET);
  return compareComposited(compositeOnWhite(refImg), compositeOnWhite(actImg), width, height, opts);
}

/** Compare two images already composited on white (float RGB). The blurred buffers are dropped as soon as they are scored. */
export function compareComposited(ref, act, width, height, { target = DEFAULT_TARGET, regionTarget = DEFAULT_REGION_TARGET, blur = DEFAULT_BLUR, regions = [] } = {}) {
  const rs = normalizeRegions(regions, width, height, regionTarget);
  const full = { x: 0, y: 0, w: width, h: height };
  const identical = mseRect(ref, act, width, full) === 0;
  let a = gaussianBlur(ref, width, height, blur), b = gaussianBlur(act, width, height, blur);
  const p = identical ? Infinity : scoreOf(1, mseRect(a, b, width, full));
  const out = rs.map((r) => {
    const rp = scoreOf(mseRect(ref, act, width, r), mseRect(a, b, width, r));
    return { id: r.id, psnr: report(rp), target: r.target, pass: passes(rp, r.target) };
  });
  a = b = null;
  const failing = rs.filter((_, i) => !out[i].pass);
  if (failing.length) {
    // Retry only the bounding box of the failing regions at triple blur (a diagnosis, never a rescue).
    const x0 = Math.min(...failing.map((r) => r.x)), y0 = Math.min(...failing.map((r) => r.y));
    const box = { x: x0, y: y0, w: Math.max(...failing.map((r) => r.x + r.w)) - x0, h: Math.max(...failing.map((r) => r.y + r.h)) - y0 };
    const k = Math.min(MAX_BLUR, blur > 0 ? blur * 3 : 3);
    const ha = gaussianBlur(ref, width, height, k, box), hb = gaussianBlur(act, width, height, k, box);
    rs.forEach((r, i) => {
      if (out[i].pass) return;
      out[i].structural_psnr = report(scoreOf(mseRect(ref, act, width, r), mseRect(ha, hb, box.w, r, box.x, box.y)));
    });
  }
  const frameOk = passes(p, target);
  const pass = frameOk && out.every((r) => r.pass);
  // `pass` is the verdict for the whole check (frame and every region); frame_pass says only the frame.
  const result = { psnr: report(p), target, pass, frame_pass: frameOk, identical, regions: out };
  if (!pass) result.exit = 2;
  return result;
}

/** Amplified (x4, clamped) absolute difference of the composited, unblurred images as an RGB PNG buffer. */
export function diffPng(refImg, actImg) {
  return diffPngComposited(compositeOnWhite(refImg), compositeOnWhite(actImg), refImg.width, refImg.height);
}
export function diffPngComposited(ref, act, width, height) {
  const px = new Uint8Array(ref.length);
  for (let i = 0; i < ref.length; i++) px[i] = Math.min(255, Math.round(Math.abs(ref[i] - act[i]) * 4));
  return encodePng(width, height, px, 3);
}

// ---- input and output ---------------------------------------------------------------------------------------

/**
 * Read a regular file with a bounded read of at most max + 1 bytes; returns { data, st } or throws KitExit 1. The file is
 * opened first (O_NONBLOCK, so a FIFO or device never blocks the open) and checked with fstat on that handle, so nothing
 * can be swapped in between the check and the read.
 */
export async function readRegular(file, flag, max) {
  // /dev and /proc paths are refused however they are spelled (also through a symlink), so /dev/stdin is refused even
  // when stdin is redirected from a regular file.
  let resolved;
  try { resolved = await fs.realpath(file); } catch { resolved = path.resolve(file); }
  for (const p of new Set([resolved, path.resolve(file)])) {
    if (/^\/(dev|proc)(\/|$)/.test(p.split(path.sep).join('/'))) throw bad(`${flag} ${file} is not a regular file`);
  }
  let fh;
  try { fh = await fs.open(file, FS.O_RDONLY | (FS.O_NONBLOCK || 0)); } catch (e) {
    // EISDIR: a directory (Windows); ENXIO: a socket, such as /dev/stdin when stdin is a socket pair.
    if (e.code === 'EISDIR' || e.code === 'ENXIO') throw bad(`${flag} ${file} is not a regular file`);
    throw bad(`cannot read ${flag} ${file}: ${e.code || e.message}`);
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw bad(`${flag} ${file} is not a regular file`);
    if (st.size > max) throw bad(`${flag} ${file} is larger than ${max} bytes`);
    const buf = Buffer.alloc(Math.min(st.size, max) + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    if (n > max) throw bad(`${flag} ${file} is larger than ${max} bytes`);
    return { data: buf.subarray(0, n), st };
  } finally { await fh.close(); }
}
/** readRegular, returning only the bytes. */
export async function readBounded(file, flag, max) { return (await readRegular(file, flag, max)).data; }

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
  const inputs = ['ref', 'actual', 'regions'].filter((k) => flags[k]).map((k) => ({ flag: `--${k}`, file: at(flags[k]) }));
  const diffOut = flags['diff-out'] ? at(flags['diff-out']) : null;
  const sameAsInput = (flag) => bad(`--diff-out ${diffOut} is the same file as ${flag}; refusing to overwrite an input`);
  for (const i of inputs) if (diffOut === i.file) throw sameAsInput(i.flag);
  // Decode, composite and drop each decoded image in turn, so at most one RGBA buffer is alive at a time.
  const load = async (i) => {
    const { data, st } = await readRegular(i.file, i.flag, MAX_PNG_BYTES);
    i.st = st;
    return decodePng(data, i.flag);
  };
  let refImg = await load(inputs[0]);
  const { width, height } = refImg;
  let ref = compositeOnWhite(refImg);
  refImg = null;
  let actImg = await load(inputs[1]);
  sameSize({ width, height }, actImg);
  let act = compositeOnWhite(actImg);
  actImg = null;
  let regions = [];
  if (flags.regions) {
    const { data, st } = await readRegular(inputs[2].file, '--regions', MAX_JSON_BYTES);
    inputs[2].st = st;
    try { regions = JSON.parse(data.toString('utf-8').replace(/^\uFEFF/, '')); } catch { throw bad('--regions is not valid JSON'); }
  }
  if (diffOut) {
    // A hard link (or another path) to an input is the same file too: compare device and inode.
    let ost = null;
    try { ost = await fs.stat(diffOut); } catch { /* absent or unreadable: the writer reports it */ }
    if (ost) for (const i of inputs) if (i.st && i.st.dev === ost.dev && i.st.ino === ost.ino) throw sameAsInput(i.flag);
  }
  const result = compareComposited(ref, act, width, height, { target, regionTarget, blur, regions });
  if (diffOut) {
    try {
      const png = diffPngComposited(ref, act, width, height);
      ref = act = null;
      await writeAtomic(diffOut, png);
      result.diff_out = diffOut;
    } catch (e) {
      // The verdict wins: a failing frame stays exit 2 whatever happened to the picture of it.
      if (result.exit !== 2) throw e;
      result.diff_out_error = e.message || String(e);
    }
  }
  return result;
}
