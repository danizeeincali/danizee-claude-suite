/**
 * threshold-route — route each model-judged item by an asymmetric rule: a wrong raise is recoverable, a wrong silence is not.
 *
 *   threshold-route [--file <path>] [--low <0..1>] [--high <0..1>]      JSON on stdin or --file
 *
 * INPUT. A list of items (a bare array, or `{ items, thresholds? }`). Each item:
 *   id                      any label, echoed back (the position is used when absent)
 *   answer                  the decider's answer, or null / absent when there is none:
 *                             { kind: anomaly | not-anomalous | ambiguous | suppress | fix | check,
 *                               value?, confidence: 0..1, ambiguity?: 0..1 }
 *   deterministicRegression true when a program, not a model, saw a regression
 *   ledgerMatch             true when an owner already decided this
 * The answers are data the calling workflow got from its model; this verb makes no model call and no network call.
 *
 * RULES, evaluated in this FIXED order; the first that applies decides, and the output names it:
 *   1 ledger-match               ledgerMatch                              -> as-intended
 *   2 deterministic-regression   deterministicRegression                  -> block (no model answer can override it)
 *   3 missing-answer             no answer, or a malformed one            -> ask-human (rule malformed-answer when malformed)
 *   4 high-ambiguity             ambiguity >= high                        -> escalate
 *   5 confident-not-anomalous    not-anomalous, confidence >= high        -> ignore
 *   6 low-confidence             confidence < low                         -> ask-human
 *   7 by kind:
 *        suppress   confidence >= high -> suppress,  else ask-human
 *        fix        confidence >= high -> auto-fix,  else ask-human
 *        not-anomalous (below high)    -> ask-human
 *        ambiguous                     -> escalate
 *        anomaly                       -> issue
 *        check      model-check-downgraded -> issue (a block always means a program saw it)
 * So the only silent routes (ignore, suppress, auto-fix) need confidence >= high and ambiguity below high, and every uncertain path raises or asks.
 *
 * `autoFixEligible(item, thresholds)` is the separate predicate with the same confidence floor: true exactly when the
 * item routes to auto-fix. It is also given per item in the output.
 *
 * Exit codes: 0 always for valid input (the output says which items block: `blocks`, `blocking`); 1 invalid input.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'threshold-route';
export const usage = 'cli.js threshold-route [--file <path>] [--low <0..1>] [--high <0..1>]   '
  + '(JSON on stdin or --file: a list of items { id, answer: { kind, confidence, ambiguity? } | none, deterministicRegression?, ledgerMatch? }; '
  + 'routes each by a fixed order: ledger -> as-intended, program-seen regression -> block, high ambiguity -> escalate, confident not-anomalous -> ignore, '
  + 'missing or low confidence -> ask-human, suppress / fix need confidence >= high else ask-human, a model-only check -> issue; defaults 0.4 / 0.8; exit 0 valid, 1 invalid)';

export const KINDS = Object.freeze(['anomaly', 'not-anomalous', 'ambiguous', 'suppress', 'fix', 'check']);
export const ROUTES = Object.freeze(['as-intended', 'block', 'ignore', 'escalate', 'ask-human', 'suppress', 'auto-fix', 'issue']);
export const DEFAULT_THRESHOLDS = Object.freeze({ low: 0.4, high: 0.8 });

const invalid = (m) => new KitExit(m, 1);
const isUnit = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/** `{ low, high }` with defaults filled in; throws exit 1 unless 0 <= low < high <= 1. */
export function resolveThresholds(t = {}) {
  if (t === null) t = {};
  if (typeof t !== 'object' || Array.isArray(t)) throw invalid(`thresholds must be an object { low, high } (got ${JSON.stringify(t)})`);
  const low = t.low === undefined ? DEFAULT_THRESHOLDS.low : t.low;
  const high = t.high === undefined ? DEFAULT_THRESHOLDS.high : t.high;
  if (!isUnit(low)) throw invalid(`low must be a number from 0 to 1 (got ${JSON.stringify(low)})`);
  if (!isUnit(high)) throw invalid(`high must be a number from 0 to 1 (got ${JSON.stringify(high)})`);
  if (!(low < high)) throw invalid(`low (${low}) must be below high (${high})`);
  return { low, high };
}

function checkItem(item, where) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid(`${where} must be an object`);
  for (const flag of ['deterministicRegression', 'ledgerMatch']) {
    if (item[flag] !== undefined && typeof item[flag] !== 'boolean') throw invalid(`${where}.${flag} must be true or false`);
  }
}

/** True when the answer is absent or well formed; a malformed model answer is data, not a caller error. */
function answerOk(a) {
  if (a === undefined || a === null) return true;
  if (typeof a !== 'object' || Array.isArray(a)) return false;
  return KINDS.includes(a.kind) && isUnit(a.confidence) && (a.ambiguity === undefined || isUnit(a.ambiguity));
}

const decide = (route, rule, reason) => ({ route, rule, reason });

function decideItem(item, { low, high }) {
  if (item.ledgerMatch) return decide('as-intended', 'ledger-match', 'an owner already decided this');
  if (item.deterministicRegression) return decide('block', 'deterministic-regression', 'a program saw a regression; a model answer cannot override it');
  const a = item.answer;
  if (!answerOk(a)) return decide('ask-human', 'malformed-answer', 'the decider answer is malformed (kind, confidence 0..1 or ambiguity 0..1), so it is treated as missing and a human is asked');
  if (!a) return decide('ask-human', 'missing-answer', 'no decider answer, so a human is asked');
  const c = a.confidence;
  if (a.ambiguity !== undefined && a.ambiguity >= high) return decide('escalate', 'high-ambiguity', `ambiguity ${a.ambiguity} (>= ${high})`);
  if (a.kind === 'not-anomalous' && c >= high) return decide('ignore', 'confident-not-anomalous', `not anomalous at confidence ${c} (>= ${high})`);
  if (c < low) return decide('ask-human', 'low-confidence', `confidence ${c} is below ${low}`);
  switch (a.kind) {
    case 'suppress':
      return c >= high ? decide('suppress', 'confident-suppress', `suppression at confidence ${c} (>= ${high})`)
        : decide('ask-human', 'suppress-below-high', `suppression needs confidence >= ${high}, got ${c}`);
    case 'fix':
      return c >= high ? decide('auto-fix', 'confident-fix', `fix at confidence ${c} (>= ${high})`)
        : decide('ask-human', 'fix-below-high', `auto-fix needs confidence >= ${high}, got ${c}`);
    case 'not-anomalous':
      return decide('ask-human', 'not-anomalous-below-high', `not anomalous but confidence ${c} is below ${high}; silence needs the high threshold`);
    case 'ambiguous':
      return decide('escalate', 'ambiguous-answer', 'the decider called it ambiguous');
    case 'check':
      return decide('issue', 'model-check-downgraded', 'a model-only check has no deterministic backing, so it is raised as an issue, not a block');
    default:
      return decide('issue', 'anomaly', 'the decider saw an anomaly');
  }
}

/** True exactly when the item routes to auto-fix: a fix answer with confidence >= high and nothing overriding it. */
export function autoFixEligible(item, thresholds) {
  const t = resolveThresholds(thresholds);
  checkItem(item, 'item');
  return decideItem(item, t).route === 'auto-fix';
}

/** One routed item: `{ route, rule, reason, autoFixEligible }`. */
export function routeItem(item, thresholds) {
  const t = resolveThresholds(thresholds);
  checkItem(item, 'item');
  const d = decideItem(item, t);
  return { ...d, autoFixEligible: d.route === 'auto-fix' };
}

/** Route a list. Returns `{ thresholds, results, counts, blocks, blocking }`. An item with a non-object shape or non-boolean flag throws exit 1 before anything is routed; a malformed answer routes to ask-human. */
export function routeAll(items, thresholds) {
  const t = resolveThresholds(thresholds);
  if (!Array.isArray(items)) throw invalid('items must be a list');
  items.forEach((it, i) => checkItem(it, `items[${i}]`));
  const results = items.map((it, i) => ({ id: it.id ?? i, ...routeItem(it, t) }));
  const counts = Object.fromEntries(ROUTES.map((r) => [r, 0]));
  for (const r of results) counts[r.route]++;
  const blocking = results.filter((r) => r.route === 'block').map((r) => r.id);
  return { thresholds: t, results, counts, blocks: blocking.length > 0, blocking };
}

function parseArgs(args) {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') { f.help = true; continue; }
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (name && ['file', 'in', 'low', 'high'].includes(name)) {
      if (i + 1 >= args.length) throw invalid(`--${name} needs a value (see --help)`);
      f[name === 'in' ? 'file' : name] = args[++i];
      continue;
    }
    throw invalid(`${name ? 'unknown flag' : 'unexpected argument'} ${a} (see --help)`);
  }
  return f;
}

function num(flag, s) {
  const n = s.trim() === '' ? NaN : Number(s);
  if (!Number.isFinite(n)) throw invalid(`--${flag} needs a number (got ${JSON.stringify(s)})`);
  return n;
}

export async function run(args, io = {}) {
  const f = parseArgs(args);
  if (f.help) return { usage };
  const cwd = io.cwd || process.cwd();
  let text;
  if (f.file !== undefined) {
    try { text = await fs.readFile(path.resolve(cwd, f.file), 'utf-8'); } catch { throw invalid(`cannot read ${f.file}`); }
  } else {
    if (io.stdinIsTTY) throw invalid('give JSON on stdin or --file <path> (see --help)');
    text = io.stdin ? String(await io.stdin()) : '';
  }
  if (!text.trim()) throw invalid('no input: give JSON on stdin or --file <path> (see --help)');
  let data;
  try { data = JSON.parse(text); } catch { throw invalid('input is not valid JSON'); }
  let items = data;
  let fromInput = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    items = data.items;
    if (data.thresholds !== undefined) {
      if (!data.thresholds || typeof data.thresholds !== 'object' || Array.isArray(data.thresholds)) throw invalid('thresholds must be an object { low, high }');
      fromInput = data.thresholds;
    }
  }
  const t = { ...fromInput };
  if (f.low !== undefined) t.low = num('low', f.low);
  if (f.high !== undefined) t.high = num('high', f.high);
  return routeAll(items, t);
}
