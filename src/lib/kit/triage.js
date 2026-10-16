/**
 * triage — finding identity across runs, and the lifecycle of the issues built from findings.
 *
 *   triage visit --session <id> [--in <file>] [--state <path>]     (JSON on stdin when no --in)
 *   triage decide <fingerprint|prefix> --as filed|dismissed|accepted [--issue <ref>] [--state <path>]
 *   triage list [--status <s>] [--state <path>]
 *
 * WHAT IT DOES. A visit hands in this run's raw violations and the checks (rules) that were switched on. The verb
 * turns them into candidates and decides what is new, what is known and what is gone. It does not cap or quarantine
 * noisy rules (noise-ledger) nor cluster by rule+files (cluster); it owns identity across runs and the issue lifecycle.
 * It has no network and no model; the caller syncs `raise`, `recurred` and `closed` to its own tracker.
 *
 * VISIT INPUT  { scopes?: string[], enabled: string[], violations: [{ scope, rule, source: "auto"|"agent",
 *               element?: string, location?: string|{file,line}, detail?: string }] }
 *   A scope is whatever was looked at: a file, module, command or page. `scopes` lists every scope visited this run
 *   (a clean scope has no violations, so it must be named); scopes of violations count as visited too. `enabled` lists
 *   the rules whose check ran this visit (a rule that fired counts as enabled).
 *
 * IDENTITY. All violations of one rule on one scope merge into ONE candidate listing the affected elements. A
 * candidate has a fingerprint: first 16 hex of sha256 over scope, rule and the sorted unique sha256 hex of each
 * element signature, joined by newlines. It is stored with the set of those hashes (its members): members are 64-hex
 * sha256 values, never readable signatures; readable `elements` appear only in the visit report (list shows hashes
 * only). Fingerprints from ledgers written before members were hashed (commit d13d8a5) differ from the same finding
 * now; matching after migration still goes by member overlap, so decisions and issue refs carry over. Later sightings of the same
 * scope+rule that share at least one member are the SAME record, so fixing or adding one element of eleven does not
 * change identity; members are unioned. Preferred over a fixed record when both match.
 * NORMALISATION of an element signature (detail never takes part):
 *   element string  → NFKC, lower case, whitespace runs to one space, `:nth-child(n)`/`:nth-of-type(n)` and `[n]`
 *                     indexes removed, digit runs of 4+ and hex runs of 8+ replaced by `#`.
 *   location        → `file:L<bucket>` where file has `\` turned to `/` and a leading `./` dropped, and
 *                     bucket = floor((line-1)/20): a shift inside a 20-line bucket keeps identity (a shift across
 *                     the boundary does not). Column is ignored. An element, when given, wins over a location.
 *   neither         → `*` (the whole scope). Scope: trimmed, `\` to `/`, leading `./` dropped.
 *
 * LIFECYCLE of a record: new → (decide) filed | dismissed | accepted; absence closing sets fixed.
 *   - dismissed / accepted: never raised again (listed in `skipped`), never closed by absence.
 *   - filed: a sighting adds one occurrence at most once per session id (`recurred`, `counted` says if it did).
 *   - undecided (raised, no decision yet): raised again each visit (`pending`) until decided; one occurrence per session.
 *   - fixed: a new sighting reopens it (`raise` with status `reopened` and the old issue ref).
 *   ABSENCE: for each scope visited, a not-decided, not-fixed record whose rule was enabled and none of whose members
 *   fired gets absent_visits+1; at 3 it becomes fixed and is listed in `closed`. Any sighting resets the count. A rule
 *   that was not enabled gives no evidence: the count stays and the record is in `skipped` (check_not_enabled).
 *   A record that ever had an agent-sourced violation never auto-closes (skipped, agent_sourced). The same session id
 *   visiting the same scope again does not advance absence.
 *
 * STATE  default `.claude/kit/triage.json`, `--state` overrides (relative to cwd). Written by temp file + rename; a
 * visit validates all input before changing anything. visit and decide hold the shared state lock (./state-lock.js: `<state>.lock`, heartbeat while
 * the work runs, bounded wait) across load..save, so parallel writers all keep their writes; list reads without a lock. A leading UTF-8 BOM in input and state is ignored.
 * With the optional SQLite store (./store.js, `db init`) the records and scopes live in the `triage` and `triage_scopes`
 * tables, keyed by the state path as the stream (so per-stream `--state` files stay apart in one database; a state not
 * in the database yet is read from its file), each visit or decide in one BEGIN IMMEDIATE transaction; flags, output
 * and exit codes are the same as on the JSON file (the symbolic-link refusal of the default path included).
 * Exit codes: 0 done, 1 invalid input or corrupt state, 2 refused: the default state path goes through a symbolic link.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { readJsonState, writeJsonAtomic } from './state-lock.js';
import { readDoc, updateDoc } from './store.js';

export const verb = 'triage';
export const usage = 'cli.js triage visit --session <id> [--in <file>] [--state <path>]  |  triage decide <fingerprint> --as filed|dismissed|accepted [--issue <ref>]  |  triage list [--status <s>]   '
  + '(findings keep one identity across runs: violations of one rule on one scope merge into a candidate with a fingerprint; decided ones are not raised again, filed ones count one occurrence per session, '
  + 'issues raised only by automatic checks close after 3 consecutive visits with no sighting; stdin/--in JSON {scopes?,enabled,violations:[{scope,rule,source:"auto"|"agent",element?,location?,detail?}]}; '
  + 'state default .claude/kit/triage.json; fingerprint and members are sha256 hashes of the element signatures, readable elements appear only in the visit report; output raise/recurred/closed/skipped for the caller to sync; exit 0 done, 1 invalid input or corrupt state, 2 refused: the default state path goes through a symbolic link)';

export const LINE_BUCKET = 20;
export const CLOSE_AFTER = 3;
export const DEFAULT_STATE = '.claude/kit/triage.json';
const STATUSES = ['new', 'filed', 'dismissed', 'accepted', 'fixed'];
const DECISIONS = ['filed', 'dismissed', 'accepted'];
const MAX_VIOLATIONS = 20000;
const MAX_LISTED = 100;
const MAX_SESSIONS = 50;
const invalid = (m) => new KitExit(m, 1);
const stripBom = (t) => (t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t);

// ================================================================ identity

export function normalizeScope(s) {
  return String(s).trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

function normalizeText(s) {
  return String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/:nth-(?:child|of-type|last-child)\([^)]*\)/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/[0-9a-f]{8,}/g, '#')
    .replace(/\d{4,}/g, '#');
}

function locationParts(loc) {
  if (typeof loc === 'string') {
    const m = /^(.*?):(\d+)(?::\d+)?$/.exec(loc.trim());
    return m ? { file: m[1], line: Number(m[2]) } : { file: loc.trim(), line: null };
  }
  return { file: String(loc.file ?? ''), line: loc.line == null ? null : Number(loc.line) };
}

/** Element signature of one violation (`{element?, location?}`); see NORMALISATION in the header. */
export function normalizeElement(v) {
  if (typeof v.element === 'string' && v.element.trim()) return normalizeText(v.element);
  if (v.location != null) {
    const { file, line } = locationParts(v.location);
    const f = normalizeScope(file);
    return line == null || !Number.isFinite(line) ? `${f}:` : `${f}:L${Math.floor((Math.max(line, 1) - 1) / LINE_BUCKET)}`;
  }
  return '*';
}

/** Members are stored as hashes: matching needs only equality, and element text may carry a secret. */
const HASH_RE = /^[0-9a-f]{64}$/;
const sigHash = (sig) => crypto.createHash('sha256').update(String(sig)).digest('hex');

export function fingerprintOf(scope, rule, sigs) {
  const uniq = [...new Set(sigs)].sort();
  return crypto.createHash('sha256').update([scope, rule, ...uniq].join('\n')).digest('hex').slice(0, 16);
}

// ================================================================ state

const emptyState = () => ({ version: 1, records: {}, scopes: {} });

function validateState(s) {
  const bad = (m) => { throw invalid(`triage state is corrupt: ${m}`); };
  if (!s || typeof s !== 'object' || Array.isArray(s)) bad('not an object');
  if (s.version !== 1) bad(`unsupported version ${JSON.stringify(s.version)}`);
  if (!s.records || typeof s.records !== 'object' || Array.isArray(s.records)) bad('records is not an object');
  if (!s.scopes || typeof s.scopes !== 'object' || Array.isArray(s.scopes)) bad('scopes is not an object');
  for (const [fp, r] of Object.entries(s.records)) {
    if (!r || typeof r !== 'object' || r.fingerprint !== fp) bad(`record ${fp}`);
    if (!STATUSES.includes(r.status)) bad(`record ${fp} has status ${JSON.stringify(r.status)}`);
    if (typeof r.scope !== 'string' || typeof r.rule !== 'string') bad(`record ${fp} lacks scope or rule`);
    if (!Array.isArray(r.members) || !Array.isArray(r.sessions)) bad(`record ${fp} lacks members or sessions`);
    if (!Number.isInteger(r.absent_visits) || !Number.isInteger(r.occurrences)) bad(`record ${fp} has bad counters`);
  }
  for (const [k, e] of Object.entries(s.scopes)) if (!e || !Array.isArray(e.sessions)) bad(`scope ${k}`);
  return s;
}

/** Load and check the state. `read(opts)` is the store's reader (./store.js); the JSON file when not given. */
export async function loadState(file, read = (opts) => readJsonState(file, opts)) {
  let parsed;
  try { parsed = await read({ fallback: null }); } catch (e) {
    // the store's own errors (drift, no SQLite engine, no suite.db, an untrusted database) are not the file's: as they are
    if (e instanceof KitExit && e.store) throw e;
    if (e instanceof KitExit) throw invalid(`triage state ${file} is corrupt or unreadable: ${e.message}`);
    throw e;
  }
  if (parsed === null) return emptyState();
  const state = validateState(parsed);
  // a ledger written before members were hashed: hash its plain-text members so they still match; the plain-text members are replaced on disk at the next visit or decide (list only reads)
  for (const r of Object.values(state.records)) r.members = [...new Set(r.members.map((m) => (typeof m === 'string' && HASH_RE.test(m) ? m : sigHash(m))))].sort();
  return state;
}

/** The default state path must not lead out of the working tree through a link: refuse a symlink at .claude, .claude/kit or the file. */
async function guardDefaultState(cwd) {
  let cur = path.resolve(cwd);
  for (const part of ['.claude', 'kit', 'triage.json']) {
    cur = path.join(cur, part);
    let st;
    try { st = await fs.lstat(cur); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return; throw invalid(`cannot look at ${cur}: ${e.message}`); }
    if (st.isSymbolicLink()) throw new KitExit(`refusing the default triage state: ${cur} is a symbolic link (pass --state to choose a file on purpose)`, 2);
  }
}

export async function saveState(file, state, write = (v) => writeJsonAtomic(file, v)) {
  try { await write(state); } catch (e) {
    if (e instanceof KitExit) throw invalid(`cannot write triage state ${file}: ${e.message}`);
    throw e;
  }
}

// ================================================================ visit

const str = (x) => typeof x === 'string' && x.trim() !== '';

export function validateVisitInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('visit input must be a JSON object');
  if (!Array.isArray(input.enabled) || !input.enabled.every(str)) throw invalid('"enabled" must be an array of rule names (it may be empty)');
  const violations = input.violations ?? [];
  if (!Array.isArray(violations)) throw invalid('"violations" must be an array');
  if (violations.length > MAX_VIOLATIONS) throw invalid(`too many violations (max ${MAX_VIOLATIONS})`);
  const scopes = input.scopes ?? [];
  if (!Array.isArray(scopes) || !scopes.every(str)) throw invalid('"scopes" must be an array of non-empty strings');
  if (!scopes.length && !violations.length) throw invalid('give "scopes" and/or "violations": a visit must name what was visited');
  violations.forEach((x, i) => {
    const at = `violations[${i}]`;
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw invalid(`${at} must be an object`);
    if (!str(x.scope)) throw invalid(`${at}.scope must be a non-empty string`);
    if (!str(x.rule)) throw invalid(`${at}.rule must be a non-empty string`);
    if (x.source !== 'auto' && x.source !== 'agent') throw invalid(`${at}.source must be "auto" or "agent"`);
    if (x.element != null && typeof x.element !== 'string') throw invalid(`${at}.element must be a string`);
    if (x.detail != null && typeof x.detail !== 'string') throw invalid(`${at}.detail must be a string`);
    if (x.location != null) {
      const l = x.location;
      const ok = typeof l === 'string' || (l && typeof l === 'object' && !Array.isArray(l) && typeof l.file === 'string' && (l.line == null || Number.isFinite(Number(l.line))));
      if (!ok) throw invalid(`${at}.location must be "file:line" or {file,line}`);
    }
  });
  return { scopes: scopes.map(normalizeScope), enabled: new Set(input.enabled.map((r) => r.trim())), violations };
}

function candidatesOf(violations) {
  const map = new Map();
  for (const x of violations) {
    const scope = normalizeScope(x.scope);
    const rule = x.rule.trim();
    const key = `${scope}\0${rule}`;
    if (!map.has(key)) map.set(key, { scope, rule, sigs: new Set(), labels: new Set(), details: new Set(), sources: new Set(), count: 0 });
    const c = map.get(key);
    c.count++;
    c.sigs.add(sigHash(normalizeElement(x)));
    const label = typeof x.element === 'string' && x.element.trim() ? x.element.trim()
      : x.location != null ? (typeof x.location === 'string' ? x.location.trim() : `${x.location.file}${x.location.line != null ? `:${x.location.line}` : ''}`) : '(scope)';
    c.labels.add(label);
    if (x.detail) c.details.add(x.detail);
    c.sources.add(x.source);
  }
  return [...map.values()].sort((a, b) => (a.scope + '\0' + a.rule < b.scope + '\0' + b.rule ? -1 : 1));
}

const capped = (set) => {
  const all = [...set].sort();
  return { list: all.slice(0, MAX_LISTED), omitted: Math.max(0, all.length - MAX_LISTED) };
};

function pushSession(list, id) {
  list.push(id);
  if (list.length > MAX_SESSIONS) list.splice(0, list.length - MAX_SESSIONS);
}

/** Pure core: `visit(state, session, input)` mutates `state` and returns the report. Input must be validated. */
export function visit(state, session, { scopes, enabled, violations }) {
  const out = { raise: [], recurred: [], closed: [], skipped: [] };
  const touched = new Set();
  const visited = new Set(scopes);
  const cands = candidatesOf(violations);
  for (const c of cands) { visited.add(c.scope); enabled.add(c.rule); }
  const info = (r) => ({ fingerprint: r.fingerprint, scope: r.scope, rule: r.rule });
  // scope names are arbitrary text ('constructor', '__proto__'): keep them as own keys of a null-prototype object
  state.scopes = Object.assign(Object.create(null), state.scopes);
  // records indexed once per visit: by scope+rule (matching) and by scope (absence)
  const byScopeRule = new Map();
  const byScope = new Map();
  const index = (r) => {
    const k = `${r.scope}\0${r.rule}`;
    if (!byScopeRule.has(k)) byScopeRule.set(k, []);
    byScopeRule.get(k).push(r);
    if (!byScope.has(r.scope)) byScope.set(r.scope, []);
    byScope.get(r.scope).push(r);
  };
  for (const r of Object.values(state.records)) index(r);

  for (const c of cands) {
    // find the record: same scope+rule, sharing a member; a live one before a fixed one, then most overlap, then oldest
    let best = null;
    let bestScore = null;
    const others = [];
    for (const r of byScopeRule.get(`${c.scope}\0${c.rule}`) || []) {
      const overlap = r.members.filter((m) => c.sigs.has(m)).length;
      if (!overlap) continue;
      others.push(r);
      const score = [r.status === 'fixed' ? 0 : 1, overlap];
      if (!bestScore || score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) { best = r; bestScore = score; }
    }
    const els = capped(c.labels);
    const base = { scope: c.scope, rule: c.rule, count: c.count, elements: els.list, elements_omitted: els.omitted, sources: [...c.sources].sort(), details: capped(c.details).list.slice(0, 5) };
    let rec = best;
    let status;
    // every other live record that shares a member also fired: it is sighted, not absent
    const secondary = others.filter((r) => r !== best && r.status !== 'fixed');
    if (!rec) {
      const fp = fingerprintOf(c.scope, c.rule, [...c.sigs]);
      rec = { fingerprint: fp, scope: c.scope, rule: c.rule, status: 'new', issue: null, members: [], agent: false, absent_visits: 0, occurrences: 0, sessions: [], first_session: session };
      state.records[fp] = rec;
      index(rec);
      status = 'new';
    } else if (rec.status === 'fixed') {
      status = 'reopened';
      rec.status = rec.issue ? 'filed' : 'new';
    } else status = rec.status === 'new' ? 'pending' : rec.status;
    rec.members = [...new Set([...rec.members, ...c.sigs])].sort();
    if (c.sources.has('agent')) rec.agent = true;
    rec.absent_visits = 0;
    rec.last_session = session;
    touched.add(rec.fingerprint);
    report(rec, status);
    for (const o of secondary) {
      if (c.sources.has('agent')) o.agent = true;
      o.absent_visits = 0;
      o.last_session = session;
      touched.add(o.fingerprint);
      report(o, o.status === 'new' ? 'pending' : o.status);
    }

    function report(rec, status) {
      const counted = !rec.sessions.includes(session);
      if (counted) { rec.occurrences++; pushSession(rec.sessions, session); }
      if (rec.status === 'dismissed' || rec.status === 'accepted') {
        out.skipped.push({ ...info(rec), reason: `decided:${rec.status}` });
      } else if (rec.status === 'filed' && status !== 'reopened') {
        out.recurred.push({ ...info(rec), issue: rec.issue, occurrences: rec.occurrences, counted, ...base });
      } else {
        out.raise.push({ fingerprint: rec.fingerprint, status, ...(status === 'reopened' && rec.issue ? { issue: rec.issue } : {}), occurrences: rec.occurrences, ...base });
      }
    }
  }

  // absence, per scope visited
  for (const scope of [...visited].sort()) {
    const sc = state.scopes[scope] || (state.scopes[scope] = { sessions: [] });
    const replay = sc.sessions.includes(session);
    if (!replay) pushSession(sc.sessions, session);
    for (const r of byScope.get(scope) || []) {
      if (touched.has(r.fingerprint)) continue;
      if (r.status !== 'new' && r.status !== 'filed') continue;
      if (r.agent) { out.skipped.push({ ...info(r), reason: 'agent_sourced' }); continue; }
      if (!enabled.has(r.rule)) { out.skipped.push({ ...info(r), reason: 'check_not_enabled' }); continue; }
      if (replay) continue;
      r.absent_visits++;
      if (r.absent_visits >= CLOSE_AFTER) {
        r.status = 'fixed';
        r.closed_session = session;
        out.closed.push({ ...info(r), issue: r.issue, absent_visits: r.absent_visits });
      }
    }
  }
  const key = (x) => x.fingerprint;
  for (const k of ['raise', 'recurred', 'closed', 'skipped']) out[k].sort((a, b) => (key(a) < key(b) ? -1 : 1));
  return out;
}

// ================================================================ decide

export function decide(state, fp, as, issue) {
  const hits = Object.keys(state.records).filter((k) => k === fp || (fp.length >= 6 && k.startsWith(fp)));
  const exact = hits.includes(fp) ? [fp] : hits;
  if (exact.length === 0) throw invalid(`no record with fingerprint ${fp}`);
  if (exact.length > 1) throw invalid(`fingerprint prefix ${fp} is ambiguous (${exact.length} records)`);
  const r = state.records[exact[0]];
  r.status = as;
  if (as === 'filed') { if (issue) r.issue = issue; r.absent_visits = 0; }
  return { fingerprint: r.fingerprint, scope: r.scope, rule: r.rule, status: r.status, issue: r.issue };
}

// ================================================================ CLI

function parse(args, valueFlags, positional) {
  const f = { pos: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') { f.help = true; continue; }
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!valueFlags.includes(name)) throw invalid(`unknown flag ${a} (see --help)`);
      if (i + 1 >= args.length) throw invalid(`--${name} needs a value (see --help)`);
      f[name] = args[++i];
      continue;
    }
    if (positional) f.pos.push(a);
    else throw invalid(`unexpected argument ${a} (see --help)`);
  }
  return f;
}

async function readInput(f, io, cwd) {
  let text;
  if (f.in !== undefined) {
    try { text = await fs.readFile(path.resolve(cwd, f.in), 'utf-8'); } catch (e) { throw invalid(`cannot read ${f.in}: ${e.message}`); }
  } else {
    if (io.stdinIsTTY) throw invalid('give the visit as JSON on stdin or with --in <file>');
    text = await io.stdin();
  }
  try { return JSON.parse(stripBom(text)); } catch { throw invalid('visit input is not valid JSON'); }
}

export async function run(args, io = {}) {
  const cwd = io.cwd || process.cwd();
  const [sub, ...rest] = args;
  if (sub === undefined || sub === '--help' || sub === '-h') {
    if (sub === undefined) throw invalid('give a subcommand: visit, decide or list (see --help)');
    return { usage };
  }
  const stateFile = async (f) => {
    if (f.state === undefined || f.state === '') await guardDefaultState(cwd);
    return path.resolve(cwd, f.state || DEFAULT_STATE);
  };
  if (sub === 'visit') {
    const f = parse(rest, ['session', 'in', 'state'], false);
    if (f.help) return { usage };
    if (!str(f.session)) throw invalid('--session <id> is required');
    const input = validateVisitInput(await readInput(f, io, cwd));
    const file = await stateFile(f);
    const report = await updateDoc(io, 'triage', file, async ({ load, save }) => {
      const state = await loadState(file, load);
      const rep = visit(state, f.session.trim(), input);
      await saveState(file, state, save);
      return rep;
    }, io.lockOpts);
    return { session: f.session.trim(), scopes_visited: [...new Set([...input.scopes, ...input.violations.map((x) => normalizeScope(x.scope))])].sort(), ...report, state: file };
  }
  if (sub === 'decide') {
    const f = parse(rest, ['as', 'issue', 'state'], true);
    if (f.help) return { usage };
    if (f.pos.length !== 1) throw invalid('give exactly one fingerprint (see --help)');
    if (!DECISIONS.includes(f.as)) throw invalid('--as must be filed, dismissed or accepted');
    if (f.issue !== undefined && f.as !== 'filed') throw invalid('--issue only goes with --as filed');
    if (f.issue !== undefined && !str(f.issue)) throw invalid('--issue needs a reference');
    const file = await stateFile(f);
    return updateDoc(io, 'triage', file, async ({ load, save }) => {
      const state = await loadState(file, load);
      const res = decide(state, f.pos[0], f.as, f.issue && f.issue.trim());
      await saveState(file, state, save);
      return res;
    }, io.lockOpts);
  }
  if (sub === 'list') {
    const f = parse(rest, ['status', 'state'], false);
    if (f.help) return { usage };
    if (f.status !== undefined && !STATUSES.includes(f.status)) throw invalid(`--status must be one of ${STATUSES.join(', ')}`);
    const file = await stateFile(f);
    const state = await loadState(file, (opts) => readDoc(io, 'triage', file, opts));
    const records = Object.values(state.records).filter((r) => !f.status || r.status === f.status)
      .map((r) => ({ fingerprint: r.fingerprint, scope: r.scope, rule: r.rule, status: r.status, issue: r.issue, occurrences: r.occurrences, absent_visits: r.absent_visits, agent_sourced: !!r.agent, members: r.members }))
      .sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
    return { records };
  }
  throw invalid(`unknown subcommand ${sub} (visit, decide, list)`);
}
