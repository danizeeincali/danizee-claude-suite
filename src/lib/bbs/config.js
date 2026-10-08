/**
 * bbs config — defaults plus an optional project override at .claude/bbs.json.
 */

import fs from 'fs/promises';
import path from 'path';

export const LICENCE_CLASSES = ['permissive', 'copyleft', 'commercial', 'none'];

export const DEFAULT_CONFIG = {
  limits: { max_urls: 25, max_bytes: 20 * 1024 * 1024, max_powers: 12, max_redirects: 5, timeout_ms: 30000 },
  licences: {
    permissive: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'Zlib', 'BlueOak-1.0.0'],
    copyleft: ['GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0', 'MPL-2.0', 'EUPL-1.2', 'CC-BY-SA-4.0', 'SSPL-1.0', 'OSL-3.0'],
    commercial: ['Commercial', 'Proprietary', 'BUSL-1.1', 'Elastic-2.0', 'All-Rights-Reserved']
  },
  sandbox: { required_for_use: true },
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
  return deepMerge(structuredClone(DEFAULT_CONFIG), user);
}
