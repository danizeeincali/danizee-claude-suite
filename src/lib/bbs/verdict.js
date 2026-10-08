/**
 * bbs verdict — which verdicts are legal for each power (licence policy, harness judgment, sandbox check, network probe),
 * the default, one table, and the recorded decisions with their labels (approve = 1, skip = 0).
 * Two rules cannot change: safety first; our rules always win. `use` is never a default and is never legal
 * without a permissive licence, a sandbox on this machine and a clean network probe.
 */

import path from 'path';
import { spawnSync } from 'child_process';
import { DEFAULT_CONFIG, LICENCE_CLASSES } from './config.js';
import { runDir as runDirOf, readJson, writeJson, appendJsonl, appendRegistry } from './store.js';
import { RUN_ID, invalidRunId, redactUrlsInText } from './intake.js';
import { parseJsonOnly } from './inventory.js';
import { withMapLockDetailed } from './harness-map.js';
import { renderStatusSafe } from './status.js';

export const VERDICTS = ['rebuild', 'use', 'buy', 'skip'];
export const PROBES = ['clean', 'found', 'incomplete'];

/** A verdict our policy does not allow: the CLI exits 2 with `bbs: refused: <message>`. */
export class PolicyRefused extends Error {
  constructor(message) { super(message); this.name = 'PolicyRefused'; this.code = 'POLICY_REFUSED'; }
}

// ---------------------------------------------------------------------------------------------------------------
// Licence classes

const VERSION_SUFFIX = /-\d[\d.]*(-only|-or-later)?$/i;
const family = (id) => id.replace(/\+$/, '').replace(VERSION_SUFFIX, '').toLowerCase();
const PERMISSIVENESS = ['permissive', 'copyleft', 'commercial']; // most permissive first (none ranks below all)
const RESTRICTIVENESS = ['commercial', 'copyleft', 'none', 'permissive']; // most restrictive first

function classifyOne(id, cfg) {
  const s = id.trim();
  if (!s || s.toLowerCase() === 'unknown') return 'none';
  if (/all[\s-]+rights[\s-]+reserved/i.test(s)) return 'commercial';
  const lists = cfg?.licences || DEFAULT_CONFIG.licences;
  const lower = s.toLowerCase();
  // Restrictive classes first: an id configured in two classes counts as the stricter one.
  const order = ['commercial', 'copyleft', 'permissive'];
  for (const cls of order) {
    if ((lists[cls] || []).some(x => typeof x === 'string' && x.toLowerCase() === lower)) return cls;
  }
  const fam = family(s);
  if (!fam) return 'none';
  for (const cls of order) {
    if ((lists[cls] || []).some(x => typeof x === 'string' && family(x) === fam)) return cls;
  }
  return 'none';
}

const SPDX_ID = /^[A-Za-z0-9.+-]+$/;
const SPDX_KEYWORD = /^(and|or|with)$/i;

/** Tokens of an SPDX expression: '(' | ')' | words. Null when a word holds a character SPDX ids never use. */
function spdxTokens(text) {
  const tokens = text.replace(/[()]/g, ' $& ').split(/\s+/).filter(Boolean);
  return tokens.every(t => t === '(' || t === ')' || SPDX_ID.test(t)) ? tokens : null;
}

/**
 * Recursive descent over `expr := and ( OR and )*`, `and := atom ( AND atom )*`,
 * `atom := '(' expr ')' | ID [ WITH ID ]` — AND binds tighter than OR, parentheses group, a WITH exception is ignored.
 * Evaluates while parsing:
 *   OR  → the most permissive part (permissive > copyleft > commercial); none parts are ignored unless every part is none.
 *   AND → the most restrictive part (commercial > copyleft > none > permissive): every term binds, so a copyleft or
 *         commercial part wins, and an unknown (none) part beside only permissive parts makes the whole AND none.
 * Throws on any parse error (unbalanced parentheses, a dangling operator, two ids in a row).
 */
function evalSpdx(tokens, cfg) {
  let i = 0;
  const peek = () => tokens[i];
  const isKw = (t, kw) => typeof t === 'string' && t.toLowerCase() === kw;
  const expect = (cond, what) => { if (!cond) throw new Error(`SPDX parse error: ${what} at token ${i}`); };
  function atom() {
    const t = peek();
    expect(t !== undefined, 'unexpected end');
    if (t === '(') {
      i++;
      const v = expr();
      expect(peek() === ')', 'missing )');
      i++;
      return v;
    }
    expect(t !== ')' && !SPDX_KEYWORD.test(t), `unexpected ${JSON.stringify(t)}`);
    i++;
    if (isKw(peek(), 'with')) {
      i++;
      const ex = peek();
      expect(ex !== undefined && ex !== '(' && ex !== ')' && !SPDX_KEYWORD.test(ex), 'WITH needs an exception id');
      i++;
    }
    return classifyOne(t, cfg);
  }
  function and() {
    const parts = [atom()];
    while (isKw(peek(), 'and')) { i++; parts.push(atom()); }
    return RESTRICTIVENESS.find(c => parts.includes(c));
  }
  function expr() {
    const parts = [and()];
    while (isKw(peek(), 'or')) { i++; parts.push(and()); }
    return PERMISSIVENESS.find(c => parts.includes(c)) ?? 'none';
  }
  const v = expr();
  expect(i === tokens.length, `unexpected ${JSON.stringify(peek())}`);
  return v;
}

/** Classify an SPDX licence expression: permissive | copyleft | commercial | none (unparseable or unrecognised → none). */
export function licenceClass(licence, cfg = DEFAULT_CONFIG) {
  if (typeof licence !== 'string') return 'none';
  const text = licence.trim();
  if (!text || text.toLowerCase() === 'unknown') return 'none';
  if (/all[\s-]+rights[\s-]+reserved/i.test(text)) return 'commercial'; // anywhere in the string: the whole licence is commercial
  const tokens = spdxTokens(text);
  if (!tokens) return 'none';
  try { return evalSpdx(tokens, cfg); } catch { return 'none'; }
}

// ---------------------------------------------------------------------------------------------------------------
// Sandbox detection (the only subprocess in this step; nothing here runs a sandbox)

const SANDBOX_TIMEOUT_MS = 5000;

function defaultExec(cmd, args) {
  const r = spawnSync(cmd, args, { timeout: SANDBOX_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' });
  if (r.error) throw r.error;
  return { status: r.status, stderr: r.stderr };
}

const firstLine = (s) => String(s ?? '').split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';

/** Run exec and normalise the outcome to { ok, code, status, stderr }. */
function probeCommand(exec, cmd, args) {
  try {
    const r = exec(cmd, args) || {};
    return { ok: r.status === 0, status: r.status, stderr: r.stderr };
  } catch (err) {
    return { ok: false, code: err?.code, status: typeof err?.status === 'number' ? err.status : undefined, stderr: err?.stderr, message: err?.message };
  }
}

export async function detectSandbox({ exec = defaultExec, platform = process.platform } = {}) {
  const docker = probeCommand(exec, 'docker', ['info']);
  if (docker.ok) return { present: true, kind: 'docker', reason: 'docker info succeeded' };
  let dockerWhy;
  if (docker.code === 'ENOENT') dockerWhy = 'docker is not installed';
  else if (docker.code === 'ETIMEDOUT') dockerWhy = `docker info timed out (${SANDBOX_TIMEOUT_MS / 1000} s timeout)`;
  else if (typeof docker.status === 'number') {
    const line = firstLine(Buffer.isBuffer(docker.stderr) ? docker.stderr.toString('utf-8') : docker.stderr);
    dockerWhy = `docker is not running${line ? ` (${line})` : ''}`;
  } else dockerWhy = `docker info failed (${docker.code || docker.message || 'unknown error'})`;

  let unshareWhy;
  if (platform === 'linux') {
    const u = probeCommand(exec, 'unshare', ['--user', '--map-root-user', 'true']);
    if (u.ok) return { present: true, kind: 'unshare', reason: 'unshare is available' };
    unshareWhy = 'unshare is unavailable';
  } else {
    unshareWhy = 'unshare only counts on linux';
  }
  return { present: false, kind: null, reason: `no sandbox on this machine: ${dockerWhy} and ${unshareWhy}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Policy

const OFF_MACHINE = /off|external|cloud|saas|vendor|upload|remote|third[- ]party/i;

/** A power that sends our data out of the machine (a free service is still a buy memo). */
function movesDataOff(power) {
  return power?.network === 'outbound' && typeof power.data_needed === 'string' && OFF_MACHINE.test(power.data_needed);
}

const PROBE_REASON = {
  found: 'network probe found: the source makes a network call the inventory does not account for',
  incomplete: 'network probe incomplete: a hidden network call cannot be ruled out'
};

/**
 * `use` always requires a present sandbox: safety first, our rules always win. There is no option to turn this off;
 * a `sandbox.required_for_use: false` in .claude/bbs.json is ignored with a warning (sandboxConfigWarnings).
 */
export function legalVerdicts(power, { judgment, licenceClass: cls, sandbox, probe } = {}) {
  if (!LICENCE_CLASSES.includes(cls)) {
    throw new Error(`licence class must be one of ${LICENCE_CLASSES.join('|')}, got ${JSON.stringify(cls)}`);
  }
  if (probe != null && !PROBES.includes(probe)) {
    throw new Error(`probe must be one of ${PROBES.join('|')} or null, got ${JSON.stringify(probe)}`);
  }
  void judgment; // the judgment shapes the default, not what is legal
  const allowed = new Set(['rebuild', 'skip']);
  const removed = [];
  if (cls === 'commercial' || movesDataOff(power)) allowed.add('buy');
  if (cls === 'permissive') {
    const why = [];
    if (!sandbox?.present) why.push(sandbox?.reason || 'no sandbox on this machine: the sandbox check did not run');
    if (probe === 'found' || probe === 'incomplete') why.push(PROBE_REASON[probe]);
    if (why.length) removed.push({ verdict: 'use', reason: why.join('; ') });
    else allowed.add('use');
  } else {
    removed.push({ verdict: 'use', reason: `licence ${cls} — use is legal only for a permissive licence` });
  }
  const legal = VERDICTS.filter(v => allowed.has(v));
  return { legal, removed, needs_probe: legal.includes('use') && probe == null };
}

export function defaultVerdict(power, opts = {}) {
  const { legal } = legalVerdicts(power, opts);
  let pick;
  if (opts.judgment?.status === 'have') pick = 'skip';
  else if (opts.licenceClass === 'commercial' || movesDataOff(power)) pick = 'buy';
  else pick = 'rebuild';
  if (legal.includes(pick)) return pick;
  return legal.find(v => v !== 'use') ?? 'skip';
}

// ---------------------------------------------------------------------------------------------------------------
// Table

const cell = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');

function harnessCell(judgment) {
  const status = judgment?.status || 'unjudged';
  if ((status === 'have' || status === 'partial') && typeof judgment.tool === 'string' && judgment.tool) {
    const p = judgment.tool.replace(/^[a-z]+:/, '');
    return `${status} (${path.posix.basename(p.split(path.sep).join('/'))})`;
  }
  return status;
}

export function verdictTable(rows) {
  const lines = ['| Power | Harness | Licence | Legal | Default | Decision | Why |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const [name, r] of Object.entries(rows || {})) {
    const why = (r.removed || []).map(x => `${x.verdict} removed: ${x.reason}`).join('; ');
    lines.push(`| ${[name, harnessCell(r.judgment), `${r.licence ?? 'unknown'} (${r.licence_class ?? 'none'})`,
      (r.legal || []).join(', '), r.default ?? '', r.decision || '—', why].map(cell).join(' | ')} |`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Run files

function runPaths(projectDir, run, cfg) {
  if (typeof run !== 'string' || !RUN_ID.test(run)) throw new Error(invalidRunId(run));
  const dir = runDirOf(projectDir, run, cfg);
  return { dir, verdicts: path.join(dir, 'verdicts.json'), labels: path.join(dir, 'labels.jsonl') };
}

/** Re-render status.md after verdicts.json is committed; never throws. */
async function renderAfterCommit(dir) {
  try {
    const { writeError } = await renderStatusSafe(dir);
    if (writeError) return { warning: `verdicts.json written but status.md could not be written: ${writeError.message}` };
    return { warning: null };
  } catch (err) {
    const m = /corrupt JSON in (.+?): /.exec(err.message);
    const file = err.path ? path.basename(err.path) : m ? path.basename(m[1]) : 'a status input';
    return { warning: `verdicts.json written but ${file} could not be read: ${err.message}`, unread: true };
  }
}

const joinWarnings = (...ws) => ws.filter(Boolean).join('; ') || null;

async function readVerdicts(file) {
  const vj = await readJson(file);
  if (!vj || typeof vj.rows !== 'object' || vj.rows === null) {
    throw new Error('verdicts.json is missing — run cli.js verdict first');
  }
  if (!vj.decisions || typeof vj.decisions !== 'object') vj.decisions = {};
  return vj;
}

/** Recompute legal/removed/needs_probe/default of one row in place; clears a decision the policy no longer allows. */
function recomputeRow(row, power, sandbox) {
  const opts = { judgment: row.judgment, licenceClass: row.licence_class, sandbox, probe: row.probe?.result ?? null };
  const { legal, removed, needs_probe } = legalVerdicts(power, opts);
  row.legal = legal;
  row.removed = removed;
  row.needs_probe = needs_probe;
  row.default = defaultVerdict(power, opts);
  if (row.decision && (!legal.includes(row.decision) || (row.decision === 'use' && needs_probe))) {
    const was = row.decision;
    row.decision = null;
    return `decision ${was} for ${power.name} is no longer legal and was cleared`;
  }
  return null;
}

export const SANDBOX_CONFIG_IGNORED = 'sandbox.required_for_use=false in .claude/bbs.json is ignored — use always requires a sandbox';

/** Config settings that try to loosen a rule that cannot change: each is ignored and named in a warning. */
function sandboxConfigWarnings(cfg) {
  return cfg?.sandbox?.required_for_use === false ? [SANDBOX_CONFIG_IGNORED] : [];
}

export const EVIDENCE_MAX_CHARS = 2048;
const EVIDENCE_TRUNCATED = ' …[truncated]';

/**
 * Probe evidence as stored and printed: a string with control characters stripped (newlines kept), every http(s) URL
 * redacted with intake's redactRef, then capped at EVIDENCE_MAX_CHARS. Redaction runs before the cap so a URL cut at
 * the cap can never expose credentials the full URL would have had masked. Empty → null.
 */
export function sanitizeEvidence(text) {
  if (text == null) return null;
  const clean = String(text).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '');
  if (!clean.trim()) return null;
  const red = redactUrlsInText(clean);
  return red.length > EVIDENCE_MAX_CHARS ? red.slice(0, EVIDENCE_MAX_CHARS) + EVIDENCE_TRUNCATED : red;
}

const nextOf = (rows, unread) => unread ? null : Object.values(rows).every(r => r.decision) ? 'handoff' : 'verdict';

export async function computeVerdicts(projectDir, { run, sandbox, now = () => new Date(), force = false, cfg = DEFAULT_CONFIG, exec, lockOpts } = {}) {
  const p = runPaths(projectDir, run, cfg);
  const powers = await readJson(path.join(p.dir, 'powers.json'));
  if (!powers || !Array.isArray(powers.powers)) throw new Error('inventory first — powers.json is missing; run cli.js inventory --from, then cli.js map');
  const sb = sandbox ?? await detectSandbox(exec ? { exec } : {});

  const { result, warning: lockWarning } = await withMapLockDetailed(p.dir, async () => {
    const map = await readJson(path.join(p.dir, 'map.json'));
    if (!map || !map.judgments) throw new Error('map first — map.json is missing; run cli.js map, then cli.js map --from');
    const list = (await readJson(path.join(p.dir, 'powers.json')))?.powers;
    if (!Array.isArray(list)) throw new Error('inventory first — powers.json is missing; run cli.js inventory --from, then cli.js map');
    const missing = list.map(x => x.name).filter(n => !map.judgments[n]);
    if (missing.length) throw new Error(`judgments missing for: ${missing.join(', ')} — record them with cli.js map --from`);
    const source = await readJson(path.join(p.dir, 'source.json'));
    if (!source) throw new Error(`run "${run}" has no source.json — run \`cli.js intake <source>\` first`);

    let existing = null;
    try { existing = await readJson(p.verdicts); }
    catch (err) {
      if (!/^corrupt JSON in /.test(err.message) || !force) throw new Error(`${err.message} — pass --force to rebuild it (probes and decisions are dropped)`);
    }
    const dropped = { probes: 0, decisions: 0 };
    const warnings = sandboxConfigWarnings(cfg);
    const rows = {};
    for (const power of list) {
      const old = existing?.rows?.[power.name];
      const oldDecision = existing?.decisions?.[power.name] ?? old?.decision ?? null;
      const oldProbe = old?.probe && PROBES.includes(old.probe.result) ? old.probe : null;
      if (force) {
        if (oldProbe) dropped.probes++;
        if (oldDecision) dropped.decisions++;
      }
      const row = {
        licence: power.licence ?? 'unknown',
        licence_class: licenceClass(power.licence, cfg),
        judgment: map.judgments[power.name],
        legal: [], default: null, removed: [], needs_probe: false,
        probe: force ? null : oldProbe,
        decision: force ? null : (VERDICTS.includes(oldDecision) ? oldDecision : null)
      };
      const w = recomputeRow(row, power, sb);
      if (w) warnings.push(w);
      rows[power.name] = row;
    }
    const decisions = Object.fromEntries(Object.entries(rows).filter(([, r]) => r.decision).map(([n, r]) => [n, r.decision]));
    // verdicts.json last: it is what marks the step's state
    await writeJson(p.verdicts, { run, source_identity: source.identity, sandbox: sb, rows, decisions, ts: now().toISOString() });
    const { warning, unread } = await renderAfterCommit(p.dir);
    if (warning) warnings.push(warning);
    const w = joinWarnings(...warnings);
    return {
      runId: run,
      sandbox: sb,
      rows,
      table: verdictTable(rows),
      needs_probe: Object.keys(rows).filter(n => rows[n].needs_probe),
      dropped,
      next: nextOf(rows, unread),
      ...(w ? { warning: w, warnings } : {})
    };
  }, lockOpts);
  return withWarning(result, lockWarning);
}

function withWarning(result, extra) {
  if (!extra) return result;
  return { ...result, warning: joinWarnings(result.warning, extra) };
}

async function powersByName(dir) {
  const powers = await readJson(path.join(dir, 'powers.json'));
  if (!powers || !Array.isArray(powers.powers)) throw new Error('inventory first — powers.json is missing');
  return new Map(powers.powers.map(x => [x.name, x]));
}

export async function recordProbe(projectDir, { run, power, result, evidence, now = () => new Date(), force = false, cfg = DEFAULT_CONFIG, lockOpts } = {}) {
  const p = runPaths(projectDir, run, cfg);
  await readVerdicts(p.verdicts); // fail fast, before the lock
  const { result: out, warning: lockWarning } = await withMapLockDetailed(p.dir, async () => {
    const vj = await readVerdicts(p.verdicts);
    if (typeof power !== 'string' || !Object.hasOwn(vj.rows, power)) throw new Error(`unknown power "${power}"`);
    if (!PROBES.includes(result)) throw new Error(`probe result for ${power} must be one of ${PROBES.join('|')}, got ${JSON.stringify(result)}`);
    const row = vj.rows[power];
    if (row.probe && !force) throw new Error(`${power} already probed — pass --force to replace`);
    const byName = await powersByName(p.dir);
    const pw = byName.get(power) || { name: power };
    row.probe = { result, evidence: sanitizeEvidence(evidence), ts: now().toISOString() };
    row.decision = vj.decisions[power] ?? row.decision ?? null;
    const cleared = recomputeRow(row, pw, vj.sandbox);
    if (row.decision) vj.decisions[power] = row.decision; else delete vj.decisions[power];
    vj.ts = now().toISOString();
    await writeJson(p.verdicts, vj);
    const { warning, unread } = await renderAfterCommit(p.dir);
    const w = joinWarnings(...sandboxConfigWarnings(cfg), cleared, warning);
    return { runId: run, power, ...row, next: nextOf(vj.rows, unread), ...(w ? { warning: w } : {}) };
  }, lockOpts);
  return withWarning(out, lockWarning);
}

export async function recordDecisions(projectDir, { run, input, now = () => new Date(), force = false, cfg = DEFAULT_CONFIG, label = 'decisions', lockOpts } = {}) {
  const p = runPaths(projectDir, run, cfg);
  await readVerdicts(p.verdicts);
  const { result: out, warning: lockWarning } = await withMapLockDetailed(p.dir, async () => {
    const vj = await readVerdicts(p.verdicts);
    const names = Object.keys(vj.rows);
    const parsed = parseJsonOnly(input, { label });
    const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const isWrapper = isPlain(parsed) && Object.keys(parsed).length === 1 && Object.hasOwn(parsed, 'decisions')
      && isPlain(parsed.decisions) && !Object.hasOwn(vj.rows, 'decisions');
    const decisions = isWrapper ? parsed.decisions : parsed;
    if (!isPlain(decisions)) throw new Error(`JSON only — ${label} must be an object of power → verdict`);
    if (!Object.keys(decisions).length) throw new Error(`${label} names no power — expected an object of power → verdict`);

    // Validate everything before anything is written.
    for (const [name, v] of Object.entries(decisions)) {
      if (!Object.hasOwn(vj.rows, name)) throw new Error(`unknown power "${name}"`);
      if (!VERDICTS.includes(v)) throw new Error(`${name}: verdict must be one of ${VERDICTS.join('|')}, got ${JSON.stringify(v)}`);
      const row = vj.rows[name];
      if (v === 'use' && row.needs_probe) {
        throw new PolicyRefused(`use needs a clean network probe for ${name} first (cli.js verdict --probe ${name}=clean|found|incomplete)`);
      }
      if (!row.legal.includes(v)) throw new PolicyRefused(`${v} is not legal for ${name}: legal verdicts are ${row.legal.join(', ')}`);
      const had = vj.decisions[name] ?? row.decision;
      if (had && !force) throw new Error(`${name} already decided — pass --force to change it`);
    }

    const ts = now().toISOString();
    for (const [name, v] of Object.entries(decisions)) {
      vj.rows[name].decision = v;
      vj.decisions[name] = v;
    }
    vj.ts = ts;
    await writeJson(p.verdicts, vj);

    // verdicts.json is committed: nothing below may fail the verb
    const warnings = [];
    for (const [name, v] of Object.entries(decisions)) {
      try { await appendJsonl(p.labels, { run, power: name, verdict: v, label: v === 'skip' ? 0 : 1, ts }); }
      catch (err) { warnings.push(`label for ${name} could not be written to labels.jsonl: ${err.message}`); }
    }
    const remaining = names.filter(n => !vj.decisions[n]).sort();
    let registry_written = false;
    if (remaining.length === 0) {
      try {
        const source = await readJson(path.join(p.dir, 'source.json'));
        const ordered = Object.fromEntries(names.map(n => [n, vj.decisions[n]]));
        await appendRegistry(projectDir, { identity: source?.identity, type: source?.type, ref: source?.ref, run, powers: names.length, decisions: ordered, ts }, cfg);
        registry_written = true;
      } catch (err) {
        warnings.push(`registry row could not be written: ${err.message}`);
      }
    }
    const { warning, unread } = await renderAfterCommit(p.dir);
    const w = joinWarnings(...warnings, warning);
    return {
      runId: run,
      decided: names.length - remaining.length,
      remaining,
      next: unread ? null : remaining.length ? 'verdict' : 'handoff',
      registry_written,
      ...(w ? { warning: w } : {})
    };
  }, lockOpts);
  return withWarning(out, lockWarning);
}
