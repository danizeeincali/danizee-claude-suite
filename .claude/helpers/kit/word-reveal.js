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
 * at once. There is no scroll listener. The text is HTML-escaped; the numeric options are validated and the easing
 * may not contain ; { } < > (it lands inside a style block). Invalid input is KitExit 1.
 * lint is advisory (exit 0): each addEventListener('scroll' ...) whose handler has no requestAnimationFrame or
 * throttle/debounce is a finding.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'word-reveal';
export const usage = 'cli.js word-reveal emit --text-file <f> [--muted 0.25] [--stagger-ms 60] [--trigger 0.6] [--easing <css>] | word-reveal lint --file <js|html>';

export const DEFAULTS = { muted: 0.25, staggerMs: 60, trigger: 0.6, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_WORDS = 5000;
const bad = m => new KitExit(m, 1);

/** Escape text for HTML element content and attribute values. */
export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  const trigger = num('trigger', o.trigger, DEFAULTS.trigger);
  if (trigger < 0 || trigger > 1) throw bad('trigger must be between 0 and 1');
  let easing = o.easing === undefined ? DEFAULTS.easing : o.easing;
  if (typeof easing !== 'string' || !easing.trim()) throw bad('easing must be a non-empty CSS timing function');
  if (/[;{}<>]/.test(easing)) throw bad('easing must not contain ; { } < or >');
  if (/[\u0000-\u001f]/.test(easing)) throw bad('easing must not contain control characters');
  easing = easing.trim();
  return { muted, staggerMs, trigger, easing };
}

/** Split a tagline into words on any whitespace. */
export function splitWords(text) {
  const words = String(text).replace(/^﻿/, '').split(/\s+/).filter(Boolean);
  if (!words.length) throw bad('text is empty: the tagline needs at least one word');
  if (words.length > MAX_WORDS) throw bad(`text has ${words.length} words; the limit is ${MAX_WORDS}`);
  return words;
}

/** Build the fragment for a tagline. */
export function emitFragment(text, options = {}) {
  const { muted, staggerMs, trigger, easing } = normalizeOptions(options);
  const words = splitWords(text);
  const spans = words.map(w => `<span class="wr-w">${escapeHtml(w)}</span>`).join(' ');
  const rootMargin = `0px 0px -${Math.round((1 - trigger) * 10000) / 100}% 0px`;
  const css = [
    '.wr{font-size:clamp(2rem,6vw,4.5rem);line-height:1.15;font-weight:600;margin:0}',
    `.wr-w{opacity:${muted};transition:opacity 500ms ${easing}}`,
    '.wr-w.wr-on{opacity:1}',
    '@media (prefers-reduced-motion:reduce){.wr-w{opacity:1;transition:none}}'
  ].join('\n');
  const js = [
    '(function(){',
    `var STAGGER=${staggerMs},MARGIN=${JSON.stringify(rootMargin)};`,
    'var roots=document.querySelectorAll("[data-word-reveal]");',
    'var reduce=typeof matchMedia==="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches;',
    'function on(w){w.classList.add("wr-on");}',
    'function all(p){var ws=p.querySelectorAll(".wr-w");for(var i=0;i<ws.length;i++)on(ws[i]);}',
    'function seq(p){var ws=p.querySelectorAll(".wr-w");for(var i=0;i<ws.length;i++){(function(w,d){if(d>0)setTimeout(function(){on(w);},d);else on(w);})(ws[i],i*STAGGER);}}',
    'if(reduce||typeof IntersectionObserver!=="function"){for(var k=0;k<roots.length;k++)all(roots[k]);return;}',
    'var io=new IntersectionObserver(function(es){for(var j=0;j<es.length;j++){if(es[j].isIntersecting){io.unobserve(es[j].target);seq(es[j].target);}}},{rootMargin:MARGIN,threshold:0});',
    'for(var m=0;m<roots.length;m++)io.observe(roots[m]);',
    '})();'
  ].join('\n');
  return `<p class="wr" data-word-reveal>${spans}</p>\n<style>\n${css}\n</style>\n<script>\n${js}\n</script>\n`;
}

// ---- lint ----

const THROTTLE_RE = /requestAnimationFrame|\brAF\b|throttle|debounce/i;

function lineOf(src, idx) { return src.slice(0, idx).split('\n').length; }

/** Text from `open` (index of a bracket) to its matching close; to the end of src when unbalanced. */
function balanced(src, open) {
  const pairs = { '(': ')', '{': '}' };
  const o = src[open], c = pairs[o];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

function definitionOf(src, name) {
  const esc = name.replace(/[$]/g, '\\$');
  const re = new RegExp(`(?:function\\s+${esc}\\s*\\([^)]*\\)\\s*\\{|(?:const|let|var)\\s+${esc}\\s*=[^;{]*?(?:=>|function[^{]*)\\s*\\{)`);
  const m = re.exec(src);
  if (!m) return null;
  return balanced(src, m.index + m[0].length - 1);
}

/** Findings for scroll listeners without frame throttling. */
export function lintScroll(src) {
  const findings = [];
  const re = /addEventListener\s*\(\s*(['"`])scroll\1\s*,/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('(', m.index);
    const call = balanced(src, open);
    const handler = src.slice(m.index + m[0].length, open + call.length);
    let throttled = THROTTLE_RE.test(handler);
    if (!throttled) {
      const id = /^\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(handler);
      if (id) {
        const def = definitionOf(src, id[1]);
        throttled = def !== null && THROTTLE_RE.test(def);
      }
    }
    if (!throttled) {
      const line = lineOf(src, m.index);
      findings.push({
        rule: 'unthrottled-scroll-listener', line,
        text: src.split('\n')[line - 1].trim().slice(0, 200),
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
    if (i + 1 >= rest.length) throw bad(`${a} needs a value`);
    flags[k] = rest[++i];
  }
  return { sub, flags };
}

async function readFileCapped(cwd, file, label) {
  const p = path.resolve(cwd, file);
  let st;
  try { st = await fs.stat(p); } catch (e) { throw bad(`cannot read ${label} ${p}: ${e.code || e.message}`); }
  if (!st.isFile()) throw bad(`${label} ${p} is not a regular file`);
  if (st.size > MAX_BYTES) throw bad(`${label} is larger than 8 MiB`);
  return fs.readFile(p, 'utf-8');
}

export async function run(args, io = {}) {
  const { sub, flags } = parse(args);
  const cwd = io.cwd || process.cwd();
  if (sub === 'emit') {
    if (flags['text-file'] === undefined) throw bad('emit needs --text-file <f>');
    const text = await readFileCapped(cwd, flags['text-file'], 'text-file');
    return { raw: emitFragment(text, { muted: flags.muted, staggerMs: flags['stagger-ms'], trigger: flags.trigger, easing: flags.easing }) };
  }
  if (flags.file === undefined) throw bad('lint needs --file <js|html>');
  return lintScroll(await readFileCapped(cwd, flags.file, 'file'));
}
