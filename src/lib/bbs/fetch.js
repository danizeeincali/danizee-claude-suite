/**
 * bbs fetch — GET-only fetch and shallow clone behind the egress guards.
 *
 * GET only · no body, no auth/cookie headers · private hosts and private redirects refused ·
 * per-run URL and byte limits · every request logged to egress.jsonl · shallow, tagless clone with
 * hooks off · nothing from a clone is ever executed (only `git clone` and `git rev-parse HEAD` run).
 * Injection points: fetchImpl, lookup, git (runner), now. Known gap: DNS rebinding between the host
 * check and the connect — documented, not fixed here.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import net from 'net';
import dns from 'dns/promises';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, runsDir as runsDirOf, activeRunId, readJson, readJsonl, writeJson, writeTextAtomic, appendJsonl, lookupSource } from './store.js';
import { RUN_ID, invalidRunId, scrubbedGitEnv } from './intake.js';
import { loadState, nextStep, renderStatusSafe } from './status.js';

export const USER_AGENT = 'danizee-claude-suite-bbs';
const ACCEPT = 'text/html, text/plain, application/json, text/markdown;q=0.9, */*;q=0.5';
const MAX_CITED = 200;

export class EgressRefused extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'EgressRefused';
    this.code = 'EGRESS_REFUSED';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------- address and host policy

function ipv4Parts(ip) {
  return ip.split('.').map(Number);
}

function isPrivateV4(ip) {
  const [a, b] = ipv4Parts(ip);
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224; // multicast 224/4 and reserved 240/4
}

/** Expand an IPv6 address (already validated by net.isIP) into 8 16-bit groups. */
function ipv6Groups(ip) {
  let text = ip;
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) { // dotted IPv4 tail → two hex groups
    const [a, b, c, d] = ipv4Parts(last);
    text = text.slice(0, lastColon + 1) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const parse = (s) => (s ? s.split(':').map(g => parseInt(g, 16)) : []);
  if (!text.includes('::')) return parse(text);
  const [head, rest] = text.split('::');
  const h = parse(head);
  const r = parse(rest);
  return [...h, ...new Array(Math.max(0, 8 - h.length - r.length)).fill(0), ...r];
}

const v4FromGroups = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** True for any address that is not plainly public. Anything unparsable is private (fail closed). */
export function isPrivateAddress(ip) {
  let text = String(ip ?? '').trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  const kind = net.isIP(text);
  if (kind === 4) return isPrivateV4(text);
  if (kind !== 6) return true;
  const g = ipv6Groups(text.toLowerCase());
  if (g.length !== 8 || g.some(n => !Number.isInteger(n) || n < 0 || n > 0xffff)) return true;
  if (g.slice(0, 6).every(n => n === 0)) return isPrivateV4(v4FromGroups(g[6], g[7])); // ::, ::1, ::a.b.c.d
  if (g.slice(0, 5).every(n => n === 0) && g[5] === 0xffff) return isPrivateV4(v4FromGroups(g[6], g[7])); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(n => n === 0)) return isPrivateV4(v4FromGroups(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateV4(v4FromGroups(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

const normHost = (h) => String(h ?? '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.+$/, '');

/** Names and literal IPs that are never fetched, before any DNS. */
export function isForbiddenHost(h) {
  const host = normHost(h);
  if (!host) return true;
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return true;
  if (net.isIP(host.split('%')[0])) return isPrivateAddress(host);
  return false;
}

const defaultLookup = (host, opts) => dns.lookup(host, opts);

/** Race a promise against a timer; rejects with an Error('timeout') carrying code ETIMEDOUT. */
function withTimeout(promise, ms, label) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`timeout after ${ms} ms${label ? ` ${label}` : ''}`), { code: 'ETIMEDOUT', timedOut: true })), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** Resolve all addresses of host and refuse when any is private. Literal IPs skip DNS. */
export async function checkHost(host, { lookup = defaultLookup, timeoutMs } = {}) {
  const h = normHost(host);
  if (net.isIP(h.split('%')[0])) {
    if (isPrivateAddress(h)) throw new EgressRefused(`host ${h} is a private address`);
    return [h];
  }
  if (isForbiddenHost(h)) throw new EgressRefused(`host "${h || '(empty)'}" is a private/forbidden name`);
  let res;
  try { res = await withTimeout(Promise.resolve().then(() => lookup(h, { all: true })), timeoutMs); } catch (err) {
    if (err?.timedOut) throw new EgressRefused(`cannot resolve ${h}: timeout after ${timeoutMs} ms`);
    throw new EgressRefused(`cannot resolve ${h}: ${err.code || err.message}${err.code && err.message && !err.message.includes(err.code) ? ` (${err.message})` : ''}`);
  }
  const list = (Array.isArray(res) ? res : res ? [res] : []).map(a => (typeof a === 'string' ? a : a?.address)).filter(Boolean);
  if (!list.length) throw new EgressRefused(`cannot resolve ${h}: no addresses`);
  const bad = list.find(a => isPrivateAddress(a));
  if (bad) throw new EgressRefused(`host ${h} resolves to private address ${bad}`);
  return list;
}

/** Host of a source ref: http(s)/ssh/git URLs and scp-style user@host:path; anything else null. */
export function hostOfRef(ref) {
  const text = String(ref ?? '').trim();
  if (/^(https?|ssh|git):\/\//i.test(text)) {
    try { return normHost(new URL(text).hostname) || null; } catch { return null; }
  }
  const scp = /^[^@\s/:]+@(\[[^\]\s]+\]|[^:\s/]+):(?!\/\/)/.exec(text);
  if (scp) return normHost(scp[1]) || null;
  return null;
}

// ---------------------------------------------------------------- http

/**
 * Text of a transport error with its real cause: Node's fetch rejects with TypeError('fetch failed')
 * and keeps the reason in err.cause (a code like ECONNREFUSED, or an AggregateError of several).
 */
export function describeError(err) {
  const causeText = (c, depth = 0) => {
    if (!c || depth > 5) return '';
    if (Array.isArray(c.errors) && c.errors.length) {
      return c.errors.map(e => causeText(e, depth + 1) || String(e?.code || e?.message || e)).filter(Boolean).join('; ');
    }
    const own = c.code || c.message || (typeof c === 'string' ? c : '');
    if (own) return String(own);
    return causeText(c.cause, depth + 1);
  };
  const base = String(err?.message || err || 'unknown error');
  const cause = causeText(err?.cause);
  return cause && !base.includes(cause) ? `${base}: ${cause}` : base;
}

const contentTypeOf = (res) => (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

async function discard(res) {
  try { await res.body?.cancel(); } catch { /* already closed */ }
}

/**
 * GET one URL behind the guards. Returns { url, finalUrl, status, body: Buffer, contentType, hops }.
 * Every hop (and every refusal) is reported to onEgress.
 */
export async function fetchUrl(url, opts = {}) {
  const {
    fetchImpl = globalThis.fetch, lookup = defaultLookup, maxBytes = 20 * 1024 * 1024,
    maxRedirects = 5, maxRequests = Infinity, timeoutMs = 30000, onEgress = () => {}, now = () => new Date()
  } = opts;
  const row = async (current, extra) => {
    await onEgress({ ts: now().toISOString(), kind: 'http', method: 'GET', url: current.href, host: normHost(current.hostname), status: null, bytes_in: 0, bytes_out: 0, ...extra });
  };
  let current;
  try { current = new URL(String(url)); } catch { throw new Error(`invalid url "${url}"`); }
  if (!/^https?:$/.test(current.protocol)) throw new Error(`unsupported scheme "${current.protocol}" (http and https only)`);
  const hops = [];
  let redirects = 0;
  for (;;) {
    const viaRedirect = hops.length > 0;
    const refuse = async (reason) => {
      const msg = viaRedirect ? `redirect to ${current.href} refused: ${reason}` : reason;
      await row(current, { refused: msg });
      throw new EgressRefused(msg);
    };
    if (!/^https?:$/.test(current.protocol)) await refuse(`unsupported scheme "${current.protocol}"`);
    if (current.username || current.password) await refuse('urls with credentials are not fetched');
    if (hops.length >= maxRequests) await refuse(`max_urls reached: the remaining allowance of ${maxRequests} request(s) is used up`);
    try { await checkHost(current.hostname, { lookup, timeoutMs }); } catch (err) {
      if (err instanceof EgressRefused) await refuse(err.message);
      throw err;
    }
    hops.push(current.href);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const timeoutMsg = `timeout after ${timeoutMs} ms fetching ${current.href}`;
    try {
      let res;
      try {
        res = await fetchImpl(current.href, {
          method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: { 'user-agent': USER_AGENT, accept: ACCEPT }
        });
      } catch (err) {
        if (controller.signal.aborted) { await row(current, { sent: true, refused: timeoutMsg }); throw new Error(timeoutMsg); }
        const why = describeError(err);
        await row(current, { error: why });
        throw new Error(`request to ${current.href} failed: ${why}`);
      }
      const status = res.status;
      if (status >= 300 && status < 400) {
        await discard(res);
        await row(current, { status });
        const loc = res.headers.get('location');
        if (!loc) throw new Error(`redirect ${status} from ${current.href} has no Location header`);
        let next;
        try { next = new URL(loc, current); } catch { throw new Error(`redirect ${status} from ${current.href} has an invalid Location "${loc}"`); }
        if (++redirects > maxRedirects) {
          const msg = `too many redirects (more than ${maxRedirects}) starting at ${hops[0]}`;
          await row(next, { refused: msg });
          throw new EgressRefused(msg);
        }
        current = next;
        continue;
      }
      if (status < 200 || status > 299) {
        await discard(res);
        await row(current, { status });
        throw new Error(`HTTP ${status} from ${current.href}`);
      }
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await discard(res);
        const msg = `response of ${declared} bytes exceeds the remaining allowance of ${maxBytes} bytes`;
        await row(current, { status, refused: msg });
        throw new EgressRefused(msg);
      }
      const chunks = [];
      let total = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          let chunk;
          try { chunk = await reader.read(); } catch (err) {
            if (controller.signal.aborted) { await row(current, { status, bytes_in: total, sent: true, refused: timeoutMsg }); throw new Error(timeoutMsg); }
            const why = describeError(err);
            await row(current, { status, bytes_in: total, error: why });
            throw new Error(`reading ${current.href} failed: ${why}`);
          }
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > maxBytes) {
            controller.abort();
            try { await reader.cancel(); } catch { /* aborted */ }
            const msg = `response body passed the remaining allowance of ${maxBytes} bytes`;
            await row(current, { status, bytes_in: total, refused: msg });
            throw new EgressRefused(msg);
          }
          chunks.push(Buffer.from(chunk.value));
        }
      }
      const body = Buffer.concat(chunks);
      if (status === 204 || body.length === 0) {
        const msg = `empty response body from ${current.href} (status ${status})`;
        await row(current, { status, bytes_in: 0, error: msg });
        throw new Error(msg);
      }
      await row(current, { status, bytes_in: body.length });
      return { url: String(url), finalUrl: current.href, status, body, contentType: contentTypeOf(res), hops };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------- cited links

const LINK = /href\s*=\s*(?:"([^"]*)"|'([^']*)')|(https?:\/\/[^\s<>"'`]+)/gi;
const decodeEntities = (s) => s.replace(/&amp;/gi, '&').replace(/&#38;/g, '&');

/** Absolute http(s) links from href attributes and bare URLs, unique in first-seen order, max 200. */
export function extractLinks(text, base) {
  const out = [];
  const seen = new Set();
  for (const m of String(text ?? '').matchAll(LINK)) {
    let raw = m[1] ?? m[2];
    if (raw === undefined) raw = m[3].replace(/[.,;:)\]}'">]+$/, '');
    raw = decodeEntities(raw.trim());
    if (!raw) continue;
    let u;
    try { u = new URL(raw, base); } catch { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    out.push(u.href);
    if (out.length >= MAX_CITED) break;
  }
  return out;
}

// ---------------------------------------------------------------- git

/** The default git runner: execFileSync with a timeout; a timeout becomes an Error that says so. */
export function runGit(args, cwd, env, { timeout, exec = execFileSync } = {}) {
  try {
    return exec('git', args, { cwd, env, timeout, killSignal: 'SIGTERM', encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM') {
      const e = new Error(`git ${args[0]} timeout after ${timeout} ms`);
      e.stderr = e.message;
      throw e;
    }
    throw err;
  }
}
const defaultGit = runGit;

/**
 * Env for clone and rev-parse: scrubbed, no system/global config, no lfs smudge, no prompts.
 * GIT_CONFIG_GLOBAL is only honoured from git 2.32; older gits still read $HOME/.gitconfig and
 * $XDG_CONFIG_HOME/git/config, so both point at scratchDir — an empty dir made for this clone.
 */
function cloneEnv(scratchDir) {
  if (!scratchDir) throw new Error('cloneEnv needs the scratch dir that stands in for HOME and XDG_CONFIG_HOME');
  return {
    ...scrubbedGitEnv(),
    HOME: scratchDir,
    XDG_CONFIG_HOME: scratchDir,
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new'
  };
}

/** Sum of file sizes under dir (recursive, symlinks not followed). Missing dir → 0. */
async function treeBytes(dir) {
  let st;
  try { st = await fs.lstat(dir); } catch (err) { if (err.code === 'ENOENT') return 0; throw err; }
  if (!st.isDirectory()) return st.isFile() ? st.size : 0;
  let total = 0;
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) total += await treeBytes(p);
    else if (ent.isFile()) total += (await fs.lstat(p)).size;
  }
  return total;
}

const CLONE_SCHEME = /^(https|ssh):\/\//i;
const SCP_REF = /^[^@\s/:]+@(\[[^\]\s]+\]|[^:\s/]+):(?!\/\/)/;

function firstLine(err) {
  const raw = (err?.stderr ? String(err.stderr) : '').trim() || String(err?.message || 'unknown error').trim();
  return raw.split('\n').map(s => s.trim()).find(Boolean) || 'unknown error';
}

/** Shallow, tagless clone with hooks off and prompts off; returns { sha } of HEAD. */
export async function cloneRepo(ref, dest, {
  git = defaultGit, lookup = defaultLookup, onEgress = () => {}, now = () => new Date(), timeoutMs = 30000, maxBytes = Infinity,
  maxCheckoutBytes = Infinity
} = {}) {
  const text = String(ref ?? '').trim();
  const host = text.startsWith('-') ? null : hostOfRef(text);
  const row = async (extra) => {
    await onEgress({ ts: now().toISOString(), kind: 'git', method: 'GET', url: text, host, status: null, bytes_in: 0, bytes_out: 0, ...extra });
  };
  if (!host || !(CLONE_SCHEME.test(text) || SCP_REF.test(text))) {
    const msg = `unsupported repo ref scheme in "${text}" — only https://, ssh:// and scp-style user@host:path are cloned`;
    await row({ refused: msg });
    throw new EgressRefused(msg);
  }
  try { await checkHost(host, { lookup, timeoutMs }); } catch (err) {
    if (err instanceof EgressRefused) await row({ refused: err.message });
    throw err;
  }
  const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-home-'));
  const env = cloneEnv(scratchDir);
  try {
    // `git clone -c` writes these into fetched/repo/.git/config. Every value is chosen to be harmless
    // when it persists: hooks point at /dev/null (never a dir someone could recreate), no redirects,
    // no credential helper, lfs filters empty, only https/ssh transports. Nothing ever runs git inside
    // fetched/repo afterwards except our own rev-parse with this same env.
    const args = ['clone', '--depth', '1', '--no-tags', '--no-recurse-submodules',
      '-c', 'core.hooksPath=/dev/null', '-c', 'http.followRedirects=false', '-c', 'credential.helper=',
      '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false',
      '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always',
      '--', text, dest];
    try {
      await git(args, path.dirname(path.resolve(dest)), env, { timeout: timeoutMs * 10 });
    } catch (err) {
      let partial = 0;
      try { partial = await treeBytes(path.join(dest, '.git')); } catch { /* unreadable partial tree: count nothing */ }
      await fs.rm(dest, { recursive: true, force: true });
      const line = firstLine(err);
      await row({ error: line, bytes_in: partial });
      throw new Error(`git clone failed: ${line}`);
    }
    // bytes_in is what came over the wire: .git (the shallow pack). The checkout is the same blobs
    // expanded, so it is not egress; it has its own cap so a small, highly compressible pack
    // cannot fill the disk.
    const bytes = await treeBytes(path.join(dest, '.git'));
    const checkout = (await treeBytes(dest)) - bytes;
    const over = bytes > maxBytes
      ? `clone of ${bytes} bytes exceeds the remaining allowance of ${maxBytes} bytes`
      : checkout > maxCheckoutBytes
        ? `checkout of ${checkout} bytes exceeds max_checkout_bytes of ${maxCheckoutBytes} bytes`
        : null;
    if (over) {
      await fs.rm(dest, { recursive: true, force: true });
      await row({ status: 0, bytes_in: bytes, refused: over });
      throw new EgressRefused(over);
    }
    let sha;
    try {
      sha = String(await git(['rev-parse', 'HEAD'], dest, env, { timeout: timeoutMs })).trim();
      if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) throw new Error(`unexpected HEAD "${sha.slice(0, 80)}"`);
    } catch (err) {
      await fs.rm(dest, { recursive: true, force: true });
      throw new Error(`git rev-parse HEAD failed after clone: ${firstLine(err)}`);
    }
    await row({ status: 0, bytes_in: bytes });
    return { sha };
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- egress summary

/**
 * A row is a request only when something was sent: it has a status, read bytes, carries a transport
 * error or the sent flag (timeouts), or is a git row that was not refused before connecting.
 */
export const isRequest = (e) => !!e && (e.kind === 'http' || e.kind === 'git') && (
  typeof e.status === 'number' || Number(e.bytes_in) > 0 || !!e.error || e.sent === true || (e.kind === 'git' && !e.refused)
);

export function egressSummary(rows) {
  const list = (rows || []).filter(e => e && typeof e === 'object');
  const requests = list.filter(isRequest);
  return {
    requests: requests.length,
    bytes_in: list.reduce((n, e) => n + (Number(e.bytes_in) || 0), 0),
    bodies_sent: 0,
    hosts: [...new Set(requests.map(e => e.host).filter(Boolean))],
    refused: list.filter(e => e.refused).length
  };
}

export function egressLine(rows) {
  const s = egressSummary(rows);
  return `requests=${s.requests} bytes_in=${s.bytes_in} bodies_sent=0 hosts=${s.hosts.length ? s.hosts.join(',') : 'none'}`;
}

// ---------------------------------------------------------------- the fetch step

const EXT = { 'text/html': 'html', 'text/markdown': 'md', 'application/json': 'json', 'text/plain': 'txt' };

async function resolveRunDir(projectDir, run, cfg) {
  let id = run;
  if (id === undefined || id === null) {
    id = await activeRunId(projectDir);
    if (!id) throw new Error('no active run — start one with `cli.js intake <source>` or pass --run <id>');
  }
  if (!RUN_ID.test(id)) throw new Error(invalidRunId(id));
  id = id.toLowerCase();
  const dir = runDirOf(projectDir, id, cfg);
  if (!path.resolve(dir).startsWith(path.resolve(runsDirOf(projectDir, cfg)) + path.sep)) throw new Error(invalidRunId(id));
  try { await fs.stat(dir); } catch { throw new Error(`unknown run "${id}"`); }
  return { id, dir };
}

/**
 * Fetch the run's named source (url or repo). Fetched files are written first and source.json
 * last; on failure everything this call created is removed and source.json is left unchanged.
 */
export async function fetchRun(projectDir, opts = {}) {
  const { run, fetchImpl, lookup, git, now = () => new Date(), cfg = DEFAULT_CONFIG, maxBytes, maxUrls } = opts;
  const { id, dir } = await resolveRunDir(projectDir, run, cfg);
  const sourceFile = path.join(dir, 'source.json');
  const egressFile = path.join(dir, 'egress.jsonl');
  const onEgress = (row) => appendJsonl(egressFile, { ...row, ts: now().toISOString() });
  try {
    const source = await readJson(sourceFile);
    if (!source) throw new Error(`run "${id}" has no source.json — run \`cli.js intake <source>\` first`);
    const type = source.type;
    const result = async (extra) => {
      const rows = await readJsonl(egressFile);
      const summary = egressSummary(rows);
      await renderStatusSafe(dir);
      return { runId: id, type, ...extra, egress: summary, egress_line: egressLine(rows), next: nextStep(await loadState(dir)) };
    };
    if (type === 'local' || type === 'paste') {
      return await result({
        nothing_to_fetch: true, identity: source.identity, identity_pending: source.identity === 'pending',
        known: !!source.reuse_from, reuse_from: source.reuse_from ?? null, files: []
      });
    }
    if (type !== 'url' && type !== 'repo') throw new Error(`run "${id}" has an unknown source type "${type}"`);
    if (source.fetched) throw new Error(`run "${id}" is already fetched (${source.identity}) — start a new run to fetch again`);
    const kind = type === 'repo' ? 'git' : 'http';
    const refuseRow = async (msg) => {
      await onEgress({ kind, method: 'GET', url: source.ref, host: hostOfRef(source.ref), status: null, bytes_in: 0, bytes_out: 0, refused: msg });
      throw new EgressRefused(msg);
    };
    if (/<redacted>|%3Credacted%3E/i.test(String(source.ref))) {
      await refuseRow('the named URL carried a credential-like query value that intake redacted — re-run cli.js intake with the URL without it');
    }
    const realNetwork = type === 'url' ? (!fetchImpl || !lookup) : (!git || !lookup);
    if (process.env.BBS_NO_NETWORK && realNetwork) await refuseRow('network disabled by BBS_NO_NETWORK');
    const { rows, corrupt } = await readJsonl(egressFile, { report: true });
    if (corrupt > 0) await refuseRow(`egress.jsonl has ${corrupt} corrupt row(s) — the per-run limits cannot be trusted; repair or start a new run`);
    const used = egressSummary(rows);
    const urlLimit = maxUrls ?? cfg.limits?.max_urls ?? DEFAULT_CONFIG.limits.max_urls;
    const byteLimit = maxBytes ?? cfg.limits?.max_bytes ?? DEFAULT_CONFIG.limits.max_bytes;
    if (used.requests >= urlLimit) await refuseRow(`max_urls reached: this run already made ${used.requests} of ${urlLimit} requests`);
    const remaining = byteLimit - used.bytes_in;
    const remainingUrls = urlLimit - used.requests;
    const timeoutMs = cfg.limits?.timeout_ms ?? DEFAULT_CONFIG.limits?.timeout_ms ?? 30000;
    if (remaining <= 0) await refuseRow(`max_bytes reached: this run already read ${used.bytes_in} of ${byteLimit} bytes`);

    // claim fetched/ atomically: a second concurrent fetch (or a crashed one) fails loudly
    const fetchedDir = path.join(dir, 'fetched');
    try { await fs.mkdir(fetchedDir); } catch (err) {
      if (err.code === 'EEXIST') throw new Error(`run "${id}" already has a fetched/ directory — another fetch is running or one crashed; remove ${fetchedDir} to retry`);
      throw err;
    }
    let committed = false;
    let identity, files, extraSource, known, reuse_from;
    try {
      if (type === 'url') {
        const r = await fetchUrl(source.ref, {
          fetchImpl: fetchImpl || globalThis.fetch, lookup: lookup || defaultLookup, maxBytes: remaining,
          maxRedirects: cfg.limits?.max_redirects ?? 5, maxRequests: remainingUrls, timeoutMs, onEgress, now
        });
        const ext = EXT[r.contentType] || 'bin';
        files = [`fetched/1.${ext}`];
        await writeTextAtomic(path.join(fetchedDir, `1.${ext}`), r.body);
        identity = 'sha256:' + createHash('sha256').update(r.body).digest('hex');
        const cited = ext === 'bin' ? [] : extractLinks(r.body.toString('utf-8'), r.finalUrl);
        extraSource = { final_url: r.finalUrl, cited };
      } else {
        const { sha } = await cloneRepo(source.ref, path.join(fetchedDir, 'repo'), {
          git: git || defaultGit, lookup: lookup || defaultLookup, onEgress, now, timeoutMs, maxBytes: remaining,
          maxCheckoutBytes: cfg.limits?.max_checkout_bytes ?? DEFAULT_CONFIG.limits.max_checkout_bytes
        });
        identity = 'git:' + sha;
        files = ['fetched/repo'];
        extraSource = {};
      }
      known = await lookupSource(projectDir, identity, cfg);
      reuse_from = known ? known.run : null;
      await writeJson(sourceFile, { ...source, fetched: true, identity, ...extraSource, reuse_from, fetched_at: now().toISOString() }); // commit marker: last
      committed = true;
    } catch (err) {
      if (!committed) await fs.rm(fetchedDir, { recursive: true, force: true });
      throw err;
    }
    return await result({ identity, identity_pending: false, known: !!known, reuse_from, files });
  } finally {
    await renderStatusSafe(dir);
  }
}
