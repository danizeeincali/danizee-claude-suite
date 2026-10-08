/**
 * bbs intake — classify a source, name the run, compute its identity, write source.json.
 * Nothing here touches the network or executes source content.
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, setActiveRun, writeJson, lookupSource } from './store.js';
import { renderStatusFile, loadState, nextStep } from './status.js';

const TYPES = ['repo', 'url', 'local', 'paste'];
const FORGES = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,80}$/i;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const sha = (data) => 'sha256:' + createHash('sha256').update(data).digest('hex');

function defaultGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

export function classifySource(ref, { exists = existsSync, as, pasteFile } = {}) {
  if (as !== undefined && as !== null) {
    if (!TYPES.includes(as)) throw new Error(`invalid value for --as: "${as}" (expected ${TYPES.join('|')})`);
    return as;
  }
  if (pasteFile || ref === '-') return 'paste';
  const text = String(ref ?? '').trim();
  if (!text) throw new Error('source is empty');
  if (/\s/.test(text)) return 'paste';
  if (/^git@[^:\s]+:/.test(text) || /^(ssh|git):\/\//i.test(text)) return 'repo';
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
  if (scheme && !/^https?$/i.test(scheme[1])) throw new Error(`unsupported scheme "${scheme[1]}:" (http, https, ssh, git only)`);
  if (scheme) {
    let u;
    try { u = new URL(text); } catch { return 'url'; }
    const segs = u.pathname.split('/').filter(Boolean);
    if (/\.git$/i.test(u.pathname.replace(/\/+$/, ''))) return 'repo';
    if (FORGES.has(u.hostname.toLowerCase().replace(/^www\./, '')) && segs.length === 2) return 'repo';
    return 'url';
  }
  if (exists(path.resolve(text))) return 'local';
  return 'paste';
}

function clean(s) {
  const dashed = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return dashed.slice(0, 40).replace(/-+$/g, '');
}

export function slugFor(type, ref) {
  let base = '';
  if (type === 'paste') return 'paste';
  const text = String(ref ?? '').trim();
  if (type === 'repo') {
    const last = text.replace(/\/+$/, '').replace(/\.git$/i, '').split(/[/:]/).filter(Boolean).pop() || '';
    base = last;
  } else if (type === 'url') {
    try {
      const u = new URL(text);
      base = [u.hostname, ...u.pathname.split('/').filter(Boolean)].join('-');
    } catch { base = text.replace(/^[a-z]+:\/\//i, '').split(/[?#]/)[0]; }
  } else {
    base = path.basename(text.replace(/[/\\]+$/, ''));
  }
  return clean(base) || 'source';
}

const pad = (n) => String(n).padStart(2, '0');

export async function runIdFor(projectDir, slug, { now = () => new Date(), cfg = DEFAULT_CONFIG } = {}) {
  const d = now();
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const base = `${day}-${slug}`;
  let id = base;
  for (let n = 2; await exists(runDirOf(projectDir, id, cfg)); n++) id = `${base}-${n}`;
  return id;
}

async function exists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}

async function manifest(root) {
  const lines = [];
  async function walk(dir) {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        lines.push([rel, (await fs.stat(full)).size]);
      }
    }
  }
  await walk(root);
  lines.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return lines.map(([p, s]) => `${p}\t${s}`).join('\n') + '\n';
}

export async function sourceIdentity({ type, ref, content, git = defaultGit, isGitRepo = (d) => existsSync(path.join(d, '.git')) }) {
  if (type === 'paste') return sha(content ?? '');
  if (type === 'url' || type === 'repo') return 'pending';
  if (type !== 'local') throw new Error(`unknown source type "${type}"`);
  const st = await fs.stat(ref);
  if (!st.isDirectory()) return sha(await fs.readFile(ref));
  if (isGitRepo(ref)) return 'git:' + String(git(['rev-parse', 'HEAD'], ref)).trim();
  return sha(await manifest(ref));
}

export async function intake(projectDir, ref, opts = {}) {
  const { stdin, pasteFile, as, slug, run, now, git, isGitRepo, cfg = DEFAULT_CONFIG } = opts;
  const type = classifySource(ref, { as, pasteFile });
  let storedRef = type === 'local' ? path.resolve(ref) : String(ref).trim();
  let content;
  if (type === 'paste') {
    content = pasteFile ? await fs.readFile(pasteFile, 'utf-8') : (stdin ?? (ref === '-' ? '' : String(ref)));
    if (!content.trim()) throw new Error('paste is empty');
    storedRef = 'paste';
  }
  let runId;
  if (run !== undefined) {
    if (!RUN_ID.test(run)) throw new Error(`invalid run id "${run}"`);
    if (await exists(runDirOf(projectDir, run, cfg))) throw new Error(`run "${run}" already exists`);
    runId = run;
  } else {
    runId = await runIdFor(projectDir, slug ? (clean(slug) || 'source') : slugFor(type, type === 'paste' ? ref : storedRef), { now, cfg });
  }
  const identity = await sourceIdentity({ type, ref: storedRef, content, git, isGitRepo });
  const known = await lookupSource(projectDir, identity, cfg);
  const dir = runDirOf(projectDir, runId, cfg);
  const source = {
    run: runId, type, ref: storedRef, identity,
    fetched: type === 'paste' || type === 'local',
    reuse_from: known ? known.run : null,
    cited: [],
    ts: (now ? now() : new Date()).toISOString()
  };
  await writeJson(path.join(dir, 'source.json'), source);
  if (type === 'paste') {
    await fs.mkdir(path.join(dir, 'fetched'), { recursive: true });
    await fs.writeFile(path.join(dir, 'fetched', 'paste.txt'), content);
  }
  await setActiveRun(projectDir, runId);
  await renderStatusFile(dir);
  return {
    runId,
    runDir: path.relative(projectDir, dir),
    type,
    ref: storedRef,
    identity,
    identity_pending: identity === 'pending',
    known: !!known,
    reuse_from: source.reuse_from,
    next: nextStep(await loadState(dir))
  };
}


