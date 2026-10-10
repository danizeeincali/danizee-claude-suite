/**
 * push-gate — an advisory pre-push gate. It only ever abstains, asks, or denies; it never allows,
 * so it cannot skip the developer's own permission prompt.
 *
 *   push-gate receipt --verdict pass|fail [--high H] [--medium M] [--low L]
 *                     [--threshold none|high|medium|low] [--incomplete] [--base <ref>]
 *   push-gate check   [--threshold none|high|medium|low] [--base <ref>]
 *
 * A review writes a receipt keyed by the change id: sha256 of (base commit, tree).
 * Base: --base, else the merge-base with @{upstream}, else none (the whole history is the change).
 * At check time the tree is HEAD's (what a push sends). At receipt time it is the tree of the working state as
 * reviewed: HEAD plus uncommitted tracked changes, computed through a temporary index copy (the user's index is
 * never touched). So reviewing uncommitted work, committing it unchanged and pushing matches; any other commit
 * does not, and unpushed uncommitted edits are never mistaken for a reviewed push.
 * Receipts live outside the repository ($KIT_RECEIPTS_DIR, else ~/.claude/kit/receipts/), one JSON file per
 * repository keyed by a hash of its real git common dir; a branch cannot carry one. Built from ideas
 * audited by /w-bbs (run 2026-10-10-openqodex-2); no foreign code.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { KitExit } from './kit-exit.js';

export const verb = 'push-gate';
export const usage = 'cli.js push-gate receipt --verdict pass|fail [--high H --medium M --low L] [--threshold none|high|medium|low] [--incomplete] [--base <ref>] | cli.js push-gate check [--threshold ...] [--base <ref>]';

const LEVELS = ['high', 'medium', 'low'];
const THRESHOLDS = ['none', ...LEVELS];
const MAX_PREVIOUS = 50;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/** A git runner: scrubbed env (no inherited GIT_*), hooks off, no prompts. Injectable for tests. */
export function defaultGit(cwd, { runner, spawn = spawnSync, env = process.env } = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(env)) if (!k.startsWith('GIT_')) clean[k] = v;
  clean.GIT_TERMINAL_PROMPT = '0';
  clean.GIT_OPTIONAL_LOCKS = '0';
  return async (args, { input, env: extra } = {}) => {
    const full = ['-c', 'core.hooksPath=/dev/null', ...args];
    const e = extra ? { ...clean, ...extra } : clean;
    if (runner) return runner(full, { cwd, env: e, input });
    const r = spawn('git', full, { cwd, env: e, input, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
  };
}

async function must(git, args, what) {
  const r = await git(args);
  if (r.code !== 0) throw new KitExit(`${what}: ${(r.stderr || r.stdout).trim() || 'git failed'}`, 1);
  return r.stdout.trim();
}

/** The tree of HEAD plus uncommitted tracked changes, via a temporary copy of the index. */
async function workingTree(git, headTree) {
  const status = await must(git, ['status', '--porcelain', '--untracked-files=no'], 'cannot read status');
  if (!status) return headTree;
  const real = await must(git, ['rev-parse', '--path-format=absolute', '--git-path', 'index'], 'cannot find the index');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-index-'));
  const tmp = path.join(dir, 'index');
  try {
    try { await fs.copyFile(real, tmp); } catch (e) { if (e.code !== 'ENOENT') throw new KitExit(`cannot copy the index: ${e.message}`, 1); }
    const env = { GIT_INDEX_FILE: tmp };
    const add = await git(['add', '-u'], { env });
    if (add.code !== 0) throw new KitExit(`cannot stage tracked changes: ${(add.stderr || add.stdout).trim()}`, 1);
    const wt = await git(['write-tree'], { env });
    if (wt.code !== 0) throw new KitExit(`cannot write the working tree: ${(wt.stderr || wt.stdout).trim()}`, 1);
    return wt.stdout.trim();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * The change id, plus what went into it. `working: true` (receipt) hashes the reviewed working state;
 * the default (check) hashes HEAD's tree, which is what a push sends.
 */
export async function changeId(git, { base, working = false } = {}) {
  const inside = await git(['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0) throw new KitExit('not inside a git repository', 1);
  const headTree = await must(git, ['rev-parse', 'HEAD^{tree}'], 'cannot read HEAD (no commits yet?)');
  let baseSha = null;
  if (base) {
    baseSha = await must(git, ['rev-parse', '--verify', '-q', `${base}^{commit}`], `unknown base "${base}"`);
  } else {
    const up = await git(['rev-parse', '--verify', '-q', '@{upstream}']);
    if (up.code === 0) {
      const mb = await git(['merge-base', 'HEAD', up.stdout.trim()]);
      if (mb.code === 0) baseSha = mb.stdout.trim();
    }
  }
  const tree = working ? await workingTree(git, headTree) : headTree;
  const id = sha(`${baseSha || 'root'}\0${tree}`);
  return { id, base: baseSha, tree, dirty: tree !== headTree };
}

/** Does this receipt fail the threshold? Verdict fail always does; otherwise any finding at or above it. */
export function failsThreshold(receipt, threshold) {
  if (receipt.verdict === 'fail') return true;
  if (threshold === 'none') return false;
  const upTo = LEVELS.slice(0, LEVELS.indexOf(threshold) + 1);
  return upTo.some(l => (receipt.counts?.[l] || 0) > 0);
}

/** The whole decision. Returns abstain | ask | deny — never allow. */
export function decide(state, id, threshold = 'none') {
  const block = (reason, extra = {}) => ({ decision: threshold === 'none' ? 'ask' : 'deny', reason, ...extra });
  const latest = state?.latest || null;
  if (latest && latest.change_id === id) {
    const failed = failsThreshold(latest, threshold) || failsThreshold(latest, latest.threshold || 'none');
    if (failed) {
      const c = latest.counts || {};
      return block(`the review of this change did not pass (verdict ${latest.verdict}, high ${c.high || 0}, medium ${c.medium || 0}, low ${c.low || 0})${latest.incomplete ? ' and was incomplete' : ''}`, { receipt: latest });
    }
    if (latest.incomplete) return { decision: 'abstain', reason: 'the review of this change was incomplete and found nothing that blocks; not blocking (run /w-review to finish it)', receipt: latest };
    if ((latest.threshold || 'none') !== threshold) {
      return block(`the review of this change was judged under threshold "${latest.threshold || 'none'}", not "${threshold}"; run /w-review again with --threshold ${threshold}`, { receipt: latest });
    }
    return { decision: 'abstain', reason: 'this exact change has a passing review', receipt: latest };
  }
  if (state?.previous?.includes(id) || latest) {
    return block('only an earlier review exists, for a different version of this change; run /w-review on the current one', { earlier: true });
  }
  return block('no review recorded for this change; run /w-review before pushing');
}

const KNOWN = { receipt: ['verdict', 'high', 'medium', 'low', 'threshold', 'incomplete', 'base'], check: ['threshold', 'base'] };

function parse(args) {
  const out = { flags: {} };
  const rest = [...args];
  out.cmd = rest.shift();
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) throw new KitExit(`unexpected argument "${a}"\n${usage}`, 1);
    const k = a.slice(2);
    if (KNOWN[out.cmd] && !KNOWN[out.cmd].includes(k)) throw new KitExit(`unknown flag --${k} for ${out.cmd} (allowed: ${KNOWN[out.cmd].map(f => `--${f}`).join(', ')})`, 1);
    if (k === 'incomplete') { out.flags.incomplete = true; continue; }
    if (rest.length === 0 || rest[0].startsWith('--')) throw new KitExit(`--${k} needs a value`, 1);
    out.flags[k] = rest.shift();
  }
  return out;
}

const count = (v, name) => {
  if (v === undefined) return 0;
  if (!/^\d+$/.test(v)) throw new KitExit(`--${name} must be a non-negative integer`, 1);
  return Number(v);
};
const thresholdOf = v => {
  if (v === undefined) return 'none';
  if (!THRESHOLDS.includes(v)) throw new KitExit(`--threshold must be one of ${THRESHOLDS.join(', ')}`, 1);
  return v;
};

async function storeFile(git, env) {
  const common = await must(git, ['rev-parse', '--git-common-dir'], 'cannot find the git dir');
  const cwdTop = await must(git, ['rev-parse', '--show-toplevel'], 'cannot find the repository');
  const real = await fs.realpath(path.resolve(cwdTop, common));
  const dir = env.KIT_RECEIPTS_DIR || path.join(env.HOME || os.homedir(), '.claude', 'kit', 'receipts');
  return { dir, file: path.join(dir, `${sha(real)}.json`), repo: real };
}

async function readState(file) {
  let text;
  try { text = await fs.readFile(file, 'utf-8'); } catch (e) { if (e.code === 'ENOENT') return null; throw new KitExit(`cannot read receipts: ${e.message}`, 1); }
  try {
    const s = JSON.parse(text);
    if (!s || typeof s !== 'object') throw new Error('not an object');
    return s;
  } catch (e) { throw new KitExit(`receipt store ${file} is corrupt (${e.message}); delete it to start over`, 1); }
}

async function writeAtomic(dir, file, data) {
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fs.rename(tmp, file);
}

export async function run(args, io) {
  const { cmd, flags } = parse(args);
  if (cmd !== 'receipt' && cmd !== 'check') throw new KitExit(`expected "receipt" or "check"\n${usage}`, 1);
  const env = io.env || process.env;
  const git = io.git || defaultGit(io.cwd, { env });
  const threshold = thresholdOf(flags.threshold);
  if (cmd === 'receipt' && !['pass', 'fail'].includes(flags.verdict)) throw new KitExit('--verdict must be pass or fail', 1);
  const counts = cmd === 'receipt' ? { high: count(flags.high, 'high'), medium: count(flags.medium, 'medium'), low: count(flags.low, 'low') } : null;

  const change = await changeId(git, { base: flags.base, working: cmd === 'receipt' });
  const { dir, file, repo } = await storeFile(git, env);
  const state = await readState(file);

  if (cmd === 'check') {
    const d = decide(state, change.id, threshold);
    const result = { ...d, change_id: change.id, threshold };
    if (d.decision === 'deny') result.exit = 2;
    return result;
  }

  const receipt = {
    change_id: change.id,
    verdict: flags.verdict,
    base: change.base,
    counts,
    threshold,
    incomplete: !!flags.incomplete,
    created_at: (io.now ? io.now() : new Date()).toISOString()
  };
  const previous = [...(state?.previous || [])];
  if (state?.latest?.change_id && state.latest.change_id !== change.id) previous.push(state.latest.change_id);
  const next = { repo, latest: receipt, previous: [...new Set(previous)].filter(p => p !== change.id).slice(-MAX_PREVIOUS) };
  await writeAtomic(dir, file, next);
  return { change_id: change.id, dirty: change.dirty, receipt };
}
