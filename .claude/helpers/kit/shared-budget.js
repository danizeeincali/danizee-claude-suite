/**
 * shared-budget — one per-job allowance (steps, cost, wall-clock time) that every sub-agent of that job draws from.
 *
 *   shared-budget open   --state <f> [--steps N] [--cost C] [--time-ms T]
 *   shared-budget grant  --state <f> --helper <id> [--kind model|check]
 *   shared-budget start  --state <f>
 *   shared-budget stop   --state <f>
 *   shared-budget spend  --state <f> --helper <id> [--steps n] [--cost c] --outcome ok|failed
 *   shared-budget status --state <f>
 *   (every call also takes --now <ms> for an injected clock; the default is Date.now())
 *
 * WHAT IT DOES. A state file holds the limits (each optional, validated positive), the running spend, the clock and a
 * row per helper. `grant` hands the next sub-session the remainder of each limit, or `{skip: true, reason}` when any
 * limit is already used up: skipping is a normal outcome (exit 0), never a failure. `--kind check` is for pure checks
 * that use no model (replays, benchmarks): it ignores steps and cost and is stopped only by the time limit.
 * The clock runs only between `start` and the matching `stop`; a depth counter makes nested starts count once, so
 * time is never double-counted. `spend` records immediately, failures included; a spend that overruns a limit is
 * recorded truthfully and reported in `overrun` (still exit 0). Cost is in whatever unit the caller chooses.
 * GRANTS RESERVE. A model grant holds the amount it hands out (steps, cost) on the helper's row as `reserved`; later
 * grants get the remainder minus every other helper's outstanding reservation, so parallel sub-sessions can never be
 * licensed for more than a limit together. A helper's `spend` releases its reservation; re-granting a helper replaces its
 * reservation. Time is not reserved (one shared clock) and check grants reserve nothing.
 * Every mutating command holds an exclusive lock file (<state>.lock, O_EXCL, bounded retry, stale after 30 s) from load
 * to save, so concurrent callers (processes or Promise.all in one process) never lose a write. State writes are atomic
 * (uniquely named temp file + rename). Time never goes backwards: a clock that jumps back adds nothing.
 * This is a per-job allowance and sits beside, not inside, the marathon token budget in src/lib/marathon/budget.js.
 *
 * Exit codes: 0 done (including a skip and an overrun), 1 invalid input or corrupt state. No network, no model use.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { KitExit } from './kit-exit.js';

export const verb = 'shared-budget';
export const usage = 'cli.js shared-budget open|grant|start|stop|spend|status --state <file> '
  + '[open: --steps N --cost C --time-ms T] [grant: --helper <id> --kind model|check] '
  + '[spend: --helper <id> --steps n --cost c --outcome ok|failed] [--now <ms>]   '
  + '(a per-job allowance shared by sub-agents; grant returns the remainder or {skip:true,reason}, an exhausted limit is a skip with exit 0; '
  + 'start/stop run the clock with a nesting depth; spend is recorded at once, failures too, overruns reported; exit 0 done, 1 invalid or corrupt)';

export const KINDS = Object.freeze(['model', 'check']);
export const OUTCOMES = Object.freeze(['ok', 'failed']);
const bad = (m) => new KitExit(m, 1);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ZERO = () => ({ steps: 0, cost: 0 });
const clone = (s) => JSON.parse(JSON.stringify(s));
const round = (n) => Math.round(n * 1e9) / 1e9;

function limitOf(name, v, integer) {
  if (v === undefined || v === null) return null;
  if (!isNum(v) || v <= 0 || (integer && !Number.isInteger(v))) throw bad(`${name} must be a positive ${integer ? 'integer' : 'number'}`);
  return v;
}
function nonNeg(name, v, integer) {
  if (!isNum(v) || v < 0 || (integer && !Number.isInteger(v))) throw bad(`${name} must be a non-negative ${integer ? 'integer' : 'number'}`);
  return v;
}
function helperId(h) {
  if (typeof h !== 'string' || !h.trim()) throw bad('--helper must be a non-empty id');
  return h;
}
function nowOf(now) {
  if (!isNum(now) || now < 0) throw bad('--now must be a non-negative number of milliseconds');
  return now;
}

// ================================================================ library

export function openBudget({ steps, cost, timeMs } = {}, now) {
  nowOf(now);
  return {
    version: 1,
    openedAt: now,
    limits: { steps: limitOf('steps', steps, true), cost: limitOf('cost', cost, false), timeMs: limitOf('time-ms', timeMs, true) },
    spent: { steps: 0, cost: 0 },
    clock: { depth: 0, startedAt: null, elapsedMs: 0 },
    helpers: {}
  };
}

/** Throws KitExit(1) unless `s` is a well-formed state; returns it. */
export function checkState(s) {
  const fail = () => { throw bad('budget state is corrupt'); };
  if (!s || typeof s !== 'object' || s.version !== 1) fail();
  const { limits, spent, clock, helpers } = s;
  if (!limits || !spent || !clock || !helpers || typeof helpers !== 'object') fail();
  for (const k of ['steps', 'cost', 'timeMs']) if (limits[k] !== null && !(isNum(limits[k]) && limits[k] > 0)) fail();
  for (const k of ['steps', 'cost']) if (!isNum(spent[k]) || spent[k] < 0) fail();
  if (!Number.isInteger(clock.depth) || clock.depth < 0 || !isNum(clock.elapsedMs) || clock.elapsedMs < 0) fail();
  if (clock.depth > 0 ? !isNum(clock.startedAt) : clock.startedAt !== null) fail();
  for (const h of Object.values(helpers)) {
    if (!h || typeof h !== 'object') fail();
    for (const k of ['steps', 'cost', 'ok', 'failed', 'grants', 'skipped']) if (!isNum(h[k]) || h[k] < 0) fail();
    if (h.reserved !== undefined && (!h.reserved || !isNum(h.reserved.steps) || h.reserved.steps < 0 || !isNum(h.reserved.cost) || h.reserved.cost < 0)) fail();
  }
  return s;
}

/** Active milliseconds so far: banked time plus the running span, never negative. */
export function elapsed(s, now) {
  const running = s.clock.depth > 0 ? Math.max(0, now - s.clock.startedAt) : 0;
  return s.clock.elapsedMs + running;
}

export function startClock(s, now) {
  nowOf(now);
  const n = clone(s);
  if (n.clock.depth === 0) n.clock.startedAt = now;
  n.clock.depth += 1;
  return n;
}

export function stopClock(s, now) {
  nowOf(now);
  if (s.clock.depth === 0) throw bad('stop without a matching start');
  const n = clone(s);
  n.clock.depth -= 1;
  if (n.clock.depth === 0) {
    n.clock.elapsedMs += Math.max(0, now - n.clock.startedAt);
    n.clock.startedAt = null;
  }
  return n;
}

function remainingOf(s, now) {
  const { limits, spent } = s;
  return {
    steps: limits.steps === null ? null : Math.max(0, limits.steps - spent.steps),
    cost: limits.cost === null ? null : Math.max(0, round(limits.cost - spent.cost)),
    timeMs: limits.timeMs === null ? null : Math.max(0, limits.timeMs - elapsed(s, now))
  };
}

/** Steps and cost held by outstanding grants; `except` leaves one helper's own reservation out. */
export function reservedOf(s, except) {
  const r = ZERO();
  for (const [id, h] of Object.entries(s.helpers)) {
    if (id === except || !h.reserved) continue;
    r.steps += h.reserved.steps;
    r.cost = round(r.cost + h.reserved.cost);
  }
  return r;
}

/** What a new grant may use: the remainder minus the other helpers' reservations (time is never reserved). */
function availableOf(s, now, except) {
  const rem = remainingOf(s, now);
  const res = reservedOf(s, except);
  return {
    steps: rem.steps === null ? null : Math.max(0, rem.steps - res.steps),
    cost: rem.cost === null ? null : Math.max(0, round(rem.cost - res.cost)),
    timeMs: rem.timeMs
  };
}

/** What the next sub-session may use, or `{skip: true, reason}`. A check grant looks at time only. */
export function grantFor(s, { helper, kind = 'model' }, now) {
  helperId(helper);
  if (!KINDS.includes(kind)) throw bad(`--kind must be one of ${KINDS.join(', ')}`);
  nowOf(now);
  const remaining = remainingOf(s, now);
  const available = availableOf(s, now, helper);
  const dims = kind === 'check' ? ['timeMs'] : ['steps', 'cost', 'timeMs'];
  const names = { steps: 'steps', cost: 'cost', timeMs: 'time' };
  const used = dims.filter((d) => remaining[d] !== null && remaining[d] <= 0).map((d) => names[d]);
  const held = dims.filter((d) => remaining[d] !== null && remaining[d] > 0 && available[d] <= 0).map((d) => names[d]);
  if (used.length || held.length) {
    const parts = [];
    if (used.length) parts.push(`${used.join(' and ')} limit exhausted`);
    if (held.length) parts.push(`${held.join(' and ')} limit fully reserved by other sub-sessions`);
    return { skip: true, helper, kind, reason: parts.join('; ') };
  }
  const out = kind === 'check' ? { steps: null, cost: null, timeMs: available.timeMs } : available;
  return { skip: false, helper, kind, remaining: out };
}

function row(s, id) {
  if (!s.helpers[id]) s.helpers[id] = { steps: 0, cost: 0, ok: 0, failed: 0, grants: 0, skipped: 0, reserved: ZERO() };
  return s.helpers[id];
}

/** Log a grant decision on the helper's row and, for a model grant, reserve what it hands out (returns a new state). */
export function recordGrant(s, helper, grant) {
  const n = clone(s);
  const r = row(n, helperId(helper));
  if (grant.skip) r.skipped += 1;
  else {
    r.grants += 1;
    if (grant.kind !== 'check') r.reserved = { steps: grant.remaining.steps ?? 0, cost: grant.remaining.cost ?? 0 };
  }
  return n;
}

/** Record spend at once, failures included. Returns `{state, overrun}`; overrun lists how far each limit is passed. */
export function recordSpend(s, { helper, steps = 0, cost = 0, outcome }) {
  helperId(helper);
  nonNeg('steps', steps, true);
  nonNeg('cost', cost, false);
  if (!OUTCOMES.includes(outcome)) throw bad(`--outcome must be one of ${OUTCOMES.join(', ')}`);
  const n = clone(s);
  const r = row(n, helper);
  r.steps += steps; r.cost = round(r.cost + cost);
  r.reserved = ZERO(); // the spend ends the grant
  r[outcome] += 1;
  n.spent.steps += steps;
  n.spent.cost = round(n.spent.cost + cost);
  const overrun = {};
  if (n.limits.steps !== null && n.spent.steps > n.limits.steps) overrun.steps = n.spent.steps - n.limits.steps;
  if (n.limits.cost !== null && n.spent.cost > n.limits.cost) overrun.cost = round(n.spent.cost - n.limits.cost);
  return { state: n, overrun: Object.keys(overrun).length ? overrun : null };
}

export function statusOf(s, now) {
  nowOf(now);
  const remaining = remainingOf(s, now);
  const exhausted = [];
  if (remaining.steps === 0) exhausted.push('steps');
  if (remaining.cost === 0) exhausted.push('cost');
  if (remaining.timeMs === 0) exhausted.push('time');
  return {
    limits: s.limits,
    spent: { ...s.spent, timeMs: elapsed(s, now) },
    elapsedMs: elapsed(s, now),
    clockRunning: s.clock.depth > 0,
    depth: s.clock.depth,
    remaining,
    reserved: reservedOf(s),
    available: availableOf(s, now),
    exhausted,
    helpers: Object.entries(s.helpers).map(([helper, h]) => ({ helper, ...h, reserved: h.reserved || ZERO() }))
  };
}

// ================================================================ CLI

const VALUE_FLAGS = new Set(['state', 'steps', 'cost', 'time-ms', 'helper', 'kind', 'outcome', 'now']);

function parse(args) {
  let cmd;
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      if (cmd !== undefined) throw bad(`unexpected argument ${a}`);
      cmd = a;
      continue;
    }
    const k = a.slice(2);
    if (!VALUE_FLAGS.has(k)) throw bad(`unknown flag ${a}`);
    if (i + 1 >= args.length) throw bad(`${a} needs a value`);
    if (flags[k] !== undefined) throw bad(`${a} given twice`);
    flags[k] = args[++i];
  }
  return { cmd, flags };
}

function num(name, raw) {
  if (raw === undefined) return undefined;
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw bad(`${name} must be a number`);
  return Number(raw);
}

async function load(file) {
  let text;
  try { text = await fs.readFile(file, 'utf-8'); } catch (e) {
    if (e.code === 'ENOENT') throw bad(`no budget state at ${file}; run open first`);
    throw bad(`cannot read ${file}: ${e.code || e.message}`);
  }
  let data;
  try { data = JSON.parse(text); } catch { throw bad(`budget state ${file} is not valid JSON`); }
  return checkState(data);
}

async function save(file, state) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw bad(`cannot write ${file}: ${e.code || e.message}`);
  }
}

const LOCK_STALE_MS = 30000;
const LOCK_WAIT_MS = 10000;

/** Exclusive lock file around a read-modify-write: O_EXCL create, bounded retry, stale after LOCK_STALE_MS, removed only if still ours. */
async function withLock(file, fn, missing) {
  const lock = `${file}.lock`;
  const token = `${process.pid}.${randomUUID()}`;
  const started = Date.now();
  let delay = 2;
  for (;;) {
    try {
      const fh = await fs.open(lock, 'wx');
      try { await fh.writeFile(token); } finally { await fh.close(); }
      break;
    } catch (e) {
      if (e.code === 'ENOENT' && missing) throw bad(missing);
      if (e.code !== 'EEXIST') throw bad(`cannot lock ${file}: ${e.code || e.message}`);
      const st = await fs.stat(lock).catch(() => null);
      if (st && Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        const gone = `${lock}.${randomUUID()}.stale`;
        try { await fs.rename(lock, gone); await fs.rm(gone, { force: true }); } catch { /* another waiter broke it first */ }
        continue;
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw bad(`budget state is locked (${lock}); delete it if no other sub-session is using the budget`);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 50);
    }
  }
  try { return await fn(); } finally {
    const mine = await fs.readFile(lock, 'utf-8').then((c) => c === token, () => false);
    if (mine) await fs.rm(lock, { force: true });
  }
}

export async function run(args, io) {
  const { cmd, flags } = parse(args);
  const cmds = ['open', 'grant', 'start', 'stop', 'spend', 'status'];
  if (!cmds.includes(cmd)) throw bad(`expected one of ${cmds.join(', ')}`);
  if (!flags.state) throw bad('--state <file> is required');
  const file = path.resolve(io.cwd || process.cwd(), flags.state);
  const now = nowOf(flags.now === undefined ? Date.now() : num('--now', flags.now));

  if (cmd === 'open') {
    for (const k of ['helper', 'kind', 'outcome']) if (flags[k] !== undefined) throw bad(`--${k} does not apply to open`);
    const s = openBudget({ steps: num('--steps', flags.steps), cost: num('--cost', flags.cost), timeMs: num('--time-ms', flags['time-ms']) }, now);
    return withLock(file, async () => {
      try { await fs.access(file); throw bad(`${file} already exists`); } catch (e) { if (e instanceof KitExit) throw e; }
      await save(file, s);
      return { opened: true, limits: s.limits };
    });
  }

  if (cmd === 'status') return statusOf(await load(file), now); // read-only: the atomic rename means never a torn file

  // Inputs are checked before the lock is taken; the lock covers load..save.
  let spendIn;
  if (cmd === 'spend') {
    if (flags.steps === undefined && flags.cost === undefined) throw bad('spend needs --steps and/or --cost');
    spendIn = { helper: flags.helper, steps: num('--steps', flags.steps), cost: num('--cost', flags.cost), outcome: flags.outcome };
  }
  return withLock(file, async () => {
    const state = await load(file);
    if (cmd === 'start' || cmd === 'stop') {
      const n = cmd === 'start' ? startClock(state, now) : stopClock(state, now);
      await save(file, n);
      return { depth: n.clock.depth, clockRunning: n.clock.depth > 0, elapsedMs: elapsed(n, now) };
    }
    if (cmd === 'grant') {
      const g = grantFor(state, { helper: flags.helper, kind: flags.kind }, now);
      await save(file, recordGrant(state, flags.helper, g));
      return g;
    }
    const r = recordSpend(state, spendIn);
    await save(file, r.state);
    const st = statusOf(r.state, now);
    return { recorded: true, helper: flags.helper, outcome: flags.outcome, overrun: r.overrun, remaining: st.remaining, exhausted: st.exhausted };
  }, `no budget state at ${file}; run open first`);
}
