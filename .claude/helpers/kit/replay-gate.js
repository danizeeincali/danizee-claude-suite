/**
 * replay-gate — only a program-decided failure that a second identical run agrees on may block; everything
 * else is downgraded or kept as a comment.
 *
 *   replay-gate [--file <path>]     JSON on stdin (or the file): { "verdicts": [ ... ] }  ->  { results, counts, exit }
 *
 * The verb never runs a replay and never calls a model. It judges verdicts the caller already has.
 * A verdict is { id, decided_by, outcome: "pass"|"fail", runs?: [run, ...] }; a run is the record of one
 * execution: { steps?: [..steps reached..], checks?: <check answers>, outputs?: <normalised outputs> }
 * (at least one of the three; any other key is refused).
 *   - decided_by "replay", "exact-check" or "output-diff" is a program decision. Anything else (model, human, ...)
 *     is judgement and is classified `comment`, however confident and whatever its outcome or runs.
 *   - program pass -> `pass`.
 *   - program fail with two or more runs that agree on steps, check answers and outputs (key order ignored)
 *     -> `blocking`. If they disagree -> `untested`, with a flakiness reason naming what differed
 *     (`differed`: e.g. "steps", "checks.ok", "outputs.body"). With fewer than two runs -> `untested`.
 *   - The exit is 2 only when at least one verdict is `blocking`, else 0; invalid input is KitExit 1.
 * Library: gate(verdicts, { replay }) where `replay(verdict)` is an optional injected function (sync or async)
 * that the caller supplies to produce the second run when a program failure carries only one. It is called
 * at most once per verdict, and never for judgements, passes, or verdicts that already have two runs. If it
 * throws, the verdict is untested with that reason. In the CLI the caller passes both runs as data.
 * Unknown keys are rejected everywhere; a leading BOM on the input is stripped.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'replay-gate';
export const usage = 'cli.js replay-gate [--file <path>]   (JSON on stdin: { verdicts: [{ id, decided_by, outcome, runs }] }; only a program-decided failure that two identical runs agree on blocks, exit 2; see the header of replay-gate.js)';

export const PROGRAM_KINDS = ['replay', 'exact-check', 'output-diff'];
const OUTCOMES = ['pass', 'fail'];
const RUN_FIELDS = ['steps', 'checks', 'outputs'];
const VERDICT_KEYS = ['id', 'decided_by', 'outcome', 'runs'];
const INPUT_KEYS = ['verdicts'];
const OPTION_KEYS = ['replay'];
const MAX_DIFFS = 10;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = msg => { throw new KitExit(msg, 1); };
const rejectUnknown = (obj, allowed, where) => {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(`unknown key "${k}" in ${where} (allowed: ${allowed.join(', ')})`);
};

/** Stable JSON text: object keys sorted, so key order is never a difference. */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

function checkRun(run, where) {
  if (!isObj(run)) fail(`${where} must be an object`);
  rejectUnknown(run, RUN_FIELDS, where);
  const present = RUN_FIELDS.filter(f => run[f] !== undefined);
  if (present.length === 0) fail(`${where} records nothing (needs at least one of ${RUN_FIELDS.join(', ')})`);
  if (run.steps !== undefined && !Array.isArray(run.steps)) fail(`${where}.steps must be an array`);
  for (const f of ['checks', 'outputs']) if (run[f] === null) fail(`${where}.${f} must not be null`);
  return run;
}

function checkVerdict(v, i, ids) {
  const where = `verdicts[${i}]`;
  if (!isObj(v)) fail(`${where} must be an object`);
  rejectUnknown(v, VERDICT_KEYS, where);
  if (typeof v.id !== 'string' || v.id === '') fail(`${where}.id must be a non-empty string`);
  if (ids.has(v.id)) fail(`duplicate verdict id "${v.id}"`);
  ids.add(v.id);
  if (typeof v.decided_by !== 'string' || v.decided_by === '') fail(`${where}.decided_by must be a non-empty string`);
  if (!OUTCOMES.includes(v.outcome)) fail(`${where}.outcome must be "pass" or "fail"`);
  if (v.runs !== undefined) {
    if (!Array.isArray(v.runs)) fail(`${where}.runs must be an array`);
    v.runs.forEach((r, j) => checkRun(r, `${where}.runs[${j}]`));
  }
}

/** Paths at which two values differ; objects are descended, arrays and scalars are compared whole. */
function diffPaths(a, b, prefix, out) {
  if (out.length >= MAX_DIFFS) return;
  if (canon(a) === canon(b)) return;
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (k in a && k in b) diffPaths(a[k], b[k], `${prefix}.${k}`, out);
      else out.push(`${prefix}.${k}`);
    }
    return;
  }
  out.push(prefix);
}

/** What differs between the runs (all compared with the first). Empty when they agree. */
export function differences(runs) {
  const out = [];
  for (const other of runs.slice(1)) {
    for (const f of RUN_FIELDS) {
      const x = runs[0][f];
      const y = other[f];
      if (x === undefined && y === undefined) continue;
      if (x === undefined || y === undefined) out.push(f);
      else diffPaths(x, y, f, out);
    }
  }
  return [...new Set(out)].slice(0, MAX_DIFFS);
}

/**
 * Classify verdicts. Returns { results: [{ id, decided_by, class, reason, differed? }], counts, exit }.
 * `replay` (optional) is `(verdict) => run | Promise<run>`, used only to obtain a second run.
 */
export async function gate(verdicts, options = {}) {
  if (!Array.isArray(verdicts)) fail('verdicts must be an array');
  if (!isObj(options)) fail('options must be an object');
  rejectUnknown(options, OPTION_KEYS, 'options');
  const { replay } = options;
  if (replay !== undefined && replay !== null && typeof replay !== 'function') fail('options.replay must be a function');
  const ids = new Set();
  verdicts.forEach((v, i) => checkVerdict(v, i, ids));

  const results = [];
  for (const v of verdicts) {
    const base = { id: v.id, decided_by: v.decided_by };
    if (!PROGRAM_KINDS.includes(v.decided_by)) {
      results.push({ ...base, class: 'comment', reason: `decided by judgement (${v.decided_by}); posted as a comment, never blocks` });
      continue;
    }
    if (v.outcome === 'pass') { results.push({ ...base, class: 'pass', reason: 'the program check passed' }); continue; }

    let runs = (v.runs || []).slice();
    if (runs.length === 1 && typeof replay === 'function') {
      let second;
      try { second = await replay(structuredClone(v)); } catch (e) {
        results.push({ ...base, class: 'untested', reason: `no second run: the replay failed (${e && e.message ? e.message : String(e)})` });
        continue;
      }
      runs.push(checkRun(second, `the run returned by replay for "${v.id}"`));
    }
    if (runs.length < 2) {
      results.push({ ...base, class: 'untested', reason: `a failure needs a second run that agrees; ${runs.length === 0 ? 'no run was recorded' : 'only one run is present'}` });
      continue;
    }
    const differed = differences(runs);
    if (differed.length) {
      results.push({ ...base, class: 'untested', reason: `flaky: the runs disagree on ${differed.join(', ')}`, differed });
    } else {
      results.push({ ...base, class: 'blocking', reason: `${runs.length} runs agree on steps, check answers and outputs; the program-decided failure stands` });
    }
  }
  const counts = { blocking: 0, untested: 0, comment: 0, pass: 0 };
  for (const r of results) counts[r.class]++;
  return { results, counts, exit: counts.blocking > 0 ? 2 : 0 };
}

function parseArgs(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a !== '--file') fail(`unknown argument "${a}"\n${usage}`);
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) fail('--file needs a path');
    flags.file = args[++i];
  }
  return flags;
}

export async function run(args, io) {
  const flags = parseArgs(args);
  let text;
  if (flags.file !== undefined) {
    try { text = await fs.readFile(path.resolve(io.cwd || process.cwd(), flags.file), 'utf-8'); } catch (e) { fail(`cannot read ${flags.file}: ${e.message}`); }
  } else {
    if (io.stdinIsTTY) fail(`no input: pass JSON on stdin or --file <path>\n${usage}`);
    text = await io.stdin();
  }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  let data;
  try { data = JSON.parse(text); } catch (e) { fail(`input is not valid JSON: ${e.message}`); }
  if (!isObj(data)) fail('input must be an object: { "verdicts": [...] }');
  rejectUnknown(data, INPUT_KEYS, 'the input');
  if (!Array.isArray(data.verdicts)) fail('input.verdicts must be an array');
  return gate(data.verdicts);
}
