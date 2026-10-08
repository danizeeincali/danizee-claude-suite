/**
 * bbs intake — classify a source, name the run, compute its identity, write source.json.
 * Nothing here touches the network or executes source content.
 */

import fs from 'fs/promises';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, runsDir, setActiveRun, activeRunId, clearActiveRun, writeJson, writeTextAtomic, appendJsonl, lookupSource } from './store.js';
import { renderStatusFile, loadState, nextStep } from './status.js';

const TYPES = ['repo', 'url', 'local', 'paste'];
const FORGES = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);
export const RUN_ID = /^[a-z0-9][a-z0-9-]{0,80}$/i;
export const invalidRunId = (id) => `invalid run id "${id}" (letters, digits and -, up to 81 chars, starting with a letter or digit)`;
const HOST_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i;
const HINT = 'use --as paste or a full URL';
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const sha = (data) => 'sha256:' + createHash('sha256').update(data).digest('hex');

// git env vars that would point git at a repository, index or config the user did not name
const GIT_ENV_SCRUB = /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|CEILING_DIRECTORIES|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG.*)$/;

/** A copy of `env` without repo-redirecting GIT_* variables, with credential prompts off. */
export function scrubbedGitEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!GIT_ENV_SCRUB.test(k)) out[k] = v;
  out.GIT_TERMINAL_PROMPT = '0';
  return out;
}

function defaultGit(args, cwd) {
  return execFileSync('git', args, { cwd, env: scrubbedGitEnv(), encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const SECRET_PARAM = /token|key|secret|sig|auth|password|passwd|pwd|credential|session|bearer|apikey|api_key|access/i;
const CREDENTIALS_REFUSED = 'refs with embedded credentials are not accepted — pass the URL without userinfo';

function maskParams(qs) {
  return qs.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return pair;
    const rawKey = pair.slice(0, eq);
    let key = rawKey;
    try { key = decodeURIComponent(rawKey.replace(/\+/g, ' ')); } catch { /* keep the raw key */ }
    return SECRET_PARAM.test(key) ? `${rawKey}=<redacted>` : pair;
  }).join('&');
}

const HTTP_REF = /^(https?:\/\/)([^/?#]*)([\s\S]*)$/i;
const SSH_URL_REF = /^((?:ssh|git):\/\/)([^/?#]*)([\s\S]*)$/i;
const SCP_PW_REF = /^([^@:\s/]+):[^@\s/]*@([\s\S]*)$/;

/** True when an http(s) ref carries userinfo (user or user:password before the host). */
function httpUserinfo(ref) {
  const m = HTTP_REF.exec(String(ref ?? '').trim());
  return !!m && m[2].includes('@');
}

/**
 * Redact credentials from a source ref before it is printed, persisted or logged.
 * http(s): userinfo removed, token-like query (and fragment) values masked.
 * ssh:// git:// and scp-style git@host:path: any password removed, the user kept.
 */
export function redactRef(ref) {
  const text = String(ref ?? '');
  const http = HTTP_REF.exec(text);
  if (http) {
    let [, scheme, authority, rest] = http;
    const at = authority.lastIndexOf('@');
    if (at >= 0) authority = authority.slice(at + 1);
    const hash = rest.indexOf('#');
    let head = hash >= 0 ? rest.slice(0, hash) : rest;
    const frag = hash >= 0 ? '#' + maskParams(rest.slice(hash + 1)) : '';
    const q = head.indexOf('?');
    if (q >= 0) head = head.slice(0, q + 1) + maskParams(head.slice(q + 1));
    return scheme + authority + head + frag;
  }
  const ssh = SSH_URL_REF.exec(text);
  if (ssh) {
    let [, scheme, authority, rest] = ssh;
    const at = authority.lastIndexOf('@');
    if (at >= 0) authority = authority.slice(0, at).split(':')[0] + authority.slice(at);
    return scheme + authority + rest;
  }
  const scp = SCP_PW_REF.exec(text);
  if (scp) return `${scp[1]}@${scp[2]}`;
  return text;
}

/**
 * Whether <ref>/.git is a git dir that stays inside ref. Returns true, false (no .git at all),
 * or { outside: reason } when .git is a symlink or a gitdir/commondir file resolves elsewhere.
 */
export function gitDirInside(ref) {
  const dotgit = path.join(ref, '.git');
  let st;
  try { st = lstatSync(dotgit); } catch { return false; }
  if (st.isSymbolicLink()) return { outside: '.git is a symlink' };
  let root;
  try { root = realpathSync(ref); } catch { return false; }
  const inside = (p) => p === root || p.startsWith(root + path.sep);
  let gitdir;
  if (st.isDirectory()) gitdir = path.join(root, '.git');
  else if (st.isFile()) {
    let text;
    try { text = readFileSync(dotgit, 'utf-8'); } catch { return { outside: '.git file is unreadable' }; }
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
    if (!m) return { outside: '.git file has no gitdir line' };
    try { gitdir = realpathSync(path.resolve(ref, m[1])); } catch { return { outside: 'gitdir does not exist' }; }
    if (!inside(gitdir) || gitdir === root) return { outside: 'gitdir resolves outside the source' };
  } else return false;
  let common;
  try { common = readFileSync(path.join(gitdir, 'commondir'), 'utf-8').trim(); } catch { return true; }
  let real;
  try { real = realpathSync(path.resolve(gitdir, common)); } catch { return { outside: 'commondir does not exist' }; }
  return inside(real) ? true : { outside: 'commondir resolves outside the source' };
}

export function classifySource(ref, { exists = existsSync, as, pasteFile } = {}) {
  if (as !== undefined && as !== null) {
    if (!TYPES.includes(as)) throw new Error(`invalid value for --as: "${as}" (expected ${TYPES.join('|')})`);
    return as;
  }
  if (pasteFile || ref === '-') return 'paste';
  const text = String(ref ?? '').trim();
  if (!text) throw new Error('source is empty');
  if (/\s/.test(text)) {
    // a real path may contain spaces: a single line that exists on disk is local
    if (!/[\r\n]/.test(text) && exists(path.resolve(text))) return 'local';
    return 'paste';
  }
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
  if (HOST_LIKE.test(text)) throw new Error(`"${text}" has no scheme — ${HINT}`);
  if (/[/\\]/.test(text) || /^[.~/]/.test(text)) throw new Error(`path "${text}" does not exist — ${HINT}`);
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
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local date, like marathon run ids
  const base = `${day}-${slug}`;
  let id = base;
  for (let n = 2; await exists(runDirOf(projectDir, id, cfg)); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Claim a run directory atomically (mkdir without recursive). Auto slug: try -2, -3, ... on EEXIST.
 * Explicit run id: EEXIST is an error. Returns { runId, dir }.
 */
export async function claimRunDir(projectDir, { slug, run, now = () => new Date(), cfg = DEFAULT_CONFIG } = {}) {
  await fs.mkdir(runsDir(projectDir, cfg), { recursive: true });
  if (run !== undefined) {
    const dir = runDirOf(projectDir, run, cfg);
    try { await fs.mkdir(dir); } catch (err) {
      if (err.code === 'EEXIST') throw new Error(`run "${run}" already exists — pick another --run or omit it`);
      throw err;
    }
    return { runId: run, dir };
  }
  const d = now();
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${slug}`;
  for (let n = 1; ; n++) {
    const runId = n === 1 ? base : `${base}-${n}`;
    const dir = runDirOf(projectDir, runId, cfg);
    try { await fs.mkdir(dir); return { runId, dir }; } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
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
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (ent.isSymbolicLink()) lines.push([rel, '->' + await fs.readlink(full)]);
      else if (ent.isDirectory()) await walk(full);
      else if (ent.isFile()) lines.push([rel, (await fs.lstat(full)).size]);
    }
  }
  await walk(root);
  if (!lines.length) throw new Error(`local source ${root} is empty: no files to identify`);
  lines.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return lines.map(([p, s]) => `${p}\t${s}`).join('\n') + '\n';
}

export async function sourceIdentity(args) {
  return (await sourceIdentityDetailed(args)).identity;
}

/** Like sourceIdentity, plus a `note` when a git failure or an outside git dir forced the manifest fallback. */
export async function sourceIdentityDetailed({ type, ref, content, git = defaultGit, isGitRepo = gitDirInside }) {
  const id = async () => {
  if (type === 'paste') return sha(content ?? '');
  if (type === 'url' || type === 'repo') return 'pending';
  if (type !== 'local') throw new Error(`unknown source type "${type}"`);
  const st = await fs.stat(ref);
  if (!st.isDirectory()) return sha(await fs.readFile(ref));
  const repo = isGitRepo(ref);
  if (repo && typeof repo === 'object' && repo.outside) {
    note = `git dir points outside the source (${repo.outside}); identity is a file manifest`;
  } else if (repo) {
    try {
      const head = String(git(['rev-parse', 'HEAD'], ref)).trim();
      if (!head) throw new Error('empty output');
      return 'git:' + head;
    } catch (err) {
      note = gitNote(err);
    }
  }
  return sha(await manifest(ref));
  };
  let note;
  const identity = await id();
  return note ? { identity, note } : { identity };
}

function gitNote(err) {
  const raw = (err.stderr ? String(err.stderr) : '') || (err.code === 'ENOENT' ? 'git not installed' : err.message || 'unknown error');
  const reason = raw.trim().split('\n')[0].replace(/^fatal:\s*/i, '').slice(0, 80) || 'unknown error';
  return `git HEAD unavailable (${reason}); identity is a file manifest`;
}

export async function intake(projectDir, ref, opts = {}) {
  const { stdin, pasteFile, as, slug, run: runOpt, now, git, isGitRepo, onBeforeSource, cfg = DEFAULT_CONFIG } = opts;
  const type = classifySource(ref, { as, pasteFile });
  if ((type === 'url' || type === 'repo') && httpUserinfo(ref)) throw new Error(CREDENTIALS_REFUSED);
  // the raw ref is never persisted: url/repo refs are redacted before storage, slug, result and status
  let storedRef = type === 'local' ? path.resolve(ref) : redactRef(String(ref).trim());
  let content;
  if (type === 'paste') {
    // a paste file is kept as raw bytes: identity and paste.txt match the file exactly
    content = pasteFile ? await fs.readFile(pasteFile) : (stdin ?? (ref === '-' ? '' : String(ref)));
    const text = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
    if (!text.trim()) throw new Error(`paste is empty (${pasteFile ? `--paste-file ${pasteFile}` : 'stdin'})`);
    storedRef = 'paste';
  }
  if (runOpt !== undefined && !RUN_ID.test(runOpt)) throw new Error(invalidRunId(runOpt));
  const run = runOpt === undefined ? undefined : runOpt.toLowerCase(); // one run on every filesystem
  const { identity, note } = await sourceIdentityDetailed({ type, ref: storedRef, content, git, isGitRepo });
  const known = await lookupSource(projectDir, identity, cfg);
  // claim the run id atomically; from here on, any failure removes the claimed dir
  const slugName = slug ? (clean(slug) || 'source') : slugFor(type, type === 'paste' ? ref : storedRef);
  const { runId, dir } = await claimRunDir(projectDir, { slug: slugName, run, now, cfg });
  let source;
  const priorActive = await activeRunId(projectDir);
  try {
    source = {
      run: runId, type, ref: storedRef, identity,
      fetched: type === 'paste' || type === 'local',
      reuse_from: known ? known.run : null,
      cited: [],
      ts: (now ? now() : new Date()).toISOString()
    };
    if (note) source.identity_note = note;
    if (type === 'paste') await writeTextAtomic(path.join(dir, 'fetched', 'paste.txt'), content);
    if (type === 'paste' || type === 'local') {
      // nothing to fetch: record the zero-egress row so the fetch step is truly done
      await appendJsonl(path.join(dir, 'egress.jsonl'), {
        ts: source.ts, kind: 'none', method: null, url: null, host: null, status: null,
        bytes_in: 0, bytes_out: 0, note: `nothing to fetch: ${type} source`
      });
    }
    if (onBeforeSource) await onBeforeSource(dir);
    await writeJson(path.join(dir, 'source.json'), source); // commit marker: written last
    await setActiveRun(projectDir, runId);
    await renderStatusFile(dir);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    if ((await activeRunId(projectDir)) === runId) {
      if (priorActive) await setActiveRun(projectDir, priorActive); else await clearActiveRun(projectDir);
    }
    throw err;
  }
  return {
    runId,
    runDir: path.relative(projectDir, dir),
    type,
    ref: storedRef,
    identity,
    identity_pending: identity === 'pending',
    known: !!known,
    reuse_from: source.reuse_from,
    next: nextStep(await loadState(dir)),
    ...(note ? { note } : {})
  };
}


