/**
 * bbs harness-map — index the harness (commands, skills, helpers, hooks, modules, scripts),
 * match powers to candidates by IDF-weighted cosine similarity, build and update the map.
 */

import fs from 'fs/promises';
import { constants as FS } from 'fs';
import path from 'path';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, readJson, writeJson, moveAsideStale, withMapLockDetailed } from './store.js';
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
  const str = String(text ?? '').normalize('NFC').toLowerCase();
  const tokens = str.split(/[^\p{L}\p{M}\p{N}]+/u).filter(t => t && t.length > 1 && !STOP_WORDS.has(t));
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
const PKG_MAX_BYTES = 1024 * 1024;
const STALE_ON_MAP_FORCE = ['verdicts.json', 'handoff.json'];

// The run lock lives in store.js (inventory --force takes it too; inventory cannot import this module).
export { LOCK_STALE_MS, LOCK_REFRESH_MS, withMapLockDetailed, withMapLock } from './store.js';

/** Re-render status.md after map.json is committed; never throws. Returns { warning } (null when fine). */
async function renderAfterCommit(runDirPath) {
  try {
    const { writeError } = await renderStatusSafe(runDirPath);
    if (writeError) return { warning: `map.json written but status.md could not be written: ${writeError.message}` };
    return { warning: null };
  } catch (err) {
    const m = /corrupt JSON in (.+?): /.exec(err.message);
    const file = err.path ? path.basename(err.path) : m ? path.basename(m[1]) : 'a status input';
    return { warning: `map.json written but ${file} could not be read: ${err.message}`, unread: true };
  }
}

/**
 * Read at most PREFIX_BYTES of a file (bounded, via a FileHandle). Opened with O_NOFOLLOW, so a file swapped for a
 * symlink after the directory was listed fails with ELOOP instead of being followed.
 */
export async function readPrefix(filePath) {
  const fh = await fs.open(filePath, FS.O_RDONLY | FS.O_NOFOLLOW);
  try {
    const buf = Buffer.alloc(PREFIX_BYTES);
    const { bytesRead } = await fh.read(buf, 0, PREFIX_BYTES, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Check that `relPath` stays inside `projectDir`: every component is lstat'ed from projectDir down.
 * A symlinked component → { ok: false, path: <relative path of that component> }; a missing component →
 * { ok: true, missing: true } (the path simply does not exist); otherwise { ok: true }. Other lstat errors throw.
 */
export async function insideProject(projectDir, relPath) {
  const parts = String(relPath).split(/[\\/]+/).filter(Boolean);
  let cur = projectDir;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '..' || parts[i] === '.') throw new Error(`insideProject: ${relPath} is not a plain relative path`);
    cur = path.join(cur, parts[i]);
    let st;
    try {
      st = await fs.lstat(cur);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return { ok: true, missing: true };
      throw err;
    }
    if (st.isSymbolicLink()) return { ok: false, path: parts.slice(0, i + 1).join('/') };
  }
  return { ok: true };
}

/**
 * Index the harness: commands, skills, helpers, hooks, modules, and scripts.
 * Scope: skills exactly .claude/skills/<dir>/SKILL.md; hooks exactly .claude/hooks/*.sh; plugins exactly src/plugins/*.js;
 * commands, helpers, src/lib and scripts recursive. SKIP_DIRS and symlinks are skipped (symlinks are reported).
 * Every index root and package.json is checked component by component from projectDir (the root and each parent);
 * a symlinked root or parent is never followed: it is reported once as { path, code: 'SYMLINK' } and skipped. Files are
 * opened with O_NOFOLLOW, so one swapped for a symlink after listing is reported as SYMLINK too.
 * Only the first 64 KiB of a file is read; at most maxPerKind (alias capPerKind) rows per kind: the lexicographically first
 * are kept, `capped[kind]` is the cap and `capped_totals[kind]` = { kept, total } says how many files were found.
 * Returns { rows, byKind, errors, capped, project } sorted by id; throws if empty.
 */
export async function buildIndex(projectDir, { maxLines = 80, maxPerKind = MAX_PER_KIND, capPerKind } = {}) {
  const cap = capPerKind ?? maxPerKind;
  const rows = [];
  const byKind = {};
  const errors = [];
  const capped = {};
  const cappedTotals = {};
  const rel = (p) => path.relative(projectDir, p).split(path.sep).join('/');
  const symlinkSeen = new Set();
  const reportSymlink = (p) => { if (!symlinkSeen.has(p)) { symlinkSeen.add(p); errors.push({ path: p, code: 'SYMLINK' }); } };
  // A root may be walked only when it and every parent up to projectDir is a real directory entry (no symlink).
  const rootUsable = async (absRoot) => {
    let chk;
    try {
      chk = await insideProject(projectDir, rel(absRoot));
    } catch (err) {
      errors.push({ path: rel(absRoot), code: err.code ?? 'EINSIDE' });
      return false;
    }
    if (!chk.ok) { reportSymlink(chk.path); return false; }
    return !chk.missing;
  };

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
      if (ent.isSymbolicLink()) { reportSymlink(rel(full)); continue; }
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git' || SKIP_DIRS.has(ent.name)) continue;
        if (recursive || subdirs) sub.push(full);
      } else if (ent.isFile() && accept(ent.name)) {
        found.push(full);
      }
    }
    return { found, sub };
  };

  // Collect every file path for one kind (paths only, nothing is read), sorted. The walk goes on past the cap so the
  // total is known; capList then keeps the lexicographically first `cap` and records kept/total.
  const collect = async (root, opts) => {
    const out = [];
    if (!(await rootUsable(root))) return out;
    const visit = async (dir) => {
      const listed = await listFiles(dir, opts);
      for (const f of listed.found) out.push(f);
      for (const d of listed.sub) await visit(d);
    };
    await visit(root);
    return out;
  };
  const capList = (kind, files) => {
    files.sort();
    if (files.length > cap) {
      capped[kind] = cap;
      cappedTotals[kind] = { kept: cap, total: files.length };
      files.length = cap;
    }
    return files;
  };

  const addRows = async (kind, files, nameOf) => {
    for (let i = 0; i < files.length; i += 64) await Promise.all(files.slice(i, i + 64).map(async (filePath) => {
      let content;
      try {
        content = await readPrefix(filePath);
      } catch (err) {
        if (err.code === 'ELOOP') reportSymlink(rel(filePath));
        else errors.push({ path: rel(filePath), code: err.code });
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

  await addRows('command', capList('command', await collect(P('.claude', 'commands'), { recursive: true, accept: n => n.endsWith('.md') })), f => path.basename(f, '.md'));

  // Skills: exactly .claude/skills/<dir>/SKILL.md
  {
    const skillsRoot = P('.claude', 'skills');
    const top = (await rootUsable(skillsRoot)) ? await listFiles(skillsRoot, { recursive: false, subdirs: true, accept: () => false }) : { sub: [] };
    const files = [];
    for (const d of top.sub ?? []) {
      const inner = await listFiles(d, { recursive: false, subdirs: false, accept: n => n === 'SKILL.md' });
      files.push(...(inner.found ?? []));
    }
    await addRows('skill', capList('skill', files), f => path.basename(path.dirname(f)));
  }

  await addRows('helper', capList('helper', await collect(P('.claude', 'helpers'), { recursive: true, accept: n => n.endsWith('.js') })), f => path.basename(f, '.js'));
  await addRows('hook', capList('hook', await collect(P('.claude', 'hooks'), { recursive: false, accept: n => n.endsWith('.sh') })), f => path.basename(f, '.sh'));

  // Modules: src/lib/** (recursive) and src/plugins/*.js (depth 1), capped together
  {
    const lib = await collect(P('src', 'lib'), { recursive: true, accept: n => n.endsWith('.js') });
    const plugins = await collect(P('src', 'plugins'), { recursive: false, accept: n => n.endsWith('.js') });
    await addRows('module', capList('module', [...lib, ...plugins]), f => path.basename(f, '.js'));
  }

  // Scripts: files under scripts/ and package.json scripts share one cap (ordered by id path).
  const scriptFiles = await collect(P('scripts'), { recursive: true, accept: any });
  const pkgScripts = [];
  if (await rootUsable(P('package.json'))) try {
    const fh = await fs.open(P('package.json'), FS.O_RDONLY | FS.O_NOFOLLOW);
    let pst, raw;
    try {
      pst = await fh.stat();
      if (pst.size <= PKG_MAX_BYTES) raw = await fh.readFile('utf-8');
    } finally {
      await fh.close();
    }
    if (pst.size > PKG_MAX_BYTES) {
      errors.push({ path: 'package.json', code: 'ETOOBIG' });
    } else {
      const pkgContent = raw.replace(/^\uFEFF/, '');
      try {
        const pkg = JSON.parse(pkgContent);
        if (pkg.scripts && typeof pkg.scripts === 'object') {
          for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts)) pkgScripts.push({ scriptName, scriptCmd: String(scriptCmd) });
        }
      } catch {
        errors.push({ path: 'package.json', code: 'EJSON' });
      }
    }
  } catch (err) {
    if (err.code === 'ELOOP') reportSymlink('package.json');
    else if (err.code !== 'ENOENT') errors.push({ path: 'package.json', code: err.code });
  }
  {
    const items = [
      ...scriptFiles.map(f => ({ key: rel(f), file: f })),
      ...pkgScripts.map(p => ({ key: `package.json#${p.scriptName}`, pkg: p }))
    ];
    items.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    if (items.length > cap) {
      capped.script = cap;
      cappedTotals.script = { kept: cap, total: items.length };
      items.length = cap;
    }
    await addRows('script', items.filter(i => i.file).map(i => i.file), f => path.basename(f));
    for (const { pkg } of items) {
      if (!pkg) continue;
      const text = (pkg.scriptName + '\n' + pkg.scriptCmd).toLowerCase();
      rows.push({ id: `script:package.json#${pkg.scriptName}`, kind: 'script', name: pkg.scriptName, path: 'package.json', text, tokens: tokenize(text) });
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

  return { rows, byKind, errors, capped, capped_totals: cappedTotals, project: projectDir };
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
export async function buildMap(projectDir, { run, now, force = false, cfg = DEFAULT_CONFIG, lockOpts }) {
  if (!RUN_ID.test(run)) {
    throw new Error(invalidRunId(run));
  }

  const runDirPath = runDirOf(projectDir, run, cfg);
  const powersPath = path.join(runDirPath, 'powers.json');
  const mapPath = path.join(runDirPath, 'map.json');

  // Ensure powers.json exists (checked before the lock so a missing run keeps its own message)
  const noPowers = () => new Error('inventory first — powers.json is missing; run cli.js inventory --from');
  const first = await readJson(powersPath);
  if (!first || !Array.isArray(first.powers)) throw noPowers();

  // The index does not read map.json: build it before the lock so the lock covers only read map.json -> write map.json.
  const index = await buildIndex(projectDir);

  const { result: built, warning: lockWarning } = await withMapLockDetailed(runDirPath, async () => {
  const powers = await readJson(powersPath);
  if (!powers || !Array.isArray(powers.powers)) throw noPowers();

  // Check if map.json already has judgments (and !force); a corrupt map.json can be rebuilt only with --force
  let existingMap = null;
  let corruptMap = false;
  try {
    existingMap = await readJson(mapPath);
  } catch (err) {
    if (!/^corrupt JSON in /.test(err.message)) throw err;
    if (!force) throw new Error(`${err.message} — pass --force to rebuild it`);
    corruptMap = true;
  }
  if (existingMap && existingMap.judgments && Object.keys(existingMap.judgments).length > 0 && !force) {
    throw new Error('map.json already has judgments — pass --force to rebuild (they will be dropped)');
  }

  const ts = now().toISOString();
  const source = await readJson(path.join(runDirPath, 'source.json'));

  // Build candidates for each power
  const candidates = {};
  for (const power of powers.powers) {
    candidates[power.name] = matchPower(power, index, { k: 5 });
  }

  const judgmentsCounted = existingMap?.judgments ? Object.keys(existingMap.judgments).length : 0;

  // Later steps were built on the judgments being dropped: move them aside BEFORE the new map lands; put them back on failure.
  const stale_moved = force ? await moveAsideStale(runDirPath, corruptMap ? [...STALE_ON_MAP_FORCE, 'map.json'] : STALE_ON_MAP_FORCE, () => new Date(ts)) : [];
  try {
    // harness-index.json (without text/tokens)
    await writeJson(path.join(runDirPath, 'harness-index.json'), {
      project: projectDir,
      ts,
      byKind: index.byKind,
      errors: index.errors,
      capped: index.capped,
      capped_totals: index.capped_totals,
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

  // map.json is committed: nothing below may fail the verb
  const { warning, unread } = await renderAfterCommit(runDirPath);

  return {
    runId: run,
    indexed: index.rows.length,
    byKind: index.byKind,
    powers: powers.powers.length,
    judgments_dropped: judgmentsCounted,
    index_errors: index.errors.length,
    stale_moved: [...stale_moved],
    next: unread ? null : 'map',
    ...(warning ? { warning } : {})
  };
  }, lockOpts);
  return mergeWarning(built, lockWarning);
}

/** Add a lock-release warning to a verb result, joining it with any warning already there. */
function mergeWarning(result, lockWarning) {
  if (!lockWarning) return result;
  return { ...result, warning: result.warning ? `${result.warning}; ${lockWarning}` : lockWarning };
}

const SAFE_GIT_LINES = [
  '## Reading the clone with git\n',
  'Every git read of the clone under `fetched/` (log, show, ls-files, blame, cat-file) goes through `node .claude/helpers/kit/cli.js safe-git --dir <clone top> -- <git args>`. Plain `git -C fetched/...` is never used: the clone is untrusted and its config, hooks and drivers must not run.',
  '',
  'It prints `{ stdout, stderr, code, exit }`. Read the exit: 0 git ran and `stdout` is the answer; 1 bad input (for example `--dir` is not the clone top): fix the call and retry once; 2 refused (the repository or the git call was refused): do not retry, name it in evidence; 3 git itself failed or timed out: say so. A non-zero exit is never "nothing found".',
  '',
  'If `.claude/helpers/kit/cli.js` is missing, read the files directly and never run git on the clone.',
  ''
];

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

  lines.push(...SAFE_GIT_LINES);

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
export async function recordJudgments(projectDir, { run, input, now, force = false, cfg = DEFAULT_CONFIG, label = 'input', lockOpts }) {
  if (!RUN_ID.test(run)) {
    throw new Error(invalidRunId(run));
  }

  const runDirPath = runDirOf(projectDir, run, cfg);
  const mapPath = path.join(runDirPath, 'map.json');

  // Ensure map.json exists (checked before the lock so a missing run keeps its own message)
  const noMap = () => new Error('map.json is missing — run cli.js map first');
  const first = await readJson(mapPath);
  if (!first || !first.candidates) throw noMap();

  const { result: recorded, warning: lockWarning } = await withMapLockDetailed(runDirPath, async () => {
  const map = await readJson(mapPath);
  if (!map || !map.candidates) throw noMap();

  const powers = await readJson(path.join(runDirPath, 'powers.json'));
  const powerNames = new Set(powers.powers.map(p => p.name));

  // Parse input (fence-tolerant, shared with inventory); accept { judgments: {...} } or a bare object.
  // Unwrap only when judgments is the sole key, a plain object, and no power is named "judgments".
  const parsed = parseJsonOnly(input, { label });
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isWrapper = isPlain(parsed) && Object.keys(parsed).length === 1 && Object.hasOwn(parsed, 'judgments')
    && isPlain(parsed.judgments) && !powerNames.has('judgments');
  const judgments = isWrapper ? parsed.judgments : parsed;
  if (judgments === null || typeof judgments !== 'object' || Array.isArray(judgments)) {
    throw new Error(`JSON only — ${label} must be an object of power → judgment`);
  }

  // Validate and normalize each judgment
  const normalized = {};
  const ts = now().toISOString();
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

  const { warning, unread } = await renderAfterCommit(runDirPath);

  const remaining = Array.from(powerNames).filter(n => !map.judgments[n]).sort();

  return {
    runId: run,
    judged: Object.keys(map.judgments).length,
    remaining,
    stale_moved: [...stale_moved],
    next: unread ? null : remaining.length === 0 ? 'verdict' : 'map',
    ...(warning ? { warning } : {})
  };
  }, lockOpts);
  return mergeWarning(recorded, lockWarning);
}
