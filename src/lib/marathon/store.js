/**
 * Marathon run store: append-only JSONL tables under <runDir>/store/
 * One file per table; rows are written in order and read back in order.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export const TABLES = ['runs', 'reviews', 'findings', 'helpers', 'compactions', 'promotions', 'measurements'];

function assertTable(table) {
  if (!TABLES.includes(table)) {
    throw new Error(`unknown table: ${table} (expected one of ${TABLES.join(', ')})`);
  }
}

/**
 * Path of a table's JSONL file inside a run directory.
 */
export function storePath(runDir, table) {
  assertTable(table);
  return path.join(runDir, 'store', `${table}.jsonl`);
}

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 10000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const isRow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Run `fn` holding <table>.jsonl.lock (created with O_EXCL), so a repair that
 * rewrites a table never drops a row appended meanwhile. Waits up to
 * LOCK_WAIT_MS with a jittered retry; a lock older than LOCK_STALE_MS (a
 * crashed holder) is removed. The lock is always released. Reads do not take
 * it.
 */
async function withTableLock(file, fn) {
  const lock = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;

  for (;;) {
    try {
      const fh = await fs.open(lock, 'wx');
      await fh.writeFile(`${process.pid}\n`, 'utf-8').catch(() => {}); // for whoever finds it
      await fh.close().catch(() => {});
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }

    let stat;
    try {
      stat = await fs.stat(lock);
    } catch (err) {
      if (err.code === 'ENOENT') continue; // released meanwhile: try again
      throw err;
    }
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      // Only remove the lock we judged stale, not one taken since.
      const again = await fs.stat(lock).catch(() => null);
      if (again && again.ino === stat.ino && again.mtimeMs === stat.mtimeMs) {
        await fs.unlink(lock).catch(() => {});
      }
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`${path.basename(file)} is locked by another writer (${lock}); remove the lock if no marathon command is running`);
    }
    await sleep(15 + Math.floor(Math.random() * 26));
  }

  try {
    return await fn();
  } finally {
    await fs.unlink(lock).catch(() => {});
  }
}

// True when the file exists, is non-empty and its last byte is not '\n'
// (a half-written last line).
async function endsMidLine(file) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  try {
    const { size } = await fh.stat();
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    await fh.read(last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    await fh.close();
  }
}

/**
 * Append one row to a table. Adds `id` (uuid) and `ts` (ISO) when absent.
 * When the file ends mid-line (a half-written row), a newline is written
 * first so the new row stays on its own line; the half line stays corrupt
 * and is counted by readAllWithReport. Holds the table lock, so it waits for
 * a running repair instead of being lost to it. Returns the row as written.
 */
export async function append(runDir, table, row) {
  const file = storePath(runDir, table);
  const stored = {
    ...row,
    id: row?.id ?? randomUUID(),
    ts: row?.ts ?? new Date().toISOString()
  };
  await withTableLock(file, async () => {
    const lead = (await endsMidLine(file)) ? '\n' : '';
    await fs.appendFile(file, lead + JSON.stringify(stored) + '\n', 'utf-8');
  });
  return stored;
}

/**
 * Read every row of a table in write order, plus the number of corrupt lines
 * that were skipped: a line that does not parse as JSON, or parses to
 * something other than an object (null, a number, a string, an array). A
 * missing table reads as { rows: [], corrupt: 0 }. Blank lines are ignored; a
 * corrupt line is counted, never fatal. Takes no lock.
 */
export async function readAllWithReport(runDir, table) {
  const file = storePath(runDir, table);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return { rows: [], corrupt: 0 };
    throw err;
  }
  const rows = [];
  let corrupt = 0;
  for (const text of raw.split('\n')) {
    const line = text.trim();
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (isRow(row)) rows.push(row);
      else corrupt++;
    } catch {
      corrupt++;
    }
  }
  return { rows, corrupt };
}

/**
 * Read every row of a table in write order. A missing table reads as [];
 * corrupt lines are skipped (see readAllWithReport to count them).
 */
export async function readAll(runDir, table) {
  return (await readAllWithReport(runDir, table)).rows;
}

/**
 * Quarantine a table's corrupt lines. Lines that do not parse as JSON, or
 * parse to something other than an object, are appended, text unchanged, to
 * <table>.jsonl.corrupt; the valid lines are rewritten to the table, one per
 * line. Blank lines are dropped silently. A missing table is
 * { table, kept: 0, removed: 0 }. Holds the table lock, so a row appended
 * meanwhile waits and lands after the rewrite.
 */
export async function repairTable(runDir, table) {
  const file = storePath(runDir, table);
  const exists = await fs.access(file).then(() => true, (err) => {
    if (err.code === 'ENOENT') return false;
    throw err;
  });
  if (!exists) return { table, kept: 0, removed: 0 };
  return withTableLock(file, () => repairLocked(file, table));
}

async function repairLocked(file, table) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return { table, kept: 0, removed: 0 };
    throw err;
  }
  const kept = [];
  const removed = [];
  for (const text of raw.split('\n')) {
    const line = text.trim();
    if (!line) continue;
    try {
      if (isRow(JSON.parse(line))) kept.push(line);
      else removed.push(text);
    } catch {
      removed.push(text);
    }
  }

  // Quarantine first: a crash before the rewrite leaves the corrupt lines in
  // both files, never in neither.
  if (removed.length > 0) {
    await fs.appendFile(`${file}.corrupt`, removed.map(t => t + '\n').join(''), 'utf-8');
  }
  const clean = kept.map(t => t + '\n').join('');
  if (clean !== raw) {
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, clean, 'utf-8');
    await fs.rename(tmp, file);
  }
  return { table, kept: kept.length, removed: removed.length };
}

/**
 * Fold helper spawn/done rows into one record per helper id.
 * Spawn rows: { event: 'spawn', id, budget, model, stream }
 * Done rows:  { event: 'done', helper_id, tokens }
 */
export function foldHelpers(rows) {
  const folded = new Map();
  const entry = (id) => {
    if (!folded.has(id)) {
      folded.set(id, {
        id, budget: null, model: null, stream: null, role: null, escalated_from: null,
        tokens: null, outcome: null, done: false, over_budget: false
      });
    }
    return folded.get(id);
  };

  for (const row of rows ?? []) {
    if (row?.event === 'spawn') {
      const h = entry(row.id);
      h.budget = row.budget ?? null;
      h.model = row.model ?? null;
      h.stream = row.stream ?? null;
      h.role = row.role ?? null;
      h.escalated_from = row.escalated_from ?? null;
    } else if (row?.event === 'done') {
      const h = entry(row.helper_id);
      h.tokens = row.tokens ?? null;
      h.outcome = row.outcome ?? null;
      h.done = true;
    }
  }

  for (const h of folded.values()) {
    h.over_budget = h.done && typeof h.tokens === 'number' && typeof h.budget === 'number' && h.tokens > h.budget;
  }
  return folded;
}
