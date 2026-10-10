/**
 * /bc configuration: one small per-project file, .claude/bc.json, names the files a handoff
 * reads and writes and the context thresholds /bc decides by. The command itself ships once,
 * at user level; a project only adds this file.
 *
 * Thresholds resolve bc.json → .claude/marathon.json `bc` block → defaults, so a project that
 * tuned them for marathon keeps its numbers.
 */

import fs from 'fs/promises';
import path from 'path';
import { loadConfig as loadMarathonConfig } from '../marathon/config.js';

export const CONFIG_FILE = path.join('.claude', 'bc.json');

export const DEFAULT_BC_CONFIG = {
  // Every stream's row: where it lives, plan, state, next step, running task ids.
  status: '.claude/plans/STATUS.md',
  // The finish line. Optional: a project without one simply leaves it out of the keep-list.
  kickoff: null,
  rules: '.claude/plans/RULES.md',
  memory: 'docs/solutions',
  // One JSON row per compaction (manual, auto, or a /bc decision).
  db: '.claude/bc/compactions.jsonl',
  prune_below_pct: 50,
  clear_above_pct: 80,
  context_window: 1000000
};

const PATH_KEYS = ['status', 'kickoff', 'rules', 'memory', 'db'];
const NUMBER_KEYS = ['prune_below_pct', 'clear_above_pct', 'context_window'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Check a parsed bc.json. Returns a list of problems; empty means valid.
 */
export function validateBcConfig(cfg) {
  const problems = [];
  if (!isPlainObject(cfg)) return ['bc.json must be a JSON object'];
  for (const k of PATH_KEYS) {
    if (cfg[k] === undefined || cfg[k] === null) continue;
    if (typeof cfg[k] !== 'string' || !cfg[k].trim()) problems.push(`${k} must be a path string`);
    else if (path.isAbsolute(cfg[k]) || cfg[k].split(/[\\/]/).includes('..')) problems.push(`${k} must be a path inside the project`);
  }
  for (const k of NUMBER_KEYS) {
    if (cfg[k] === undefined) continue;
    if (!(Number.isFinite(cfg[k]) && cfg[k] > 0)) problems.push(`${k} must be a positive number`);
  }
  const lo = cfg.prune_below_pct, hi = cfg.clear_above_pct;
  if (Number.isFinite(lo) && Number.isFinite(hi) && lo > hi) problems.push('prune_below_pct must not exceed clear_above_pct');
  return problems;
}

/**
 * Load <projectDir>/.claude/bc.json over the defaults.
 * Returns { config, configured } where configured is true only when the file exists.
 * Throws on invalid JSON or invalid values, naming the file.
 */
export async function loadBcConfig(projectDir) {
  const file = path.join(projectDir, CONFIG_FILE);
  let raw = null;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  let user = {};
  if (raw !== null) {
    try {
      user = JSON.parse(raw);
    } catch {
      throw new Error(`invalid JSON in ${file}`);
    }
    const problems = validateBcConfig(user);
    if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  }

  let marathonBc = {};
  try {
    marathonBc = (await loadMarathonConfig(projectDir)).bc || {};
  } catch {
    // A broken marathon.json is marathon's problem; /bc keeps working on its own defaults.
  }

  const config = { ...DEFAULT_BC_CONFIG };
  for (const k of NUMBER_KEYS) {
    if (Number.isFinite(marathonBc[k]) && marathonBc[k] > 0) config[k] = marathonBc[k];
  }
  for (const k of [...PATH_KEYS, ...NUMBER_KEYS]) {
    if (user[k] !== undefined) config[k] = user[k];
  }
  return { config, configured: raw !== null, file };
}
