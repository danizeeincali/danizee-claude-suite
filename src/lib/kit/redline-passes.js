/**
 * redline-passes — the nine passes that clean up a UI screen, in a fixed order, and a small progress file that keeps
 * them in that order. Each pass is finished across the whole screen before the next one starts.
 *
 *   redline-passes plan
 *       → { passes: [{ n, id, label, why_here, checks: [string] }] }       nine passes: spacing, color, icons, copy,
 *                                                                          type, layout, details, visuals, motion
 *   redline-passes next [--state <file.json>] [--strict] [--all-at-once]
 *       → { next, done, remaining, ok, problem?, fix?, batch?, reminder?, exit? }   advisory, exit 0 (exit 2 with --strict)
 *   redline-passes mark --state <file.json> --pass <id>
 *       → { marked, done, next }                                           appends the pass when it is the next one
 *
 * STATE. The progress file is `{ "done": ["spacing", ...] }`. A missing file means nothing is done. `done` must be an
 * array of pass ids in plan order with no gaps; a list of pass ids that is wrong is reported by `next` as ok=false with a `problem`
 * (an unknown id, a repeated id, or a pass that skips an earlier one); a non-string entry, like a missing `done`, exits 1. When ok, `next` is the first pass of the plan
 * that is not done; on a problem it is the first plan pass after the in-order prefix of `done` (so it can name a pass
 * that appears later in a broken `done`), and `fix` says how to repair that kind of problem. `next` is null once all
 * nine are done. With --strict an out-of-order or unknown `done`
 * exits 2 (the JSON is still printed); without it the answer is advisory and the exit is 0.
 *
 * ALL AT ONCE. When nearly every line of a screen changes, the passes may be planned in order and written in one go.
 * `next --all-at-once` returns the whole remaining list as `batch` (in order) with a `reminder` that each pass must
 * still be applied, and then marked, in order.
 *
 * MARK. `mark` appends the pass only when it is the next one in order, under the kit state lock, and writes the file
 * atomically (temp file then rename), creating it (and its folder) when missing. A pass that is out of order or already
 * done exits 2 with the file untouched; an unknown pass id exits 1; a state file that is malformed, over 8 MiB or in the wrong shape
 * exits 1. The state file is read from disk only; nothing else is read and nothing goes to the network.
 *
 * Exit codes: 0 answer printed; 1 bad input or broken state (message on stderr); 2 refusal (mark out of order,
 * next --strict with an out-of-order state).
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { withStateLock, readJsonState, writeJsonAtomic } from './state-lock.js';

export const verb = 'redline-passes';
export const usage = 'cli.js redline-passes plan | next [--state <file.json>] [--strict] [--all-at-once] | mark --state <file.json> --pass <id>  (nine ordered passes; next is advisory, exit 0; mark out of order exits 2)';

const MAX_BYTES = 8 * 1024 * 1024;

const RAW = [
  ['spacing', 'Spacing',
    'First, because every later pass measures against the grid; fixing color or type on top of uneven spacing means redoing it.',
    ['Every gap and size is a multiple of 4px', 'Equal things are sized equally (cards, buttons, rows, inputs)',
      'Space inside a group is tighter than the space between groups', 'Icon, label and number columns line up on one edge',
      'Padding is consistent across repeated components']],
  ['color', 'Color',
    'Second, once sizes are stable: color is applied from a small system, and removing effects first keeps contrast checks honest.',
    ['One tinted neutral ramp for backgrounds, borders and text', 'Three text roles only: primary, secondary, muted',
      'A single accent, used rarely and on the thing that matters most', 'No gradients, glows or colored shadows',
      'Text and controls meet contrast on every background']],
  ['icons', 'Icons',
    'Third, after color, so each icon inherits a text role rather than carrying its own hue.',
    ['One line icon set across the whole screen', 'One size per context (inline, button, nav)', 'One stroke width everywhere',
      'Icons take the color of their text role', 'No emoji or filled icons mixed in']],
  ['copy', 'Copy',
    'Fourth, and before type and layout: the length of the headline sets its size and where it sits, so words are final before either is chosen.',
    ['Plain and specific wording; say what the thing does', 'No exclamation marks', 'No hype words or greetings ("Welcome back!", "Supercharge")',
      'Ask about any claim that cannot be verified instead of inventing it', 'Buttons and labels are short verbs and nouns',
      'Headline and subheadline are final']],
  ['type', 'Type',
    'Fifth, because copy is now fixed and the font can be chosen for the direction and sized to the real headline.',
    ['Typeface chosen for the direction of the product, not by default', 'Two weights only', 'No tracked (letter-spaced) uppercase',
      'A short size scale; headline size fits the final headline', 'Line length and line height suit the text']],
  ['layout', 'Layout',
    'Sixth, after type: with real copy at its real size, proportions and composition can be judged honestly.',
    ['Keep the section order', 'Apps use real app proportions (sidebar, toolbar, content), not a centered marketing column',
      'Hero is asymmetric or a scene, not a centered stack', 'Content width and alignment are consistent between sections',
      'Nothing is stretched to fill space']],
  ['details', 'Details',
    'Seventh, because small refinements only make sense once structure is settled.',
    ['Nested radii: outer radius = inner radius + padding', 'Meta text (dates, counts, ids) is quiet', 'Keyboard shortcuts shown as keycaps',
      'Charts use one accent and have one clear main chart', 'Borders and dividers are hairline and consistent']],
  ['visuals', 'Visuals',
    'Eighth, only once the screen works without them; imagery must not be used to hide a weak layout.',
    ['The screen reads well with every image and illustration removed', 'Each visual shows the real product or a real scene',
      'No stock-style decoration or abstract blobs', 'Visuals follow the palette and radii already set', 'Every visual earns its space']],
  ['motion', 'Motion',
    'Last, because it depends on everything else being final and is the easiest to overdo.',
    ['Nothing loops or autoplays', 'One easing curve for every transition', 'Animate only color, opacity and transform',
      'Durations are short and consistent', 'Reduced-motion preference is respected']],
];

export const PASSES = RAW.map(([id, label, why_here, checks], i) => ({ n: i + 1, id, label, why_here, checks }));
const IDS = PASSES.map(p => p.id);
const byId = id => PASSES.find(p => p.id === id) || null;
const copyPass = p => ({ ...p, checks: [...p.checks] });

export function plan() {
  return { passes: PASSES.map(copyPass) };
}

/** Judge a `done` list against the plan: { ok, problem?, fix?, done, next, remaining }. */
export function evaluate(done) {
  let problem = null;
  let kind = null;
  const seen = new Set();
  let prefix = 0;
  for (let i = 0; i < done.length && !problem; i++) {
    const id = done[i];
    if (typeof id !== 'string' || !IDS.includes(id)) { problem = `unknown pass ${JSON.stringify(id)}`; kind = ['unknown', id]; }
    else if (seen.has(id)) { problem = `pass "${id}" is listed more than once`; kind = ['repeat', id]; }
    else if (id !== IDS[i]) { problem = `pass "${id}" was done before "${IDS[i]}"`; kind = ['order', id]; }
    seen.add(id);
    if (!problem) prefix = i + 1;
  }
  const remaining = IDS.slice(prefix);
  const res = { next: remaining.length ? copyPass(byId(remaining[0])) : null, done: [...done], remaining, ok: !problem };
  if (problem) {
    res.problem = problem;
    const nx = `the next pass to apply is "${remaining[0] ?? 'none'}"`;
    res.fix = kind[0] === 'unknown' ? `Remove ${JSON.stringify(kind[1])} from "done"; ${nx}.`
      : kind[0] === 'repeat' ? `Remove the repeated "${kind[1]}" from "done"; ${nx}.`
      : `Redo the passes in plan order and keep "done" to that order; ${nx}.`;
  }
  return res;
}

const bad = m => new KitExit(m, 1);

async function readState(file, cwd) {
  const p = path.resolve(cwd, file);
  let st = null;
  try { st = await fs.stat(p); } catch (e) { if (e.code !== 'ENOENT') throw bad(`cannot read ${p}: ${e.code || e.message}`); }
  if (st && !st.isFile()) throw bad(`${p} is not a regular file`);
  if (st && st.size > MAX_BYTES) throw bad(`${p} is larger than 8 MiB`);
  const data = await readJsonState(p, { fallback: null });
  if (data === null && !(st && st.size > 0)) return { p, done: [] };
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.done)) {
    throw bad(`${p} must hold {"done": [...]}`);
  }
  if (data.done.some(x => typeof x !== 'string')) throw bad(`${p}: "done" must be a list of pass ids`);
  return { p, done: data.done, data };
}

function parseFlags(rest, spec) {
  const out = {};
  while (rest.length) {
    const a = rest.shift();
    const kind = Object.hasOwn(spec, a) ? spec[a] : null;
    if (!kind) throw bad(`unexpected argument "${a}"\n${usage}`);
    const key = a.slice(2);
    if (key in out) throw bad(`${a} given more than once`);
    if (kind === 'bool') { out[key] = true; continue; }
    if (!rest.length || rest[0].startsWith('--')) throw bad(`${a} needs a value`);
    const v = rest.shift();
    if (!v) throw bad(`${a} needs a non-empty value`);
    out[key] = v;
  }
  return out;
}

export async function run(args, io = {}) {
  const [cmd, ...rest] = args;
  const cwd = io.cwd || process.cwd();
  if (cmd === 'plan') {
    if (rest.length) throw bad(`plan takes no arguments\n${usage}`);
    return plan();
  }
  if (cmd === 'next') {
    const f = parseFlags(rest, { '--state': 'value', '--strict': 'bool', '--all-at-once': 'bool' });
    const done = f.state ? (await readState(f.state, cwd)).done : [];
    const res = evaluate(done);
    if (f['all-at-once']) {
      res.batch = res.remaining.map(id => copyPass(byId(id)));
      res.reminder = 'Plan the passes in order and write them in one go if you like, but each pass must still be applied in full and then marked in order.';
    }
    if (f.strict && !res.ok) res.exit = 2;
    return res;
  }
  if (cmd === 'mark') {
    const f = parseFlags(rest, { '--state': 'value', '--pass': 'value' });
    if (!f.state) throw bad(`mark needs --state <file.json>\n${usage}`);
    if (!f.pass) throw bad(`mark needs --pass <id>\n${usage}`);
    if (!byId(f.pass)) throw bad(`unknown pass "${f.pass}"; passes are ${IDS.join(', ')}`);
    const file = path.resolve(cwd, f.state);
    const check = s => {
      const cur = evaluate(s.done);
      if (!cur.ok) throw bad(`${file} is out of order (${cur.problem}); fix it before marking`);
      if (!cur.next) throw new KitExit('all nine passes are already done', 2);
      if (cur.next.id !== f.pass) {
        throw new KitExit(`"${f.pass}" is not the next pass; the next one is "${cur.next.id}"`, 2);
      }
    };
    check(await readState(f.state, cwd)); // refuse before the lock so a refusal never creates the folder
    return withStateLock(file, async () => {
      const s = await readState(f.state, cwd);
      check(s);
      const done = [...s.done, f.pass];
      await writeJsonAtomic(file, { ...(s.data || {}), done });
      const after = evaluate(done);
      return { marked: f.pass, done, next: after.next ? after.next.id : null };
    });
  }
  throw bad(`first argument must be plan, next or mark\n${usage}`);
}
