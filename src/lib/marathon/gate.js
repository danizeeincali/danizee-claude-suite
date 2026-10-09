/**
 * Marathon finish-line gate: resolves line sources against run data and
 * reports which lines are met, failing, waiting on a human, or not counted.
 */

import { greenStreak, reviewStreak, latestReview, openBySeverity, validCounts } from './streak.js';
import { foldHelpers } from './store.js';

const SEVERITIES = ['high', 'medium', 'low'];
const OWNERS = ['build', 'human'];
const OPS = ['is', 'at_least', 'at_most'];
const TYPES = ['bool', 'number', 'percent'];
/**
 * A line's scope: `run` lines are judged only by the run-wide gate (e2e streaks, packaged checks,
 * human lines) and are reported as run_scoped — never counted — when a stream is given; `stream`
 * lines, and lines with no scope, are counted per stream as well.
 */
export const SCOPES = ['run', 'stream'];
const LINE_ID = /^[A-Za-z0-9_-]+$/;
const TOLERANCE_KEYS = [...SEVERITIES, 'passes_in_a_row'];

/**
 * Every source a finish line may name.
 */
export const SOURCE_PATTERN = /^(runs\.streak:(unit|e2e|build)|reviews\.streak|reviews\.latest\.(high|medium|low)|findings\.open:(high|medium|low)|helpers\.over_budget|checklist:[A-Za-z0-9_-]+|measure:[A-Za-z0-9_-]+)$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function show(v) {
  if (v === undefined) return 'nothing';
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  try {
    return JSON.stringify(v) ?? typeof v;
  } catch {
    return typeof v;
  }
}

// A severity limit is a non-negative integer, or exactly null for unlimited.
const isLimit = (v) => v === null || (Number.isInteger(v) && v >= 0);

function validateTolerance(tolerance) {
  if (!isPlainObject(tolerance)) {
    return [`tolerance must be an object with ${SEVERITIES.join(', ')} (and optionally passes_in_a_row) (got ${show(tolerance)})`];
  }
  const errors = [];
  for (const key of Object.keys(tolerance)) {
    if (!TOLERANCE_KEYS.includes(key)) {
      errors.push(`tolerance: unknown key "${key}" (allowed: ${TOLERANCE_KEYS.join(', ')})`);
    }
  }
  for (const sev of SEVERITIES) {
    if (!Object.hasOwn(tolerance, sev)) {
      errors.push(`tolerance.${sev} is missing: give a non-negative integer, or null for unlimited`);
    } else if (!isLimit(tolerance[sev])) {
      errors.push(`tolerance.${sev} must be a non-negative integer or null for unlimited (got ${show(tolerance[sev])})`);
    }
  }
  if (Object.hasOwn(tolerance, 'passes_in_a_row')) {
    const n = tolerance.passes_in_a_row;
    if (!Number.isInteger(n) || n < 1) {
      errors.push(`tolerance.passes_in_a_row must be a positive integer (got ${show(n)})`);
    }
  }
  return errors;
}

/**
 * Schema-check a finish line. Returns a list of error strings; an empty list
 * means the finish line is valid. Never throws.
 *
 * Each line needs an id ([A-Za-z0-9_-]+, unique), an owner (build|human), an
 * op (is|at_least|at_most), a source matching SOURCE_PATTERN and a value that
 * is null, a finite number or a boolean; `type`, when present, is
 * bool|number|percent. The value and op must fit the type: number and percent
 * lines take a finite number (or null) with at_least/at_most, bool lines a
 * boolean (or null) with `is`; a line without a type is typed by its op.
 * When present, `tolerance` is an object with only the keys high, medium, low
 * and passes_in_a_row: high, medium and low are all required (a non-negative
 * integer, or null for unlimited) and passes_in_a_row, if given, is a positive
 * integer. When tolerance.passes_in_a_row is a number, a counted
 * reviews.streak line must ask for the same number.
 */
export function validateFinishLine(finishLine) {
  const errors = [];
  if (isPlainObject(finishLine) && finishLine.tolerance !== undefined) {
    errors.push(...validateTolerance(finishLine.tolerance));
  }
  const lines = isPlainObject(finishLine) ? finishLine.lines : undefined;
  if (!Array.isArray(lines)) {
    errors.push('finish line: "lines" must be an array');
    return errors;
  }

  const seen = new Set();
  lines.forEach((line, i) => {
    const validId = typeof line?.id === 'string' && LINE_ID.test(line.id);
    const name = validId ? `line "${line.id}"` : `line ${i + 1}`;
    if (!isPlainObject(line)) {
      errors.push(`${name}: must be an object`);
      return;
    }
    if (!validId) {
      errors.push(`${name}: id must be a non-empty string of letters, digits, _ or - (got ${show(line.id)})`);
    } else if (seen.has(line.id)) {
      errors.push(`${name}: duplicate id`);
    } else {
      seen.add(line.id);
    }
    if (!OWNERS.includes(line.owner)) {
      errors.push(`${name}: owner must be one of ${OWNERS.join(', ')} (got ${show(line.owner)})`);
    }
    if (!OPS.includes(line.op)) {
      errors.push(`${name}: op must be one of ${OPS.join(', ')} (got ${show(line.op)})`);
    }
    if (line.type !== undefined && !TYPES.includes(line.type)) {
      errors.push(`${name}: type must be one of ${TYPES.join(', ')} (got ${show(line.type)})`);
    }
    if (line.scope !== undefined && !SCOPES.includes(line.scope)) {
      errors.push(`${name}: scope must be one of ${SCOPES.join(', ')} (got ${show(line.scope)})`);
    }
    if (typeof line.source !== 'string' || !SOURCE_PATTERN.test(line.source)) {
      errors.push(`${name}: source ${show(line.source)} is not a known source (runs.streak:<unit|e2e|build>, reviews.streak, reviews.latest.<sev>, findings.open:<sev>, helpers.over_budget, checklist:<id>, measure:<id>)`);
    }
    const v = line.value;
    if (!(v === null || typeof v === 'boolean' || Number.isFinite(v))) {
      errors.push(`${name}: value must be null, a finite number or a boolean (got ${show(v)})`);
      return;
    }
    // The line's type decides which value and op fit; no type means the op decides.
    const type = TYPES.includes(line.type) ? line.type : (line.op === 'is' ? 'bool' : (OPS.includes(line.op) ? 'number' : null));
    if (type === 'bool') {
      if (v !== null && typeof v !== 'boolean') {
        errors.push(`${name}: value must be null or a boolean for a bool line (got ${show(v)})`);
      }
      if (OPS.includes(line.op) && line.op !== 'is') {
        errors.push(`${name}: op must be "is" for a bool line (got ${show(line.op)})`);
      }
    } else if (type !== null) {
      if (v !== null && !Number.isFinite(v)) {
        errors.push(`${name}: value must be null or a finite number for a ${type} line (got ${show(v)})`);
      }
      if (line.op === 'is') {
        errors.push(`${name}: op must be at_least or at_most for a ${type} line, not "is" (use type bool to compare a boolean)`);
      }
    }
  });

  const needed = isPlainObject(finishLine.tolerance) ? finishLine.tolerance.passes_in_a_row : undefined;
  if (typeof needed === 'number') {
    for (const line of lines) {
      if (!isPlainObject(line) || line.source !== 'reviews.streak') continue;
      if (line.value !== null && line.value !== undefined && line.value !== needed) {
        errors.push(`line ${show(line.id)}: reviews.streak asks for ${show(line.value)} but tolerance.passes_in_a_row is ${needed}; they must agree`);
      }
    }
  }
  return errors;
}

export function compare(op, actual, expected) {
  switch (op) {
    case 'at_least': return actual >= expected;
    case 'at_most': return actual <= expected;
    case 'is': return actual === expected;
    default: return false;
  }
}

/**
 * Parse "- [x] id — label" checklist lines into { id: checked }.
 */
export function parseChecklist(md) {
  const out = {};
  for (const line of String(md ?? '').split(/\r?\n/)) {
    const m = line.match(/^- \[( |x|X)\] ([A-Za-z0-9_-]+)\s*[—:-]/);
    if (m) out[m[2]] = m[1] !== ' ';
  }
  return out;
}

const NOT_FOUND = { found: false, value: null };

/**
 * Resolve a source string to { found, value } using the run data in ctx.
 */
export function resolveSource(source, ctx = {}) {
  const src = String(source ?? '');
  const runs = ctx.runs ?? [];
  const reviews = ctx.reviews ?? [];
  const findings = ctx.findings ?? [];
  const helpers = ctx.helpers ?? [];
  const measurements = ctx.measurements ?? [];
  const checklist = ctx.checklist ?? {};

  if (src.startsWith('runs.streak:')) {
    return { found: true, value: greenStreak(runs, src.slice('runs.streak:'.length)) };
  }
  if (src === 'reviews.streak') {
    return { found: true, value: reviewStreak(reviews) };
  }
  if (src.startsWith('reviews.latest.')) {
    const sev = src.slice('reviews.latest.'.length);
    if (!SEVERITIES.includes(sev)) return { ...NOT_FOUND };
    const latest = latestReview(reviews);
    if (!latest || !validCounts(latest.counts)) return { ...NOT_FOUND };
    return { found: true, value: latest.counts[sev] ?? 0 };
  }
  if (src.startsWith('findings.open:')) {
    const sev = src.slice('findings.open:'.length);
    if (!SEVERITIES.includes(sev)) return { ...NOT_FOUND };
    return { found: true, value: openBySeverity(findings)[sev] };
  }
  if (src === 'helpers.over_budget') {
    let n = 0;
    for (const h of foldHelpers(helpers).values()) if (h.over_budget) n++;
    return { found: true, value: n };
  }
  if (src.startsWith('checklist:')) {
    const id = src.slice('checklist:'.length);
    if (!Object.hasOwn(checklist, id)) return { ...NOT_FOUND };
    return { found: true, value: checklist[id] };
  }
  if (src.startsWith('measure:')) {
    const id = src.slice('measure:'.length);
    let value;
    let found = false;
    for (const m of measurements) {
      if (m?.key === id) { value = m.value; found = true; }
    }
    return found ? { found: true, value } : { ...NOT_FOUND };
  }
  return { ...NOT_FOUND };
}

const hasValue = (v) => v !== undefined && v !== null && v !== '';

/**
 * Narrow run data to one stream; measurements, checklist and helpers are left
 * as they are. Runs and reviews keep only rows whose `stream` equals the given
 * one. A finding row belongs to the stream when its own `stream` matches, or,
 * when it has no stream, when its `review_id` names a review (looked up in the
 * unfiltered reviews) of that stream. A partial close row with neither a
 * stream nor a review_id (such as { id, status: 'fixed' }) is kept when its id
 * is the id of a finding row kept above, so closing a finding still closes it.
 */
export function filterByStream(ctx = {}, stream) {
  const inStream = (row) => row?.stream === stream;
  const reviews = ctx.reviews ?? [];
  const findings = ctx.findings ?? [];

  const streamOfReview = new Map();
  for (const r of reviews) {
    if (hasValue(r?.id)) streamOfReview.set(r.id, r?.stream);
  }
  // null: the row carries no attribution of its own (a partial close row).
  const attributed = (row) => {
    if (hasValue(row?.stream)) return row.stream === stream;
    if (hasValue(row?.review_id)) return streamOfReview.has(row.review_id) && streamOfReview.get(row.review_id) === stream;
    return null;
  };

  const keptIds = new Set();
  for (const row of findings) {
    if (attributed(row) === true && hasValue(row.id)) keptIds.add(row.id);
  }
  const keep = (row) => {
    const own = attributed(row);
    if (own !== null) return own;
    return hasValue(row?.id) && keptIds.has(row.id);
  };

  return {
    ...ctx,
    runs: (ctx.runs ?? []).filter(inStream),
    reviews: reviews.filter(inStream),
    findings: findings.filter(keep)
  };
}

// A number/percent line needs a finite number, a bool line a boolean; a line
// with no (or an unknown) type is typed by its op: `is` compares booleans.
function typeOk(type, op, actual) {
  const t = type === 'bool' || type === 'number' || type === 'percent'
    ? type
    : (op === 'is' ? 'bool' : 'number');
  return t === 'bool' ? typeof actual === 'boolean' : Number.isFinite(actual);
}

/**
 * Evaluate every finish-line row. Lines with a null/undefined value are
 * reported as not_counted and never affect the verdict. Missing or ill-typed
 * data is never met: failing for build lines, waiting_on_human for human lines.
 * An empty gate (no counted line) is not met, and the build gate needs at
 * least one counted build line: a human-only finish line never meets it,
 * though its full gate can still be met. With `stream`, runs, reviews and
 * findings are scoped to that stream first (see filterByStream), and lines with scope `run` are
 * reported as run_scoped and left to the run-wide gate.
 */
export function evaluateGate({ finishLine, runs, reviews, findings, helpers, measurements, checklist, stream } = {}) {
  const scoped = typeof stream === 'string' && stream !== '' ? stream : null;
  let ctx = { runs, reviews, findings, helpers, measurements, checklist };
  if (scoped !== null) ctx = filterByStream(ctx, scoped);
  const lines = [];

  for (const line of finishLine?.lines ?? []) {
    const owner = line.owner ?? 'build';
    const op = line.op ?? 'at_least';
    const scope = SCOPES.includes(line.scope) ? line.scope : null;
    const resolved = resolveSource(line.source, ctx);
    const actual = resolved.found ? resolved.value : null;
    const counted = line.value !== null && line.value !== undefined;

    let status;
    if (!counted) {
      status = 'not_counted';
    } else if (scoped !== null && scope === 'run') {
      // A run-wide line cannot be met by one stream; the run-wide gate judges it.
      status = 'run_scoped';
    } else if (resolved.found && typeOk(line.type, op, actual) && compare(op, actual, line.value)) {
      status = 'met';
    } else {
      status = owner === 'build' ? 'failing' : 'waiting_on_human';
    }

    lines.push({
      id: line.id,
      label: line.label,
      owner,
      type: line.type,
      op,
      scope,
      value: line.value ?? null,
      actual,
      status
    });
  }

  const counted = lines.filter(l => l.status !== 'not_counted' && l.status !== 'run_scoped');
  const countedBuild = counted.filter(l => l.owner === 'build');
  return {
    stream: scoped,
    lines,
    failing: lines.filter(l => l.status === 'failing').map(l => l.id),
    waitingOnHuman: lines.filter(l => l.status === 'waiting_on_human').map(l => l.id),
    runScoped: lines.filter(l => l.status === 'run_scoped').map(l => l.id),
    buildGateMet: countedBuild.length > 0 && countedBuild.every(l => l.status === 'met'),
    // gateMet ⇒ buildGateMet always: a finish line that the build never had a hand in is not "done".
    gateMet: countedBuild.length > 0 && counted.every(l => l.status === 'met')
  };
}
