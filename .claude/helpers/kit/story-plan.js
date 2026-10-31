/**
 * story-plan — plan and build a short before/after "story" page for a UI redesign: three to five steps, each one
 * only a CSS change layered on the steps before it (values change in place, structure never does), played on one
 * timeline of at most ten seconds. Pure: it reads the files named and writes only to --out; no network.
 *
 *   story-plan check [--file <story.json>] [--strict]   (or the JSON on stdin, at most 8 MiB)
 *       → { ok, duration_ms, problems: [{ step?, code, message }], notes: [{ code, message }], timeline: [{ id, start_ms, end_ms, tween_end_ms }] }
 *   story-plan emit [--file <story.json>] --page <original.html> [--out <file>]
 *       → { html, duration_ms, steps, format, stripped: { scripts, links } }
 *         (with --out: { out, bytes, duration_ms, steps, format, stripped }, the html is written to the file; an --out that
 *         is the same file as --page or --file (same path, a symlink or a hard link) is refused with exit 1)
 *   story-plan template                                  → an example story.json that passes check
 *
 * Story: { title, format: "square"|"wide", easing?, intro_ms?, outro_ms?, credit?, camera?, steps: [
 *   { id, label, css: { "<selector>": { "<prop>": "<value>" } }, swap?: { selector, text, ink? },
 *     redline?: { selector, label, measure? }, tween_ms?, hold_ms? } ] }
 * Rules (each break is a problem with a `code`, a `step` where one step is at fault, and a `message` that says how to fix it):
 *   bad-title, bad-format       title is a non-empty string (at most 80 chars); format is square (1080x1080) or wide (1920x1080)
 *   unknown-key, bad-shape      only the keys above exist; steps, css, swap and redline are objects of the right type
 *   step-count                  three to five steps
 *   step-id, step-id-duplicate  ids are 1-32 chars of a-z 0-9 - _ and unique;  step-label: a label of 1-60 chars
 *   step-empty                  a step changes something (css or swap)
 *   css-selector                selectors are plain (no braces, semicolons, <, @, comments or pseudo-elements)
 *   css-prop                    only tweenable properties: color, background-color, opacity, transform, filter,
 *                               letter-spacing, font-weight, border-radius (and corner forms), box-shadow, gap/row-gap/
 *                               column-gap, padding*, margin*. A gradient cannot tween: fade it out on its own layer.
 *   css-value                   values are short plain strings (no url(), no ; { } < > @ \ or !important);  css-content: no `content` property
 *   pill-radius                 a pill radius (999px and up) cannot tween: write half the element height
 *   swap-length, swap-count     swap text at most 80 chars; at most 3 swaps in all (text swaps are blur-out / blur-in);  swap-selector-reuse
 *   swap-replaced               a swap selector whose last compound names an element that cannot hold the new text (img,
 *                               input, video, textarea, select, svg, br and the other void/replaced elements; see REPLACED).
 *                               A redline works on any element, these included (its tag lives outside the element).
 *   tween-range, hold-range     tween_ms 0-900 (default 600); hold_ms 0-5000 (default 900), whole numbers
 *   easing                      one shared easing: linear, ease, ease-in, ease-out, ease-in-out (in/out/in-out too) or a cubic-bezier [x1,y1,x2,y2]
 *   intro-outro                 intro_ms 0-5000 (default 500); outro_ms 0-5000 (default 1000)
 *   duration                    intro + steps x (tween + hold) + outro is at most 10000 ms
 *   redline-label, redline-measure, redline-selector-reuse   a redline names the slop the step removes (label 1-40 chars; measure up to 20)
 *   redline-missing             a step that changes spacing (gap, padding, margin) or corners (radius) has a redline
 *   credit-length               credit at most 60 chars
 *   camera                      camera is { selector } or { x, y, w, h } (page pixels, x/y 0-20000, w/h above 0) zooming
 *                               0.25x-4x; it crops the frame close on the part that changes most. The page is exactly the
 *                               frame width, so x + w must stay within it (a rect wider than the page starts at x 0)
 * Notes (advisory: they never make ok false nor fail --strict):
 *   credit-missing              no credit (or a blank one): every video carries a credit, so emit shows
 *                               "Redesign by the author" until credit names the author
 *   swap-ink                    a step changes color on a swap selector in or after the step that swaps it: the old text
 *                               stays hidden (the swap's hide slot is last) and the new text keeps swap.ink (default #111)
 * Timeline: step i starts when the one before it ends; its css tween runs start..tween_end, then it holds until end.
 * Exit codes: check is advisory (exit 0, even when ok is false) unless --strict, which exits 2 when not ok;
 * emit exits 1 when the story is not ok; a bad flag, a duplicate flag, an unreadable or binary or oversize (8 MiB) or
 * empty input, JSON that is not an object, or a missing/unreadable --page exits 1 with the message on stderr.
 * emit: the original page (scripts, links, iframes, objects, embeds and on* handlers removed; comments and quoted
 * attribute values are skipped, and a missing close tag drops only the open tag) sits in a 1080x1080 or 1920x1080 frame;
 * html/body/:root rules apply to the page container, except font-size on html/:root, which stays on the real <html> so
 * rem lengths match the original. One <style data-story-step> per step plays on CSS animations only, started by the class
 * story-play on <html>, so a faked clock renders it deterministically. Animation stack: each animation a step adds to an
 * element is a slot (custom property --story-aN set by that step's selector, reset on * so it never inherits) and one rule
 * for the union of all step selectors lists every slot in step order, so an element matched by two different selector
 * strings (h1 and .hero h1) runs every step's tween; a swap's hide slot comes after all others, so a later colour step
 * never shows the old text again. No step rule touches layout before or outside its window, and none styles a page
 * element's ::before or ::after (the page's icons and clearfixes stay): a redline is an outline that lives only in its
 * animation plus a tag, a <story-tag> in one <story-layer> (display:contents) at the end of #story-page, anchored to its
 * element with CSS anchor positioning (a unique anchor-name per matched element; browsers without anchor positioning
 * show the outline but no tag); a swap fades the old text out (the element's opacity and blur, then its colour held
 * transparent) and the new text in on a <story-swap> inserted as the element's first child, out of flow at the old
 * text's static position, inheriting its font, one line as wide as the new text. Neither sets position on the element.
 * Limits of the inserted swap child: a page rule that picks the element's children by position (:first-child,
 * :nth-child, > *) counts it too; a page ::before on the element stays and the new text follows it (one that inherits the
 * colour fades out with the old text); two swaps that reach one element through different selector strings both show
 * (swap-selector-reuse catches only the same string). Chromium antialiases an element that has an opacity/filter/transform animation up
 * to one colour level differently even before it starts, so frame 0 can differ from the original by that much there.
 * The page's only script (<script data-story-marks>, or <script data-story-camera> when the camera follows a selector)
 * is emitted only when a step swaps or redlines or the camera follows a selector; it inserts those elements while the
 * page parses. Every page carries #story-credit (credit, or the default above).
 * Camera: without camera there is no crop (the page sits at 0,0 at 1:1). { x, y, w, h } is fitted and centred with a
 * transform on #story-page; { selector } is measured on the window load event (images loaded) and again once
 * document.fonts is ready, each time from the t=0 state (the transform is cleared and every animation is seeked to 0 for
 * the measure, then put back); no timers or animation frames, a 24px margin, zoom clamped to 0.25x-4x; no match means no
 * crop. story-render has no readiness signal to wait on, but it captures after the load event (page.goto waits for
 * load), so the load measure is in place for frame 0; a web font that finishes loading after load re-aims the camera
 * when it arrives, which can be after frame 0.
 * The page declares <meta name="story-duration-ms"> and <meta name="story-format" content="square|wide">; story-render
 * reads the duration but not the format, so render a wide story with `story-render render --format wide`.
 * Under prefers-reduced-motion the final state is shown.
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import fs from 'fs/promises';
import { constants as fsc, fstatSync } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'story-plan';
export const usage = 'cli.js story-plan check [--file <story.json>] [--strict] | emit [--file <story.json>] --page <original.html> [--out <file>] | template  (story JSON on stdin or --file, at most 8 MiB)';

export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_DURATION_MS = 10000;
export const MAX_TWEEN_MS = 900;
export const MAX_SWAPS = 3;
export const FORMATS = { square: { w: 1080, h: 1080 }, wide: { w: 1920, h: 1080 } };
export const DEFAULT_CREDIT = 'Redesign by the author';
export const CAMERA_MIN_SCALE = 0.25;
export const CAMERA_MAX_SCALE = 4;
const CAMERA_MARGIN = 24;
const DEFAULTS = { tween_ms: 600, hold_ms: 900, intro_ms: 500, outro_ms: 1000, easing: 'ease-in-out' };
const EASINGS = { linear: 'linear', ease: 'ease', 'ease-in': 'ease-in', 'ease-out': 'ease-out', 'ease-in-out': 'ease-in-out', in: 'ease-in', out: 'ease-out', 'in-out': 'ease-in-out' };
const TOP_KEYS = ['title', 'format', 'easing', 'intro_ms', 'outro_ms', 'credit', 'camera', 'steps'];
const STEP_KEYS = ['id', 'label', 'css', 'swap', 'redline', 'tween_ms', 'hold_ms'];
const SPACING = /^(gap|row-gap|column-gap|padding(-(top|right|bottom|left))?|margin(-(top|right|bottom|left))?)$/;
const RADIUS = /^border(-(top|bottom)-(left|right))?-radius$/;
const TWEENABLE = new Set(['color', 'background-color', 'opacity', 'transform', 'filter', 'letter-spacing', 'font-weight', 'box-shadow']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const bad = m => new KitExit(m, 1);

const TAG = /<([a-zA-Z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;
const HANDLER = /\s+(?:on[a-zA-Z]+|(?:href|src|action|formaction|xlink:href)(?=\s*=\s*["']?\s*javascript:))(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi;

function tweenable(prop) { return TWEENABLE.has(prop) || SPACING.test(prop) || RADIUS.test(prop); }

/** The easing as CSS, or null when it is not one of the allowed forms. */
export function easingCss(e) {
  if (e === undefined) return DEFAULTS.easing;
  if (typeof e === 'string') return own(EASINGS, e) ? EASINGS[e] : null;
  if (Array.isArray(e) && e.length === 4 && e.every(n => typeof n === 'number' && Number.isFinite(n)) && e[0] >= 0 && e[0] <= 1 && e[2] >= 0 && e[2] <= 1) return `cubic-bezier(${e.join(',')})`;
  return null;
}

const num = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);

/** Timeline math on the story as given; fields that are not valid whole numbers fall back to their defaults. */
export function timeline(story) {
  const steps = Array.isArray(story && story.steps) ? story.steps : [];
  let t = num(story && story.intro_ms, DEFAULTS.intro_ms);
  const out = [];
  for (const s of steps) {
    const st = isObj(s) ? s : {};
    const tween = num(st.tween_ms, DEFAULTS.tween_ms), hold = num(st.hold_ms, DEFAULTS.hold_ms);
    out.push({ id: typeof st.id === 'string' ? st.id : '', start_ms: t, end_ms: t + tween + hold, tween_end_ms: t + tween });
    t += tween + hold;
  }
  return { timeline: out, duration_ms: t + num(story && story.outro_ms, DEFAULTS.outro_ms) };
}

/** Elements that cannot hold the inserted swap text (void, replaced, or children not rendered). */
export const REPLACED = ['area', 'audio', 'base', 'br', 'canvas', 'col', 'embed', 'hr', 'iframe', 'img', 'input', 'link', 'meta', 'object', 'picture', 'select', 'slot', 'source', 'svg', 'template', 'textarea', 'track', 'video', 'wbr', 'math'];

/** The type names that start the last compound of each selector in a list ('.a img, b > input' -> ['img', 'input']). Linear. */
export function lastTypes(sel) {
  let flat = '', depth = 0, quote = '';
  for (const c of sel) {
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '[' || c === '(') { depth++; continue; }
    if (c === ']' || c === ')') { depth = Math.max(0, depth - 1); if (!depth) flat += '.'; continue; }
    if (!depth) flat += c;
  }
  return flat.split(',').map(part => {
    const last = part.trim().split(/[\s>+~]+/).pop() || '';
    const m = /^([a-zA-Z][\w-]*)/.exec(last);
    return m ? m[1].toLowerCase() : '';
  }).filter(Boolean);
}

const BAD_SELECTOR = /[{};<@\\]|\/\*|::|:(before|after|first-line|first-letter)\b/i;
const BAD_VALUE = /[;{}<>@\\\n\r]|url\s*\(|expression|\/\*|!important|image-set|import/i;

function checkCamera(c, f, add) {
  const shape = 'camera is { selector } or { x, y, w, h } (page pixels): the part of the page to crop close on';
  if (!isObj(c)) { add('camera', shape); return; }
  const keys = Object.keys(c);
  if (keys.length === 1 && keys[0] === 'selector') {
    if (typeof c.selector !== 'string' || !c.selector.trim() || c.selector.length > 200 || BAD_SELECTOR.test(c.selector)) add('camera', 'camera selector must be a plain selector of at most 200 characters');
    return;
  }
  const rect = ['x', 'y', 'w', 'h'];
  if (keys.length !== 4 || !rect.every(k => own(c, k) && typeof c[k] === 'number' && Number.isFinite(c[k]))) { add('camera', shape); return; }
  if (c.x < 0 || c.y < 0 || c.x > 20000 || c.y > 20000 || c.w <= 0 || c.h <= 0) { add('camera', 'camera x and y are 0-20000 and w and h are above 0'); return; }
  // #story-page is exactly the frame width (only its height grows), so a rect past its right edge crops onto empty space.
  if (c.x + Math.min(c.w, f.w) > f.w) { add('camera', `camera x ${c.x} + w ${c.w} runs past the page's right edge at ${f.w}px: keep x + w within ${f.w} (a rect wider than the page starts at x 0)`); return; }
  const s = Math.min(f.w / c.w, f.h / c.h);
  if (s > CAMERA_MAX_SCALE || s < CAMERA_MIN_SCALE) add('camera', `camera ${c.w}x${c.h} zooms ${Math.round(s * 100) / 100}x; keep the zoom within ${CAMERA_MIN_SCALE}x-${CAMERA_MAX_SCALE}x of the frame`);
}

/** Validate a parsed story. Returns { ok, duration_ms, problems, timeline }. */
export function check(story) {
  const problems = [];
  const add = (code, message, step) => problems.push(step === undefined ? { code, message } : { step, code, message });
  if (!isObj(story)) throw bad('story must be a JSON object');
  for (const k of Object.keys(story)) if (!TOP_KEYS.includes(k)) add('unknown-key', `unknown key "${k}": the story takes ${TOP_KEYS.join(', ')}`);
  if (typeof story.title !== 'string' || !story.title.trim() || story.title.length > 80) add('bad-title', 'title must be a non-empty string of at most 80 characters');
  if (!own(FORMATS, story.format)) add('bad-format', 'format must be "square" (1080x1080) or "wide" (1920x1080)');
  if (easingCss(story.easing) === null) add('easing', 'easing must be one of linear, ease, ease-in, ease-out, ease-in-out or a cubic-bezier array [x1,y1,x2,y2] with x within 0..1; one easing is shared by every step');
  for (const k of ['intro_ms', 'outro_ms']) if (story[k] !== undefined && !isInt(story[k], 0, 5000)) add('intro-outro', `${k} must be a whole number from 0 to 5000`);
  if (story.credit !== undefined && (typeof story.credit !== 'string' || story.credit.length > 60)) add('credit-length', 'credit must be a string of at most 60 characters');
  const notes = [];
  if (story.credit === undefined || (typeof story.credit === 'string' && !story.credit.trim())) notes.push({ code: 'credit-missing', message: `no credit: emit shows "${DEFAULT_CREDIT}"; set credit to name the author` });
  if (story.camera !== undefined) checkCamera(story.camera, FORMATS[story.format] || FORMATS.square, add);
  const steps = story.steps;
  if (!Array.isArray(steps)) {
    add('step-count', 'steps must be an array of three to five steps');
  } else {
    if (steps.length < 3 || steps.length > 5) add('step-count', `a story has three to five steps, found ${steps.length}: merge passes so each step changes something visible`);
    const ids = new Set(), swapSel = new Set(), redSel = new Set();
    let swaps = 0;
    steps.forEach((s, i) => {
      const at = isObj(s) && typeof s.id === 'string' && s.id ? s.id : `#${i + 1}`;
      if (!isObj(s)) { add('bad-shape', `step ${i + 1} must be an object`, at); return; }
      for (const k of Object.keys(s)) if (!STEP_KEYS.includes(k)) add('unknown-key', `unknown step key "${k}": steps change CSS in place, so no html or new elements (keys: ${STEP_KEYS.join(', ')})`, at);
      if (typeof s.id !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(s.id)) add('step-id', 'id must be 1-32 characters of a-z 0-9 - _', at);
      else if (ids.has(s.id)) add('step-id-duplicate', `id "${s.id}" is used twice`, at);
      else ids.add(s.id);
      if (typeof s.label !== 'string' || !s.label.trim() || s.label.length > 60) add('step-label', 'label must be a non-empty string of at most 60 characters', at);
      if (s.tween_ms !== undefined && !isInt(s.tween_ms, 0, MAX_TWEEN_MS)) add('tween-range', `tween_ms must be a whole number from 0 to ${MAX_TWEEN_MS}`, at);
      if (s.hold_ms !== undefined && !isInt(s.hold_ms, 0, 5000)) add('hold-range', 'hold_ms must be a whole number from 0 to 5000', at);
      let changes = 0, spacingOrCorner = false;
      if (s.css !== undefined) {
        if (!isObj(s.css)) add('bad-shape', 'css must be an object of selector to property changes', at);
        else for (const [sel, props] of Object.entries(s.css)) {
          if (!sel.trim() || sel.length > 200 || BAD_SELECTOR.test(sel)) add('css-selector', `selector "${sel.slice(0, 60)}" must be a plain selector of at most 200 characters (no { } ; < @, comments or pseudo-elements)`, at);
          if (!isObj(props)) { add('bad-shape', `css["${sel.slice(0, 60)}"] must be an object of property to value`, at); continue; }
          for (const [prop, raw] of Object.entries(props)) {
            changes++;
            const p = prop.toLowerCase();
            if (p === 'content') add('css-content', 'the content property is not allowed; use swap { selector, text } for a text change', at);
            else if (!tweenable(p)) add('css-prop', `"${prop}" cannot tween in place; use one of color, background-color, opacity, transform, filter, letter-spacing, font-weight, border-radius, box-shadow, gap, padding, margin (a gradient fades out on its own layer instead)`, at);
            const v = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw;
            if (typeof v !== 'string' || !v.trim() || v.length > 200 || BAD_VALUE.test(v)) add('css-value', `value for ${prop} must be a short plain string (no url(), ; { } < > @ \\ or !important)`, at);
            else if (RADIUS.test(p)) {
              const m = /^\s*(\d+(?:\.\d+)?)(px)?\s*$/.exec(v);
              if (m && Number(m[1]) >= 500) add('pill-radius', `${prop}: ${v} is a pill radius and cannot tween; write half the element height instead`, at);
            }
            if (SPACING.test(p) || RADIUS.test(p)) spacingOrCorner = true;
          }
        }
      }
      if (s.swap !== undefined) {
        const w = s.swap;
        if (!isObj(w) || typeof w.selector !== 'string' || typeof w.text !== 'string') add('bad-shape', 'swap must be { selector, text, ink? } with string selector and text', at);
        else {
          changes++; swaps++;
          if (w.text.length > 80) add('swap-length', `swap text is ${w.text.length} characters; at most 80`, at);
          if (!w.selector.trim() || w.selector.length > 200 || BAD_SELECTOR.test(w.selector)) add('css-selector', 'swap selector must be a plain selector', at);
          const rep = typeof w.selector === 'string' ? lastTypes(w.selector).filter(x => REPLACED.includes(x)) : [];
          if (rep.length) add('swap-replaced', `swap selector names <${rep[0]}>, which cannot hold the new text: swap the text of an element around it`, at);
          if (swapSel.has(w.selector)) add('swap-selector-reuse', `"${w.selector.slice(0, 60)}" is swapped in two steps; one swap per element`, at);
          swapSel.add(w.selector);
          if (w.ink !== undefined && (typeof w.ink !== 'string' || w.ink.length > 40 || BAD_VALUE.test(w.ink))) add('css-value', 'swap ink must be a short plain color string', at);
        }
      }
      if (isObj(s.css)) for (const [sel, props] of Object.entries(s.css)) {
        if (swapSel.has(sel) && isObj(props) && Object.keys(props).some(p => p.toLowerCase() === 'color')) notes.push({ code: 'swap-ink', message: `${at}: "${sel.slice(0, 60)}" changes color in or after the step that swaps its text; the old text stays hidden and the new text keeps the swap ink, so set swap.ink to the colour you want` });
      }
      if (changes === 0) add('step-empty', 'a step must change something: give it css changes or a swap', at);
      if (s.redline !== undefined) {
        const r = s.redline;
        if (!isObj(r) || typeof r.selector !== 'string' || typeof r.label !== 'string') add('bad-shape', 'redline must be { selector, label, measure? }', at);
        else {
          if (!r.label.trim() || r.label.length > 40) add('redline-label', 'redline label names the slop this step removes, 1-40 characters', at);
          if (r.measure !== undefined && (typeof r.measure !== 'string' || r.measure.length > 20)) add('redline-measure', 'redline measure is a string of at most 20 characters, such as "24px"', at);
          if (!r.selector.trim() || r.selector.length > 200 || BAD_SELECTOR.test(r.selector)) add('css-selector', 'redline selector must be a plain selector', at);
          if (redSel.has(r.selector)) add('redline-selector-reuse', `"${r.selector.slice(0, 60)}" is redlined in two steps; one redline per element`, at);
          redSel.add(r.selector);
        }
      } else if (spacingOrCorner) add('redline-missing', 'this step changes spacing or corners: add a redline naming the slop it removes', at);
    });
    if (swaps > MAX_SWAPS) add('swap-count', `${swaps} text swaps; keep them to ${MAX_SWAPS} at most so the video does not read as a cut between two pictures`);
  }
  const tl = timeline(story);
  if (tl.duration_ms > MAX_DURATION_MS) add('duration', `total ${tl.duration_ms} ms is over ${MAX_DURATION_MS} ms: shorten holds, tweens, intro or outro`);
  return { ok: problems.length === 0, duration_ms: tl.duration_ms, problems, notes, timeline: tl.timeline };
}

export function template() {
  return {
    title: 'Pricing page, before and after',
    format: 'square',
    easing: 'ease-in-out',
    intro_ms: 500,
    outro_ms: 1200,
    credit: 'Redesign by the team',
    steps: [
      { id: 'color', label: 'Calm the palette', css: { '.card': { 'background-color': '#fafafa', 'box-shadow': '0 1px 2px rgba(0,0,0,0.08)' }, 'h1': { color: '#111827' } }, tween_ms: 700, hold_ms: 800 },
      { id: 'space', label: 'Even out the spacing', css: { '.card': { padding: '32px', gap: '16px' } }, redline: { selector: '.card', label: 'uneven gaps', measure: '16px' }, tween_ms: 700, hold_ms: 900 },
      { id: 'corners', label: 'Match the corners', css: { '.btn': { 'border-radius': '24px' }, '.card': { 'border-radius': '12px' } }, redline: { selector: '.btn', label: 'mixed radii', measure: '12px' }, swap: { selector: '.btn', text: 'Start free' }, tween_ms: 600, hold_ms: 1000 },
    ],
  };
}

// ---------- emit ----------

const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escCssStr = s => String(s).replace(/[\\"]/g, '\\$&').replace(/[\n\r]/g, ' ').replace(/</g, '\\3c ').replace(/>/g, '\\3e ');
const q = n => (n === 0 ? '0ms' : `${n}ms`);

const DROP_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed']);
const RCDATA = new Set(['title', 'textarea']);

/** Index of the '>' that ends the tag whose attributes start at j (quoted attribute values may hold '>' or '<'), or -1. Linear. */
function tagEnd(s, j) {
  const n = s.length;
  for (let k = j; k < n;) {
    const c = s.charCodeAt(k);
    if (c === 62) return k; // >
    if (c === 61) { // = : a value follows, maybe quoted
      k++;
      while (k < n && /\s/.test(s[k])) k++;
      if (s[k] === '"' || s[k] === "'") { const e = s.indexOf(s[k], k + 1); if (e < 0) return -1; k = e + 1; }
      continue;
    }
    k++;
  }
  return -1;
}

/**
 * One linear pass over the page: comments, quoted attribute values and title/textarea text are copied as they are (so a
 * "<script" or "<style" mentioned there is left alone); script/iframe/object/embed elements and link tags are dropped;
 * style contents are pulled out; doctype and html tags are dropped; the body tag and the last </body> are located.
 * When a close tag is missing only the open tag is dropped (never the rest of the page).
 */
function scanPage(html) {
  const lower = html.toLowerCase();
  const n = html.length;
  const styles = [];
  const noClose = new Set();
  const closeAt = (name, from) => {
    if (noClose.has(name)) return -1;
    const c = lower.indexOf(`</${name}`, from);
    if (c < 0) noClose.add(name);
    return c;
  };
  let out = '', last = 0, i = 0, scripts = 0, links = 0, bodyStart = -1, bodyEnd = -1, headEnd = -1, bodyAttrs = '';
  const flush = to => { out += html.slice(last, to); last = to; };
  for (;;) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (lower.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (lower.startsWith('<!doctype', lt)) { const e = html.indexOf('>', lt); flush(lt); i = last = e < 0 ? n : e + 1; continue; }
    const m = /^<(\/?)([a-z][a-z0-9:-]*)/.exec(lower.slice(lt, lt + 64));
    if (!m) { i = lt + 1; continue; }
    const closing = m[1] === '/', name = m[2];
    const gt = tagEnd(html, lt + m[0].length);
    const after = gt < 0 ? n : gt + 1;
    if (closing) {
      if (name === 'body') { flush(lt); bodyEnd = out.length; }
      else if (name === 'head') { flush(after); headEnd = out.length; }
      else if (name === 'html') { flush(lt); last = after; }
      i = after;
      continue;
    }
    if (name === 'html') { flush(lt); i = last = after; continue; }
    if (name === 'body' && bodyStart < 0) { flush(lt); bodyAttrs = html.slice(lt + 5, gt < 0 ? n : gt); i = last = after; bodyStart = out.length; continue; }
    if (name === 'link') { flush(lt); links++; i = last = after; continue; }
    if (DROP_ELEMENTS.has(name)) {
      flush(lt); scripts++;
      i = last = after;
      if (name === 'embed' || gt < 0) continue;
      const c = closeAt(name, after);
      if (c >= 0) { const e = html.indexOf('>', c); i = last = e < 0 ? n : e + 1; }
      continue;
    }
    if (name === 'style') {
      flush(lt);
      i = last = after;
      if (gt < 0) continue;
      const c = closeAt('style', after);
      if (c >= 0) { styles.push(html.slice(after, c)); const e = html.indexOf('>', c); i = last = e < 0 ? n : e + 1; }
      continue;
    }
    if (RCDATA.has(name) && gt >= 0) { const c = closeAt(name, after); i = c < 0 ? after : c; continue; }
    i = after;
  }
  flush(n);
  let inner;
  if (bodyStart >= 0) inner = out.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : out.length);
  else inner = headEnd >= 0 ? out.slice(headEnd) : out;
  return { inner, bodyAttrs, styles, scripts, links };
}

const ROOT_MARK = '\u0000story-root\u0000';
const ROOT_SEL = /^(html|:root)$/i;

/**
 * font-size on html/:root rules stays on the story page's real <html> (so rem matches the original screen); the rest of
 * those rules is scoped to #story-page like any html/body rule. One linear pass over the rule text.
 */
function liftRootFontSize(css) {
  let out = '', last = 0, segStart = 0, openAt = -1, sel = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e < 0 ? css.length : e + 1; continue; }
    if (c === '{') { sel = css.slice(segStart, i); openAt = i; segStart = i + 1; continue; }
    if (c === ';' && openAt < 0) { segStart = i + 1; continue; }
    if (c !== '}') continue;
    if (openAt >= 0) {
      const body = css.slice(openAt + 1, i);
      const sels = sel.split(',').map(x => x.trim());
      const roots = sels.filter(x => ROOT_SEL.test(x)), others = sels.filter(x => !ROOT_SEL.test(x));
      const decls = body.split(';');
      const sizes = decls.filter(d => /^\s*font-size\s*:/i.test(d));
      if (roots.length && sizes.length) {
        const rest = decls.filter(d => !/^\s*font-size\s*:/i.test(d)).join(';');
        const lead = sel.slice(0, sel.length - sel.trimStart().length);
        out += css.slice(last, openAt - sel.length) + lead
          + (others.length ? `${others.join(',')}{${body}}` : '')
          + `${roots.join(',')}{${rest}}${ROOT_MARK}{${sizes.map(d => d.trim()).join(';')}}`;
        last = i + 1;
      }
    }
    openAt = -1; segStart = i + 1;
  }
  return out + css.slice(last);
}

/** html/body selectors in the page's own styles now mean the page container (root font-size stays on <html>). */
function scopeCss(css) {
  return liftRootFontSize(css)
    .replace(/(^|[,}{;\s])html\s*>?\s*body(?![\w-])/gi, '$1#story-page')
    .replace(/(^|[,}{;\s])(html|body|:root)(?![\w-])/gi, '$1#story-page')
    .split(ROOT_MARK).join('html');
}

/** The original page, made safe to play: scripts, links, iframes, objects and on* handlers removed. */
export function preparePage(html) {
  const sc = scanPage(html.replace(/^﻿/, ''));
  const inner = sc.inner.replace(TAG, (tag, name, attrs) => `<${name}${attrs.replace(HANDLER, '')}>`);
  const keep = [];
  for (const m of sc.bodyAttrs.matchAll(/\b(class|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) keep.push(`${m[1].toLowerCase()}="${escHtml(m[2] ?? m[3] ?? m[4] ?? '')}"`);
  return { body: inner, bodyAttrs: keep.join(' '), css: sc.styles.map(scopeCss).join('\n'), stripped: { scripts: sc.scripts, links: sc.links } };
}

/**
 * The step layers plus the shared animation stack. Every animation a step adds to an element lives in its own slot, a
 * custom property --story-aN set by that step's selector; one rule for the union of all selectors lists every slot in
 * order (var(--story-aN,none)), so an element matched by two different selector strings (h1 and .hero h1) runs both
 * steps' tweens. A reset on * stops the slots from inheriting. Swap hide slots come last, so the swapped element's old
 * text stays transparent under any later colour step.
 */
function stepLayers(story) {
  const ease = easingCss(story.easing);
  const tl = timeline(story).timeline;
  const prev = new Map(); // selector -> prop -> last value
  const final = new Map(); // selector -> prop -> final value
  const slots = []; // { n, sel, late }
  const marks = { swaps: [], tags: [] };
  const layers = [];
  story.steps.forEach((s, i) => {
    const t = tl[i];
    const tween = t.tween_end_ms - t.start_ms;
    const rules = [], reduced = [], keyframes = [];
    const sets = new Map(); // selector -> custom property declarations of this step
    const slot = (sel, anim, late = false) => {
      const n = slots.length + 1;
      slots.push({ n, sel, late });
      if (!sets.has(sel)) sets.set(sel, []);
      sets.get(sel).push(`--story-a${n}:${anim}`);
    };
    let k = 0;
    for (const [sel, props] of Object.entries(s.css || {})) {
      const name = `story-s${i + 1}-${k++}`;
      const from = [], to = [];
      if (!prev.has(sel)) prev.set(sel, new Map());
      if (!final.has(sel)) final.set(sel, new Map());
      for (const [prop, raw] of Object.entries(props)) {
        const p = prop.toLowerCase(), v = String(raw).trim();
        if (prev.get(sel).has(p)) from.push(`${p}:${prev.get(sel).get(p)}`);
        to.push(`${p}:${v}`);
        prev.get(sel).set(p, v);
        final.get(sel).set(p, v);
      }
      keyframes.push(`@keyframes ${name}{${from.length ? `from{${from.join(';')}}` : ''}to{${to.join(';')}}}`);
      slot(sel, `${name} ${q(tween)} ${ease} ${q(t.start_ms)} 1 normal forwards`);
    }
    const win = Math.max(1, t.end_ms - t.start_ms);
    if (s.redline) {
      const r = s.redline, name = `story-r${i + 1}`;
      const ol = c => `outline-style:solid;outline-width:2px;outline-offset:3px;outline-color:${c}`;
      keyframes.push(`@keyframes ${name}{0%,100%{${ol('transparent')}}10%,90%{${ol('#e5484d')}}}`);
      keyframes.push(`@keyframes ${name}-tag{0%{opacity:0}10%{opacity:1}90%{opacity:1}100%{opacity:0}}`);
      slot(r.selector, `${name} ${q(win)} linear ${q(t.start_ms)} 1 normal forwards`);
      const label = r.measure ? `${r.label}  ${r.measure}` : r.label;
      // The outline lives only in the animation. The tag is a <story-tag> in the overlay layer at the end of #story-page
      // (never inside the element, never its ::after), anchored to the element with CSS anchor positioning, so the
      // element, its children and its own pseudo-elements stay exactly as the page made them.
      const key = `r${i + 1}`;
      marks.tags.push([r.selector, key]);
      rules.push(`html.story-play story-tag[data-story-tag="${key}"]{position:absolute;left:anchor(left,0px);top:anchor(top,0px);transform:translateY(-100%);font:600 12px/1.4 ui-monospace,Menlo,monospace;color:#fff;background:#e5484d;padding:1px 6px;border-radius:2px;white-space:nowrap;pointer-events:none;z-index:9;opacity:0;animation:${name}-tag ${q(win)} linear ${q(t.start_ms)} 1 normal forwards}`);
      rules.push(`html.story-play story-tag[data-story-tag="${key}"]::before{content:"${escCssStr(label)}"}`);
      reduced.push(`html.story-play :is(${r.selector}){outline:none !important;animation-name:none !important}`, `html.story-play story-tag[data-story-tag="${key}"]{display:none !important}`);
    }
    if (s.swap) {
      const w = s.swap, name = `story-w${i + 1}`, key = `w${i + 1}`;
      keyframes.push(`@keyframes ${name}{0%{opacity:1;filter:blur(0)}49%{opacity:0;filter:blur(8px);color:inherit}50%{opacity:0;filter:blur(8px);color:transparent}100%{opacity:1;filter:blur(0);color:transparent}}`);
      keyframes.push(`@keyframes ${name}-in{0%,49%{opacity:0}100%{opacity:1}}`);
      keyframes.push(`@keyframes ${name}-hide{to{color:transparent}}`);
      slot(w.selector, `${name} ${q(tween)} ${ease} ${q(t.start_ms)} 1 normal forwards`);
      // From the end of the swap tween on, the old text is held transparent by a slot that sits after every other one.
      slot(w.selector, `${name}-hide 0ms linear ${q(t.tween_end_ms)} 1 normal forwards`, true);
      const ink = w.ink && w.ink.trim() ? w.ink.trim() : '#111';
      marks.swaps.push([w.selector, key]);
      // The new text is a <story-swap> inserted as the element's first child (out of flow, so nothing moves): it sits at
      // the old text's static position, inherits the element's font, and is one line as wide as the new text.
      rules.push(`html.story-play story-swap[data-story-swap="${key}"]{position:absolute;white-space:nowrap;width:max-content;color:${ink};pointer-events:none;opacity:0;animation:${name}-in ${q(tween)} ${ease} ${q(t.start_ms)} 1 normal forwards}`);
      rules.push(`html.story-play story-swap[data-story-swap="${key}"]::before{content:"${escCssStr(w.text)}"}`);
      reduced.push(`html.story-play story-swap[data-story-swap="${key}"]{opacity:1 !important;animation:none !important}`);
    }
    for (const [sel, decl] of sets) rules.push(`html.story-play :is(${sel}){${decl.join(';')}}`);
    for (const sel of Object.keys(s.css || {})) {
      const decl = [...final.get(sel)].map(([p, v]) => `${p}:${v} !important`).join(';');
      reduced.push(`html.story-play :is(${sel}){animation:none !important;${decl}}`);
    }
    layers.push({ id: s.id, start: t.start_ms, end: t.end_ms, css: `${keyframes.join('\n')}\n${rules.join('\n')}\n@media (prefers-reduced-motion:reduce){\n${reduced.join('\n')}\n}` });
  });
  return { layers, stack: stackCss(slots, marks), marks };
}

/** The reset, the union rule that lists every slot, and the overlay base rules. Empty when no step animates anything. */
function stackCss(slots, marks) {
  if (!slots.length) return '';
  const order = [...slots.filter(x => !x.late), ...slots.filter(x => x.late)];
  const sels = [...new Set(slots.map(x => x.sel))];
  const out = [
    `html.story-play *{${slots.map(x => `--story-a${x.n}:none`).join(';')}}`,
    `html.story-play :is(${sels.join(',')}){animation:${order.map(x => `var(--story-a${x.n},none)`).join(',')}}`,
  ];
  if (marks.tags.length || marks.swaps.length) out.push('story-layer{display:contents !important}story-swap,story-tag{display:block}');
  if (marks.tags.length) out.push('@supports not (anchor-name:--story-a){story-tag{display:none !important}}');
  // Under reduced motion a swapped element's old text stays hidden even when a later step's final colour is !important.
  const swapSels = [...new Set(marks.swaps.map(x => x[0]))];
  if (swapSels.length) out.push(`@media (prefers-reduced-motion:reduce){${swapSels.map(x => `html.story-play :is(${x}):not(#story-nil#story-nil#story-nil){color:transparent !important}`).join('\n')}}`);
  return '\n' + out.join('\n');
}

/**
 * The page's only script, present when a step swaps text or draws a redline, or the camera follows a selector. It
 * inserts the swap text (<story-swap>, first child of each matched element) and the redline tags (<story-tag>, in one
 * <story-layer> at the end of #story-page, each anchored to its element by a unique anchor-name), then, for a selector
 * camera, measures the element on the window load event and again once document.fonts is ready (each time from the
 * t=0 state: animations are seeked to 0 for the measure and put back). No timers and no clock reads.
 */
function runtimeScript(story, f, marks) {
  const cam = story.camera && own(story.camera, 'selector') ? story.camera.selector : null;
  if (!cam && !marks.swaps.length && !marks.tags.length) return '';
  const j = v => JSON.stringify(v).replace(/</g, '\\u003c');
  const parts = ['var P=document.getElementById("story-page");if(!P)return;'];
  if (marks.swaps.length || marks.tags.length) {
    parts.push(`var Q=function(s){try{return Array.prototype.slice.call(P.querySelectorAll(s))}catch(_){return[]}},O=/^story-/,V=/^(${REPLACED.join('|')})$/;`);
    if (marks.swaps.length) parts.push(`${j(marks.swaps)}.forEach(function(w){Q(w[0]).forEach(function(e){if(e.namespaceURI!=="http://www.w3.org/1999/xhtml"||V.test(e.localName)||O.test(e.localName))return;var n=document.createElement("story-swap");n.setAttribute("data-story-swap",w[1]);n.setAttribute("aria-hidden","true");e.insertBefore(n,e.firstChild)})});`);
    if (marks.tags.length) parts.push(`var L=document.createElement("story-layer"),k=0;L.setAttribute("aria-hidden","true");${j(marks.tags)}.forEach(function(r){Q(r[0]).forEach(function(e){if(O.test(e.localName))return;var a="--story-t"+(k++),c=getComputedStyle(e).getPropertyValue("anchor-name");e.style.setProperty("anchor-name",c&&c!=="none"?c+","+a:a);var t=document.createElement("story-tag");t.setAttribute("data-story-tag",r[1]);t.style.setProperty("position-anchor",a);L.appendChild(t)})});if(k)P.appendChild(L);`);
  }
  if (cam) {
    parts.push(`function fit(){try{var e=P.querySelector(${j(cam)});if(!e)return;var an=document.getAnimations?document.getAnimations():[],ct=an.map(function(x){return x.currentTime});an.forEach(function(x,i){if(ct[i]!==null)x.currentTime=0});P.style.transform="";P.style.height="";var a=P.getBoundingClientRect(),r=e.getBoundingClientRect();an.forEach(function(x,i){if(ct[i]!==null)x.currentTime=ct[i]});var m=${CAMERA_MARGIN},x=r.left-a.left-m,y=r.top-a.top-m,w=r.width+2*m,h=r.height+2*m,s=Math.max(${CAMERA_MIN_SCALE},Math.min(${CAMERA_MAX_SCALE},${f.w}/w,${f.h}/h));P.style.height=Math.max(${f.h},Math.ceil(y+h))+"px";P.style.transformOrigin="0 0";P.style.transform="translate("+((${f.w}-w*s)/2-x*s)+"px,"+((${f.h}-h*s)/2-y*s)+"px) scale("+s+")"}catch(_){}}`);
    parts.push('if(document.readyState==="complete")fit();else addEventListener("load",fit);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){if(document.readyState==="complete")fit()});');
  }
  return `<script data-story-${cam ? 'camera' : 'marks'}>(function(){${parts.join('')}})()</script>`;
}

/** The credit shown on every video: the story's credit, or DEFAULT_CREDIT when it has none (check notes credit-missing). */
function creditText(story) {
  return typeof story.credit === 'string' && story.credit.trim() ? story.credit : DEFAULT_CREDIT;
}

/** The crop for a camera rectangle { x, y, w, h } in page pixels: the scale that fits it in the frame, centred. */
export function cameraFit(c, f) {
  const s = Math.min(f.w / c.w, f.h / c.h);
  const r = n => Math.round(n * 1000) / 1000;
  return { scale: r(s), tx: r((f.w - c.w * s) / 2 - c.x * s), ty: r((f.h - c.h * s) / 2 - c.y * s) };
}

function cameraCss(c, f) {
  if (!c || !own(c, 'w')) return '';
  const { scale, tx, ty } = cameraFit(c, f);
  return `\n#story-page{height:${Math.max(f.h, Math.ceil(c.y + c.h))}px;transform-origin:0 0;transform:translate(${tx}px,${ty}px) scale(${scale})}`;
}

/** Build the single-file story page. The story must pass check; the page is the original HTML text. */
export function emit(story, pageHtml) {
  const res = check(story);
  if (!res.ok) throw bad(`story is not ok: ${res.problems.slice(0, 5).map(p => `${p.step ? p.step + ': ' : ''}${p.code}`).join(', ')}${res.problems.length > 5 ? ', ...' : ''}`);
  const f = FORMATS[story.format];
  const page = preparePage(pageHtml);
  const { layers, stack, marks } = stepLayers(story);
  const D = res.duration_ms;
  const credit = `<div id="story-credit">${escHtml(creditText(story))}</div>`;
  const cam = cameraCss(story.camera, f);
  const creditStart = Math.max(0, D - num(story.outro_ms, DEFAULTS.outro_ms));
  const base = `html,body{margin:0;padding:0;background:#0b0b0c;overflow:hidden}
#story-frame{position:relative;width:${f.w}px;height:${f.h}px;margin:0 auto;overflow:hidden;background:#fff}
#story-page{position:absolute;left:0;top:0;width:${f.w}px;height:${f.h}px;overflow:hidden;box-sizing:border-box}${cam}
#story-credit{position:absolute;right:24px;bottom:16px;z-index:20;font:500 14px/1.2 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.6);padding:4px 10px;border-radius:999px;opacity:0}
@keyframes story-credit{from{opacity:0}to{opacity:1}}
html.story-play #story-credit{animation:story-credit 300ms linear ${q(creditStart)} 1 normal forwards}
@media (prefers-reduced-motion:reduce){html.story-play #story-credit{opacity:1;animation:none}}${stack}`;
  const script = runtimeScript(story, f, marks);
  const styles = layers.map(l => `<style data-story-step="${escHtml(l.id)}" data-start-ms="${l.start}" data-end-ms="${l.end}">\n${l.css}\n</style>`).join('\n');
  const html = `<!doctype html>
<html lang="en" class="story-play">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${f.w}">
<meta name="story-duration-ms" content="${D}">
<meta name="story-format" content="${story.format}">
<title>${escHtml(story.title)}</title>
<style data-story-frame>
${base}
</style>
<style data-story-page>
${page.css.replace(/<\/style/gi, '<\\/style')}
</style>
${styles}
</head>
<body>
<div id="story-frame">
<div id="story-page"${page.bodyAttrs ? ' ' + page.bodyAttrs : ''}>
${page.body}
</div>
${credit}
</div>${script ? `\n${script}` : ''}
</body>
</html>
`;
  return { html, duration_ms: D, steps: story.steps.length, format: story.format, stripped: page.stripped };
}

// ---------- io ----------

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

async function readFileText(cwd, file, what) {
  const p = path.resolve(cwd, file);
  let buf;
  try { buf = await openRegular(p); } catch (e) {
    if (e instanceof KitExit) throw e;
    throw bad(`cannot read ${what} ${p}: ${e.code || e.message}`);
  }
  return buf;
}

function parseFlags(rest, spec) {
  const got = {};
  while (rest.length) {
    const a = rest.shift();
    const def = spec[a];
    if (!def || !own(spec, a)) throw bad(`unexpected argument "${a}"\n${usage}`);
    if (own(got, a)) throw bad(`${a} given more than once`);
    if (def === 'bool') { got[a] = true; continue; }
    if (!rest.length || rest[0].startsWith('--')) throw bad(`${a} needs a value`);
    const v = rest.shift();
    if (!v) throw bad(`${a} needs a non-empty value`);
    got[a] = v;
  }
  return got;
}

async function readStory(flags, io) {
  const cwd = io.cwd || process.cwd();
  let buf;
  if (flags['--file'] !== undefined) buf = await readFileText(cwd, flags['--file'], 'story');
  else buf = Buffer.from(await (typeof io.stdinBytes === 'function' ? io.stdinBytes({ maxBytes: MAX_BYTES + 1 }) : io.stdin({ maxBytes: MAX_BYTES + 1 })));
  if (buf.length > MAX_BYTES) throw bad('input is larger than 8 MiB');
  if (buf.includes(0)) throw bad('input looks binary (contains NUL bytes)');
  const text = buf.toString('utf-8').replace(/^﻿/, '');
  if (!text.trim()) throw bad('no input: pass the story JSON on stdin or --file');
  let story;
  try { story = JSON.parse(text); } catch (e) { throw bad(`story is not valid JSON: ${e.message}`); }
  if (!isObj(story)) throw bad('story must be a JSON object');
  return story;
}

/** --out must not name the --page or --file input: the same path, the same real path, or the same device and inode. */
async function refuseInputAsOut(outPath, cwd, flags) {
  const real = async p => { try { return await fs.realpath(p); } catch { return null; } };
  const stat = async p => { try { return await fs.stat(p, { bigint: true }); } catch { return null; } };
  const ost = await stat(outPath), oreal = await real(outPath);
  for (const flag of ['--page', '--file']) {
    if (flags[flag] === undefined) continue;
    const inPath = path.resolve(cwd, flags[flag]);
    const ist = await stat(inPath);
    const same = inPath === outPath || (oreal !== null && oreal === await real(inPath))
      || (ost && ist && ost.ino !== 0n && ost.dev === ist.dev && ost.ino === ist.ino);
    if (same) throw bad(`--out ${outPath} is the same file as ${flag}; refusing to overwrite an input`);
  }
}

export async function run(args, io) {
  const [cmd, ...rest] = args;
  const cwd = io.cwd || process.cwd();
  if (cmd === 'template') {
    if (rest.length) throw bad(`template takes no arguments\n${usage}`);
    return template();
  }
  if (cmd === 'check') {
    const flags = parseFlags(rest, { '--file': 'val', '--strict': 'bool' });
    const res = check(await readStory(flags, io));
    if (flags['--strict'] && !res.ok) return { ...res, exit: 2 };
    return res;
  }
  if (cmd === 'emit') {
    const flags = parseFlags(rest, { '--file': 'val', '--page': 'val', '--out': 'val' });
    if (flags['--page'] === undefined) throw bad(`emit needs --page <original.html>\n${usage}`);
    const story = await readStory(flags, io);
    const pbuf = await readFileText(cwd, flags['--page'], 'page');
    if (pbuf.includes(0)) throw bad('page looks binary (contains NUL bytes)');
    const pageText = pbuf.toString('utf-8');
    if (!pageText.trim()) throw bad('page is empty');
    const r = emit(story, pageText);
    if (flags['--out'] === undefined) return r;
    const outPath = path.resolve(cwd, flags['--out']);
    await refuseInputAsOut(outPath, cwd, flags);
    try { await fs.writeFile(outPath, r.html); } catch (e) { throw bad(`cannot write ${outPath}: ${e.code || e.message}`); }
    return { out: outPath, bytes: Buffer.byteLength(r.html), duration_ms: r.duration_ms, steps: r.steps, format: r.format, stripped: r.stripped };
  }
  throw bad(`first argument must be check, emit or template\n${usage}`);
}
