/**
 * bbs harness-map — index the harness (commands, skills, helpers, hooks, modules, scripts),
 * match powers to candidates by IDF-weighted cosine similarity, build and update the map.
 */

import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, readJson, writeJson, moveAsideStale } from './store.js';
import { RUN_ID, invalidRunId } from './intake.js';
import { SKIP_DIRS, parseJsonOnly } from './inventory.js';
import { renderStatusSafe } from './status.js';

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

export const PREFIX_BYTES = 64 * 1024;
export const MAX_PER_KIND = 2000;
const STALE_ON_MAP_FORCE = ['verdicts.json', 'handoff.json'];

/** Read at most PREFIX_BYTES of a file (bounded, via a FileHandle). */
async function readPrefix(filePath) {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(PREFIX_BYTES);
    const { bytesRead } = await fh.read(buf, 0, PREFIX_BYTES, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Index the harness: commands, skills, helpers, hooks, modules, and scripts.
 * Scope: skills exactly .claude/skills/<dir>/SKILL.md; hooks exactly .claude/hooks/*.sh; plugins exactly src/plugins/*.js;
 * commands, helpers, src/lib and scripts recursive. SKIP_DIRS and symlinks are skipped (symlinks are reported).
 * Only the first 64 KiB of a file is read; at most maxPerKind rows per kind (the cap hit is recorded in `capped`).
 * Returns { rows, byKind, errors, capped, project } sorted by id; throws if empty.
 */
export async function buildIndex(projectDir, { maxLines = 80, maxPerKind = MAX_PER_KIND } = {}) {
  const rows = [];
  const byKind = {};
  const errors = [];
  const capped = {};
  const rel = (p) => path.relative(projectDir, p).split(path.sep).join('/');

  // List a directory: files matching `accept(name)` (and, when `recursive`, files in subdirectories).
  // `dirFilter(name)` limits which subdirectories are entered. Entries are sorted so the cap is deterministic.
  const listFiles = async (dir, { recursive, accept, subdirs }) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return { found: [], sub: [] };
      errors.push({ path: rel(dir), code: err.code });
      return { found: [], sub: [] };
    }
    entries.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    const found = [];
    const sub = [];
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) { errors.push({ path: rel(full), code: 'SYMLINK' }); continue; }
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git' || SKIP_DIRS.has(ent.name)) continue;
        if (recursive || subdirs) sub.push(full);
      } else if (ent.isFile() && accept(ent.name)) {
        found.push(full);
      }
    }
    return { found, sub };
  };

  // Collect file paths for one kind, depth-first in sorted order, stopping once the cap is reached.
  const collect = async (kind, root, opts) => {
    const out = [];
    const visit = async (dir) => {
      const listed = await listFiles(dir, opts);
      for (const f of listed.found) out.push(f);
      if (out.length > maxPerKind) return;
      for (const d of listed.sub) {
        if (out.length > maxPerKind) return;
        await visit(d);
      }
    };
    await visit(root);
    out.sort();
    if (out.length > maxPerKind) { capped[kind] = maxPerKind; out.length = maxPerKind; }
    return out;
  };

  const addRows = async (kind, files, nameOf) => {
    for (let i = 0; i < files.length; i += 64) await Promise.all(files.slice(i, i + 64).map(async (filePath) => {
      let content;
      try {
        content = await readPrefix(filePath);
      } catch (err) {
        errors.push({ path: rel(filePath), code: err.code });
        return;
      }
      const name = nameOf(filePath);
      const relPath = rel(filePath);
      const lines = content.split('\n').slice(0, maxLines);
      const text = (name + '\n' + lines.join('\n')).toLowerCase();
      rows.push({ id: `${kind}:${relPath}`, kind, name, path: relPath, text, tokens: tokenize(text) });
    }));
  };

  const P = (...parts) => path.join(projectDir, ...parts);
  const any = () => true;

  await addRows('command', await collect('command', P('.claude', 'commands'), { recursive: true, accept: n => n.endsWith('.md') }), f => path.basename(f, '.md'));

  // Skills: exactly .claude/skills/<dir>/SKILL.md
  {
    const skillsRoot = P('.claude', 'skills');
    const top = await listFiles(skillsRoot, { recursive: false, subdirs: true, accept: () => false });
    const files = [];
    for (const d of top.sub ?? []) {
      const inner = await listFiles(d, { recursive: false, subdirs: false, accept: n => n === 'SKILL.md' });
      files.push(...(inner.found ?? []));
    }
    files.sort();
    if (files.length > maxPerKind) { capped.skill = maxPerKind; files.length = maxPerKind; }
    await addRows('skill', files, f => path.basename(path.dirname(f)));
  }

  await addRows('helper', await collect('helper', P('.claude', 'helpers'), { recursive: true, accept: n => n.endsWith('.js') }), f => path.basename(f, '.js'));
  await addRows('hook', await collect('hook', P('.claude', 'hooks'), { recursive: false, accept: n => n.endsWith('.sh') }), f => path.basename(f, '.sh'));

  // Modules: src/lib/** (recursive) and src/plugins/*.js (depth 1), capped together
  {
    const lib = await collect('module', P('src', 'lib'), { recursive: true, accept: n => n.endsWith('.js') });
    const plugins = await collect('module', P('src', 'plugins'), { recursive: false, accept: n => n.endsWith('.js') });
    const files = [...lib, ...plugins].sort();
    if (files.length > maxPerKind) { capped.module = maxPerKind; files.length = maxPerKind; }
    await addRows('module', files, f => path.basename(f, '.js'));
  }

  await addRows('script', await collect('script', P('scripts'), { recursive: true, accept: any }), f => path.basename(f));

  // package.json scripts
  let pkgContent = null;
  try {
    pkgContent = await fs.readFile(P('package.json'), 'utf-8');
  } catch (err) {
    if (err.code !== 'ENOENT') errors.push({ path: 'package.json', code: err.code });
  }
  if (pkgContent !== null) {
    try {
      const pkg = JSON.parse(pkgContent);
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts)) {
          const text = (scriptName + '\n' + scriptCmd).toLowerCase();
          rows.push({ id: `script:package.json#${scriptName}`, kind: 'script', name: scriptName, path: 'package.json', text, tokens: tokenize(text) });
        }
      }
    } catch {
      errors.push({ path: 'package.json', code: 'EJSON' });
    }
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));
  errors.sort((a, b) => a.path.localeCompare(b.path));

  for (const row of rows) {
    byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  }

  if (rows.length === 0) {
    throw new Error('harness index is empty — run from the project root (no commands, skills, helpers, hooks, modules or scripts found)');
  }

  return { rows, byKind, errors, capped, project: projectDir };
}

/**
 * Match a power to candidates in an index by IDF-weighted cosine similarity.
 * The power name counts 3× (one copy, boost 3); idea and what count once each.
 * Returns at most k candidates: [{ id, kind, name, path, score }], sorted by score desc then name asc.
 */
export function matchPower(power, index, { k = 5 } = {}) {
  if (typeof power?.name !== 'string') {
    throw new Error('power must have a name (string)');
  }
  if (!Number.isInteger(k) || k <= 0) {
    throw new Error('k must be a positive integer');
  }

  // One copy of the name tokens, boosted 3×; what and idea once each. A name token weighs exactly 3× a body token.
  const nameTokens = tokenize(power.name);
  const bodyTokens = [...tokenize(power.what), ...tokenize(power.idea)];

  if (nameTokens.length + bodyTokens.length === 0) {
    return [];
  }

  // Build IDF over the index rows' tokens
  const idfMap = idf(index.rows.map(r => r.tokens));

  const nameBoost = new Map(nameTokens.map(t => [t, 3]));
  const powerVec = vectorize(bodyTokens, idfMap);
  for (const [token, val] of vectorize(nameTokens, idfMap, { boost: nameBoost })) {
    powerVec.set(token, (powerVec.get(token) ?? 0) + val);
  }

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

  // Build candidates for each power
  const candidates = {};
  for (const power of powers.powers) {
    candidates[power.name] = matchPower(power, index, { k: 5 });
  }

  const judgmentsCounted = existingMap?.judgments ? Object.keys(existingMap.judgments).length : 0;

  // Later steps were built on the judgments being dropped: move them aside BEFORE the new map lands; put them back on failure.
  const stale_moved = force ? await moveAsideStale(runDirPath, STALE_ON_MAP_FORCE, () => new Date(ts)) : [];
  try {
    // harness-index.json (without text/tokens)
    await writeJson(path.join(runDirPath, 'harness-index.json'), {
      project: projectDir,
      ts,
      byKind: index.byKind,
      errors: index.errors,
      capped: index.capped,
      rows: index.rows.map(r => ({ id: r.id, kind: r.kind, name: r.name, path: r.path }))
    });
    // map.json last: it is what marks the step as done
    await writeJson(mapPath, { run, source_identity: source.identity, ts, candidates, judgments: {} });
  } catch (err) {
    if (stale_moved.length) {
      const { restored, notRestored } = await stale_moved.restore();
      let msg = `${err.message}; stale_moved so far: [${stale_moved.join(', ')}]; restored: [${restored.join(', ')}]`;
      if (notRestored.length) msg += `; NOT restored (still named *.stale-*): [${notRestored.join(', ')}]`;
      throw new Error(msg);
    }
    throw err;
  }

  const { writeError } = await renderStatusSafe(runDirPath);

  return {
    runId: run,
    indexed: index.rows.length,
    byKind: index.byKind,
    powers: powers.powers.length,
    judgments_dropped: judgmentsCounted,
    index_errors: index.errors.length,
    stale_moved: [...stale_moved],
    next: 'map',
    ...(writeError ? { warning: `map.json written but status.md could not be written: ${writeError.message}` } : {})
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

    if (candidates.length === 0) {
      lines.push('**There are no candidates — answer missing (tool null).**');
    } else {
      lines.push(`**Only these ${candidates.length} candidates:**`);
    }
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
export async function recordJudgments(projectDir, { run, input, now, force = false, cfg = DEFAULT_CONFIG, label = 'input' }) {
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

  // Parse input (fence-tolerant, shared with inventory); accept { judgments: {...} } or a bare object
  const parsed = parseJsonOnly(input, { label });
  const judgments = parsed?.judgments ?? parsed;
  if (judgments === null || typeof judgments !== 'object' || Array.isArray(judgments)) {
    throw new Error(`JSON only — ${label} must be an object of power → judgment`);
  }

  // Validate and normalize each judgment
  const normalized = {};
  const ts = now().toISOString();
  const powers = await readJson(path.join(runDirPath, 'powers.json'));
  const powerNames = new Set(powers.powers.map(p => p.name));

  for (const [powerName, judgment] of Object.entries(judgments)) {
    if (!powerNames.has(powerName)) {
      throw new Error(`unknown power "${powerName}"`);
    }
    if (map.judgments?.[powerName] && !force) {
      throw new Error(`${powerName} already judged — pass --force to replace`);
    }

    let status, tool, why;
    let isStringForm = false;
    if (typeof judgment === 'string') {
      status = judgment;
      tool = null;
      why = null;
      isStringForm = true;
    } else if (typeof judgment === 'object' && judgment !== null) {
      status = judgment.status;
      tool = judgment.tool;
      why = judgment.why ?? null;
    } else {
      throw new Error(`${powerName}: judgment must be a string or object`);
    }

    if (!STATUSES.includes(status)) {
      throw new Error(`${powerName}: status must be one of have|partial|missing`);
    }

    // Only 'missing' may be a bare string; have/partial must name the candidate that has it
    if (isStringForm && status !== 'missing') {
      throw new Error(`${powerName}: status "${status}" needs {status, tool, why} naming one of the candidates`);
    }
    if (!isStringForm && (status === 'have' || status === 'partial') && !tool) {
      throw new Error(`${powerName}: status "${status}" requires a tool`);
    }

    if (status === 'missing') {
      tool = null;
    }

    if (tool) {
      const candidateIds = map.candidates[powerName].map(c => c.id);
      if (!candidateIds.includes(tool)) {
        throw new Error(`${powerName}: tool "${tool}" is not among the candidates`);
      }
    }

    normalized[powerName] = { status, tool, why, ts };
  }

  Object.assign(map.judgments, normalized);

  // Under --force, decisions and handoff built on the replaced judgments are stale: move them aside first.
  const stale_moved = force ? await moveAsideStale(runDirPath, STALE_ON_MAP_FORCE, () => new Date(ts)) : [];
  try {
    await writeJson(mapPath, map);
  } catch (err) {
    if (stale_moved.length) {
      const { restored, notRestored } = await stale_moved.restore();
      let msg = `${err.message}; stale_moved so far: [${stale_moved.join(', ')}]; restored: [${restored.join(', ')}]`;
      if (notRestored.length) msg += `; NOT restored (still named *.stale-*): [${notRestored.join(', ')}]`;
      throw new Error(msg);
    }
    throw err;
  }

  const { writeError } = await renderStatusSafe(runDirPath);

  const remaining = Array.from(powerNames).filter(n => !map.judgments[n]).sort();

  return {
    runId: run,
    judged: Object.keys(map.judgments).length,
    remaining,
    stale_moved: [...stale_moved],
    next: remaining.length === 0 ? 'verdict' : 'map',
    ...(writeError ? { warning: `map.json written but status.md could not be written: ${writeError.message}` } : {})
  };
}
