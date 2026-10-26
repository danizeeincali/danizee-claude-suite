/**
 * motion-plan — before animating a design, decide whether the job is a self-contained showcase (plays from an
 * empty state and loops) or a website section (animates once on scroll with live text), then map every page
 * section to its motion. Pure: it reads JSON (stdin or --file, at most 8 MiB) and prints the plan.
 *
 *   motion-plan [--file <f>]   → { mode, assumed, why, plays, sections: [{ id, motion, note }] }
 *
 * Input: { request: string, has_site_codebase: bool, sections: [{ id, kind: hero|cards|mockup|text|media|other,
 *          has_visual?: bool }], mode?: showcase|website }. Unknown keys are refused (exit 1).
 * Mode, first rule that applies: explicit `mode`; a site codebase; website words (page, site, section, scroll);
 * showcase words (loop, reel, demo, video, showcase); otherwise website, flagged assumed. Words match whole words,
 * case-insensitively (plural or -ing/-ed forms too), so "loophole" is not "loop". A request naming both kinds of
 * word follows the order above, and the why says so.
 * Motion: hero gets a small load-in on its text; cards with a visual get a card intro and a story, cards without
 * only the intro; a mockup gets a load-in only; text is left to the page's normal scroll reveal; media gets a load-in.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'motion-plan';
export const usage = 'cli.js motion-plan [--file <f>]  (JSON {request, has_site_codebase, sections:[{id,kind,has_visual?}], mode?} on stdin or --file)';

export const KINDS = ['hero', 'cards', 'mockup', 'text', 'media', 'other'];
export const MODES = ['showcase', 'website'];
const TOP_KEYS = ['request', 'has_site_codebase', 'sections', 'mode'];
const SECTION_KEYS = ['id', 'kind', 'has_visual'];
const MAX_BYTES = 8 * 1024 * 1024;
const WEBSITE_WORDS = ['page', 'site', 'section', 'scroll'];
const SHOWCASE_WORDS = ['loop', 'reel', 'demo', 'video', 'showcase'];

const bad = m => new KitExit(m, 1);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function noUnknown(o, allowed, where) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw bad(`unknown key "${k}" in ${where} (allowed: ${allowed.join(', ')})`);
}

/** Validate the input; returns a fresh normalised object. */
export function normalize(input) {
  if (!isObj(input)) throw bad('input must be a JSON object');
  noUnknown(input, TOP_KEYS, 'input');
  if (typeof input.request !== 'string' || !input.request.trim()) throw bad('input.request must be a non-empty string');
  if (typeof input.has_site_codebase !== 'boolean') throw bad('input.has_site_codebase must be a boolean');
  if (!Array.isArray(input.sections)) throw bad('input.sections must be an array');
  if (input.mode !== undefined && !MODES.includes(input.mode)) throw bad(`input.mode must be one of ${MODES.join(', ')}`);
  const seen = new Set();
  const sections = input.sections.map((s, i) => {
    const where = `sections[${i}]`;
    if (!isObj(s)) throw bad(`${where} must be an object`);
    noUnknown(s, SECTION_KEYS, where);
    if (typeof s.id !== 'string' || !s.id) throw bad(`${where}.id must be a non-empty string`);
    if (!KINDS.includes(s.kind)) throw bad(`${where}.kind must be one of ${KINDS.join(', ')}`);
    if (s.has_visual !== undefined && typeof s.has_visual !== 'boolean') throw bad(`${where}.has_visual must be a boolean`);
    if (seen.has(s.id)) throw bad(`${where}.id "${s.id}" is a duplicate; section ids must be unique`);
    seen.add(s.id);
    return { ...s };
  });
  return { request: input.request, has_site_codebase: input.has_site_codebase, sections, mode: input.mode };
}

const stem = w => new RegExp(`(?<![A-Za-z0-9])${w}(?:s|ing|ed)?(?![A-Za-z0-9])`, 'i');
const hits = (text, words) => words.filter(w => stem(w).test(text));
const list = a => a.map(w => `"${w}"`).join(', ');

/** Decide the mode: { mode, assumed, why }. Pure. */
export function decideMode({ request, has_site_codebase, mode }) {
  const web = hits(request, WEBSITE_WORDS);
  const show = hits(request, SHOWCASE_WORDS);
  if (mode) return { mode, assumed: false, why: `Mode set explicitly to ${mode}; an explicit mode wins over every other rule.` };
  if (has_site_codebase) return { mode: 'website', assumed: false, why: 'There is a site codebase, so this is a website section that animates in place.' };
  if (web.length) {
    const also = show.length ? ` The request also names showcase words (${list(show)}), but website words come first in the order of rules, so website wins.` : '';
    return { mode: 'website', assumed: false, why: `The request names website words (${list(web)}), so this is a website section.${also}` };
  }
  if (show.length) return { mode: 'showcase', assumed: false, why: `The request names showcase words (${list(show)}) and no website words, so this is a self-contained showcase.` };
  return { mode: 'website', assumed: true, why: 'Assumed website: no explicit mode, no site codebase and no website or showcase words in the request; ask the owner to confirm.' };
}

/** The motion for one section. */
export function sectionMotion(s) {
  switch (s.kind) {
    case 'hero': return { motion: ['load-in'], note: 'small load-in on the text' };
    case 'cards':
      return s.has_visual === true
        ? { motion: ['card-intro', 'story'], note: 'card intro, then a story on the visual' }
        : { motion: ['card-intro'], note: 'card intro only: no visual to tell a story with' };
    case 'mockup': return { motion: ['load-in'], note: 'more only if the owner asks' };
    case 'text': return { motion: [], note: "none: left to the page's normal scroll reveal" };
    case 'media': return { motion: ['load-in'], note: 'load-in for the media' };
    default: return { motion: [], note: 'no rule for this kind; ask the owner what should move' };
  }
}

export function plan(input) {
  const n = normalize(input);
  const d = decideMode(n);
  return {
    mode: d.mode,
    assumed: d.assumed,
    why: d.why,
    plays: d.mode === 'website' ? 'once-on-scroll' : 'loop-from-empty',
    sections: n.sections.map(s => ({ id: s.id, ...sectionMotion(s) })),
  };
}

export async function run(args, io) {
  let file;
  const rest = [...args];
  while (rest.length) {
    const a = rest.shift();
    if (a !== '--file') throw bad(`unexpected argument "${a}"\n${usage}`);
    if (!rest.length || rest[0].startsWith('--')) throw bad('--file needs a value');
    file = rest.shift();
  }
  let raw;
  if (file) {
    const p = path.resolve(io.cwd || process.cwd(), file);
    try {
      const st = await fs.stat(p);
      if (st.size > MAX_BYTES) throw bad(`${p} is over 8 MiB`);
      raw = await fs.readFile(p, 'utf-8');
    } catch (e) {
      if (e instanceof KitExit) throw e;
      throw bad(`cannot read ${p}: ${e.code || e.message}`);
    }
  } else raw = await io.stdin();
  raw = String(raw);
  if (Buffer.byteLength(raw) > MAX_BYTES) throw bad('input is over 8 MiB');
  raw = raw.replace(/^﻿/, '');
  if (!raw.trim()) throw bad('no input: pass JSON on stdin or --file');
  let data;
  try { data = JSON.parse(raw); } catch { throw bad('input is not valid JSON'); }
  return plan(data);
}
