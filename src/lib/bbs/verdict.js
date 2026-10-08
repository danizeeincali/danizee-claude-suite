/**
 * bbs verdict — which verdicts are legal for each power (licence policy, harness judgment, sandbox check, network probe),
 * the default, one table, and the recorded decisions with their labels (approve = 1, skip = 0).
 * Two rules cannot change: safety first; our rules always win. `use` is never a default and is never legal
 * without a permissive licence, a sandbox on this machine and a clean network probe.
 */

import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { DEFAULT_CONFIG, LICENCE_CLASSES } from './config.js';
import { runDir as runDirOf, readJson, readJsonl, writeJson, appendJsonl, appendRegistry, lookupSource, moveAsideStale, withMapLockDetailed } from './store.js';
import { RUN_ID, invalidRunId, redactUrlsInText } from './intake.js';
import { parseJsonOnly } from './inventory.js';
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

/**
 * SPDX exceptions that only grant extra permission: `X WITH <one of these>` keeps the class of X. Matched case-insensitively.
 * Any other exception never makes an expression more permissive than its base (see withException).
 */
export const PERMISSIVE_EXCEPTIONS = ['LLVM-exception', 'Classpath-exception-2.0', 'GCC-exception-2.0', 'GCC-exception-3.1',
  'Autoconf-exception-2.0', 'Autoconf-exception-3.0', 'Bison-exception-2.2', 'Font-exception-2.0', 'OpenJDK-assembly-exception-1.0',
  'Universal-FOSS-exception-1.0', 'Linux-syscall-note', '389-exception', 'WxWindows-exception-3.1', 'mif-exception', 'u-boot-exception-2.0'];
const PERMISSIVE_EXCEPTION_SET = new Set(PERMISSIVE_EXCEPTIONS.map(x => x.toLowerCase()));
const stricter = (a, b) => RESTRICTIVENESS.find(c => c === a || c === b);

/**
 * `base WITH exception`: an allowlisted exception keeps the base class; an exception that is itself a commercial or
 * copyleft licence (Commons-Clause would be, if configured) → the stricter of that and the base; anything else →
 * the stricter of the base and none, so an unknown exception can never leave the expression permissive.
 */
function withException(baseClass, exception, cfg) {
  if (PERMISSIVE_EXCEPTION_SET.has(exception.toLowerCase())) return baseClass;
  const ex = classifyOne(exception, cfg);
  return stricter(baseClass, ex === 'commercial' || ex === 'copyleft' ? ex : 'none');
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
 * `atom := '(' expr ')' | ID [ WITH ID ]` — AND binds tighter than OR, parentheses group, a WITH exception is classified
 * by withException (an allowlisted permission-granting exception keeps the base class; any other never yields permissive).
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
      return withException(classifyOne(t, cfg), ex, cfg);
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
/** The most of a sandbox command's stderr line kept in sandbox.reason (it is stored, repeated in rows and printed). */
export const SANDBOX_STDERR_MAX_CHARS = 200;
const STDERR_TRUNCATED = ' …[truncated]';

/**
 * Run a detection command: nothing is read from stdin, stdout is discarded (piped and returned only with capture: true,
 * for `docker context inspect`), only stderr is kept for the reason. env, when given, replaces the inherited environment.
 */
export function defaultExec(cmd, args, { spawn = spawnSync, env, capture = false } = {}) {
  const opts = { timeout: SANDBOX_TIMEOUT_MS, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'], encoding: 'utf-8' };
  if (env) opts.env = env;
  const r = spawn(cmd, args, opts);
  if (r.error) throw r.error;
  return capture ? { status: r.status, stdout: r.stdout, stderr: r.stderr } : { status: r.status, stderr: r.stderr };
}

/**
 * Stripped from probe evidence (sanitizeEvidence), sandbox stderr lines and docker endpoints: C0/C1 control characters
 * except \n, every Unicode format character (\p{Cf}: bidi overrides and isolates, zero-width characters, BOM) and the
 * line/paragraph separators U+2028/U+2029.
 */
const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]|\p{Cf}/gu;

/** Cut text at max code points (never inside a surrogate pair), appending marker when anything was cut. */
function capCodePoints(text, max, marker) {
  const cps = Array.from(text);
  return cps.length > max ? cps.slice(0, max).join('') + marker : text;
}

/**
 * Where the home directory may appear in a stderr line: os.homedir() (or the injected homedir) and $HOME when different.
 * '/' and '' never count (replacing them would rewrite every path).
 */
function homeDirs({ homedir = os.homedir(), env = process.env } = {}) {
  const out = [];
  for (const h of [homedir, env?.HOME]) {
    if (typeof h !== 'string') continue;
    const t = h.replace(/[\\/]+$/, '');
    if (t.length > 1 && !out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => b.length - a.length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SCHEME_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]*/gi;

/**
 * A stderr line as stored in sandbox.reason: http(s) URLs redacted (redactUrlsInText), the home directory replaced
 * with ~ (only the directory itself, never a prefix of a longer name), and every other <scheme>://… token except a
 * local unix:// or npipe:// socket path cut to scheme + host[:port] by redactDockerEndpoint (userinfo, path and query dropped).
 */
export function sanitizeStderr(line, opts = {}) {
  let t = redactUrlsInText(String(line ?? ''));
  for (const h of homeDirs(opts)) t = t.replace(new RegExp(`${escapeRe(h)}(?=$|[\\/\\s:;,'")\\]]|\\.(?![\\w-]))`, 'g'), '~');
  return t.replace(SCHEME_TOKEN, (tok) => LOCAL_DOCKER.test(tok) ? tok : redactDockerEndpoint(tok));
}

/**
 * First non-blank stderr line, control and format characters stripped, sanitised (sanitizeStderr) and then capped at
 * SANDBOX_STDERR_MAX_CHARS code points — redaction runs before the cap so a cut can never expose what it would have masked.
 */
function stderrLine(stderr, san) {
  const text = Buffer.isBuffer(stderr) ? stderr.toString('utf-8') : String(stderr ?? '');
  const line = text.split(/\r?\n/).map(l => l.replace(CONTROL_CHARS, '').trim()).find(Boolean) || '';
  return capCodePoints(sanitizeStderr(line, san), SANDBOX_STDERR_MAX_CHARS, STDERR_TRUNCATED);
}

/** Run exec and normalise the outcome to { ok, code, status, stderr, stdout }. */
function probeCommand(exec, cmd, args, opts) {
  try {
    const r = (opts ? exec(cmd, args, opts) : exec(cmd, args)) || {};
    return { ok: r.status === 0, status: r.status, stderr: r.stderr, stdout: r.stdout };
  } catch (err) {
    return { ok: false, code: err?.code, status: typeof err?.status === 'number' ? err.status : undefined, stderr: err?.stderr, message: err?.message };
  }
}

const TIMEOUT_TEXT = `${SANDBOX_TIMEOUT_MS / 1000} s timeout`;

function dockerWhy(d, san) {
  if (d.code === 'ENOENT') return 'docker is not installed';
  if (d.code === 'ETIMEDOUT') return `docker info timed out (${TIMEOUT_TEXT})`;
  if (typeof d.status === 'number') {
    const line = stderrLine(d.stderr, san);
    return `docker is not running${line ? ` (${line})` : ''}`;
  }
  return `docker info failed (${d.code || d.message || 'unknown error'})`;
}

/** Why `unshare --user --map-root-user true` did not count; `u` is null off linux (where unshare never counts). */
function unshareWhy(u, san) {
  if (u === null) return 'unshare only counts on linux';
  if (u.code === 'ENOENT') return 'unshare is not installed';
  if (u.code === 'ETIMEDOUT') return `unshare timed out (${TIMEOUT_TEXT})`;
  if (typeof u.status === 'number') {
    const line = stderrLine(u.stderr, san);
    return `unshare refused user namespaces${line ? ` (${line})` : ` (exit ${u.status})`}`;
  }
  return `unshare failed (${u.code || u.message || 'unknown error'})`;
}

const LOCAL_DOCKER = /^(unix|npipe):\/\//i;

/** A docker endpoint as shown in a reason: scheme + host[:port] only; userinfo, path and query are dropped. */
export function redactDockerEndpoint(endpoint) {
  const text = String(endpoint ?? '').replace(CONTROL_CHARS, '').trim();
  const m = /^([a-z][a-z0-9+.-]*:\/\/)?([^/?#]*)/i.exec(text);
  let authority = m[2];
  const at = authority.lastIndexOf('@');
  if (at >= 0) authority = authority.slice(at + 1);
  return capCodePoints((m[1] || '') + authority, SANDBOX_STDERR_MAX_CHARS, STDERR_TRUNCATED);
}

/** The environment docker runs with: no CLI hints, and never an SSH askpass helper (an ssh:// endpoint must not prompt). */
function dockerEnv(env) {
  const out = { ...env, DOCKER_CLI_HINTS: 'false' };
  delete out.SSH_ASKPASS;
  delete out.SSH_ASKPASS_REQUIRE;
  return out;
}

/** A failed `docker context inspect` that only means this docker has no contexts (an old docker, a podman shim). */
const INSPECT_UNSUPPORTED = /unknown (command|flag)|is not a docker command|context.*not (supported|recognized)/i;

/**
 * Where the docker CLI points: { local: true }, { local: false, endpoint } or { failed: reason }. Called only when
 * DOCKER_HOST is unset or local (a remote DOCKER_HOST is decided by detectSandbox without running docker). The current
 * context's endpoint (`docker context inspect`) must be unix:// or npipe://; an empty answer falls back to DOCKER_HOST,
 * which at that point is unset or local. A failed inspect fails closed: it counts as local only when stderr says the
 * context command is unknown (INSPECT_UNSUPPORTED) or docker is not installed (ENOENT: docker info cannot run either);
 * a timeout, a spawn error or any other non-zero exit is { failed } and docker info is never run.
 */
function dockerEndpoint(exec, envForDocker, san) {
  const ctx = probeCommand(exec, 'docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { env: envForDocker, capture: true });
  if (ctx.ok) {
    const endpoint = String(ctx.stdout ?? '').trim();
    if (endpoint && !LOCAL_DOCKER.test(endpoint)) return { local: false, endpoint };
    return { local: true };
  }
  if (ctx.code === 'ENOENT') return { local: true };
  const NOT_LOCAL = 'not treating the daemon as local';
  if (ctx.code === 'ETIMEDOUT') return { failed: `docker context inspect timed out (${TIMEOUT_TEXT}) — ${NOT_LOCAL}` };
  const raw = Buffer.isBuffer(ctx.stderr) ? ctx.stderr.toString('utf-8') : String(ctx.stderr ?? '');
  if (typeof ctx.status === 'number' && INSPECT_UNSUPPORTED.test(raw)) return { local: true };
  const line = stderrLine(ctx.stderr, san);
  const why = line || (typeof ctx.status === 'number' ? `exit ${ctx.status}` : ctx.code || ctx.message || 'unknown error');
  return { failed: `docker context inspect failed (${why}) — ${NOT_LOCAL}` };
}

/**
 * docker counts only when `docker info` succeeds against a daemon on this machine (unix:// or npipe://): a remote
 * daemon (DOCKER_HOST or a docker context pointing at tcp://, ssh://, …) is not a sandbox here. unshare counts on linux.
 * Order (safety first): DOCKER_HOST is checked first (no subprocess for a remote one), then `docker context inspect`,
 * then `docker info` only when the endpoint is known to be local — a remote daemon is never contacted, and a failed
 * inspect (timeout, any error but "unknown command") is not taken as local. Every stderr line kept in the reason is
 * sanitised (sanitizeStderr: URLs redacted, the home directory as ~); homedir is injectable for tests.
 */
export async function detectSandbox({ exec = defaultExec, platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  const san = { homedir, env };
  const envForDocker = dockerEnv(env);
  let remote = null;
  if (env.DOCKER_HOST && !LOCAL_DOCKER.test(env.DOCKER_HOST)) remote = env.DOCKER_HOST;
  let docker = null;
  let inspectFailed = null;
  if (remote === null) {
    const ep = dockerEndpoint(exec, envForDocker, san);
    if (ep.failed) inspectFailed = ep.failed;
    else if (!ep.local) remote = ep.endpoint;
  }
  if (remote === null && inspectFailed === null) {
    docker = probeCommand(exec, 'docker', ['info'], { env: envForDocker });
    if (docker.ok) return { present: true, kind: 'docker', reason: 'docker info succeeded' };
  }
  let u = null;
  if (platform === 'linux') {
    u = probeCommand(exec, 'unshare', ['--user', '--map-root-user', 'true']);
    if (u.ok) return { present: true, kind: 'unshare', reason: 'unshare is available' };
  }
  if (remote !== null) {
    const reason = `docker daemon is remote (${redactDockerEndpoint(remote)}) — not a sandbox on this machine`;
    return { present: false, kind: null, reason: u === null ? reason : `${reason} and ${unshareWhy(u, san)}` };
  }
  if (inspectFailed !== null) return { present: false, kind: null, reason: u === null ? inspectFailed : `${inspectFailed} and ${unshareWhy(u, san)}` };
  return { present: false, kind: null, reason: `no sandbox on this machine: ${dockerWhy(docker, san)} and ${unshareWhy(u, san)}` };
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
    clearedWhy.set(row, removed.find(x => x.verdict === was)?.reason || 'use needs a clean network probe first');
    return `decision ${was} for ${power.name} is no longer legal and was cleared`;
  }
  return null;
}

/** Why recomputeRow last cleared a row's decision (read by the clearing paths for the withdrawal label). */
const clearedWhy = new WeakMap();

/**
 * Re-derive a stored row from the CURRENT power and cfg (licence, licence_class) and recompute it against vj.sandbox,
 * keeping row.decision and vj.decisions in step. Returns recomputeRow's warning when a decision was cleared.
 */
function rederiveRow(vj, name, pw, cfg) {
  const row = vj.rows[name];
  row.licence = pw.licence ?? 'unknown';
  row.licence_class = licenceClass(pw.licence, cfg);
  row.decision = vj.decisions[name] ?? row.decision ?? null;
  const cleared = recomputeRow(row, pw, vj.sandbox);
  if (row.decision) vj.decisions[name] = row.decision; else delete vj.decisions[name];
  return cleared;
}

const sandboxKey = (sb) => JSON.stringify([sb?.present === true, sb?.kind ?? null, sb?.reason ?? null]);

/**
 * The fresh sandbox check behind every accepted `use`: the injected sandbox (tests, BBS_SANDBOX=absent) or detectSandbox.
 * When it differs from vj.sandbox, vj.sandbox is replaced and every row is re-derived (clearing decisions that became
 * illegal; their names and reasons are added to `reasons`/`warnings`). Returns { fresh, changed }.
 */
async function refreshSandbox(vj, byName, cfg, { sandbox, exec }, reasons, warnings) {
  const fresh = sandbox ?? await detectSandbox(exec ? { exec } : {});
  if (sandboxKey(fresh) === sandboxKey(vj.sandbox)) return { fresh, changed: false };
  vj.sandbox = fresh;
  for (const name of Object.keys(vj.rows)) {
    const w = rederiveRow(vj, name, byName.get(name) || { name }, cfg);
    if (w) { warnings.push(w); reasons.set(name, clearedWhy.get(vj.rows[name])); }
  }
  return { fresh, changed: true };
}

/** A `use` passes the gate only on a re-derived row that lists it after a clean probe, with the stored AND the fresh sandbox present. */
const useGatesStored = (vj, row) => row.legal.includes('use') && !row.needs_probe && row.probe?.result === 'clean' && vj.sandbox?.present === true;

export const SANDBOX_CONFIG_IGNORED = 'sandbox.required_for_use=false in .claude/bbs.json is ignored — use always requires a sandbox';

/** Config settings that try to loosen a rule that cannot change: each is ignored and named in a warning. */
function sandboxConfigWarnings(cfg) {
  return cfg?.sandbox?.required_for_use === false ? [SANDBOX_CONFIG_IGNORED] : [];
}

export const EVIDENCE_MAX_CHARS = 2048;
const EVIDENCE_TRUNCATED = ' …[truncated]';

/**
 * Probe evidence as stored and printed: a string with control and format characters stripped (newlines kept), every
 * http(s) URL redacted with intake's redactRef, then capped at EVIDENCE_MAX_CHARS code points. Redaction runs before the cap so a URL cut at
 * the cap can never expose credentials the full URL would have had masked. Empty → null.
 */
export function sanitizeEvidence(text) {
  if (text == null) return null;
  const clean = String(text).replace(CONTROL_CHARS, '');
  if (!clean.trim()) return null;
  const red = redactUrlsInText(clean);
  return capCodePoints(red, EVIDENCE_MAX_CHARS, EVIDENCE_TRUNCATED);
}

const nextOf = (rows, unread) => unread ? null : Object.values(rows).every(r => r.decision) ? 'handoff' : 'verdict';

export const POWERS_CHANGED = 'powers.json changed since the verdicts were computed — run cli.js verdict first';
const REPAIR_HINT = 're-run cli.js verdict --from <same file> to append the missing rows';

/** Read powers.json (inside the lock) and refuse when it is not the one verdicts.json was computed from. */
async function currentPowers(dir, vj) {
  const powers = await readJson(path.join(dir, 'powers.json'));
  if (!powers || !Array.isArray(powers.powers)) throw new Error('inventory first — powers.json is missing');
  if (!Object.hasOwn(vj, 'powers_ts')) throw new Error('verdicts.json does not record which powers.json it was computed from (no powers_ts) — run cli.js verdict first');
  if (vj.powers_ts !== powers.ts) throw new Error(POWERS_CHANGED);
  return new Map(powers.powers.map(x => [x.name, x]));
}

const orderedDecisions = (vj) => Object.fromEntries(Object.keys(vj.rows).map(n => [n, vj.decisions[n] ?? null]));

/**
 * After verdicts.json is committed: when the registry's latest row for this source is this run's and still names a
 * decision verdicts.json no longer has (cleared by a probe, a recompute or --force), append a superseding row with
 * that power → null and complete: false (lookupSource is "latest row"). Never throws; returns a warning or null.
 */
async function supersedeRegistry(projectDir, p, run, vj, cfg, appendRegistryImpl) {
  let lost = [];
  try {
    const source = await readJson(path.join(p.dir, 'source.json'));
    const latest = await lookupSource(projectDir, source?.identity, cfg);
    if (!latest || latest.run !== run) return null;
    lost = Object.keys(vj.rows).filter(n => latest.decisions?.[n] != null && !vj.decisions[n]);
    if (!lost.length) return null;
    await appendRegistryImpl(projectDir, { identity: source.identity, type: source.type, ref: source.ref, run, powers: Object.keys(vj.rows).length, decisions: orderedDecisions(vj), complete: false, ts: vj.ts }, cfg);
    return null;
  } catch (err) {
    return `registry row could not be written: ${err.message} — re-run cli.js verdict to append it${lost.length ? ` (cleared: ${lost.join(', ')})` : ''}`;
  }
}

/**
 * After verdicts.json is committed: every power with no decision whose last labels.jsonl row still records a verdict
 * gets one withdrawal row { run, power, verdict: null, label: null, withdrawn, reason, ts } (labels are append-only
 * history). Idempotent: a retry appends only what is still missing. Never throws; returns a warning or null.
 */
async function withdrawLabels(p, run, vj, reasons, appendLabel) {
  const failed = [];
  let labels;
  try { labels = await readJsonl(p.labels); }
  catch (err) { return `labels.jsonl could not be read to record withdrawn decisions: ${err.message} — re-run cli.js verdict to append them`; }
  for (const name of Object.keys(vj.rows)) {
    if (vj.decisions[name]) continue;
    let last = null;
    for (let i = labels.length - 1; i >= 0 && !last; i--) if (labels[i].power === name) last = labels[i];
    if (!last || last.withdrawn != null || !VERDICTS.includes(last.verdict)) continue;
    const reason = reasons.get(name) || 'the decision is no longer recorded in verdicts.json';
    try { await appendLabel(p.labels, { run, power: name, verdict: null, label: null, withdrawn: last.verdict, reason, ts: vj.ts }); }
    catch (err) { failed.push(`${name} (${err.message})`); }
  }
  return failed.length ? `withdrawal label could not be written to labels.jsonl for ${failed.join(', ')} — re-run cli.js verdict to append it` : null;
}

/**
 * The first duplicate object key in already-validated JSON text (the scan starts at the first '{', so a fence line
 * before it is skipped), or null. JSON.parse keeps the last duplicate silently; a decision must never be guessed.
 */
function duplicateKey(text) {
  let i = text.indexOf('{');
  if (i < 0) return null;
  const n = text.length;
  const ws = () => { while (i < n && /\s/.test(text[i])) i++; };
  const str = () => {
    let j = i + 1;
    while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    const v = JSON.parse(text.slice(i, j + 1));
    i = j + 1;
    return v;
  };
  const value = () => {
    ws();
    if (text[i] === '{') return container('}', true);
    if (text[i] === '[') return container(']', false);
    if (text[i] === '"') { str(); return null; }
    while (i < n && !/[,\]}\s]/.test(text[i])) i++;
    return null;
  };
  function container(close, isObject) {
    i++;
    ws();
    if (text[i] === close) { i++; return null; }
    const seen = new Set();
    let dup = null;
    while (i < n) {
      if (isObject) {
        ws();
        const k = str();
        if (seen.has(k) && dup === null) dup = k;
        seen.add(k);
        ws();
        i++; // ':'
      }
      const inner = value();
      if (inner !== null && dup === null) dup = inner;
      ws();
      if (text[i] === ',') { i++; continue; }
      i++;
      break;
    }
    return dup;
  }
  return value();
}

export async function computeVerdicts(projectDir, { run, sandbox, now = () => new Date(), force = false, cfg = DEFAULT_CONFIG, exec, lockOpts, appendRegistryImpl = appendRegistry, appendLabel = appendJsonl } = {}) {
  const p = runPaths(projectDir, run, cfg);
  const powers = await readJson(path.join(p.dir, 'powers.json'));
  if (!powers || !Array.isArray(powers.powers)) throw new Error('inventory first — powers.json is missing; run cli.js inventory --from, then cli.js map');
  const sb = sandbox ?? await detectSandbox(exec ? { exec } : {});

  const { result, warning: lockWarning } = await withMapLockDetailed(p.dir, async () => {
    const map = await readJson(path.join(p.dir, 'map.json'));
    if (!map || !map.judgments) throw new Error('map first — map.json is missing; run cli.js map, then cli.js map --from');
    const pj = await readJson(path.join(p.dir, 'powers.json'));
    const list = pj?.powers;
    if (!Array.isArray(list)) throw new Error('inventory first — powers.json is missing; run cli.js inventory --from, then cli.js map');
    const missing = list.map(x => x.name).filter(n => !map.judgments[n]);
    if (missing.length) throw new Error(`judgments missing for: ${missing.join(', ')} — record them with cli.js map --from`);
    const source = await readJson(path.join(p.dir, 'source.json'));
    if (!source) throw new Error(`run "${run}" has no source.json — run \`cli.js intake <source>\` first`);

    let existing = null;
    let corruptReplaced = false;
    try { existing = await readJson(p.verdicts); }
    catch (err) {
      if (!/^corrupt JSON in /.test(err.message)) throw err; // unreadable (EACCES, EISDIR, …): --force would not help
      if (!force) throw new Error(`${err.message} — pass --force to rebuild it (probes and decisions are dropped)`);
      await moveAsideStale(p.dir, ['verdicts.json'], now); // kept for inspection, never overwritten
      corruptReplaced = true;
    }
    // What a corrupt file held is unknown: null, never a count of 0.
    const dropped = corruptReplaced ? { probes: null, decisions: null, corrupt_replaced: true } : { probes: 0, decisions: 0 };
    const warnings = sandboxConfigWarnings(cfg);
    const reasons = new Map(); // power → why its decision was withdrawn
    const rows = {};
    for (const power of list) {
      const old = existing?.rows?.[power.name];
      const oldDecision = existing?.decisions?.[power.name] ?? old?.decision ?? null;
      const oldProbe = old?.probe && PROBES.includes(old.probe.result) ? old.probe : null;
      if (force && !corruptReplaced) {
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
      if (w) { warnings.push(w); reasons.set(power.name, clearedWhy.get(row)); }
      else if (corruptReplaced) reasons.set(power.name, 'verdicts.json was corrupt and was replaced (cli.js verdict --force)');
      else if (force && oldDecision) reasons.set(power.name, 'forced recompute (cli.js verdict --force) dropped the decision');
      rows[power.name] = row;
    }
    const decisions = Object.fromEntries(Object.entries(rows).filter(([, r]) => r.decision).map(([n, r]) => [n, r.decision]));
    const vj = { run, source_identity: source.identity, powers_ts: pj.ts ?? null, sandbox: sb, rows, decisions, ts: now().toISOString() };
    // verdicts.json last: it is what marks the step's state
    await writeJson(p.verdicts, vj);
    const labelWarning = await withdrawLabels(p, run, vj, reasons, appendLabel);
    if (labelWarning) warnings.push(labelWarning);
    const regWarning = await supersedeRegistry(projectDir, p, run, vj, cfg, appendRegistryImpl);
    if (regWarning) warnings.push(regWarning);
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

export async function recordProbe(projectDir, { run, power, result, evidence, now = () => new Date(), force = false, cfg = DEFAULT_CONFIG, lockOpts, appendRegistryImpl = appendRegistry, appendLabel = appendJsonl, sandbox, exec } = {}) {
  const p = runPaths(projectDir, run, cfg);
  await readVerdicts(p.verdicts); // fail fast, before the lock
  const { result: out, warning: lockWarning } = await withMapLockDetailed(p.dir, async () => {
    const vj = await readVerdicts(p.verdicts);
    if (typeof power !== 'string' || !Object.hasOwn(vj.rows, power)) throw new Error(`unknown power "${power}"`);
    if (!PROBES.includes(result)) throw new Error(`probe result for ${power} must be one of ${PROBES.join('|')}, got ${JSON.stringify(result)}`);
    const row = vj.rows[power];
    if (row.probe && !force) throw new Error(`${power} already probed — pass --force to replace`);
    const byName = await currentPowers(p.dir, vj);
    const pw = byName.get(power) || { name: power };
    row.probe = { result, evidence: sanitizeEvidence(evidence), ts: now().toISOString() };
    // Re-derived from the current powers.json and cfg licence class, never trusted from the stored row.
    const cleared = rederiveRow(vj, power, pw, cfg);
    const reasons = new Map(cleared ? [[power, clearedWhy.get(row)]] : []);
    const refreshWarnings = [];
    let sandboxChanged = false;
    // A `use` kept on this row stands only on a fresh sandbox check.
    if (row.decision === 'use') ({ changed: sandboxChanged } = await refreshSandbox(vj, byName, cfg, { sandbox, exec }, reasons, refreshWarnings));
    vj.ts = now().toISOString();
    await writeJson(p.verdicts, vj);
    const labelWarning = await withdrawLabels(p, run, vj, reasons, appendLabel);
    const regWarning = await supersedeRegistry(projectDir, p, run, vj, cfg, appendRegistryImpl);
    const { warning, unread } = await renderAfterCommit(p.dir);
    const w = joinWarnings(...sandboxConfigWarnings(cfg), cleared, ...refreshWarnings, labelWarning, regWarning, warning);
    return { runId: run, power, ...row, next: nextOf(vj.rows, unread), ...(sandboxChanged ? { sandbox_changed: true } : {}), ...(w ? { warning: w } : {}) };
  }, lockOpts);
  return withWarning(out, lockWarning);
}

/** True when the last labels.jsonl row for `power` (a withdrawal row counts as none) records `verdict`. */
function labelRecorded(labels, power, verdict) {
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i];
    if (l.power !== power) continue;
    return l.withdrawn == null && l.verdict === verdict;
  }
  return false;
}

export async function recordDecisions(projectDir, { run, input, now = () => new Date(), force = false, cfg = DEFAULT_CONFIG, label = 'decisions', lockOpts,
  appendRegistryImpl = appendRegistry, appendLabel = appendJsonl, sandbox, exec } = {}) {
  const p = runPaths(projectDir, run, cfg);
  await readVerdicts(p.verdicts);
  const { result: out, warning: lockWarning } = await withMapLockDetailed(p.dir, async () => {
    const vj = await readVerdicts(p.verdicts);
    const names = Object.keys(vj.rows);
    const parsed = parseJsonOnly(input, { label });
    if (typeof input === 'string' || Buffer.isBuffer(input)) {
      const dup = duplicateKey(Buffer.isBuffer(input) ? input.toString('utf-8') : input);
      if (dup !== null) throw new Error(`duplicate power ${JSON.stringify(dup)} in ${label}`);
    }
    const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const isWrapper = isPlain(parsed) && Object.keys(parsed).length === 1 && Object.hasOwn(parsed, 'decisions')
      && isPlain(parsed.decisions) && !Object.hasOwn(vj.rows, 'decisions');
    const decisions = isWrapper ? parsed.decisions : parsed;
    if (!isPlain(decisions)) throw new Error(`JSON only — ${label} must be an object of power → verdict`);
    if (!Object.keys(decisions).length) throw new Error(`${label} names no power — expected an object of power → verdict`);
    const byName = await currentPowers(p.dir, vj);
    for (const [name, v] of Object.entries(decisions)) {
      if (!Object.hasOwn(vj.rows, name)) throw new Error(`unknown power "${name}"`);
      if (!VERDICTS.includes(v)) throw new Error(`${name}: verdict must be one of ${VERDICTS.join('|')}, got ${JSON.stringify(v)}`);
    }

    // The stored rows are never trusted: each named row is re-derived from the current powers.json and cfg licence
    // class, and a `use` that passes the stored gates is checked against a fresh sandbox check.
    const ts = now().toISOString();
    const before = JSON.stringify(vj);
    const reasons = new Map(); // power → why its decision was withdrawn by the refresh
    const warnings = [];
    for (const name of Object.keys(decisions)) {
      const w = rederiveRow(vj, name, byName.get(name) || { name }, cfg);
      if (w) { warnings.push(w); reasons.set(name, clearedWhy.get(vj.rows[name])); }
    }
    let fresh = null;
    let sandboxChanged = false;
    if (Object.entries(decisions).some(([n, v]) => v === 'use' && useGatesStored(vj, vj.rows[n]))) {
      ({ fresh, changed: sandboxChanged } = await refreshSandbox(vj, byName, cfg, { sandbox, exec }, reasons, warnings));
    }
    const refreshed = JSON.stringify(vj) !== before;
    if (refreshed) vj.ts = ts;
    /** Commit what the refresh corrected (sandbox, licence class, cleared decisions) with its withdrawal labels and registry row. */
    const commitRefresh = async () => {
      await writeJson(p.verdicts, vj);
      if (reasons.size) {
        const lw = await withdrawLabels(p, run, vj, reasons, appendLabel);
        if (lw) warnings.push(lw);
        const rw = await supersedeRegistry(projectDir, p, run, vj, cfg, appendRegistryImpl);
        if (rw) warnings.push(rw);
      }
    };

    // Validate everything before the decisions are written. A decision identical to the recorded one is a repair, not a change.
    const changed = [];
    const repeated = [];
    try {
      for (const [name, v] of Object.entries(decisions)) {
        const row = vj.rows[name];
        if (v === 'use' && row.needs_probe) {
          throw new PolicyRefused(`use needs a clean network probe for ${name} first (cli.js verdict --probe ${name}=clean|found|incomplete)`);
        }
        if (!row.legal.includes(v)) {
          const now_ = sandboxChanged ? ` — the sandbox check now says: ${vj.sandbox.reason}; verdicts.json was updated` : '';
          throw new PolicyRefused(`${v} is not legal for ${name}: legal verdicts are ${row.legal.join(', ')}${now_}`);
        }
        if (v === 'use' && !(useGatesStored(vj, row) && fresh?.present === true)) {
          throw new PolicyRefused(`use is not legal for ${name}: it needs a clean probe, a recorded sandbox and a fresh sandbox check on this machine`);
        }
        const had = vj.decisions[name] ?? row.decision;
        if (had === v) { repeated.push(name); continue; }
        if (had && !force) throw new Error(`${name} already decided — pass --force to change it`);
        changed.push(name);
      }
    } catch (err) {
      if (refreshed) {
        await commitRefresh();
        await renderAfterCommit(p.dir);
      }
      throw err;
    }

    if (changed.length) {
      for (const name of changed) {
        vj.rows[name].decision = decisions[name];
        vj.decisions[name] = decisions[name];
      }
      vj.ts = ts;
    }
    if (changed.length || refreshed) await commitRefresh();

    // verdicts.json is committed: nothing below may fail the verb. Every append is repairable by resubmitting the same input.
    let toLabel = changed;
    if (repeated.length) {
      try {
        const labels = await readJsonl(p.labels);
        toLabel = [...changed, ...repeated.filter(n => !labelRecorded(labels, n, decisions[n]))];
      } catch (err) {
        warnings.push(`labels.jsonl could not be read to check for missing rows: ${err.message} — ${REPAIR_HINT}`);
      }
    }
    for (const name of Object.keys(decisions).filter(n => toLabel.includes(n))) {
      const v = decisions[name];
      try { await appendLabel(p.labels, { run, power: name, verdict: v, label: v === 'skip' ? 0 : 1, ts }); }
      catch (err) { warnings.push(`label for ${name} could not be written to labels.jsonl: ${err.message} — ${REPAIR_HINT}`); }
    }
    const remaining = names.filter(n => !vj.decisions[n]).sort();
    let registry_written = false;
    if (remaining.length === 0) {
      try {
        const source = await readJson(path.join(p.dir, 'source.json'));
        const ordered = orderedDecisions(vj);
        const latest = await lookupSource(projectDir, source?.identity, cfg);
        const current = latest && latest.run === run && latest.complete !== false
          && JSON.stringify(orderedDecisions({ rows: vj.rows, decisions: latest.decisions || {} })) === JSON.stringify(ordered);
        if (!current) {
          await appendRegistryImpl(projectDir, { identity: source?.identity, type: source?.type, ref: source?.ref, run, powers: names.length, decisions: ordered, complete: true, ts }, cfg);
          registry_written = true;
        }
      } catch (err) {
        warnings.push(`registry row could not be written: ${err.message} — ${REPAIR_HINT}`);
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
      ...(sandboxChanged ? { sandbox_changed: true } : {}),
      ...(w ? { warning: w } : {})
    };
  }, lockOpts);
  return withWarning(out, lockWarning);
}
