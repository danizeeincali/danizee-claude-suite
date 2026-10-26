/**
 * sample-content — lint sample copy in a design, spec or page for filler that makes a product look fake.
 * Pure and deterministic: it reads one file (md, html, txt or json) or stdin and reports findings; it never edits.
 *
 *   sample-content lint [--file <f>] [--rules a,b]   → { file, rules, findings: [{ rule, line, text, hint }], counts }
 *
 * Rules: lorem (lorem ipsum filler), placeholder-person (John/Jane Doe, Foo Bar, Test User), placeholder-company
 * (Acme, Example Inc), hype (revolutionary, seamless, unlock, ... ), title-case (markdown headings, <h1-6>, <button>,
 * <a class=*btn*> written in Title Case; acronyms, camel-case names like GitHub and a single capitalised word do not
 * count, and every significant word must be capitalised), round-figure (percentages that are multiples of 10 and
 * numbers of 100 or more that are multiples of 100; years 1900-2099, versions like 100.0 and "10x" are left alone),
 * repeated-date (the same date written 3 or more times; reported once, at its first line), vague-error ("Something
 * went wrong", "An error occurred" with no next step on that line or the next).
 * A .json file (or stdin that parses as an object/array) has every string value scanned; a finding's line is where
 * the string starts in the file. HTML scripts, styles and tag markup are blanked before the content rules run.
 * The format is decided from the text alone (identical for --file and stdin): JSON when the whole input parses as an
 * object/array, HTML when tags appear outside fenced code, else markdown/text; markdown headings are read in every mode.
 * --format md|html|text|json overrides. Input is capped at 8 MiB (bytes, read bounded); bad flags, an empty or repeated
 * flag, an unknown rule or format, or invalid JSON under --format json exit 1. Advisory: exit 0.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import { constants as FS } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'sample-content';
export const usage = 'cli.js sample-content lint [--file <md|html|txt|json>] [--rules a,b] [--format md|html|text|json]  (text on stdin without --file; advisory, exit 0)';

export const FORMATS = ['md', 'html', 'text', 'json'];
export const RULES = ['lorem', 'placeholder-person', 'placeholder-company', 'hype', 'title-case', 'round-figure', 'repeated-date', 'vague-error'];
const MAX_BYTES = 8 * 1024 * 1024;
const bad = m => new KitExit(m, 1);

const HYPE = {
  revolutionary: 'what changed, in numbers or a plain verb',
  seamless: 'what actually connects, e.g. "syncs with Google Calendar every 5 minutes"',
  seamlessly: 'what actually connects, e.g. "syncs with Google Calendar every 5 minutes"',
  'cutting-edge': 'the specific technology or what it enables',
  'game-changing': 'the concrete before and after',
  unlock: 'a plain verb such as "get", "open" or "use"',
  unlocks: 'a plain verb such as "gets", "opens" or "uses"',
  unlocking: 'a plain verb such as "getting" or "using"',
  supercharge: 'the measurable gain, e.g. "cut review time from 2 days to 3 hours"',
  supercharged: 'the measurable gain, e.g. "cut review time from 2 days to 3 hours"',
  effortless: 'how many steps or clicks it takes',
  effortlessly: 'how many steps or clicks it takes',
  'world-class': 'a verifiable proof point such as an award, certification or customer count',
  'next-generation': 'what is new compared with the last version',
  leverage: '"use"',
  leverages: '"uses"',
  leveraging: '"using"',
  synergy: 'who works with whom and what they get out of it',
  synergies: 'who works with whom and what they get out of it',
  'best-in-class': 'a benchmark result or a named comparison',
};
const HYPE_RE = new RegExp(`(?<![\\w-])(${Object.keys(HYPE).sort((a, b) => b.length - a.length).map(w => w.replace(/-/g, '[-\\u2011]')).join('|')})(?![\\w-])`, 'gi');

const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'nor', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'is', 'vs', 'via', 'into', 'over', 'per', 'up']);
const NEXT_STEP = /\b(?:try (?:again|later|once more|reloading|a different)|retry|check (?:your|the|that|and)|contact|refresh|reload|go back|click|tap|select|choose|ensure|make sure|wait|reconnect|restart|(?:sign|log) in again|please (?:try|check|contact|refresh|reload|retry|wait|restart|reconnect|sign|log|go))\b/i;
const MAX_DEPTH = 512;
const MONTHS = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const DATE_RE = new RegExp(`\\b(\\d{4}-\\d{2}-\\d{2}|(?:${MONTHS})\\.? \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}|\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})\\.?,? \\d{4}|\\d{1,2}/\\d{1,2}/\\d{2,4})\\b`, 'gi');

const snip = s => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > 120 ? t.slice(0, 117) + '...' : t; };
/** Newline offsets computed once per text; the returned function maps an index to a 1-based line by binary search. */
const lineIndex = text => {
  const nl = [];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) nl.push(i);
  return idx => { let lo = 0, hi = nl.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < idx) lo = mid + 1; else hi = mid; } return lo + 1; };
};
const blank = s => s.replace(/[^\n]/g, ' ');

/** Words that make a heading Title Case: capitalised plain words (not acronyms, not camel-case like GitHub). */
export function isTitleCase(raw) {
  const words = raw.replace(/[`*_~[\]()]/g, ' ').split(/\s+/).map(w => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')).filter(Boolean);
  if (words.length < 3) return false;
  const cap = w => /^[A-Z][a-z']+$/.test(w);
  const special = w => /^[A-Z0-9]{2,}s?$/.test(w) || /^[a-z]+[A-Z]/.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w) || /\d/.test(w);
  let caps = 0, capsAfterFirst = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (special(w)) continue;
    if (cap(w)) { caps++; if (i > 0) capsAfterFirst++; }
    else if (!SMALL.has(w.toLowerCase())) return false; // a significant lowercase word: sentence case
  }
  return caps >= 3 && capsAfterFirst >= 2;
}

/** Strip scripts, styles and tags from HTML, keeping every newline so line numbers hold. */
export function htmlToText(html) {
  const n = html.length;
  let out = '', last = 0, pos = html.indexOf('<');
  const cut = (from, to) => { out += html.slice(last, from) + blank(html.slice(from, to)); last = to; };
  const styleClose = /<\/(script|style)\s*>/gi;
  while (pos >= 0 && pos < n) {
    let end = -1;
    const m = /^<(script|style)\b/i.exec(html.slice(pos, pos + 10));
    if (m) {
      styleClose.lastIndex = pos;
      let c;
      while ((c = styleClose.exec(html)) && c[1].toLowerCase() !== m[1].toLowerCase());
      end = c ? c.index + c[0].length : n; // unclosed: blank to the end once and stop
    } else if (html.startsWith('<!--', pos)) {
      const c = html.indexOf('-->', pos + 4);
      end = c < 0 ? n : c + 3;
    } else {
      const gt = html.indexOf('>', pos + 1);
      if (gt < 0) break; // no later '>' anywhere: no more tags
      end = gt + 1;
    }
    cut(pos, end);
    pos = end >= n ? -1 : html.indexOf('<', end);
  }
  return out + html.slice(last);
}

function headings(text, isHtml) {
  const out = []; // { idx, text }
  if (isHtml) {
    const open = /<(h[1-6]|button|a)\b([^<>]*)>/gi;
    const closers = new Map(); // tag -> regex, or null once a scan found no closer anywhere later
    let m;
    while ((m = open.exec(text))) {
      const tag = m[1].toLowerCase();
      if (tag === 'a' && !/class\s*=\s*["'][^"']*btn[^"']*["']/i.test(m[2])) continue;
      if (!closers.has(tag)) closers.set(tag, new RegExp(`<\\/${tag}\\s*>`, 'gi'));
      const cre = closers.get(tag);
      if (!cre) continue;
      cre.lastIndex = open.lastIndex;
      const c = cre.exec(text);
      if (!c) { closers.set(tag, null); continue; }
      out.push({ idx: m.index, text: text.slice(open.lastIndex, c.index).replace(/<[^<>]*>/g, ' ') });
      open.lastIndex = c.index + c[0].length;
    }
  }
  let off = 0, fence = false;
  for (const ln of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(ln)) fence = !fence;
    else if (!fence) {
      const m = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(ln);
      if (m) out.push({ idx: off, text: m[1] });
    }
    off += ln.length + 1;
  }
  return out;
}

/** Lint one string of text. `isHtml` strips markup first. Returns findings with 1-based lines. */
export function lintText(text, { rules = RULES, isHtml = false } = {}) {
  const on = new Set(rules);
  const findings = [];
  const body = (isHtml ? htmlToText(text) : text).replace(/https?:\/\/[^\s)>"']+/g, blank).replace(/\]\([^)\n]{0,2000}\)/g, blank);
  const lineBody = lineIndex(body);
  let lineText;
  const add = (rule, idx, t, hint, src) => findings.push({ rule, line: src === body ? lineBody(idx) : (lineText ||= lineIndex(text))(idx), text: snip(t), hint });
  const scan = (rule, re, hintFor, test) => {
    if (!on.has(rule)) return;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body))) { if (!test || test(m)) add(rule, m.index, m[0], hintFor(m), body); }
  };

  scan('lorem', /\b(?:lorem ipsum(?: dolor(?: sit(?: amet)?)?)?|dolor sit amet|consectetur adipiscing)\b/gi,
    () => 'Replace the filler with a real sentence in the product voice, e.g. what this section tells a customer to do next.');
  scan('placeholder-person', /\b(John|Jane) Doe\b|\bFoo Bar\b|\bTest User\b/g,
    () => 'Use a full realistic name that suits the audience, e.g. "Maya Okafor, operations lead at a 40-person logistics firm".');
  scan('placeholder-company', /\bAcme\b(?: (?:Corp(?:oration)?|Inc|Co|Ltd|LLC)\b\.?)?|\bExample (?:Inc|Corp|Co|LLC|Ltd)\b\.?/g,
    () => 'Invent a company name that fits the industry, e.g. "Harbor Freight Analytics" for logistics or "Linden Dental" for healthcare.');
  scan('hype', HYPE_RE, m => `Replace "${m[0]}" with ${HYPE[m[0].toLowerCase().replace(/‑/g, '-')] || 'a specific, checkable claim'}.`);

  if (on.has('round-figure')) {
    const pct = /(?<![\w.])(\d{1,3})%/g;
    let m;
    while ((m = pct.exec(body))) {
      const n = Number(m[1]);
      if (n >= 10 && n % 10 === 0) add('round-figure', m.index, m[0], `"${m[0]}" looks invented; use a believable figure such as ${n > 10 ? n - 3 : n + 3}% (or a measured value like ${n - 0.6 > 0 ? (n - 0.6).toFixed(1) : '9.4'}%).`, body);
    }
    const num = /(?<![\w.#,$€£¥-])([$€£¥]?)(?!0\d)(\d{1,3}(?:,\d{3})+|\d+)(?![\w%]|\.\d|,\d)/g;
    while ((m = num.exec(body))) {
      const n = Number(m[2].replace(/,/g, ''));
      const plainYear = !m[1] && !m[2].includes(',') && n >= 1900 && n <= 2099;
      const before = body.slice(Math.max(0, m.index - 24), m.index);
      const after = body.slice(m.index + m[0].length, m.index + m[0].length + 6);
      const statusCode = !m[1] && (/\b(?:error|status|http|code)s?\s*[:#=]?\s*$/i.test(before) || /^\s*OK\b/.test(after));
      const smallPrice = m[1] && n < 1000;
      if (n >= 100 && n % 100 === 0 && !plainYear && !statusCode && !smallPrice) {
        const alt = Math.round(n * 0.97 / 7) * 7 + 3;
        add('round-figure', m.index, m[0], `"${m[0]}" is suspiciously round; use a believable figure such as ${m[1]}${alt.toLocaleString('en-US')}.`, body);
      }
    }
  }

  if (on.has('repeated-date')) {
    const seen = new Map();
    DATE_RE.lastIndex = 0;
    let m;
    while ((m = DATE_RE.exec(body))) {
      const k = m[0].toLowerCase().replace(/\s+/g, ' ');
      const e = seen.get(k) || { first: m.index, text: m[0], n: 0 };
      e.n++; seen.set(k, e);
    }
    for (const e of seen.values()) {
      if (e.n >= 3) add('repeated-date', e.first, e.text, `"${e.text}" appears ${e.n} times; spread sample dates across realistic days and times (e.g. vary the day by 1 to 9 days).`, body);
    }
  }

  if (on.has('vague-error')) {
    const re = /\b(something went wrong|an error (?:has )?occurred|an unknown error|an unexpected error)\b/gi;
    let m;
    while ((m = re.exec(body))) {
      const end = m.index + m[0].length;
      const nl1 = body.indexOf('\n', end);
      const nl2 = nl1 < 0 ? -1 : body.indexOf('\n', nl1 + 1);
      const from = end; // only imperative phrases count, so words that describe the failure are not a next step
      const rest = body.slice(from, nl2 < 0 ? undefined : nl2);
      if (!NEXT_STEP.test(rest)) add('vague-error', m.index, m[0], 'Say what failed and what to do next, e.g. "We couldn\'t save your changes. Check your connection and try again."', body);
    }
  }

  if (on.has('title-case')) {
    for (const h of headings(text, isHtml)) {
      if (isTitleCase(h.text)) add('title-case', h.idx, h.text, `Use sentence case: "${sentenceCase(h.text)}".`, text);
    }
  }
  return findings.sort((a, b) => a.line - b.line || RULES.indexOf(a.rule) - RULES.indexOf(b.rule));
}

function sentenceCase(t) {
  const words = t.replace(/\s+/g, ' ').trim().split(' ');
  return words.map((w, i) => (/^[A-Z][a-z']+$/.test(w) && i > 0 ? w.toLowerCase() : w)).join(' ');
}

/** Walk JSON, scanning every string value; every finding's line is where that string starts in the raw text. */
export function lintJson(raw, data, opts) {
  const findings = [];
  const n = raw.length;
  let i = 0, line = 1;
  const ws = () => { while (i < n) { const c = raw.charCodeAt(i); if (c === 10) line++; else if (c !== 32 && c !== 9 && c !== 13) break; i++; } };
  const str = () => { // at the opening quote; returns the raw token and the line it starts on
    const start = i, startLine = line;
    i++;
    while (i < n && raw[i] !== '"') i += raw[i] === '\\' ? 2 : 1;
    i++;
    return { tok: raw.slice(start, i), line: startLine };
  };
  const value = depth => {
    if (depth > MAX_DEPTH) throw bad(`input JSON is nested too deeply (over ${MAX_DEPTH} levels)`);
    ws();
    const c = raw[i];
    if (c === '"') {
      const { tok, line: at } = str();
      for (const f of lintText(JSON.parse(tok), { ...opts, isHtml: /<\/?[a-z][^<>]*>/i.test(JSON.parse(tok)) })) findings.push({ ...f, line: at });
    } else if (c === '[' || c === '{') {
      const obj = c === '{';
      i++; ws();
      while (i < n && raw[i] !== (obj ? '}' : ']')) {
        if (obj) { ws(); str(); ws(); i++; } // key, then ':'
        value(depth + 1); ws();
        if (raw[i] === ',') { i++; ws(); }
      }
      i++;
    } else while (i < n && !/[\s,\]}]/.test(raw[i])) i++;
  };
  value(0);
  return findings.sort((a, b) => a.line - b.line);
}

export function parseRules(spec) {
  if (spec === undefined) return [...RULES];
  const list = String(spec).split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) throw bad('--rules needs a comma-separated list of: ' + RULES.join(', '));
  for (const r of list) if (!RULES.includes(r)) throw bad(`unknown rule "${r}" (known: ${RULES.join(', ')})`);
  return [...new Set(list)];
}

function parse(args) {
  const [sub, ...rest] = args;
  if (sub !== 'lint') throw bad(`usage: ${usage}`);
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a !== '--file' && a !== '--rules' && a !== '--format') throw bad(`unknown argument "${a}" (usage: ${usage})`);
    const v = rest[++i];
    if (v === undefined || v === '' || v.startsWith('--')) throw bad(`${a} needs a non-empty value`);
    if (Object.hasOwn(flags, a.slice(2))) throw bad(`${a} was given more than once`);
    flags[a.slice(2)] = v;
  }
  return flags;
}

const FENCE_RE = /^[ \t]*(```|~~~)[\s\S]*?(?:^[ \t]*\1.*$|(?![\s\S]))/gm;
const TAG_RE = /<(?:!doctype\b|!--|\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>)/i;

/** Decide the format from the text alone (fenced code ignored); never from a file name or how the text arrived. */
export function detectFormat(raw) {
  const t = raw.trimStart();
  if (/^[[{]/.test(t)) { try { const v = JSON.parse(raw); if (v && typeof v === 'object') return 'json'; } catch { /* not JSON */ } }
  return TAG_RE.test(raw.replace(FENCE_RE, blank)) ? 'html' : 'md';
}

export function lint(raw, { rules = RULES, name = '', format } = {}) {
  if (format !== undefined && !FORMATS.includes(format)) throw bad(`unknown format "${format}" (known: ${FORMATS.join(', ')})`);
  const ext = path.extname(name).toLowerCase();
  const fmt = format || (ext === '.json' ? 'json' : ext === '.html' || ext === '.htm' ? 'html' : detectFormat(raw)); // a name is only a caller-supplied hint; run() never passes one
  let findings;
  if (fmt === 'json') {
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw bad(`input is not valid JSON: ${e.message}`); }
    findings = lintJson(raw, data, { rules });
  } else {
    findings = lintText(raw, { rules, isHtml: fmt === 'html' });
  }
  const counts = { total: findings.length };
  for (const r of rules) counts[r] = 0;
  for (const f of findings) counts[f.rule]++;
  return { findings, counts, format: fmt };
}

const DEVICE_PATH = /^\/(?:dev|proc)(?:\/|$)/;

async function readBounded(file) {
  let real;
  try { real = await fs.realpath(file); } catch (e) { throw bad(`cannot read ${file}: ${e.code || e.message}`); }
  if (DEVICE_PATH.test(file) || DEVICE_PATH.test(real)) throw bad(`${file} is not a regular file (devices and /proc are refused)`);
  let fh;
  try { fh = await fs.open(file, FS.O_RDONLY | FS.O_NONBLOCK); } catch (e) { throw bad(`cannot read ${file}: ${e.code || e.message}`); }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw bad(`${file} is not a file`);
    if (st.size > MAX_BYTES) throw bad('input is over 8 MiB');
    const buf = Buffer.alloc(Math.min(st.size, MAX_BYTES) + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    return buf.subarray(0, n);
  } catch (e) { if (e instanceof KitExit) throw e; throw bad(`cannot read ${file}: ${e.code || e.message}`); } finally { await fh.close(); }
}

function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    const sw = Buffer.from(buf.subarray(2));
    if (sw.length % 2) throw bad('input is truncated UTF-16; save it as UTF-8');
    return sw.swap16().toString('utf16le');
  }
  return buf.toString('utf-8');
}

export async function run(args, io) {
  const flags = parse(args);
  const rules = parseRules(flags.rules);
  if (flags.format !== undefined && !FORMATS.includes(flags.format)) throw bad(`unknown format "${flags.format}" (known: ${FORMATS.join(', ')})`);
  const cwd = io.cwd || process.cwd();
  let buf;
  if (flags.file !== undefined) {
    const file = path.resolve(cwd, flags.file);
    buf = await readBounded(file);
  } else {
    if (io.stdinIsTTY) throw bad('no input: pass --file <f> or text on stdin');
    const got = await (typeof io.stdinBytes === 'function' ? io.stdinBytes : io.stdin)({ maxBytes: MAX_BYTES + 1 });
    buf = Buffer.isBuffer(got) ? got : Buffer.from(String(got), 'utf-8');
  }
  if (buf.length > MAX_BYTES) throw bad('input is over 8 MiB');
  const raw = decodeText(buf).replace(/^\uFEFF/, '').replace(/\r(?!\n)/g, '\n');
  if (!raw.trim()) throw bad('no input: the file or stdin is empty');
  const r = lint(raw, { rules, format: flags.format });
  return { file: flags.file ?? null, format: r.format, rules, findings: r.findings, counts: r.counts };
}
