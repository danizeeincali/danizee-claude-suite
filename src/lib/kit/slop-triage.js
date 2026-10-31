/**
 * slop-triage — grade a slop-audit result into heavy, light or refine-only, and hold the stop-before-edit gate.
 * Reads one JSON file (or stdin) and one small state file; never touches the network.
 *
 *   slop-triage grade [--file <audit.json>] [--lines <n>]   (or the audit JSON on stdin, at most 8 MiB)
 *       → { grade: "heavy"|"light"|"refine-only", why, total, groups_hit, top_groups, plan, budget_hint,
 *           confirm: { required: true, question, options } }
 *   slop-triage gate --state <file.json>
 *       → exit 0 { confirmed: true, grade, at, choice?, graded_as? } when the state file records { confirmed: true, grade, at };
 *         exit 2 { confirmed: false, why, exit: 2 } otherwise (no file, or not confirmed): the stop-before-edit gate.
 *   slop-triage confirm --state <file.json> --grade <heavy|light|refine-only> [--choice <option text>]
 *       → writes { confirmed: true, grade, choice, at } durably (guarded-fs: temp file, fsync, rename, folder fsync) and prints it.
 *         Temp files a killed run left beside the state file (`<state>.*.tmp`, `.<state>.*.tmp`) older than a minute are removed.
 *         The default choice is "Go with this direction". "Only refine, keep the design" is also a yes, but it is
 *         recorded as grade "refine-only", so a caller that branches on the gate's grade runs no redesign. Every
 *         record carries graded_as, the grade you passed.
 *         "Change the direction" is a no: it REVOKES any earlier confirmation by atomically writing
 *         { confirmed: false, choice, at } over the state file, then exits 2 (so gate exits 2 afterwards); grade again.
 *         If that revoke write fails, it exits 1 (not 2) with "could not revoke ... an earlier confirmation ... may
 *         still be in force": treat the old confirmation as still standing.
 *
 * Input is the JSON of `slop-audit scan`:
 *   { format: "html"|"css"|"jsx"|"md", hits: [{ sign, group, line, excerpt, fix }],
 *     counts: { surfaces, type, icons, spacing, copy, components, "landing-hero", motion, "template-look": n },
 *     total, manual: [sign ids] }
 * A wrong shape exits 1 with the field named, and so does an inconsistent one: total must equal hits.length and
 * each counts[group] must equal the hits in that group. Extra keys (the `exit` of `scan --strict`) are ignored.
 *
 * Grading (thresholds are exported constants): refine-only when total is 0, or total is 1 to REFINE_MAX_HITS (2)
 * in at most one group: an already good screen gets a few small refinements and never a redesign. Otherwise heavy
 * when hits span HEAVY_MIN_GROUPS (4) or more groups, or any surfaces/landing-hero hit comes with total of
 * HEAVY_BIG_TOTAL (8) or more, or, given --lines (the screen's line count), hits per 100 lines reach
 * HEAVY_DENSITY (5). Otherwise light. `plan` says what to do: heavy runs the full ordered redline passes after a
 * new direction; light lists targeted fixes by group in pass order (spacing, color, icons, copy, type, layout,
 * motion) and keeps the existing brand; refine-only is at most REFINE_MAX_EDITS (3) items, design kept: the hits become `refinements` and the
 * rest of the three are generic `suggestions` with exact values, so even a clean screen (0 hits) gets 3.
 * `confirm.question` is one question to put to the user before any edit; skip it only when the user already said
 * to just do it. `budget_hint` keeps the run quick. Advisory except gate (exit 2) and bad input (exit 1).
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import fs from 'fs/promises';
import { constants as fsc, fstatSync } from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { guardedWrite } from './guarded-fs.js';

export const verb = 'slop-triage';
export const usage = 'cli.js slop-triage grade [--file <audit.json>] [--lines <n>] | gate --state <file.json> (exit 2 when not confirmed) | confirm --state <file.json> --grade <heavy|light|refine-only> [--choice <text>]';

const MAX_BYTES = 8 * 1024 * 1024;

export const GROUPS = ['surfaces', 'type', 'icons', 'spacing', 'copy', 'components', 'landing-hero', 'motion', 'template-look'];
export const FORMATS = ['html', 'css', 'jsx', 'md'];
export const GRADES = ['heavy', 'light', 'refine-only'];
export const REFINE_MAX_HITS = 2;
export const REFINE_MAX_EDITS = 3;
export const HEAVY_MIN_GROUPS = 4;
export const HEAVY_BIG_TOTAL = 8;
export const HEAVY_DENSITY = 5; // hits per 100 lines

export const OPTIONS = ['Go with this direction', 'Change the direction', 'Only refine, keep the design'];

/** Redline pass order: audit groups folded into the pass that fixes them. */
export const PASSES = [
  { pass: 'spacing', groups: ['spacing'] },
  { pass: 'color', groups: ['surfaces'] },
  { pass: 'icons', groups: ['icons'] },
  { pass: 'copy', groups: ['copy'] },
  { pass: 'type', groups: ['type'] },
  { pass: 'layout', groups: ['components', 'landing-hero', 'template-look'] },
  { pass: 'motion', groups: ['motion'] },
];

/** Generic small refinements for a screen the audit found (nearly) clean; each has an exact value. */
export const SUGGESTIONS = [
  { suggestion: 'spacing', fix: 'Snap one off-grid gap or padding to the 4/8 scale (4, 8, 12, 16, 24, 32 px)' },
  { suggestion: 'contrast', fix: 'Check the weakest text on its background: raise it to a 4.5:1 contrast ratio (3:1 for large text)' },
  { suggestion: 'type', fix: 'Set one heading line-height to 1.1 to 1.2 and keep body text at 1.5 to 1.6' },
];

const BUDGET = {
  heavy: 'full pass set; render at most 3 times; start image generation once the direction is confirmed',
  light: 'targeted fixes only; render at most 3 times',
  'refine-only': 'a few edits (3 at most); one render to check',
};

const bad = m => new KitExit(m, 1);
const isInt = n => Number.isInteger(n) && n >= 0;

/** Validate an audit result; throws KitExit(1) naming the first wrong field. */
export function validateAudit(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw bad('audit: must be a JSON object');
  if (!FORMATS.includes(a.format)) throw bad(`audit.format: must be one of ${FORMATS.join(', ')}`);
  if (!Array.isArray(a.hits)) throw bad('audit.hits: must be an array');
  a.hits.forEach((h, i) => {
    const at = `audit.hits[${i}]`;
    if (!h || typeof h !== 'object' || Array.isArray(h)) throw bad(`${at}: must be an object`);
    if (typeof h.sign !== 'string' || !h.sign) throw bad(`${at}.sign: must be a non-empty string`);
    if (!GROUPS.includes(h.group)) throw bad(`${at}.group: must be one of ${GROUPS.join(', ')}`);
    if (!isInt(h.line)) throw bad(`${at}.line: must be a non-negative integer`);
    if (typeof h.excerpt !== 'string') throw bad(`${at}.excerpt: must be a string`);
    if (typeof h.fix !== 'string') throw bad(`${at}.fix: must be a string`);
  });
  if (!a.counts || typeof a.counts !== 'object' || Array.isArray(a.counts)) throw bad('audit.counts: must be an object');
  for (const g of GROUPS) if (!isInt(a.counts[g])) throw bad(`audit.counts.${g}: must be a non-negative integer`);
  if (!isInt(a.total)) throw bad('audit.total: must be a non-negative integer');
  if (a.total !== a.hits.length) throw bad(`audit.total: must equal hits.length (${a.hits.length})`);
  for (const g of GROUPS) {
    const n = a.hits.filter(h => h.group === g).length;
    if (a.counts[g] !== n) throw bad(`audit.counts.${g}: must equal the hits in group ${g} (${n})`);
  }
  if (!Array.isArray(a.manual) || a.manual.some(m => typeof m !== 'string')) throw bad('audit.manual: must be an array of sign ids (strings)');
  return a;
}

/** Pure grading of a validated audit. `lines` is the screen's line count, or undefined. */
export function grade(audit, lines) {
  const { counts, total } = audit;
  const hit = GROUPS.filter(g => counts[g] > 0);
  const top_groups = hit.map(g => ({ group: g, count: counts[g] })).sort((x, y) => y.count - x.count || GROUPS.indexOf(x.group) - GROUPS.indexOf(y.group)).slice(0, 3);
  const density = lines ? Math.round((total / lines) * 100 * 10) / 10 : null;
  const big = counts.surfaces > 0 || counts['landing-hero'] > 0;
  let g, why;
  if (total === 0 || (total <= REFINE_MAX_HITS && hit.length <= 1)) {
    g = 'refine-only';
    why = total === 0 ? 'no slop signs found: the screen is already good' : `only ${total} sign${total === 1 ? '' : 's'} in ${hit.length} group: the screen is already good`;
  } else if (hit.length >= HEAVY_MIN_GROUPS) {
    g = 'heavy';
    why = `signs span ${hit.length} groups (${HEAVY_MIN_GROUPS} or more)`;
  } else if (big && total >= HEAVY_BIG_TOTAL) {
    g = 'heavy';
    why = `${total} signs including surfaces or landing-hero (${HEAVY_BIG_TOTAL} or more)`;
  } else if (density !== null && density >= HEAVY_DENSITY) {
    g = 'heavy';
    why = `${density} signs per 100 lines (${HEAVY_DENSITY} or more)`;
  } else {
    g = 'light';
    why = `${total} signs in ${hit.length} group${hit.length === 1 ? '' : 's'}: mostly designed, fix what was found`;
  }
  return {
    grade: g, why, total, groups_hit: hit.length, top_groups,
    ...(density !== null ? { hits_per_100_lines: density } : {}),
    plan: plan(g, counts, audit.hits),
    budget_hint: BUDGET[g],
    confirm: {
      required: true,
      question: question(g),
      options: [...OPTIONS],
    },
  };
}

function question(g) {
  if (g === 'heavy') return 'The audit found heavy slop. Confirm the new direction before any edit?';
  if (g === 'light') return 'The audit found light slop. Confirm polishing within the existing brand before any edit?';
  return 'The screen is already good. Confirm only a few small refinements, with the design kept?';
}

function plan(g, counts, hits) {
  if (g === 'heavy') {
    return {
      mode: 'full-redline',
      steps: ['Write the new direction and wait for the user to confirm it', ...PASSES.map(p => `Redline pass: ${p.pass}`)],
      passes: PASSES.map(p => ({ pass: p.pass, groups: p.groups, count: p.groups.reduce((n, x) => n + counts[x], 0) })),
      note: 'Changing direction later means redoing every pass, so confirm first (skip only if the user said to just do it).',
    };
  }
  if (g === 'light') {
    return {
      mode: 'polish',
      steps: ['Take the direction from the existing brand; keep palette, type, layout and visual', 'Fix only what the audit found, in pass order', 'Put bigger ideas in the report as suggestions, not edits'],
      passes: PASSES.map(p => ({ pass: p.pass, groups: p.groups, count: p.groups.reduce((n, x) => n + counts[x], 0) }))
        .filter(p => p.count > 0)
        .map(p => ({ ...p, fixes: hits.filter(h => p.groups.includes(h.group)).map(h => ({ sign: h.sign, line: h.line, fix: h.fix })) })),
    };
  }
  return {
    mode: 'refine-only',
    steps: [`Offer ${REFINE_MAX_EDITS} small refinements with exact values: the audit's own first, then the suggestions below`, 'Apply them only if the user agrees', 'Keep the design; never change a good screen just to look different'],
    max_refinements: REFINE_MAX_EDITS,
    refinements: hits.map(h => ({ sign: h.sign, line: h.line, fix: h.fix })),
    suggestions: SUGGESTIONS.slice(0, REFINE_MAX_EDITS - hits.length),
  };
}

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

async function readFileText(p) {
  try {
    return (await openRegular(p)).toString('utf-8');
  } catch (e) {
    if (e instanceof KitExit) throw e;
    throw bad(`cannot read ${p}: ${e.code || e.message}`);
  }
}

/** Parse "--flag value" pairs against an allow-list; unknown or duplicate flags and missing values exit 1. */
function parseFlags(rest, allowed) {
  const out = {};
  const r = [...rest];
  while (r.length) {
    const a = r.shift();
    if (!allowed.includes(a)) throw bad(`unexpected argument "${a}"\n${usage}`);
    if (!r.length || r[0].startsWith('--')) throw bad(`${a} needs a value`);
    if (out[a] !== undefined) throw bad(`${a} given more than once`);
    const v = r.shift();
    if (!v) throw bad(`${a} needs a non-empty value`);
    out[a] = v;
  }
  return out;
}

async function readState(p) {
  let text;
  try { text = await readFileText(p); } catch (e) {
    if (e instanceof KitExit && /ENOENT/.test(e.message)) return null;
    throw e;
  }
  let s;
  try { s = JSON.parse(text); } catch { throw bad(`state file ${p} is not valid JSON`); }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw bad(`state file ${p} must be a JSON object`);
  return s;
}

export async function run(args, io) {
  const [cmd, ...rest] = args;
  const cwd = io.cwd || process.cwd();
  if (cmd === 'grade') {
    const f = parseFlags(rest, ['--file', '--lines']);
    let lines;
    if (f['--lines'] !== undefined) {
      if (!/^[0-9]+$/.test(f['--lines']) || Number(f['--lines']) < 1 || !Number.isSafeInteger(Number(f['--lines']))) throw bad('--lines must be a positive integer');
      lines = Number(f['--lines']);
    }
    let text;
    if (f['--file'] !== undefined) text = await readFileText(path.resolve(cwd, f['--file']));
    else {
      const buf = Buffer.from(await (typeof io.stdinBytes === 'function' ? io.stdinBytes({ maxBytes: MAX_BYTES + 1 }) : io.stdin({ maxBytes: MAX_BYTES + 1 })));
      if (buf.length > MAX_BYTES) throw bad('input is larger than 8 MiB');
      text = buf.toString('utf-8');
    }
    text = text.replace(/^﻿/, '');
    if (!text.trim()) throw bad('no input: pass the slop-audit scan JSON on stdin or --file');
    if (text.includes('\0')) throw bad('input looks binary (contains NUL bytes)');
    let audit;
    try { audit = JSON.parse(text); } catch { throw bad('input is not valid JSON'); }
    return grade(validateAudit(audit), lines);
  }
  if (cmd === 'gate') {
    const f = parseFlags(rest, ['--state']);
    if (f['--state'] === undefined) throw bad(`gate needs --state <file.json>\n${usage}`);
    const s = await readState(path.resolve(cwd, f['--state']));
    if (!s) return { confirmed: false, why: 'no confirmation recorded: ask the user to confirm the direction before any edit', exit: 2 };
    if (s.confirmed !== true) return { confirmed: false, why: 'the state file does not record a confirmation', exit: 2 };
    if (!GRADES.includes(s.grade) || typeof s.at !== 'string' || Number.isNaN(Date.parse(s.at))) {
      return { confirmed: false, why: 'the confirmation is incomplete: it needs a valid grade and at', exit: 2 };
    }
    return { confirmed: true, grade: s.grade, at: s.at, ...(typeof s.choice === 'string' ? { choice: s.choice } : {}), ...(GRADES.includes(s.graded_as) ? { graded_as: s.graded_as } : {}) };
  }
  if (cmd === 'confirm') {
    const f = parseFlags(rest, ['--state', '--grade', '--choice']);
    if (f['--state'] === undefined) throw bad(`confirm needs --state <file.json>\n${usage}`);
    if (!GRADES.includes(f['--grade'])) throw bad(`--grade must be one of ${GRADES.join(', ')}`);
    const choice = f['--choice'] ?? OPTIONS[0];
    if (!OPTIONS.includes(choice)) throw bad(`--choice must be one of: ${OPTIONS.join(' | ')}`);
    const target = path.resolve(cwd, f['--state']);
    const at = new Date().toISOString();
    if (choice === 'Change the direction') {
      try { await writeState(target, { confirmed: false, choice, at }); } catch (e) {
        if (e instanceof KitExit) throw bad(`could not revoke: ${e.message}; an earlier confirmation in ${target}, if any, may still be in force`);
        throw e;
      }
      throw new KitExit('the user chose to change the direction: any earlier confirmation is revoked, grade again', 2);
    }
    const rec = { confirmed: true, grade: choice === OPTIONS[2] ? 'refine-only' : f['--grade'], graded_as: f['--grade'], choice, at };
    await writeState(target, rec);
    return rec;
  }
  throw bad(`first argument must be grade, gate or confirm\n${usage}`);
}

/** Temp files older than this, left beside the state file by a killed confirm, are removed on the next confirm. */
export const STALE_TMP_MS = 60 * 1000;

/** Best effort: remove `<state>.*.tmp` and `.<state>.*.tmp` siblings (a killed run's leftovers) older than STALE_TMP_MS. */
async function cleanStaleTmp(target) {
  const dir = path.dirname(target);
  const base = path.basename(target);
  try {
    for (const n of await fs.readdir(dir)) {
      if (!n.endsWith('.tmp') || !(n.startsWith(`${base}.`) || n.startsWith(`.${base}.`))) continue;
      const p = path.join(dir, n);
      try {
        const st = await fs.lstat(p);
        if (st.isFile() && Date.now() - st.mtimeMs > STALE_TMP_MS) await fs.unlink(p);
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

/** Write the state file durably and atomically: the kit's guarded write (temp file, fsync, rename, folder fsync). */
async function writeState(target, rec) {
  await cleanStaleTmp(target);
  // Another confirm renaming over the same name between our rename and guarded-fs's identity check is a refusal (exit 2)
  // that is no swap: write again, the last writer wins.
  for (let attempt = 1; ; attempt++) {
    try {
      await guardedWrite(target, JSON.stringify(rec, null, 2) + '\n', { root: path.dirname(target) });
      return;
    } catch (e) {
      if (e instanceof KitExit && e.code === 2 && /does not hold the file that was written/.test(e.message) && attempt < 12) {
        await new Promise(r => setTimeout(r, 2 + Math.floor(Math.random() * 8)));
        continue;
      }
      throw bad(`cannot write ${target}: ${e.message}`);
    }
  }
}
