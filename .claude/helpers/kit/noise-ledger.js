/**
 * noise-ledger — keep the first encounter with a new checker survivable. Advisory: it never fails because findings exist.
 *
 *   noise-ledger apply  [--in <file>] [--cap N] [--first-run] [--ledger <path>] [--now <date>]   (findings JSON on stdin, or --in <file>; --in - means stdin)
 *   noise-ledger accept --id <id> --reason <text> [--expires YYYY-MM-DD] [--ledger <path>] [--now <date>]
 *   noise-ledger prune  [--ledger <path>] [--now <date>]
 *
 * INPUT. A list (or `{ "findings": [...] }`) of findings: `id` (or `fingerprint`), `severity` high|medium|low, optional
 * `rule`, `locations` (screens or files; `screens` and `files` are read the same way), and the retry counts `failures`
 * (retries run) and `reproductions` (of those, how many showed the finding again), both default 0.
 *
 * WHAT apply DOES. Findings matching a non-expired entry of the committed ledger are `accepted` (reported, not filed).
 * A finding that never reproduced on its retries (reproductions === 0 and failures >= 2) is `quarantined`: listed, never
 * blocking, and raised as `needs_attention` (a sign the baseline or determinism setup needs a look), never dropped.
 * The rest are ranked by severity, then by how many places they touch, then by id; the top `--cap` (default 5) are `filed`
 * individually and the others are folded into one `summary`. `blocking` is true only when something is left to file or
 * fold and `--first-run` is not set. `flake_rate` is (failures - reproductions) / failures over all input findings, null
 * when there are no failures. Same input, same output order.
 *
 * LEDGER. `.claude/kit/noise-ledger.json` by default: `{ "version": 1, "entries": [{ id, reason, added, expires? }] }`.
 * An entry is valid through its `expires` day (UTC, inclusive); after that it never matches and `prune` removes it.
 * Dates must be real YYYY-MM-DD days. Time comes from `--now` (a date, or an ISO time: with Z or an offset the UTC day is used) or the clock. `accept` refuses a
 * past expiry. Unknown entry and top-level fields are preserved on rewrite; a ledger whose `version` is newer than 1 is refused (exit 1). A missing default ledger is empty; a missing `--ledger` is an error for apply, empty for accept.
 *
 * Exit codes: 0 done (findings or not), 1 invalid input or broken ledger.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'noise-ledger';
export const usage = 'cli.js noise-ledger apply [--in <file>] [--cap N] [--first-run] [--ledger <path>] [--now <date>] | accept --id <id> --reason <text> [--expires YYYY-MM-DD] | prune   '
  + '(findings JSON on stdin: ranks by severity then places touched, files the top N and folds the rest, quarantines findings that never reproduced on 2+ retries, '
  + 'reports ledger-accepted ones, --first-run never blocks; advisory: exit 0 even with findings, 1 for invalid input)';

export const DEFAULT_LEDGER = '.claude/kit/noise-ledger.json';
export const DEFAULT_CAP = 5;
export const QUARANTINE_AFTER = 2;
export const LEDGER_VERSION = 1;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const invalid = (m) => new KitExit(m, 1);

// ================================================================ dates

/** A real calendar day `YYYY-MM-DD` from a date or ISO time string, else null. */
export function parseDate(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  if (m[0].length > 10) {
    const ms = Date.parse(v.trim().replace(' ', 'T'));
    if (Number.isNaN(ms)) return null;
    if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(v.trim())) return new Date(ms).toISOString().slice(0, 10);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function today(now) {
  if (now === undefined) return new Date().toISOString().slice(0, 10);
  const d = now instanceof Date ? (Number.isNaN(now.getTime()) ? null : now.toISOString().slice(0, 10)) : parseDate(now);
  if (!d) throw invalid(`--now ${JSON.stringify(String(now)).slice(0, 40)} is not a date (YYYY-MM-DD)`);
  return d;
}

/** Valid through the `expires` day; expired the day after. No expiry never lapses. */
export const isExpired = (entry, day) => entry.expires != null && entry.expires < day;

// ================================================================ input

const str = (v) => typeof v === 'string' && v.trim() !== '';
const count = (v, what, id) => {
  if (v === undefined) return 0;
  if (!Number.isInteger(v) || v < 0) throw invalid(`finding ${id}: ${what} must be a whole number >= 0`);
  return v;
};

/** Validate and normalise findings; throws exit 1 on any problem. */
export function normalizeFindings(list) {
  if (!Array.isArray(list)) throw invalid('findings must be a list');
  const seen = new Set();
  return list.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid(`finding #${i + 1} is not an object`);
    const id = str(raw.id) ? raw.id : raw.fingerprint;
    if (!str(id)) throw invalid(`finding #${i + 1} needs an id or fingerprint`);
    if (seen.has(id)) throw invalid(`duplicate finding id ${JSON.stringify(id).slice(0, 80)}`);
    seen.add(id);
    if (!Object.hasOwn(SEVERITY_RANK, raw.severity)) throw invalid(`finding ${id}: severity must be high, medium or low`);
    const places = [];
    for (const k of ['locations', 'screens', 'files']) {
      if (raw[k] === undefined) continue;
      if (!Array.isArray(raw[k]) || raw[k].some((x) => !str(x))) throw invalid(`finding ${id}: ${k} must be a list of non-empty strings`);
      places.push(...raw[k]);
    }
    if (raw.rule !== undefined && typeof raw.rule !== 'string') throw invalid(`finding ${id}: rule must be a string`);
    const failures = count(raw.failures, 'failures', id);
    const reproductions = count(raw.reproductions, 'reproductions', id);
    if (reproductions > failures) throw invalid(`finding ${id}: reproductions (${reproductions}) exceed failures (${failures})`);
    return { id, severity: raw.severity, rule: raw.rule ?? null, locations: [...new Set(places)].sort(), failures, reproductions };
  });
}

/** Check a ledger object; returns it with sorted entries. */
export function normalizeLedger(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l) || !Array.isArray(l.entries)) throw invalid('ledger must be { "entries": [...] }');
  if (l.version !== undefined && (!Number.isInteger(l.version) || l.version < 1)) throw invalid('ledger version must be a whole number >= 1');
  if (l.version > LEDGER_VERSION) throw invalid(`ledger version ${l.version} is newer than this verb understands (${LEDGER_VERSION}); upgrade the kit`);
  const seen = new Set();
  const entries = l.entries.map((e, i) => {
    if (!e || typeof e !== 'object' || !str(e.id)) throw invalid(`ledger entry #${i + 1} needs an id`);
    if (seen.has(e.id)) throw invalid(`ledger has a duplicate id ${JSON.stringify(e.id).slice(0, 80)}`);
    seen.add(e.id);
    if (e.expires != null && (typeof e.expires !== 'string' || parseDate(e.expires) !== e.expires)) throw invalid(`ledger entry ${e.id}: expires must be a real YYYY-MM-DD date`);
    return { ...e, id: e.id, reason: typeof e.reason === 'string' ? e.reason : '', added: typeof e.added === 'string' ? e.added : undefined, ...(e.expires != null ? { expires: e.expires } : {}) };
  });
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...l, version: LEDGER_VERSION, entries };
}

// ================================================================ logic

/** (failures - reproductions) / failures over the rows; null when there are no failures. */
export function flakeRate(rows) {
  let f = 0; let r = 0;
  for (const x of rows) { f += x.failures || 0; r += x.reproductions || 0; }
  return f === 0 ? null : (f - r) / f;
}

const byRank = (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.locations.length - a.locations.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Pure planner. `findings` raw list; options `{ cap, firstRun, ledger, now }`. Returns the full report.
 */
export function plan(findings, { cap = DEFAULT_CAP, firstRun = false, ledger = null, now } = {}) {
  if (!Number.isInteger(cap) || cap < 0) throw invalid('--cap must be a whole number >= 0');
  const day = today(now);
  const all = normalizeFindings(findings);
  const entries = ledger ? normalizeLedger(ledger).entries : [];
  const byEntry = new Map(entries.map((e) => [e.id, e]));
  const accepted = []; const quarantined = []; const open = []; const expiredLedger = [];
  for (const x of all) {
    const e = byEntry.get(x.id);
    if (e && !isExpired(e, day)) { accepted.push({ ...x, reason: e.reason, expires: e.expires ?? null }); continue; }
    if (e) expiredLedger.push({ id: e.id, expires: e.expires, reason: e.reason });
    if (x.reproductions === 0 && x.failures >= QUARANTINE_AFTER) { quarantined.push({ ...x, not_reproduced: x.failures }); continue; }
    open.push(x);
  }
  open.sort(byRank);
  const filed = open.slice(0, cap);
  const folded = open.slice(cap);
  const summary = folded.length ? {
    count: folded.length,
    ids: folded.map((x) => x.id),
    by_severity: { high: 0, medium: 0, low: 0, ...Object.fromEntries(['high', 'medium', 'low'].map((s) => [s, folded.filter((x) => x.severity === s).length])) }
  } : null;
  const needs = quarantined.length > 0;
  return {
    first_run: !!firstRun,
    date: day,
    blocking: !firstRun && open.length > 0,
    filed,
    summary,
    accepted: accepted.sort(byId),
    quarantined: quarantined.sort(byId),
    expired_ledger: expiredLedger.sort(byId),
    needs_attention: needs,
    attention: needs ? `${quarantined.length} finding(s) never reproduced on ${QUARANTINE_AFTER}+ retries: they are listed and never block, but they suggest the baseline or determinism setup needs attention.` : null,
    flake_rate: flakeRate(all),
    totals: { input: all.length, filed: filed.length, folded: folded.length, accepted: accepted.length, quarantined: quarantined.length }
  };
}

// ================================================================ CLI

const VALUE_FLAGS = ['in', 'cap', 'ledger', 'now', 'id', 'reason', 'expires'];

export function parseArgs(args) {
  const f = { cmd: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') { f.help = true; continue; }
    if (a === '--first-run') { f.firstRun = true; continue; }
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (name && VALUE_FLAGS.includes(name)) {
      if (i + 1 >= args.length) throw invalid(`--${name} needs a value (see --help)`);
      f[name] = args[++i];
      continue;
    }
    if (!name && f.cmd === null) { f.cmd = a; continue; }
    throw invalid(`${name ? 'unknown flag' : 'unexpected argument'} ${a} (see --help)`);
  }
  return f;
}

async function readLedger(file, { mustExist }) {
  let text;
  try { text = await fs.readFile(file, 'utf-8'); } catch (e) {
    if (e.code === 'ENOENT') { if (mustExist) throw invalid(`ledger ${file} does not exist`); return { version: 1, entries: [] }; }
    throw invalid(`cannot read ledger ${file}: ${e.code || e.message}`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw invalid(`ledger ${file} is not valid JSON`); }
  return normalizeLedger(parsed);
}

async function writeLedger(file, ledger) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 2) + '\n');
  await fs.rename(tmp, file);
}

export async function run(args, io = {}) {
  const f = parseArgs(args);
  if (f.help) return { usage };
  if (!['apply', 'accept', 'prune'].includes(f.cmd)) throw invalid('give a command: apply, accept or prune (see --help)');
  const cwd = io.cwd || process.cwd();
  const day = today(f.now);
  const explicit = f.ledger !== undefined;
  const ledgerFile = path.resolve(cwd, f.ledger ?? DEFAULT_LEDGER);

  if (f.cmd === 'apply') {
    let cap = DEFAULT_CAP;
    if (f.cap !== undefined) {
      if (!/^\d+$/.test(f.cap)) throw invalid('--cap must be a whole number >= 0');
      cap = Number(f.cap);
    }
    let text;
    if (f.in !== undefined && f.in !== '-') {
      try { text = await fs.readFile(path.resolve(cwd, f.in), 'utf-8'); } catch (e) { throw invalid(`cannot read ${f.in}: ${e.code || e.message}`); }
    } else {
      if (io.stdinIsTTY) throw invalid('give findings on stdin or --in <file>');
      text = io.stdin ? await io.stdin() : '';
    }
    if (!text || !text.trim()) throw invalid('no findings input (JSON list expected)');
    let data;
    try { data = JSON.parse(text); } catch { throw invalid('findings input is not valid JSON'); }
    const list = Array.isArray(data) ? data : data && typeof data === 'object' ? data.findings : undefined;
    const ledger = await readLedger(ledgerFile, { mustExist: explicit });
    return plan(list, { cap, firstRun: !!f.firstRun, ledger, now: day });
  }

  if (f.cmd === 'accept') {
    if (!str(f.id)) throw invalid('accept needs --id');
    if (!str(f.reason)) throw invalid('accept needs --reason');
    let expires;
    if (f.expires !== undefined) {
      if (parseDate(f.expires) !== f.expires) throw invalid('--expires must be a real YYYY-MM-DD date');
      if (f.expires < day) throw invalid(`--expires ${f.expires} is already in the past`);
      expires = f.expires;
    }
    const ledger = await readLedger(ledgerFile, { mustExist: false });
    const entry = { id: f.id, reason: f.reason, added: day, ...(expires ? { expires } : {}) };
    const replaced = ledger.entries.some((e) => e.id === f.id);
    ledger.entries = [...ledger.entries.filter((e) => e.id !== f.id), entry];
    const out = normalizeLedger(ledger);
    await writeLedger(ledgerFile, out);
    return { ledger: path.relative(cwd, ledgerFile) || ledgerFile, entry, replaced, entries: out.entries.length };
  }

  const ledger = await readLedger(ledgerFile, { mustExist: false });
  const pruned = ledger.entries.filter((e) => isExpired(e, day));
  if (pruned.length) await writeLedger(ledgerFile, { ...ledger, entries: ledger.entries.filter((e) => !isExpired(e, day)) });
  return { ledger: path.relative(cwd, ledgerFile) || ledgerFile, date: day, pruned, remaining: ledger.entries.length - pruned.length };
}
