/**
 * type-scale — snap font sizes to the Tailwind default type scale. A size that is not exactly on a step drops to
 * the nearest step at or below it (below the smallest step: the smallest step) and takes that step's line height,
 * so size and line height never disagree. Pure and advisory: it reads a size or a CSS/markup file and reports.
 *
 *   type-scale snap --size <px|rem> [--root-px <n>]      → { step, size_px, line_height_px, changed }
 *   type-scale audit [--file <f>] [--root-px <n>]        → { changes: [{ line, from, to_step, size_px, line_height_px }], on_scale, skipped }
 *
 * A bare number is px; rem uses the root (default 16). audit reads `font-size` declarations (comments ignored) and
 * Tailwind arbitrary classes such as text-[15px]; var(), calc(), %, keywords and other units go to `skipped`.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'type-scale';
export const usage = 'cli.js type-scale snap --size <px|rem> [--root-px <n>] | audit [--file <css>] [--root-px <n>]  (advisory)';

export const SCALE = [
  ['xs', 12, 16], ['sm', 14, 20], ['base', 16, 24], ['lg', 18, 28], ['xl', 20, 28], ['2xl', 24, 32], ['3xl', 30, 36],
  ['4xl', 36, 40], ['5xl', 48, 48], ['6xl', 60, 60], ['7xl', 72, 72], ['8xl', 96, 96], ['9xl', 128, 128],
].map(([step, size_px, line_height_px]) => ({ step, size_px, line_height_px }));

const MAX_BYTES = 8 * 1024 * 1024;
const EPS = 1e-6;
const bad = m => new KitExit(m, 1);
const round = n => Math.round(n * 1000) / 1000;

function checkRoot(rootPx) {
  if (typeof rootPx !== 'number' || !Number.isFinite(rootPx) || rootPx <= 0) throw bad('--root-px must be a positive number');
  return rootPx;
}

/** A px or rem size (or bare px number) to pixels; anything else is exit 1. */
export function parseSize(value, rootPx = 16) {
  checkRoot(rootPx);
  let n, unit = 'px';
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const m = /^\s*(\d*\.?\d+)\s*(px|rem)?\s*$/i.exec(value);
    if (!m) throw bad(`size "${value}" must be a number with px or rem`);
    n = Number(m[1]); unit = (m[2] || 'px').toLowerCase();
  } else throw bad('size must be a number or a px/rem string');
  if (!Number.isFinite(n) || n <= 0) throw bad('size must be a positive finite number');
  return round(unit === 'rem' ? n * rootPx : n);
}

/** Snap a size down to the Tailwind step at or below it. */
export function snap(value, { rootPx = 16 } = {}) {
  const px = parseSize(value, rootPx);
  let hit = SCALE[0];
  for (const s of SCALE) if (s.size_px <= px + EPS) hit = s;
  return { step: hit.step, size_px: hit.size_px, line_height_px: hit.line_height_px, changed: Math.abs(hit.size_px - px) > EPS };
}

// Blank out comments but keep newlines so line numbers survive.
const stripComments = css => css.replace(/\/\*[\s\S]*?(\*\/|$)/g, m => m.replace(/[^\n]/g, ' '));

/** Audit CSS / markup text. Returns { changes, on_scale, skipped }. */
export function auditCss(text, { rootPx = 16 } = {}) {
  if (typeof text !== 'string') throw bad('audit input must be text');
  checkRoot(rootPx);
  const src = stripComments(text.replace(/^﻿/, ''));
  const hits = [];
  const decl = /(^|[;{\s"'])font-size\s*:\s*([^;}\n"']*)/gi;
  for (let m; (m = decl.exec(src));) hits.push({ idx: m.index + m[1].length, from: m[2].replace(/!\s*important\s*$/i, '').trim() });
  const cls = /(?<![\w-])text-\[([^\]\s]*)\]/g;
  for (let m; (m = cls.exec(src));) hits.push({ idx: m.index, from: m[0], value: m[1], arbitrary: true });
  hits.sort((a, b) => a.idx - b.idx);
  const changes = [], skipped = [];
  let onScale = 0, line = 1, pos = 0; // hits are sorted, so count newlines once, incrementally
  for (const h of hits) {
    for (let i = src.indexOf('\n', pos); i !== -1 && i < h.idx; i = src.indexOf('\n', pos)) { line++; pos = i + 1; }
    const value = h.arbitrary ? h.value.replace(/^length:/i, '') : h.from;
    if (!/^(\d*\.?\d+)(px|rem)$/i.test(value)) {
      // Arbitrary classes such as text-[#fff] are colours, not font sizes (text-[length:15px] is a size and is handled above); only report var()/calc() forms.
      if (h.arbitrary && !/^(var|calc|clamp|min|max)\(/i.test(value) && !/%$/.test(value)) continue;
      skipped.push({ line, value: h.from, reason: /^(var|calc|clamp|min|max)\(/i.test(value) ? 'dynamic value' : /%$/.test(value) ? 'percentage' : 'not a px or rem size' });
      continue;
    }
    const r = snap(value, { rootPx });
    if (r.changed) changes.push({ line, from: h.from, to_step: r.step, size_px: r.size_px, line_height_px: r.line_height_px });
    else onScale++;
  }
  return { changes, on_scale: onScale, skipped };
}

const VALUE = ['size', 'file', 'root-px'];
function parse(args) {
  const [sub, ...rest] = args;
  if (sub !== 'snap' && sub !== 'audit') throw bad(`first argument must be snap or audit\n${usage}`);
  const flags = {};
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"\n${usage}`);
    const k = a.slice(2);
    if (!VALUE.includes(k)) throw bad(`unknown flag --${k} (allowed: ${VALUE.map(f => `--${f}`).join(', ')})`);
    if (!rest.length || rest[0].startsWith('--')) throw bad(`--${k} needs a value`);
    if (flags[k] !== undefined) throw bad(`--${k} given more than once`);
    const v = rest.shift();
    if (v === '') throw bad(`--${k} needs a non-empty value`);
    flags[k] = v;
  }
  if (sub === 'snap' && flags.file !== undefined) throw bad('--file only applies to audit');
  if (sub === 'audit' && flags.size !== undefined) throw bad('--size only applies to snap');
  let rootPx = 16;
  if (flags['root-px'] !== undefined) {
    if (!/^\d*\.?\d+$/.test(flags['root-px'])) throw bad('--root-px must be a positive number');
    rootPx = checkRoot(Number(flags['root-px']));
  }
  return { sub, flags, rootPx };
}

export async function run(args, io) {
  const { sub, flags, rootPx } = parse(args);
  if (sub === 'snap') {
    if (flags.size === undefined) throw bad(`snap needs --size <px|rem>\n${usage}`);
    return snap(flags.size, { rootPx });
  }
  const cwd = io.cwd || process.cwd();
  let buf;
  if (flags.file !== undefined) {
    const file = path.resolve(cwd, flags.file);
    let fh;
    try {
      const st = await fs.stat(file);
      if (!st.isFile()) throw bad(`${file} is not a regular file`);
      if (st.size > MAX_BYTES) throw bad('input is larger than 8 MiB');
      fh = await fs.open(file, 'r');
      const b = Buffer.alloc(MAX_BYTES + 1);
      let n = 0;
      for (;;) {
        const { bytesRead } = await fh.read(b, n, b.length - n, null);
        if (!bytesRead) break;
        n += bytesRead;
        if (n >= b.length) break;
      }
      buf = b.subarray(0, n);
    } catch (e) {
      if (e instanceof KitExit) throw e;
      throw bad(`cannot read ${file}: ${e.code || e.message}`);
    } finally { if (fh) await fh.close().catch(() => {}); }
  } else {
    buf = typeof io.stdinBytes === 'function' ? await io.stdinBytes({ maxBytes: MAX_BYTES + 1 }) : Buffer.from(String(await io.stdin()), 'utf-8');
  }
  if (buf.length > MAX_BYTES) throw bad('input is larger than 8 MiB');
  const raw = buf.toString('utf-8');
  if (!raw.trim()) throw bad('no input: pass CSS on stdin or --file');
  return auditCss(raw, { rootPx });
}
