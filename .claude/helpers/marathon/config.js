/**
 * Marathon configuration: defaults, .claude/marathon.json merge, run paths,
 * and the ACTIVE run pointer.
 */

import fs from 'fs/promises';
import path from 'path';

export const DEFAULT_CONFIG = {
  ceiling_pct: 70,
  // A weekly-allowance reading (record measure key=usage_pct) counts for this long; after that it is 'unknown'.
  usage_reading_ttl_minutes: 30,
  run_token_budget: 20000000,
  helper_budget: { default: 150000, max: 200000 },
  max_concurrent_builders: 3,
  // Tiers, never versions: a new release in a tier is picked up automatically.
  // Routing is speed × probability — with contracts + failing tests the test run catches a cheap
  // builder's miss for free, so scoped work starts on the cheapest tier and climbs the ladder.
  models: {
    build_scoped: 'haiku',
    build: 'sonnet',
    build_hard: 'opus',
    review: 'opus',
    routine: 'haiku',
    ladder: ['haiku', 'sonnet', 'opus', 'session']
  },
  routing: { scoped_max_files: 3, hard_categories: ['security', 'migration'] },
  streams: { isolation: 'worktree' },
  review: {
    backend: 'agent',
    scope: 'diff-since-clean',
    reviewers_per_round: 1,
    categories: ['correctness', 'security', 'accessibility', 'performance', 'facts', 'test-quality', 'process', 'docs', 'other']
  },
  bc: { prune_below_pct: 50, clear_above_pct: 80, context_window: 1000000, push: false },
  paths: { runs: '.claude/marathon', memory: 'docs/solutions' }
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep merge: objects merge recursively, arrays and scalars replace.
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key === '__proto__') continue;
    if (isPlainObject(source[key]) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = structuredClone(source[key]);
    }
  }
  return result;
}

/**
 * Load <projectDir>/.claude/marathon.json merged over the defaults.
 */
export async function loadConfig(projectDir) {
  const base = structuredClone(DEFAULT_CONFIG);
  const file = path.join(projectDir, '.claude', 'marathon.json');
  let raw;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return base;
    throw err;
  }
  let user;
  try {
    user = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON in ${file}`);
  }
  if (!isPlainObject(user)) return base;
  return deepMerge(base, user);
}

export function runsDir(projectDir, cfg = DEFAULT_CONFIG) {
  return path.join(projectDir, cfg.paths.runs);
}

export function runDir(projectDir, runId, cfg = DEFAULT_CONFIG) {
  return path.join(runsDir(projectDir, cfg), runId);
}

/**
 * Read the ACTIVE run id (trimmed), or null when none is set.
 */
export async function activeRunId(projectDir, cfg = DEFAULT_CONFIG) {
  try {
    const raw = await fs.readFile(path.join(runsDir(projectDir, cfg), 'ACTIVE'), 'utf-8');
    return raw.trim() || null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function setActiveRun(projectDir, runId, cfg = DEFAULT_CONFIG) {
  const dir = runsDir(projectDir, cfg);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'ACTIVE'), runId + '\n', 'utf-8');
}
