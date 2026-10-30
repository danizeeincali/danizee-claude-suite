/**
 * visual-direction — decide whether a screen needs a visual, check the visual is written as one plain sentence,
 * and turn that sentence into an image prompt plus placement notes. Pure and read-only: it never writes and
 * never touches the network. Input is one JSON object, from --file <context.json> or stdin (at most 8 MiB).
 *
 *   visual-direction decide [--file <ctx.json>]
 *       ctx { screen: "landing"|"dashboard"|"app"|"empty-state", has_product_ui: bool, works_without_visual: bool,
 *             slot?: "hero"|"empty-state"|"section", direction?: { world, character } }
 *       → { needed, kind: "product-shot"|"scene"|"object"|"none", slot, why, next, direction? }
 *       Rules, in order: a screen that does not work without the visual yet gets none (make it work first);
 *       dashboards and apps get none unless the slot is an empty state; a product with a UI shows the product
 *       (product-shot, never an abstract blob); otherwise a hero gets a scene and any other slot a single object,
 *       both drawn from direction.world.
 *   visual-direction sentence [--file <ctx.json>]
 *       ctx { sentence }
 *       → { ok, sentence, words, problems: [{ id, message }], hints: [string] }
 *       One sentence, at most 30 words, no banned style words (stunning, futuristic, abstract, glowing, 3D blob,
 *       gradient, neon, cyberpunk, sleek, cinematic, 8k, trending) and a concrete subject. Problems are advisory
 *       (exit 0); hints say whether a setting and a light are named.
 *   visual-direction prompt [--file <ctx.json>]
 *       ctx { sentence, style: "photo"|"illustration"|"render"|"collage", palette: [hex, 1..6],
 *             aspect: "16:9"|"4:3"|"1:1"|"3:4", avoid?: [string], light?: string,
 *             headline_side?: "left"|"right" (default left), radius_px?: number, display_width?: number }
 *       → { prompt, negative, aspect, size: { w, h }, placement }
 *       The prompt has fixed parts: subject sentence, style line, palette (color word plus hex), light,
 *       composition (the subject on the side away from the headline, calm space under the headline), aspect.
 *       size is the aspect's default (16:9 is 1600x900) or, with display_width, twice that width.
 *       negative is the avoid list: text, logos, watermarks, glows, gradients, extra fingers and your additions.
 *       placement: object-fit cover, object-position, radius, alt text from the sentence, an edge fade into the
 *       page color done in code, and the display size. The sentence must pass the sentence check, else exit 1.
 *
 * Exit codes: 0 answer printed; 1 bad input (unknown subcommand or flag, duplicate flag, missing, unreadable,
 * binary, oversize or non-object input, invalid field; message on stderr, nothing on stdout).
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import fs from 'fs/promises';
import { constants as fsc, fstatSync } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'visual-direction';
export const usage = 'cli.js visual-direction decide | sentence | prompt [--file <context.json>]  (JSON on stdin or --file; advisory, exit 0)';

const MAX_BYTES = 8 * 1024 * 1024;
const bad = m => new KitExit(m, 1);

const SCREENS = ['landing', 'dashboard', 'app', 'empty-state'];
const SLOTS = ['hero', 'empty-state', 'section'];
const STYLES = ['photo', 'illustration', 'render', 'collage'];
export const SIZES = { '16:9': { w: 1600, h: 900 }, '4:3': { w: 1600, h: 1200 }, '1:1': { w: 1200, h: 1200 }, '3:4': { w: 1200, h: 1600 } };
const STYLE_LINE = {
  photo: 'natural photograph, real materials, shallow depth of field',
  illustration: 'hand-made illustration, flat painted shapes, visible brush texture, one consistent line weight',
  render: 'clean studio render of a single object, soft shadow, matte materials',
  collage: 'paper collage, cut edges, layered flat shapes, printed texture',
};
const DEFAULT_LIGHT = {
  photo: 'soft window daylight from one side',
  illustration: 'warm low sun from one side with a long soft shadow',
  render: 'one large softbox from the upper side, gentle falloff',
  collage: 'even flat light with a faint shadow under each paper layer',
};
const BASE_NEGATIVE = ['text', 'letters', 'logos', 'watermarks', 'glows', 'gradients', 'extra fingers', 'multiple subjects', 'film grain', 'hard rectangular border'];

export const BANNED = ['stunning', 'futuristic', 'abstract', '3d blob', 'glowing', 'gradient', 'neon', 'cyberpunk', 'sleek', 'cinematic', '8k', 'trending'];
const VAGUE = new Set(['something', 'thing', 'things', 'stuff', 'vibe', 'vibes', 'feeling', 'idea', 'concept', 'mood', 'energy', 'innovation', 'technology', 'future', 'visual', 'image', 'picture', 'background']);
const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'by', 'with', 'and', 'or', 'to', 'from', 'for', 'into', 'onto', 'over', 'under', 'near', 'its', 'their', 'his', 'her', 'is', 'are', 'as', 'that', 'this', 'one', 'two', 'some', 'very', 'soft', 'warm', 'cool', 'light', 'new', 'big', 'small', 'large', 'little', 'beautiful', 'modern', 'nice', 'cool', 'amazing']);
const LIGHT_WORDS = /\b(light|lit|sun|sunlight|sunrise|sunset|dawn|dusk|daylight|lamp|candle|shadow|shadows|morning|evening|window|overcast|moonlight|backlit)\b/i;
const SETTING_WORDS = /\b(in|on|at|beside|inside|under|near|against|across|behind|by|through|over)\b/i;

const words = s => s.trim().split(/\s+/).filter(Boolean);

/** Check a visual sentence. Returns { ok, sentence, words, problems, hints }. */
export function checkSentence(sentence) {
  const s = String(sentence).replace(/\s+/g, ' ').trim();
  const problems = [];
  const hints = [];
  const add = (id, message) => problems.push({ id, message });
  const wc = s ? words(s).length : 0;
  if (!s) add('empty', 'the sentence is empty: write what is in the picture, where, and in what light');
  // more than one sentence: a terminator followed by more text (decimals like 3.5 and abbreviations without a space are fine)
  if (/[.!?]["')\]]*\s+\S/.test(s)) add('not-one-sentence', 'write ONE sentence; merge the second thought into the first or drop it');
  if (wc > 30) add('too-long', `${wc} words; the limit is 30 — cut to one subject, one setting, one light`);
  const lower = ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const hit = BANNED.filter(b => lower.includes(` ${b.replace(/[^a-z0-9]+/g, ' ')} `) || (b === 'glowing' && /\bglow(s|ed|ing)?\b/.test(lower)) || (b === 'gradient' && /\bgradients\b/.test(lower)));
  if (hit.length) add('banned-words', `style words that read as slop: ${hit.join(', ')} — say what is physically there instead`);
  if (s) {
    const content = words(s.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ')).filter(w => w.length > 2 && !STOP.has(w));
    const concrete = content.filter(w => !VAGUE.has(w) && !BANNED.includes(w));
    if (concrete.length < 2) add('no-concrete-subject', 'no concrete subject: name a real thing (a brass kettle, a person at a workbench) rather than a mood or a concept');
    if (!SETTING_WORDS.test(s)) hints.push('name the setting (where the subject is)');
    if (!LIGHT_WORDS.test(s)) hints.push('name the light (for example "in low morning sun")');
  }
  return { ok: problems.length === 0, sentence: s, words: wc, problems, hints };
}

/** Decide whether a screen needs a visual and which kind. */
export function decide(ctx) {
  const screen = need(ctx, 'screen', v => SCREENS.includes(v), `one of ${SCREENS.join(', ')}`);
  const hasUi = needBool(ctx, 'has_product_ui');
  const works = needBool(ctx, 'works_without_visual');
  let slot = ctx.slot;
  if (slot !== undefined && !SLOTS.includes(slot)) throw bad(`slot must be one of ${SLOTS.join(', ')}`);
  if (slot === undefined) slot = screen === 'landing' ? 'hero' : screen === 'empty-state' ? 'empty-state' : 'section';
  let direction;
  if (ctx.direction !== undefined) {
    const d = ctx.direction;
    if (!isObj(d)) throw bad('direction must be an object { world, character }');
    for (const k of ['world', 'character']) if (d[k] !== undefined && (typeof d[k] !== 'string' || !d[k].trim())) throw bad(`direction.${k} must be a non-empty string`);
    direction = { ...(d.world ? { world: d.world.trim() } : {}), ...(d.character ? { character: d.character.trim() } : {}) };
  }
  const out = (needed, kind, why, next) => ({ needed, kind, slot, why, next, ...(direction ? { direction } : {}) });
  if (!works) return out(false, 'none', 'The screen does not work without a visual yet, and a visual cannot rescue it.', 'Make the screen work first (content, hierarchy, actions); come back for the visual after.');
  const emptyState = screen === 'empty-state' || slot === 'empty-state';
  if ((screen === 'dashboard' || screen === 'app') && !emptyState) return out(false, 'none', `A ${screen} is a working surface; decoration there costs attention and rarely earns it.`, 'Skip the visual; spend the effort on the data, states and controls.');
  const world = direction && direction.world;
  if (hasUi) return out(true, 'product-shot', 'The product has a UI, so show the product itself rather than an abstract stand-in.', 'Use a real or code-built preview of the one moment that proves the headline, with plausible data; let it rise from the bottom edge.');
  if (slot === 'hero' && screen === 'landing') {
    return out(true, 'scene', 'A landing hero without a product UI to show is carried by a scene from the product\'s world.', world
      ? `Write one sentence for a scene in "${world}": subject on one side, calm space for the headline on the other. Check it with the sentence subcommand.`
      : 'Pick the product\'s world first (direction.world), then write one sentence for a scene: subject on one side, calm space for the headline.');
  }
  return out(true, 'object', `With no product UI to show, a ${emptyState ? 'empty state' : 'section'} is best served by a single object.`, world
    ? `Write one sentence for a single object from "${world}", centered with space around it. Check it with the sentence subcommand.`
    : 'Pick the product\'s world first (direction.world), then write one sentence for a single object from it.');
}

const NAMED = [
  ['black', 0, 0, 0], ['charcoal', 54, 54, 54], ['gray', 128, 128, 128], ['silver', 192, 192, 192], ['white', 255, 255, 255], ['cream', 245, 238, 220],
  ['red', 200, 40, 40], ['burgundy', 110, 25, 40], ['coral', 240, 120, 100], ['orange', 235, 130, 40], ['amber', 230, 170, 40], ['yellow', 240, 215, 60],
  ['olive', 110, 120, 50], ['green', 50, 150, 70], ['forest green', 25, 80, 50], ['mint', 160, 220, 190], ['teal', 30, 140, 140], ['sky blue', 130, 190, 235],
  ['blue', 50, 100, 210], ['navy', 20, 35, 90], ['indigo', 70, 60, 160], ['purple', 130, 70, 170], ['pink', 235, 140, 180], ['brown', 110, 70, 40], ['tan', 200, 170, 130],
];
function hexToRgb(h) {
  let x = h.slice(1);
  if (x.length === 3) x = [...x].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16));
}
export function colorWord(hex) {
  const [r, g, b] = hexToRgb(hex);
  let best = NAMED[0], bd = Infinity;
  for (const n of NAMED) {
    const d = (n[1] - r) ** 2 + (n[2] - g) ** 2 + (n[3] - b) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best[0];
}

/** Build the image prompt and placement notes. */
export function buildPrompt(ctx) {
  const chk = checkSentence(typeof ctx.sentence === 'string' ? ctx.sentence : '');
  if (typeof ctx.sentence !== 'string') throw bad('sentence must be a string');
  if (!chk.ok) throw bad(`sentence fails the check: ${chk.problems.map(p => p.id).join(', ')} — run the sentence subcommand and fix it first`);
  const style = need(ctx, 'style', v => STYLES.includes(v), `one of ${STYLES.join(', ')}`);
  const aspect = need(ctx, 'aspect', v => Object.hasOwn(SIZES, v), `one of ${Object.keys(SIZES).join(', ')}`);
  const pal = ctx.palette;
  if (!Array.isArray(pal) || pal.length < 1 || pal.length > 6 || !pal.every(h => typeof h === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h))) throw bad('palette must be an array of 1 to 6 hex colors like "#1a2b3c"');
  const avoid = ctx.avoid === undefined ? [] : ctx.avoid;
  if (!Array.isArray(avoid) || !avoid.every(a => typeof a === 'string' && a.trim())) throw bad('avoid must be an array of non-empty strings');
  const side = ctx.headline_side === undefined ? 'left' : ctx.headline_side;
  if (side !== 'left' && side !== 'right') throw bad('headline_side must be left or right');
  if (ctx.light !== undefined && (typeof ctx.light !== 'string' || !ctx.light.trim())) throw bad('light must be a non-empty string');
  const radius = ctx.radius_px === undefined ? 12 : ctx.radius_px;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > 200) throw bad('radius_px must be a number from 0 to 200');
  let size = { ...SIZES[aspect] };
  if (ctx.display_width !== undefined) {
    const dw = ctx.display_width;
    if (!Number.isInteger(dw) || dw < 100 || dw > 2048) throw bad('display_width must be an integer from 100 to 2048');
    size = { w: dw * 2, h: Math.round(dw * 2 * SIZES[aspect].h / SIZES[aspect].w) };
  }
  const light = ctx.light ? ctx.light.trim() : DEFAULT_LIGHT[style];
  const paletteText = pal.map(h => `${colorWord(h)} ${h.toLowerCase()}`).join(', ');
  const subjectSide = side === 'left' ? 'right' : 'left';
  const composition = `subject placed on the ${subjectSide} third, calm empty negative space on the ${side} where the headline sits, nothing busy near the edges`;
  const prompt = [chk.sentence.replace(/[.!?]+$/, ''), STYLE_LINE[style], `palette: ${paletteText}`, `light: ${light}`, `composition: ${composition}`, `aspect ratio ${aspect}`].join('. ') + '.';
  const seen = new Set();
  const negative = [...BASE_NEGATIVE, ...avoid.map(a => a.trim())].filter(a => !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
  const alt = chk.sentence.replace(/[.!?]+$/, '');
  return {
    prompt,
    negative,
    aspect,
    size,
    placement: {
      object_fit: 'cover',
      object_position: subjectSide === 'right' ? 'right center' : 'left center',
      radius_px: radius,
      alt: alt.length > 125 ? alt.slice(0, 124).trimEnd() + '…' : alt,
      edge_fade: 'Fade the edges into the page background color in code (mask-image or an overlay), so no hard rectangle shows.',
      display: { w: Math.round(size.w / 2), h: Math.round(size.h / 2) },
      width_attr: size.w,
      height_attr: size.h,
    },
  };
}

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function need(ctx, key, ok, what) {
  if (!(key in ctx) || !ok(ctx[key])) throw bad(`${key} is required and must be ${what}`);
  return ctx[key];
}
function needBool(ctx, key) {
  if (typeof ctx[key] !== 'boolean') throw bad(`${key} is required and must be true or false`);
  return ctx[key];
}

const PROTECTED = /^\/(dev|proc)(\/|$)/;
async function openRegular(p) {
  let real = p;
  try { real = await fs.realpath(p); } catch { /* open reports it */ }
  if (PROTECTED.test(p) || PROTECTED.test(real)) throw bad(`${p} is not a regular file (paths under /dev and /proc are refused)`);
  const fh = await fs.open(p, fsc.O_RDONLY | fsc.O_NONBLOCK);
  try {
    const st = await fh.stat({ bigint: true });
    if (!st.isFile()) throw bad(`${p} is not a regular file`);
    let s0 = null;
    try { s0 = fstatSync(0, { bigint: true }); } catch { /* no stdin */ }
    if (s0 && s0.ino !== 0n && s0.dev === st.dev && s0.ino === st.ino) throw bad(`${p} is not a regular file (it is the same file as standard input)`);
    const buf = Buffer.alloc(MAX_BYTES + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    if (n > MAX_BYTES) throw bad(`${p} is larger than 8 MiB`);
    return buf.subarray(0, n);
  } finally { await fh.close().catch(() => {}); }
}

export async function run(args, io) {
  const [cmd, ...rest] = args;
  if (cmd !== 'decide' && cmd !== 'sentence' && cmd !== 'prompt') throw bad(`first argument must be decide, sentence or prompt\n${usage}`);
  let file;
  while (rest.length) {
    const a = rest.shift();
    if (a !== '--file') throw bad(`unexpected argument "${a}"\n${usage}`);
    if (file !== undefined) throw bad('--file given more than once');
    if (!rest.length || rest[0].startsWith('--')) throw bad('--file needs a value');
    file = rest.shift();
    if (!file) throw bad('--file needs a non-empty value');
  }
  let buf;
  if (file !== undefined) {
    const p = path.resolve(io.cwd || process.cwd(), file);
    try {
      buf = await openRegular(p);
    } catch (e) {
      if (e instanceof KitExit) throw e;
      throw bad(`cannot read ${p}: ${e.code || e.message}`);
    }
  } else {
    buf = Buffer.from(await (typeof io.stdinBytes === 'function' ? io.stdinBytes({ maxBytes: MAX_BYTES + 1 }) : io.stdin({ maxBytes: MAX_BYTES + 1 })));
    if (buf.length > MAX_BYTES) throw bad('input is larger than 8 MiB');
  }
  if (buf.includes(0)) throw bad('input looks binary (contains NUL bytes)');
  const text = buf.toString('utf-8').replace(/^﻿/, '');
  if (!text.trim()) throw bad('no input: pass a JSON context object on stdin or --file');
  let ctx;
  try { ctx = JSON.parse(text); } catch (e) { throw bad(`input is not valid JSON: ${e.message}`); }
  if (!isObj(ctx)) throw bad('input must be a JSON object');
  if (cmd === 'decide') return decide(ctx);
  if (cmd === 'prompt') return buildPrompt(ctx);
  if (typeof ctx.sentence !== 'string') throw bad('sentence is required and must be a string');
  return checkSentence(ctx.sentence);
}
