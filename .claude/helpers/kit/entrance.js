/**
 * entrance — give every element group an entrance from a fixed catalogue and lay the groups out on a timeline.
 * Pure: it reads a groups list (stdin or --file) and prints the timeline plus ready-to-paste CSS; it writes nothing.
 *
 *   entrance [--file <f>] [--stagger-ms 60] [--container-stagger-ms 120]   → { timeline, exit_order, css }
 *
 * Input: { groups: [{ id, kind, order, covered?, items?, override? }] }
 *   kind: card | text | icon | bar | rule | photo | chip | chart | other (see CATALOGUE below: each kind has a fixed
 *   from/to, duration and easing). order is the reading order (ties keep their input order). covered marks a group
 *   that sits under another layer: it enters after every uncovered group and leaves first. items is how many child
 *   elements the group staggers inside itself, by --stagger-ms each. override: { from?, to? } with keys opacity,
 *   y (px), blur (px), scale, scaleX, scaleY replaces single values of the catalogue entry.
 * Containers are staggered in reading order by --container-stagger-ms. A scale of 0 is allowed only on the one axis
 * a grow kind grows along (bar and rule on x, chart on y); everywhere else a catalogue or override scale must be
 * above 0, and an override that breaks that is refused (exit 1). Unknown keys, kinds, duplicate ids and negative
 * staggers are refused (exit 1). The CSS ends with a prefers-reduced-motion block that turns every animation off.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'entrance';
export const usage = 'cli.js entrance [--file <f>] [--stagger-ms 60] [--container-stagger-ms 120]  (groups JSON on stdin or --file; prints timeline, exit_order, css)';

export const MAX_BYTES = 8 * 1024 * 1024;
const MAX_GROUPS = 2000, MAX_ITEMS = 500, MAX_TOTAL_ITEMS = 20000, MAX_STAGGER = 60000;
const TOP_KEYS = ['groups'];
const GROUP_KEYS = ['id', 'kind', 'order', 'covered', 'items', 'override'];
const OVERRIDE_KEYS = ['from', 'to'];
const STATE_KEYS = ['opacity', 'y', 'blur', 'scale', 'scaleX', 'scaleY'];
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const NEUTRAL = { opacity: 1, y: 0, blur: 0, scale: 1, scaleX: 1, scaleY: 1 };
const OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** The catalogue as data. grow = the one axis (if any) whose scale may be 0; origin = transform-origin. */
export const CATALOGUE = {
  card:  { from: { opacity: 0, y: 16, blur: 8 }, to: { opacity: 1, y: 0, blur: 0 }, duration_ms: 600, easing: OUT },
  text:  { from: { opacity: 0, y: 6, blur: 2 }, to: { opacity: 1, y: 0, blur: 0 }, duration_ms: 500, easing: OUT },
  icon:  { from: { opacity: 0, scale: 0.9 }, to: { opacity: 1, scale: 1 }, duration_ms: 400, easing: OUT },
  bar:   { from: { scaleX: 0 }, to: { scaleX: 1 }, duration_ms: 500, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', grow: 'scaleX', origin: 'left center' },
  rule:  { from: { scaleX: 0 }, to: { scaleX: 1 }, duration_ms: 500, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', grow: 'scaleX', origin: 'left center' },
  photo: { from: { opacity: 0, blur: 12 }, to: { opacity: 1, blur: 0 }, mid: { opacity: 0.7, blur: 12 }, duration_ms: 800, easing: 'ease-out' },
  chip:  { from: { opacity: 0, y: 4 }, to: { opacity: 1, y: 0 }, duration_ms: 350, easing: OUT },
  chart: { from: { opacity: 0, scaleY: 0 }, to: { opacity: 1, scaleY: 1 }, duration_ms: 900, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', grow: 'scaleY', origin: 'center bottom' },
  other: { from: { opacity: 0 }, to: { opacity: 1 }, duration_ms: 400, easing: 'ease-out' },
};
export const KINDS = Object.keys(CATALOGUE);

const bad = m => new KitExit(m, 1);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const num = v => typeof v === 'number' && Number.isFinite(v);
const r2 = n => Math.round(n * 100) / 100;
function noUnknown(o, allowed, where) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw bad(`unknown key "${k}" in ${where} (allowed: ${allowed.join(', ')})`);
}

function checkState(state, kind, where) {
  if (!isObj(state)) throw bad(`${where} must be an object`);
  noUnknown(state, STATE_KEYS, where);
  const grow = CATALOGUE[kind].grow;
  for (const [k, v] of Object.entries(state)) {
    if (!num(v)) throw bad(`${where}.${k} must be a finite number`);
    if (k === 'opacity' && (v < 0 || v > 1)) throw bad(`${where}.opacity must be between 0 and 1`);
    if (k === 'blur' && v < 0) throw bad(`${where}.blur must be 0 or more`);
    if (k.startsWith('scale')) {
      if (k === grow ? v < 0 : v <= 0) throw bad(`${where}.${k} must be above 0${grow ? ` (only ${grow} may be 0 on a ${kind})` : ' (a scale of 0 is only allowed on the grow axis of bar, rule and chart)'}`);
    }
  }
  return state;
}

/** Validate the input; returns the groups in input order with the override merged into from/to. */
export function normalize(input) {
  if (!isObj(input)) throw bad('input must be a JSON object with a groups array');
  noUnknown(input, TOP_KEYS, 'input');
  if (!Array.isArray(input.groups)) throw bad('input.groups must be an array');
  if (input.groups.length > MAX_GROUPS) throw bad(`input.groups has more than ${MAX_GROUPS} entries`);
  const seen = new Set();
  let totalItems = 0;
  return input.groups.map((g, i) => {
    const where = `groups[${i}]`;
    if (!isObj(g)) throw bad(`${where} must be an object`);
    noUnknown(g, GROUP_KEYS, where);
    if (typeof g.id !== 'string' || !ID_RE.test(g.id)) throw bad(`${where}.id must be a string of letters, digits, hyphen or underscore, starting with a letter (max 64)`);
    if (seen.has(g.id)) throw bad(`${where}.id "${g.id}" is a duplicate`);
    seen.add(g.id);
    if (typeof g.kind !== 'string' || !Object.hasOwn(CATALOGUE, g.kind)) throw bad(`${where}.kind must be one of ${KINDS.join(', ')}`);
    if (!num(g.order)) throw bad(`${where}.order must be a finite number`);
    if (g.covered !== undefined && typeof g.covered !== 'boolean') throw bad(`${where}.covered must be a boolean`);
    if (g.items !== undefined && !(Number.isInteger(g.items) && g.items >= 0 && g.items <= MAX_ITEMS)) throw bad(`${where}.items must be an integer from 0 to ${MAX_ITEMS}`);
    totalItems += g.items || 0;
    if (totalItems > MAX_TOTAL_ITEMS) throw bad(`groups hold more than ${MAX_TOTAL_ITEMS} items in total`);
    const cat = CATALOGUE[g.kind];
    let from = { ...cat.from }, to = { ...cat.to };
    if (g.override !== undefined) {
      if (!isObj(g.override)) throw bad(`${where}.override must be an object`);
      noUnknown(g.override, OVERRIDE_KEYS, `${where}.override`);
      if (g.override.from !== undefined) from = { ...from, ...checkState(g.override.from, g.kind, `${where}.override.from`) };
      if (g.override.to !== undefined) to = { ...to, ...checkState(g.override.to, g.kind, `${where}.override.to`) };
    }
    return { id: g.id, kind: g.kind, order: g.order, covered: g.covered === true, items: g.items || 0, from, to, mid: cat.mid };
  });
}

/** Build the timeline. Entrance order: uncovered groups by `order`, then covered groups by `order`; ties keep input order. */
export function plan(input, { staggerMs = 60, containerStaggerMs = 120 } = {}) {
  const groups = normalize(input).map((g, idx) => ({ ...g, idx }));
  const seq = [...groups].sort((a, b) => (a.covered - b.covered) || (a.order - b.order) || (a.idx - b.idx));
  const timeline = seq.map((g, pos) => {
    const cat = CATALOGUE[g.kind];
    const delay = r2(pos * containerStaggerMs);
    const t = { id: g.id, kind: g.kind, delay_ms: delay, duration_ms: cat.duration_ms, from: g.from, to: g.to, easing: cat.easing };
    if (g.covered) t.covered = true;
    if (g.items) {
      t.items = g.items;
      t.item_delays_ms = Array.from({ length: g.items }, (_, k) => r2(delay + k * staggerMs));
    }
    return t;
  });
  return { timeline, exit_order: seq.map(g => g.id).reverse(), css: buildCss(seq, timeline) };
}

const px = n => `${r2(n)}px`;
function stateCss(s, keys) {
  const v = k => (s[k] === undefined ? NEUTRAL[k] : s[k]);
  const out = [];
  if (keys.has('opacity')) out.push(`opacity: ${v('opacity')}`);
  const tf = [];
  if (keys.has('y')) tf.push(`translateY(${px(v('y'))})`);
  if (keys.has('scale')) tf.push(`scale(${v('scale')})`);
  if (keys.has('scaleX')) tf.push(`scaleX(${v('scaleX')})`);
  if (keys.has('scaleY')) tf.push(`scaleY(${v('scaleY')})`);
  if (tf.length) out.push(`transform: ${tf.join(' ')}`);
  if (keys.has('blur')) out.push(`filter: blur(${px(v('blur'))})`);
  return out.join('; ');
}

function buildCss(seq, timeline) {
  const lines = ['/* entrance: put data-entrance="<id>" on each group; its direct children are the staggered items */'];
  seq.forEach((g, i) => {
    const t = timeline[i], cat = CATALOGUE[g.kind];
    const keys = new Set([...Object.keys(g.from), ...Object.keys(g.to), ...(g.mid ? Object.keys(g.mid) : [])]);
    const name = `ent-${g.id}`;
    lines.push(`@keyframes ${name} {`, `  0% { ${stateCss(g.from, keys)} }`);
    if (g.mid) lines.push(`  40% { ${stateCss(g.mid, keys)} }`);
    lines.push(`  100% { ${stateCss(g.to, keys)} }`, '}');
    const sel = `[data-entrance="${g.id}"]`;
    const anim = `animation: ${name} ${t.duration_ms}ms ${t.easing} both`;
    const origin = cat.origin ? `; transform-origin: ${cat.origin}` : '';
    if (g.items) {
      lines.push(`${sel} { animation: none }`); // the group itself holds still; its children enter
      t.item_delays_ms.forEach((d, k) => lines.push(`${sel} > :nth-child(${k + 1}) { ${anim}; animation-delay: ${d}ms${origin} }`));
    } else lines.push(`${sel} { ${anim}; animation-delay: ${t.delay_ms}ms${origin} }`);
  });
  lines.push('@media (prefers-reduced-motion: reduce) {',
    '  [data-entrance], [data-entrance] > * { animation: none !important; opacity: 1 !important; transform: none !important; filter: none !important }',
    '}');
  return lines.join('\n') + '\n';
}

// ---- CLI ----

const VALUE = ['file', 'stagger-ms', 'container-stagger-ms'];

function parse(args) {
  const flags = {};
  const rest = [...args];
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"\n${usage}`);
    const k = a.slice(2);
    if (!VALUE.includes(k)) throw bad(`unknown flag --${k} (allowed: ${VALUE.map(f => `--${f}`).join(', ')})`);
    if (Object.hasOwn(flags, k)) throw bad(`--${k} given more than once`);
    if (!rest.length || rest[0].startsWith('--')) throw bad(`--${k} needs a value`);
    const v = rest.shift();
    if (v === '') throw bad(`--${k} must not be empty`);
    flags[k] = v;
  }
  const stagger = (k, d) => {
    if (flags[k] === undefined) return d;
    if (!/^-?\d+(\.\d+)?$/.test(flags[k])) throw bad(`--${k} must be a number of milliseconds, got ${JSON.stringify(flags[k])}`);
    const n = Number(flags[k]);
    if (n < 0) throw bad(`--${k} must not be negative`);
    if (n > MAX_STAGGER) throw bad(`--${k} must be at most ${MAX_STAGGER}`);
    return n;
  };
  return { file: flags.file, staggerMs: stagger('stagger-ms', 60), containerStaggerMs: stagger('container-stagger-ms', 120) };
}

async function readFileBounded(file, cwd) {
  const p = path.resolve(cwd, file);
  const banned = x => x === '/dev' || x === '/proc' || x.startsWith('/dev/') || x.startsWith('/proc/');
  if (banned(p)) throw bad(`--file ${file} is not a regular file (device and /proc paths are refused)`);
  const real = await fs.realpath(p).catch(e => { throw bad(`cannot read ${p}: ${e.code || e.message}`); });
  if (banned(real)) throw bad(`--file ${file} is not a regular file (device and /proc paths are refused)`);
  const fh = await fs.open(real, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK).catch(e => { throw bad(`cannot read ${p}: ${e.code || e.message}`); });
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw bad(`--file ${file} is not a regular file`);
    const buf = Buffer.alloc(MAX_BYTES + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    if (n > MAX_BYTES) throw bad(`input is larger than ${MAX_BYTES} bytes`);
    return buf.subarray(0, n);
  } finally { await fh.close(); }
}

export async function run(args, io = {}) {
  const { file, staggerMs, containerStaggerMs } = parse(args);
  let buf;
  if (file !== undefined) buf = await readFileBounded(file, io.cwd || process.cwd());
  else {
    if (io.stdinIsTTY) throw bad('no input: pass groups JSON on stdin or --file');
    const read = typeof io.stdinBytes === 'function' ? io.stdinBytes : io.stdin;
    buf = await read({ maxBytes: MAX_BYTES + 1 });
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(String(buf), 'utf-8');
    if (buf.length > MAX_BYTES) throw bad(`input is larger than ${MAX_BYTES} bytes`);
  }
  const text = buf.toString('utf-8').replace(/^﻿/, '');
  if (!text.trim()) throw bad('no input: pass groups JSON on stdin or --file');
  let data;
  try { data = JSON.parse(text); } catch { throw bad('input is not valid JSON'); }
  return plan(data, { staggerMs, containerStaggerMs });
}
