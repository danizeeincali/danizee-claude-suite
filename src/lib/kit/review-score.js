/**
 * review-score — grade a code reviewer offline by scoring its SAVED output against cases with planted bugs.
 *
 *   review-score --specs <dir> --reviews <dir> --out <dir>      prints { totals, cases, ... }; also saved as <out>/scores.json
 *
 * What the code does:
 *   SPECS. One JSON file per case in <specs> (top level only, *.json, at most 200 files of 1 MiB each; more is refused,
 *   never silently cut): { case, clean?, bugs:[{id,file,lines:[a,b],categories,keywords}], accepted:[{file,lines,note}],
 *   tolerance? }. The first run copies them into <out>/specs with a manifest of SHA-256 hashes; later runs score ONLY that
 *   copy and refuse to run when a copied file no longer matches the manifest. Editing <specs> afterwards changes nothing.
 *   REVIEWS. One JSON file per case in <reviews> (same caps), matched to a spec by its `case` field:
 *   { case, completed, findings:[{id?,file,line,category,title,detail}] } (`rows` is accepted for `findings`). A bare array
 *   of marathon review rows is read as a finished review whose case is the file name without ".json". A case with no review
 *   file scores as an unfinished review that found nothing; a review whose case has no spec is invalid input.
 *   SCORING (scoreCase). Paths are normalised (backslashes, "./", repeated slashes, and any prefix through "repos/<case>/") before comparing. A finding is
 *     hit          file + line inside [a-tolerance, b+tolerance] + an allowed category + a keyword at the START of a word
 *                  in title or detail, all for one planted bug that was not found yet;
 *     duplicate    the same, for a bug already found (kept out of precision);
 *     accepted     not a hit, but inside an accepted side issue's lines (kept out of precision);
 *     near miss    same file and exactly two of the three agree (location, category, keyword);
 *     false positive  everything else. In a clean case every finding is a false positive.
 *   A case passes only when its review completed, every bug was found and there is no false positive; a clean case passes
 *   only when the review completed with no findings. Precision = hits / (hits + near misses + false positives), recall =
 *   hits / bugs, over SUMS across cases (never an average of ratios); a ratio with nothing to divide is null, not 1.
 * Only the given folders are read; nothing is run, fetched or sent. Built from the approved brief of /w-bbs run 2026-10-10-openqodex-2.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { guardedRead, guardedWrite } from './guarded-fs.js';

export const verb = 'review-score';
export const usage = 'cli.js review-score --specs <dir> --reviews <dir> --out <dir>   (scores saved reviews against planted-bug specs; see the header of review-score.js)';
export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 1024 * 1024;
const MANIFEST = 'specs.manifest.json';
const bad = (m) => new KitExit(`${m} (see --help)`, 1);

export function normPath(p) {
  let s = String(p ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s.replace(/\/\.(?=\/)/g, '').replace(/\/+$/, '');
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** True when `keyword` occurs in `text` starting at the beginning of a word ("leak" in "leaked" yes, in "unleak" no). */
export function keywordAtWordStart(text, keyword) {
  const k = String(keyword ?? '').trim();
  if (!k) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${esc(k)}`, 'iu').test(String(text ?? ''));
}

export function validateSpec(spec, label = 'spec') {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw bad(`${label}: not a JSON object`);
  if (typeof spec.case !== 'string' || !spec.case) throw bad(`${label}: "case" must be a non-empty string`);
  const range = (l, w) => {
    if (!Array.isArray(l) || l.length !== 2 || !l.every(Number.isInteger) || l[0] > l[1]) throw bad(`${label}: ${w} needs "lines": [from, to]`);
  };
  const list = (v, w) => {
    if (!Array.isArray(v) || !v.length || !v.every(x => typeof x === 'string' && x.trim())) throw bad(`${label}: ${w} must be a non-empty list of strings`);
  };
  if (!Array.isArray(spec.bugs)) throw bad(`${label}: "bugs" must be a list`);
  if (spec.clean && spec.bugs.length) throw bad(`${label}: a clean case has no bugs`);
  if (!spec.clean && !spec.bugs.length) throw bad(`${label}: no bugs planted; mark it "clean": true or add bugs`);
  const ids = new Set();
  for (const b of spec.bugs) {
    if (!b || typeof b.id !== 'string' || !b.id || ids.has(b.id)) throw bad(`${label}: every bug needs a unique string "id"`);
    ids.add(b.id);
    if (typeof b.file !== 'string' || !b.file) throw bad(`${label}: bug ${b.id} needs "file"`);
    range(b.lines, `bug ${b.id}`);
    list(b.categories, `bug ${b.id} categories`);
    list(b.keywords, `bug ${b.id} keywords`);
  }
  for (const a of spec.accepted ?? []) {
    if (!a || typeof a.file !== 'string') throw bad(`${label}: an accepted entry needs "file"`);
    range(a.lines, 'an accepted entry');
  }
  if (spec.tolerance !== undefined && !(Number.isInteger(spec.tolerance) && spec.tolerance >= 0)) throw bad(`${label}: "tolerance" must be a whole number >= 0`);
  return spec;
}

/** Read a review into { case, completed, findings }. */
export function normaliseReview(raw, fallbackCase = null, label = 'review') {
  let obj = raw;
  if (Array.isArray(raw)) obj = { case: fallbackCase, completed: true, findings: raw };
  if (!obj || typeof obj !== 'object') throw bad(`${label}: not a JSON object or array`);
  const findings = obj.findings ?? obj.rows;
  if (typeof obj.case !== 'string' || !obj.case) throw bad(`${label}: "case" must be a non-empty string`);
  if (typeof obj.completed !== 'boolean') throw bad(`${label}: "completed" must be true or false`);
  if (!Array.isArray(findings) || !findings.every(f => f && typeof f === 'object' && !Array.isArray(f))) throw bad(`${label}: "findings" must be a list of objects`);
  return { case: obj.case, completed: obj.completed, findings };
}

/** A path given from the repo root (".../repos/<case>/src/a.js") is cut back to the case's own root ("src/a.js"). */
export function caseRelPath(p, caseName) {
  const s = normPath(p);
  const mark = `repos/${normPath(caseName)}/`;
  if (s.startsWith(mark)) return s.slice(mark.length);
  const at = s.lastIndexOf(`/${mark}`);
  return at < 0 ? s : s.slice(at + 1 + mark.length);
}

/** Score one review against one spec. Pure. */
export function scoreCase(spec, review) {
  validateSpec(spec);
  const rev = review ? normaliseReview(review) : { case: spec.case, completed: false, findings: [] };
  if (review && rev.case !== spec.case) throw bad(`review is for case "${rev.case}", spec is "${spec.case}"`);
  const tol = spec.tolerance ?? 0;
  const found = new Map();
  const out = { case: spec.case, clean: !!spec.clean, completed: rev.completed, hits: [], near_misses: [], duplicates: [], false_positives: [], accepted: [], missed: [] };
  const inRange = (line, [a, b]) => Number.isInteger(line) && line >= a - tol && line <= b + tol;
  for (const f of rev.findings) {
    const file = caseRelPath(f.file, spec.case);
    const line = typeof f.line === 'string' && /^\s*\d+(\.0*)?\s*$/.test(f.line) ? Number(f.line) : f.line;
    const text = `${f.title ?? ''} ${f.detail ?? ''}`;
    const cat = String(f.category ?? '').toLowerCase();
    const ref = { id: f.id ?? null, file, line: Number.isInteger(line) ? line : null, category: cat, title: String(f.title ?? '') };
    if (spec.clean) { out.false_positives.push(ref); continue; }
    let hit = null; let near = false;
    for (const b of spec.bugs) {
      if (normPath(b.file) !== file) continue;
      const ok = [inRange(line, b.lines), b.categories.some(c => c.toLowerCase() === cat), b.keywords.some(k => keywordAtWordStart(text, k))];
      const n = ok.filter(Boolean).length;
      if (n === 3 && (!hit || !found.has(b.id) && found.has(hit.id))) hit = b;
      else if (n === 2) near = true;
    }
    if (hit) {
      if (found.has(hit.id)) out.duplicates.push({ ...ref, bug: hit.id });
      else { found.set(hit.id, true); out.hits.push({ ...ref, bug: hit.id }); }
    } else if ((spec.accepted ?? []).some(a => normPath(a.file) === file && inRange(line, a.lines))) out.accepted.push(ref);
    else if (near) out.near_misses.push(ref);
    else out.false_positives.push(ref);
  }
  out.missed = spec.bugs.filter(b => !found.has(b.id)).map(b => b.id);
  out.passed = rev.completed && !out.missed.length && !out.false_positives.length;
  out.bugs = spec.bugs.length;
  return out;
}

const ratio = (n, d) => (d > 0 ? n / d : null);
/** Totals over scored cases: summed hits over summed checks. Pure. */
export function scoreRun(cases) {
  const s = (k) => cases.reduce((n, c) => n + c[k].length, 0);
  const hits = s('hits'); const checks = hits + s('near_misses') + s('false_positives');
  const bugs = cases.reduce((n, c) => n + c.bugs, 0);
  return {
    cases: cases.length, passed: cases.filter(c => c.passed).length, failed: cases.filter(c => !c.passed).length,
    incomplete: cases.filter(c => !c.completed).length,
    bugs, hits, near_misses: s('near_misses'), duplicates: s('duplicates'), false_positives: s('false_positives'),
    accepted: s('accepted'), missed: s('missed'),
    precision: ratio(hits, checks), recall: ratio(hits, bugs)
  };
}

async function listJson(dir, what) {
  let d;
  try { d = await fs.opendir(dir); } catch { throw bad(`${what} folder "${dir}" cannot be read`); }
  const names = [];
  try {
    for await (const e of d) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.json') || e.name === MANIFEST) continue;
      if (names.length >= MAX_FILES) throw bad(`${what} folder has more than ${MAX_FILES} .json files; split it`);
      names.push(e.name);
    }
  } finally { await d.close().catch(() => {}); }
  return names.sort();
}

async function readJson(root, name, what) {
  let text;
  try { text = await guardedRead(path.join(root, name), { root, maxBytes: MAX_FILE_BYTES }); } catch (e) { throw bad(`${what} ${name}: ${e.message}`); }
  try { return { text, json: JSON.parse(text) }; } catch { throw bad(`${what} ${name} is not valid JSON`); }
}

/** Copy the specs into <outDir>/specs once (with a manifest); later calls reuse and verify that copy. Returns { dir, reused, specs }. */
export async function snapshotSpecs(specDir, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const snap = path.join(outDir, 'specs');
  const manifestPath = path.join(outDir, MANIFEST);
  let manifest = null;
  try { manifest = JSON.parse(await guardedRead(manifestPath, { root: outDir, maxBytes: MAX_FILE_BYTES })); } catch (e) { if (!e.missing) throw bad(`spec snapshot manifest unreadable: ${e.message}`); }
  if (manifest) {
    const specs = [];
    for (const [name, sha] of Object.entries(manifest.files ?? {})) {
      const { text, json } = await readJson(snap, name, 'snapshot spec');
      if (crypto.createHash('sha256').update(text).digest('hex') !== sha) throw bad(`snapshot spec ${name} changed after it was copied; use a new --out folder`);
      specs.push(validateSpec(json, name));
    }
    if (!specs.length) throw bad('spec snapshot is empty; use a new --out folder');
    return { dir: snap, reused: true, specs };
  }
  const names = await listJson(specDir, 'specs');
  if (!names.length) throw bad(`no .json specs in "${specDir}"`);
  const specs = []; const files = {}; const cases = new Set();
  for (const name of names) {
    const { text, json } = await readJson(specDir, name, 'spec');
    validateSpec(json, name);
    if (cases.has(json.case)) throw bad(`two specs use the case "${json.case}"`);
    cases.add(json.case);
    await guardedWrite(path.join(snap, name), text, { root: outDir });
    files[name] = crypto.createHash('sha256').update(text).digest('hex');
    specs.push(json);
  }
  await guardedWrite(manifestPath, JSON.stringify({ files }, null, 2) + '\n', { root: outDir }); // last: a half-copied snapshot has no manifest
  return { dir: snap, reused: false, specs };
}

export async function scoreFolders({ specs: specDir, reviews: reviewDir, out: outDir }) {
  const snap = await snapshotSpecs(specDir, outDir);
  const bySpec = new Map(snap.specs.map(s => [s.case, s]));
  const reviews = new Map();
  for (const name of await listJson(reviewDir, 'reviews')) {
    const { json } = await readJson(reviewDir, name, 'review');
    const r = normaliseReview(json, name.slice(0, -5), name);
    if (!bySpec.has(r.case)) throw bad(`review ${name} is for case "${r.case}", which has no spec`);
    if (reviews.has(r.case)) throw bad(`two reviews are for the case "${r.case}"`);
    reviews.set(r.case, r);
  }
  const cases = snap.specs.map(s => scoreCase(s, reviews.get(s.case) ?? null));
  const result = { totals: scoreRun(cases), cases, specs_snapshot: snap.dir, snapshot_reused: snap.reused, missing_reviews: cases.filter(c => !reviews.has(c.case)).map(c => c.case) };
  await guardedWrite(path.join(outDir, 'scores.json'), JSON.stringify(result, null, 2) + '\n', { root: outDir });
  return result;
}

export async function run(args, io) {
  const opts = {};
  const rest = [...args];
  while (rest.length) {
    const a = rest.shift();
    if (a === '--help') return { usage };
    if (!['--specs', '--reviews', '--out'].includes(a)) throw bad(`unknown argument "${a}"`);
    if (!rest.length) throw bad(`${a} needs a value`);
    opts[a.slice(2)] = path.resolve(io.cwd, rest.shift());
  }
  for (const k of ['specs', 'reviews', 'out']) if (!opts[k]) throw bad(`--${k} is required`);
  return scoreFolders(opts);
}
