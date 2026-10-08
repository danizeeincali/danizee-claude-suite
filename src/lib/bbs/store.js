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
  await fs.writeFile(file, runId + '\n');
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
