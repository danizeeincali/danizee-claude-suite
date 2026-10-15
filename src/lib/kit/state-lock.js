/**
 * state-lock — one lock and one JSON read/write path for the kit verbs that keep a state file (noise-ledger, triage,
 * reflect, shared-budget). A library, not a verb: cli.js discovery skips it (no `verb` export).
 * Built for marathon 2026-10-15-bbs-bugpatrol; no foreign code.
 *
 *   withStateLock(file, fn, { staleMs = 30000, waitMs = 2 * staleMs, pollMs, now, sleep })  → fn's result
 *   readJsonState(file, { fallback })                                                      → parsed JSON
 *   writeJsonAtomic(file, value)                                                           → undefined
 *
 * LOCK. The file's folder is created if missing. `<file>.lock` is created with O_EXCL ('wx') and holds {token, pid, host, pidns, boot, beat}. Only EEXIST means "held";
 * any other open error is fatal (KitExit 1 "cannot lock <file>: <code>"). While fn runs, the holder rewrites the lock
 * every staleMs/3 with beat+1 (opened 'r+', so a removed lock is never recreated, and only while it still holds our
 * token). Release removes the lock only if it still holds our token.
 *
 * STALENESS is judged only by what the waiter itself sees on its own monotonic clock: a lock is stale when its exact
 * content has stayed unchanged for staleMs of the waiter's observation. File mtimes and wall clocks are never used, so
 * clock skew on a network filesystem cannot break a live lock. Shortcut: a lock whose pid no longer exists
 * (kill(pid, 0) → ESRCH) is stale at once, but only when it names this host, this pid namespace and this machine's
 * per-boot id (Linux /proc/sys/kernel/random/boot_id), and that boot id is known on both sides. Hostnames repeat across
 * machines and the init pid namespace id is the same kernel constant everywhere, so without a boot id on either side
 * (non-Linux, unreadable, or a lock without a boot field) the shortcut is never taken and only the unchanged-for-staleMs
 * rule applies.
 *
 * BREAK. A waiter that judged the lock stale takes `<file>.lock.break` ('wx'; a non-EEXIST error is fatal, never
 * retried), re-reads the lock and removes it only if its content is byte-identical to what was judged stale, then
 * removes its own break file. A leftover break file is judged by the same rule (unchanged content for staleMs, or a
 * dead pid on this host) and removed only if its content is still the one judged. Every loop pass — lock fresh,
 * stale, break lost, unreadable — goes through the same deadline check and a jittered backoff sleep; past waitMs it
 * fails with KitExit 1 "<file> is locked by another run (holder pid P on host H)".
 *
 * LOST LOCK. fn runs in an AsyncLocalStorage context that records this lock and its token. writeJsonAtomic for a file
 * whose lock that context holds writes its temp file, then re-reads `<file>.lock` just before the rename; if the lock
 * no longer holds our token (missing, another token, unreadable) it removes the temp file and fails with KitExit 1
 * "lost the lock on <file> to another run; nothing saved". This covers a holder whose heartbeat stalled long enough
 * to be broken. Outside a lock context writeJsonAtomic does not look at any lock.
 *
 * Residual window, by design: between a breaker's re-read and its unlink, only a holder that was itself judged stale
 * (no heartbeat for staleMs) can be affected.
 */

import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { KitExit } from './kit-exit.js';

const HOST = os.hostname();
// The pid namespace (Linux). Containers can share a hostname and a volume but not a pid namespace, so a pid that is
// invisible here may be alive there; the dead-pid shortcut also requires the lock to name this same namespace.
// The init namespace id is identical on every Linux machine, so it never stands in for a machine identity (see BOOT).
const PIDNS = (() => { try { return fsSync.readlinkSync('/proc/self/ns/pid'); } catch { return null; } })();
// The per-boot machine identity (Linux), read once. null when unreadable: then the dead-pid shortcut is never taken.
const BOOT = (() => {
  try { return fsSync.readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim() || null; } catch { return null; }
})();

// Locks held by the current async context: Map(absolute lock path → token).
const held = new AsyncLocalStorage();

function holderOf(content) {
  try {
    const o = JSON.parse(content);
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}

/** True when the content names a process on this machine (host, boot id and pid namespace) that no longer exists. */
function deadOnThisHost(content) {
  if (BOOT === null) return false;
  const h = holderOf(content);
  if (!h || h.host !== HOST || !Number.isInteger(h.pid) || h.pid <= 0) return false;
  if (typeof h.boot !== 'string' || h.boot !== BOOT) return false;
  if (h.pidns !== PIDNS) return false;
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
  const body = beat => JSON.stringify({ token, pid: process.pid, host: HOST, pidns: PIDNS, boot: BOOT, beat });

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
    const mine = new Map(held.getStore() ?? []);
    mine.set(path.resolve(lock), token);
    return await held.run(mine, fn);
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

/**
 * Write `value` as JSON via a temp file and rename; folders are created; the temp file never remains after a failure.
 * An existing file keeps its mode; a new one gets 0666 & ~umask.
 * Inside withStateLock for this file, the rename happens only if the lock still holds our token (see LOST LOCK).
 */
export async function writeJsonAtomic(file, value) {
  try { await fsp.mkdir(path.dirname(file), { recursive: true }); } catch (err) {
    throw new KitExit(`cannot create the folder for ${file}: ${err.code || err.message}`, 1);
  }
  const token = held.getStore()?.get(path.resolve(`${file}.lock`));
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  // Keep an existing file's mode; a new file gets 0666 masked by the umask (the kernel applies it at open), as
  // fs.writeFile would. The temp file starts at 0600 and takes the target's mode before any content is written.
  let keepMode = null;
  try { keepMode = (await fsp.stat(file)).mode & 0o7777; } catch (err) {
    if (err.code !== 'ENOENT') throw new KitExit(`cannot write ${file}: ${err.code || err.message}`, 1);
  }
  try {
    const fh = await fsp.open(tmp, 'wx', keepMode === null ? 0o666 : 0o600);
    try {
      if (keepMode !== null) await fh.chmod(keepMode);
      await fh.writeFile(JSON.stringify(value, null, 2) + '\n');
      await fh.sync();
    } finally { await fh.close(); }
    if (token !== undefined) {
      let cur = null;
      // Synchronous: the lock file is tiny, and nothing else runs between this check and the rename's start.
      try { cur = holderOf(fsSync.readFileSync(`${file}.lock`, 'utf-8')); } catch { /* missing or unreadable: lost */ }
      if (!cur || cur.token !== token) {
        await fsp.unlink(tmp).catch(() => {});
        throw new KitExit(`lost the lock on ${file} to another run; nothing saved`, 1);
      }
    }
    await fsp.rename(tmp, file);
  } catch (err) {
    if (err instanceof KitExit) throw err;
    await fsp.unlink(tmp).catch(() => {});
    throw new KitExit(`cannot write ${file}: ${err.code || err.message}`, 1);
  }
}
