/**
 * shared-budget — one per-job allowance (steps, cost, wall-clock time) that every sub-agent of that job draws from.
 *
 *   shared-budget open   --state <f> [--steps N] [--cost C] [--time-ms T]
 *   shared-budget grant  --state <f> --helper <id> [--kind model|check] [--steps N] [--cost C] [--parts N]
 *   shared-budget release --state <f> --helper <id>
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
 * GRANTS RESERVE A SHARE. A model grant holds the amount it hands out (steps, cost) on the helper's row as `reserved`;
 * later grants get what is available (remainder minus every other helper's outstanding reservation), so parallel
 * sub-sessions can never be licensed for more than a limit together. The share is chosen per grant: `--steps N` /
 * `--cost C` ask for that much, capped at what is available; `--parts N` splits what is available evenly among N
 * sub-sessions (each grant takes available / (N - other live reservations)); with neither, the grant takes the whole
 * available remainder. A helper's `spend` releases its reservation; re-granting a helper replaces its reservation.
 * `release --helper <id>` frees the reservation of a helper that died before it could spend (nothing is spent).
 * Time is not reserved (one shared clock) and check grants reserve nothing.
 * Every mutating command holds the shared state lock (./state-lock.js: <state>.lock, O_EXCL, bounded wait, heartbeat) from
 * load to save, so concurrent callers (processes or Promise.all in one process) never lose a write. A lock is judged stale
 * only by the waiter's own monotonic clock (content unchanged for 30 s), never by file mtimes, so clock skew between hosts
 * cannot break a live lock; a failing break or an unwritable folder ends in exit 1 within the wait bound (60 s). `status`
 * only reads and takes no lock. State writes are atomic (uniquely named temp file + rename). Time never goes backwards: a
 * clock that jumps back adds nothing. Test hook: SHARED_BUDGET_LOCK_STALE_MS shortens the stale age (wait = 4x).
 * This is a per-job allowance and sits beside, not inside, the marathon token budget in src/lib/marathon/budget.js.
 *
 * Exit codes: 0 done (including a skip and an overrun), 1 invalid input or corrupt state. No network, no model use.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { withStateLock, readJsonState, writeJsonAtomic } from './state-lock.js';

export const verb = 'shared-budget';
export const usage = 'cli.js shared-budget open|grant|release|start|stop|spend|status --state <file> '
  + '[open: --steps N --cost C --time-ms T] [grant: --helper <id> --kind model|check --steps N --cost C --parts N] '
  + '[release: --helper <id>] '
  + '[spend: --helper <id> --steps n --cost c --outcome ok|failed] [--now <ms>]   '
  + '(a per-job allowance shared by sub-agents; grant returns a share (--steps/--cost, capped at what is available; --parts N splits evenly; default the whole remainder) or {skip:true,reason}, an exhausted limit is a skip with exit 0; '
  + 'release frees a dead helper\'s reservation; '
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
export function grantFor(s, { helper, kind = 'model', steps, cost, parts }, now) {
  helperId(helper);
  if (!KINDS.includes(kind)) throw bad(`--kind must be one of ${KINDS.join(', ')}`);
  const wantSteps = limitOf('steps', steps, true);
  const wantCost = limitOf('cost', cost, false);
  const nParts = limitOf('parts', parts, true);
  if (kind === 'check' && (wantSteps !== null || wantCost !== null || nParts !== null)) throw bad('--steps, --cost and --parts do not apply to a check grant');
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
  if (kind === 'check') return { skip: false, helper, kind, remaining: { steps: null, cost: null, timeMs: available.timeMs } };
  // Divisor for an even split: parts not yet taken by other live reservations.
  const live = Object.entries(s.helpers).filter(([id, h]) => id !== helper && h.reserved && (h.reserved.steps > 0 || h.reserved.cost > 0)).length;
  const divisor = nParts === null ? 1 : Math.max(1, nParts - live);
  const share = (want, avail, integer) => {
    if (want !== null) return avail === null ? want : Math.min(want, avail);
    if (avail === null) return null;
    if (divisor === 1) return avail;
    return integer ? Math.max(1, Math.floor(avail / divisor)) : round(avail / divisor);
  };
  const out = { steps: share(wantSteps, available.steps, true), cost: share(wantCost, available.cost, false), timeMs: available.timeMs };
  return { skip: false, helper, kind, remaining: out };
}

/** Free a helper's reservation without spending (for a sub-session that died). Returns `{state, freed}`. */
export function releaseHelper(s, helper) {
  helperId(helper);
  if (!s.helpers[helper]) throw bad(`no such helper: ${helper}`);
  const n = clone(s);
  const freed = n.helpers[helper].reserved || ZERO();
  n.helpers[helper].reserved = ZERO();
  return { state: n, freed: { steps: freed.steps, cost: freed.cost } };
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

const VALUE_FLAGS = new Set(['state', 'steps', 'cost', 'time-ms', 'helper', 'kind', 'outcome', 'parts', 'now']);

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
  let data;
  try { data = await readJsonState(file); } catch (e) {
    if (!(e instanceof KitExit)) throw e;
    if (/does not exist$/.test(e.message)) throw bad(`no budget state at ${file}; run open first`);
    if (/is not valid JSON$/.test(e.message)) throw bad(`budget state ${file} is not valid JSON`);
    throw e;
  }
  return checkState(data);
}

const save = writeJsonAtomic;

export const LOCK_STALE_MS = 30000;
export const LOCK_WAIT_MS = 2 * LOCK_STALE_MS; // longer than the stale age, so a waiter always reaches the break path

function lockOpts(io) {
  const fsOpt = io && io.lockFs ? { fs: io.lockFs } : {};
  const n = Number(process.env.SHARED_BUDGET_LOCK_STALE_MS);
  return Number.isFinite(n) && n > 0 ? { ...fsOpt, staleMs: n, waitMs: 4 * n } : { ...fsOpt, staleMs: LOCK_STALE_MS, waitMs: LOCK_WAIT_MS };
}

/** The shared state lock around a read-modify-write. */
const withLock = (file, fn, io) => withStateLock(file, fn, lockOpts(io));

export async function run(args, io) {
  const { cmd, flags } = parse(args);
  const cmds = ['open', 'grant', 'release', 'start', 'stop', 'spend', 'status'];
  if (!cmds.includes(cmd)) throw bad(`expected one of ${cmds.join(', ')}`);
  if (!flags.state) throw bad('--state <file> is required');
  const file = path.resolve(io.cwd || process.cwd(), flags.state);
  const now = nowOf(flags.now === undefined ? Date.now() : num('--now', flags.now));

  const only = (allowed) => { for (const k of Object.keys(flags)) if (k !== 'state' && k !== 'now' && !allowed.includes(k)) throw bad(`--${k} does not apply to ${cmd}`); };
  if (cmd === 'grant') only(['helper', 'kind', 'steps', 'cost', 'parts']);
  else if (cmd === 'release') only(['helper']);
  else if (cmd === 'spend') only(['helper', 'steps', 'cost', 'outcome']);
  else if (cmd === 'start' || cmd === 'stop' || cmd === 'status') only([]);

  if (cmd === 'open') {
    for (const k of ['helper', 'kind', 'outcome', 'parts']) if (flags[k] !== undefined) throw bad(`--${k} does not apply to open`);
    const s = openBudget({ steps: num('--steps', flags.steps), cost: num('--cost', flags.cost), timeMs: num('--time-ms', flags['time-ms']) }, now);
    return withLock(file, async () => {
      try { await fs.access(file); throw bad(`${file} already exists`); } catch (e) { if (e instanceof KitExit) throw e; }
      await save(file, s);
      return { opened: true, limits: s.limits };
    }, io);
  }

  if (cmd === 'status') return statusOf(await load(file), now); // read-only: the atomic rename means never a torn file

  // Inputs are checked before the lock is taken; the lock covers load..save.
  let spendIn;
  if (cmd === 'spend') {
    if (flags.steps === undefined && flags.cost === undefined) throw bad('spend needs --steps and/or --cost');
    spendIn = { helper: flags.helper, steps: num('--steps', flags.steps), cost: num('--cost', flags.cost), outcome: flags.outcome };
  }
  await load(file); // a missing or corrupt state fails before any lock or folder is created
  return withLock(file, async () => {
    const state = await load(file);
    if (cmd === 'start' || cmd === 'stop') {
      const n = cmd === 'start' ? startClock(state, now) : stopClock(state, now);
      await save(file, n);
      return { depth: n.clock.depth, clockRunning: n.clock.depth > 0, elapsedMs: elapsed(n, now) };
    }
    if (cmd === 'grant') {
      const g = grantFor(state, { helper: flags.helper, kind: flags.kind, steps: num('--steps', flags.steps), cost: num('--cost', flags.cost), parts: num('--parts', flags.parts) }, now);
      await save(file, recordGrant(state, flags.helper, g));
      return g;
    }
    if (cmd === 'release') {
      const r = releaseHelper(state, flags.helper);
      await save(file, r.state);
      return { released: true, helper: flags.helper, freed: r.freed };
    }
    const r = recordSpend(state, spendIn);
    await save(file, r.state);
    const st = statusOf(r.state, now);
    return { recorded: true, helper: flags.helper, outcome: flags.outcome, overrun: r.overrun, remaining: st.remaining, exhausted: st.exhausted };
  }, io);
}
