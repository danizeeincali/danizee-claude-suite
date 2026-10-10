#!/usr/bin/env node
/**
 * /bc helper CLI for Danizee Claude Suite
 * `node .claude/helpers/bc/cli.js <verb> [flags]`  (or ~/.claude/helpers/bc/cli.js, the user-level copy)
 *
 * The /bc command and the two compaction hooks call these verbs, so a compaction loses nothing
 * whether /bc asked for it or Claude Code ran it automatically. Files and thresholds come from
 * the project's .claude/bc.json (see config.js).
 *
 * While a marathon run is active the run owns the handoff: keeplist, resume, handoff and record are
 * handed to the marathon CLI, and the hook verbs stay silent when the project has marathon's own hooks installed, so a
 * compaction is never stamped or announced twice.
 *
 * Verbs:
 *   config                     resolved config, whether bc.json exists, whether a marathon run is active
 *   context [--transcript p] [--stream-finished] [--window n]
 *                              {tokens, pct, decision: none|compact|clear}
 *   keeplist                   one ready-to-run "/compact ..." line
 *   resume [--plain] [--if-active]
 *                              the resume line (+ the active stream's row unless --plain)
 *   handoff [--from-hook] [--trigger manual|auto|bc] [--transcript p]
 *                              stamp the status file, record the compaction
 *   record compaction trigger=.. tokens=.. pct=.. decision=.. [stream=..]
 *                              append a row to the results file
 *
 * Exit codes: 0 ok · 1 invalid input or broken config.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { loadBcConfig } from './config.js';
import { parseStatusTable, activeStream, buildKeepList, resumeLine, stampStatus } from './statusfile.js';
import { measureTranscript, contextPct, decide } from '../marathon/context.js';
import { loadConfig as loadMarathonConfig, activeRunId } from '../marathon/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Where the session was launched: transcripts are keyed by this, not by the resolved state dir.
const LAUNCH_DIR = process.cwd();
const TRIGGERS = ['manual', 'auto', 'bc'];
const DECISIONS = ['none', 'compact', 'clear'];

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
    } else if (a.includes('=')) {
      const [k, ...v] = a.split('=');
      positional.push([k, v.join('=')]);
    } else {
      positional.push(a);
    }
  }
  return { verb, flags, positional };
}

function out(obj) {
  process.stdout.write((typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) + '\n');
}

function fail(msg, code = 1) {
  throw new CliExit(msg, code);
}

const str = (v) => (typeof v === 'string' && v !== '' ? v : undefined);

function git(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}

/**
 * State lives in the project's main checkout: a linked worktree maps onto the same place in main,
 * as the marathon CLI does, so a stream's worktree and the main session share one status file.
 */
function resolveProjectDir(cwd) {
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  if (!top) return cwd;
  const common = git(['rev-parse', '--git-common-dir'], cwd);
  if (!common) return cwd;
  const commonAbs = path.resolve(cwd, common);
  const mainTop = path.basename(commonAbs) === '.git' ? path.dirname(commonAbs) : top;
  if (path.resolve(top) === path.resolve(mainTop)) return cwd;
  return path.join(mainTop, path.relative(top, cwd));
}

async function readIfExists(p, fallback = null) {
  try { return await fs.readFile(p, 'utf-8'); } catch { return fallback; }
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
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

// ---------------------------------------------------------------------------
// marathon hand-over
// ---------------------------------------------------------------------------

async function marathonRun(projectDir) {
  try {
    const cfg = await loadMarathonConfig(projectDir);
    return await activeRunId(projectDir, cfg);
  } catch {
    return null;
  }
}

/** The project's own marathon CLI, else the copy installed beside this one. */
async function marathonCli(projectDir) {
  const own = path.join(projectDir, '.claude', 'helpers', 'marathon', 'cli.js');
  if (await exists(own)) return { cli: own, projectHooks: await exists(path.join(projectDir, '.claude', 'hooks', 'marathon-precompact.sh')) };
  const sibling = path.join(__dirname, '..', 'marathon', 'cli.js');
  if (await exists(sibling)) return { cli: sibling, projectHooks: false };
  return null;
}

/**
 * Hand a verb to the marathon CLI when a run is active. Returns true when handled.
 * Hook calls (--from-hook / --if-active) return silently when the project's marathon hooks
 * will do the same work, so nothing is stamped or printed twice.
 */
async function delegate(projectDir, verb, argv, flags) {
  if (flags['no-marathon']) return false;
  if (!(await marathonRun(projectDir))) return false;
  const m = await marathonCli(projectDir);
  if (!m) return false;
  const hookCall = !!(flags['from-hook'] || flags['if-active']);
  if (hookCall && m.projectHooks) return true;
  const r = spawnSync(process.execPath, [m.cli, verb, ...argv, '--project', projectDir], {
    cwd: LAUNCH_DIR, encoding: 'utf-8', input: flags['from-hook'] ? JSON.stringify(flags.__hook || {}) : undefined,
    maxBuffer: 64 * 1024 * 1024
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.status ?? 1;
  return true;
}

// ---------------------------------------------------------------------------
// shared reads
// ---------------------------------------------------------------------------

async function loadStatus(projectDir, config) {
  const md = await readIfExists(path.join(projectDir, config.status));
  return { md, rows: md === null ? [] : parseStatusTable(md) };
}

async function existing(projectDir, rel) {
  return rel && (await exists(path.join(projectDir, rel))) ? rel : null;
}

async function appendRow(projectDir, config, row) {
  const file = path.join(projectDir, config.db);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n', 'utf-8');
  return path.relative(projectDir, file);
}

/**
 * Hooks act only in a project that keeps a /bc handoff: a .claude/bc.json, or the default status
 * file. A user-level hook in any other project does nothing.
 */
async function hookApplies(projectDir, loaded) {
  return loaded.configured || (await exists(path.join(projectDir, loaded.config.status)));
}

// ---------------------------------------------------------------------------
// verbs
// ---------------------------------------------------------------------------

async function verbConfig(projectDir) {
  const loaded = await loadBcConfig(projectDir);
  const run = await marathonRun(projectDir);
  const files = {};
  for (const k of ['status', 'kickoff', 'rules', 'memory', 'db']) {
    if (loaded.config[k]) files[k] = { path: loaded.config[k], exists: await exists(path.join(projectDir, loaded.config[k])) };
  }
  out({ projectDir, configured: loaded.configured, configFile: path.relative(projectDir, loaded.file), marathonRun: run, config: loaded.config, files });
}

async function verbContext(projectDir, flags) {
  const { config } = await loadBcConfig(projectDir);
  const launchDir = process.env.CLAUDE_PROJECT_DIR || LAUNCH_DIR;
  const dir = transcriptDirFor(launchDir);
  const transcript = str(flags.transcript) || await latestTranscript(dir);
  if (!transcript) fail(`no transcript found under ${dir} — pass --transcript <path>`);
  const text = await readIfExists(transcript);
  if (text === null) fail(`transcript not found or not readable: ${transcript}`);
  const m = measureTranscript(text);
  if (!m) fail(`no assistant usage records in ${transcript}`);
  const window = flags.window !== undefined ? Number(flags.window) : config.context_window;
  if (!(Number.isFinite(window) && window > 0)) fail(`context window "${flags.window}" is not a positive number`);
  const pct = Math.round(contextPct(m.tokens, window) * 10) / 10;
  const decision = decide(pct, config, { streamFinished: !!flags['stream-finished'] });
  out({ transcript, tokens: m.tokens, input: m.input, cache_creation: m.cache_creation, cache_read: m.cache_read, window, pct, decision,
    thresholds: { prune_below_pct: config.prune_below_pct, clear_above_pct: config.clear_above_pct } });
}

async function verbKeeplist(projectDir) {
  const { config } = await loadBcConfig(projectDir);
  const { md, rows } = await loadStatus(projectDir, config);
  const lastCommit = git(['rev-parse', '--short', 'HEAD'], projectDir) || null;
  if (md === null) {
    const keep = ['the current task and its next step'];
    const rules = await existing(projectDir, config.rules);
    if (rules) keep.push(`rules in ${rules}`);
    if (lastCommit) keep.push(`last commit ${lastCommit}`);
    out(`/compact Keep only: ${keep.join('; ')}. Drop tool output, finished work and file contents. (No status file at ${config.status} — write one before the next /bc.)`);
    return;
  }
  out(buildKeepList({
    kickoff: await existing(projectDir, config.kickoff),
    status: config.status,
    rules: await existing(projectDir, config.rules),
    rows,
    lastCommit
  }));
}

async function verbResume(projectDir, flags) {
  const loaded = await loadBcConfig(projectDir);
  const { config } = loaded;
  const quiet = !!flags['if-active'];
  if (quiet && !(await hookApplies(projectDir, loaded))) return;
  const { md, rows } = await loadStatus(projectDir, config);
  if (md === null) {
    if (!quiet) out(`No status file at ${config.status}. Nothing to resume from — continue the current task, and let the next /bc write the status file.`);
    return;
  }
  out(resumeLine({
    kickoff: await existing(projectDir, config.kickoff),
    status: config.status,
    rules: await existing(projectDir, config.rules),
    memory: await existing(projectDir, config.memory),
    row: activeStream(rows),
    plain: !!flags.plain
  }));
}

async function verbHandoff(projectDir, flags) {
  const loaded = await loadBcConfig(projectDir);
  const { config } = loaded;
  const hook = flags.__hook || {};
  if (flags['from-hook'] && !(await hookApplies(projectDir, loaded))) return;
  const trigger = str(flags.trigger) || str(hook.trigger) || 'manual';
  if (!TRIGGERS.includes(trigger)) fail(`handoff: trigger must be one of ${TRIGGERS.join(', ')}`);
  const transcript = str(flags.transcript) || str(hook.transcript_path) || null;

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], projectDir) || 'unknown';
  const commit = git(['rev-parse', '--short', 'HEAD'], projectDir) || 'unknown';
  const uncommitted = git(['status', '--porcelain'], projectDir).split('\n').filter(Boolean).length;

  let tokens = null, pct = null;
  if (transcript) {
    const m = measureTranscript(await readIfExists(transcript, ''));
    if (m) { tokens = m.tokens; pct = Math.round(contextPct(tokens, config.context_window) * 10) / 10; }
  }

  const statusFile = path.join(projectDir, config.status);
  const { md, rows } = await loadStatus(projectDir, config);
  const open = rows.filter(r => !r.finished);
  const tasks = [...new Set(open.flatMap(r => r.tasks))];
  const stream = activeStream(rows)?.name || null;
  const ts = new Date().toISOString();
  await fs.mkdir(path.dirname(statusFile), { recursive: true });
  const base = md ?? '# Status\n\n| Stream | Where | Plan | State | Next | Tasks |\n|---|---|---|---|---|---|\n';
  await fs.writeFile(statusFile, stampStatus(base, { ts, trigger, branch, commit, uncommitted, tasks, pct }), 'utf-8');

  const db = await appendRow(projectDir, config, { event: 'compaction', trigger, tokens, pct, stream, decision: str(flags.decision) || null, branch, commit });
  out({ ts, trigger, branch, commit, uncommitted, tasks, stream, context_tokens: tokens, context_pct: pct, status: config.status, db });
}

async function verbRecord(projectDir, flags, positional) {
  const kind = positional.shift();
  if (kind !== 'compaction') fail('usage: cli.js record compaction trigger=manual|auto|bc tokens=<n> pct=<n> decision=none|compact|clear [stream=<name>]');
  const { config } = await loadBcConfig(projectDir);
  const row = { event: 'compaction' };
  for (const p of positional) {
    if (!Array.isArray(p)) fail(`record: "${p}" is not key=value`);
    row[p[0]] = p[1];
  }
  row.trigger = row.trigger || 'bc';
  if (!TRIGGERS.includes(row.trigger)) fail(`record: trigger must be one of ${TRIGGERS.join(', ')}`);
  if (row.decision !== undefined && !DECISIONS.includes(row.decision)) fail(`record: decision must be one of ${DECISIONS.join(', ')}`);
  for (const k of ['tokens', 'pct']) {
    if (row[k] === undefined) continue;
    const n = Number(row[k]);
    if (!Number.isFinite(n) || n < 0) fail(`record: ${k} "${row[k]}" must be a number ≥ 0`);
    row[k] = n;
  }
  if (row.stream === undefined) {
    const { rows } = await loadStatus(projectDir, config);
    row.stream = activeStream(rows)?.name || null;
  }
  const db = await appendRow(projectDir, config, row);
  out({ recorded: row, db });
}

const VERBS = { config: verbConfig, context: verbContext, keeplist: verbKeeplist, resume: verbResume, handoff: verbHandoff, record: verbRecord };
// Verbs the marathon CLI answers for an active run. `config` and `context` are /bc's own: the size
// is the same either way, and the thresholds already fall back to marathon.json.
const DELEGATED = new Set(['keeplist', 'resume', 'handoff', 'record']);

async function main() {
  const argv = process.argv.slice(2);
  const { verb, flags, positional } = parseArgs(argv);
  const fn = VERBS[verb];
  if (!fn) {
    process.stderr.write(`usage: cli.js <${Object.keys(VERBS).join('|')}> [flags]\n`);
    process.exitCode = 1;
    return;
  }
  const projectDir = str(flags.project) ? path.resolve(flags.project) : resolveProjectDir(LAUNCH_DIR);
  try {
    // A hook's stdin can be read once; keep it for whichever path handles the call.
    if (flags['from-hook']) flags.__hook = await readHookInput();
    if (DELEGATED.has(verb)) {
      const rest = argv.slice(1).filter((a, i, all) => a !== '--project' && all[i - 1] !== '--project' && a !== '--no-marathon');
      if (await delegate(projectDir, verb, rest, flags)) return;
    }
    await fn(projectDir, flags, positional);
  } catch (err) {
    process.stderr.write(`bc: ${err.message}\n`);
    process.exitCode = err instanceof CliExit ? err.code : 1;
  }
}

// exitCode, never process.exit(): a pipe may still be flushing a large result.
main();
