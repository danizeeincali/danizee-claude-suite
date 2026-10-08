/**
 * bbs harness-map — index the harness (commands, skills, helpers, hooks, modules, scripts),
 * match powers to candidates by IDF-weighted cosine similarity, build and update the map.
 */

import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, readJson, writeJson, writeTextAtomic } from './store.js';
import { RUN_ID, invalidRunId } from './intake.js';
import { loadState, nextStep, renderStatusSafe } from './status.js';

export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by',
  'is', 'are', 'be', 'it', 'this', 'that', 'as', 'at', 'from', 'into', 'than',
  'then', 'so', 'not', 'no', 'but', 'if', 'we', 'you', 'our', 'your', 'its',
  'they', 'them', 'their', 'i', 'me', 'my', 'do', 'does', 'did', 'has', 'have',
  'had', 'will', 'can', 'use', 'used', 'using', 'run', 'runs'
]);

export const KINDS = ['command', 'skill', 'helper', 'hook', 'module', 'script'];
export const STATUSES = ['have', 'partial', 'missing'];

/**
 * Tokenize text: lowercase, split on non-alphanumerics (respecting Unicode),
 * drop stop words and 1-char tokens, keep repeats.
 */
export function tokenize(text) {
  const str = String(text ?? '').toLowerCase();
  const tokens = str.split(/[^\p{L}\p{N}]+/u).filter(t => t && t.length > 1 && !STOP_WORDS.has(t));
  return tokens;
}

/**
 * Compute IDF (Inverse Document Frequency) over a list of token lists.
 * Returns a Map token → ln((N+1)/(df+1)) + 1, with an `unseen` property = ln((N+1)/1) + 1.
 */
export function idf(docs) {
  const N = docs.length;
  const df = new Map(); // document frequency: how many docs contain each token
  for (const doc of docs) {
    const seen = new Set(doc);
    for (const token of seen) df.set(token, (df.get(token) ?? 0) + 1);
  }

  const idfMap = new Map();
  for (const [token, count] of df) {
    const weight = Math.log((N + 1) / (count + 1)) + 1;
    idfMap.set(token, weight);
  }

  // Unseen tokens get the max IDF: df = 0
  const unseen = Math.log((N + 1) / 1) + 1;
  Object.defineProperty(idfMap, 'unseen', { value: unseen, enumerable: false });

  return idfMap;
}

/**
 * Create a TF-IDF vector from tokens and an IDF map, with optional per-token boost.
 * Returns a Map token → tf × idf × boost.
 */
export function vectorize(tokens, idfMap, { boost } = {}) {
  const tf = new Map(); // term frequency: count of each token
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  const vec = new Map();
  for (const [token, count] of tf) {
    const idfVal = idfMap.get(token) ?? idfMap.unseen;
    const boostVal = boost?.get(token) ?? 1;
    vec.set(token, count * idfVal * boostVal);
  }

  return vec;
}

/**
 * Cosine similarity between two vectors (Maps).
 * Returns 1 for identical, 0 for disjoint or empty vectors, symmetric.
 */
export function cosine(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [token, val] of a) {
    const bVal = b.get(token) ?? 0;
    dotProduct += val * bVal;
    normA += val * val;
  }

  for (const val of b.values()) {
    normB += val * val;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dotProduct / denom;
}

/**
 * Index the harness: commands, skills, helpers, hooks, modules, and scripts.
 * Returns { rows, byKind, errors, project } sorted by id; throws if empty.
 */
export async function buildIndex(projectDir, { maxLines = 80 } = {}) {
  const rows = [];
  const byKind = {};
  const errors = [];

  // Helper to read a file safely
  const readFileSafe = async (filePath) => {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      errors.push({ path: path.relative(projectDir, filePath), code: err.code });
      return null;
    }
  };

  // Helper to walk a directory
  const walk = async (dir, processFile) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        const fullPath = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(fullPath, processFile);
        } else if (ent.isFile()) {
          await processFile(fullPath);
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  };

  // Commands: .claude/commands/**/*.md
  await walk(path.join(projectDir, '.claude', 'commands'), async (filePath) => {
    if (!filePath.endsWith('.md')) return;
    const relPath = path.relative(projectDir, filePath);
    const content = await readFileSafe(filePath);
    if (content === null) return;
    const name = path.basename(filePath, '.md');
    const lines = content.split('\n').slice(0, maxLines);
    const text = (name + '\n' + lines.join('\n')).toLowerCase();
    const tokens = tokenize(text);
    rows.push({ id: `command:${relPath}`, kind: 'command', name, path: relPath, text, tokens });
  });

  // Skills: .claude/skills/*/SKILL.md
  await walk(path.join(projectDir, '.claude', 'skills'), async (filePath) => {
    if (!filePath.endsWith('SKILL.md')) return;
    const relPath = path.relative(projectDir, filePath);
    const parentDir = path.dirname(filePath);
    const name = path.basename(parentDir);
    const content = await readFileSafe(filePath);
    if (content === null) return;
    const lines = content.split('\n').slice(0, maxLines);
    const text = (name + '\n' + lines.join('\n')).toLowerCase();
    const tokens = tokenize(text);
    rows.push({ id: `skill:${relPath}`, kind: 'skill', name, path: relPath, text, tokens });
  });

  // Helpers: .claude/helpers/**/*.js
  await walk(path.join(projectDir, '.claude', 'helpers'), async (filePath) => {
    if (!filePath.endsWith('.js')) return;
    const relPath = path.relative(projectDir, filePath);
    const name = path.basename(filePath, '.js');
    const content = await readFileSafe(filePath);
    if (content === null) return;
    const lines = content.split('\n').slice(0, maxLines);
    const text = (name + '\n' + lines.join('\n')).toLowerCase();
    const tokens = tokenize(text);
    rows.push({ id: `helper:${relPath}`, kind: 'helper', name, path: relPath, text, tokens });
  });

  // Hooks: .claude/hooks/*.sh
  await walk(path.join(projectDir, '.claude', 'hooks'), async (filePath) => {
    if (!filePath.endsWith('.sh')) return;
    const relPath = path.relative(projectDir, filePath);
    const name = path.basename(filePath, '.sh');
    const content = await readFileSafe(filePath);
    if (content === null) return;
    const lines = content.split('\n').slice(0, maxLines);
    const text = (name + '\n' + lines.join('\n')).toLowerCase();
    const tokens = tokenize(text);
    rows.push({ id: `hook:${relPath}`, kind: 'hook', name, path: relPath, text, tokens });
  });

  // Modules: src/lib/**/*.js and src/plugins/**/*.js
  for (const srcDir of [path.join(projectDir, 'src', 'lib'), path.join(projectDir, 'src', 'plugins')]) {
    await walk(srcDir, async (filePath) => {
      if (!filePath.endsWith('.js')) return;
      const relPath = path.relative(projectDir, filePath);
      const name = path.basename(filePath, '.js');
      const content = await readFileSafe(filePath);
      if (content === null) return;
      const lines = content.split('\n').slice(0, maxLines);
      const text = (name + '\n' + lines.join('\n')).toLowerCase();
      const tokens = tokenize(text);
      rows.push({ id: `module:${relPath}`, kind: 'module', name, path: relPath, text, tokens });
    });
  }

  // Scripts: scripts/** (files) and package.json scripts
  await walk(path.join(projectDir, 'scripts'), async (filePath) => {
    const relPath = path.relative(projectDir, filePath);
    const name = path.basename(filePath);
    const content = await readFileSafe(filePath);
    if (content === null) return;
    const lines = content.split('\n').slice(0, maxLines);
    const text = (name + '\n' + lines.join('\n')).toLowerCase();
    const tokens = tokenize(text);
    rows.push({ id: `script:${relPath}`, kind: 'script', name, path: relPath, text, tokens });
  });

  // package.json scripts
  const pkgJsonPath = path.join(projectDir, 'package.json');
  const pkgContent = await readFileSafe(pkgJsonPath);
  if (pkgContent !== null) {
    try {
      const pkg = JSON.parse(pkgContent);
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts)) {
          const text = (scriptName + '\n' + scriptCmd).toLowerCase();
          const tokens = tokenize(text);
          rows.push({
            id: `script:package.json#${scriptName}`,
            kind: 'script',
            name: scriptName,
            path: 'package.json',
            text,
            tokens
          });
        }
      }
    } catch {
      // Ignore parsing errors in package.json
    }
  }

  // Sort by id
  rows.sort((a, b) => a.id.localeCompare(b.id));

  // Count by kind
  for (const row of rows) {
    byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  }

  // Validate: must have at least one row
  if (rows.length === 0) {
    throw new Error('harness index is empty — run from the project root (no commands, skills, helpers, hooks, modules or scripts found)');
  }

  return { rows, byKind, errors, project: projectDir };
}

/**
 * Match a power to candidates in an index by IDF-weighted cosine similarity.
 * The power name counts three times; idea and what count once each.
 * Returns at most k candidates: [{ id, kind, name, path, score }], sorted by score desc then name asc.
 */
export function matchPower(power, index, { k = 5 } = {}) {
  if (typeof power?.name !== 'string') {
    throw new Error('power must have a name (string)');
  }
  if (!Number.isInteger(k) || k <= 0) {
    throw new Error('k must be a positive integer');
  }

  // Tokenize the power: name ×3 + what + idea
  const allTokens = [
    ...tokenize(power.name),
    ...tokenize(power.name),
    ...tokenize(power.name),
    ...tokenize(power.what),
    ...tokenize(power.idea)
  ];

  if (allTokens.length === 0) {
    // Power shares no tokens with harness
    return [];
  }

  // Build IDF over the index rows' tokens
  const docTokens = index.rows.map(r => r.tokens);
  const idfMap = idf(docTokens);

  // Create a boost map: name tokens get 3×
  const boost = new Map();
  for (const token of tokenize(power.name)) {
    boost.set(token, 3);
  }

  // Vectorize the power
  const powerVec = vectorize(allTokens, idfMap, { boost });

  // Score each candidate
  const candidates = [];
  for (const row of index.rows) {
    const rowVec = vectorize(row.tokens, idfMap);
    const score = cosine(powerVec, rowVec);
    if (score > 0) {
      candidates.push({
        id: row.id,
        kind: row.kind,
        name: row.name,
        path: row.path,
        score: Number(score.toFixed(3))
      });
    }
  }

  // Sort by score desc, then by name asc
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  return candidates.slice(0, k);
}

/**
 * Build the harness-map: index the harness, compute candidates for each power, write map.json.
 * Returns { runId, indexed, byKind, powers, judgments_dropped, next }.
 */
export async function buildMap(projectDir, { run, now, force = false, cfg = DEFAULT_CONFIG }) {
  if (!RUN_ID.test(run)) {
    throw new Error(invalidRunId(run));
  }

  const runDirPath = runDirOf(projectDir, run, cfg);
  const powersPath = path.join(runDirPath, 'powers.json');
  const mapPath = path.join(runDirPath, 'map.json');

  // Ensure powers.json exists
  const powers = await readJson(powersPath);
  if (!powers || !Array.isArray(powers.powers)) {
    throw new Error('inventory first — powers.json is missing; run cli.js inventory --from');
  }

  // Check if map.json already has judgments (and !force)
  const existingMap = await readJson(mapPath);
  if (existingMap && existingMap.judgments && Object.keys(existingMap.judgments).length > 0 && !force) {
    throw new Error('map.json already has judgments — pass --force to rebuild (they will be dropped)');
  }

  // Build the index
  const index = await buildIndex(projectDir);
  const ts = now().toISOString();
  const source = await readJson(path.join(runDirPath, 'source.json'));

  // Write harness-index.json (without text/tokens)
  const harness = {
    project: projectDir,
    ts,
    byKind: index.byKind,
    rows: index.rows.map(r => ({ id: r.id, kind: r.kind, name: r.name, path: r.path }))
  };
  await writeJson(path.join(runDirPath, 'harness-index.json'), harness);

  // Build candidates for each power
  const candidates = {};
  for (const power of powers.powers) {
    candidates[power.name] = matchPower(power, index, { k: 5 });
  }

  // Count existing judgments to report how many are dropped
  let judgmentsCounted = 0;
  if (existingMap && existingMap.judgments) {
    judgmentsCounted = Object.keys(existingMap.judgments).length;
  }

  // Write map.json
  const map = {
    run,
    source_identity: source.identity,
    ts,
    candidates,
    judgments: {}
  };
  await writeJson(mapPath, map);

  // Re-render status
  const { writeError } = await renderStatusSafe(runDirPath);
  if (writeError) {
    // Warn but don't fail
  }

  return {
    runId: run,
    indexed: index.rows.length,
    byKind: index.byKind,
    powers: powers.powers.length,
    judgments_dropped: judgmentsCounted,
    next: 'map'
  };
}

/**
 * Generate a brief for the user to judge powers.
 * Returns plain text markdown with powers, ideas, candidates, and instructions.
 */
export async function mapBrief(projectDir, { run }, cfg = DEFAULT_CONFIG) {
  const runDirPath = runDirOf(projectDir, run, cfg);
  const mapPath = path.join(runDirPath, 'map.json');

  const map = await readJson(mapPath);
  if (!map || !map.candidates) {
    throw new Error('map.json is missing — run cli.js map first');
  }

  const lines = [];
  lines.push('# Harness Map — Judge Powers');
  lines.push('');
  lines.push('For each power, decide: is the matching tool available, partial, or missing?');
  lines.push('');

  // List each power with its candidates
  for (const [powerName, candidates] of Object.entries(map.candidates)) {
    lines.push(`## ${powerName}`);
    lines.push('');

    // Find the power's idea from the map (or reconstruct from powers.json)
    const powers = await readJson(path.join(runDirPath, 'powers.json'));
    const power = powers.powers.find(p => p.name === powerName);
    if (power?.idea) {
      lines.push(`${power.idea}`);
      lines.push('');
    }

    lines.push('**Only these 5 candidates:**');
    lines.push('');
    for (const candidate of candidates) {
      lines.push(`- \`${candidate.id}\` (${candidate.kind}, score ${candidate.score}) — ${candidate.path}`);
    }
    lines.push('');
  }

  // Instructions
  lines.push('## Status Definitions');
  lines.push('');
  lines.push('- **have**: The tool fully implements this power.');
  lines.push('- **partial**: The tool partially implements this power.');
  lines.push('- **missing**: No tool among these candidates implements this power.');
  lines.push('');

  lines.push('## Response Format');
  lines.push('');
  lines.push('JSON only — no prose. Return an object with each power name and its judgment:');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "power-name": {');
  lines.push('    "status": "have|partial|missing",');
  lines.push('    "tool": "<candidate id or null>",');
  lines.push('    "why": "<one line>"');
  lines.push('  }');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('Submit your judgment with: `cli.js map --from <file|->`');
  lines.push('');

  return lines.join('\n');
}

/**
 * Record judgments for powers from user input.
 * Accepts either { power: status } or { power: { status, tool, why } }.
 * String form allows any status (tool=null); object form requires tool for have/partial.
 * Returns { runId, judged, remaining, next }.
 */
export async function recordJudgments(projectDir, { run, input, now, force = false, cfg = DEFAULT_CONFIG }) {
  if (!RUN_ID.test(run)) {
    throw new Error(invalidRunId(run));
  }

  const runDirPath = runDirOf(projectDir, run, cfg);
  const mapPath = path.join(runDirPath, 'map.json');

  // Ensure map.json exists
  const map = await readJson(mapPath);
  if (!map || !map.candidates) {
    throw new Error('map.json is missing — run cli.js map first');
  }

  // Parse input
  let judgments;
  try {
    let data = typeof input === 'string' ? input : JSON.stringify(input);
    // Strip ``` fences if present
    data = data.replace(/^```[\w]*\n/, '').replace(/\n```$/, '');
    const parsed = JSON.parse(data);
    // Accept either { judgments: {...} } or a bare object
    judgments = parsed.judgments ?? parsed;
  } catch (err) {
    throw new Error(`JSON only — got: ${typeof input === 'string' ? input.slice(0, 50) : String(input).slice(0, 50)}`);
  }

  // Validate and normalize each judgment
  const normalized = {};
  const powers = await readJson(path.join(runDirPath, 'powers.json'));
  const powerNames = new Set(powers.powers.map(p => p.name));

  for (const [powerName, judgment] of Object.entries(judgments)) {
    // Check power exists
    if (!powerNames.has(powerName)) {
      throw new Error(`unknown power "${powerName}"`);
    }

    // Check if already judged (and not force)
    if (map.judgments?.[powerName] && !force) {
      throw new Error(`${powerName} already judged — pass --force to replace`);
    }

    let status, tool, why;
    let isStringForm = false;
    if (typeof judgment === 'string') {
      // String form: any status is allowed, tool defaults to null
      status = judgment;
      tool = null;
      why = null;
      isStringForm = true;
    } else if (typeof judgment === 'object' && judgment !== null) {
      // Object form: { status, tool?, why? }
      status = judgment.status;
      tool = judgment.tool;
      why = judgment.why ?? null;
    } else {
      throw new Error(`${powerName}: judgment must be a string or object`);
    }

    // Validate status
    if (!STATUSES.includes(status)) {
      throw new Error(`${powerName}: status must be one of have|partial|missing`);
    }

    // For object form, 'have' and 'partial' require a tool
    if (!isStringForm && (status === 'have' || status === 'partial') && !tool) {
      throw new Error(`${powerName}: status "${status}" requires a tool`);
    }

    // For 'missing', tool must be null
    if (status === 'missing') {
      tool = null;
    }

    // Validate tool is in the candidate list (if provided)
    if (tool) {
      const candidateIds = map.candidates[powerName].map(c => c.id);
      if (!candidateIds.includes(tool)) {
        throw new Error(`${powerName}: tool "${tool}" is not among the candidates`);
      }
    }

    normalized[powerName] = { status, tool, why, ts: now().toISOString() };
  }

  // Merge into map.judgments
  const ts = now().toISOString();
  for (const [powerName, judgment] of Object.entries(normalized)) {
    map.judgments[powerName] = judgment;
  }

  // Write map.json atomically
  await writeJson(mapPath, map);

  // Re-render status
  const { writeError } = await renderStatusSafe(runDirPath);
  if (writeError) {
    // Warn but don't fail
  }

  // Compute remaining powers
  const remaining = Array.from(powerNames).filter(n => !map.judgments[n]).sort();

  return {
    runId: run,
    judged: Object.keys(map.judgments).length,
    remaining,
    next: remaining.length === 0 ? 'verdict' : 'map'
  };
}
