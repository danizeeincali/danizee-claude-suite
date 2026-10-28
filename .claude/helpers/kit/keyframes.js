/**
 * keyframes — a small, pure keyframe engine for looping in-page "stories". Each visual gets a one-sentence story
 * built from eased keyframe tracks; every track is evaluated against ONE shared loop clock, starts and ends on the
 * exact design state (same value at t=0 and t=loop_ms, so the loop is seamless), and stories on different cards
 * are offset so they do not act in unison.
 *
 *   keyframes check --file <f>          → { ok, findings, warnings }   (exit 0; ok:false when there are findings)
 *   keyframes sample --file <f> --at <ms> → { at_ms, loop_ms, values: { <story id>: { <prop>: number|number[] } } }
 *   keyframes emit                      → { raw }  a standalone ES module: evaluate, ease, createLoop
 *   keyframes patterns                  → { patterns: [...] }  the story pattern menu as data
 *
 * Input: { loop_ms, stories: [{ id, card, pattern, sentence, offset_ms?, tracks: { <prop>: [{ t, v, ease? }] } }] }
 * A keyframe's `ease` shapes the segment that starts at that keyframe: "linear" | "in" | "out" | "in-out" or a
 * cubic-bezier [x1, y1, x2, y2] (x1 and x2 within 0..1). A story's local time is (clock + offset_ms) mod loop_ms.
 * Unknown keys, wrong types, arrays of different lengths inside one track and bad beziers exit 1 naming the field;
 * design-rule breaks (track start/end, end value, time order, multi-sentence story, unison offsets) are findings.
 * Input is a regular file (bounded read) or stdin (byte-counted), at most 8 MiB; work is linear in the input.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import fsc from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'keyframes';
export const usage = 'cli.js keyframes check --file <f> | sample --file <f> --at <ms> | emit | patterns  (input JSON on stdin or --file, at most 8 MiB)';

export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_DEPTH = 16;
export const PATTERNS = [
  { name: 'stack-landing', story: 'A new item drops onto the stack and the older ones settle down a step.', props: ['y', 'opacity', 'scale'], ease: 'out' },
  { name: 'scrubber-glide', story: 'The chart scrubber glides across the plot and rests where it started.', props: ['x'], ease: 'in-out' },
  { name: 'donut-ease-out', story: 'One donut segment eases outward, holds, then eases back into the ring.', props: ['offset', 'scale'], ease: 'out' },
  { name: 'typed-prompt', story: 'The prompt is typed glyph by glyph, then clears for the next pass.', props: ['chars'], ease: 'linear' },
  { name: 'marquee-one-set', story: 'The marquee moves exactly one full set of items and wraps without a jump.', props: ['x'], ease: 'linear' },
  { name: 'counter-tick', story: 'The counter ticks up to its figure and falls back to the starting number.', props: ['value'], ease: 'out' },
  { name: 'pulse-highlight', story: 'The highlighted element pulses once and returns to rest.', props: ['glow', 'scale'], ease: 'in-out' },
];
const PATTERN_NAMES = PATTERNS.map(p => p.name);
const EASE_NAMES = ['linear', 'in', 'out', 'in-out'];

const bad = m => new KitExit(m, 1);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- engine (these functions are also emitted verbatim by `emit`, so they must not use anything outside themselves) ----

function bezierEase(x1, y1, x2, y2, u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = s => ((ax * s + bx) * s + cx) * s;
  const dX = s => (3 * ax * s + 2 * bx) * s + cx;
  let s = u;
  for (let i = 0; i < 8; i++) {
    const err = X(s) - u;
    if (Math.abs(err) < 1e-9) return ((ay * s + by) * s + cy) * s;
    const d = dX(s);
    if (Math.abs(d) < 1e-7) break;
    s -= err / d;
  }
  let lo = 0, hi = 1;
  s = u;
  for (let i = 0; i < 60; i++) {
    const x = X(s);
    if (Math.abs(x - u) < 1e-9) break;
    if (x < u) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }
  return ((ay * s + by) * s + cy) * s;
}

function ease(kind, u) {
  if (kind === undefined || kind === 'linear') return u <= 0 ? 0 : u >= 1 ? 1 : u;
  if (kind === 'in') return bezierEase(0.42, 0, 1, 1, u);
  if (kind === 'out') return bezierEase(0, 0, 0.58, 1, u);
  if (kind === 'in-out') return bezierEase(0.42, 0, 0.58, 1, u);
  if (Array.isArray(kind) && kind.length === 4) return bezierEase(kind[0], kind[1], kind[2], kind[3], u);
  throw new Error('unknown ease');
}

function evaluate(track, t, loop_ms) {
  if (loop_ms > 0) t = ((t % loop_ms) + loop_ms) % loop_ms;
  const n = track.length;
  if (t <= track[0].t) return Array.isArray(track[0].v) ? track[0].v.slice() : track[0].v;
  const last = track[n - 1];
  if (t >= last.t) return Array.isArray(last.v) ? last.v.slice() : last.v;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = track[lo], b = track[hi];
  const span = b.t - a.t;
  if (!(span > 0)) return Array.isArray(b.v) ? b.v.slice() : b.v;
  const e = ease(a.ease, (t - a.t) / span);
  if (Array.isArray(a.v)) return a.v.map((x, i) => x + (b.v[i] - x) * e);
  return a.v + (b.v - a.v) * e;
}

function createLoop(stories, opts) {
  opts = opts || {};
  const L = opts.loop_ms;
  if (typeof L !== 'number' || !Number.isFinite(L) || L <= 0) throw new Error('createLoop needs opts.loop_ms, a positive number of milliseconds');
  const now = opts.now || (() => performance.now());
  const raf = opts.raf || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
  const caf = opts.caf || (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null);
  let t0 = null, handle = null, running = false;
  const read = at => {
    if (at === undefined) {
      if (t0 === null) t0 = now();
      at = now() - t0;
    }
    const out = {};
    for (const s of stories) {
      const local = at + (s.offset_ms || 0);
      const vals = {};
      for (const prop of Object.keys(s.tracks)) Object.defineProperty(vals, prop, { value: evaluate(s.tracks[prop], local, L), enumerable: true, writable: true, configurable: true });
      Object.defineProperty(out, s.id, { value: vals, enumerable: true, writable: true, configurable: true });
    }
    return out;
  };
  const start = onFrame => {
    if (running) return;
    running = true;
    t0 = now();
    const frame = () => {
      if (!running) return;
      if (onFrame) {
        try { onFrame(read()); } catch (e) { running = false; handle = null; throw e; }
      }
      if (raf) handle = raf(frame);
    };
    frame();
  };
  const stop = () => {
    running = false;
    if (handle !== null && caf) caf(handle);
    handle = null;
  };
  return { read, start, stop, loop_ms: L };
}

export { ease, evaluate, createLoop };

/** The standalone module `emit` returns: our own engine, no dependencies. */
export function emitModule() {
  const header = '// Keyframe engine: eased tracks on one shared loop clock.\n'
    + '// evaluate(track, t, loop_ms): track is [{t, v, ease?}], v a number or number[]; t wraps by loop_ms.\n'
    + '// createLoop(stories, {loop_ms, now, raf}) -> {read(at?), start(onFrame), stop()}; stories are {id, offset_ms?, tracks}.\n';
  return header + [bezierEase, ease, evaluate, createLoop].map((f, i) => (i === 0 ? '' : 'export ') + f.toString()).join('\n\n') + '\n';
}

// ---- input ----

function checkDepth(text) {
  let depth = 0, inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inStr) {
      if (c === 92) i++;
      else if (c === 34) inStr = false;
    } else if (c === 34) inStr = true;
    else if (c === 91 || c === 123) { if (++depth > MAX_DEPTH) throw bad(`input is nested deeper than ${MAX_DEPTH} levels`); }
    else if (c === 93 || c === 125) depth--;
  }
}

function parseJson(buf, what) {
  if (buf.length > MAX_BYTES) throw bad(`${what} is larger than ${MAX_BYTES} bytes`);
  let text = buf.toString('utf-8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) throw bad('no input: pass the keyframes JSON on stdin or with --file');
  checkDepth(text);
  try { return JSON.parse(text); } catch (e) { throw bad(`${what} is not valid JSON: ${e.message}`); }
}

async function readFileBounded(file, cwd) {
  const p = path.resolve(cwd, file);
  const under = q => q.startsWith('/dev/') || q.startsWith('/proc/') || q === '/dev' || q === '/proc';
  let real = p;
  try { real = fsc.realpathSync(p); } catch {}
  if (under(p) || under(real)) throw bad(`--file ${file}: devices and /proc paths are refused`);
  let fh;
  try { fh = await fs.open(p, fsc.constants.O_RDONLY | fsc.constants.O_NONBLOCK); } catch (e) { throw bad(`cannot open --file ${file}: ${e.code || e.message}`); }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw bad(`--file ${file} is not a regular file`);
    const buf = Buffer.alloc(MAX_BYTES + 1);
    let got = 0;
    while (got < buf.length) {
      const { bytesRead } = await fh.read(buf, got, buf.length - got, null);
      if (!bytesRead) break;
      got += bytesRead;
    }
    return buf.subarray(0, got);
  } finally { await fh.close(); }
}

async function readInput(flags, io) {
  if (flags.file !== undefined) return parseJson(await readFileBounded(flags.file, io.cwd || process.cwd()), `--file ${flags.file}`);
  if (io.stdinIsTTY) throw bad('no input: stdin is a terminal; pass the keyframes JSON on stdin or with --file');
  let buf;
  if (typeof io.stdinBytes === 'function') buf = await io.stdinBytes({ maxBytes: MAX_BYTES + 1 });
  else buf = Buffer.from(String(await io.stdin({ maxBytes: MAX_BYTES + 1 })), 'utf-8');
  return parseJson(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), 'stdin');
}

function noUnknown(o, allowed, where) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw bad(`unknown key "${k}" in ${where} (allowed: ${allowed.join(', ')})`);
}
const isNum = v => typeof v === 'number' && Number.isFinite(v);

function normEase(e, where) {
  if (e === undefined) return undefined;
  if (typeof e === 'string') {
    if (!EASE_NAMES.includes(e)) throw bad(`${where}.ease "${e}" is not one of ${EASE_NAMES.join(', ')} or a cubic-bezier [x1,y1,x2,y2]`);
    return e;
  }
  if (!Array.isArray(e) || e.length !== 4 || !e.every(isNum)) throw bad(`${where}.ease must be a name or four finite numbers [x1,y1,x2,y2]`);
  if (e[0] < 0 || e[0] > 1 || e[2] < 0 || e[2] > 1) throw bad(`${where}.ease x1 and x2 must be within 0..1`);
  return e.slice();
}

/** Validate one track's shape (values of one kind and length, finite times); order is a finding, not an error. */
export function normalizeTrack(track, where) {
  if (!Array.isArray(track) || !track.length) throw bad(`${where} must be a non-empty array of keyframes`);
  const width = Array.isArray(track[0] && track[0].v) ? track[0].v.length : null;
  return track.map((k, i) => {
    const w = `${where}[${i}]`;
    if (!isObj(k)) throw bad(`${w} must be an object`);
    noUnknown(k, ['t', 'v', 'ease'], w);
    if (!isNum(k.t) || k.t < 0) throw bad(`${w}.t must be a finite number of milliseconds, 0 or more`);
    let v;
    if (Array.isArray(k.v)) {
      if (!k.v.length || !k.v.every(isNum)) throw bad(`${w}.v must be a number or a non-empty array of finite numbers`);
      if (width === null) throw bad(`${w}.v is an array but ${where}[0].v is a number`);
      if (k.v.length !== width) throw bad(`${w}.v has ${k.v.length} components but ${where}[0].v has ${width}`);
      v = k.v.slice();
    } else {
      if (!isNum(k.v)) throw bad(`${w}.v must be a number or a non-empty array of finite numbers`);
      if (width !== null) throw bad(`${w}.v is a number but ${where}[0].v is an array`);
      v = k.v;
    }
    const out = { t: k.t, v };
    const e = normEase(k.ease, w);
    if (e !== undefined) out.ease = e;
    return out;
  });
}

export function normalize(input) {
  if (!isObj(input)) throw bad('input must be a JSON object with loop_ms and stories');
  noUnknown(input, ['loop_ms', 'stories'], 'input');
  if (!isNum(input.loop_ms) || input.loop_ms <= 0) throw bad('input.loop_ms must be a positive number of milliseconds');
  if (!Array.isArray(input.stories)) throw bad('input.stories must be an array');
  const ids = new Set();
  const stories = input.stories.map((s, i) => {
    const where = `stories[${i}]`;
    if (!isObj(s)) throw bad(`${where} must be an object`);
    noUnknown(s, ['id', 'card', 'pattern', 'sentence', 'offset_ms', 'tracks'], where);
    for (const k of ['id', 'card']) if (typeof s[k] !== 'string' || !s[k]) throw bad(`${where}.${k} must be a non-empty string`);
    if (ids.has(s.id)) throw bad(`${where}.id "${s.id}" is used twice`);
    ids.add(s.id);
    if (!PATTERN_NAMES.includes(s.pattern)) throw bad(`${where}.pattern must be one of ${PATTERN_NAMES.join(', ')}`);
    if (typeof s.sentence !== 'string') throw bad(`${where}.sentence must be a string`);
    if (s.offset_ms !== undefined && (!isNum(s.offset_ms) || s.offset_ms < 0)) throw bad(`${where}.offset_ms must be a finite number, 0 or more`);
    if (!isObj(s.tracks) || !Object.keys(s.tracks).length) throw bad(`${where}.tracks must be an object with at least one property track`);
    const tracks = Object.create(null);
    for (const prop of Object.keys(s.tracks)) tracks[prop] = normalizeTrack(s.tracks[prop], `${where}.tracks.${prop}`);
    return { id: s.id, card: s.card, pattern: s.pattern, sentence: s.sentence, offset_ms: s.offset_ms || 0, tracks };
  });
  return { loop_ms: input.loop_ms, stories };
}

// ---- check ----

const ABBREV = new Set(['dr', 'mr', 'mrs', 'ms', 'vs', 'e.g', 'i.e', 'etc', 'approx', 'no', 'st']);
function lastWord(s, i) {
  let a = i;
  while (a > 0 && !/\s/.test(s[a - 1])) a--;
  return s.slice(a, i).toLowerCase();
}

/** Count sentences in one pass: a ./!/? run followed by whitespace and more text starts a new one. */
export function sentenceCount(text) {
  const s = text.trim();
  if (!s) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '.' && c !== '!' && c !== '?') continue;
    let j = i + 1;
    while (j < s.length && (s[j] === '.' || s[j] === '!' || s[j] === '?')) j++;
    let k = j;
    while (k < s.length && /\s/.test(s[k])) k++;
    if (k > j && k < s.length && !/\p{Ll}/u.test(s[k]) && !ABBREV.has(lastWord(s, i))) n++;
    i = j - 1;
  }
  return n;
}

const sameValue = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b);

export function check(input) {
  const { loop_ms, stories } = normalize(input);
  const findings = [], warnings = [];
  const add = (story, prop, rule, message) => findings.push(prop === null ? { story, rule, message } : { story, prop, rule, message });
  for (const s of stories) {
    const count = sentenceCount(s.sentence);
    if (count === 0) add(s.id, null, 'sentence-empty', `story "${s.id}": sentence is empty; write one sentence`);
    else if (count > 1) add(s.id, null, 'sentence-not-single', `story "${s.id}": sentence has ${count} sentences; a story is exactly one`);
    for (const prop of Object.keys(s.tracks)) {
      const tr = s.tracks[prop];
      const first = tr[0], last = tr[tr.length - 1];
      if (first.t !== 0) add(s.id, prop, 'track-start', `story "${s.id}" track "${prop}" starts at ${first.t} ms, not 0`);
      if (last.t !== loop_ms) add(s.id, prop, 'track-end', `story "${s.id}" track "${prop}" ends at ${last.t} ms, not loop_ms (${loop_ms})`);
      if (!sameValue(first.v, last.v)) add(s.id, prop, 'end-differs-from-start', `story "${s.id}" track "${prop}" ends on a different value than it starts, so the loop jumps at the seam`);
      for (let i = 1; i < tr.length; i++) {
        if (!(tr[i].t > tr[i - 1].t)) { add(s.id, prop, 'time-not-increasing', `story "${s.id}" track "${prop}" keyframe ${i} (t=${tr[i].t}) is not after keyframe ${i - 1} (t=${tr[i - 1].t})`); break; }
      }
    }
  }
  const byOffset = new Map();
  for (const s of stories) {
    const phase = ((s.offset_ms % loop_ms) + loop_ms) % loop_ms;
    if (!byOffset.has(phase)) byOffset.set(phase, []);
    byOffset.get(phase).push(s);
  }
  for (const [offset, group] of byOffset) {
    const cards = [...new Set(group.map(s => s.card))];
    if (cards.length > 1) warnings.push({ rule: 'unison', stories: group.map(s => s.id), message: `stories ${group.map(s => `"${s.id}"`).join(', ')} on cards ${cards.map(c => `"${c}"`).join(', ')} share loop phase ${offset} ms (offset_ms modulo loop_ms): the cards act in unison; give each its own offset_ms` });
  }
  return { ok: findings.length === 0, findings, warnings };
}

export function sample(input, at) {
  const { loop_ms, stories } = normalize(input);
  const values = {};
  for (const s of stories) {
    const vals = {};
    for (const prop of Object.keys(s.tracks)) {
      const tr = s.tracks[prop];
      for (let i = 1; i < tr.length; i++) if (!(tr[i].t > tr[i - 1].t)) throw bad(`story "${s.id}" track "${prop}": keyframe times must be strictly increasing (keyframe ${i} t=${tr[i].t} is not after t=${tr[i - 1].t}); run check`);
    }
    for (const prop of Object.keys(s.tracks)) Object.defineProperty(vals, prop, { value: evaluate(s.tracks[prop], at + s.offset_ms, loop_ms), enumerable: true, writable: true, configurable: true });
    Object.defineProperty(values, s.id, { value: vals, enumerable: true, writable: true, configurable: true });
  }
  return { at_ms: at, loop_ms, values };
}

// ---- CLI ----

const VALUE_FLAGS = { check: ['file'], sample: ['file', 'at'], emit: [], patterns: [] };

function parse(args) {
  const rest = [...args];
  const sub = rest.shift();
  if (!sub || !Object.hasOwn(VALUE_FLAGS, sub)) throw bad(`keyframes needs a sub-command: check, sample, emit or patterns\n${usage}`);
  const flags = {};
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"\n${usage}`);
    const k = a.slice(2);
    if (!VALUE_FLAGS[sub].includes(k)) throw bad(`unknown flag --${k} for ${sub} (allowed: ${VALUE_FLAGS[sub].map(f => `--${f}`).join(', ') || 'none'})`);
    if (Object.hasOwn(flags, k)) throw bad(`--${k} given more than once`);
    if (!rest.length || rest[0].startsWith('--')) throw bad(`--${k} needs a value`);
    const v = rest.shift();
    if (v === '') throw bad(`--${k} must not be empty`);
    flags[k] = v;
  }
  if (sub === 'sample') {
    if (flags.at === undefined) throw bad('sample needs --at <ms>');
    const at = Number(flags.at);
    if (!/^-?\d+(\.\d+)?$/.test(flags.at) || !Number.isFinite(at)) throw bad('--at must be a number of milliseconds');
    flags.at = at;
  }
  return { sub, flags };
}

export async function run(args, io) {
  const { sub, flags } = parse(args);
  if (sub === 'patterns') return { patterns: PATTERNS.map(p => ({ ...p, props: [...p.props] })) };
  if (sub === 'emit') return { raw: emitModule() };
  const input = await readInput(flags, io || {});
  return sub === 'check' ? check(input) : sample(input, flags.at);
}
