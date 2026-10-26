/**
 * bg-fill — keep a photo or texture background exactly as it was designed.
 *
 *   bg-fill css   [--file <f>]                       → { css: {background-size, background-position, background-repeat}, raw_css }
 *   bg-fill guard [--file <css>] --selector <sel>    → { selector, violations: [{line, property, why}], pass, exit }   (a JUDGE)
 *
 * css: input { selector, container: {w,h}, image: {w,h}, scale_mode: FILL|FIT|TILE|STRETCH|CROP, transform?, tile_scale? }.
 * It reproduces how a design tool placed the original image fill as plain CSS sizing and offset:
 *   FILL = cover, centred; FIT = contain, centred; STRETCH = 100% 100%; TILE = the image at image*tile_scale px, repeated
 *   (tile_scale defaults to 1); CROP = the 2x3 transform [[a,b,tx],[c,d,ty]] maps the container's unit square onto the image's
 *   unit square, so the image is drawn container.w/a by container.h/d px and shifted left/up by tx and ty of its own size.
 *   A rotated, skewed, flipped or degenerate transform cannot be written as background sizing and is refused (exit 1).
 *
 * guard: reads CSS and reports every way the rules for `--selector` would animate, swap or filter the background. Exit 2 when
 * there is any violation, 0 when clean (1 only for bad input). A violation is: a @keyframes used by the selector (animation or
 * animation-name) that animates background, background-image, background-position, background-size or filter; a transition
 * on any of those (or on `all`, which includes implicit all); a hover/focus/active state, extra qualifier or media/supports
 * rule that changes the background (a flat colour or `none` in place of the image is called out); `filter` on the background
 * element; `backdrop-filter` on the background element itself (a frosted panel must be a sibling layer, so its backdrop
 * filter can see the photo). The first unconditional rule that sets the background is the design; a later rule or an
 * ancestor-qualified rule (`.dark .bg`) that changes a background property is a violation. Vendor prefixes (-webkit-filter)
 * are checked as the plain property. Rules for other selectors are ignored. Nesting deeper than 256 blocks exits 1. Comments and strings are masked before parsing, and nested
 * CSS and selector lists are understood.
 *
 * Input: a regular file (--file, opened non-blocking and checked on the handle, never under /dev or /proc; at most 8 MiB, bounded read) or stdin (counted in bytes); empty or repeated flags exit 1.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'bg-fill';
export const usage = 'cli.js bg-fill css [--file <f.json>]  (input {selector, container:{w,h}, image:{w,h}, scale_mode:FILL|FIT|TILE|STRETCH|CROP, transform?:[[a,b,tx],[c,d,ty]], tile_scale?} → {css, raw_css}; a rotated or skewed transform exits 1) | bg-fill guard [--file <f.css>] --selector <sel>  (a judge: exit 2 when the CSS animates, transitions, swaps or filters the background of that selector, or puts backdrop-filter on it; else 0)';

const MAX = 8 * 1024 * 1024;
const bad = (m) => new KitExit(m, 1);
export const SCALE_MODES = Object.freeze(['FILL', 'FIT', 'TILE', 'STRETCH', 'CROP']);

// ---------- css generation ----------

const EPS = 1e-9;
const num = (n, field = 'length') => {
  const r = Math.round(n * 10000) / 10000;
  if (!Number.isFinite(r) || Math.abs(r) >= 1e21) throw bad(`${field} is out of range: the computed CSS length is not a finite number below 1e21`);
  return String(r);
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function dims(v, field) {
  if (!isObj(v)) throw bad(`${field} must be an object {w,h}`);
  for (const k of Object.keys(v)) if (k !== 'w' && k !== 'h') throw bad(`${field}.${k} is not a known field`);
  if (!isNum(v.w) || v.w <= 0) throw bad(`${field}.w must be a positive number`);
  if (!isNum(v.h) || v.h <= 0) throw bad(`${field}.h must be a positive number`);
  return { w: v.w, h: v.h };
}

export function checkSelector(sel, field = 'selector') {
  if (typeof sel !== 'string' || !sel.trim()) throw bad(`${field} must be a non-empty string`);
  if (/[{};<\u0000-\u001f]/.test(sel)) throw bad(`${field} contains a character that cannot appear in a selector`);
  if (sel.includes('/*') || sel.includes('*/')) throw bad(`${field} must not contain a comment marker (/* or */)`);
  return sel.trim();
}

export function cssFor(input) {
  if (!isObj(input)) throw bad('input must be a JSON object');
  const allowed = ['selector', 'container', 'image', 'scale_mode', 'transform', 'tile_scale'];
  for (const k of Object.keys(input)) if (!allowed.includes(k)) throw bad(`${k} is not a known field`);
  const selector = checkSelector(input.selector);
  const container = dims(input.container, 'container');
  const image = dims(input.image, 'image');
  const mode = input.scale_mode;
  if (!SCALE_MODES.includes(mode)) throw bad(`scale_mode must be one of ${SCALE_MODES.join(', ')}`);
  if (input.transform !== undefined && mode !== 'CROP') throw bad('transform only applies to scale_mode CROP');
  if (input.tile_scale !== undefined && mode !== 'TILE') throw bad('tile_scale only applies to scale_mode TILE');
  let size, position, repeat = 'no-repeat';
  if (mode === 'FILL') { size = 'cover'; position = '50% 50%'; }
  else if (mode === 'FIT') { size = 'contain'; position = '50% 50%'; }
  else if (mode === 'STRETCH') { size = '100% 100%'; position = '0 0'; }
  else if (mode === 'TILE') {
    const s = input.tile_scale === undefined ? 1 : input.tile_scale;
    if (!isNum(s) || s <= 0) throw bad('tile_scale must be a positive number');
    size = `${num(image.w * s, 'image.w * tile_scale')}px ${num(image.h * s, 'image.h * tile_scale')}px`;
    position = '0 0';
    repeat = 'repeat';
  } else {
    const t = input.transform;
    if (!Array.isArray(t) || t.length !== 2 || t.some(r => !Array.isArray(r) || r.length !== 3 || !r.every(isNum))) throw bad('transform must be a 2x3 array of finite numbers [[a,b,tx],[c,d,ty]]');
    const [[a, b, tx], [c, d, ty]] = t;
    if (Math.abs(b) > EPS || Math.abs(c) > EPS) throw bad('transform is rotated or skewed (b and c must be 0); it cannot be written as CSS background sizing');
    if (a <= EPS || d <= EPS) throw bad('transform scale a and d must be positive (a flipped or degenerate crop is not supported)');
    const w = container.w / a, h = container.h / d;
    size = `${num(w, 'container.w / a')}px ${num(h, 'container.h / d')}px`;
    position = `${num(-tx * w + 0, 'transform tx * width')}px ${num(-ty * h + 0, 'transform ty * height')}px`;
  }
  const css = { 'background-size': size, 'background-position': position, 'background-repeat': repeat };
  const raw_css = `${selector} {\n${Object.entries(css).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
  return { css, raw_css };
}

// ---------- css parsing (for guard) ----------

/** Blank out comments and string contents (only comments with keepStrings), keeping every offset and newline so line numbers stay true. */
export function mask(src, keepStrings = false) {
  const out = src.split('');
  const n = src.length;
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      blank(i, stop); i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (!keepStrings) blank(i + 1, Math.min(j, n));
      i = j + 1;
    } else if ((ch === 'u' || ch === 'U') && /^url\(\s*[^\s"')]/i.test(src.slice(i, i + 20)) && !/[\w-]/.test(src[i - 1] || '')) {
      const close = src.indexOf(')', i);
      const stop = close < 0 ? n : close;
      if (!keepStrings) blank(i + 4, stop);
      i = stop + 1;
    } else i++;
  }
  return out.join('');
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

export const MAX_NESTING = 256;

/** One forward pass with an explicit stack: close[i] is the matching '}' of the '{' at i (src.length when unclosed). */
function braceMap(src) {
  const close = new Map();
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      stack.push(i);
      if (stack.length > MAX_NESTING) throw bad(`CSS is nested more than ${MAX_NESTING} blocks deep`);
    } else if (ch === '}' && stack.length) close.set(stack.pop(), i);
  }
  for (const o of stack) close.set(o, src.length);
  return close;
}

function splitTop(s, sep = ',') {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map(p => p.trim()).filter(Boolean);
}

const CONDITIONAL_AT = new Set(['media', 'supports', 'container', 'scope', 'document', 'starting-style']);
const TRANSPARENT_AT = new Set(['layer']);
/** Bounds on nested-selector expansion so a selector list nested many times cannot blow up the work. */
const MAX_SELECTORS_PER_RULE = 4096;
const MAX_SELECTOR_CHARS = 32 * 1024 * 1024;

const unquote = (s) => s.replace(/^(["'])([^]*)\1$/, '$2');

export function parseCss(raw) {
  const src = mask(raw);
  const text = mask(raw, true);
  const lineAt = lineIndex(src);
  const closeOf = braceMap(src);
  const rules = [];
  const keyframes = [];
  let selectorChars = 0;
  const end = (open, to) => Math.min(closeOf.get(open), to);

  const decl = (from, to) => {
    const seg = src.slice(from, to);
    const idx = seg.indexOf(':');
    if (idx < 0) return null;
    const prop = seg.slice(0, idx).trim().toLowerCase();
    if (!/^-?[a-z][a-z-]*$/.test(prop)) return null;
    const lead = seg.length - seg.trimStart().length;
    const after = seg.slice(idx + 1);
    const vlead = after.length - after.trimStart().length;
    return { prop, value: after.replace(/!\s*important/i, '').trim(), line: lineAt(from + lead), vfrom: from + idx + 1 + vlead };
  };

  function frameDecls(from, to) {
    const ds = [];
    let start = from;
    for (let i = from; i <= to; i++) {
      if (i === to || src[i] === ';') { const d = decl(start, i); if (d) ds.push(d); start = i + 1; }
    }
    return ds;
  }

  function keyframesName(preFrom, preTo) {
    const seg = src.slice(preFrom, preTo);
    const m = /@(?:-[a-z]+-)?keyframes\b\s*/i.exec(seg);
    if (!m) return '';
    const at = preFrom + m.index + m[0].length;
    const masked = src.slice(at, preTo).trim();
    return /^["']/.test(masked) ? unquote(text.slice(at, preTo).trim()) : masked;
  }

  function atBlock(prelude, preFrom, preTo, bs, be, atStack, parents) {
    const m = /^@(-[a-z]+-)?([\w-]+)\s*([^]*)$/i.exec(prelude);
    if (!m) return;
    const name = m[2].toLowerCase();
    if (name === 'keyframes') {
      const frames = [];
      let i = bs;
      while (i < be) {
        if (src[i] === '{') { const close = end(i, be); frames.push({ decls: frameDecls(i + 1, close) }); i = close + 1; } else i++;
      }
      keyframes.push({ name: keyframesName(preFrom, preTo), frames });
    } else if (CONDITIONAL_AT.has(name) || TRANSPARENT_AT.has(name)) {
      const stack = TRANSPARENT_AT.has(name) ? atStack : [...atStack, prelude];
      if (parents) ruleBody(bs, be, parents, stack); else walk(bs, be, stack);
    }
  }

  function block(preFrom, preTo, bs, be, atStack, parents) {
    const p = src.slice(preFrom, preTo).trim().replace(/\s+/g, ' ');
    if (!p) return;
    if (p.startsWith('@')) return atBlock(p, preFrom, preTo, bs, be, atStack, parents);
    let sels = splitTop(p);
    if (parents) {
      if (parents.length * sels.length > MAX_SELECTORS_PER_RULE) throw bad(`a nested rule expands to more than ${MAX_SELECTORS_PER_RULE} selectors`);
      sels = parents.flatMap(par => sels.map(s => (s.includes('&') ? s.replace(/&/g, par) : `${par} ${s}`)));
    }
    for (const s of sels) selectorChars += s.length;
    if (selectorChars > MAX_SELECTOR_CHARS) throw bad(`nested selectors expand to more than ${MAX_SELECTOR_CHARS} characters`);
    ruleBody(bs, be, sels, atStack);
  }

  function ruleBody(from, to, selectors, atStack) {
    const decls = [];
    let i = from, start = from;
    while (i < to) {
      if (src[i] === ';') { const d = decl(start, i); if (d) decls.push(d); i++; start = i; }
      else if (src[i] === '{') { const close = end(i, to); block(start, i, i + 1, close, atStack, selectors); i = close + 1; start = i; }
      else i++;
    }
    if (start < to) { const d = decl(start, to); if (d) decls.push(d); }
    if (decls.length) rules.push({ selectors, decls, atStack });
  }

  function walk(from, to, atStack) {
    let i = from, start = from;
    while (i < to) {
      if (src[i] === '{') { const close = end(i, to); block(start, i, i + 1, close, atStack, null); i = close + 1; start = i; }
      else if (src[i] === ';') { i++; start = i; }
      else i++;
    }
  }

  walk(0, src.length, []);
  return { rules, keyframes, src, text };
}

// ---------- selector matching ----------

const normSel = (s) => mask(s).replace(/\s+/g, ' ').replace(/\s*([>+~])\s*/g, ' $1 ').trim();

function lastCompound(s) {
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    if (ch === ')' || ch === ']') depth++;
    else if (ch === '(' || ch === '[') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === ' ') return { head: s.slice(0, i), last: s.slice(i + 1) };
  }
  return { head: '', last: s };
}

/** The compounds of a selector head, combinators dropped, split only outside () and []. */
function compounds(head) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of head) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && ch === ' ') { if (cur && !/^[>+~]$/.test(cur)) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur && !/^[>+~]$/.test(cur)) out.push(cur);
  return out;
}

/** null when compound `cand` does not select what compound `want` selects; else the extra qualifier text ('' when equal). */
function covers(cand, want) {
  const tryMatch = (c) => {
    if (!c.startsWith(want)) return null;
    const rest = c.slice(want.length);
    if (rest && /^[\w-]/.test(rest)) return null;
    if (rest.includes('::')) return null;
    return rest;
  };
  let rest = tryMatch(cand);
  if (rest === null && /^[.#[]/.test(want)) rest = tryMatch(cand.replace(/^[a-z][\w-]*/i, ''));
  return rest;
}

const PSEUDO_CLASS = /(^|[^:\\]):(?!root\b)[a-z-]+/i;

/**
 * null when `part` does not select the target element; else { conditional, qualified }.
 * The last compounds are compared first. The heads (ancestors) are compared compound by compound, ignoring combinators:
 * a rule whose ancestors end with the target's ancestors applies (qualified when it adds ancestors or qualifiers), and so
 * does a rule whose ancestors are a less specific subsequence of the target's (e.g. `.hero` or `.page > .hero` for `.page .hero`).
 */
/** Expand :is(...) / :where(...) at the start of a compound into its arguments, so `:is(.bg):hover` is judged as `.bg:hover`. */
export function expandIs(sel, budget = { n: MAX_SELECTORS_PER_RULE }) {
  const m = /(^|[\s>+~])(:(?:is|where)\()/i.exec(sel);
  if (!m) return [sel];
  const open = m.index + m[1].length + m[2].length - 1;
  let depth = 0, close = -1;
  for (let i = open; i < sel.length; i++) {
    if (sel[i] === '(') depth++;
    else if (sel[i] === ')' && --depth === 0) { close = i; break; }
  }
  if (close < 0) return [sel];
  const before = sel.slice(0, m.index + m[1].length), after = sel.slice(close + 1);
  const out = [];
  for (const arg of splitTop(sel.slice(open + 1, close))) {
    for (const e of expandIs(before + arg + after, budget)) {
      if (--budget.n < 0) throw bad(`:is()/:where() expands to more than ${MAX_SELECTORS_PER_RULE} selectors`);
      out.push(e);
    }
  }
  return out;
}

export function matchSelector(part, target) {
  const p = normSel(part), t = normSel(target);
  if (!p || !t) return null;
  const T = lastCompound(t), P = lastCompound(p);
  const rest = covers(P.last, T.last);
  if (rest === null) return null;
  const Pc = compounds(P.head), Tc = compounds(T.head);
  let qualified = null;
  if (Pc.length >= Tc.length) {
    const off = Pc.length - Tc.length;
    let extra = off > 0;
    let ok = true;
    for (let k = 0; k < Tc.length && ok; k++) { const r = covers(Pc[off + k], Tc[k]); if (r === null) ok = false; else if (r) extra = true; }
    if (ok) qualified = extra;
  }
  if (qualified === null) {
    let k = 0;
    for (const c of Tc) if (k < Pc.length && covers(c, Pc[k]) !== null) k++;
    if (k === Pc.length) qualified = false;
  }
  if (qualified === null) return null;
  return { conditional: rest !== '' || PSEUDO_CLASS.test(p), qualified };
}

// ---------- guard ----------

const BG_PROPS = new Set(['background', 'background-image', 'background-position', 'background-position-x', 'background-position-y', 'background-size']);
const FILTER_PROPS = new Set(['filter', 'backdrop-filter']);
const TOUCHED = new Set([...BG_PROPS, ...FILTER_PROPS, 'all']);
const TIME = /^[-+]?[\d.]+m?s$/i;
const EASING = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|cubic-bezier\(.*\)|steps\(.*\)|normal|allow-discrete)$/i;
/** The property name without a vendor prefix: -webkit-backdrop-filter is checked as backdrop-filter. */
export const unprefixed = (prop) => prop.toLowerCase().replace(/^-(webkit|moz|ms|o)-/, '');

function transitionProps(prop, value) {
  const items = splitTop(value);
  const props = [];
  for (const item of items) {
    const tokens = item.split(/\s+(?![^(]*\))/).filter(Boolean);
    if (prop === 'transition-property') { props.push(...tokens.map(unprefixed)); continue; }
    if (tokens.length === 1 && tokens[0].toLowerCase() === 'none') continue;
    const named = tokens.filter(t => !TIME.test(t) && !EASING.test(t) && !/^[\d.]+$/.test(t));
    props.push(named.length ? unprefixed(named[0]) : 'all');
  }
  return props;
}

function flatReplacement(prop, value) {
  const v = value.toLowerCase();
  if (prop === 'background-image') return v === 'none';
  if (prop === 'background') return !/(url\(|gradient\(|image-set\(|element\(|var\(|\bimage\()/.test(v);
  return false;
}

const normValue = (v) => v.replace(/\s+/g, ' ').trim().toLowerCase();

export function guard(cssText, selector) {
  const target = checkSelector(selector, '--selector');
  const targets = splitTop(target);
  const { rules, keyframes, src, text } = parseCss(cssText);
  const original = (d) => text.slice(d.vfrom, d.vfrom + d.value.length);
  const violations = [];
  const seen = new Set();
  const add = (line, property, why) => {
    const key = `${line}|${property}|${why}`;
    if (!seen.has(key)) { seen.add(key); violations.push({ line, property, why }); }
  };
  const kfByName = new Map();
  for (const k of keyframes) { if (!kfByName.has(k.name)) kfByName.set(k.name, []); kfByName.get(k.name).push(k); }
  const usedNames = new Set();

  // Pass 1: which rules apply, and how.
  const applied = [];
  for (const rule of rules) {
    const hits = [];
    for (const s0 of rule.selectors) for (const s of expandIs(s0)) for (const t of targets) { const m = matchSelector(s, t); if (m) hits.push(m); }
    if (!hits.length) continue;
    const conditionalAt = rule.atStack.length > 0;
    const conditional = conditionalAt || hits.every(h => h.conditional);
    const qualified = !conditional && hits.filter(h => !h.conditional).every(h => h.qualified);
    const bg = rule.decls.filter(d => BG_PROPS.has(unprefixed(d.prop)));
    applied.push({ rule, conditional, qualified, bg, where: conditionalAt ? `inside ${rule.atStack[rule.atStack.length - 1]}` : 'in a state or qualified rule' });
  }
  if (!applied.length) throw bad(`no rule selects ${target}`);
  // The design is the first unconditional rule that sets the background, preferring one without extra ancestors.
  const design = applied.find(a => !a.conditional && !a.qualified && a.bg.length) || applied.find(a => !a.conditional && a.bg.length);
  const designValues = new Map();
  if (design) for (const d of design.bg) designValues.set(unprefixed(d.prop), normValue(original(d)));

  for (const a of applied) {
    for (const d of a.rule.decls) {
      const { prop, value, line } = d;
      const base = unprefixed(prop);
      if (base === 'backdrop-filter' && !/^none$/i.test(value)) add(line, prop, 'backdrop-filter on the background element itself; put the frosted panel on a sibling layer so its backdrop filter can see the photo');
      else if (base === 'filter' && !/^none$/i.test(value)) add(line, prop, 'filter on the background element alters the photo; leave the background exactly as designed');
      if (BG_PROPS.has(base)) {
        if (a.conditional) {
          if (flatReplacement(base, value)) add(line, prop, `the background image is replaced by a flat colour or none ${a.where}`);
          else add(line, prop, `the background is changed ${a.where}; it must stay exactly as designed`);
        } else if (a !== design) {
          const where = a.qualified ? 'in an ancestor-qualified rule' : 'in a later rule for the same selector';
          const known = designValues.get(base);
          const shorthandReset = base === 'background' && known === undefined && designValues.size > 0;
          const changed = known !== undefined ? known !== normValue(original(d)) : (a.qualified || shorthandReset);
          if (flatReplacement(base, value) && (changed || known === undefined)) add(line, prop, `the background image is replaced by a flat colour or none ${where}`);
          else if (changed) add(line, prop, `the background is changed ${where}; it must stay exactly as designed`);
        }
      }
      if (base === 'transition' || base === 'transition-property') {
        const hit = transitionProps(base, value).filter(p => TOUCHED.has(p));
        if (hit.length) add(line, prop, `transition on ${[...new Set(hit)].join(', ')} would animate the background`);
      }
      if (base === 'animation' || base === 'animation-name') {
        const mv = src.slice(d.vfrom, d.vfrom + value.length);
        for (const m of mv.matchAll(/"[^"]*"|'[^']*'|[^\s,]+/g)) {
          const tok = /^["']/.test(m[0]) ? unquote(text.slice(d.vfrom + m.index, d.vfrom + m.index + m[0].length)) : m[0];
          if (kfByName.has(tok)) usedNames.add(tok);
        }
      }
    }
  }
  for (const name of usedNames) {
    for (const kf of kfByName.get(name)) {
      for (const f of kf.frames) for (const d of f.decls) {
        const base = unprefixed(d.prop);
        if (BG_PROPS.has(base) || FILTER_PROPS.has(base)) add(d.line, d.prop, `@keyframes ${name}, used by ${target}, animates ${d.prop}`);
      }
    }
  }
  violations.sort((a, b) => a.line - b.line || a.property.localeCompare(b.property));
  const pass = violations.length === 0;
  return { selector: target, violations, pass, exit: pass ? 0 : 2 };
}

// ---------- CLI ----------

const FLAGS = { css: ['file'], guard: ['file', 'selector'] };

function parseArgs(args) {
  const [sub, ...rest] = args;
  if (!FLAGS[sub]) throw bad(`first argument must be one of ${Object.keys(FLAGS).join(', ')}\n${usage}`);
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    let a = rest[i];
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"\n${usage}`);
    let k = a.slice(2), v;
    const eq = k.indexOf('=');
    if (eq >= 0) { v = k.slice(eq + 1); k = k.slice(0, eq); }
    if (!FLAGS[sub].includes(k)) throw bad(`unknown flag --${k} (allowed: ${FLAGS[sub].map(f => `--${f}`).join(', ')})`);
    if (Object.hasOwn(flags, k)) throw bad(`--${k} given more than once`);
    if (v === undefined) {
      if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) throw bad(`--${k} needs a value`);
      v = rest[++i];
    }
    if (v === '') throw bad(`--${k} must not be empty`);
    flags[k] = v;
  }
  if (sub === 'guard' && flags.selector === undefined) throw bad('guard needs --selector');
  return { sub, flags };
}

const DEVICE_ROOTS = ['/dev/', '/proc/'];
const underDevice = (p) => DEVICE_ROOTS.some(r => p === r.slice(0, -1) || p.startsWith(r));

/** Open first (non-blocking, so a FIFO cannot hang the open), then check the open handle: a regular file, at most MAX bytes. */
async function readFileBounded(file, cwd) {
  const p = path.resolve(cwd, file);
  const fail = (e) => { throw bad(`cannot read ${p}: ${e.code || e.message}`); };
  if (underDevice(p)) throw bad(`${p} is under /dev or /proc; pass a regular file`);
  const real = await fs.realpath(p).catch(fail);
  if (underDevice(real)) throw bad(`${p} resolves to ${real}, under /dev or /proc; pass a regular file`);
  const fh = await fs.open(p, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK).catch(fail);
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw bad(`${p} is not a regular file`);
    if (st.size > MAX) throw bad(`${p} is larger than ${MAX} bytes`);
    const buf = Buffer.alloc(Math.min(st.size, MAX) + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    if (n > MAX) throw bad(`${p} is larger than ${MAX} bytes`);
    return buf.subarray(0, n);
  } finally { await fh.close(); }
}

export async function readInput(flags, io) {
  let buf;
  if (flags.file !== undefined) buf = await readFileBounded(flags.file, io.cwd || process.cwd());
  else {
    const reader = io.stdinBytes || (async (o) => Buffer.from(String(await io.stdin(o)), 'utf-8'));
    buf = await reader({ maxBytes: MAX + 1 });
    if (buf.length > MAX) throw bad(`input is larger than ${MAX} bytes`);
  }
  const text = buf.toString('utf-8').replace(/^﻿/, '');
  if (!text.trim()) throw bad('no input: pass it on stdin or with --file');
  return text;
}

export async function run(args, io = {}) {
  const { sub, flags } = parseArgs(args);
  const text = await readInput(flags, io);
  if (sub === 'css') {
    let data;
    try { data = JSON.parse(text); } catch { throw bad('input is not valid JSON'); }
    return cssFor(data);
  }
  return guard(text, flags.selector);
}
