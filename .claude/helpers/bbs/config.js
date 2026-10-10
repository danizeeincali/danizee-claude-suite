/**
 * bbs config — defaults plus an optional project override at .claude/bbs.json.
 */

import fs from 'fs/promises';
import path from 'path';

export const LICENCE_CLASSES = ['permissive', 'copyleft', 'commercial', 'none'];

export const DEFAULT_CONFIG = {
  limits: { max_urls: 25, max_bytes: 20 * 1024 * 1024, max_checkout_bytes: 200 * 1024 * 1024, max_powers: 12, max_redirects: 5, timeout_ms: 30000 },
  licences: {
    permissive: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'Zlib', 'BlueOak-1.0.0'],
    copyleft: ['GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0', 'MPL-2.0', 'EUPL-1.2', 'CC-BY-SA-4.0', 'SSPL-1.0', 'OSL-3.0'],
    commercial: ['Commercial', 'Proprietary', 'BUSL-1.1', 'Elastic-2.0', 'All-Rights-Reserved']
  },
  sandbox: { required_for_use: true },
  usage: { roots: ['~/.claude/projects'], days: 90 },
  paths: { runs: '.claude/bbs/runs', registry: '.claude/bbs/registry.jsonl', marathon_cli: '.claude/helpers/marathon/cli.js' }
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out = { ...base };
  for (const key of Object.keys(over)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = isPlainObject(base[key]) && isPlainObject(over[key]) ? deepMerge(base[key], over[key]) : over[key];
  }
  return out;
}

export async function loadConfig(projectDir) {
  const file = path.join(projectDir, '.claude', 'bbs.json');
  let raw;
  try { raw = await fs.readFile(file, 'utf-8'); }
  catch (err) {
    if (err.code === 'ENOENT') return structuredClone(DEFAULT_CONFIG);
    throw err;
  }
  let user;
  try { user = JSON.parse(raw); }
  catch (err) { throw new Error(`invalid JSON in ${file}: ${err.message}`); }
  if (!isPlainObject(user)) throw new Error(`invalid config in ${file}: expected an object`);
  const cfg = deepMerge(structuredClone(DEFAULT_CONFIG), user);
  validatePaths(cfg, projectDir, file);
  validateUsage(cfg, file);
  return cfg;
}

/** usage.roots is a non-empty list of non-empty paths; usage.days a positive integer. A bad value never scans silently. */
function validateUsage(cfg, file) {
  const u = cfg.usage;
  if (!isPlainObject(u)) throw new Error(`invalid config in ${file}: usage must be an object`);
  if (!Array.isArray(u.roots) || !u.roots.length || !u.roots.every(r => typeof r === 'string' && r.trim() !== '')) {
    throw new Error(`invalid config in ${file}: usage.roots must be a non-empty list of paths, e.g. ["~/.claude/projects"]`);
  }
  if (!Number.isSafeInteger(u.days) || u.days <= 0) throw new Error(`invalid config in ${file}: usage.days must be a positive integer, got ${JSON.stringify(u.days)}`);
}

/** Every configured path stays inside the project: runs and registry under .claude/bbs, marathon_cli under the project. */
function validatePaths(cfg, projectDir, file) {
  if (!isPlainObject(cfg.paths)) throw new Error(`invalid config in ${file}: paths must be an object`);
  const root = path.resolve(projectDir, '.claude', 'bbs');
  for (const key of ['runs', 'registry']) {
    const value = cfg.paths[key];
    const ok = typeof value === 'string' && value !== '' && !path.isAbsolute(value) && (() => {
      const resolved = path.resolve(projectDir, value);
      return resolved.startsWith(root + path.sep) || (key === 'runs' && resolved === root);
    })();
    if (!ok) throw new Error(`invalid config in ${file}: paths.${key} "${value}" must stay under .claude/bbs`);
  }
  const cli = cfg.paths.marathon_cli;
  if (typeof cli !== 'string' || cli === '' || path.isAbsolute(cli)) {
    throw new Error(`invalid config in ${file}: paths.marathon_cli "${cli}" must be a non-empty relative path`);
  }
  const cliRel = path.relative(path.resolve(projectDir), path.resolve(projectDir, cli));
  if (!cliRel || cliRel.startsWith('..') || path.isAbsolute(cliRel)) {
    throw new Error(`invalid config in ${file}: paths.marathon_cli "${cli}" must stay under the project`);
  }
}
