/**
 * redesign-checklist — the hard limits and closing checklist for a redesign, the swap-the-product-name test, and a
 * mechanical before/after comparison of two versions of a page. Pure and read-only: it never writes and never
 * touches the network.
 *
 *   redesign-checklist list
 *       → { do_not: [{ id, rule }], checklist: [{ id, item, how_to_check }], template_test: { how } }
 *   redesign-checklist template-test --name <product name> [--file <page.html|page.md>] [--format html|md]   (or the text on stdin)
 *       → { name_found, occurrences, sentences, generic: [{ line, text }], generic_ratio, threshold, pass, next }
 *   redesign-checklist check --before <file> --after <file> [--name <product name>] [--strict] [--format html|md] [--before-format html|md] [--after-format html|md]
 *       → { violations: [{ rule, detail, line }], template, pass, next }
 *
 * list prints the do-not limits of a redesign (do not change what the product does, keep the section order and the
 * names the code relies on, invent nothing, add no visual the screen needs, no looping motion, keep accessibility)
 * and the closing checklist, each item with a way to check it.
 *
 * template-test replaces every occurrence of the product name (case-insensitive, whole word only: not inside a longer word) in the visible copy (HTML tags,
 * comments, scripts and styles, or markdown code and markup, are left out) with a placeholder, splits the copy into
 * sentences, and asks of each sentence that still has content words whether it reads as any product: it is
 * `generic` when every content word (stop words and the placeholder removed) is in GENERIC_WORDS (streamline,
 * workflow, powerful, platform, seamless, ...). generic_ratio is generic / sentences (3 decimals); the test passes
 * when the name occurs at least once and generic_ratio <= MAX_GENERIC_RATIO (0.3). `line` is a 1-based line of the
 * input. Text with no sentence that has a content word gives generic_ratio 0.
 *
 * check compares two versions (HTML or markdown, sniffed from the text by landing-sections' own sniff, which skips a BOM, front matter, comments and <?..?>, {%..%}, {#..#} prologs; --format forces both, --before-format / --after-format force one side, each html or md) for mechanical do-not violations, each as
 * { rule, detail, line }: `section-dropped` / `section-reordered` (sections found by landing-sections' detection;
 * when the before page has fewer than two known sections, by heading text order instead), `field-removed` (a form
 * field `name` attribute in before and not in after), `link-removed` (an href or markdown link target in before and
 * not in after), `invented-data` (a number or percentage in the visible copy of after that is not in before:
 * "invented data?"), `looping-motion` (more `animation: ... infinite` / `animation-iteration-count: infinite` in
 * after than in before). `line` is the 1-based line in after for additions and in before for removals. With --name
 * the template test is run on after (template is null otherwise). pass is true when there are no violations and the
 * template test (if run) passes. Exit 0 is advisory; with --strict a false pass exits 2 (the JSON is still printed
 * on stdout, with `exit: 2`), the blocking mode of the review step.
 *
 * Input is read from --file (or stdin for template-test), at most 8 MiB each. Binary input (NUL bytes), empty input,
 * an unreadable file, a missing or empty or duplicate flag value, a --format value other than html or md, an unknown argument or an unknown subcommand exit 1.
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import fs from 'fs/promises';
import { constants as fsc } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { checkText, sniff } from './landing-sections.js';

export const verb = 'redesign-checklist';
export const usage = 'cli.js redesign-checklist list | template-test --name <product> [--file <page>] [--format html|md]  (text on stdin or --file) | check --before <file> --after <file> [--name <product>] [--strict] [--format|--before-format|--after-format html|md]  (advisory exit 0; --strict exits 2 when pass is false)';

const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_GENERIC_RATIO = 0.3;

export const DO_NOT = [
  { id: 'keep-function', rule: 'Do not change what the product does: no new features, no removed functions or data.' },
  { id: 'keep-sections', rule: 'Do not reorder or drop sections; the page keeps the structure it had.' },
  { id: 'keep-names', rule: 'Do not change routes, URLs, form fields or any name the code relies on.' },
  { id: 'invent-nothing', rule: 'Do not invent data, claims, logos or testimonials; use what the product really has.' },
  { id: 'no-visual-first', rule: 'Do not add a visual before the screen works without it.' },
  { id: 'no-looping-motion', rule: 'Do not add looping motion; nothing animates forever.' },
  { id: 'keep-accessibility', rule: 'Do not break accessibility: contrast, visible focus, labels and reduced-motion all stay.' },
];

export const CHECKLIST = [
  { id: 'direction-followed', item: 'The chosen direction is followed everywhere, with its signature element present.', how_to_check: 'Open the direction brief and find its signature on the first screen and once more further down.' },
  { id: 'spacing-on-grid', item: 'All spacing sits on the spacing scale.', how_to_check: 'List the margin and padding values in the CSS; each one is a step of the scale.' },
  { id: 'one-accent', item: 'One accent color, used rarely.', how_to_check: 'Count the elements that use the accent on one screen; it marks the main action and little else.' },
  { id: 'one-icon-set', item: 'One icon set, one size and stroke, aligned to the text.', how_to_check: 'Look at every icon in a row: same family, same weight, centered on the text line.' },
  { id: 'plain-copy', item: 'Plain copy: no emoji, no exclamation marks, no filler words.', how_to_check: 'Search the visible text for emoji and "!"; read each sentence for a word you would not say aloud.' },
  { id: 'two-weights', item: 'No more than two font weights.', how_to_check: 'List the distinct font-weight values in the CSS.' },
  { id: 'real-content', item: 'Real content: real numbers, names, logos and screenshots, none made up.', how_to_check: 'Run redesign-checklist check and trace every flagged number or logo to a source.' },
  { id: 'hero-visual', item: 'The hero has a real visual of the product, with one moment worth looking at.', how_to_check: 'Look at the first screen: the visual shows the product itself, and one detail draws the eye.' },
  { id: 'no-dead-band', item: 'The first screen has no dead band of empty space.', how_to_check: 'View the page at a laptop and a phone height; the content fills the screen without a blank strip.' },
  { id: 'calm-motion', item: 'Motion is limited to color, opacity and transform, and is short.', how_to_check: 'Search the CSS for transitions and animations; only those three properties, none looping, reduced-motion respected.' },
  { id: 'logo-kept', item: 'The product name and a real logo are kept; a slop logo is redrawn flat.', how_to_check: 'Compare the logo before and after: same name and mark, no gradient or glossy tile.' },
  { id: 'not-the-same-look', item: 'The look is not the one used for every product.', how_to_check: 'Run redesign-checklist template-test with another product name and ask whether the screen still fits it.' },
];

export const TEMPLATE_TEST_HOW = 'Swap the product name for another product\'s name (run `redesign-checklist template-test --name <product> --file <page>`). If the copy would still fit that product, the sentences listed as generic need product-specific nouns, and the direction, visual and signature need pushing harder.';

export const GENERIC_WORDS = new Set([
  'streamline', 'workflow', 'powerful', 'platform', 'solution', 'seamless', 'all-in-one', 'boost', 'productivity',
  'team', 'effortless', 'effortlessly', 'easy', 'simple', 'simply', 'fast', 'faster', 'smart', 'smarter', 'modern',
  'innovative', 'cutting-edge', 'next-generation', 'next-gen', 'revolutionary', 'robust', 'scalable', 'flexible',
  'secure', 'reliable', 'intuitive', 'comprehensive', 'complete', 'ultimate', 'best', 'leading', 'trusted', 'world-class',
  'streamlined', 'unlock', 'supercharge', 'empower', 'transform', 'elevate', 'optimize', 'automate', 'accelerate',
  'collaborate', 'collaboration', 'manage', 'management', 'business', 'enterprise', 'company', 'companies',
  'tool', 'app', 'software', 'service', 'product', 'experience', 'journey', 'potential', 'growth', 'success', 'results',
  'insight', 'insights', 'data', 'ai', 'ai-powered', 'powered', 'tailored', 'custom', 'integration', 'integrations',
  'feature', 'features', 'benefit', 'benefits', 'everything', 'anything', 'anyone', 'everyone', 'work', 'working',
  'better', 'more', 'less', 'free', 'try', 'get', 'start', 'started', 'today', 'now', 'built', 'designed', 'made',
  'help', 'helps', 'make', 'makes', 'take', 'takes', 'level', 'next', 'time', 'save', 'saves', 'way', 'ways',
  'users', 'user', 'customers', 'customer', 'people', 'organization', 'organizations', 'projects', 'project',
  'tasks', 'task', 'process', 'processes', 'operations', 'efficiency', 'efficient', 'performance', 'quality',
  'learn', 'discover', 'explore', 'join', 'sign', 'up', 'demo', 'contact', 'pricing', 'plans', 'plan',
  'great', 'amazing', 'awesome', 'beautiful', 'love', 'loved', 'need', 'needs', 'want', 'wants', 'one', 'place',
]);

const STOP_WORDS = new Set((
  'a an the and or but nor so yet of in on at to for from by with without about as into onto over under up down out off ' +
  'is are was were be been being am do does did done have has had having will would can could should may might must shall ' +
  'it its it\'s this that these those there here they them their theirs we us our ours you your yours he she his her him ' +
  'i me my mine not no if then than when while where which who whom whose what why how all any each both few some such ' +
  'only own same too very just also again further once per via ever never always still even already'
).split(/\s+/));

const PLACEHOLDER = '\u0002';
const BREAK = '\u0001';

const bad = m => new KitExit(m, 1);

const BLOCK = new Set(('address article aside blockquote br button dd div dl dt figcaption footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p section table td th tr ul label title summary option').split(' '));
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&amp;/g, '&');
const blank = s => s.replace(/[^\n]/g, ' ');
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;

/** Visible copy with the line structure kept: tags and comments become blanks, block tags a BREAK marker. */
function visibleHtml(raw) {
  const t = raw
    .replace(/<!--[\s\S]*?(-->|$)/g, blank)
    .replace(/(<(script|style|head)\b[^<>]*>)([\s\S]*?)(<\/\2\s*>|$)/gi, (_m, o, n, b, c) => blank(o) + blank(b) + blank(c));
  return decode(t.replace(TAG, (m, _s, name) => blank(m).replace(/^ /, BLOCK.has(name.toLowerCase()) ? BREAK : ' ')));
}

function visibleMarkdown(raw) {
  const out = [];
  let fence = null;
  for (const line of raw.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null;
      out.push('');
      continue;
    }
    if (fence) { out.push(''); continue; }
    out.push(BREAK + line
      .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
      .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
      .replace(/<[^<>\n]*>/g, ' ')
      .replace(/`([^`\n]*)`/g, '$1')
      .replace(/^[ \t>#*+-]+/, '')
      .replace(/^\d{1,9}[.)][ \t]+/, '')
      .replace(/[*_~]+/g, ''));
  }
  return out.join('\n');
}

export function visibleText(raw, type) {
  return type === 'html' ? visibleHtml(raw) : visibleMarkdown(raw);
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function contentWords(sentence) {
  return (sentence.toLowerCase().replace(/[‘’]/g, "'").match(/[a-z][a-z'-]*/g) || [])
    .map(w => w.replace(/^['-]+|['-]+$/g, ''))
    .filter(w => w && !STOP_WORDS.has(w));
}

const STEMS = [s => s, s => s.replace(/(es|s)$/, ''), s => s.replace(/(ed|d)$/, ''), s => s.replace(/ing$/, ''), s => s.replace(/ly$/, '')];
const isGeneric = w => STEMS.some(f => GENERIC_WORDS.has(f(w)));

/** The swap-the-product-name test on a text (type md or html, sniffed when omitted). */
export function templateTest(raw, name, type) {
  if (type !== undefined && type !== 'md' && type !== 'html') throw bad('format must be md or html');
  const nm = String(name).trim();
  const visible = visibleText(raw, type || sniff(raw));
  const re = new RegExp('(?<![\\p{L}\\p{N}])' + esc(nm) + '(?![\\p{L}\\p{N}])', 'giu');
  let occurrences = 0;
  const swapped = visible.replace(re, () => { occurrences++; return PLACEHOLDER; });
  const generic = [];
  let sentences = 0;
  swapped.split('\n').forEach((line, i) => {
    for (const chunk of line.split(BREAK)) {
      for (const s of chunk.split(/(?<=[.!?:;])\s+/)) {
        const text = s.replace(new RegExp(PLACEHOLDER, 'g'), nm).replace(/\s+/g, ' ').trim();
        const words = contentWords(s.replace(new RegExp(PLACEHOLDER, 'g'), ' '));
        if (!words.length) continue;
        sentences++;
        if (words.every(isGeneric)) generic.push({ line: i + 1, text });
      }
    }
  });
  const generic_ratio = sentences ? Math.round((generic.length / sentences) * 1000) / 1000 : 0;
  const name_found = occurrences > 0;
  const pass = name_found && generic_ratio <= MAX_GENERIC_RATIO;
  let next;
  if (!name_found) next = `The name "${nm}" does not occur in the visible copy: name the product in the headline or hero.`;
  else if (!pass) next = 'Rewrite the generic sentences with the product\'s own nouns (what it holds, who uses it, what it shows), then run the test again.';
  else next = 'The copy reads as this product. Also run the swap by eye with another product\'s name.';
  return { name_found, occurrences, sentences, generic, generic_ratio, threshold: MAX_GENERIC_RATIO, pass, next };
}

let nlCache = { text: null, offsets: [] };
const lineOf = (text, idx) => {
  if (nlCache.text !== text) {
    const offsets = [];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) offsets.push(i);
    nlCache = { text, offsets };
  }
  const o = nlCache.offsets;
  let lo = 0, hi = o.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (o[mid] < idx) lo = mid + 1; else hi = mid; }
  return lo + 1;
};

function firstLines(text, re, group = 1) {
  const m = new Map();
  for (const x of text.matchAll(re)) {
    const v = (x[group] ?? '').trim();
    if (v && !m.has(v)) m.set(v, lineOf(text, x.index));
  }
  return m;
}

const stripComments = t => t.replace(/<!--[\s\S]*?(-->|$)/g, blank);

function fieldNames(text, type) {
  if (type !== 'html') return new Map();
  const src = stripComments(text);
  const m = new Map();
  for (const t of src.matchAll(TAG)) {
    const tag = t[2].toLowerCase();
    if (t[1] || !['input', 'select', 'textarea', 'button'].includes(tag)) continue;
    const a = /(?:^|\s)name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(t[3]);
    const v = a && (a[1] ?? a[2] ?? a[3]);
    if (v && !m.has(v)) m.set(v, lineOf(text, t.index));
  }
  return m;
}

function linkTargets(text, type) {
  if (type !== 'html') return firstLines(text.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1.*$/gm, blank), /\]\(\s*<?([^)\s>]+)/g);
  const src = stripComments(text);
  const m = new Map();
  for (const t of src.matchAll(TAG)) {
    if (t[1] || t[2].toLowerCase() !== 'a') continue;
    const a = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(t[3]);
    const v = a && (a[1] ?? a[2] ?? a[3]);
    if (v && !m.has(v)) m.set(v, lineOf(text, t.index));
  }
  return m;
}

const NUM = /(?<![\w.])\d[\d,]*(?:\.\d+)?(?:\s?(?:%|x|k|m|b|\+|million|billion|thousand))?(?![\w])/gi;
const numKey = s => s.toLowerCase().replace(/[,\s]/g, '').replace(/million$/, 'm').replace(/billion$/, 'b').replace(/thousand$/, 'k');

function numbers(visible) {
  const m = new Map();
  visible.split('\n').forEach((line, i) => {
    for (const x of line.matchAll(NUM)) {
      const k = numKey(x[0]);
      if (!m.has(k)) m.set(k, { text: x[0].trim(), line: i + 1 });
    }
  });
  return m;
}

const LOOP = /\banimation(?:-iteration-count)?\s*:[^;{}]*\binfinite\b/gi;

function headings(text, type) {
  const out = [];
  if (type === 'html') {
    for (const m of stripComments(text).matchAll(/<h([1-6])\b[^<>]*>([\s\S]*?)<\/h\1\s*>/gi)) out.push({ name: decode(m[2].replace(/<[^<>]*>/g, ' ')).replace(/\s+/g, ' ').trim().toLowerCase(), line: lineOf(text, m.index) });
  } else {
    let fence = null;
    text.split('\n').forEach((l, i) => {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
      if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return; }
      const h = !fence && /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(l);
      if (h) out.push({ name: h[1].trim().toLowerCase(), line: i + 1 });
    });
  }
  return out.filter(h => h.name);
}

function orderChanged(beforeIds, afterIds) {
  const inBefore = new Set(beforeIds);
  const common = afterIds.filter(x => inBefore.has(x));
  const want = beforeIds.filter(x => new Set(afterIds).has(x));
  return common.some((x, i) => x !== want[i]);
}

/** Compare two versions of a page for mechanical do-not violations. */
export function compare(before, after, opts = {}) {
  const tb = opts.beforeFormat || opts.format || sniff(before), ta = opts.afterFormat || opts.format || sniff(after);
  const violations = [];
  const sb = checkText(before, tb), sa = checkText(after, ta);
  let idsB, idsA, lineB, lineA, what;
  if (sb.found.length >= 2) {
    idsB = sb.found; idsA = sa.found; what = 'section';
    lineB = lineA = () => null;
  } else {
    const hb = headings(before, tb), ha = headings(after, ta);
    idsB = hb.map(h => h.name); idsA = ha.map(h => h.name); what = 'heading';
    const lb = new Map(hb.map(h => [h.name, h.line])), la = new Map(ha.map(h => [h.name, h.line]));
    lineB = x => lb.get(x) ?? null; lineA = x => la.get(x) ?? null;
  }
  const setA = new Set(idsA);
  for (const id of idsB) if (!setA.has(id)) violations.push({ rule: 'section-dropped', detail: `${what} "${id}" is in before and not in after`, line: lineB(id) });
  if (orderChanged(idsB, idsA)) {
    const common = idsA.filter(x => new Set(idsB).has(x));
    const want = idsB.filter(x => setA.has(x));
    const i = common.findIndex((x, k) => x !== want[k]);
    violations.push({ rule: 'section-reordered', detail: `${what}s changed order: after has "${common[i]}" where before has "${want[i]}"`, line: lineA(common[i]) });
  }
  const fa = fieldNames(after, ta);
  for (const [n, line] of fieldNames(before, tb)) if (!fa.has(n)) violations.push({ rule: 'field-removed', detail: `form field name="${n}" is in before and not in after`, line });
  const la = linkTargets(after, ta);
  for (const [h, line] of linkTargets(before, tb)) if (!la.has(h)) violations.push({ rule: 'link-removed', detail: `link target "${h}" is in before and not in after`, line });
  const nb = numbers(visibleText(before, tb));
  for (const [k, v] of numbers(visibleText(after, ta))) if (!nb.has(k)) violations.push({ rule: 'invented-data', detail: `"${v.text}" is in after and not in before: invented data? Trace it to a source or remove it`, line: v.line });
  const loopsB = (before.match(LOOP) || []).length;
  const loopsA = [...after.matchAll(LOOP)];
  for (const x of loopsA.slice(loopsB)) violations.push({ rule: 'looping-motion', detail: `new looping animation: ${x[0].replace(/\s+/g, ' ').trim()}`, line: lineOf(after, x.index) });
  const template = opts.name ? templateTest(after, opts.name, ta) : null;
  const pass = violations.length === 0 && (!template || template.pass);
  const next = pass ? 'No mechanical violations. Go through the checklist (redesign-checklist list) by eye.'
    : 'Fix each violation (restore what was removed, remove what was invented) and run check again.';
  return { violations, template, pass, next };
}

const PROTECTED = /^\/(dev|proc)(\/|$)/;
async function readBounded(p, cwd) {
  const full = path.resolve(cwd, p);
  let real = full;
  try { real = await fs.realpath(full); } catch { /* open reports it */ }
  if (PROTECTED.test(full) || PROTECTED.test(real)) throw bad(`${full} is not a regular file (paths under /dev and /proc are refused)`);
  let fh;
  try {
    fh = await fs.open(full, fsc.O_RDONLY | fsc.O_NONBLOCK);
    const st = await fh.stat();
    if (!st.isFile()) throw bad(`${full} is not a regular file`);
    const buf = Buffer.alloc(MAX_BYTES + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    if (n > MAX_BYTES) throw bad(`${full} is larger than 8 MiB`);
    return clean(buf.subarray(0, n).toString('utf-8'), full);
  } catch (e) {
    if (e instanceof KitExit) throw e;
    throw bad(`cannot read ${full}: ${e.code || e.message}`);
  } finally { if (fh) await fh.close().catch(() => {}); }
}

function clean(text, where) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw bad(`no input in ${where}`);
  if (text.includes('\0')) throw bad(`${where} looks binary (contains NUL bytes)`);
  return text;
}

const FORMATS = ['--format', '--before-format', '--after-format'];
function parseFlags(rest, valued, booleans = []) {
  const o = {};
  while (rest.length) {
    const a = rest.shift();
    if (booleans.includes(a)) {
      if (a in o) throw bad(`${a} given more than once`);
      o[a] = true;
    } else if (valued.includes(a)) {
      if (a in o) throw bad(`${a} given more than once`);
      if (!rest.length || rest[0].startsWith('--')) throw bad(`${a} needs a value`);
      o[a] = rest.shift();
      if (!o[a].trim()) throw bad(`${a} needs a non-empty value`);
      if (FORMATS.includes(a) && o[a] !== 'md' && o[a] !== 'html') throw bad(`${a} must be md or html`);
    } else throw bad(`unexpected argument "${a}"\n${usage}`);
  }
  return o;
}

export async function run(args, io) {
  const [cmd, ...rest] = args;
  const cwd = io.cwd || process.cwd();
  if (cmd === 'list') {
    if (rest.length) throw bad(`list takes no arguments\n${usage}`);
    return { do_not: DO_NOT.map(d => ({ ...d })), checklist: CHECKLIST.map(c => ({ ...c })), template_test: { how: TEMPLATE_TEST_HOW } };
  }
  if (cmd === 'template-test') {
    const f = parseFlags(rest, ['--name', '--file', '--format']);
    if (f['--name'] === undefined) throw bad(`template-test needs --name <product name>\n${usage}`);
    let text;
    if (f['--file'] !== undefined) text = await readBounded(f['--file'], cwd);
    else {
      const buf = Buffer.from(await (typeof io.stdinBytes === 'function' ? io.stdinBytes({ maxBytes: MAX_BYTES + 1 }) : io.stdin({ maxBytes: MAX_BYTES + 1 })));
      if (buf.length > MAX_BYTES) throw bad('input is larger than 8 MiB');
      text = clean(buf.toString('utf-8'), 'standard input');
    }
    return templateTest(text, f['--name'], f['--format']);
  }
  if (cmd === 'check') {
    const f = parseFlags(rest, ['--before', '--after', '--name', '--format', '--before-format', '--after-format'], ['--strict']);
    if (f['--before'] === undefined || f['--after'] === undefined) throw bad(`check needs --before <file> and --after <file>\n${usage}`);
    const before = await readBounded(f['--before'], cwd);
    const after = await readBounded(f['--after'], cwd);
    const r = compare(before, after, { name: f['--name'], format: f['--format'], beforeFormat: f['--before-format'], afterFormat: f['--after-format'] });
    if (f['--strict'] && !r.pass) r.exit = 2;
    return r;
  }
  throw bad(`first argument must be list, template-test or check\n${usage}`);
}
