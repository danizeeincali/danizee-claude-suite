/**
 * landing-sections — the fixed order a landing page is laid out in, and a check of a spec or page against it.
 * Pure and read-only: it never writes and never touches the network.
 *
 *   landing-sections plan                       → { sections: [{ id, label, above_fold, must }] }
 *   landing-sections check [--file <spec.md|page.html>]   (or the text on stdin, at most 8 MiB)
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
      const m = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
      if (m) heads.push({ level: m[1].length, name: m[2], start: offset, bodyStart: offset + line.length + 1 });
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
  for (const m of withoutCode.matchAll(/(^|[^!])\[([^\]\n]+)\]\([^)\n]*\)/g)) out.push(m[2]);
  for (const m of withoutCode.matchAll(/^[ \t>*-]*(?:primary |main )?(?:cta|button)[ \t]*:[ \t]*(.+)$/gim)) out.push(m[1]);
  return out.map(norm).filter(Boolean);
}

const TAG = /<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
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
    .replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>|$)/gi, (_, open, _n, body, close) => open + blank(body) + close);
  const hits = [];
  for (const m of text.matchAll(TAG)) {
    const a = attrs(m[2]);
    const id = (a['data-section'] !== undefined && canonical(a['data-section'])) || (a.id !== undefined && canonical(a.id)) || null;
    if (id) hits.push({ id, start: m.index });
  }
  hits.forEach((h, i) => { h.end = i + 1 < hits.length ? hits[i + 1].start : text.length; h.body = text.slice(h.start, h.end); });
  return hits;
}

function htmlLabels(body) {
  const out = [];
  for (const m of body.matchAll(/<(a|button)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>/gi)) {
    const a = attrs(m[2]);
    const isCta = m[1].toLowerCase() === 'button' || /\b(btn|button|cta)\b/i.test(a.class || '') || 'data-cta' in a;
    if (isCta) out.push(norm(decode(m[3].replace(/<[^>]*>/g, ' '))));
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

function sniff(text) {
  return /^\s*<(!doctype|html|body|div|section|header|main|nav|h[1-6])\b/i.test(text) ? 'html' : 'md';
}

export async function run(args, io) {
  const [cmd, ...rest] = args;
  if (cmd === 'plan') {
    if (rest.length) throw bad(`plan takes no arguments\n${usage}`);
    return planSections();
  }
  if (cmd !== 'check') throw bad(`first argument must be plan or check\n${usage}`);
  let file;
  while (rest.length) {
    const a = rest.shift();
    if (a !== '--file') throw bad(`unexpected argument "${a}"\n${usage}`);
    if (!rest.length || rest[0].startsWith('--')) throw bad('--file needs a value');
    if (file !== undefined) throw bad('--file given more than once');
    file = rest.shift();
    if (!file) throw bad('--file needs a non-empty value');
  }
  const cwd = io.cwd || process.cwd();
  let text, type;
  if (file !== undefined) {
    const p = path.resolve(cwd, file);
    try {
      const st = await fs.stat(p);
      if (!st.isFile()) throw bad(`${p} is not a file`);
      if (st.size > MAX_BYTES) throw bad(`${p} is larger than 8 MiB`);
      const fh = await fs.open(p, 'r');
      try {
        const buf = Buffer.alloc(MAX_BYTES + 1);
        const { bytesRead } = await fh.read(buf, 0, MAX_BYTES + 1, 0);
        if (bytesRead > MAX_BYTES) throw bad(`${p} is larger than 8 MiB`);
        text = buf.subarray(0, bytesRead).toString('utf-8');
      } finally { await fh.close(); }
    } catch (e) {
      if (e instanceof KitExit) throw e;
      throw bad(`cannot read ${p}: ${e.code || e.message}`);
    }
    const ext = path.extname(p).toLowerCase();
    type = ext === '.html' || ext === '.htm' ? 'html' : ext === '.md' || ext === '.markdown' || ext === '.txt' ? 'md' : null;
  } else {
    const buf = Buffer.from(await (typeof io.stdinBytes === 'function' ? io.stdinBytes({ maxBytes: MAX_BYTES + 1 }) : io.stdin({ maxBytes: MAX_BYTES + 1 })));
    if (buf.length > MAX_BYTES) throw bad('input is larger than 8 MiB');
    text = buf.toString('utf-8');
  }
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw bad('no input: pass a markdown spec or HTML page on stdin or --file');
  if (text.includes('\0')) throw bad('input looks binary (contains NUL bytes)');
  return checkText(text, type || sniff(text));
}
