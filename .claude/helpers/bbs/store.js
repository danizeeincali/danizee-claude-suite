/**
 * bbs store — run directories, the ACTIVE pointer, atomic JSON, JSONL and the source registry.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { DEFAULT_CONFIG } from './config.js';

export function runsDir(projectDir, cfg = DEFAULT_CONFIG) {
  return path.join(projectDir, cfg.paths.runs);
}

export function runDir(projectDir, runId, cfg = DEFAULT_CONFIG) {
  return path.join(runsDir(projectDir, cfg), runId);
}

const activeFile = (projectDir) => path.join(projectDir, '.claude', 'bbs', 'ACTIVE');

export async function activeRunId(projectDir) {
  try {
    const id = (await fs.readFile(activeFile(projectDir), 'utf-8')).trim();
    return id || null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function setActiveRun(projectDir, runId) {
  const file = activeFile(projectDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeTextAtomic(file, runId + '\n'); // atomic: a failed write must not wipe the previous pointer
}

export async function clearActiveRun(projectDir) {
  await fs.rm(activeFile(projectDir), { force: true });
}

export async function readJson(file, fallback = null) {
  let raw;
  try { raw = await fs.readFile(file, 'utf-8'); }
  catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  try { return JSON.parse(raw); }
  catch (err) { throw new Error(`corrupt JSON in ${file}: ${err.message}`); }
}

export async function writeJson(file, data) {
  await writeTextAtomic(file, JSON.stringify(data, null, 2) + '\n'); // serialise first: a failure leaves nothing behind
}

/** Write text or raw bytes via tmp+rename so readers never see a partial file. */
export async function writeTextAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export async function appendJsonl(file, row) {
  const stored = row.ts ? { ...row } : { ...row, ts: new Date().toISOString() };
  const line = JSON.stringify(stored) + '\n';
  await fs.mkdir(path.dirname(file), { recursive: true });
  let prefix = '';
  try {
    const fh = await fs.open(file, 'r');
    try {
      const { size } = await fh.stat();
      if (size > 0) {
        const buf = Buffer.alloc(1);
        await fh.read(buf, 0, 1, size - 1);
        if (buf[0] !== 0x0a) prefix = '\n';
      }
    } finally { await fh.close(); }
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
  await fs.appendFile(file, prefix + line);
  return stored;
}

export async function readJsonl(file, { report = false } = {}) {
  let raw = '';
  try { raw = await fs.readFile(file, 'utf-8'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  const rows = [];
  let corrupt = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row !== null && typeof row === 'object' && !Array.isArray(row)) rows.push(row); else corrupt++;
    } catch { corrupt++; }
  }
  return report ? { rows, corrupt } : rows;
}

export function registryPath(projectDir, cfg = DEFAULT_CONFIG) {
  return path.join(projectDir, cfg.paths.registry);
}

export async function appendRegistry(projectDir, row, cfg = DEFAULT_CONFIG) {
  for (const key of ['identity', 'type', 'run']) {
    if (!row || typeof row[key] !== 'string' || !row[key]) throw new Error(`registry row needs ${key}`);
  }
  if (row.identity === 'pending') throw new Error('registry row identity must be known, not pending');
  return appendJsonl(registryPath(projectDir, cfg), row);
}

export async function lookupSource(projectDir, identity, cfg = DEFAULT_CONFIG) {
  if (!identity || identity === 'pending') return null;
  const rows = await readJsonl(registryPath(projectDir, cfg));
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i] && rows[i].identity === identity) return rows[i];
  return null;
}

/** Claim a `<name>.stale-<stamp>[-<hex>].json` path that does not exist yet (created empty, then renamed over). */
async function claimStaleName(dir, name, stamp) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const suffix = attempt === 0 ? '' : `-${randomBytes(3).toString('hex')}`;
    const to = path.join(dir, `${name}.stale-${stamp}${suffix}.json`);
    try {
      await (await fs.open(to, 'wx')).close();
      return to;
    } catch (err) {
      if (err.code !== 'EEXIST') throw new Error(`could not move ${name} aside before --force: ${err.message}`);
    }
  }
  throw new Error(`could not find a free stale name for ${name} before --force`);
}

/**
 * Move each existing `names` file in `dir` to `<name>.stale-<ts>.json`, claiming the stale target exclusively.
 * Returns the moved names (an array with a non-enumerable `restore()` that puts them back and returns
 * { restored, notRestored }). If a move fails part-way, what was moved is restored and the error names both lists.
 */
export async function moveAsideStale(dir, names, now = () => new Date(), { rename = fs.rename } = {}) {
  const stamp = now().toISOString().replace(/:/g, '-');
  const moved = []; // { name, from, to }
  const movedNames = [];
  const restore = async () => {
    const restored = [];
    const notRestored = [];
    for (const m of [...moved].reverse()) {
      try { await rename(m.to, m.from); restored.unshift(m.name); } catch { notRestored.unshift(m.name); }
    }
    return { restored, notRestored };
  };
  try {
    for (const name of names) {
      const from = path.join(dir, name);
      try {
        await fs.lstat(from);
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw new Error(`could not move ${from} aside before --force: ${err.message}`);
      }
      const to = await claimStaleName(dir, name, stamp);
      try {
        await rename(from, to);
      } catch (err) {
        await fs.rm(to, { force: true });
        if (err.code === 'ENOENT') continue;
        throw new Error(`could not move ${from} aside before --force: ${err.message}`);
      }
      moved.push({ name, from, to });
      movedNames.push(name);
    }
  } catch (err) {
    const { restored, notRestored } = await restore();
    let msg = `${err.message}; stale_moved so far: [${movedNames.join(', ')}]; restored: [${restored.join(', ')}]`;
    if (notRestored.length) msg += `; NOT restored (still named *.stale-*): [${notRestored.join(', ')}]`;
    throw new Error(msg);
  }
  Object.defineProperty(movedNames, 'restore', { value: restore, enumerable: false });
  return movedNames;
}

// ---------------------------------------------------------------------------------------------------------------
// The run lock (map.lock)

export const LOCK_STALE_MS = 60 * 1000;
export const LOCK_REFRESH_MS = 20 * 1000;

/**
 * Hold an exclusive run lock (map.lock, created 'wx') for a read-modify-write of map.json.
 * The lock file holds `${pid} ${token}`; release removes it only if the token is still ours.
 * A lock whose mtime is older than staleMs is abandoned: it is renamed aside (never deleted), the renamed content is checked
 * against what was stat'ed, and ours is created. On a mismatch the moved file is put back with rename (only when map.lock
 * is free; hard links are never used) and the held error is thrown — naming the aside file if it could not be put back.
 * While fn runs the lock's mtime is refreshed every refreshMs.
 * Returns { result, warning } (warning is null when the release was clean).
 */
export async function withMapLockDetailed(runDir, fn, { now = () => Date.now(), staleMs = LOCK_STALE_MS, refreshMs = LOCK_REFRESH_MS, rm = (p, o) => fs.rm(p, o), rename = (a, b) => fs.rename(a, b) } = {}) {
  const lockPath = path.join(runDir, 'map.lock');
  const held = () => new Error('map.json is locked by another bbs command (map.lock); remove it if none is running');
  const token = randomBytes(12).toString('hex');
  const mine = `${process.pid} ${token}\n`;
  let acquired = false;
  for (let attempt = 0; attempt < 3 && !acquired; attempt++) {
    let fh;
    try {
      fh = await fs.open(lockPath, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let st, seen;
      try {
        st = await fs.stat(lockPath);
        seen = await fs.readFile(lockPath, 'utf-8');
      } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      if (!(now() - st.mtimeMs > staleMs)) throw held();
      const aside = `${lockPath}.stale-${token}`;
      try { await rename(lockPath, aside); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      let got = null;
      try { got = await fs.readFile(aside, 'utf-8'); } catch { /* unreadable: treat as a mismatch */ }
      if (got !== seen) {
        // We moved someone else's fresh lock aside. Put it back with rename (no hard links needed) only if the path is
        // still free, then stop: never retry, so a foreign lock is never replaced by ours. If the path is occupied or the
        // rename fails, the aside file is named in the error so a human can sort it out.
        const leftAside = new Error(`${held().message} (a lock file was left aside at ${path.basename(aside)})`);
        let free = false;
        try { await fs.lstat(lockPath); } catch (e) { if (e.code === 'ENOENT') free = true; }
        if (!free) throw leftAside;
        try { await rename(aside, lockPath); } catch { throw leftAside; }
        throw held();
      }
      continue;
    }
    try { await fh.writeFile(mine); } finally { await fh.close(); }
    acquired = true;
  }
  if (!acquired) throw held();

  const timer = setInterval(() => {
    const t = new Date(now());
    fs.utimes(lockPath, t, t).catch(() => {});
  }, refreshMs);
  timer.unref();
  let result;
  try {
    result = await fn();
  } catch (err) {
    clearInterval(timer);
    try { await releaseLock(lockPath, token, rm); } catch { /* the verb's own error wins */ }
    throw err;
  }
  clearInterval(timer);
  let warning = null;
  try {
    warning = await releaseLock(lockPath, token, rm);
  } catch (err) {
    warning = `could not release map.lock (${err.code ?? 'error'})`;
  }
  return { result, warning };
}

/** Remove map.lock only if it still carries our token. Returns a warning string when it was taken over, else null. */
async function releaseLock(lockPath, token, rm) {
  const takenOver = 'map.lock was taken over by another process; left in place';
  let content;
  try {
    content = await fs.readFile(lockPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return takenOver;
    throw err;
  }
  if (content.trim().split(' ')[1] !== token) return takenOver;
  await rm(lockPath, { force: true });
  return null;
}

/** withMapLockDetailed, returning only fn's result (the release warning is dropped; use the detailed form to see it). */
export async function withMapLock(runDir, fn, opts) {
  return (await withMapLockDetailed(runDir, fn, opts)).result;
}
