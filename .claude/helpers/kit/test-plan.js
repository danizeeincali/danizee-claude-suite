/**
 * test-plan — from a change set, plan WHAT TO TEST, with a reason per item and honest coverage counts.
 *
 *   test-plan [--in <file>] [--changed <file>] [--diff <file>] [--shared-pct N] [--min-mapped-pct N] [--smoke N]
 *
 * (`impact` answers "which code does this change touch"; this verb answers "which tests, pages or commands do I run".)
 * INPUT (JSON on stdin, or --in): { targets:[{id, files:[...], entry?}], flows?:[{id, targets:[ids], critical?}],
 *   edges?:[[from,to]], always?:[ids], changed?:[paths] }. A target is whatever the caller maps: a test, a page, a command.
 * CHANGED FILES come from `changed` in the input, --changed <file> (one path per line, or a JSON array), and --diff <file>
 * (a unified diff, read with lenses.parseDiff; a deleted file counts under its old path, a rename under both paths). The
 * sources are merged (planTests merges input.changed with its second argument too). Paths are normalised (backslashes, "./") and compared exactly; sorted and de-duplicated.
 * RULES.
 *   1. An inverse index maps file -> targets. A changed file mapped to a target is a direct hit.
 *   2. A changed file mapped to at least --shared-pct percent (default 30) of ALL targets, and to at least 2 targets, is a
 *      shared component; the targets it reaches get "shared-component" (unless another changed file hits them directly).
 *   3. Any flow holding a targeted item pulls in every target of that flow: reason "flow".
 *   4. If the share of changed files that map to any target is below --min-mapped-pct (default 60), a smoke set is added
 *      (all entry targets plus the --smoke N, default 3, most connected targets by edge degree, ties by id) with reason
 *      "smoke", and the plan says low_confidence: true with a reason. Never silent. No changed files: no smoke, no flag; but run() exits 1 when no change source was given at all, and a --changed/--diff file that resolves to zero paths (with nothing else changed) is low_confidence "change source was empty" with the smoke set.
 *   5. Items dedupe by target id, keeping the strongest reason. STRENGTH: direct-change > shared-component > flow >
 *      smoke > always. All reasons seen stay in `reasons`. Items from `always` are appended last.
 * OUTPUT: { plan:[{id, reason, reasons, via?, flows?, critical?}], low_confidence, low_confidence_reason?,
 *   coverage:{targets_planned, targets_total, changed_total, changed_mapped, changed_unmapped, unmapped:[...], mapped_pct},
 *   shared:[files], flows:[ids pulled in] }. Order is deterministic: strength, then id. Exit 0 valid, 1 invalid input.
 * Reads only the files named; no network, no model. Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { parseDiff } from './lenses.js';

export const verb = 'test-plan';
export const usage = 'cli.js test-plan [--in <file>] [--changed <file>] [--diff <file>] [--shared-pct 30] [--min-mapped-pct 60] [--smoke 3]   '
  + '(plan what to test from changed files; JSON {targets,flows?,edges?,always?,changed?} on stdin or --in; exit 0 done, 1 invalid)';

export const STRENGTH = Object.freeze(['direct-change', 'shared-component', 'flow', 'smoke', 'always']);
const rank = (r) => STRENGTH.indexOf(r);
const bad = (m) => new KitExit(`${m} (see --help)`, 1);
const INPUT_KEYS = Object.freeze(['targets', 'flows', 'edges', 'always', 'changed']);
const stripBom = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
const MAX_BYTES = 8 * 1024 * 1024;

export function normPath(p) {
  let s = String(p ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s.replace(/\/+$/, '');
}

/** A list of strings; blank entries are allowed (callers dropping them with normPath), used for change lists. */
const pathList = (v, what) => {
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) throw bad(`${what} must be a list of strings`);
  return v;
};

const strList = (v, what) => {
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string' && x.trim())) throw bad(`${what} must be a list of non-empty strings`);
  return v;
};

export function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('input must be a JSON object');
  for (const k of Object.keys(input)) if (!INPUT_KEYS.includes(k)) throw bad(`unknown key "${k}" in the input (allowed: ${INPUT_KEYS.join(', ')})`);
  if (!Array.isArray(input.targets) || !input.targets.length) throw bad('"targets" must be a non-empty list');
  const ids = new Set();
  for (const t of input.targets) {
    if (!t || typeof t.id !== 'string' || !t.id) throw bad('every target needs a string "id"');
    if (ids.has(t.id)) throw bad(`duplicate target id "${t.id}"`);
    ids.add(t.id);
    strList(t.files ?? [], `target ${t.id} "files"`);
    if (t.entry !== undefined && typeof t.entry !== 'boolean') throw bad(`target ${t.id} "entry" must be true or false`);
  }
  if (input.flows !== undefined && !Array.isArray(input.flows)) throw bad('"flows" must be a list');
  const fids = new Set();
  for (const f of input.flows ?? []) {
    if (!f || typeof f.id !== 'string' || !f.id) throw bad('every flow needs a string "id"');
    if (fids.has(f.id)) throw bad(`duplicate flow id "${f.id}"`);
    fids.add(f.id);
    for (const t of strList(f.targets, `flow ${f.id} "targets"`)) if (!ids.has(t)) throw bad(`flow ${f.id} names unknown target "${t}"`);
  }
  if (input.edges !== undefined && !Array.isArray(input.edges)) throw bad('"edges" must be a list');
  for (const e of input.edges ?? []) {
    if (!Array.isArray(e) || e.length !== 2 || !e.every(x => ids.has(x))) throw bad('every edge must be [from, to] of known target ids');
  }
  if (input.always !== undefined) for (const a of strList(input.always, '"always"')) if (!ids.has(a)) throw bad(`"always" names unknown target "${a}"`);
  if (input.changed !== undefined) pathList(input.changed, '"changed"');
}

/** Changed paths from a unified diff: new path, plus old path for deletions and renames. */
export function changedFromDiff(text) {
  const out = [];
  for (const f of parseDiff(text, { lines: true })) {
    if (f.path && f.path !== '/dev/null') out.push(f.path);
    if (f.oldPath && f.oldPath !== f.path && f.oldPath !== '/dev/null') out.push(f.oldPath);
  }
  return out;
}

const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

/**
 * The plan. opts: { sharedPct = 30, minMappedPct = 60, smoke = 3 }. `changed` is a list of paths.
 */
export function planTests(input, changed, opts = {}) {
  validateInput(input);
  const { sharedPct = 30, minMappedPct = 60, smoke = 3, emptySource = false } = opts;
  const targets = input.targets;
  const total = targets.length;
  if (changed !== undefined && changed !== null) pathList(changed, 'the changed argument');
  const files = [...new Set([...(input.changed ?? []), ...(changed ?? [])].map(normPath).filter(Boolean))].sort();

  const index = new Map(); // file -> Set(target ids)
  for (const t of targets) for (const f of t.files ?? []) {
    const k = normPath(f);
    if (!index.has(k)) index.set(k, new Set());
    index.get(k).add(t.id);
  }

  const seen = new Map(); // id -> { reasons:Set, via:Set }
  const add = (id, reason, via) => {
    if (!seen.has(id)) seen.set(id, { reasons: new Set(), via: new Set(), flows: new Set() });
    const s = seen.get(id);
    s.reasons.add(reason);
    if (via) s.via.add(via);
  };

  const unmapped = [];
  const shared = [];
  for (const f of files) {
    const hit = index.get(f);
    if (!hit || !hit.size) { unmapped.push(f); continue; }
    const isShared = hit.size >= 2 && pct(hit.size, total) >= sharedPct;
    if (isShared) shared.push(f);
    for (const id of hit) add(id, isShared ? 'shared-component' : 'direct-change', f);
  }
  // a target hit by a shared file AND an unshared changed file is a direct hit
  for (const f of files) {
    const hit = index.get(f);
    if (hit && !shared.includes(f)) for (const id of hit) add(id, 'direct-change', f);
  }

  const pulled = [];
  const affected = new Set(seen.keys());
  for (const fl of input.flows ?? []) {
    if (!fl.targets.some(t => affected.has(t))) continue;
    pulled.push(fl.id);
    for (const t of fl.targets) { add(t, 'flow'); seen.get(t).flows.add(fl.id); }
  }

  const mapped = files.length - unmapped.length;
  const mappedPct = files.length ? pct(mapped, files.length) : 100;
  let low = false;
  let lowReason;
  const emptyChange = emptySource && !files.length;
  if (emptyChange || (files.length && mapped * 100 < minMappedPct * files.length)) {
    low = true;
    const degree = new Map(targets.map(t => [t.id, 0]));
    for (const [a, b] of input.edges ?? []) { degree.set(a, degree.get(a) + 1); degree.set(b, degree.get(b) + 1); }
    for (const t of targets) if (t.entry) add(t.id, 'smoke');
    const ranked = [...targets].sort((x, y) => degree.get(y.id) - degree.get(x.id) || (x.id < y.id ? -1 : 1));
    for (const t of ranked.slice(0, Math.max(0, smoke))) add(t.id, 'smoke');
    const smoked = [...seen.entries()].filter(([, s]) => s.reasons.has('smoke')).length;
    const note = smoked ? `smoke set: ${smoked} target${smoked === 1 ? '' : 's'}` : 'no smoke targets available';
    lowReason = emptyChange ? 'change source was empty' : `only ${mapped} of ${files.length} changed files (${mappedPct}%) map to a target, below ${minMappedPct}%; ${note}`;
  }
  for (const id of input.always ?? []) add(id, 'always');

  const flowMeta = new Map((input.flows ?? []).map(f => [f.id, f]));
  const items = [...seen.entries()].map(([id, s]) => {
    const reasons = [...s.reasons].sort((a, b) => rank(a) - rank(b));
    const item = { id, reason: reasons[0], reasons };
    if (s.via.size) item.via = [...s.via].sort();
    if (s.flows.size) {
      item.flows = [...s.flows].sort();
      if (item.flows.some(f => flowMeta.get(f).critical)) item.critical = true;
    }
    return item;
  });
  const key = (i) => (i.reason === 'always' ? 1 : 0);
  items.sort((a, b) => key(a) - key(b) || rank(a.reason) - rank(b.reason) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const out = {
    plan: items,
    low_confidence: low,
    coverage: {
      targets_planned: items.length,
      targets_total: total,
      changed_total: files.length,
      changed_mapped: mapped,
      changed_unmapped: unmapped.length,
      unmapped,
      mapped_pct: mappedPct
    },
    shared,
    flows: pulled.sort()
  };
  if (low) out.low_confidence_reason = lowReason;
  return out;
}

// ---------------------------------------------------------------- CLI

const VALUE = ['in', 'changed', 'diff', 'shared-pct', 'min-mapped-pct', 'smoke'];

function parse(args) {
  const flags = {};
  const rest = [...args];
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"`);
    const k = a.slice(2);
    if (!VALUE.includes(k)) throw bad(`unknown flag --${k} (allowed: ${VALUE.map(f => `--${f}`).join(', ')})`);
    if (!rest.length || rest[0].startsWith('--')) throw bad(`--${k} needs a value`);
    flags[k] = rest.shift();
  }
  return flags;
}

const num = (flags, k, def, max) => {
  if (flags[k] === undefined) return def;
  if (!/^\d+$/.test(flags[k]) || Number(flags[k]) > max) throw bad(`--${k} must be a whole number from 0 to ${max}`);
  return Number(flags[k]);
};

async function readText(cwd, p, what) {
  const file = path.resolve(cwd, p);
  const st = await fs.stat(file).catch((e) => { throw bad(`cannot read ${what} ${p}: ${e.code || e.message}`); });
  if (!st.isFile()) throw bad(`${what} ${p} is not a regular file`);
  if (st.size > MAX_BYTES) throw bad(`${what} ${p} is larger than ${MAX_BYTES} bytes`);
  return stripBom(await fs.readFile(file, 'utf-8'));
}

export async function run(args, io = {}) {
  const flags = parse(args);
  const cwd = io.cwd || process.cwd();
  const opts = { sharedPct: num(flags, 'shared-pct', 30, 100), minMappedPct: num(flags, 'min-mapped-pct', 60, 100), smoke: num(flags, 'smoke', 3, 1000) };
  let raw;
  if (flags.in) raw = await readText(cwd, flags.in, 'input');
  else {
    if (io.stdinIsTTY) throw bad('needs JSON on stdin or --in <file>');
    raw = await io.stdin();
  }
  let input;
  try { input = JSON.parse(stripBom(raw)); } catch { throw bad('input is not valid JSON'); }
  validateInput(input);
  if (input.changed === undefined && !flags.changed && !flags.diff) {
    throw bad('no change source given: pass "changed" in the input, --changed <file> or --diff <file> (an empty list is allowed when nothing changed)');
  }
  let changed = [...(input.changed ?? [])];
  if (flags.changed) {
    const text = await readText(cwd, flags.changed, 'changed list');
    let list;
    if (text.trimStart().startsWith('[')) {
      try { list = JSON.parse(text); } catch { throw bad('--changed file looks like JSON but is not valid'); }
      pathList(list, '--changed file');
      list = list.map(l => l.trim()).filter(Boolean);
    } else list = text.split('\n').map(l => l.trim()).filter(Boolean);
    changed.push(...list);
  }
  if (flags.diff) {
    const text = await readText(cwd, flags.diff, 'diff');
    if (text.trim() && !/^(\+\+\+ |--- |diff --git )/m.test(text)) throw bad('--diff is not a unified diff');
    changed.push(...changedFromDiff(text));
  }
  // a --changed/--diff file that yields no path at all is a missing input, not "nothing changed"
  if (flags.changed || flags.diff) opts.emptySource = true;
  return planTests(input, changed, opts);
}
