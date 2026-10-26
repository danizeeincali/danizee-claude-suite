/**
 * word-reveal — emit a tagline whose words brighten one after another, in reading order, as it scrolls into view;
 * and lint scripts for scroll listeners that are not throttled to animation frames.
 *
 *   word-reveal emit --text-file <f> [--muted 0.25] [--stagger-ms 60] [--trigger 0.6] [--easing <css>]   → { raw }
 *   word-reveal lint --file <js|html>                                                                    → { findings, counts }
 *
 * emit prints one self-contained HTML fragment: a <p> with one <span> per word, a <style> and a <script>. Each word
 * starts at the muted opacity; once the block crosses the trigger line (a fraction of the viewport height measured
 * from the top) an IntersectionObserver fires once and the words switch on in reading order, `stagger` ms apart, each
 * fading on the shared easing curve. Under prefers-reduced-motion (or with no IntersectionObserver) every word shows
 * at once. There is no scroll listener. Each fragment's script drives only its own <p>. The text is HTML-escaped; the
 * numeric options are validated (stagger-ms at most 10000) and the easing must be a whitelisted CSS timing function
 * (it lands inside a style block). Invalid input is KitExit 1.
 * For HTML input (first non-blank character "<") lint reads only <script> contents; <!-- --> comments are dropped.
 * lint is advisory (exit 0): each addEventListener('scroll' ...) whose handler has no requestAnimationFrame or
 * throttle/debounce is a finding.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import { constants as FS } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'word-reveal';
export const usage = 'cli.js word-reveal emit [--text-file <f>] [--muted 0.25] [--stagger-ms 60] [--trigger 0.6] [--easing <css>] | word-reveal lint [--file <js|html>]  (stdin when the file flag is absent)';

export const DEFAULTS = { muted: 0.25, staggerMs: 60, trigger: 0.6, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_WORDS = 5000;
const MAX_STAGGER_MS = 10000; // 5000 words x 10 s stays far below the 2^31-1 ms setTimeout limit
const bad = m => new KitExit(m, 1);

/** Escape text for HTML element content and attribute values. */
export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const EASE_KEYWORDS = new Set(['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end']);
const NUM = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const STOP = `${NUM}(?:\\s+${NUM}%){0,2}`;
const CUBIC_RE = new RegExp(`^cubic-bezier\\(\\s*${NUM}(?:\\s*,\\s*${NUM}){3}\\s*\\)$`, 'i');
const STEPS_RE = /^steps\(\s*[1-9]\d*\s*(?:,\s*(?:jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/i;
const LINEAR_RE = new RegExp(`^linear\\(\\s*${STOP}(?:\\s*,\\s*${STOP})*\\s*\\)$`, 'i');

/** True only for a CSS easing keyword, cubic-bezier(n,n,n,n), steps(n[, position]) or linear(stops). */
export function isEasing(s) {
  if (typeof s !== 'string' || s.length > 1000) return false;
  return EASE_KEYWORDS.has(s.toLowerCase()) || CUBIC_RE.test(s) || STEPS_RE.test(s) || LINEAR_RE.test(s);
}

/** Validate options and fill defaults; returns { muted, staggerMs, trigger, easing }. */
export function normalizeOptions(o = {}) {
  const num = (name, v, def) => {
    if (v === undefined) return def;
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    if (!Number.isFinite(n)) throw bad(`${name} must be a number`);
    return n;
  };
  const muted = num('muted', o.muted, DEFAULTS.muted);
  if (muted < 0 || muted > 1) throw bad('muted must be between 0 and 1');
  const staggerMs = num('stagger-ms', o.staggerMs, DEFAULTS.staggerMs);
  if (staggerMs < 0) throw bad('stagger-ms must be 0 or more');
  if (staggerMs > MAX_STAGGER_MS) throw bad(`stagger-ms must be at most ${MAX_STAGGER_MS}`);
  const trigger = num('trigger', o.trigger, DEFAULTS.trigger);
  if (trigger < 0 || trigger > 1) throw bad('trigger must be between 0 and 1');
  let easing = o.easing === undefined ? DEFAULTS.easing : o.easing;
  if (typeof easing !== 'string' || !easing.trim()) throw bad('easing must be a non-empty CSS timing function');
  easing = easing.trim();
  if (!isEasing(easing)) throw bad('easing is not allowed: use ease, linear, ease-in, ease-out, ease-in-out, step-start, step-end, cubic-bezier(n, n, n, n), steps(n[, position]) or linear(stops)');
  return { muted, staggerMs, trigger, easing };
}

/** Split a tagline into words on ASCII whitespace (U+00A0 and other Unicode spaces stay inside a word). */
export function splitWords(text) {
  const words = String(text).replace(/^﻿/, '').split(/[ \t\r\n\f\v]+/).filter(Boolean);
  if (!words.length) throw bad('text is empty: the tagline needs at least one word');
  if (words.length > MAX_WORDS) throw bad(`text has ${words.length} words; the limit is ${MAX_WORDS}`);
  return words;
}

/** Build the fragment for a tagline. */
export function emitFragment(text, options = {}) {
  const { muted, staggerMs, trigger, easing } = normalizeOptions(options);
  const words = splitWords(text);
  const spans = words.map(w => `<span class="wr-w">${escapeHtml(w)}</span>`).join(' ');
  const sentence = words.map(escapeHtml).join(' ');
  const rootMargin = `0px 0px -${Math.round((1 - trigger) * 10000) / 100}% 0px`;
  const css = [
    '.wr{position:relative;font-size:clamp(2rem,6vw,4.5rem);line-height:1.15;font-weight:600;margin:0}',
    '.wr-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}',
    `.wr-js .wr-w{opacity:${muted};transition:opacity 500ms ${easing}}`,
    '.wr-js .wr-w.wr-on{opacity:1}',
    '@media (prefers-reduced-motion:reduce){.wr-js .wr-w{opacity:1;transition:none}}'
  ].join('\n');
  const js = [
    '(function(){',
    `var STAGGER=${staggerMs},MARGIN=${JSON.stringify(rootMargin)};`,
    // This fragment's own <p>: the nearest earlier sibling of this <script> with data-word-reveal; without currentScript,
    // the first block no script has claimed yet. Other taglines on the page are left alone.
    'var me=document.currentScript,root=null,el=me&&me.previousElementSibling;',
    'while(el){if(el.hasAttribute&&el.hasAttribute("data-word-reveal")){root=el;break;}el=el.previousElementSibling;}',
    'if(!root){var rs=document.querySelectorAll("[data-word-reveal]");for(var q=0;q<rs.length;q++){if(!rs[q].__wr){root=rs[q];break;}}}',
    'if(!root||root.__wr)return;root.__wr=1;',
    'var reduce=typeof matchMedia==="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches;',
    'function on(w){w.classList.add("wr-on");}',
    'function all(p){var ws=p.querySelectorAll(".wr-w");for(var i=0;i<ws.length;i++)on(ws[i]);}',
    'function seq(p){var ws=p.querySelectorAll(".wr-w");for(var i=0;i<ws.length;i++){(function(w,d){if(d>0)setTimeout(function(){on(w);},d);else on(w);})(ws[i],i*STAGGER);}}',
    'function passed(e){var r=e.boundingClientRect;if(!r)return false;var rb=e.rootBounds;return r.top<(rb?rb.top:0);}',
    'if(reduce||typeof IntersectionObserver!=="function"){all(root);return;}',
    'var io=new IntersectionObserver(function(es){for(var j=0;j<es.length;j++){if(es[j].isIntersecting||passed(es[j])){io.unobserve(es[j].target);seq(es[j].target);}}},{rootMargin:MARGIN,threshold:0});',
    'root.classList.add("wr-js");io.observe(root);',
    '})();'
  ].join('\n');
  return `<p class="wr" data-word-reveal><span class="wr-sr">${sentence}</span><span aria-hidden="true">${spans}</span></p>\n<style>\n${css}\n</style>\n<script>\n${js}\n</script>\n`;
}

// ---- lint ----

const CALL_RE = /\b(?:requestAnimationFrame|rAF|throttle|debounce)\s*\(/gi;

/** Blank comments (and, when `strings`, string literals) with spaces, keeping length and newlines. Linear. */
function blank(src, strings) {
  const out = [];
  let last = 0, i = 0;
  const cut = (a, b) => { out.push(src.slice(last, a), src.slice(a, b).replace(/[^\n]/g, ' ')); last = b; };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { let e = src.indexOf('\n', i); if (e < 0) e = src.length; cut(i, e); i = e; }
    else if (c === '/' && src[i + 1] === '*') { let e = src.indexOf('*/', i + 2); e = e < 0 ? src.length : e + 2; cut(i, e); i = e; }
    else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && (c === '`' || src[j] !== '\n')) j += src[j] === '\\' ? 2 : 1;
      const e = Math.min(j + 1, src.length);
      if (strings) cut(i + 1, Math.max(i + 1, e - 1));
      i = e;
    } else i++;
  }
  out.push(src.slice(last));
  return out.join('');
}

/** For every ( and { the index of its matching close of the same kind (-1 when unbalanced). One pass. */
function matchMap(src) {
  const close = new Map();
  const st = { '(': [], '{': [] };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '{') st[c].push(i);
    else if (c === ')' && st['('].length) close.set(st['('].pop(), i);
    else if (c === '}' && st['{'].length) close.set(st['{'].pop(), i);
  }
  return close;
}

function lowerBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; }

const isHtml = s => /^﻿?\s*</.test(s);

/**
 * HTML input: keep only the contents of <script> elements and blank everything else (markup, text, <!-- --> comments)
 * with spaces, so offsets and line numbers stay. One forward pass; every indexOf starts past the previous one.
 */
export function scriptsOnly(src) {
  const lower = src.replace(/[A-Z]+/g, t => t.toLowerCase()); // ASCII only: same length as src
  const findScript = from => {
    for (let k = lower.indexOf('<script', from); k >= 0; k = lower.indexOf('<script', k + 1)) if (/[\s>/]/.test(lower[k + 7] || '')) return k;
    return -1;
  };
  const ranges = [];
  let i = 0, c = -2, s = -2;
  while (i < src.length) {
    if (c !== -1 && c < i) c = lower.indexOf('<!--', i);
    if (s !== -1 && s < i) s = findScript(i);
    if (s < 0 && c < 0) break;
    if (c >= 0 && (s < 0 || c < s)) { const e = lower.indexOf('-->', c + 4); i = e < 0 ? src.length : e + 3; continue; }
    const gt = lower.indexOf('>', s + 7);
    if (gt < 0) break;
    const end = lower.indexOf('</script', gt + 1);
    ranges.push([gt + 1, end < 0 ? src.length : end]);
    i = end < 0 ? src.length : end + 8;
  }
  const sp = t => t.replace(/[^\n]/g, ' ');
  const out = [];
  let last = 0;
  for (const [a, b] of ranges) { out.push(sp(src.slice(last, a)), src.slice(a, b)); last = b; }
  out.push(sp(src.slice(last)));
  return out.join('');
}

/** Findings for scroll listeners without frame throttling. Comments and strings are ignored; linear in the input. */
export function lintScroll(src) {
  const findings = [];
  const code = isHtml(src) ? scriptsOnly(src) : src; // HTML: only <script> contents are code
  const noC = blank(code, false);      // comments blanked, strings kept (to see 'scroll')
  const clean = blank(code, true);     // comments and string contents blanked
  const close = matchMap(clean);
  const calls = [];
  CALL_RE.lastIndex = 0;
  for (let c; (c = CALL_RE.exec(clean));) calls.push(c.index);
  const hasCall = (a, b) => { const k = lowerBound(calls, a); return k < calls.length && calls[k] < b; };
  const nl = [];
  for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) nl.push(i);
  const wrapped = new Set();           // const h = throttle(...) / debounce(...): throttled at its definition
  const wrapRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:requestAnimationFrame|rAF|throttle|debounce)\s*\(/gi;
  for (let w; (w = wrapRe.exec(clean));) wrapped.add(w[1]);
  const defs = new Map();
  const defRe = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]{0,500}\)\s*\{|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;{]{0,300}?(?:=>|function[^{]{0,300})\s*\{/g;
  for (let d; (d = defRe.exec(clean));) {
    const name = d[1] || d[2];
    if (defs.has(name)) continue;
    const open = d.index + d[0].length - 1;
    const end = close.has(open) ? close.get(open) + 1 : clean.length;
    defs.set(name, [open, end]);
  }
  const re = /addEventListener\s*\(\s*(['"`])scroll\1\s*,/g;
  let m;
  while ((m = re.exec(noC))) {
    const open = m.index + m[0].indexOf('(');
    const hs = m.index + m[0].length;
    const he = close.has(open) ? close.get(open) + 1 : clean.length;
    let throttled = hasCall(hs, he);
    if (!throttled) {
      const idRe = /\s*([A-Za-z_$][\w$]*)\s*[,)]/y;
      idRe.lastIndex = hs;
      const id = idRe.exec(clean);
      if (id && wrapped.has(id[1])) throttled = true;
      else if (id && defs.has(id[1])) { const [a, b] = defs.get(id[1]); throttled = hasCall(a, b); }
    }
    if (!throttled) {
      const k = lowerBound(nl, m.index);          // newlines before the hit
      const line = k + 1;
      const from = k ? nl[k - 1] + 1 : 0;
      findings.push({
        rule: 'unthrottled-scroll-listener', line,
        text: src.slice(from, k < nl.length ? nl[k] : src.length).trim().slice(0, 200),
        hint: 'wrap the work in requestAnimationFrame (one frame at a time) or use IntersectionObserver instead of reading layout on every scroll event'
      });
    }
  }
  return { findings, counts: { findings: findings.length } };
}

// ---- CLI ----

function parse(args) {
  const [sub, ...rest] = args;
  if (sub !== 'emit' && sub !== 'lint') throw bad(`word-reveal needs a subcommand: emit or lint\n${usage}`);
  const known = sub === 'emit' ? ['text-file', 'muted', 'stagger-ms', 'trigger', 'easing'] : ['file'];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"`);
    const k = a.slice(2);
    if (!known.includes(k)) throw bad(`unknown option "${a}" for ${sub} (allowed: ${known.map(x => '--' + x).join(', ')})`);
    if (Object.prototype.hasOwnProperty.call(flags, k)) throw bad(`${a} given twice`);
    if (i + 1 >= rest.length) throw bad(`${a} needs a value`);
    const v = rest[++i];
    if (v === '') throw bad(`${a} has an empty value`);
    if (v.startsWith('--')) throw bad(`${a} needs a value, got "${v}"`);
    flags[k] = v;
  }
  return { sub, flags };
}

/** Regular file only, read with a bounded read of at most MAX_BYTES + 1 bytes. */
async function readFileCapped(cwd, file, label) {
  const p = path.resolve(cwd, file);
  const special = q => /^\/(?:dev|proc)(?:\/|$)/.test(q);
  let real = p;
  try { real = await fs.realpath(p); } catch { /* a missing path is reported by open */ }
  if (special(p) || special(real)) throw bad(`${label} ${p} is not a regular file (paths under /dev/ and /proc/ are refused)`);
  let h;
  try { h = await fs.open(p, FS.O_RDONLY | FS.O_NONBLOCK); } catch (e) { throw bad(`cannot read ${label} ${p}: ${e.code || e.message}`); }
  try {
    if (!(await h.stat()).isFile()) throw bad(`${label} ${p} is not a regular file`);
    const buf = Buffer.alloc(Math.min(MAX_BYTES + 1, 1 << 16));
    const chunks = [];
    let total = 0;
    while (total < MAX_BYTES + 1) {
      const { bytesRead } = await h.read(buf, 0, Math.min(buf.length, MAX_BYTES + 1 - total), null);
      if (!bytesRead) break;
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
      total += bytesRead;
    }
    if (total > MAX_BYTES) throw bad(`${label} is larger than 8 MiB`);
    return Buffer.concat(chunks).toString('utf-8');
  } catch (e) {
    if (e instanceof KitExit) throw e;
    throw bad(`cannot read ${label} ${p}: ${e.code || e.message}`);
  } finally { await h.close(); }
}

async function readStdinCapped(io, what) {
  if (io.stdinIsTTY || typeof io.stdinBytes !== 'function') throw bad(`${what} (or pipe the input on stdin)`);
  const buf = Buffer.from(await io.stdinBytes({ maxBytes: MAX_BYTES + 1 }));
  if (buf.length > MAX_BYTES) throw bad('stdin is larger than 8 MiB');
  return buf.toString('utf-8');
}

export async function run(args, io = {}) {
  const { sub, flags } = parse(args);
  const cwd = io.cwd || process.cwd();
  if (sub === 'emit') {
    const text = flags['text-file'] === undefined
      ? await readStdinCapped(io, 'emit needs --text-file <f>')
      : await readFileCapped(cwd, flags['text-file'], 'text-file');
    return { raw: emitFragment(text, { muted: flags.muted, staggerMs: flags['stagger-ms'], trigger: flags.trigger, easing: flags.easing }) };
  }
  const src = flags.file === undefined
    ? await readStdinCapped(io, 'lint needs --file <js|html>')
    : await readFileCapped(cwd, flags.file, 'file');
  return lintScroll(src);
}
