/**
 * bbs inventory — validate and cap powers from analysis results.
 * Helpers read the source and return JSON only; the CLI validates, caps at 12, marks the rest `not_inventoried`.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, runsDir as runsDirOf, readJson, writeTextAtomic } from './store.js';
import { RUN_ID, invalidRunId } from './intake.js';
import { loadState, nextStep, renderStatusSafe } from './status.js';

export const POWER_FIELDS = ['name', 'what', 'evidence', 'dependencies', 'data_needed', 'network', 'size', 'licence', 'idea'];
export const NETWORK = ['none', 'outbound', 'inbound', 'unknown'];
export const SIZE = ['small', 'medium', 'large'];
export const NAME_MAX = 80;
export const IDEA_MAX = 1200;

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u;
const RESERVED_NAMES = ['__proto__', 'constructor', 'prototype'];
// C0, DEL, C1 and the Unicode line/paragraph separators
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const LINE_BREAK_RE = /[\r\n\u2028\u2029]/;

/** The stored form of a power name: NFC, runs of whitespace collapsed to one space, trimmed. */
export function normaliseName(name) {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Validate a name at index i and return its stored form. */
function validateName(raw, i) {
  if (typeof raw !== 'string') throw new Error(`powers[${i}].name must be a string`);
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`powers[${i}].name is empty`);
  if (LINE_BREAK_RE.test(trimmed)) throw new Error(`powers[${i}].name must be one line (no line breaks)`);
  if (CONTROL_RE.test(trimmed)) throw new Error(`powers[${i}].name must not contain control characters (tab, bell, …)`);
  const name = normaliseName(trimmed);
  if (name.length > NAME_MAX) throw new Error(`powers[${i}].name is longer than ${NAME_MAX} characters`);
  if (/[\/\\|]/.test(name)) throw new Error(`powers[${i}].name must not contain /, \\ or | (got "${name}")`);
  if (name.startsWith('.')) throw new Error(`powers[${i}].name must not start with "." (got "${name}")`);
  if (RESERVED_NAMES.includes(name.toLowerCase())) {
    throw new Error(`powers[${i}].name "${name}" is reserved (${RESERVED_NAMES.join(', ')} are not allowed)`);
  }
  if (!NAME_RE.test(name)) {
    throw new Error(`powers[${i}].name may only contain letters, digits, space, ".", "_" and "-", starting with a letter or digit (got "${name}")`);
  }
  return name;
}

/** Language-neutral signals that a line is code rather than prose. */
function looksLikeCode(line) {
  const t = line.trim();
  if (!t) return false;
  if (/[;{}]$/.test(t)) return true;
  if (/^(def|fn|func|function|class|if|for|while)\b.*:$/.test(t)) return true;
  if (/^(?: {4,}|\t)[\w$]+\s*[(=.]/.test(line)) return true;
  return false;
}

/** True when the idea is code, not our words: any ``` fence, or 3+ lines with more than half code-like. */
function ideaIsCode(idea) {
  if (idea.includes('```')) return true;
  const lines = idea.split(/\r?\n/);
  if (lines.length < 3) return false;
  return lines.filter(looksLikeCode).length > lines.length / 2;
}

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
  const name = validateName(p.name, i);

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
  if (idea.length > IDEA_MAX) throw new Error(`powers[${i}].idea is longer than ${IDEA_MAX} characters`);
  if (ideaIsCode(idea)) throw new Error(`powers[${i}].idea must be in our words, not code`);

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
const FENCE_RE = /^\s*```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?\s*```\s*$/;

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

    // Strip a markdown fence: opening at the start (any tag case, trailing blanks, CRLF), closing at the END
    const fenced = FENCE_RE.exec(text);
    if (fenced) text = fenced[1];
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
      if (typeof data.none_found !== 'string') {
        throw new Error(`none_found must be a string (got ${data.none_found === null ? 'null' : typeof data.none_found})`);
      }
      none_found = data.none_found.trim();
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
    const normalizedName = normaliseName(p.name).toLowerCase();
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

const SECRET_NAMES = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /^\.npmrc$/,
  /^\.netrc$/,
  /^credentials(\..*)?$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /^\.git-credentials$/
];
const LICENCE_RE = /^(LICEN[CS]E|COPYING)([.-]|$)/i;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
/** Files a forced re-inventory makes stale (built for the replaced powers). */
export const STALE_ON_FORCE = ['map.json', 'verdicts.json', 'handoff.json'];

/** True when a file name looks like it holds secrets (never listed in a brief). */
export function isSecretName(name) {
  return SECRET_NAMES.some(re => re.test(name));
}

/**
 * List files in the source. Source must be fetched and identity not pending.
 * Returns { root, files: [{ path, size }], total, truncated, licence_file, omitted_secret, errors: [{ path, code }] }.
 * The root must exist and be a directory; unreadable subdirectories are collected in `errors`.
 * Symlinks, .git and node_modules are skipped; secret-like files are counted, never listed.
 */
export async function listSourceFiles(runDir, source, { maxFiles = 500 } = {}) {
  if (!source || source.fetched !== true) {
    throw new Error('source must be fetched before inventory');
  }
  if (source.identity === 'pending') {
    throw new Error('source identity must be known before inventory (fetch)');
  }

  const root = source.type === 'local' ? source.ref : path.join(runDir, 'fetched');

  let rootStat;
  try {
    rootStat = await fs.stat(root);
  } catch (err) {
    throw new Error(`source root ${root} is missing or not a directory — re-run intake (${err.code || err.message})`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`source root ${root} is missing or not a directory — re-run intake`);
  }

  const all = [];
  const licences = [];
  const errors = [];
  let omitted_secret = 0;

  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      errors.push({ path: prefix || '.', code: err.code || 'UNKNOWN' });
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      let stat;
      try {
        stat = await fs.lstat(fullPath);
      } catch (err) {
        errors.push({ path: relPath, code: err.code || 'UNKNOWN' });
        continue;
      }

      if (stat.isSymbolicLink()) continue;

      if (stat.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (stat.isFile()) {
        if (isSecretName(entry.name)) {
          omitted_secret++;
          continue;
        }
        all.push({ path: relPath, size: stat.size });
        if (LICENCE_RE.test(entry.name)) licences.push(relPath);
      }
    }
  }

  await walk(root, '');

  const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  all.sort((a, b) => a.path.localeCompare(b.path));
  errors.sort((a, b) => byPath(a.path, b.path));
  const depth = (p) => p.split('/').length;
  licences.sort((a, b) => depth(a) - depth(b) || byPath(a, b));

  const total = all.length;
  return {
    root,
    files: all.slice(0, maxFiles),
    total,
    truncated: total > maxFiles,
    licence_file: licences[0] || null,
    omitted_secret,
    errors
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
    lines.push(`**${files.total} files in total** — only the first ${files.files.length} are listed. Inventory only the files listed here; name any unlisted top-level directory in evidence instead of reading it.\n`);
  }
  for (const f of files.files) {
    lines.push(`- ${f.path} (${f.size} bytes)`);
  }
  lines.push('');
  if (files.omitted_secret > 0) {
    lines.push(`Never copy values from configuration or secret files into evidence or idea; ${files.omitted_secret} secret-like file(s) were omitted from this list.`);
    lines.push('');
  }
  if (Array.isArray(files.errors) && files.errors.length > 0) {
    lines.push('### Could not read\n');
    for (const e of files.errors) lines.push(`- ${e.path} (${e.code})`);
    lines.push('');
  }

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
  lines.push(`- \`name\`: ≤ ${NAME_MAX} characters, one line of letters, digits, space, ".", "_" and "-"`);
  lines.push('- `what`: a one-line description in our words');
  lines.push('- `evidence`: where in the source this capability lives (file:line, URL, etc.)');
  lines.push('- `dependencies`: array of strings (e.g., `["node:fs", "@babel/parser"]`)');
  lines.push('- `data_needed`: what data or config this power requires');
  lines.push('- `network`: one of: `none`, `outbound`, `inbound`, `unknown`');
  lines.push('- `size`: one of: `small`, `medium`, `large`');
  lines.push('- `licence`: the licence name (e.g., `MIT`, `Apache-2.0`, `unknown`)');
  lines.push(`- \`idea\`: the power in our words, ≤ ${IDEA_MAX} characters. Do not copy source code. Inline code is fine; code blocks are not.`);
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

  const powersFile = path.join(runDirectory, 'powers.json');
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
  const text = JSON.stringify(powersData, null, 2) + '\n'; // serialise first: a failure leaves nothing behind

  const stale_moved = [];
  if (force) {
    // Later steps were built for the replaced powers: move them aside BEFORE the new powers.json lands.
    const stamp = ts.replace(/:/g, '-');
    for (const name of STALE_ON_FORCE) {
      const from = path.join(runDirectory, name);
      try {
        await fs.rename(from, path.join(runDirectory, `${name}.stale-${stamp}.json`));
        stale_moved.push(name);
      } catch (err) {
        if (err.code !== 'ENOENT') throw new Error(`could not move ${from} aside before --force: ${err.message}`);
      }
    }
    await writeTextAtomic(powersFile, text);
  } else {
    // Claim exclusively: link fails with EEXIST if another run (or an earlier one) already wrote powers.json.
    const tmp = `${powersFile}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmp, text, { flag: 'wx' });
      await fs.link(tmp, powersFile);
    } catch (err) {
      if (err.code === 'EEXIST') throw new Error('powers.json exists — pass --force to replace it');
      throw err;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

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
    stale_moved,
    next
  };
}
