/**
 * state-lock — one lock and one JSON read/write path for the kit verbs that keep a state file (noise-ledger, triage,
 * reflect, shared-budget). A library, not a verb: cli.js discovery skips it (no `verb` export).
 * Built for marathon 2026-10-15-bbs-bugpatrol; no foreign code.
 *
 *   withStateLock(file, fn, { staleMs = 30000, waitMs = 2 * staleMs, pollMs, now, sleep })  → fn's result
 *   readJsonState(file, { fallback })                                                      → parsed JSON
 *   writeJsonAtomic(file, value)                                                           → undefined
 *
 * LOCK. The file's folder is created if missing. `<file>.lock` is created with O_EXCL ('wx') and holds {token, pid, host, pidns, beat}. Only EEXIST means "held";
 * any other open error is fatal (KitExit 1 "cannot lock <file>: <code>"). While fn runs, the holder rewrites the lock
 * every staleMs/3 with beat+1 (opened 'r+', so a removed lock is never recreated, and only while it still holds our
 * token). Release removes the lock only if it still holds our token.
 *
 * STALENESS is judged only by what the waiter itself sees on its own monotonic clock: a lock is stale when its exact
 * content has stayed unchanged for staleMs of the waiter's observation. File mtimes and wall clocks are never used, so
 * clock skew on a network filesystem cannot break a live lock. Shortcut: a lock written on this host whose pid no
 * longer exists (kill(pid, 0) → ESRCH) is stale at once, but only when the lock names this pid namespace too.
 *
 * BREAK. A waiter that judged the lock stale takes `<file>.lock.break` ('wx'; a non-EEXIST error is fatal, never
 * retried), re-reads the lock and removes it only if its content is byte-identical to what was judged stale, then
 * removes its own break file. A leftover break file is judged by the same rule (unchanged content for staleMs, or a
 * dead pid on this host) and removed only if its content is still the one judged. Every loop pass — lock fresh,
 * stale, break lost, unreadable — goes through the same deadline check and a jittered backoff sleep; past waitMs it
 * fails with KitExit 1 "<file> is locked by another run (holder pid P on host H)".
 *
 * Residual window, by design: between a breaker's re-read and its unlink, only a holder that was itself judged stale
 * (no heartbeat for staleMs) can be affected.
 */

import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { KitExit } from './kit-exit.js';

const HOST = os.hostname();
// The pid namespace (Linux). Containers can share a hostname and a volume but not a pid namespace, so a pid that is
// invisible here may be alive there; the dead-pid shortcut applies only when both locks name the same namespace
// (or neither platform has one).
const PIDNS = (() => { try { return fsSync.readlinkSync('/proc/self/ns/pid'); } catch { return null; } })();

function holderOf(content) {
  try {
    const o = JSON.parse(content);
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}

/** True when the content names a process on this host that no longer exists. */
function deadOnThisHost(content) {
  const h = holderOf(content);
  if (!h || h.host !== HOST || !Number.isInteger(h.pid) || h.pid <= 0) return false;
  if (h.pidns !== undefined && h.pidns !== PIDNS) return false;
  try { process.kill(h.pid, 0); return false; } catch (err) { return err.code === 'ESRCH'; }
}

/** Read a file as text; null when it does not exist. Other errors propagate. */
async function readOrNull(fs, p) {
  try { return await fs.readFile(p, 'utf-8'); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Create `p` exclusively with `body`. true = created, false = EEXIST; any other error → KitExit. */
async function createExclusive(fs, p, body, file) {
  let fh;
  try { fh = await fs.open(p, 'wx'); } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw new KitExit(`cannot lock ${file}: ${err.code || err.message}`, 1);
  }
  try {
    await fh.writeFile(body);
  } catch (err) {
    await fh.close().catch(() => {});
    await fs.unlink(p).catch(() => {});
    throw new KitExit(`cannot lock ${file}: ${err.code || err.message}`, 1);
  }
  await fh.close();
  return true;
}

/** Remove `p` only if it still holds exactly `content`. */
async function unlinkIfSame(fs, p, content) {
  if ((await readOrNull(fs, p)) !== content) return false;
  try { await fs.unlink(p); return true; } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Run `fn` while holding `<file>.lock`; always release. Returns fn's result.
 * opts: staleMs (30000), waitMs (2 × staleMs, must be > staleMs), pollMs, now() (monotonic ms), sleep(ms), fs (tests).
 */
export async function withStateLock(file, fn, opts = {}) {
  const staleMs = opts.staleMs ?? 30000;
  const waitMs = opts.waitMs ?? staleMs * 2;
  if (!(staleMs > 0) || !(waitMs > staleMs)) throw new KitExit(`lock for ${file}: waitMs (${waitMs}) must be greater than staleMs (${staleMs})`, 1);
  const pollMs = opts.pollMs ?? Math.max(5, Math.min(50, staleMs / 20));
  const maxPollMs = Math.max(pollMs, Math.min(1000, staleMs / 5));
  const now = opts.now ?? (() => performance.now());
  const sleep = opts.sleep ?? (ms => delay(ms));
  const fs = opts.fs ?? fsp;
  const lock = `${file}.lock`;
  const brk = `${lock}.break`;
  const token = randomUUID();
  const body = beat => JSON.stringify({ token, pid: process.pid, host: HOST, pidns: PIDNS, beat });

  // What this waiter has seen at each path: { content, since } on its own clock.
  const seen = new Map();
  const isStale = (p, content) => {
    const o = seen.get(p);
    if (!o || o.content !== content) { seen.set(p, { content, since: now() }); }
    if (deadOnThisHost(content)) return true;
    return now() - seen.get(p).since >= staleMs;
  };

  const breakStale = async staleContent => {
    if (!(await createExclusive(fs, brk, body(0), file))) {
      // Someone else is breaking, or a breaker died: judge the break file by the same rule.
      const b = await readOrNull(fs, brk);
      if (b !== null && isStale(brk, b)) { await unlinkIfSame(fs, brk, b); seen.delete(brk); }
      return;
    }
    try {
      if (await unlinkIfSame(fs, lock, staleContent)) seen.delete(lock);
    } finally {
      await unlinkIfSame(fs, brk, body(0)).catch(() => {});
    }
  };

  try { await fs.mkdir(path.dirname(file), { recursive: true }); } catch (err) {
    throw new KitExit(`cannot lock ${file}: ${err.code || err.message}`, 1);
  }

  const start = now();
  let attempt = 0;
  let last = null;
  for (;;) {
    if (await createExclusive(fs, lock, body(0), file)) break;
    try {
      const content = await readOrNull(fs, lock);
      if (content !== null) {
        last = holderOf(content) || last;
        if (isStale(lock, content)) await breakStale(content);
      }
    } catch (err) {
      if (err instanceof KitExit) throw err;
      // Unreadable lock or break file: fall through to the same deadline and backoff.
    }
    const elapsed = now() - start;
    if (elapsed >= waitMs) {
      const pid = last && last.pid != null ? last.pid : '?';
      const host = last && last.host != null ? last.host : '?';
      throw new KitExit(`${file} is locked by another run (holder pid ${pid} on host ${host})`, 1);
    }
    const base = Math.min(maxPollMs, pollMs * 2 ** Math.min(attempt++, 10));
    const wait = Math.max(1, Math.min(base * (0.5 + Math.random() * 0.5), waitMs - elapsed));
    await sleep(wait);
  }

  // Held. Heartbeat: rewrite our own lock in place so waiters see it change.
  let beat = 0;
  let inFlight = null;
  const heartbeat = async () => {
    let fh;
    try { fh = await fs.open(lock, 'r+'); } catch { return; }
    try {
      const cur = holderOf(await fh.readFile('utf-8'));
      if (!cur || cur.token !== token) return;
      const next = Buffer.from(body(++beat));
      await fh.write(next, 0, next.length, 0);
      await fh.truncate(next.length);
    } catch { /* a missed beat only brings staleness closer */ } finally {
      await fh.close().catch(() => {});
    }
  };
  const timer = setInterval(() => { if (!inFlight) inFlight = heartbeat().finally(() => { inFlight = null; }); }, Math.max(1, staleMs / 3));
  timer.unref();

  let failed = false;
  try {
    return await fn();
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    clearInterval(timer);
    if (inFlight) await inFlight;
    try {
      const cur = await readOrNull(fs, lock);
      if (cur !== null && holderOf(cur)?.token === token) await fs.unlink(lock);
    } catch (err) {
      if (err.code !== 'ENOENT' && !failed) throw new KitExit(`cannot unlock ${file}: ${err.code || err.message}`, 1);
    }
  }
}

/** Read a JSON state file. A UTF-8 BOM is skipped; UTF-16 and malformed JSON fail with fixed texts (content never echoed). */
export async function readJsonState(file, { fallback } = {}) {
  let buf;
  try { buf = await fsp.readFile(file); } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (err.code === 'ENOENT') throw new KitExit(`${file} does not exist`, 1);
    throw new KitExit(`cannot read ${file}: ${err.code || err.message}`, 1);
  }
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    throw new KitExit(`${file} is UTF-16; save it as UTF-8`, 1);
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  try { return JSON.parse(buf.toString('utf-8')); } catch {
    throw new KitExit(`${file} is not valid JSON`, 1);
  }
}

/** Write `value` as JSON via a temp file and rename; folders are created; the temp file never remains after a failure. */
export async function writeJsonAtomic(file, value) {
  try { await fsp.mkdir(path.dirname(file), { recursive: true }); } catch (err) {
    throw new KitExit(`cannot create the folder for ${file}: ${err.code || err.message}`, 1);
  }
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const fh = await fsp.open(tmp, 'wx', 0o600);
    try {
      await fh.writeFile(JSON.stringify(value, null, 2) + '\n');
      await fh.sync();
    } finally { await fh.close(); }
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw new KitExit(`cannot write ${file}: ${err.code || err.message}`, 1);
  }
}
