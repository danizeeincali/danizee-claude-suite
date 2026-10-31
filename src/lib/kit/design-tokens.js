/**
 * design-tokens — a starter token sheet for UI work, and a lint of CSS against it. Pure and advisory: it never
 * writes and never touches the network. The sheet is a set of starting values to override when the project already
 * has a good system.
 *
 *   design-tokens emit [--hue <0-359>] [--accent <#rrggbb>] [--mode light|dark] [--format css|json] [--kind app|landing]
 *       → { kind, mode, format, hue, accent, contrast: { primary, secondary, muted, accent }, css | tokens, notes }
 *   design-tokens check [--file <css>] [--strict]     (CSS on stdin or --file, at most 8 MiB)
 *       → { issues: [{ code, severity, line, value, fix }], counts: { total, issues, hints, by_code }, ok }
 *
 * emit defaults: hue 250 (or the hue of --accent when only that is given), mode light, format css, kind app.
 * The sheet has: spacing on a 4px grid (4 8 12 16 20 24 32 40 48 64 80 96, named by quarter, --space-1 is 4px);
 * layout values (kind app: sidebar, content max width, row heights; kind landing: section rhythm and container);
 * one tinted neutral ramp of 11 steps (50 to 950, OKLCH with low chroma at the given hue, never pure grey), built
 * separately for light and dark; text roles (primary, secondary, muted) and bg, surface, border roles mapped onto
 * the ramp; one accent with hover and subtle variants (from --accent, otherwise derived from the hue); type with
 * two family roles (display, body) and fallback stacks, a scale, two weights (400, 600) and line heights; radii
 * with the nesting rule (outer = inner + padding) as a helper value; one icon set (16 and 20px, 1.5px stroke);
 * at most two quiet neutral-tinted shadows; motion durations and one easing.
 * format css prints `:root { --space-1: 4px; ... }` as the `css` string; format json prints the same values nested
 * under `tokens`. `contrast` is the WCAG ratio of each text role (and the accent) on the base surface; the text
 * roles are held to primary and secondary >= 4.5 and muted >= 3 by construction (a step that falls short is moved
 * along lightness until it passes). A given --accent is used as is: its contrast is reported, not changed.
 *
 * Reuse: motion comes from entrance.js (CATALOGUE: the entrance duration and the shared ease-out curve; the
 * 60ms item stagger is entrance's default) and the type steps and line heights from type-scale.js (SCALE), so
 * the sheet never disagrees with those verbs.
 *
 * check lints CSS (comments ignored) for values off the sheet. Codes: OFF_GRID_SPACING (a px value in margin,
 * padding, gap, row-gap or column-gap that is not a multiple of 4), HEAVY_WEIGHT (font-weight 700 or more,
 * including bold), TOO_MANY_WEIGHTS (more than 2 distinct font-weight values; reported at the third), MULTIPLE_ACCENTS
 * (saturated colors, OKLCH chroma 0.09 or more, from more than one hue family, 25 degrees apart; reported at the
 * first color of the second family), TOO_MANY_SHADOWS (more than 2 distinct box-shadow values other than none, compared case- and space-insensitively without !important;
 * reported at the third), and the hint PURE_GREY (an rgb color with r=g=b that is not black or white, where a
 * tinted ramp is expected). Hints have severity "hint" and never count against `ok`; every other issue has
 * severity "issue". `line` is 1-based. Exit 0 always for check unless --strict is given and an issue (not a hint)
 * exists: then the same JSON is printed and the exit is 2.
 *
 * Exit codes: 0 answer printed; 1 bad input (bad hex, hue out of range, unknown or duplicate flag, unreadable,
 * empty, binary or oversize CSS) with the message on stderr and nothing on stdout; 2 only for check --strict.
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import fs from 'fs/promises';
import { constants as fsc, fstatSync } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { CATALOGUE } from './entrance.js';
import { SCALE } from './type-scale.js';

export const verb = 'design-tokens';
export const usage = 'cli.js design-tokens emit [--hue <0-359>] [--accent <#rrggbb>] [--mode light|dark] [--format css|json] [--kind app|landing] | check [--file <css>] [--strict]  (advisory; check --strict exits 2 on issues)';

const MAX_BYTES = 8 * 1024 * 1024;
const bad = m => new KitExit(m, 1);

export const SPACING = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96];
export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const RAMP_L = {
  light: [0.985, 0.965, 0.925, 0.87, 0.72, 0.58, 0.48, 0.39, 0.29, 0.21, 0.15],
  dark: [0.97, 0.94, 0.89, 0.82, 0.70, 0.58, 0.45, 0.34, 0.27, 0.215, 0.17],
};
const RAMP_C = 0.012;
const DEFAULT_HUE = 250;
const SAT_CHROMA = 0.09, FAMILY_DEG = 25;

// ---- colour maths ----------------------------------------------------------------------------------------------
const clamp01 = x => Math.min(1, Math.max(0, x));
const toLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToLinear(L, C, h) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const inGamut = v => v.every(x => x >= -1e-6 && x <= 1 + 1e-6);

/** OKLCH to [r,g,b] in 0..255, reducing chroma until the colour fits the sRGB gamut. */
export function oklchToRgb(L, C, h) {
  let lin = oklchToLinear(L, C, h);
  if (!inGamut(lin)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid; else hi = mid;
    }
    lin = oklchToLinear(L, lo, h);
  }
  return lin.map(x => Math.round(clamp01(toGamma(clamp01(x))) * 255));
}

export function rgbToOklch([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(v => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const C = Math.hypot(a, bb);
  let h = Math.atan2(bb, a) * 180 / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
const parseHex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
const luminance = rgb => { const [r, g, b] = rgb.map(v => toLin(v / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function contrastRatio(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const r2 = n => Math.round(n * 100) / 100;
// Floor to 2 decimals so a reported ratio never rounds up past the threshold it was held to.
const ratio = (a, b) => Math.floor(contrastRatio(a, b) * 100) / 100;

/** Move lightness away from the background in 0.005 steps until the colour reaches `min` contrast. */
function holdContrast(L, C, h, bg, min) {
  const away = luminance(bg) > 0.18 ? -1 : 1;
  let l = L;
  for (let i = 0; i < 200; i++) {
    const rgb = oklchToRgb(l, C, h);
    if (contrastRatio(rgb, bg) >= min + 0.005) return rgb;
    l = clamp01(l + away * 0.005);
  }
  return oklchToRgb(l, C, h);
}

// ---- the sheet -------------------------------------------------------------------------------------------------
const FONT_DISPLAY = '"Inter Tight", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_BODY = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TYPE_STEPS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'];

/** Build the sheet as an ordered list of { path, css, value } entries plus the numbers `emit` reports. */
export function buildSheet({ hue = DEFAULT_HUE, accent, mode = 'light', kind = 'app' } = {}) {
  const entries = [];
  const add = (p, value, css) => entries.push({ path: p, css: css === null ? null : css || '--' + p.join('-'), value });
  const dark = mode === 'dark';

  for (const px of SPACING) add(['space', String(px / 4)], px + 'px');

  if (kind === 'app') {
    add(['layout', 'sidebar'], '240px'); add(['layout', 'sidebar-collapsed'], '64px');
    add(['layout', 'header'], '56px'); add(['layout', 'content-max'], '1120px');
    add(['layout', 'row-compact'], '32px'); add(['layout', 'row'], '40px'); add(['layout', 'row-touch'], '48px');
  } else {
    add(['layout', 'container'], '1120px'); add(['layout', 'prose-max'], '680px');
    add(['layout', 'section-y'], '96px'); add(['layout', 'section-y-compact'], '64px');
    add(['layout', 'section-gap'], '48px'); add(['layout', 'hero-gap'], '24px');
  }

  const L = RAMP_L[mode];
  const ramp = STEPS.map((s, i) => oklchToRgb(L[i], RAMP_C, hue));
  const at = s => ramp[STEPS.indexOf(s)];
  STEPS.forEach((s, i) => add(['color', 'neutral', String(s)], hex(ramp[i])));

  const bg = dark ? at(950) : at(50);
  const roleStep = dark
    ? { surface: 900, border: 800, 'border-strong': 700, primary: 50, secondary: 300, muted: 500 }
    : { surface: 100, border: 200, 'border-strong': 300, primary: 900, secondary: 700, muted: 500 };
  add(['color', 'bg'], hex(bg));
  add(['color', 'surface'], hex(at(roleStep.surface)));
  add(['color', 'border'], hex(at(roleStep.border)));
  add(['color', 'border-strong'], hex(at(roleStep['border-strong'])));
  const need = { primary: 4.5, secondary: 4.5, muted: 3 };
  const textRgb = {};
  for (const role of ['primary', 'secondary', 'muted']) {
    let rgb = at(roleStep[role]);
    if (contrastRatio(rgb, bg) < need[role] + 0.005) rgb = holdContrast(rgbToOklch(rgb).L, RAMP_C, hue, bg, need[role]);
    textRgb[role] = rgb;
    add(['color', 'text', role], hex(rgb), role === 'primary' ? '--color-text' : `--color-text-${role}`);
  }

  // accent: the given colour as is, otherwise derived from the hue and held to 4.5 on the base surface
  let accentRgb, accentHue = hue, accentC;
  if (accent) {
    accentRgb = parseHex(accent);
    const o = rgbToOklch(accentRgb);
    accentHue = o.h; accentC = o.C;
  } else {
    accentC = dark ? 0.15 : 0.17;
    accentRgb = holdContrast(dark ? 0.72 : 0.52, accentC, hue, bg, 4.5);
  }
  const ao = rgbToOklch(accentRgb);
  const step = dark ? 0.06 : -0.06;
  let hover = oklchToRgb(clamp01(ao.L + step), ao.C, accentHue);
  if (hex(hover) === hex(accentRgb)) hover = oklchToRgb(clamp01(ao.L - step), ao.C, accentHue); // pinned at black or white: shift the other way
  const subtle = oklchToRgb(dark ? 0.26 : 0.95, Math.min(ao.C, 0.04), accentHue);
  const onAccent = contrastRatio([255, 255, 255], accentRgb) >= contrastRatio(at(950), accentRgb) ? [255, 255, 255] : at(950);
  add(['color', 'accent', 'base'], hex(accentRgb), '--color-accent');
  add(['color', 'accent', 'hover'], hex(hover), '--color-accent-hover');
  add(['color', 'accent', 'subtle'], hex(subtle), '--color-accent-subtle');
  add(['color', 'accent', 'on'], hex(onAccent), '--color-on-accent');

  add(['font', 'display'], FONT_DISPLAY);
  add(['font', 'body'], FONT_BODY);
  for (const step of TYPE_STEPS) {
    const s = SCALE.find(x => x.step === step);
    add(['text', step, 'size'], s.size_px + 'px', `--text-${step}`);
    add(['text', step, 'line'], s.line_height_px + 'px', `--text-${step}-line`);
  }
  add(['weight', 'regular'], 400, '--font-weight-regular');
  add(['weight', 'semibold'], 600, '--font-weight-semibold');
  add(['leading', 'tight'], 1.2); add(['leading', 'normal'], 1.5); add(['leading', 'relaxed'], 1.65);

  add(['radius', 'sm'], '4px'); add(['radius', 'md'], '8px'); add(['radius', 'lg'], '12px'); add(['radius', 'pill'], '999px');
  add(['radius', 'nest', 'rule'], 'outer = inner + padding', null);
  add(['radius', 'nest', 'inner'], '8px'); add(['radius', 'nest', 'padding'], '8px'); add(['radius', 'nest', 'outer'], '16px');

  add(['icon', 'sm'], '16px'); add(['icon', 'md'], '20px'); add(['icon', 'stroke'], '1.5px');

  // shadows: tinted from the ramp hue, never pure black
  const [sr, sg, sb] = oklchToRgb(0.2, 0.02, hue);
  const a = dark ? [0.4, 0.5] : [0.06, 0.08];
  add(['shadow', 'sm'], `0 1px 2px rgb(${sr} ${sg} ${sb} / ${a[0]})`);
  add(['shadow', 'md'], `0 4px 12px rgb(${sr} ${sg} ${sb} / ${a[1]})`);

  add(['duration', 'fast'], '150ms'); add(['duration', 'base'], '200ms');
  add(['duration', 'entrance'], CATALOGUE.card.duration_ms + 'ms');
  add(['ease'], CATALOGUE.card.easing, '--ease');
  add(['stagger', 'step'], '60ms'); add(['stagger', 'max-items'], 6);

  const contrast = {
    primary: ratio(textRgb.primary, bg), secondary: ratio(textRgb.secondary, bg), muted: ratio(textRgb.muted, bg), accent: ratio(accentRgb, bg),
  };
  return { entries, contrast, accentHex: hex(accentRgb) };
}

const nest = entries => {
  const root = {};
  for (const { path: p, value } of entries) {
    let o = root;
    for (const k of p.slice(0, -1)) o = o[k] ??= {};
    o[p.at(-1)] = value;
  }
  return root;
};
const toCss = entries => ':root {\n' + entries.filter(e => e.css).map(e => `  ${e.css}: ${e.value};`).join('\n') + '\n}\n';

export function emit({ hue, accent, mode = 'light', format = 'css', kind = 'app' } = {}) {
  let h = hue;
  let greyAccent = false;
  if (h === undefined) {
    const o = accent ? rgbToOklch(parseHex(accent)) : null;
    if (o && o.C >= 0.02) h = o.h; else { h = DEFAULT_HUE; greyAccent = !!o; }
  }
  h = (Math.round(h * 10) / 10) % 360;
  const { entries, contrast, accentHex } = buildSheet({ hue: h, accent, mode, kind });
  const out = { kind, mode, format, hue: h, accent: accentHex, contrast };
  if (format === 'css') out.css = `/* design-tokens: ${kind}, ${mode}, hue ${h}. Radius nesting: outer = inner + padding. Override where the project has its own system. */\n` + toCss(entries);
  else out.tokens = nest(entries);
  out.notes = ['Starting values: keep the project\'s own system when it has a good one.', 'Weights are 400 and 600 only; use at most one accent.'];
  if (greyAccent) out.notes.push(`The accent is grey, so it has no hue; the neutral ramp uses the default hue ${DEFAULT_HUE}. Pass --hue to choose one.`);
  return out;
}

// ---- check -----------------------------------------------------------------------------------------------------
const SPACING_PROPS = /^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(gap|row-gap|column-gap)$/;
const COLOR_PROPS = /color|background|border|outline|fill|stroke|shadow|^--/;
const nearestGrid = px => SPACING.reduce((best, s) => (Math.abs(s - px) < Math.abs(best - px) ? s : best), SPACING[0]);

function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?(\*\/|$)/g, m => m.replace(/[^\n]/g, ' '));
}

const COLOR_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\b(?:rgba?|hsla?)\(\s*[^()]*\)/g;
function parseColor(tok) {
  let m = /^#([0-9a-f]+)$/i.exec(tok);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^(rgba?)\(\s*([^)]*)\)$/i.exec(tok);
  if (m) {
    const p = m[2].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (p.length < 3) return null;
    const v = p.map(x => (x.endsWith('%') ? Math.round(parseFloat(x) * 2.55) : parseFloat(x)));
    return v.some(x => !Number.isFinite(x)) ? null : v.map(x => Math.min(255, Math.max(0, Math.round(x))));
  }
  m = /^hsla?\(\s*([^)]*)\)$/i.exec(tok);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (p.length < 3) return null;
    const h = (((parseFloat(p[0]) % 360) + 360) % 360), s = parseFloat(p[1]) / 100, l = parseFloat(p[2]) / 100;
    if (![h, s, l].every(Number.isFinite)) return null;
    const f = n => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)].map(x => Math.round(clamp01(x) * 255));
  }
  return null;
}

export function checkCss(raw) {
  const text = blankComments(raw);
  const issues = [];
  const push = (code, line, value, fix, severity = 'issue') => issues.push({ code, severity, line, value, fix });
  const weights = new Map();
  const shadows = new Set();
  const families = []; // { hue, line, value }
  const DECL = /(^|[;{}\s])(-{0,2}[a-zA-Z][\w-]*)[ \t\r\n]*:[ \t\r\n]*([^;{}]*)/g;
  // precomputed line starts for speed
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineOf = idx => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
  for (const m of text.matchAll(DECL)) {
    const prop = m[2].toLowerCase(), value = m[3].trim();
    const valStart = m.index + m[0].length - m[3].length;
    const line = lineOf(valStart + (m[3].length - m[3].trimStart().length));
    if (!value) continue;
    if (!prop.startsWith('--') && SPACING_PROPS.test(prop) && !/(^|[^\w-])(calc|var|clamp|min|max)\(/.test(value)) {
      for (const t of value.replace(/\s*!important$/i, '').split(/\s+/)) {
        const px = /^(-?\d*\.?\d+)px$/i.exec(t);
        if (!px) continue;
        const n = Math.abs(parseFloat(px[1]));
        if (n !== 0 && n % 4 !== 0) {
          const g = nearestGrid(n);
          push('OFF_GRID_SPACING', line, `${prop}: ${t}`, `use ${t.startsWith('-') ? '-' : ''}${g}px (spacing grid: ${SPACING.join(', ')})`);
        }
      }
    }
    if (prop === 'font-weight') {
      const v = value.toLowerCase().replace(/\s*!important$/, '');
      const w = v === 'normal' ? 400 : v === 'bold' ? 700 : v === 'bolder' ? 900 : /^\d+$/.test(v) ? Number(v) : null;
      if (w !== null) {
        if (w >= 700) push('HEAVY_WEIGHT', line, `font-weight: ${value}`, 'use 600 for emphasis; weights 700 and above read heavy');
        if (!weights.has(w)) {
          weights.set(w, line);
          if (weights.size === 3) push('TOO_MANY_WEIGHTS', line, `font-weight: ${value}`, 'keep two weights only: 400 and 600');
        }
      }
    }
    if (prop === 'box-shadow') {
      const sv = value.replace(/\s*!important$/i, '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (!/^(none|inherit|initial|unset)$/.test(sv) && !shadows.has(sv)) {
        shadows.add(sv);
        if (shadows.size === 3) push('TOO_MANY_SHADOWS', line, `box-shadow: ${value}`, 'keep at most two quiet shadows (--shadow-sm, --shadow-md)');
      }
    }
    if (COLOR_PROPS.test(prop)) {
      for (const c of value.matchAll(COLOR_RE)) {
        const rgb = parseColor(c[0]);
        if (!rgb) continue;
        const [r, g, b] = rgb;
        if (r === g && g === b && r !== 0 && r !== 255) {
          push('PURE_GREY', line, c[0], 'use a tinted neutral from the ramp (--color-neutral-*) instead of a pure grey', 'hint');
          continue;
        }
        const o = rgbToOklch(rgb);
        if (o.C >= SAT_CHROMA && o.L > 0.1 && o.L < 0.97) families.push({ hue: o.h, line, value: c[0] });
      }
    }
  }
  // group saturated colours into hue families (25 degrees apart, circular); report the first colour of each later family
  const fam = [];
  for (const f of families) {
    const hit = fam.find(x => Math.min(Math.abs(x.hue - f.hue), 360 - Math.abs(x.hue - f.hue)) <= FAMILY_DEG);
    if (!hit) fam.push(f);
  }
  if (fam.length > 1) {
    const second = fam[1];
    push('MULTIPLE_ACCENTS', second.line, second.value, `${fam.length} saturated hue families found (${fam.map(f => f.value).join(', ')}); keep one accent and tint the rest from the neutral ramp`);
  }
  issues.sort((a, b) => a.line - b.line);
  const by_code = {};
  for (const i of issues) by_code[i.code] = (by_code[i.code] || 0) + 1;
  const hints = issues.filter(i => i.severity === 'hint').length;
  const real = issues.length - hints;
  return { issues, counts: { total: issues.length, issues: real, hints, by_code }, ok: real === 0 };
}

// ---- input and CLI ---------------------------------------------------------------------------------------------
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

const EMIT_VALUE = ['hue', 'accent', 'mode', 'format', 'kind'];
const CHECK_VALUE = ['file'];
function parseFlags(rest, valueFlags, boolFlags = []) {
  const flags = {};
  rest = [...rest];
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"\n${usage}`);
    const k = a.slice(2);
    const known = [...valueFlags, ...boolFlags];
    if (!known.includes(k)) throw bad(`unknown flag --${k} (allowed: ${known.map(f => `--${f}`).join(', ') || 'none'})`);
    if (flags[k] !== undefined) throw bad(`--${k} given more than once`);
    if (boolFlags.includes(k)) { flags[k] = true; continue; }
    if (!rest.length || rest[0].startsWith('--')) throw bad(`--${k} needs a value`);
    const v = rest.shift();
    if (v === '') throw bad(`--${k} needs a non-empty value`);
    flags[k] = v;
  }
  return flags;
}

export async function run(args, io) {
  const [sub, ...rest] = args;
  if (sub === 'emit') {
    const f = parseFlags(rest, EMIT_VALUE);
    let hue;
    if (f.hue !== undefined) {
      if (!/^\d{1,3}(\.\d+)?$/.test(f.hue) || Number(f.hue) >= 360) throw bad('--hue must be a number from 0 to 359');
      hue = Number(f.hue);
    }
    if (f.accent !== undefined && !/^#[0-9a-fA-F]{6}$/.test(f.accent)) throw bad('--accent must be a hex color like #3b82f6');
    if (f.mode !== undefined && f.mode !== 'light' && f.mode !== 'dark') throw bad('--mode must be light or dark');
    if (f.format !== undefined && f.format !== 'css' && f.format !== 'json') throw bad('--format must be css or json');
    if (f.kind !== undefined && f.kind !== 'app' && f.kind !== 'landing') throw bad('--kind must be app or landing');
    return emit({ hue, accent: f.accent && f.accent.toLowerCase(), mode: f.mode, format: f.format, kind: f.kind });
  }
  if (sub !== 'check') throw bad(`first argument must be emit or check\n${usage}`);
  const f = parseFlags(rest, CHECK_VALUE, ['strict']);
  const cwd = io.cwd || process.cwd();
  let buf;
  if (f.file !== undefined) {
    const p = path.resolve(cwd, f.file);
    try { buf = await openRegular(p); } catch (e) {
      if (e instanceof KitExit) throw e;
      throw bad(`cannot read ${p}: ${e.code || e.message}`);
    }
  } else {
    if (io.stdinIsTTY) throw bad('no input: pass CSS on stdin or --file (stdin is a terminal)');
    buf = typeof io.stdinBytes === 'function' ? Buffer.from(await io.stdinBytes({ maxBytes: MAX_BYTES + 1 })) : Buffer.from(String(await io.stdin({ maxBytes: MAX_BYTES + 1 })), 'utf-8');
  }
  if (buf.length > MAX_BYTES) throw bad('input is larger than 8 MiB');
  const text = buf.toString('utf-8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw bad(f.file !== undefined ? `${path.resolve(cwd, f.file)} is empty` : 'no input: pass CSS on stdin or --file');
  if (text.includes('\0')) throw bad('input looks binary (contains NUL bytes)');
  const result = checkCss(text);
  if (f.strict && !result.ok) result.exit = 2;
  return result;
}
