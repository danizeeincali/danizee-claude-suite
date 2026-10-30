/**
 * direction — five short lines to write before any visual work: product, character, world, moments, signature.
 * Pure and read-only: it never writes and never touches the network. It complements design-brief (which gathers
 * offer, audience and brand constraints) and does not repeat it; design-brief JSON is only an optional input.
 *
 *   direction template                          → { fields: [{ id, label, ask, example }] }
 *   direction check [--file <direction.json|.md>] [--strict]   (or the text on stdin, at most 8 MiB)
 *                                               → { ok, fields: { <id>: { present, text, problems: [code] } },
 *                                                   problems: [{ field, code, message, fix }], next }
 *   direction from-brief [--file <design-brief.json>]          (or the JSON on stdin)
 *                                               → { fields: [{ id, label, ask, example, text, todo }], prefilled, next }
 *
 * The five lines: product (what it is and who it is for, in plain words), character (two or three traits as a
 * person would describe a colleague), world (the physical or cultural place the product belongs to, which colours,
 * materials and type are borrowed from), moments (one or two places on the screen that carry the accent colour; at
 * most two) and signature (one small concrete detail that is unmistakably this product).
 *
 * check input is a JSON object with those five keys (moments may be an array of strings, blank items dropped; any other field must be a string; unknown keys and exact duplicate keys are refused with exit 1),
 * or a markdown/text block with lines `Product: ...`, `Character: ...`, `World: ...`, `Moments: ...`,
 * `Signature: ...` (bullets and bold around the label are fine; lines under a label continue it). The type is
 * sniffed from the text (a leading `{`, a JSON array, or a bare JSON null/number/boolean means JSON, so a non-object is refused with exit 1, not read as markdown). Problem codes: missing, duplicate_field, banned_word (clean,
 * modern, sleek, minimal, minimalist, beautiful, stunning, elegant, premium, intuitive, user-friendly, cutting-edge,
 * innovative, professional, simple; whole-word, case-insensitive, in any field), too_long (over 200 characters),
 * too_many_moments (more than 2), too_few_traits (character with fewer than 2), signature_not_concrete (only a
 * colour or only a font), world_is_style_word (only a style word such as "tech"). The counting of traits and
 * moments splits on commas, semicolons, "and", "&", "+" and new lines, so it is a heuristic. Advisory: exit 0 always,
 * ok or not; with --strict exit 2 (the JSON is still printed) when ok is false.
 *
 * from-brief reads a design-brief input ({ kind, answers }) or its assume output ({ kind, brief }) and returns a
 * skeleton: product is prefilled from the offer and audience, the other four are questions with todo: true. Fields
 * listed in the assume output's `assumptions` are the kind's default text, not the user's words, so they count as
 * missing (product stays todo with a note). A JSON moments array is counted by its length, not re-split.
 * Exit 1 when the input is not a design-brief shape, is empty, binary, unreadable, over 8 MiB, or an argument is
 * unknown, repeated or missing its value.
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import fs from 'fs/promises';
import { constants as fsc, fstatSync } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { normalize as normalizeBrief } from './design-brief.js';

export const verb = 'direction';
export const usage = 'cli.js direction template | check [--strict] [--file <direction.json|.md>] | from-brief [--file <design-brief.json>]  (text or JSON on stdin or --file; check is advisory, exit 0 unless --strict)';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FIELD = 200;
const MAX_MOMENTS = 2;

export const FIELDS = [
  {
    id: 'product', label: 'Product',
    ask: 'In one plain sentence: what does it do, and who is it for?',
    example: 'A tool that turns a bakery\'s daily orders into one printed prep list, for the baker who starts at four in the morning.',
  },
  {
    id: 'character', label: 'Character',
    ask: 'Two or three traits, the way you would describe a colleague (not an adjective that fits every template).',
    example: 'Dry-humoured, punctual, a little stubborn about units.',
  },
  {
    id: 'world', label: 'World',
    ask: 'What physical or cultural place does the product belong to? Colours, materials and type are borrowed from there.',
    example: 'A trade kitchen at dawn: steel shelves, flour-dusted wood, handwritten chalk labels.',
  },
  {
    id: 'moments', label: 'Moments',
    ask: 'One or two places on the screen (at most two) where the accent colour is allowed to appear.',
    example: 'The total at the bottom of the prep list; the button that sends it to print.',
  },
  {
    id: 'signature', label: 'Signature',
    ask: 'One small, concrete detail that is unmistakably this product, used consistently and nowhere else.',
    example: 'Every quantity is set in a hand-lettered numeral with a tally-mark underline.',
  },
];
const IDS = FIELDS.map(f => f.id);
const FIELD_BY_ID = Object.fromEntries(FIELDS.map(f => [f.id, f]));

export const BANNED = ['clean', 'modern', 'sleek', 'minimal', 'minimalist', 'beautiful', 'stunning', 'elegant', 'premium', 'intuitive', 'user-friendly', 'cutting-edge', 'innovative', 'professional', 'simple'];
const BANNED_RE = BANNED.map(w => [w, new RegExp(`(?<![\\w-])${w.replace(/-/g, '\\-')}(?![\\w-])`, 'i')]);

const bad = m => new KitExit(m, 1);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'our', 'is', 'its', 'it', 'with', 'and', 'or', 'on', 'for', 'to', 'we', 'use', 'uses', 'used', 'every', 'all', 'this', 'that', 'only']);
const COLORS = new Set(['red', 'orange', 'yellow', 'green', 'teal', 'cyan', 'blue', 'navy', 'indigo', 'violet', 'purple', 'magenta', 'pink', 'rose', 'brown', 'tan', 'beige', 'cream', 'black', 'white', 'grey', 'gray', 'silver', 'gold', 'amber', 'coral', 'crimson', 'scarlet', 'lime', 'mint', 'olive', 'maroon', 'lavender', 'turquoise', 'charcoal', 'ivory', 'color', 'colour', 'accent', 'brand', 'bright', 'dark', 'light', 'deep', 'pale', 'warm', 'cool', 'neon', 'pastel', 'gradient', 'hue', 'shade', 'tint']);
const FONT_WORDS = new Set(['font', 'fonts', 'typeface', 'typefaces', 'type', 'typography', 'serif', 'sans', 'sans-serif', 'mono', 'monospace', 'monospaced', 'bold', 'italic', 'light', 'heavy', 'thin', 'regular', 'condensed', 'rounded', 'inter', 'helvetica', 'arial', 'roboto', 'georgia', 'times', 'courier', 'futura', 'garamond', 'baskerville', 'bodoni', 'didot', 'verdana', 'poppins', 'lato', 'montserrat', 'playfair', 'caslon', 'gotham', 'avenir', 'palatino', 'fraunces', 'jetbrains', 'menlo', 'consolas', 'display', 'letter', 'letters', 'lettering']);
const STYLE_WORDS = new Set(['tech', 'technology', 'digital', 'software', 'saas', 'startup', 'corporate', 'business', 'web', 'app', 'apps', 'online', 'abstract', 'futuristic', 'dark', 'light', 'bold', 'colorful', 'colourful', 'generic', 'flat', 'ui', 'ux', 'design', 'style', 'styles', 'gradient', 'gradients', 'glow', 'sparkle', 'sparkles', 'cyber', 'neon', 'retro', 'vintage', 'playful', 'fun', 'trendy', 'contemporary', 'sleek', 'minimal', 'minimalist', 'modern', 'clean', 'simple', 'glass', 'glassmorphism', 'brutalist', 'brutalism', 'material', 'aesthetic', 'look', 'vibe', 'theme', 'world', 'internet', 'cloud', 'ai', 'data']);

const words = s => String(s).toLowerCase().replace(/#[0-9a-f]{3,8}\b/g, ' hex ').replace(/\b(?:rgba?|hsla?)\([^)]*\)/g, ' rgb ').split(/[^a-z0-9-]+/).map(w => w.replace(/^-+|-+$/g, '')).filter(Boolean);
const meaningful = s => words(s).filter(w => !STOP.has(w));
const onlyFrom = (s, ...sets) => {
  const w = meaningful(s);
  return w.length > 0 && w.every(x => x === 'hex' || x === 'rgb' || sets.some(set => set.has(x)));
};

const SPLIT = /\s*(?:;|,|\n|&|\+|\band\b|\bplus\b)\s*/i;
const items = s => String(s).split(SPLIT).map(x => x.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);

function judge(id, text, count) {
  const out = [];
  const add = (code, message, fix) => out.push({ code, message, fix });
  if (!text) {
    add('missing', `${FIELD_BY_ID[id].label} is empty`, FIELD_BY_ID[id].ask);
    return out;
  }
  const hit = new Set();
  for (const [w, re] of BANNED_RE) if (re.test(text)) hit.add(w);
  for (const w of hit) add('banned_word', `"${w}" fits every template and says nothing about this product`, `Replace "${w}" with something concrete: a person, a place, a material or a habit.`);
  if (text.length > MAX_FIELD) add('too_long', `${text.length} characters; a line is at most ${MAX_FIELD}`, 'Cut it to the one thing that matters.');
  const nMoments = id === 'moments' ? (count ?? items(text).length) : 0;
  if (id === 'moments' && nMoments > MAX_MOMENTS) add('too_many_moments', `${nMoments} moments listed; the accent colour goes on at most ${MAX_MOMENTS} places`, `Keep the ${MAX_MOMENTS} places that carry the product's value and drop the rest.`);
  if (id === 'character' && items(text).length < 2) add('too_few_traits', 'character needs two or three traits', 'Add a second trait, described as you would a colleague (for example "dry-humoured, punctual").');
  if (id === 'signature' && onlyFrom(text, COLORS, FONT_WORDS)) add('signature_not_concrete', 'a colour or a font alone is not a signature', 'Name a concrete detail: a shape, a gesture, a mark, a way numbers or edges are drawn.');
  if (id === 'world' && onlyFrom(text, STYLE_WORDS)) add('world_is_style_word', 'a style word is not a place', 'Name a physical or cultural place (a workshop, a harbour, a newsroom) and what it is made of.');
  return out;
}

/** Judge a { id: text } map (missing ids count as empty). */
export function checkFields(values) {
  const fields = {};
  const problems = [];
  for (const id of IDS) {
    const text = String(values[id] ?? '').replace(/[ \t]+/g, ' ').trim();
    const found = judge(id, text, values.__count && values.__count[id]);
    if (values.__dup && values.__dup.includes(id)) found.push({ code: 'duplicate_field', message: `${FIELD_BY_ID[id].label} appears more than once; the first is used`, fix: 'Keep one line per field.' });
    fields[id] = { present: text.length > 0, text, problems: found.map(p => p.code) };
    for (const p of found) problems.push({ field: id, ...p });
  }
  const ok = problems.length === 0;
  return {
    ok, fields, problems,
    next: ok ? 'Direction is concrete; write it into the plan before any visual change.' : `Fix ${problems.length} problem${problems.length === 1 ? '' : 's'} (see problems[].fix) and run direction check again.`,
  };
}

export function template() {
  return { fields: FIELDS.map(f => ({ ...f })) };
}

const LABEL = /^[\s>*+-]*[*_]*(product|character|world|moments?|signature)[*_]*[ \t]*:[*_\s]*(.*)$/i;

/** Parse a markdown/text block of `Label: text` lines into { id: text, __dup }. */
export function parseText(text) {
  const out = {}, dup = [];
  let cur = null, fence = false;
  for (const line of text.split('\n')) {
    if (/^ {0,3}(```|~~~)/.test(line)) { fence = !fence; cur = null; continue; }
    if (fence) continue;
    const m = LABEL.exec(line);
    if (m) {
      const id = m[1].toLowerCase().replace(/^moment$/, 'moments');
      if (id in out) { dup.push(id); cur = null; continue; }
      out[id] = m[2].replace(/[*_]+\s*$/, '').trim();
      cur = id;
    } else if (cur && line.trim() && !/^\s{0,3}#/.test(line)) {
      out[cur] += (out[cur] ? '\n' : '') + line.trim().replace(/^[-*•]\s+/, '');
    } else if (!line.trim()) {
      if (cur && out[cur]) cur = null;
    } else cur = null;
  }
  out.__dup = dup;
  return out;
}

/** Normalise a parsed JSON direction into { id: text }. */
export function fromJson(obj) {
  if (!isObj(obj)) throw bad('direction JSON must be an object with the keys product, character, world, moments, signature');
  const out = {}, count = {};
  for (const k of Object.keys(obj)) {
    const id = k.toLowerCase();
    if (!IDS.includes(id)) throw bad(`unknown key "${k}" in direction (allowed: ${IDS.join(', ')})`);
    if (id in out) throw bad(`key "${id}" given more than once`);
    const v = obj[k];
    if (v === null || v === undefined) { out[id] = ''; continue; }
    if (typeof v === 'string') { out[id] = v; continue; }
    if (id === 'moments' && Array.isArray(v) && v.every(x => typeof x === 'string')) {
      const kept = v.map(x => x.trim()).filter(Boolean);
      out[id] = kept.join('; '); count[id] = kept.length; continue;
    }
    throw bad(`direction.${k} must be a string${id === 'moments' ? ' or an array of strings' : ''}`);
  }
  if (Object.keys(count).length) Object.defineProperty(out, '__count', { value: count, enumerable: false });
  return out;
}

/** The skeleton for from-brief. */
export function fromBrief(input) {
  let src = input;
  if (isObj(input) && isObj(input.brief) && input.answers === undefined) src = { kind: input.kind, answers: input.brief };
  const { answers } = normalizeBrief(src);
  // Fields that assume filled with the kind's default text are unknown, not the user's words.
  const assumed = new Set(isObj(input) && Array.isArray(input.assumptions) ? input.assumptions.map(a => isObj(a) ? a.field : a) : []);
  const known = k => !assumed.has(k) && typeof answers[k] === 'string' ? answers[k].replace(/[.\s]+$/, '') : '';
  const offer = known('offer');
  const aud = known('audience');
  let product = '';
  if (offer && aud) product = `${offer}, for ${aud}.`;
  else if (offer) product = `${offer}.`;
  else if (aud) product = `For ${aud}.`;
  const prefilled = [];
  const fields = FIELDS.map(f => {
    if (f.id === 'product') {
      if (product) prefilled.push('product');
      return { ...f, text: product, todo: !offer || !aud, ...(offer && aud ? {} : { note: offer ? 'audience missing: say who it is for' : 'offer missing: say what it is' }) };
    }
    return { ...f, text: '', todo: true };
  });
  return { fields, prefilled, next: 'Answer every field with todo: true, then run direction check on the five lines.' };
}

const PROTECTED = /^\/(dev|proc)(\/|$)/;
/** Open on the handle (O_RDONLY | O_NONBLOCK), require a regular file via fh.stat(), refuse /dev and /proc, bounded read. */
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

async function readText(file, io) {
  const cwd = io.cwd || process.cwd();
  let text;
  if (file !== undefined) {
    const p = path.resolve(cwd, file);
    try {
      text = (await openRegular(p)).toString('utf-8');
    } catch (e) {
      if (e instanceof KitExit) throw e;
      throw bad(`cannot read ${p}: ${e.code || e.message}`);
    }
  } else {
    const buf = Buffer.from(await (typeof io.stdinBytes === 'function' ? io.stdinBytes({ maxBytes: MAX_BYTES + 1 }) : io.stdin({ maxBytes: MAX_BYTES + 1 })));
    if (buf.length > MAX_BYTES) throw bad('input is larger than 8 MiB');
    text = buf.toString('utf-8');
  }
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw bad('no input: pass the direction on stdin or --file');
  if (text.includes('\0')) throw bad('input looks binary (contains NUL bytes)');
  return text;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (e) {
    const m = /at position (\d+)/.exec(String(e && e.message));
    throw bad(`input is not valid JSON${m ? `: syntax error at position ${m[1]}` : ''}`);
  }
}

/** True when the text is JSON: a leading `{`, a JSON array (`[` that parses) or a bare JSON null/number/boolean. */
function sniffJson(text) {
  const t = text.trim();
  if (t.startsWith('{')) return true;
  try {
    const v = JSON.parse(t);
    return v === null || typeof v !== 'string';
  } catch { return false; }
}

/** The first exact repeated key of the top-level object in JSON text, or null (a light scan; JSON.parse keeps the last). */
function firstDuplicateKey(text) {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  const seen = new Set();
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') {
      let j = i + 1;
      while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1;
      if (depth === 1) {
        let k = j + 1;
        while (/\s/.test(t[k] || '')) k++;
        if (t[k] === ':') {
          let key; try { key = JSON.parse(t.slice(i, j + 1)); } catch { key = t.slice(i + 1, j); }
          if (seen.has(key)) return key;
          seen.add(key);
        }
      }
      i = j;
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return null;
}

export async function run(args, io) {
  const [cmd, ...rest] = args;
  if (cmd === 'template') {
    if (rest.length) throw bad(`template takes no arguments\n${usage}`);
    return template();
  }
  if (cmd !== 'check' && cmd !== 'from-brief') throw bad(`first argument must be template, check or from-brief\n${usage}`);
  let file, strict = false;
  while (rest.length) {
    const a = rest.shift();
    if (a === '--strict' && cmd === 'check') {
      if (strict) throw bad('--strict given more than once');
      strict = true;
    } else if (a === '--file') {
      if (file !== undefined) throw bad('--file given more than once');
      if (!rest.length || rest[0].startsWith('--')) throw bad('--file needs a value');
      file = rest.shift();
      if (!file) throw bad('--file needs a non-empty value');
    } else throw bad(`unexpected argument "${a}"\n${usage}`);
  }
  const text = await readText(file, io);
  if (cmd === 'from-brief') return fromBrief(parseJson(text));
  const values = sniffJson(text) ? fromJson(parseJson(text)) : parseText(text);
  if (sniffJson(text)) {
    const dupKey = firstDuplicateKey(text);
    if (dupKey !== null) throw bad(`key "${dupKey}" given more than once`);
  }
  const result = checkFields(values);
  if (strict && !result.ok) result.exit = 2;
  return result;
}
