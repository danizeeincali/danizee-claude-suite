/**
 * Marathon status
 * Stream bookkeeping in <runDir>/streams.json and the status.md renderer.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const streamsFile = (runDir) => path.join(runDir, 'streams.json');

const stripQuotes = (t) => t.replace(/^(["'])(.*)\1$/, '$2').trim();
const cleanTasks = (items) => items
  .filter(item => item !== undefined && item !== null)
  .map(item => String(item).trim())
  .filter(Boolean);

/**
 * Tasks as an array of non-empty strings. Accepts an array, a JSON array
 * string ('["t1"]'), or loose text ('[t1,t2]', 't1, t2'); anything else is [].
 */
export function normalizeTasks(value) {
  if (Array.isArray(value)) return cleanTasks(value);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return cleanTasks(parsed);
  } catch {
    // not JSON: fall through to the loose form
  }
  const bare = value.trim().replace(/^\[(.*)\]$/s, '$1');
  return cleanTasks(bare.split(',').map(stripQuotes));
}

const withTasks = (stream) => ({ ...stream, tasks: normalizeTasks(stream?.tasks) });

// A missing streams.json is an empty run; an unreadable one is an error that
// names the file, never a silent reset.
async function readState(runDir) {
  let raw;
  try {
    raw = await fs.readFile(streamsFile(runDir), 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return { streams: [], handoff: null };
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`streams.json in ${runDir} is not valid JSON (${err.message})`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`streams.json in ${runDir} is not an object`);
  }
  return {
    streams: Array.isArray(data.streams) ? data.streams : [],
    handoff: data.handoff ?? null
  };
}

// Write to a temp file in the same directory, then rename over streams.json.
async function writeState(runDir, state) {
  await fs.mkdir(runDir, { recursive: true });
  const file = streamsFile(runDir);
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 10000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Run `fn` holding <runDir>/streams.json.lock (created with O_EXCL), so a
 * read-modify-write of streams.json never loses another writer's change.
 * Waits up to LOCK_WAIT_MS; a lock older than LOCK_STALE_MS (a crashed
 * holder) is removed. The lock is always released.
 */
async function withStreamsLock(runDir, fn) {
  await fs.mkdir(runDir, { recursive: true });
  const lock = `${streamsFile(runDir)}.lock`;
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
      throw new Error(`streams.json in ${runDir} is locked by another writer (${lock}); remove the lock if no marathon command is running`);
    }
    await sleep(15 + Math.floor(Math.random() * 26));
  }

  try {
    return await fn();
  } finally {
    await fs.unlink(lock).catch(() => {});
  }
}

/**
 * All streams of a run ([] when none recorded yet).
 */
export async function readStreams(runDir) {
  return (await readState(runDir)).streams;
}

/**
 * Replace the stream list (tasks normalised to arrays); the recorded handoff
 * is kept. Locked against concurrent writers.
 */
export async function writeStreams(runDir, streams) {
  await withStreamsLock(runDir, async () => {
    const state = await readState(runDir);
    await writeState(runDir, { ...state, streams: (streams ?? []).map(withTasks) });
  });
}

/**
 * Merge a patch into the named stream, creating it when missing. Tasks are
 * normalised to an array on every stream written. Locked against concurrent
 * writers, so parallel calls never lose a stream. Returns the updated stream.
 */
export async function setStream(runDir, name, patch) {
  return withStreamsLock(runDir, async () => {
    const state = await readState(runDir);
    const i = state.streams.findIndex(s => s.name === name);
    const stream = withTasks(i === -1 ? { name, ...patch } : { ...state.streams[i], ...patch });
    if (i === -1) state.streams.push(stream);
    else state.streams[i] = stream;
    await writeState(runDir, { ...state, streams: state.streams.map(withTasks) });
    return stream;
  });
}

/**
 * The last recorded handoff, or null.
 */
export async function readHandoff(runDir) {
  return (await readState(runDir)).handoff;
}

/**
 * Record a handoff (trigger, branch, commit, uncommitted, tasks) with a
 * timestamp. Streams are left untouched; locked against concurrent writers.
 * Returns the handoff.
 */
export async function stampHandoff(runDir, info) {
  return withStreamsLock(runDir, async () => {
    const state = await readState(runDir);
    const handoff = { ts: new Date().toISOString(), ...info };
    await writeState(runDir, { ...state, handoff });
    return handoff;
  });
}

const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const cell = (v) => oneLine(v).replace(/\|/g, '\\|');

const STATUS_TEXT = { waiting_on_human: 'waiting on human', not_counted: 'not counted', run_scoped: 'run-wide (judged by the run gate)' };
const statusText = (s) => STATUS_TEXT[s] ?? String(s ?? '');
const show = (v) => (v == null ? '—' : String(v));

// One stream's own gate verdict: "met", or how many clean reviews it has.
function streamGateCell(gate) {
  if (!gate || typeof gate !== 'object') return '—';
  if (gate.met) return 'met';
  return `clean ${gate.passes ?? 0}/${gate.needed ?? 0}`;
}

// A stream row's gate: its own `gate`, else the entry for its name in streamGates
// (a plain object or a Map keyed by stream name).
function gateOf(stream, streamGates) {
  if (stream?.gate) return stream.gate;
  if (streamGates instanceof Map) return streamGates.get(stream?.name);
  if (streamGates && typeof streamGates === 'object' && Object.hasOwn(streamGates, stream?.name)) return streamGates[stream.name];
  return undefined;
}

/**
 * Render status.md: header block, streams table, finish line table and the
 * lines waiting on a human. `state` (e.g. 'FINISHED') overrides the derived
 * RUNNING/PAUSED; `corrupt` > 0 adds a warning about skipped store lines;
 * `next` adds a "Next for you" line telling a returning human what to do.
 * The header gate is run-wide; each stream's own gate verdict goes in the
 * Gate column of the streams table (from `stream.gate` or `streamGates[name]`,
 * each { met, passes, needed }).
 */
export function renderStatus({ runId, config, gate = {}, budget = {}, score, streams = [], streamGates, escapes = 0, handoff = null, corrupt, state, next }) {
  const sc = score ?? { passes: 0, needed: config.review?.tolerance?.passes_in_a_row ?? 0 };
  const spent = budget.spent ?? 0;
  const paused = budget.ok === false;
  const escapeCount = Array.isArray(escapes) ? escapes.length : (escapes ?? 0);

  const lines = [
    `# Marathon ${runId}`,
    '',
    typeof state === 'string' && state !== ''
      ? `- State: ${state}`
      : `- State: ${paused ? 'PAUSED (budget)' : 'RUNNING'}${budget.reason && paused ? ' — ' + budget.reason : ''}`,
    `- Budget: ${spent.toLocaleString('en-US')} / ${config.run_token_budget.toLocaleString('en-US')} tokens`,
    `- Allowance: ${budget.usage_pct == null ? 'unknown' : budget.usage_pct + '%'} (ceiling ${config.ceiling_pct}%)`,
    `- Gate (run-wide, all streams): ${sc.passes}/${sc.needed} clean reviews — build gate ${gate.buildGateMet ? 'met' : 'not met'}, full gate ${gate.gateMet ? 'met' : 'not met'}`,
    `- Escapes: ${escapeCount}`
  ];
  if (typeof next === 'string' && oneLine(next) !== '') {
    lines.push(`- Next for you: ${oneLine(next)}`);
  }
  if (typeof corrupt === 'number' && corrupt > 0) {
    lines.push(`- ⚠ Store: ${corrupt} corrupt line(s) skipped`);
  }
  if (handoff) {
    const tasks = normalizeTasks(handoff.tasks);
    lines.push(`- Last handoff: ${handoff.ts} (${handoff.trigger}) on ${handoff.branch}@${handoff.commit}, ${handoff.uncommitted} uncommitted, tasks: ${tasks.join(', ') || 'none'}`);
  }

  lines.push('', '## Streams', '');
  if (streams.length === 0) {
    lines.push('_No streams yet._');
  } else {
    lines.push(
      '| Stream | Isolation | Plan | State | Gate | Phase | Next | Tasks | Escapes |',
      '|---|---|---|---|---|---|---|---|---|'
    );
    for (const s of streams) {
      const phase = `${s.skill ? '/' + s.skill + ' · ' : ''}${s.phase || ''}`;
      lines.push(`| ${cell(s.name)} | ${cell(s.isolation)} | ${cell(s.plan)} | ${cell(s.state)} | ${cell(streamGateCell(gateOf(s, streamGates)))} | ${cell(phase)} | ${cell(s.next)} | ${cell(normalizeTasks(s.tasks).join(', '))} | ${s.escapes ?? 0} |`);
    }
  }

  lines.push('', '## Finish line', '');
  const gateLines = gate.lines ?? [];
  if (gateLines.length === 0) {
    lines.push('_No finish line configured._');
  } else {
    lines.push('| Line | Owner | Status | Actual | Target |', '|---|---|---|---|---|');
    for (const l of gateLines) {
      const target = l.value == null ? '—' : `${l.op} ${l.value}`;
      lines.push(`| ${cell(l.label ?? l.id)} | ${cell(l.owner)} | ${cell(statusText(l.status))} | ${cell(show(l.actual))} | ${cell(target)} |`);
    }
  }

  lines.push('', '## Waiting on human', '');
  const waiting = gate.waitingOnHuman ?? [];
  if (waiting.length === 0) {
    lines.push('none');
  } else {
    for (const id of waiting) {
      const line = gateLines.find(l => l.id === id);
      lines.push(line?.label ? `- ${id} — ${oneLine(line.label)}` : `- ${id}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
