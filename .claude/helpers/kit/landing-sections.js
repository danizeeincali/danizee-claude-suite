/**
 * landing-sections — the fixed order a landing page is laid out in, and a check of a spec or page against it.
 * Pure and read-only: it never writes and never touches the network.
 *
 *   landing-sections plan                       → { sections: [{ id, label, above_fold, must }] }
 *   landing-sections check [--file <spec.md|page.html>] [--format md|html]   (or the text on stdin, at most 8 MiB)
 *                                               → { found, missing, out_of_order, cta }
 *
 * The order: the hero above the fold (headline with outcome and audience, subheadline, one primary CTA, one proof
 * signal, hero visual); then problem-solution, benefits, how-it-works (3 steps), tagline, social-proof, faq,
 * risk-reversal and a final-cta that mirrors the hero CTA. `must` marks the sections a page cannot do without.
 *
 * check finds sections by markdown heading (fenced code is skipped) or, in HTML, by a `data-section` or `id`
 * attribute (data-section wins); names are matched through an aliases table ("testimonials" is social-proof,
 * "pricing guarantee" is risk-reversal). `found` lists canonical ids in document order (first hit wins),
 * `missing` the must sections that are absent, `out_of_order` each section that appears after one that should
 * follow it, with the canonical section it belongs after (null for the first). `cta` says whether the hero and
 * the final section each carry a call to action (markdown link, `CTA:` line, HTML button or a.btn/.cta) and
 * whether a label is the same in both (case and punctuation ignored). Advisory: exit 0. File type comes from
 * the extension; stdin is sniffed. Binary input, an unreadable file or unknown arguments exit 1.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import { constants as fsc, fstatSync } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'landing-sections';
export const usage = 'cli.js landing-sections plan | check [--file <spec.md|page.html>]  (text on stdin or --file; advisory, exit 0)';

const MAX_BYTES = 8 * 1024 * 1024;

export const PLAN = [
  { id: 'hero', label: 'Hero: outcome and audience headline, subheadline, one primary CTA, one proof signal, hero visual', above_fold: true, must: true },
  { id: 'problem-solution', label: 'Problem and solution', above_fold: false, must: true },
  { id: 'benefits', label: 'Outcome-driven benefits', above_fold: false, must: true },
  { id: 'how-it-works', label: 'How it works (3 steps)', above_fold: false, must: true },
  { id: 'tagline', label: 'Tagline', above_fold: false, must: false },
  { id: 'social-proof', label: 'Social proof', above_fold: false, must: true },
  { id: 'faq', label: 'FAQ', above_fold: false, must: false },
  { id: 'risk-reversal', label: 'Risk reversal', above_fold: false, must: false },
  { id: 'final-cta', label: 'Final call to action (mirrors the hero CTA)', above_fold: false, must: true },
];
const RANK = Object.fromEntries(PLAN.map((s, i) => [s.id, i]));

const ALIASES = {
  hero: ['hero', 'above the fold', 'header', 'banner', 'headline', 'intro', 'introduction', 'masthead'],
  'problem-solution': ['problem solution', 'problem and solution', 'problem', 'the problem', 'pain', 'pain points', 'solution', 'the solution', 'challenge'],
  benefits: ['benefits', 'benefit', 'outcomes', 'features', 'value', 'value proposition', 'why us', 'why choose us', 'advantages'],
  'how-it-works': ['how it works', 'how-it-works', 'process', 'steps', 'three steps', '3 steps', 'getting started steps', 'workflow'],
  tagline: ['tagline', 'slogan', 'mission', 'manifesto', 'statement'],
  'social-proof': ['social proof', 'testimonials', 'testimonial', 'reviews', 'customers', 'customer stories', 'case studies', 'logos', 'trusted by', 'as seen in', 'praise'],
  faq: ['faq', 'faqs', 'frequently asked questions', 'questions', 'common questions'],
  'risk-reversal': ['risk reversal', 'guarantee', 'guarantees', 'pricing guarantee', 'money back guarantee', 'money back', 'refund', 'refund policy', 'free trial', 'no risk', 'risk free'],
  'final-cta': ['final cta', 'cta', 'call to action', 'final call to action', 'get started', 'get started today', 'ready to start', 'closing', 'footer cta', 'bottom cta', 'sign up'],
};
const ALIAS_LIST = Object.entries(ALIASES)
  .flatMap(([id, names]) => names.map(n => [norm(n), id]))
  .sort((a, b) => b[0].length - a[0].length);
const ALIAS_EXACT = new Map(ALIAS_LIST);

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Canonical section id for a heading, id or data-section value; null when it names none. */
export function canonical(name) {
  const n = norm(name);
  if (!n) return null;
  if (ALIAS_EXACT.has(n)) return ALIAS_EXACT.get(n);
  const padded = ` ${n} `;
  for (const [alias, id] of ALIAS_LIST) if (padded.includes(` ${alias} `)) return id;
  return null;
}

export function planSections() {
  return { sections: PLAN.map(s => ({ ...s })) };
}

const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'");

/** Hits are { id, start, end, level?, name } in document order, `end` being where the section's text stops. */
/** Strip a CommonMark closing '#' sequence (preceded by a space or tab) with a backward walk: linear time. */
function headingName(raw) {
  const t = raw.trimEnd();
  let j = t.length;
  while (j > 0 && t[j - 1] === '#') j--;
  if (j < t.length && (j === 0 || t[j - 1] === ' ' || t[j - 1] === '\t')) return t.slice(0, j).trimEnd();
  return t;
}

function scanMarkdown(text) {
  const lines = text.split('\n');
  const heads = [];
  let offset = 0, fence = null;
  for (const line of lines) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    } else if (!fence) {
      const m = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
      if (m) heads.push({ level: m[1].length, name: headingName(m[2]), start: offset, bodyStart: offset + line.length + 1 });
    }
    offset += line.length + 1;
  }
  const hits = [];
  heads.forEach((h, i) => {
    const id = canonical(h.name);
    if (!id) return;
    let end = text.length;
    for (let j = i + 1; j < heads.length; j++) if (heads[j].level <= h.level) { end = heads[j].start; break; }
    hits.push({ id, start: h.start, end, body: text.slice(h.bodyStart, Math.max(end, h.bodyStart)) });
  });
  return hits;
}

function mdLabels(body) {
  const out = [];
  const withoutCode = body.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?(^ {0,3}\1.*$|$(?![\s\S]))/gm, '');
  for (const m of withoutCode.matchAll(/(^|[^!])\[([^\]\n[]{1,300})\]\([^)\n]{0,2000}\)/g)) out.push(m[2]);
  for (const m of withoutCode.matchAll(/^[ \t>*-]*(?:primary |main )?(?:cta|button)[ \t]*:[ \t]*(.+)$/gim)) out.push(m[1]);
  return out.map(norm).filter(Boolean);
}

const TAG = /<([a-zA-Z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attrs(src) {
  const o = {};
  for (const m of src.matchAll(ATTR)) {
    const k = m[1].toLowerCase();
    if (!(k in o)) o[k] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return o;
}

function scanHtml(raw) {
  // blank out comments and script/style bodies (keeping offsets) so nothing inside them is read as a tag
  const blank = s => s.replace(/[^\n]/g, ' ');
  const text = raw
    .replace(/<!--[\s\S]*?(-->|$)/g, blank)
    .replace(/(<(script|style)\b[^<>]*>)([\s\S]*?)(<\/\2\s*>|$)/gi, (_, open, _n, body, close) => open + blank(body) + close);
  const hits = [];
  for (const m of text.matchAll(TAG)) {
    const a = attrs(m[2]);
    const id = (a['data-section'] !== undefined && canonical(a['data-section'])) || (a.id !== undefined && canonical(a.id)) || null;
    if (id) hits.push({ id, start: m.index });
  }
  hits.forEach((h, i) => { h.end = i + 1 < hits.length ? hits[i + 1].start : text.length; h.body = text.slice(h.start, h.end); });
  return hits;
}

// Linear: an opener without a closer is skipped, and no closer anywhere after it means none for later openers either.
function htmlLabels(body) {
  const out = [];
  const lower = body.toLowerCase();
  const noCloser = { a: false, button: false };
  const open = /<(a|button)\b/gi;
  const tagAt = new RegExp(TAG.source, 'y');
  for (let o; (o = open.exec(body));) {
    const name = o[1].toLowerCase();
    if (noCloser[name]) continue;
    tagAt.lastIndex = o.index;
    const t = tagAt.exec(body);
    if (!t) continue;
    const from = t.index + t[0].length;
    let close = -1, endAt = -1;
    for (let k = lower.indexOf('</' + name, from); k !== -1; k = lower.indexOf('</' + name, k + 1)) {
      let e = k + 2 + name.length;
      while (e < lower.length && /\s/.test(lower[e])) e++;
      if (lower[e] === '>') { close = k; endAt = e + 1; break; }
    }
    if (close < 0) { noCloser[name] = true; continue; }
    open.lastIndex = endAt;
    const a = attrs(t[2]);
    const isCta = name === 'button' || /\b(btn|button|cta)\b/i.test(a.class || '') || 'data-cta' in a;
    if (isCta) out.push(norm(decode(body.slice(from, close).replace(/<[^<>]*>/g, ' '))));
  }
  return out.filter(Boolean);
}

/** Check markdown or HTML text against the canonical order. */
export function checkText(text, type = 'md') {
  const isHtml = type === 'html';
  const all = isHtml ? scanHtml(text) : scanMarkdown(text);
  const seen = new Set();
  const hits = all.filter(h => (seen.has(h.id) ? false : seen.add(h.id)));
  const found = hits.map(h => h.id);
  const missing = PLAN.filter(s => s.must && !seen.has(s.id)).map(s => s.id);
  const out_of_order = [];
  let high = -1;
  for (const id of found) {
    if (RANK[id] < high) out_of_order.push({ id, expected_after: RANK[id] > 0 ? PLAN[RANK[id] - 1].id : null });
    else high = RANK[id];
  }
  const labelsOf = id => {
    const h = hits.find(x => x.id === id);
    return h ? (isHtml ? htmlLabels(h.body) : mdLabels(h.body)) : [];
  };
  const hero = labelsOf('hero'), fin = labelsOf('final-cta');
  return {
    found, missing, out_of_order,
    cta: { hero: hero.length > 0, final: fin.length > 0, mirrors: hero.some(l => fin.includes(l)) },
  };
}

const bad = m => new KitExit(m, 1);

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


// Decided from the text alone (never the file extension), so stdin and --file agree: leading comments are skipped.
function sniff(text) {
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (!text.startsWith('<!--', i)) break;
    const e = text.indexOf('-->', i + 4);
    if (e < 0) { i = text.length; break; }
    i = e + 3;
  }
  return /^<(!doctype\b|[a-z][a-z0-9-]*)/i.test(text.slice(i, i + 64)) ? 'html' : 'md';
}

export async function run(args, io) {
  const [cmd, ...rest] = args;
  if (cmd === 'plan') {
    if (rest.length) throw bad(`plan takes no arguments\n${usage}`);
    return planSections();
  }
  if (cmd !== 'check') throw bad(`first argument must be plan or check\n${usage}`);
  let file, format;
  while (rest.length) {
    const a = rest.shift();
    if (a !== '--file' && a !== '--format') throw bad(`unexpected argument "${a}"\n${usage}`);
    if (!rest.length || rest[0].startsWith('--')) throw bad(`${a} needs a value`);
    if (a === '--file') {
      if (file !== undefined) throw bad('--file given more than once');
      file = rest.shift();
      if (!file) throw bad('--file needs a non-empty value');
    } else {
      if (format !== undefined) throw bad('--format given more than once');
      format = rest.shift();
      if (format !== 'md' && format !== 'html') throw bad('--format must be md or html');
    }
  }
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
  if (!text.trim()) throw bad('no input: pass a markdown spec or HTML page on stdin or --file');
  if (text.includes('\0')) throw bad('input looks binary (contains NUL bytes)');
  return checkText(text, format || sniff(text));
}
