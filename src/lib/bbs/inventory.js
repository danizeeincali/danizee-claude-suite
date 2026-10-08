/**
 * bbs inventory — validate and cap powers from analysis results.
 * Helpers read the source and return JSON only; the CLI validates, caps at 12, marks the rest `not_inventoried`.
 */

import fs from 'fs/promises';
import path from 'path';
import { lstatSync } from 'fs';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, runsDir as runsDirOf, readJson, writeJson } from './store.js';
import { RUN_ID, invalidRunId } from './intake.js';
import { loadState, nextStep, renderStatusSafe } from './status.js';

export const POWER_FIELDS = ['name', 'what', 'evidence', 'dependencies', 'data_needed', 'network', 'size', 'licence', 'idea'];
export const NETWORK = ['none', 'outbound', 'inbound', 'unknown'];
export const SIZE = ['small', 'medium', 'large'];

/**
 * Validate a power at index i. Returns a normalised copy with trimmed strings, lower-case enums,
 * exactly the nine fields (no extras, no prototype keys).
 */
export function validatePower(p, i) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    throw new Error(`powers[${i}] must be an object`);
  }

  // Check for prototype pollution: the object's prototype should be Object.prototype
  if (Object.getPrototypeOf(p) !== Object.prototype) {
    throw new Error(`powers[${i}] has a custom prototype (no prototype keys allowed)`);
  }

  // Validate each required field exists
  for (const field of POWER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(p, field)) {
      throw new Error(`powers[${i}].${field} is missing (required)`);
    }
  }

  // Check types and content for each field
  if (typeof p.name !== 'string') throw new Error(`powers[${i}].name must be a string`);
  const name = p.name.trim();
  if (!name) throw new Error(`powers[${i}].name is empty`);
  if (name.length > 80) throw new Error(`powers[${i}].name is longer than 80 characters`);

  if (typeof p.what !== 'string') throw new Error(`powers[${i}].what must be a string`);
  const what = p.what.trim();
  if (!what) throw new Error(`powers[${i}].what is empty`);

  if (typeof p.evidence !== 'string') throw new Error(`powers[${i}].evidence must be a string`);
  const evidence = p.evidence.trim();
  if (!evidence) throw new Error(`powers[${i}].evidence is empty`);

  if (!Array.isArray(p.dependencies)) {
    throw new Error(`powers[${i}].dependencies must be an array of strings`);
  }
  for (let j = 0; j < p.dependencies.length; j++) {
    if (typeof p.dependencies[j] !== 'string') {
      throw new Error(`powers[${i}].dependencies[${j}] must be a string`);
    }
  }

  if (typeof p.data_needed !== 'string') throw new Error(`powers[${i}].data_needed must be a string`);
  const data_needed = p.data_needed.trim();
  if (!data_needed) throw new Error(`powers[${i}].data_needed is empty`);

  if (typeof p.network !== 'string') throw new Error(`powers[${i}].network must be a string`);
  const network = p.network.trim().toLowerCase();
  if (!network) throw new Error(`powers[${i}].network is empty`);
  if (!NETWORK.includes(network)) {
    throw new Error(`powers[${i}].network must be ${NETWORK.join('|')}`);
  }

  if (typeof p.size !== 'string') throw new Error(`powers[${i}].size must be a string`);
  const size = p.size.trim().toLowerCase();
  if (!size) throw new Error(`powers[${i}].size is empty`);
  if (!SIZE.includes(size)) {
    throw new Error(`powers[${i}].size must be ${SIZE.join('|')}`);
  }

  if (typeof p.licence !== 'string') throw new Error(`powers[${i}].licence must be a string`);
  const licence = p.licence.trim();
  if (!licence) throw new Error(`powers[${i}].licence is empty`);

  if (typeof p.idea !== 'string') throw new Error(`powers[${i}].idea must be a string`);
  const idea = p.idea.trim();
  if (!idea) throw new Error(`powers[${i}].idea is empty`);
  if (idea.length > 1200) throw new Error(`powers[${i}].idea is longer than 1200 characters`);

  // Check if idea is mostly code
  if (idea.startsWith('```')) {
    throw new Error(`powers[${i}].idea must be in our words, not code`);
  }
  const lines = idea.split('\n');
  const codeLines = lines.filter(l => /^\s*(const|let|var|function|class|export|import|async|await|=>|return|if|for|while|try|catch|case|switch|default|break|continue|throw|new|this|super|extends|implements|interface|type|enum|namespace|module|package)[\s({]/.test(l.trim())).length;
  if (codeLines > lines.length / 2) {
    throw new Error(`powers[${i}].idea must be in our words, not code`);
  }

  // Build the result with exactly the nine fields, no extras
  const result = {};
  for (const field of POWER_FIELDS) {
    if (field === 'name') result[field] = name;
    else if (field === 'what') result[field] = what;
    else if (field === 'evidence') result[field] = evidence;
    else if (field === 'dependencies') result[field] = p.dependencies;
    else if (field === 'data_needed') result[field] = data_needed;
    else if (field === 'network') result[field] = network;
    else if (field === 'size') result[field] = size;
    else if (field === 'licence') result[field] = licence;
    else if (field === 'idea') result[field] = idea;
  }

  return result;
}

/**
 * Parse inventory JSON input (string, object, or array). Returns { powers, not_inventoried, total, none_found }.
 * maxPowers defaults to 12. Zero powers without a none_found string is an error.
 */
export function parseInventory(input, { maxPowers = 12 } = {}) {
  if (!Number.isInteger(maxPowers) || maxPowers <= 0) {
    throw new Error('maxPowers must be a positive integer');
  }

  let data;

  if (Buffer.isBuffer(input)) {
    input = input.toString('utf-8');
  }

  if (typeof input === 'string') {
    let text = input.trim();

    // Strip markdown fence
    if (text.startsWith('```json\n')) {
      text = text.slice(8);
      // Also remove trailing fence
      if (text.endsWith('\n```')) {
        text = text.slice(0, -4);
      } else if (text.endsWith('```')) {
        text = text.slice(0, -3);
      }
    } else if (text.startsWith('```')) {
      text = text.slice(3);
      const end = text.indexOf('```');
      if (end >= 0) {
        text = text.slice(0, end);
      }
    }
    text = text.trim();

    if (!text) {
      throw new Error('JSON only — got empty input');
    }

    try {
      data = JSON.parse(text);
    } catch (err) {
      const preview = text.slice(0, 60);
      throw new Error(`JSON only — got: ${preview}`);
    }
  } else {
    data = input;
  }

  // Accept bare array or { powers: [...], none_found?: string }
  let powers = null;
  let none_found = null;

  if (Array.isArray(data)) {
    powers = data;
  } else if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    if (!Object.prototype.hasOwnProperty.call(data, 'powers')) {
      throw new Error('input must have a "powers" field');
    }
    if (!Array.isArray(data.powers)) {
      throw new Error('powers must be an array');
    }
    powers = data.powers;
    if (Object.prototype.hasOwnProperty.call(data, 'none_found')) {
      none_found = data.none_found;
    }
  } else {
    throw new Error('input must be an array or have a "powers" field');
  }

  // Validate the presence of powers and none_found
  if (powers.length === 0) {
    if (!none_found || typeof none_found !== 'string' || !none_found.trim()) {
      throw new Error('empty powers list requires a non-empty none_found string');
    }
  } else {
    if (none_found && typeof none_found === 'string' && none_found.trim()) {
      throw new Error('cannot have both none_found and powers at the same time');
    }
  }

  // Validate and normalize each power
  const validated = [];
  const seen = new Map(); // normalized name -> index
  for (let i = 0; i < powers.length; i++) {
    const p = validatePower(powers[i], i);
    const normalizedName = p.name.trim().toLowerCase();
    if (seen.has(normalizedName)) {
      const first = seen.get(normalizedName);
      throw new Error(`duplicate power name "${normalizedName}" at powers[${first}] and powers[${i}]`);
    }
    seen.set(normalizedName, i);
    validated.push(p);
  }

  // Cap at maxPowers
  const kept = validated.slice(0, maxPowers);
  const not_inventoried = validated.slice(maxPowers).map(p => p.name);
  const total = powers.length;

  return {
    powers: kept,
    not_inventoried,
    total,
    none_found: none_found || null
  };
}

/**
 * List files in the source. Source must be fetched and identity not pending.
 * Returns { root, files: [{ path, size }], total, truncated, licence_file }.
 */
export async function listSourceFiles(runDir, source, { maxFiles = 500 } = {}) {
  if (!source || source.fetched !== true) {
    throw new Error('source must be fetched before inventory');
  }
  if (source.identity === 'pending') {
    throw new Error('source identity must be known before inventory (fetch)');
  }

  const root = source.type === 'local' ? source.ref : path.join(runDir, 'fetched');

  const files = [];
  const seen = new Set();
  let licence_file = null;
  let totalCount = 0;

  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? path.join(prefix, entry.name).replace(/\\/g, '/') : entry.name;

      // Skip .git and node_modules
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }

      // Skip symlinks
      let stat;
      try {
        stat = lstatSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isSymbolicLink()) {
        continue;
      }

      if (stat.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (stat.isFile()) {
        totalCount++;
        // Only add to files array if we haven't hit the limit
        if (files.length < maxFiles || maxFiles === 0) {
          files.push({ path: relPath, size: stat.size });
        }

        // Check for licence file
        if (!licence_file && /^(LICEN[CS]E|COPYING)(\.|$)/i.test(entry.name)) {
          licence_file = relPath;
        }
      }
    }
  }

  await walk(root, '');
  files.sort((a, b) => a.path.localeCompare(b.path));

  const total = totalCount;
  const truncated = total > maxFiles;
  const kept = files.slice(0, maxFiles);

  return {
    root,
    files: kept,
    total,
    truncated,
    licence_file
  };
}

/**
 * Generate a markdown brief for the inventory helper. Must include all field names, both enums,
 * the cap, "JSON only", "do not execute", file list, and the licence hint.
 */
export function inventoryBrief({ source, files, maxPowers }) {
  const lines = [];

  lines.push('# Inventory Brief\n');
  lines.push(`Source type: ${source.type}`);
  lines.push(`Source ref: ${source.ref}`);
  lines.push(`Source identity: ${source.identity}\n`);

  lines.push(`Root: ${files.root}\n`);

  lines.push('## Files in this source\n');
  if (files.truncated) {
    lines.push(`**${files.total} files in total** — only the first ${files.files.length} are listed; ask for a narrower slice.\n`);
  }
  for (const f of files.files) {
    lines.push(`- ${f.path} (${f.size} bytes)`);
  }
  lines.push('');

  if (files.licence_file) {
    lines.push(`**Licence**: Read ${files.licence_file}`);
  } else {
    lines.push('**Licence**: no licence file found — use unknown');
  }
  lines.push('');

  lines.push('## Your task\n');
  lines.push('Read the source files above. Do not execute or run anything — list reusable capabilities only.');
  lines.push('');

  lines.push('## JSON shape\n');
  lines.push('Find at most ' + maxPowers + ' distinct capabilities in this source. Each capability is a power: a `{ "powers": [...] }` object or bare array.');
  lines.push('');
  lines.push('Each power must have exactly these nine fields:');
  for (const f of POWER_FIELDS) {
    lines.push(`- ${f}`);
  }
  lines.push('');

  lines.push('### Field rules\n');
  lines.push('- `name`: ≤ 80 characters');
  lines.push('- `what`: a one-line description in our words');
  lines.push('- `evidence`: where in the source this capability lives (file:line, URL, etc.)');
  lines.push('- `dependencies`: array of strings (e.g., `["node:fs", "@babel/parser"]`)');
  lines.push('- `data_needed`: what data or config this power requires');
  lines.push('- `network`: one of: `none`, `outbound`, `inbound`, `unknown`');
  lines.push('- `size`: one of: `small`, `medium`, `large`');
  lines.push('- `licence`: the licence name (e.g., `MIT`, `Apache-2.0`, `unknown`)');
  lines.push('- `idea`: the power in our words, ≤ 1200 characters. Do not copy source code. Inline code is fine; code blocks are not.');
  lines.push('');

  lines.push('### Example\n');
  lines.push('```json');
  lines.push('{');
  lines.push('  "powers": [');
  lines.push('    {');
  lines.push('      "name": "example-power",');
  lines.push('      "what": "What this power does",');
  lines.push('      "evidence": "src/file.js:42",');
  lines.push('      "dependencies": ["node:fs"],');
  lines.push('      "data_needed": "none",');
  lines.push('      "network": "none",');
  lines.push('      "size": "small",');
  lines.push('      "licence": "MIT",');
  lines.push('      "idea": "Explain the power in plain language — what it does, why it works, any constraints."');
  lines.push('    }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');

  lines.push('If the source has no capabilities (e.g., it is a landing page), use:');
  lines.push('```json');
  lines.push('{ "powers": [], "none_found": "why there are no reusable capabilities here" }');
  lines.push('```');
  lines.push('');

  lines.push('**JSON only** — no prose before or after.\n');
  lines.push('The result goes to: `cli.js inventory --from <file>`');

  return lines.join('\n');
}

/**
 * Write the inventory powers.json file. Resolves run dir, loads source.json, parses input,
 * validates, checks for overwrites, and writes atomically.
 */
export async function writeInventory(projectDir, { run, input, force = false, now, cfg = DEFAULT_CONFIG }) {
  if (!RUN_ID.test(run)) throw new Error(invalidRunId(run));
  const runLower = run.toLowerCase();
  const runDirectory = runDirOf(projectDir, runLower, cfg);
  if (!path.resolve(runDirectory).startsWith(path.resolve(runsDirOf(projectDir, cfg)) + path.sep)) {
    throw new Error(invalidRunId(run));
  }

  // Load source.json
  const sourceFile = path.join(runDirectory, 'source.json');
  const source = await readJson(sourceFile);
  if (!source) {
    throw new Error(`run "${runLower}" has no source.json — run \`cli.js intake <source>\` first`);
  }

  // Check that source is fetched
  if (!source.fetched || source.identity === 'pending') {
    throw new Error('source must be fetched before inventory (run `cli.js fetch` first)');
  }

  // Parse the input
  const maxPowers = cfg.limits.max_powers || 12;
  const parsed = parseInventory(input, { maxPowers });

  // Check if powers.json already exists
  const powersFile = path.join(runDirectory, 'powers.json');
  try {
    await fs.stat(powersFile);
    if (!force) {
      throw new Error('powers.json exists — pass --force to replace it');
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // File doesn't exist, which is good
  }

  // Write powers.json atomically
  const ts = now ? now().toISOString() : new Date().toISOString();
  const powersData = {
    run: runLower,
    source_identity: source.identity,
    powers: parsed.powers,
    not_inventoried: parsed.not_inventoried,
    total: parsed.total,
    none_found: parsed.none_found,
    ts
  };

  await writeJson(powersFile, powersData);

  // Re-render status
  await renderStatusSafe(runDirectory);

  // Get the next step
  const state = await loadState(runDirectory);
  const next = nextStep(state);

  return {
    runId: runLower,
    found: parsed.powers.length,
    not_inventoried: parsed.not_inventoried,
    total: parsed.total,
    none_found: parsed.none_found,
    next
  };
}
