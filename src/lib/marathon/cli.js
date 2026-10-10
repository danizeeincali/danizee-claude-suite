#!/usr/bin/env node
/**
 * Marathon helper CLI for Danizee Claude Suite
 * `node .claude/helpers/marathon/cli.js <verb> [flags] [key=value ...]`
 *
 * Every judgment the model is bad at remembering or counting — streaks, gate verdicts,
 * budgets, context size, keep-lists — is a verb here with a JSON result and an exit code.
 * The /w-marathon and /bc commands call these verbs and act on the result.
 *
 * Design rules (three review rounds taught them):
 *  - validate at every boundary and fail closed on any store damage;
 *  - a finish line that the build never had a hand in is never "done";
 *  - a clean streak certifies code only when it completes — an over round never narrows the
 *    next review;
 *  - a ceiling hit pauses the run until a fresh reading below the ceiling or `unpause`;
 *  - state always resolves to the project's main checkout, under a lock;
 *  - a run with queued streams is never silent: every wake path names the next stream.
 *
 * Exit codes: 0 ok · 1 gate not met / invalid input / broken state (fix it, rerun) ·
 * 2 the ceiling or the token budget was hit (the run is PAUSED). The protocol treats ANY
 * non-zero exit from `budget` as "do not spawn".
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { loadConfig, runsDir as runsDirOf, runDir as runDirOf, activeRunId, setActiveRun } from './config.js';
import { TABLES, append, readAllWithReport, repairTable } from './store.js';
import { evaluateGate, parseChecklist, validateFinishLine } from './gate.js';
import { reviewStreak, reviewPasses, validCounts } from './streak.js';
import { canFanOut, helperBudgetFor } from './budget.js';
import { normalizeFinding, seenTwice, escapes, foldFindings } from './findings.js';
import { pickAngle, renderBrief, renderWriteup } from './reviewer.js';
import { measureTranscript, contextPct, decide } from './context.js';
import { buildKeepList } from './keeplist.js';
import { resumeLine } from './resume.js';
import { cronSpec, fallbackSnippets } from './wake.js';
import { renderPage } from './page.js';
import { readStreams, setStream, readHandoff, stampHandoff, renderStatus } from './status.js';
import { checkShadowing } from './shadow.js';
import { classifyBuild, modelFor, nextTier, modelStats } from './routing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Where the session was launched: transcripts are keyed by this, not by the resolved state dir.
const LAUNCH_DIR = process.cwd();

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,80}$/i;
const NAME = /^[a-z0-9][a-z0-9_-]{0,60}$/i;
const SHA = /^[0-9a-f]{7,40}$/;
const SEVERITIES = ['high', 'medium', 'low'];
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const DIFF_INLINE_MAX = 150_000;
const DIFF_EXCLUDES = ['**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/*.lock', '**/*.snap', '**/*.min.js', '**/*.min.css']
  .map(g => `:(exclude,glob)${g}`);
// Keys whose values are identifiers or text, never numbers — an all-digit sha or task id stays a string.
const STRING_KEYS = new Set(['commit', 'base', 'id', 'helper_id', 'review_id', 'replaces', 'key', 'tasks', 'name', 'stream', 'title',
  'detail', 'fix_hint', 'angle', 'file', 'isolation', 'plan', 'next', 'skill', 'phase', 'category', 'severity', 'status',
  'kind', 'role', 'model', 'outcome', 'trigger', 'escalated_from', 'decision']);

// ---------------------------------------------------------------------------
// argv / output
// ---------------------------------------------------------------------------

class CliExit extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function parseArgs(argv) {
  const [verb, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else if (a.includes('=') && !a.startsWith('{')) {
      const [k, ...v] = a.split('=');
      positional.push([k, v.join('=')]);
    } else {
      positional.push(a);
    }
  }
  return { verb, flags, positional };
}

function coerce(key, v) {
  if (STRING_KEYS.has(key)) return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (v === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

function rowFromArgs(flags, positional) {
  const row = flags.json ? JSON.parse(flags.json) : {};
  for (const p of positional) {
    if (Array.isArray(p)) row[p[0]] = coerce(p[0], p[1]);
  }
  return row;
}

function out(obj) {
  process.stdout.write((typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) + '\n');
}

function fail(msg, code = 1) {
  throw new CliExit(msg, code);
}

const isInt = (v) => Number.isInteger(v);
const isPosInt = (v) => Number.isInteger(v) && v > 0;
const str = (v) => (typeof v === 'string' && v !== '' ? v : undefined);

// ---------------------------------------------------------------------------
// git + files
// ---------------------------------------------------------------------------

/** Lenient git: '' on any failure. For metadata only (branch, HEAD), never for review scope. */
function git(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: GIT_MAX_BUFFER }).trim(); }
  catch { return ''; }
}

/** Strict git: throws CliExit with git's own message. Used wherever an empty answer would pass a gate. */
function gitStrict(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GIT_MAX_BUFFER }); }
  catch (err) {
    const msg = (err.stderr || err.message || '').toString().trim().split('\n')[0];
    fail(`git ${args[0]} failed in ${cwd}: ${msg || 'not a git repository'}`);
  }
}

/**
 * All state lives in the project's main checkout. Only a LINKED WORKTREE is redirected: its
 * position inside the worktree is mapped onto the main checkout. A project nested inside a larger
 * repository keeps its own cwd (and its own .claude/).
 */
function resolveProjectDir(cwd) {
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  if (!top) return cwd;
  const common = git(['rev-parse', '--git-common-dir'], cwd);
  if (!common) return cwd;
  const commonAbs = path.resolve(cwd, common);
  const mainTop = path.basename(commonAbs) === '.git' ? path.dirname(commonAbs) : top;
  if (path.resolve(top) === path.resolve(mainTop)) return cwd;          // main checkout, possibly a nested project
  return path.join(mainTop, path.relative(top, cwd));                   // linked worktree → same place in main
}

async function isDir(p) {
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
}

async function readIfExists(p, fallback = null) {
  try { return await fs.readFile(p, 'utf-8'); } catch { return fallback; }
}

async function mtimeMs(p) {
  try { return (await fs.stat(p)).mtimeMs; } catch { return null; }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function which(bin) {
  try { return execFileSync('sh', ['-lc', `command -v ${bin}`], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
  catch { return null; }
}

// ---------------------------------------------------------------------------
// run context
// ---------------------------------------------------------------------------

async function loadRun(projectDir, flags, { required = true } = {}) {
  const config = await loadConfig(projectDir);
  const runId = flags.run || await activeRunId(projectDir, config);
  if (!runId) {
    if (required) fail('no active run — pass --run <id> or create one with `cli.js init <slug>`');
    return { config, runId: null, runDir: null, runDirRel: null };
  }
  if (!RUN_ID.test(String(runId))) fail(`invalid run id "${runId}" — letters, digits and dashes only`);
  const runDir = runDirOf(projectDir, runId, config);
  if (!(await isDir(runDir))) fail(`run ${runId} does not exist under ${path.relative(projectDir, runsDirOf(projectDir, config))}`);
  return { config, runId, runDir, runDirRel: path.relative(projectDir, runDir) };
}

async function gatherStore(runDir) {
  const reports = await Promise.all(TABLES.map(t => readAllWithReport(runDir, t)));
  const store = {};
  const corruptBy = {};
  let corrupt = 0;
  TABLES.forEach((t, i) => { store[t] = reports[i].rows; if (reports[i].corrupt) corruptBy[t] = reports[i].corrupt; corrupt += reports[i].corrupt; });
  return { store, corrupt, corruptBy };
}

/** Reviews fold by id (a later row with the same id updates the earlier one); voided reviews are dropped. */
function effectiveReviews(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (r.id && byId.has(r.id)) byId.set(r.id, { ...byId.get(r.id), ...r });
    else byId.set(r.id ?? Symbol('anon'), { ...r });
  }
  return [...byId.values()].filter(r => !r.void);
}

/**
 * finish-line.json is edited by hand. Anything but a schema-valid {lines[], tolerance{}} is an
 * error, and an error is a gate that is not met.
 */
async function readFinishLine(runDir) {
  const p = path.join(runDir, 'finish-line.json');
  const empty = { lines: [], tolerance: {} };
  const text = await readIfExists(p);
  if (text === null) return { finishLine: empty, error: 'finish-line.json is missing', toleranceValid: false };
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { finishLine: empty, error: `finish-line.json is not valid JSON (${e.message})`, toleranceValid: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { finishLine: empty, error: 'finish-line.json must be an object with a "lines" array', toleranceValid: false };
  }
  const tolerance = parsed.tolerance && typeof parsed.tolerance === 'object' && !Array.isArray(parsed.tolerance) ? parsed.tolerance : {};
  const finishLine = { lines: Array.isArray(parsed.lines) ? parsed.lines : [], tolerance };
  const errors = validateFinishLine({ lines: parsed.lines, tolerance: parsed.tolerance ?? tolerance });
  if (errors.length) return { finishLine: empty, error: `finish-line.json: ${errors.join('; ')}`, toleranceValid: false };
  const toleranceValid = SEVERITIES.some(s => Number.isInteger(tolerance[s]) && tolerance[s] >= 0);
  return { finishLine, error: null, toleranceValid };
}

/** Passes needed: the counted reviews.streak line decides; passes_in_a_row is the fallback. */
function passesNeeded(finishLine) {
  const line = (finishLine.lines || []).find(l => l?.source === 'reviews.streak' && Number.isFinite(l.value));
  if (line) return line.value;
  const t = finishLine.tolerance?.passes_in_a_row;
  return isPosInt(t) ? t : 2;
}

/**
 * The weekly-allowance reading is a timestamped measurement (key usage_pct). The LATEST row
 * decides: fresh and numeric → its value; non-numeric → invalid (never skipped); older than
 * the TTL → unknown. A non-numeric TTL in the config is itself invalid.
 */
function freshUsage(measurements, config) {
  const ttlMin = config.usage_reading_ttl_minutes;
  if (!(Number.isFinite(ttlMin) && ttlMin > 0)) return { value: null, invalid: `invalid: usage_reading_ttl_minutes "${ttlMin}" is not a positive number` };
  const rows = measurements.filter(m => m.key === 'usage_pct');
  const latest = rows[rows.length - 1];
  if (!latest) return { value: null, invalid: null };
  const v = Number(latest.value);
  if (latest.value === '' || latest.value === null || !Number.isFinite(v) || v < 0 || v > 100) {
    return { value: null, invalid: `invalid: latest usage_pct reading "${latest.value}" is not a number between 0 and 100` };
  }
  const age = Date.now() - Date.parse(latest.ts || 0);
  return { value: age <= ttlMin * 60_000 ? v : null, invalid: null };
}

const realStreams = (streams) => streams.filter(s => s.name !== '_meta');
const metaOf = (streams) => streams.find(s => s.name === '_meta') || null;

function budgetExitCode(result) {
  if (result.ok) return 0;
  return /^invalid/i.test(result.reason) ? 1 : 2;
}

function streamFlag(flags) {
  if (!('stream' in flags)) return null;
  const s = str(flags.stream);
  if (!s) fail('--stream needs a stream name (`--stream <name>`); a bare or empty --stream is never the run-wide verdict');
  return s;
}

/** The instruction to start a stream: its worktree first, then the activation that records the base. */
function activateHint(runId, name, isolation) {
  return isolation === 'worktree'
    ? `create its worktree (\`git worktree add ../<repo>-${name} -b marathon/${runId}/${name}\`) and activate it with \`cli.js stream ${name} state=active isolation=<path>\``
    : `activate it with \`cli.js stream ${name} state=active --no-isolation\``;
}

function nextForHuman({ runId, meta, gate, streams, paused }) {
  const waiting = gate.waitingOnHuman?.length ? ` Waiting on you: ${gate.waitingOnHuman.join(', ')} (tick them in checklist.md).` : '';
  const isolation = meta?.isolation || 'worktree';
  if (meta?.finished) return 'Run is finished. Start a new one with /w-marathon <finish line>.';
  if (paused) return `PAUSED — raise ceiling_pct / run_token_budget in .claude/marathon.json or wait for the allowance, then \`cli.js unpause\` (or \`cli.js budget --usage-pct <fresh reading>\`) and /w-marathon --resume ${runId}.`;
  if (gate.error) return `Fix: ${gate.error}.${waiting}`;
  const active = streams.find(s => s.state === 'active');
  if (active) return `Continue stream "${active.name}" (next: ${active.next || 'see its plan'}) — /w-marathon --resume ${runId}.${waiting}`;
  const queued = streams.find(s => s.state === 'queued');
  if (queued) return `Next stream "${queued.name}": ${activateHint(runId, queued.name, isolation)}, then /w-marathon --resume ${runId}.${waiting}`;
  const blocked = streams.filter(s => s.state === 'blocked');
  if (streams.length && blocked.length && streams.every(s => s.state === 'done' || s.state === 'blocked')) {
    return `All remaining streams are blocked: ${blocked.map(s => `${s.name} — ${s.next || 'see its row'}`).join('; ')}. Unblock one and set it active (${activateHint(runId, blocked[0].name, isolation)}).${waiting}`;
  }
  if (streams.length && streams.every(s => s.state === 'done')) {
    if (gate.buildGateMet) return `All streams done and the build gate is met — run \`cli.js gate\`, then \`cli.js finish\`.${waiting}`;
    return `All streams done but the run-wide gate fails on ${gate.failing.join(', ') || 'see cli.js gate'} — run \`cli.js gate\`, reopen the owning stream (\`cli.js stream <name> state=active\`) and continue at 4.1.${waiting}`;
  }
  return `No streams yet — add them with \`cli.js stream <name> state=queued next="…"\`, then /w-marathon --resume ${runId}.`;
}

async function gather(projectDir, flags, { usagePctFlag } = {}) {
  const ctx = await loadRun(projectDir, flags);
  const { store: raw, corrupt, corruptBy } = await gatherStore(ctx.runDir);
  const store = { ...raw, reviews: effectiveReviews(raw.reviews) };
  const fl = await readFinishLine(ctx.runDir);
  const checklist = parseChecklist(await readIfExists(path.join(ctx.runDir, 'checklist.md'), ''));
  const allStreams = await readStreams(ctx.runDir);
  const streams = realStreams(allStreams);
  const meta = metaOf(allStreams);
  const paused = meta?.paused || null;
  const handoff = await readHandoff(ctx.runDir);
  const stream = streamFlag(flags);
  if (stream && !streams.some(s => s.name === stream)) fail(`--stream ${stream}: no such stream in this run`);

  const corruptError = corrupt ? `store has ${corrupt} corrupt line(s) in ${Object.keys(corruptBy).join(', ')} — run cli.js repair` : null;
  const notMet = (err) => ({ lines: [], failing: [], waitingOnHuman: [], buildGateMet: false, gateMet: false, stream: null, error: err });
  const blocker = fl.error || corruptError;
  // The run-wide gate always renders status.md; a --stream verdict is computed separately and only printed.
  const gate = blocker ? notMet(blocker) : evaluateGate({ finishLine: fl.finishLine, ...store, checklist });
  const scopedGate = stream ? (blocker ? { ...notMet(blocker), stream } : evaluateGate({ finishLine: fl.finishLine, ...store, checklist, stream })) : null;
  const needed = passesNeeded(fl.finishLine);
  const streamGates = blocker ? {} : Object.fromEntries(streams.map(s => {
    const g = evaluateGate({ finishLine: fl.finishLine, ...store, checklist, stream: s.name });
    return [s.name, { met: g.buildGateMet, passes: reviewStreak(store.reviews.filter(r => r.stream === s.name)), needed }];
  }));

  const usage = freshUsage(store.measurements, ctx.config);
  const usagePct = usagePctFlag !== undefined ? usagePctFlag : usage.value;
  const rawBudget = canFanOut({ config: ctx.config, helpers: store.helpers, usagePct });
  let budget = rawBudget;
  if (budget.ok && usage.invalid && usagePctFlag === undefined) budget = { ...budget, ok: false, reason: usage.invalid };
  if (budget.ok && corruptError) budget = { ...budget, ok: false, reason: `invalid: ${corruptError}` };
  // A pause persists until a fresh reading below the ceiling (checked by `budget`) or `unpause`.
  if (budget.ok && paused && !(usagePctFlag !== undefined && rawBudget.ok)) {
    budget = { ...budget, ok: false, reason: `paused: ${paused.reason} (since ${paused.ts}) — run cli.js unpause after raising the limit, or pass a fresh reading below the ceiling` };
  }

  const score = { passes: reviewStreak(store.reviews), needed };
  const scopedScore = stream ? { passes: reviewStreak(store.reviews.filter(r => r.stream === stream)), needed } : null;
  const next = nextForHuman({ runId: ctx.runId, meta, gate, streams, paused });
  return { ...ctx, store, rawReviews: raw.reviews, corrupt, corruptBy, finishLine: fl.finishLine, finishLineError: fl.error, toleranceValid: !!fl.toleranceValid,
    checklist, allStreams, streams, meta, paused, handoff, gate, scopedGate, streamGates, budget, rawBudget, score, scopedScore, stream, next };
}

async function writeStatus(g) {
  const owned = escapes(g.store.findings);
  // Per-stream escapes and gates come from the ledger, never from a hand-kept counter on the row.
  const streams = g.streams.map(s => ({ ...s, escapes: owned.filter(f => f.stream === s.name).length, gate: g.streamGates[s.name] }));
  const state = g.meta?.finished ? 'FINISHED' : g.paused ? 'PAUSED (budget)' : undefined;
  let md = renderStatus({
    runId: g.runId, config: g.config, gate: g.gate, budget: g.budget, score: g.score,
    streams, escapes: owned.length, handoff: g.handoff, corrupt: g.corrupt, state, next: g.next
  });
  if (g.gate.error) md = md.replace('\n## Streams', `\n- ⚠ Gate blocked: ${g.gate.error} — NOT met until this is fixed\n\n## Streams`);
  await fs.writeFile(path.join(g.runDir, 'status.md'), md, 'utf-8');
  return md;
}

async function refresh(projectDir, flags, opts) {
  const g = await gather(projectDir, flags, opts);
  await writeStatus(g);
  return g;
}

/**
 * The checkout a stream's commits live in. A recorded isolation path that no longer exists is
 * an error — silently falling back to the main checkout is how the wrong code gets reviewed.
 */
async function cwdFor(projectDir, streams, name, { override } = {}) {
  if (override) return path.resolve(projectDir, override);
  const s = streams.find(x => x.name === name);
  if (s?.isolation) {
    const p = path.isAbsolute(s.isolation) ? s.isolation : path.join(projectDir, s.isolation);
    if (await isDir(p)) return p;
    fail(`worktree for stream ${name} is missing (isolation=${s.isolation}) — restore it, pass --cwd <checkout>, or give commit=<sha> explicitly`);
  }
  return projectDir;
}

function requireKnownStream(g, name, what) {
  if (name === undefined) return;
  if (!NAME.test(String(name))) fail(`${what}: "${name}" is not a valid stream name`);
  if (!g.streams.some(s => s.name === name)) fail(`${what}: stream "${name}" is not in this run — add it with cli.js stream ${name} state=queued`);
}

// ---------------------------------------------------------------------------
// verbs
// ---------------------------------------------------------------------------

const DEFAULT_LINES = [
  { id: 'e2e_streak', label: 'Green end-to-end runs in a row', type: 'number', op: 'at_least', value: 6, owner: 'build', source: 'runs.streak:e2e' },
  { id: 'unit_streak', label: 'Green unit runs in a row', type: 'number', op: 'at_least', value: 3, owner: 'build', source: 'runs.streak:unit' },
  { id: 'clean_reviews', label: 'Clean reviews in a row', type: 'number', op: 'at_least', value: 2, owner: 'build', source: 'reviews.streak' },
  { id: 'latest_high', label: 'High findings in the latest review', type: 'number', op: 'at_most', value: 0, owner: 'build', source: 'reviews.latest.high' },
  { id: 'open_high', label: 'Open high findings', type: 'number', op: 'at_most', value: 0, owner: 'build', source: 'findings.open:high' }
];

async function verbInit(projectDir, flags, positional) {
  const slug = positional[0];
  if (!slug || typeof slug !== 'string') fail('usage: cli.js init <slug> [--run <id>] [--isolation worktree|folder]');
  const config = await loadConfig(projectDir);
  const runId = flags.run || `${today()}-${slug.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;
  if (!RUN_ID.test(String(runId))) fail(`invalid run id "${runId}" — letters, digits and dashes only`);
  const runDir = runDirOf(projectDir, runId, config);
  if (await isDir(runDir)) {
    const meta = metaOf(await readStreams(runDir));
    if (meta?.finished) fail(`run ${runId} is finished — start a new run with a new slug`);
  }
  await fs.mkdir(path.join(runDir, 'store'), { recursive: true });
  await fs.mkdir(path.join(runDir, 'reviews'), { recursive: true });

  const runsDir = runsDirOf(projectDir, config);
  let example = null;
  try { example = JSON.parse(await readIfExists(path.join(runsDir, 'finish-line.example.json'), 'null')); } catch { example = null; }
  const finishLine = example && Array.isArray(example.lines)
    ? { tolerance: example.tolerance, lines: example.lines }
    : { tolerance: { high: 0, medium: 2, low: 5, passes_in_a_row: 2 }, lines: DEFAULT_LINES };

  const kickoff = [
    `# Kickoff — ${runId}`, '',
    '## Done means', '- ', '',
    '## You may decide on your own', '- ', '',
    '## Ask me before', '- ', '',
    '## Never', '- ', '',
    '## Budget', `- Run token budget: ${config.run_token_budget.toLocaleString('en-US')}`,
    `- Usage ceiling: ${config.ceiling_pct}% of the weekly allowance, checked before every fan-out`,
    `- Helper budget: ${config.helper_budget.default.toLocaleString('en-US')} (max ${config.helper_budget.max.toLocaleString('en-US')})`, '',
    '## Models', `- Lead: the session model · scoped builds: ${config.models.build_scoped} · builds: ${config.models.build} · hard builds: ${config.models.build_hard} · review: ${config.models.review} · routine: ${config.models.routine}`,
    `- Ladder: ${config.models.ladder.join(' → ')}. A failed job retries one tier up, never on the same tier.`, ''
  ].join('\n');

  const checklist = [
    '# Waiting on human', '',
    'Jobs only the owner can do. Tick a line and Claude reads it at the next wake-up.',
    'Format: `- [ ] <id> — <label>` (the id matches a `checklist:<id>` finish-line source).', '',
    '- [ ] deployed — Deploy to the hosting account', ''
  ].join('\n');

  const rulesSeed = await readIfExists(path.join(runsDir, 'rules.md'), '# Standing rules\n\n- Never weaken an assertion.\n');

  const writes = [
    ['kickoff.md', kickoff],
    ['finish-line.json', JSON.stringify(finishLine, null, 2) + '\n'],
    ['checklist.md', checklist],
    ['rules.md', rulesSeed]
  ];
  for (const [name, content] of writes) {
    const dest = path.join(runDir, name);
    try { await fs.access(dest); } catch { await fs.writeFile(dest, content, 'utf-8'); }
  }

  const isolation = flags.isolation || config.streams.isolation;
  await setStream(runDir, '_meta', { state: 'meta', isolation, created: new Date().toISOString() });
  await setActiveRun(projectDir, runId, config);
  const g = await refresh(projectDir, { ...flags, run: runId });
  out({ runId, runDir: g.runDirRel, isolation, files: writes.map(w => w[0]).concat(['status.md', 'streams.json']) });
}

async function verbStatus(projectDir, flags) {
  const g = await refresh(projectDir, flags);
  out(await readIfExists(path.join(g.runDir, 'status.md'), ''));
}

async function verbGate(projectDir, flags) {
  const g = await refresh(projectDir, flags);
  const view = g.scopedGate || g.gate;
  const score = g.scopedScore || g.score;
  const { lines, failing, waitingOnHuman, buildGateMet, gateMet, error } = view;
  out({ runId: g.runId, stream: g.stream, buildGateMet, gateMet, failing, waitingOnHuman, score, corrupt: g.corrupt, paused: !!g.paused, error: error ?? null, next: g.next, lines });
  if (error) process.stderr.write(`marathon: ${error}\n`);
  process.exitCode = buildGateMet ? 0 : 1;
}

async function verbBudget(projectDir, flags) {
  const raw = flags['usage-pct'];
  let usagePctFlag;
  if (raw !== undefined) {
    const n = Number(raw);
    if (raw === true || raw === '' || !Number.isFinite(n) || n < 0 || n > 100) {
      out({ ok: false, reason: `invalid: --usage-pct "${raw === true ? '' : raw}" is not a number between 0 and 100`, usage_pct: null });
      process.exitCode = 1;
      return;
    }
    usagePctFlag = n;
  }
  let helperBudget;
  if (flags['helper-budget'] !== undefined) {
    if (flags['helper-budget'] === true) helperBudget = undefined;           // bare flag → the configured default
    else {
      const hb = Number(flags['helper-budget']);
      if (!isPosInt(hb)) fail(`--helper-budget "${flags['helper-budget']}" must be a positive integer`);
      helperBudget = hb;
    }
  }
  const wantsHelperBudget = flags['helper-budget'] !== undefined;

  const ctx = await loadRun(projectDir, flags, { required: false });
  if (!ctx.runId) {
    // No run: only the token budget can be judged (no ledger → nothing spent); a usage reading still counts.
    const result = canFanOut({ config: ctx.config, helpers: [], usagePct: usagePctFlag });
    if (wantsHelperBudget) result.helper_budget = helperBudgetFor(ctx.config, helperBudget);
    out({ runId: null, ...result });
    process.exitCode = budgetExitCode(result);
    return;
  }
  // A fresh, valid reading on the command line is recorded so later verbs (status, the hooks) see it.
  if (usagePctFlag !== undefined) await append(ctx.runDir, 'measurements', { key: 'usage_pct', value: usagePctFlag });
  let g = await gather(projectDir, flags, { usagePctFlag });
  if (g.paused && usagePctFlag !== undefined && g.rawBudget.ok) {
    // A fresh reading below the ceiling clears the pause.
    await setStream(ctx.runDir, '_meta', { paused: null });
    g = await gather(projectDir, flags, { usagePctFlag });
  } else if (!g.paused && !g.budget.ok && budgetExitCode(g.budget) === 2) {
    await setStream(ctx.runDir, '_meta', { paused: { reason: g.budget.reason, ts: new Date().toISOString() } });
    g = await gather(projectDir, flags, { usagePctFlag });
  }
  await writeStatus(g);
  const result = { runId: g.runId, ...g.budget, paused: !!g.paused };
  if (wantsHelperBudget) result.helper_budget = helperBudgetFor(g.config, helperBudget);
  out(result);
  process.exitCode = budgetExitCode(g.budget);
}

async function verbUnpause(projectDir, flags) {
  const ctx = await loadRun(projectDir, flags);
  await setStream(ctx.runDir, '_meta', { paused: null });
  const g = await refresh(projectDir, flags);
  out({ runId: g.runId, paused: false, budget: g.budget });
}

const RECORD_KINDS = {
  run: 'runs', review: 'reviews', finding: 'findings', 'finding-fixed': 'findings', helper: 'helpers', 'helper-done': 'helpers',
  measure: 'measurements', compaction: 'compactions', escape: 'findings', promotion: 'promotions'
};

async function verbRecord(projectDir, flags, positional) {
  const kind = positional.shift();
  const table = RECORD_KINDS[kind];
  if (!table || typeof kind !== 'string') fail(`usage: cli.js record <${Object.keys(RECORD_KINDS).join('|')}> key=value ... [--json '{...}'] [--cwd <checkout>]`);
  const g = await gather(projectDir, flags);
  let row = rowFromArgs(flags, positional);
  const override = str(flags.cwd);
  requireKnownStream(g, row.stream, `record ${kind}`);

  if (kind === 'helper') {
    if (row.budget !== undefined && !isPosInt(row.budget)) fail('record helper: budget must be a positive integer');
    const { event, helper_id, tokens, outcome, ...rest } = row; // a spawn row is always a spawn row
    row = { role: 'build', model: g.config.models.build, ...rest, event: 'spawn', budget: helperBudgetFor(g.config, row.budget) };
  } else if (kind === 'helper-done') {
    if (!row.helper_id) fail('record helper-done needs helper_id=<id> tokens=<n> [outcome=green|red|escalated]');
    if (!isInt(row.tokens) || row.tokens < 0) fail('record helper-done: tokens must be a non-negative integer (the task notification reports it)');
    if (row.outcome !== undefined && !['green', 'red', 'escalated'].includes(row.outcome)) fail('outcome must be green, red or escalated');
    row = { ...row, event: 'done' };
  } else if (kind === 'review') {
    if (!row.stream) fail('record review needs stream=<name> counts=\'{"high":0,"medium":0,"low":0}\'');
    if ('pass' in row) fail('record review: pass is computed from counts and the tolerance — it cannot be supplied');
    // The ledger has exactly two write paths: a new round, or replaces= of the latest round.
    for (const k of ['id', 'void', 'voided_ts', 'replaced_by']) {
      if (k in row) fail(`record review: ${k} cannot be supplied — a review is never rewritten in place; use replaces=<id> to replace the latest review of the stream`);
    }
    if (!validCounts(row.counts)) fail('record review: counts must be a JSON object with exactly high, medium and low as non-negative integers, e.g. counts=\'{"high":0,"medium":1,"low":2}\'');
    if (g.finishLineError || !g.toleranceValid) fail(`record review: cannot grade a review without a valid tolerance in finish-line.json${g.finishLineError ? ` (${g.finishLineError})` : ''}`);
    const forStream = g.store.reviews.filter(r => r.stream === row.stream);
    if (row.commit !== undefined && !SHA.test(String(row.commit))) fail(`record review: commit "${row.commit}" is not a sha`);
    row.pass = reviewPasses(row.counts, g.finishLine.tolerance);
    if (row.replaces !== undefined) {
      const old = g.store.reviews.find(r => r.id === row.replaces);
      if (!old) fail(`record review: replaces=${row.replaces} is not a live review of this run (already replaced, or unknown)`);
      if (old.stream !== row.stream) fail(`record review: ${row.replaces} belongs to stream ${old.stream}, not ${row.stream}`);
      const latest = forStream[forStream.length - 1];
      if (!latest || latest.id !== old.id) fail(`record review: only the stream's latest review can be replaced (latest is ${latest?.id ?? 'none'}); an older round stays as graded`);
      // The replacement grades the same code the replaced review saw: same round, same commit.
      row.round = old.round;
      row.commit = old.commit;
      // Void first with a pre-generated id: if we die in between, the round is missing, never counted twice.
      const newId = randomUUID();
      await append(g.runDir, 'reviews', { id: old.id, void: true, voided_ts: new Date().toISOString(), replaced_by: newId });
      const written = await append(g.runDir, 'reviews', { ...row, id: newId });
      await refresh(projectDir, flags);
      out(written);
      return;
    }
    row.round = isPosInt(row.round) ? row.round : forStream.length + 1;
    if (!row.commit) {
      const cwd = await cwdFor(projectDir, g.streams, row.stream, { override });
      row.commit = gitStrict(['rev-parse', '--short', 'HEAD'], cwd).trim();
    }
  } else if (kind === 'finding' || kind === 'escape') {
    if (kind === 'escape') row.found_by = 'owner';
    if (row.id !== undefined && foldFindings(g.store.findings).some(f => f.id === row.id)) {
      fail(`record ${kind}: finding ${row.id} already exists — use record finding-fixed to close it; a finding is never rewritten`);
    }
    if (!row.stream && row.review_id) row.stream = g.store.reviews.find(r => r.id === row.review_id)?.stream;
    if (!row.stream) fail(`record ${kind}: stream is unknown — pass stream=<name> or a review_id that belongs to a stream`);
    requireKnownStream(g, row.stream, `record ${kind}`);
    row = normalizeFinding({ severity: 'medium', category: 'other', title: '(untitled)', ...row, status: 'open' }, g.config);
  } else if (kind === 'finding-fixed') {
    if (!row.id) fail('record finding-fixed needs id=<finding id> [commit=<sha>]');
    const existing = foldFindings(g.store.findings).find(f => f.id === row.id);
    if (!existing) fail(`record finding-fixed: no finding with id ${row.id}`);
    if (row.commit !== undefined && !SHA.test(String(row.commit))) fail(`record finding-fixed: commit "${row.commit}" is not a sha`);
    // Closing a finding needs no checkout: the commit is a courtesy, not a requirement.
    const commit = row.commit || (override ? git(['rev-parse', '--short', 'HEAD'], path.resolve(projectDir, override)) : null) || null;
    row = { id: row.id, status: 'fixed', fixed_ts: new Date().toISOString(), commit };
  } else if (kind === 'measure') {
    if (!row.key) fail('record measure needs key=<id> value=<n>');
    if (row.key === 'usage_pct') {
      const v = Number(row.value);
      if (row.value === '' || row.value === null || typeof row.value === 'boolean' || !Number.isFinite(v) || v < 0 || v > 100) {
        fail(`record measure usage_pct: "${row.value}" is not a number between 0 and 100`);
      }
      row.value = v;
    }
  } else if (kind === 'run') {
    if (!['unit', 'e2e', 'build'].includes(row.kind)) fail('record run needs kind=unit|e2e|build');
    if (!['green', 'red'].includes(row.status)) fail('record run needs status=green|red — a run without a result is not a pass');
    if (row.commit !== undefined && !SHA.test(String(row.commit))) fail(`record run: commit "${row.commit}" is not a sha`);
    if (!row.commit) row.commit = git(['rev-parse', '--short', 'HEAD'], await cwdFor(projectDir, g.streams, row.stream, { override })) || null;
  }

  const written = await append(g.runDir, table, row);
  await refresh(projectDir, flags);
  out(written);
}

async function verbRepair(projectDir, flags) {
  const ctx = await loadRun(projectDir, flags);
  const results = [];
  let removed = 0;
  for (const t of TABLES) {
    const r = await repairTable(ctx.runDir, t);
    if (r.removed) results.push(r);
    removed += r.removed;
  }
  const g = await refresh(projectDir, flags);
  out({ runId: g.runId, removed, tables: results, quarantine: results.map(r => `store/${r.table}.jsonl.corrupt`), corrupt_after: g.corrupt });
}

async function verbPromote(projectDir, flags, positional) {
  const category = positional[0];
  if (!category || typeof category !== 'string' || !flags.kind || !flags.ref) fail('usage: cli.js promote <category> --kind test|scan|fixture|rule --ref <path>');
  if (!['test', 'scan', 'fixture', 'rule'].includes(flags.kind)) fail('promote: --kind must be test, scan, fixture or rule');
  const g = await gather(projectDir, flags);
  const row = await append(g.runDir, 'promotions', { category, kind: flags.kind, ref: flags.ref, area: flags.area || null });
  out(row);
}

async function verbSeenTwice(projectDir, flags) {
  const g = await gather(projectDir, flags);
  out(seenTwice(g.store.findings, g.store.promotions));
}

/**
 * Where a review's diff starts: an explicit --base; else the HEAD certified by the last COMPLETED
 * clean streak of this stream (passes_in_a_row clean rounds in a row — certified code is not
 * re-read); else the stream's base. An over round certifies nothing and never narrows the next review.
 */
function reviewBase(reviews, stream, streamRow, flagBase, needed) {
  if (flagBase) return { base: flagBase, why: 'given base' };
  const forStream = reviews.filter(r => r.stream === stream);
  let streak = 0, certified = null;
  for (const r of forStream) {
    if (r.pass === true) {
      streak += 1;
      if (streak >= needed && r.commit) { certified = r.commit; streak = 0; }
    } else {
      streak = 0;
    }
  }
  if (certified) return { base: certified, why: `the last completed clean streak (${needed} clean rounds certified that code; it is not re-read)` };
  if (streamRow?.base) return { base: streamRow.base, why: forStream.length ? 'the stream base — nothing is certified until a clean streak completes, so every round sees the same code' : 'the stream base' };
  return { base: null, why: null };
}

/**
 * Scrub the project's known secrets (.claude/kit/secrets) from text that is about to go to a model.
 * The kit is optional: its redact module is imported dynamically, so marathon works without it when there is
 * no secrets file. Once a secrets file is present (in any form, even a dangling symlink) redaction fails CLOSED:
 * an unreachable or malformed file, or a missing kit, stops the command naming what is missing (never a value).
 * Returns { text, count, active }: active is false only when there is no secrets file.
 */
async function redactForModel(projectDir, text) {
  const rel = path.join('.claude', 'kit', 'secrets');
  const secretsFile = path.join(projectDir, rel);
  try { await fs.lstat(secretsFile); } catch (e) {
    if (e?.code === 'ENOENT') return { text, count: 0, active: false };
    fail(`review-brief: ${rel} cannot be checked (${e?.code || 'stat failed'}) — refusing to emit an unredacted diff`);
  }
  let mod;
  try { mod = await import('../kit/redact.js'); } catch (e) {
    fail(`review-brief: ${rel} exists but the kit redact module (.claude/helpers/kit/redact.js) cannot be loaded (${e?.code || 'import failed'}) — install the kit plugin or remove the secrets file; refusing to emit an unredacted diff`);
  }
  let content;
  try { content = await fs.readFile(secretsFile, 'utf-8'); } catch (e) {
    fail(`review-brief: cannot read ${rel} (${e?.code || 'read failed'}) — refusing to emit an unredacted diff`);
  }
  let secrets;
  try { secrets = mod.parseSecretsFile(content); } catch (e) {
    fail(`review-brief: ${rel} is malformed (${e?.message || 'parse failed'})`);
  }
  const r = mod.redactSecrets(text, secrets, { keepLines: true });
  return { text: r.text, count: r.replaced, active: true };
}

async function verbReviewBrief(projectDir, flags) {
  const stream = str(flags.stream);
  if (!stream) fail('usage: cli.js review-brief --stream <name> [--base <commit>] [--cwd <worktree>]');
  const g = await gather(projectDir, flags);
  const streamRow = g.streams.find(s => s.name === stream);
  const cwd = await cwdFor(projectDir, g.streams, stream, { override: str(flags.cwd) });
  const forStream = g.store.reviews.filter(r => r.stream === stream);
  const round = isPosInt(Number(flags.round)) ? Number(flags.round) : forStream.length + 1;
  const kit = path.join(runsDirOf(projectDir, g.config), 'reviewer');
  const anglesMd = await readIfExists(path.join(kit, 'angles.md'), '');
  const severityMd = await readIfExists(path.join(kit, 'severity.md'), '# Severity\nhigh · medium · low');
  const angle = pickAngle(round);
  const { base, why } = reviewBase(g.store.reviews, stream, streamRow, str(flags.base) || null, g.score.needed);
  if (!base) fail(`review-brief: stream ${stream} has no base commit — set it active with \`cli.js stream ${stream} state=active\` (records the base) or pass --base <sha>`);
  if (!SHA.test(String(base))) fail(`review-brief: base "${base}" is not a commit sha`);
  const head = gitStrict(['rev-parse', 'HEAD'], cwd).trim();
  const range = `${base}..HEAD`;
  let diff = gitStrict(['diff', '--end-of-options', range, '--', ...DIFF_EXCLUDES], cwd);
  // Redact the whole diff before it is truncated, so a cut can never leave half a secret behind.
  const first = await redactForModel(projectDir, diff);
  diff = first.text;
  const stat = gitStrict(['diff', '--stat', '--end-of-options', range], cwd);
  // Excluded files are never inlined, but the reviewer must know they changed (a dependency swap
  // or a weakened snapshot hides there).
  const excludedStat = gitStrict(['diff', '--stat', '--end-of-options', range, '--', ...DIFF_EXCLUDES.map(e => e.replace(':(exclude,glob)', ':(glob)'))], cwd).trim();
  if (!diff.trim()) {
    if (!stat.trim()) fail(`review-brief: empty diff for ${range} in ${path.relative(projectDir, cwd) || '.'} — nothing to review; commit the stream's changes or check its base`);
    diff = `(only generated or lock files changed — excluded from the inline diff)\n\n${stat}`;
  } else if (diff.length > DIFF_INLINE_MAX) {
    const omitted = diff.length - DIFF_INLINE_MAX;
    diff = `${stat}\n\n[diff truncated: ${omitted.toLocaleString('en-US')} chars omitted — the --stat list above is complete; read the files directly]\n\n${diff.slice(0, DIFF_INLINE_MAX)}`;
  }
  if (excludedStat) {
    diff += `\n\n## Changed but excluded from the inline diff (lock files, snapshots, generated assets) — inspect directly\n\n${excludedStat}`;
  }
  // Second pass over the assembled text (file names in the stat lists can carry a value too).
  const second = await redactForModel(projectDir, diff);
  diff = second.text;
  const redacted = first.count + second.count;
  const redactNote = (first.active ? `Redacted ${redacted} secret value${redacted === 1 ? '' : 's'} from the diff (.claude/kit/secrets).` : null);
  const brief = renderBrief({
    stream, round, angle, severityMd, diff,
    tolerance: g.finishLine.tolerance || {}, categories: g.config.review.categories
  });
  const scope = `Scope: diff since ${why} (${range}, HEAD = ${head}) in ${path.relative(projectDir, cwd) || '.'}. Lock files and generated assets are excluded from the inline diff and listed separately. Record the review with commit=${head.slice(0, 7)}.\n` +
    (anglesMd ? `\nFull angle list: ${path.relative(projectDir, path.join(kit, 'angles.md'))}\n` : '') +
    (redactNote ? `\n${redactNote}\n` : '');
  out(`${brief}\n\n${scope}`);
}

/** The findings that belong to a review, following the replaces chain back through voided reviews. */
function findingsOfReview(review, rawReviews, findings) {
  const ids = new Set([review.id]);
  let cur = review;
  while (cur?.replaces && !ids.has(cur.replaces)) {
    ids.add(cur.replaces);
    cur = rawReviews.find(r => r.id === cur.replaces && !r.void);
  }
  return foldFindings(findings).filter(f => ids.has(f.review_id));
}

async function verbReviewWriteup(projectDir, flags) {
  const id = str(flags.review);
  if (!id) fail('usage: cli.js review-writeup --review <id>');
  const g = await gather(projectDir, flags);
  const review = g.store.reviews.find(r => r.id === id);
  if (!review) fail(`review ${id} not found (or replaced — write up the replacing review)`);
  if (!NAME.test(String(review.stream))) fail(`review ${review.id} has an invalid stream name "${review.stream}"`);
  const findings = findingsOfReview(review, g.rawReviews, g.store.findings);
  // Scripts decide: the recorded counts must equal the rows, or the write-up is refused.
  const actual = { high: 0, medium: 0, low: 0 };
  for (const f of findings) if (actual[f.severity] !== undefined) actual[f.severity] += 1;
  const mismatch = SEVERITIES.filter(s => (review.counts?.[s] ?? 0) !== actual[s]);
  if (mismatch.length) {
    fail(`review-writeup: counts mismatch for ${mismatch.join(', ')} — recorded ${JSON.stringify(review.counts)} but the finding rows give ${JSON.stringify(actual)}. Record the missing finding rows, or replace this review with the right counts: cli.js record review stream=${review.stream} counts='${JSON.stringify(actual)}' replaces=${review.id} (one review per round — never a second row for the same round).`);
  }
  const md = renderWriteup(review, findings);
  const dest = path.join(g.runDir, 'reviews', `${review.stream}-r${review.round}-${String(review.id).slice(0, 8)}.md`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, md, 'utf-8');
  out({ path: path.relative(projectDir, dest), findings: findings.length, pass: review.pass });
}

async function readHookInput() {
  if (process.stdin.isTTY) return {};
  return new Promise(resolve => {
    let s = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', d => { s += d; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve({}); } });
    process.stdin.on('error', () => resolve({}));
    setTimeout(() => resolve({}), 1500).unref();
  });
}

async function verbHandoff(projectDir, flags) {
  const ctx = await loadRun(projectDir, flags, { required: false });
  if (!ctx.runId) return; // no active run: nothing to stamp, exit 0 silently
  const hook = flags['from-hook'] ? await readHookInput() : {};
  const trigger = str(flags.trigger) || hook.trigger || 'manual';
  const transcript = str(flags.transcript) || hook.transcript_path || null;

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], projectDir) || 'unknown';
  const commit = git(['rev-parse', '--short', 'HEAD'], projectDir) || 'unknown';
  const uncommitted = git(['status', '--porcelain'], projectDir).split('\n').filter(Boolean).length;
  const streams = realStreams(await readStreams(ctx.runDir));
  const tasks = streams.flatMap(s => Array.isArray(s.tasks) ? s.tasks : []);

  let tokens = null, pct = null;
  if (transcript) {
    const m = measureTranscript(await readIfExists(transcript, ''));
    if (m) { tokens = m.tokens; pct = Math.round(contextPct(tokens, ctx.config.bc.context_window) * 10) / 10; }
  }

  const handoff = await stampHandoff(ctx.runDir, { trigger, branch, commit, uncommitted, tasks, context_tokens: tokens, context_pct: pct });
  const active = streams.find(s => s.state === 'active');
  await append(ctx.runDir, 'compactions', { trigger, tokens, pct, stream: active?.name || null, decision: str(flags.decision) || null });
  await refresh(projectDir, flags);
  out(handoff);
}

async function verbResume(projectDir, flags) {
  const quiet = !!flags['if-active'];
  let idleMin = null;
  if (flags['idle-minutes'] !== undefined) {
    const n = Number(flags['idle-minutes']);
    if (flags['idle-minutes'] === true || flags['idle-minutes'] === '' || !Number.isFinite(n) || n < 0) {
      fail(`--idle-minutes "${flags['idle-minutes'] === true ? '' : flags['idle-minutes']}" must be a number of minutes ≥ 0`);
    }
    idleMin = n;
  }
  const ctx = await loadRun(projectDir, flags, { required: false });
  if (!ctx.runId) {
    if (!quiet) out('No marathon run is active in this project. Nothing to resume — start one with /w-marathon <finish line>, or continue the current task from .claude/plans/STATUS.md if it exists.');
    return;
  }
  const all = await readStreams(ctx.runDir);
  const meta = metaOf(all);
  const streams = realStreams(all);
  const active = streams.find(s => s.state === 'active') || null;
  const nextQueued = streams.find(s => s.state === 'queued') || null;
  const blocked = streams.filter(s => s.state === 'blocked');
  const allDone = streams.length > 0 && !active && !nextQueued;
  if (quiet) {
    if (meta?.finished || meta?.paused) return;        // a finished or paused run says nothing
    if (streams.length === 0) return;                   // nothing set up yet says nothing
    // A done-but-unfinished run must still reach CHECKPOINT 5 (gate, finish), so it speaks.
    if (idleMin !== null) {
      // A live session rewrites status.md after every step; a fresh file means it is still working.
      const m = await mtimeMs(path.join(ctx.runDir, 'status.md'));
      if (m !== null && Date.now() - m < idleMin * 60_000) return;
    }
  }
  out(resumeLine({ runId: ctx.runId, runDirRel: ctx.runDirRel, activeStream: active, nextQueued, blocked, allDone, isolation: meta?.isolation || 'worktree', plain: !!flags.plain }));
}

async function verbKeeplist(projectDir, flags) {
  const ctx = await loadRun(projectDir, flags, { required: false });
  const lastCommit = git(['rev-parse', '--short', 'HEAD'], projectDir) || null;
  if (!ctx.runId) {
    // /bc in an ordinary project: keep the plan-level status and rules if they exist, nothing else.
    const keep = ['the current task and its next step'];
    for (const f of ['.claude/plans/STATUS.md', '.claude/plans/RULES.md']) {
      if (await readIfExists(path.join(projectDir, f)) !== null) keep.push(f);
    }
    if (lastCommit) keep.push(`last commit ${lastCommit}`);
    out(`/compact Keep: ${keep.join('; ')}. Drop tool output, finished work and file contents.`);
    return;
  }
  const g = await gather(projectDir, flags);
  out(buildKeepList({
    runId: g.runId,
    kickoffPath: path.join(g.runDirRel, 'kickoff.md'),
    rulesPath: path.join(g.runDirRel, 'rules.md'),
    streams: g.streams,
    findings: foldFindings(g.store.findings),
    lastCommit,
    runningTasks: g.streams.flatMap(s => Array.isArray(s.tasks) ? s.tasks : [])
  }));
}

function transcriptDirFor(launchDir) {
  // Claude Code names the project folder after the directory the session was launched in,
  // replacing every non-alphanumeric character with '-'.
  return path.join(os.homedir(), '.claude', 'projects', launchDir.replace(/[^a-zA-Z0-9]/g, '-'));
}

async function latestTranscript(dir) {
  try {
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.jsonl'));
    const stats = await Promise.all(files.map(async f => ({ f, m: (await fs.stat(path.join(dir, f))).mtimeMs })));
    stats.sort((a, b) => b.m - a.m);
    return stats.length ? path.join(dir, stats[0].f) : null;
  } catch { return null; }
}

async function verbContext(projectDir, flags) {
  const config = await loadConfig(projectDir);
  const launchDir = process.env.CLAUDE_PROJECT_DIR || LAUNCH_DIR;
  const dir = transcriptDirFor(launchDir);
  const transcript = str(flags.transcript) || await latestTranscript(dir);
  if (!transcript) fail(`no transcript found under ${dir} — pass --transcript <path> (the PreCompact hook receives it as transcript_path)`);
  const text = await readIfExists(transcript);
  if (text === null) fail(`transcript not found or not readable: ${transcript}`);
  const m = measureTranscript(text);
  if (!m) fail(`no assistant usage records in ${transcript}`);
  const window = flags.window ? Number(flags.window) : config.bc.context_window;
  if (!(Number.isFinite(window) && window > 0)) fail(`context window "${flags.window ?? config.bc.context_window}" is not a positive number`);
  const pct = Math.round(contextPct(m.tokens, window) * 10) / 10;
  const decision = decide(pct, config.bc, { streamFinished: !!flags['stream-finished'] });
  out({ transcript, tokens: m.tokens, input: m.input, cache_creation: m.cache_creation, cache_read: m.cache_read, window, pct, decision,
    thresholds: { prune_below_pct: config.bc.prune_below_pct, clear_above_pct: config.bc.clear_above_pct },
    note: `newest transcript under ${dir} — another concurrent session may own it; prefer --transcript` });
}

async function verbWake(projectDir, flags) {
  const ctx = await loadRun(projectDir, flags);
  if (flags.fallback) {
    const cliRel = path.relative(projectDir, path.join(__dirname, 'cli.js'));
    const claudePath = which('claude');
    const s = fallbackSnippets({ projectDir, runId: ctx.runId, cliRel, runsRel: ctx.config.paths.runs, nodePath: process.execPath, claudePath });
    const found = claudePath ? `claude: ${claudePath}` : 'claude: NOT FOUND on this machine\'s PATH — install it or the fallback will only log "claude not found"';
    out(`# crontab -e (every 30 minutes; quiet while a live session is writing status.md, silent once PAUSED or after cli.js finish)\n# node: ${process.execPath}\n# ${found}\n${s.crontab}\n\n# launchd: save as ~/Library/LaunchAgents/com.danizee.marathon.${ctx.runId}.plist then launchctl load it\n${s.launchd}\n\n# Headless claude -p stops at the first Bash command that is not in permissions.allow — allow your test/build commands in .claude/settings.json first.`);
    return;
  }
  out(cronSpec({ runId: ctx.runId, runDirRel: ctx.runDirRel, schedule: str(flags.schedule) }));
}

async function verbPage(projectDir, flags) {
  const g = await gather(projectDir, flags);
  const html = renderPage({ runId: g.runId, gate: g.gate, streams: g.streams, reviews: g.store.reviews, helpers: g.store.helpers });
  const dest = path.join(g.runDir, 'page.html');
  await fs.writeFile(dest, html, 'utf-8');
  out({ path: path.relative(projectDir, dest), bytes: html.length });
}

async function verbShadowCheck(projectDir, flags) {
  const shortcutsDir = path.join(projectDir, '.claude', 'commands', '.shortcuts');
  let names = [];
  try { names = (await fs.readdir(shortcutsDir)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)); } catch {}
  const home = str(flags.home) || os.homedir();
  const colliding = await checkShadowing(path.join(home, '.claude', 'commands'), names);
  out({ commandsDir: path.join(home, '.claude', 'commands'), colliding });
  process.exitCode = colliding.length ? 1 : 0;
}

async function verbStream(projectDir, flags, positional) {
  const name = positional.shift();
  if (typeof name !== 'string' || !name) fail('usage: cli.js stream <name> key=value ... (state=queued|active|blocked|done phase=... skill=... next=... tasks=a,b isolation=<path>)');
  if (name === '_meta') fail('_meta is the run row, not a stream');
  if (!NAME.test(name)) fail(`stream name "${name}" must be letters, digits, dashes or underscores`);
  const ctx = await loadRun(projectDir, flags);
  const patch = rowFromArgs(flags, positional);
  if (patch.state !== undefined && !['queued', 'active', 'blocked', 'done'].includes(patch.state)) fail('stream: state must be queued, active, blocked or done');
  if (patch.base !== undefined && !SHA.test(String(patch.base))) fail(`stream: base "${patch.base}" is not a commit sha`);
  const streams = await readStreams(ctx.runDir);
  const existing = streams.find(s => s.name === name) || {};
  const merged = { ...existing, ...patch, name };
  if (patch.isolation !== undefined) {
    const p = path.isAbsolute(patch.isolation) ? patch.isolation : path.join(projectDir, patch.isolation);
    if (!(await isDir(p))) fail(`stream: isolation path ${patch.isolation} does not exist — create the worktree first`);
  }
  // Habit 7: one worktree per stream. In worktree mode a stream cannot go active without one,
  // or its "diff" would be the main checkout — including the previous reviewer's own findings.
  const mode = metaOf(streams)?.isolation || ctx.config.streams.isolation;
  if (patch.state === 'active' && mode === 'worktree' && !merged.isolation && !flags['no-isolation']) {
    fail(`stream ${name}: this run isolates streams in worktrees — create one (\`git worktree add ../<repo>-${name} -b marathon/${ctx.runId}/${name}\`) and pass isolation=<path>, or pass --no-isolation to build this stream in the main checkout on purpose`);
  }
  // The first review of a stream diffs from where the stream started, not from HEAD~1.
  if (patch.state === 'active' && !merged.base) {
    const cwd = await cwdFor(projectDir, [merged], name);
    const base = gitStrict(['rev-parse', 'HEAD'], cwd).trim();
    if (base) patch.base = base;
  }
  const updated = await setStream(ctx.runDir, name, patch);
  await refresh(projectDir, flags);
  out(updated);
}

async function verbFinish(projectDir, flags) {
  const ctx = await loadRun(projectDir, flags);
  await setStream(ctx.runDir, '_meta', { state: 'meta', finished: new Date().toISOString() });
  const activeFile = path.join(runsDirOf(projectDir, ctx.config), 'ACTIVE');
  const current = await activeRunId(projectDir, ctx.config);
  if (current === ctx.runId) { try { await fs.unlink(activeFile); } catch {} }
  // ACTIVE is gone now, so the re-render must name the run explicitly.
  const g = await refresh(projectDir, { ...flags, run: ctx.runId });
  out({ runId: g.runId, state: 'FINISHED', gateMet: g.gate.gateMet, buildGateMet: g.gate.buildGateMet, waitingOnHuman: g.gate.waitingOnHuman });
}

async function verbRoute(projectDir, flags, positional) {
  const config = await loadConfig(projectDir);
  const signals = rowFromArgs(flags, positional);
  const cls = classifyBuild(signals, config);
  const model = modelFor(config, cls);
  out({ class: cls, model, next: nextTier(config, model), ladder: config.models.ladder, signals });
}

async function verbModelStats(projectDir, flags) {
  const g = await gather(projectDir, flags);
  out({ runId: g.runId, models: modelStats(g.store.helpers) });
}

const VERBS = {
  init: verbInit, status: verbStatus, gate: verbGate, budget: verbBudget, unpause: verbUnpause, record: verbRecord, repair: verbRepair,
  promote: verbPromote, 'seen-twice': verbSeenTwice, 'review-brief': verbReviewBrief,
  'review-writeup': verbReviewWriteup, handoff: verbHandoff, resume: verbResume, keeplist: verbKeeplist,
  context: verbContext, wake: verbWake, page: verbPage, 'shadow-check': verbShadowCheck, stream: verbStream,
  finish: verbFinish, route: verbRoute, 'model-stats': verbModelStats
};

async function main() {
  const { verb, flags, positional } = parseArgs(process.argv.slice(2));
  const fn = VERBS[verb];
  if (!fn) {
    process.stderr.write(`usage: cli.js <${Object.keys(VERBS).join('|')}> [--run <id>] [flags]\n`);
    process.exitCode = 1;
    return;
  }
  const projectDir = str(flags.project) ? path.resolve(flags.project) : resolveProjectDir(LAUNCH_DIR);
  try {
    await fn(projectDir, flags, positional);
  } catch (err) {
    process.stderr.write(`marathon: ${err.message}\n`);
    process.exitCode = err instanceof CliExit ? err.code : 1;
  }
}

// exitCode, never process.exit(): a pipe may still be flushing a large JSON result.
main();
