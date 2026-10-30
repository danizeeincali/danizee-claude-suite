/**
 * slop-audit — walk a screen against a fixed list of "AI slop" signs, one line per hit with its fix.
 * Pure and read-only: it never writes and never touches the network.
 *
 *   slop-audit signs                     → { groups: [{ id, label, signs: [{ id, label, fix, detect }] }] }
 *   slop-audit scan [--file <path>] [--format html|css|jsx|md] [--strict]   (or the text on stdin, at most 8 MiB)
 *                                        → { format, hits, counts, total, manual }   (+ exit with --strict)
 *
 * signs prints the whole catalogue. Groups: surfaces, type, icons, spacing, copy, components, landing-hero,
 * motion, template-look. `detect` is "auto" when scan can find the sign mechanically and "manual" when only a
 * human can judge it (the template-look group, the fallbacks a cleaned screen drifts into, is all manual: check
 * them after the fixes).
 *
 * scan reads HTML, CSS, JSX or markdown text (Tailwind class text included). The format comes from --format, else
 * it is sniffed from the text alone (so stdin and --file agree). HTML comments, <script> bodies, CSS/JS comments
 * and fenced or inline code in markdown are skipped. Copy signs (emoji, exclamation marks, hype words, greetings,
 * fake data, unverified social proof) read visible text only: never tags, attributes, `!important` or `!==`.
 * Output shape (stable; the triage verb reads it):
 *   format  "html" | "css" | "jsx" | "md"
 *   hits    [{ sign, group, line, excerpt, fix }]   sorted by line (1-based), one hit per sign per line,
 *           excerpt trimmed to at most 120 characters
 *   counts  { <group id>: n }                       every group is present, 0 when clean
 *   total   number of hits
 *   manual  [sign id]                               the signs scan cannot see and a human must check
 * With --strict the result also carries `exit`: 2 when total > 0 (the blocking mode the workflows use), else 0.
 * The JSON is printed either way. Without --strict the exit is always 0 (advisory).
 *
 * Exit codes: 0 ok · 2 findings under --strict · 1 bad input (empty or binary input, input over 8 MiB, an
 * unreadable file, a bad or repeated flag, an unknown subcommand; message on stderr, nothing on stdout).
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import fs from 'fs/promises';
import { constants as fsc, fstatSync } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'slop-audit';
export const usage = 'cli.js slop-audit signs | scan [--format html|css|jsx|md] [--file <path>] [--strict]  (text on stdin or --file; advisory, exit 0; --strict exits 2 on any hit)';

const MAX_BYTES = 8 * 1024 * 1024;
const FORMATS = ['html', 'css', 'jsx', 'md'];

const S = (id, label, fix, detect = 'auto') => ({ id, label, fix, detect });
export const GROUPS = [
  { id: 'surfaces', label: 'Surfaces', signs: [
    S('purple-blue-gradient', 'Purple/violet/indigo to blue or pink gradient', 'Use one flat brand or neutral surface; if a gradient stays, keep it to two close shades of one hue.'),
    S('colored-glow', 'Colored glow (box-shadow, drop-shadow or text-shadow with a hue and a wide blur)', 'Swap for a neutral, low-opacity shadow with a small blur, or drop the shadow.'),
    S('neon-border', 'Neon border with a glow', 'Use a 1px border in a neutral or a muted tint of the surface; no glow.'),
    S('glass', 'Glassmorphism (backdrop blur over a translucent fill)', 'Use a solid surface with a border; keep blur only for a real overlay that sits over content.'),
  ] },
  { id: 'type', label: 'Type', signs: [
    S('heavy-weight', 'Weight 800 or 900', 'Cap headings at 600 or 700 and let size and spacing carry the hierarchy.'),
    S('gradient-text', 'Gradient text (background-clip: text)', 'Set the text in one solid color from the palette.'),
    S('tracked-uppercase', 'Uppercase labels with letter-spacing', 'Write the label in sentence case with default tracking.'),
  ] },
  { id: 'icons', label: 'Icons', signs: [
    S('emoji-icons', 'Emoji used as icons or decoration', 'Use one consistent icon set (or no icon) instead of emoji.'),
    S('mixed-icon-sets', 'More than one icon set on the same screen', 'Pick one icon set and replace the strays so stroke and size match.'),
  ] },
  { id: 'spacing', label: 'Spacing', signs: [
    S('off-grid-spacing', 'Arbitrary px margin, padding or gap off the 4px grid', 'Snap to a multiple of 4 (4, 8, 12, 16, 24, 32 ...) or use the spacing scale.'),
  ] },
  { id: 'copy', label: 'Copy', signs: [
    S('greeting-headline', 'Greeting headline (Welcome back, Hey there ...)', 'Lead with the thing the person came to do or see; drop the greeting.'),
    S('exclamation-marks', 'Exclamation marks in visible text', 'End the sentence with a period, or remove the sentence.'),
    S('hype-words', 'Hype words (revolutionary, supercharge, seamless, game-changer ...)', 'Say what it does in plain words with a concrete detail.'),
    S('fake-data', 'Fake data or placeholder numbers (Lorem ipsum, John Doe, 1,234, 12,345)', 'Use realistic content with believable, uneven values, or real data.'),
    S('mixed-number-formats', 'Mixed number formats (1,200 next to 1.2k, 5% next to 0.05)', 'Pick one format per kind of number and use it everywhere.', 'manual'),
  ] },
  { id: 'components', label: 'Components', signs: [
    S('glow-badge', 'Glowing badge or pill', 'Use a flat badge: neutral fill, small radius, no glow.'),
    S('sparkline-stat-card', 'Stat card decorated with a sparkline', 'Show the number and its change; add a chart only when the trend is the point.'),
    S('rainbow-chart', 'Rainbow or glowing chart', 'Use one hue (or neutral plus one accent) and no glow; label series directly.', 'manual'),
  ] },
  { id: 'landing-hero', label: 'Landing hero', signs: [
    S('pill-badge-hero', 'Pill badge above the hero headline', 'Delete the badge; if the news matters, give it a plain line elsewhere.', 'manual'),
    S('glossy-orb-logo', 'Glossy gradient orb as the logo', 'Use a real wordmark or a simple flat mark.', 'manual'),
    S('unverified-social-proof', 'Social proof with no source (Trusted by 10,000+ teams)', 'Cite a real number with a source, name real customers, or remove the claim.'),
  ] },
  { id: 'motion', label: 'Motion', signs: [
    S('looping-pulse', 'Looping pulse or glow animation', 'Animate once on a state change, or not at all; no infinite loops on idle elements.'),
    S('transition-all', 'transition: all', 'List the exact properties to transition (opacity, transform, color).'),
    S('hover-scale', 'Hover scale', 'Use a color, border or shadow change on hover; no scale.'),
    S('layout-animation', 'Animating layout properties (width, height, top, left, margin, padding)', 'Animate transform and opacity instead; let layout change instantly.'),
  ] },
  { id: 'template-look', label: 'Template look (check by hand after the fixes)', signs: [
    S('grey-neutrals', 'Pure grey neutrals on a product that should feel warm or branded', 'Tint the neutrals toward the brand hue (a few degrees of chroma).', 'manual'),
    S('inter-default', 'Inter as the only typeface', 'Choose a typeface that fits the product, or pair Inter with a distinctive display face.', 'manual'),
    S('leftover-brand-color', 'A leftover old brand color after the fixes', 'Search the styles for the old accent and replace it with the current one.', 'manual'),
  ] },
];

const SIGN = new Map();
for (const g of GROUPS) for (const s of g.signs) SIGN.set(s.id, { ...s, group: g.id });
const SIGN_ORDER = [...SIGN.keys()];
const MANUAL = [...SIGN.values()].filter(s => s.detect === 'manual').map(s => s.id);

export function listSigns() {
  return { groups: GROUPS.map(g => ({ id: g.id, label: g.label, signs: g.signs.map(s => ({ ...s })) })) };
}

// ---------- colors ----------

const NAMED = {
  purple: '#7e22ce', violet: '#8b5cf6', indigo: '#4f46e5', magenta: '#ff00ff', fuchsia: '#d946ef', pink: '#ec4899',
  hotpink: '#ff69b4', deeppink: '#ff1493', blue: '#2563eb', royalblue: '#4169e1', dodgerblue: '#1e90ff',
  slateblue: '#6a5acd', mediumpurple: '#9370db', blueviolet: '#8a2be2', darkviolet: '#9400d3', orchid: '#da70d6',
  deepskyblue: '#00bfff', skyblue: '#38bdf8', cornflowerblue: '#6495ed', cyan: '#06b6d4', aqua: '#00ffff',
  lime: '#00ff00', red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e', teal: '#14b8a6',
  black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080',
};
const FAMILY_HUE = {
  red: 0, orange: 25, amber: 38, yellow: 50, lime: 85, green: 142, emerald: 160, teal: 173, cyan: 188, sky: 199,
  blue: 217, indigo: 239, violet: 262, purple: 271, fuchsia: 292, pink: 330, rose: 346,
};
const FAMILIES = Object.keys(FAMILY_HUE).join('|');

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}
const num = (v, pct) => {
  const n = parseFloat(v);
  return /%/.test(v) ? (pct === 255 ? n * 2.55 : n / 100) : n;
};
const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])|(rgba?|hsla?)\(([^()]*)\)|\b[a-z]+\b/gi;

/** Every color in a CSS value as { h, s, l, a, at }; unknown words and var() are ignored. */
export function parseColors(str) {
  const out = [];
  for (const m of str.matchAll(COLOR_RE)) {
    let c = null;
    if (m[0][0] === '#') {
      let x = m[0].slice(1);
      if (x.length <= 4) x = [...x].map(ch => ch + ch).join('');
      const v = [0, 2, 4, 6].map(i => (x.length > i ? parseInt(x.slice(i, i + 2), 16) : 255));
      c = { ...rgbToHsl(v[0], v[1], v[2]), a: v[3] / 255 };
    } else if (m[1]) {
      const parts = m[2].split(/[\s,/]+/).filter(Boolean);
      if (parts.length < 3) continue;
      const alpha = parts[3] === undefined ? 1 : Math.max(0, Math.min(1, num(parts[3], 1)));
      if (/^rgb/i.test(m[1])) {
        const v = parts.slice(0, 3).map(p => num(p, 255));
        if (v.some(Number.isNaN)) continue;
        c = { ...rgbToHsl(v[0], v[1], v[2]), a: alpha };
      } else {
        const h = ((parseFloat(parts[0]) % 360) + 360) % 360;
        const s = num(parts[1], 1) / (/%/.test(parts[1]) ? 1 : 100) , l = num(parts[2], 1) / (/%/.test(parts[2]) ? 1 : 100);
        if ([h, s, l].some(Number.isNaN)) continue;
        c = { h, s, l, a: alpha };
      }
    } else if (NAMED[m[0].toLowerCase()]) {
      const x = NAMED[m[0].toLowerCase()];
      c = { ...rgbToHsl(parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)), a: 1 };
    }
    if (c) out.push({ ...c, at: m.index });
  }
  return out;
}
const chromatic = c => c.a > 0.05 && c.s >= 0.25 && c.l >= 0.1 && c.l <= 0.92;

/** True when a list of { h, s, l, a } stops reads as a purple/indigo/violet to blue/pink gradient. */
function slopGradient(colors) {
  const cs = colors.filter(chromatic);
  if (cs.length < 2) return false;
  const P = cs.filter(c => c.h >= 235 && c.h < 305);
  const other = cs.filter(c => (c.h >= 185 && c.h < 235) || (c.h >= 305 && c.h <= 350));
  if (P.length && other.length) return true;
  return P.length >= 2 && Math.max(...P.map(c => c.h)) - Math.min(...P.map(c => c.h)) >= 15;
}

// ---------- masking ----------

const blank = s => s.replace(/[^\n]/g, ' ');

function maskCode(text, format) {
  let t = text;
  if (format === 'md') {
    t = t.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(\n|$)/, blank);
    const lines = t.split('\n');
    let fence = null;
    t = lines.map(line => {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (!fence) fence = f[1][0];
        else if (f[1][0] === fence) fence = null;
        return blank(line);
      }
      return fence ? blank(line) : line;
    }).join('\n');
    t = t.replace(/`[^`\n]*`/g, blank);
  }
  if (format !== 'css') t = t.replace(/<!--[\s\S]*?(-->|$)/g, blank);
  if (format === 'html' || format === 'md') {
    t = t.replace(/(<script\b[^<>]*>)([\s\S]*?)(<\/script\s*>|$)/gi, (_, o, b, c) => o + blank(b) + c);
  }
  if (format === 'css' || format === 'html' || format === 'jsx') t = t.replace(/\/\*[\s\S]*?(\*\/|$)/g, blank);
  if (format === 'jsx') t = t.replace(/(^|[\s;{(,])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));
  return t;
}

const TAG_RE = /<\/?[A-Za-z][\w:.-]*(?:[^<>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\}|\{[^{}]*\{[^{}]*\}[^{}]*\})*>/g;

/** Same length as the masked text; only human-visible copy survives, everything else is spaces. */
function visibleText(masked, format) {
  if (format === 'css') return blank(masked);
  let t = masked.replace(/(<style\b[^<>]*>)([\s\S]*?)(<\/style\s*>|$)/gi, (_, o, b, c) => o + blank(b) + c);
  let out = '';
  let last = 0;
  const seg = s => {
    if (format === 'jsx') {
      s = s.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, blank);
      s = s.replace(/[{}=;()]/g, ' ');
    }
    if (format === 'md') {
      s = s.replace(/\]\([^)\n]*\)/g, blank).replace(/\bhttps?:\/\/\S+/g, blank);
    }
    return s;
  };
  let seenTag = false;
  for (const m of t.matchAll(TAG_RE)) {
    out += (seenTag || format !== 'jsx') ? seg(t.slice(last, m.index)) : blank(t.slice(last, m.index));
    out += blank(m[0]);
    last = m.index + m[0].length;
    seenTag = true;
  }
  out += (seenTag || format !== 'jsx') ? seg(t.slice(last)) : blank(t.slice(last));
  return out;
}

// ---------- detectors ----------

function shadowValues(v) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts;
}
const px = (n, u) => (u === 'rem' || u === 'em' ? n * 16 : n);

/** True when one shadow list contains a colored (non-grey) shadow with a blur of at least minBlur px. */
function coloredShadow(value, minBlur = 12) {
  for (const sh of shadowValues(value)) {
    const noColors = sh.replace(COLOR_RE, m => (/^(rgba?|hsla?)\(/i.test(m) || m[0] === '#' ? ' ' : m));
    const lens = [...noColors.matchAll(/(-?\d*\.?\d+)(px|rem|em)?(?![\w%])/g)].map(m => px(parseFloat(m[1]), m[2]));
    if (lens.length < 3) continue;
    const blur = lens[2];
    if (blur < minBlur) continue;
    const col = parseColors(sh).find(c => c.a > 0.05 && c.s >= 0.25);
    if (col) return true;
  }
  return false;
}

const re = (src, flags = 'gi') => new RegExp(src, flags);

/** Offsets of colored glows in CSS-like text. */
function glowCss(text) {
  const hits = [];
  for (const m of text.matchAll(/(?:box-?shadow|text-?shadow)\s*[:=]\s*(['"`]?)([^;}\n]*)/gi)) if (coloredShadow(m[2])) hits.push(m.index);
  for (const m of text.matchAll(/drop-shadow\(((?:[^()]|\([^()]*\))*)\)/gi)) if (coloredShadow(m[1], 12)) hits.push(m.index);
  return hits;
}
const TW_SHADOW = re(`(?:^|[\\s"'\`:])(?:[a-z-]+:)*(?:drop-)?shadow-(?:${FAMILIES})-\\d{2,3}(?:/\\d+)?(?![\\w-])`);
const TW_SHADOW_ARB = /(?:^|[\s"'`:])(?:[a-z-]+:)*(?:drop-)?shadow-\[([^\]]+)\]/gi;
/** Offsets of colored glows among Tailwind classes. */
function glowTw(text) {
  const hits = [];
  for (const m of text.matchAll(TW_SHADOW)) hits.push(m.index);
  for (const m of text.matchAll(TW_SHADOW_ARB)) if (coloredShadow(m[1].replace(/_/g, ' '), 8)) hits.push(m.index);
  return hits;
}

function gradientCss(text) {
  const hits = [];
  const open = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi;
  for (let m; (m = open.exec(text));) {
    let depth = 1, i = open.lastIndex;
    while (i < text.length && depth) { if (text[i] === '(') depth++; else if (text[i] === ')') depth--; i++; }
    const body = text.slice(open.lastIndex, i - 1);
    if (slopGradient(parseColors(body))) hits.push(m.index);
  }
  return hits;
}
function gradientTw(text) {
  const colors = [];
  let at = -1;
  for (const m of text.matchAll(re(`(?:^|[\\s"'\`:])(?:[a-z-]+:)*(?:from|via|to)-(?:(${FAMILIES})-\\d{2,3}|\\[(#[0-9a-f]{3,8}|[^\\]]*)\\])`))) {
    if (at < 0) at = m.index;
    if (m[1]) colors.push({ h: FAMILY_HUE[m[1].toLowerCase()], s: 0.8, l: 0.5, a: 1 });
    else colors.push(...parseColors(m[2]));
  }
  return at >= 0 && slopGradient(colors) ? [at] : [];
}

function trackedUppercaseCss(text) {
  const up = /text-?transform\s*[:=]\s*['"]?uppercase/i.exec(text);
  if (!up) return [];
  for (const m of text.matchAll(/letter-?spacing\s*[:=]\s*['"]?(-?\d*\.?\d+)(px|em|rem)?/gi)) {
    const n = parseFloat(m[1]);
    const ok = m[2] === 'px' ? n >= 1 : m[2] === 'em' ? n >= 0.04 : m[2] === 'rem' ? n >= 0.06 : n >= 1;
    if (ok) return [up.index];
  }
  return [];
}

const SPACING_PROP = /\b(margin|padding|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?\s*:\s*([^;}\n]+)/gi;
const SPACING_CAMEL = /\b(margin|padding|gap|rowGap|columnGap)(?:Top|Right|Bottom|Left|Inline|Block)?\s*:\s*(?:(-?\d*\.?\d+)(?![\d.%a-z])|(['"`])([^'"`\n]*)\3)/g;
const SPACING_TW = /(?:^|[\s"'`:])(?:[a-z-]+:)*-?(?:m|p|mx|my|mt|mr|mb|ml|px|py|pt|pr|pb|pl|gap|gap-x|gap-y|space-x|space-y)-\[(-?\d*\.?\d+)px\]/gi;
const offGrid = n => { const a = Math.abs(n); return a >= 2 && a % 4 !== 0; };
function spacingHits(text, format) {
  const hits = [];
  if (format !== 'md') {
    for (const m of text.matchAll(SPACING_PROP)) {
      if (m[2].includes('(')) continue;
      if ([...m[2].matchAll(/(-?\d*\.?\d+)px\b/gi)].some(v => offGrid(parseFloat(v[1])))) hits.push(m.index);
    }
    for (const m of text.matchAll(SPACING_CAMEL)) {
      if (m[2] !== undefined) { if (offGrid(parseFloat(m[2]))) hits.push(m.index); } else if (!m[4].includes('(') && [...m[4].matchAll(/(-?\d*\.?\d+)px\b/gi)].some(v => offGrid(parseFloat(v[1])))) hits.push(m.index);
    }
  }
  for (const m of text.matchAll(SPACING_TW)) if (offGrid(parseFloat(m[1]))) hits.push(m.index);
  return hits;
}

const LAYOUT_PROPS = '(?:width|height|min-width|max-width|min-height|max-height|top|left|right|bottom|margin(?:-[a-z]+)*|padding(?:-[a-z]+)*)';
const KEYFRAME_SEL = /^\s*(?:(?:from|to|\d+(?:\.\d+)?%)\s*,?\s*)+$/i;
const ICON_FAMILIES = [
  ['lucide', /lucide/i], ['heroicons', /heroicons/i], ['fontawesome', /fortawesome|font-?awesome|\bfa[srlb]?\s+fa-/i],
  ['phosphor', /phosphor/i], ['tabler', /tabler/i], ['material', /material-icons|material-symbols|@mui\/icons-material/i],
  ['feather', /feather-?icons|react-feather/i], ['bootstrap-icons', /bootstrap-icons|\bbi\s+bi-/i], ['remix', /remixicon|\bri-[a-z]/i],
  ['ionicons', /ionicons|ion-icon/i], ['iconify', /iconify/i],
];

const COPY = {
  'greeting-headline': /\b(?:welcome back|hey there|hi there|hello there|good (?:morning|afternoon|evening))\b|\b(?:Hey|Hi),?\s+(?:\{|\$\{|[A-Z][a-z]+)/i,
  'exclamation-marks': /[\p{L}\p{N})\]"'”’.?]!(?![\[=\w])/u,
  'hype-words': /\b(?:revolutionary|revolutioni[sz]e[sd]?|supercharge[sd]?|turbocharge[sd]?|unleash(?:e[sd]|ing)?|seamless(?:ly)?|cutting[- ]edge|game[- ]chang(?:er|ers|ing)|next[- ](?:level|gen(?:eration)?)|blazing(?:ly)?(?:[- ]fast)?|lightning[- ]fast|(?:10|100|1000)x|effortless(?:ly)?|world[- ]class|best[- ]in[- ]class|state[- ]of[- ]the[- ]art|unlock the power|reimagine[sd]?|elevate your|empower(?:s|ed|ing)?)(?![\w-])/i,
  'fake-data': /\blorem ipsum\b|\b(?:john|jane) (?:doe|smith)\b|\bacme (?:inc|corp|co)\b|\b(?:1,?234(?:,?567)?|12,?345|123,?456|9,?999)\b(?!\.\d)/i,
  'unverified-social-proof': /\b(?:trusted by|loved by|used by|join|relied on by)\s+(?:over |more than |nearly |almost )?(?:[\d,.]+[kKmM]?\+?|thousands|millions|hundreds)(?:\s+of)?(?:\s+[\w-]+){0,2}?\s+(?:teams|companies|customers|users|developers|creators|businesses|brands|people|marketers|founders)\b|\bloved by (?:thousands|millions)\b|\b#1 (?:rated|ranked)\b|\bbest[- ]rated\b|★{4,}|⭐{3,}|\b5[- ]star (?:rated|reviews?)\b/i,
};
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;

/** The core: every mechanical finding as { sign, offset } in the masked text. */
function findAll(masked, visible, format) {
  const found = [];
  const add = (sign, offset) => found.push({ sign, offset });
  const g = (sign, regex) => { for (const m of masked.matchAll(regex)) add(sign, m.index); };

  // whole-text rules
  for (const o of gradientCss(masked)) add('purple-blue-gradient', o);
  for (const o of glowCss(masked)) add('colored-glow', o);
  g('gradient-text', /(?:-webkit-)?background-?clip\s*[:=]\s*['"]?text\b|\bbg-clip-text\b/gi);
  g('glass', /backdrop-?filter\s*[:=]\s*['"]?[^;}\n]*\bblur\(|(?:^|[\s"'`:])(?:[a-z-]+:)*backdrop-blur(?!-none)(?![a-z])/gi);
  g('heavy-weight', /font-?weight\s*[:=]\s*['"]?(?:800|900|1000)\b|(?:^|[\s"'`:])(?:[a-z-]+:)*font-(?:extrabold|black)(?![\w-])|(?:^|[\s"'`:])font-\[(?:800|900)\]/gi);
  for (const o of spacingHits(masked, format)) add('off-grid-spacing', o);
  g('sparkline-stat-card', /<\s*Spark[A-Za-z]*\b|\bspark-?line\b|\bspark-?chart\b/gi);
  g('transition-all', /\btransition(?:-?property)?\s*[:=]\s*['"`]?[^;}\n]*\ball\b|(?:^|[\s"'`:])(?:[a-z-]+:)*transition-all(?![\w-])/gi);
  g('hover-scale', /(?:^|[\s"'`:])(?:group-)?hover:-?scale-|whileHover\s*=\s*\{\{[^}]*scale/gi);
  g('looping-pulse', /(?:^|[\s"'`:])(?:[a-z-]+:)*animate-(?:pulse|ping|bounce)(?![\w-])/gi);
  g('layout-animation', new RegExp(`\\btransition(?:-?property)?\\s*[:=]\\s*['"\`]?[^;}\\n]*\\b${LAYOUT_PROPS}\\b(?!-?[a-z])|(?:^|[\\s"'\`:])(?:[a-z-]+:)*transition-\\[[^\\]]*\\b(?:width|height|top|left|right|bottom|margin|padding)\\b`, 'gi'));

  // units: css blocks, style attributes, class strings, @apply
  const blocks = [];
  for (const m of masked.matchAll(/\{([^{}]*)\}/g)) {
    const before = masked.slice(Math.max(0, m.index - 300), m.index);
    const sel = before.slice(Math.max(before.lastIndexOf('}'), before.lastIndexOf('{'), before.lastIndexOf(';')) + 1);
    blocks.push({ text: m[1], start: m.index + 1, sel });
  }
  for (const m of masked.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const v = m[1] ?? m[2];
    blocks.push({ text: v, start: m.index + m[0].indexOf(v), sel: '' });
  }
  const classes = [];
  for (const m of masked.matchAll(/\b(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{([^{}]*)\})/g)) {
    const v = m[1] ?? m[2] ?? m[3] ?? m[4];
    classes.push({ text: v, start: m.index + m[0].indexOf(v) });
  }
  for (const m of masked.matchAll(/@apply\s+([^;}]+)/g)) classes.push({ text: m[1], start: m.index + 7 });

  const NEON_TW = re(`(?:^|[\\s"'\`:])(?:[a-z-]+:)*border-(?:${FAMILIES})-\\d{2,3}(?:/\\d+)?(?![\\w-])`);
  for (const b of blocks) {
    const at = o => b.start + o;
    const glow = glowCss(b.text);
    if (glow.length) {
      if (/badge|pill|chip/i.test(b.sel)) add('glow-badge', at(glow[0]));
      for (const m of b.text.matchAll(/\b(?:border|outline)(?:-(?:top|right|bottom|left))?(?:-color)?\s*:\s*([^;}\n]*)/gi)) {
        if (parseColors(m[1]).some(c => c.a > 0.05 && c.s >= 0.8 && c.l >= 0.4 && c.l <= 0.72)) { add('neon-border', at(m.index)); break; }
      }
    }
    for (const o of trackedUppercaseCss(b.text)) add('tracked-uppercase', at(o));
    if (/:hover/i.test(b.sel)) {
      const m = /transform\s*:[^;}]*\bscale(?:3d|X|Y)?\(/i.exec(b.text);
      if (m) add('hover-scale', at(m.index));
    }
    if (/animation(?:-name)?\s*:[^;}]*\b(?:pulse|glow|ping|breath\w*)\b/i.test(b.text) && /\binfinite\b/i.test(b.text)) {
      add('looping-pulse', at(b.text.search(/animation/i)));
    }
    if (KEYFRAME_SEL.test(b.sel)) {
      const m = new RegExp(`(?:^|[;\\s])${LAYOUT_PROPS}\\s*:`, 'i').exec(b.text);
      if (m) add('layout-animation', at(m.index));
    }
  }
  for (const c of classes) {
    const at = o => c.start + o;
    for (const o of glowTw(c.text)) add('colored-glow', at(o));
    for (const o of gradientTw(c.text)) add('purple-blue-gradient', at(o));
    for (const o of trackedUppercaseTw(c.text)) add('tracked-uppercase', at(o));
    const glow = glowTw(c.text);
    if (glow.length) {
      if (/(?:^|[\s:])(?:[a-z-]*[-_])?(?:badge|pill|chip)(?:[\s:_-]|$)/i.test(c.text)) add('glow-badge', at(glow[0]));
      const nb = NEON_TW.exec(c.text);
      if (nb) add('neon-border', at(nb.index));
    }
  }

  // icon sets
  const seenFam = new Map();
  for (const [name, rx] of ICON_FAMILIES) {
    const m = new RegExp(rx.source, 'i').exec(masked);
    if (m) seenFam.set(name, m.index);
  }
  for (const m of masked.matchAll(/react-icons\/([a-z0-9]+)/gi)) seenFam.set('react-icons/' + m[1].toLowerCase(), seenFam.get('react-icons/' + m[1].toLowerCase()) ?? m.index);
  if (seenFam.size >= 2) add('mixed-icon-sets', [...seenFam.values()].sort((a, b) => a - b)[1]);

  // visible copy
  let off = 0;
  for (const line of visible.split('\n')) {
    if (line.trim()) {
      for (const [sign, rx] of Object.entries(COPY)) { const m = rx.exec(line); if (m) add(sign, off + m.index); }
      const e = EMOJI.exec(line);
      if (e) add('emoji-icons', off + e.index);
    }
    off += line.length + 1;
  }
  return found;
}

function trackedUppercaseTw(text) {
  const up = /(?:^|[\s"'`:])(?:[a-z-]+:)*uppercase(?![\w-])/.exec(text);
  if (!up) return [];
  return /(?:^|[\s"'`:])(?:[a-z-]+:)*tracking-(?:wide|wider|widest|\[(?!-)[^\]]*\])(?![\w-])/.test(text) ? [up.index] : [];
}

function excerptOf(raw, col) {
  let s = raw;
  if (raw.length > 110) s = raw.slice(Math.max(0, col - 40), Math.max(0, col - 40) + 110);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 120 ? s.slice(0, 119) + '…' : s;
}

/** Scan text. Returns { format, hits, counts, total, manual }. */
export function scanText(text, format = sniff(text)) {
  const masked = maskCode(text, format);
  const visible = visibleText(masked, format);
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = o => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= o) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const seen = new Set();
  const hits = [];
  for (const f of findAll(masked, visible, format).sort((a, b) => a.offset - b.offset)) {
    const li = lineOf(f.offset);
    const key = f.sign + ':' + li;
    if (seen.has(key)) continue;
    seen.add(key);
    const end = li + 1 < starts.length ? starts[li + 1] - 1 : text.length;
    const info = SIGN.get(f.sign);
    hits.push({ sign: f.sign, group: info.group, line: li + 1, excerpt: excerptOf(text.slice(starts[li], end), f.offset - starts[li]), fix: info.fix });
  }
  hits.sort((a, b) => a.line - b.line || SIGN_ORDER.indexOf(a.sign) - SIGN_ORDER.indexOf(b.sign));
  const counts = Object.fromEntries(GROUPS.map(g => [g.id, 0]));
  for (const h of hits) counts[h.group]++;
  return { format, hits, counts, total: hits.length, manual: [...MANUAL] };
}

/** Decided from the text alone, so stdin and --file agree. */
export function sniff(text) {
  const t = text.replace(/^﻿/, '').replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(\n|$)/, '').trimStart();
  if (/^<!doctype\b|^<html\b/i.test(t)) return 'html';
  if (/^(?:import|export)\b|\bclassName\s*=|\bfunction\s+[A-Z]\w*\s*\(|=>\s*\(?\s*</.test(t)) return 'jsx';
  if (/^#{1,6}\s|^```|^~~~|^[-*]\s|^\[[^\]]+\]\(/m.test(t) && !/^<[a-z]/i.test(t)) return 'md';
  if (/^<[a-z!]/i.test(t) || /<\/?[a-z][\w-]*[\s>]/i.test(t)) return 'html';
  if (/[{}]/.test(t) && /[a-z-]+\s*:\s*[^;{}]+;?/i.test(t)) return 'css';
  return 'md';
}

// ---------- input ----------

const bad = m => new KitExit(m, 1);

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
  if (cmd === 'signs') {
    if (rest.length) throw bad(`signs takes no arguments\n${usage}`);
    return listSigns();
  }
  if (cmd !== 'scan') throw bad(`first argument must be signs or scan\n${usage}`);
  let file, format, strict = false;
  while (rest.length) {
    const a = rest.shift();
    if (a === '--strict') {
      if (strict) throw bad('--strict given more than once');
      strict = true;
      continue;
    }
    if (a !== '--file' && a !== '--format') throw bad(`unexpected argument "${a}"\n${usage}`);
    if (!rest.length || rest[0].startsWith('--')) throw bad(`${a} needs a value`);
    if (a === '--file') {
      if (file !== undefined) throw bad('--file given more than once');
      file = rest.shift();
      if (!file) throw bad('--file needs a non-empty value');
    } else {
      if (format !== undefined) throw bad('--format given more than once');
      format = rest.shift();
      if (!FORMATS.includes(format)) throw bad(`--format must be one of ${FORMATS.join(', ')}`);
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
  if (!text.trim()) throw bad('no input: pass HTML, CSS, JSX or markdown text on stdin or --file');
  if (text.includes('\0')) throw bad('input looks binary (contains NUL bytes)');
  const result = scanText(text, format || sniff(text));
  if (strict) result.exit = result.total > 0 ? 2 : 0;
  return result;
}
