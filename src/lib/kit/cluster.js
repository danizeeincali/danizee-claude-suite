/**
 * cluster — collapse duplicate findings so one broken shared part gives one issue, not twenty. Offline, no model call.
 *
 *   cluster [--file <findings.json>] [--answers <answers.json>]      (findings on stdin when --file is absent)
 *
 * Input: a list of findings, or { findings: [...] }. Each: { id, rule, severity, files?, locations?, title? }.
 *   id unique string · rule non-empty string · severity critical|high|medium|low|info · files: list of paths ·
 *   locations: list of { file, line? } or "path:line" strings (their files count as files too). At least one file in all.
 *   Paths are normalised (backslashes, "./", repeated slashes) before comparing.
 * PASS 1 (free, deterministic). Findings are bucketed by rule + the sorted, de-duplicated set of files. Each bucket is a
 *   cluster: the most severe member is the representative (ties: smallest id), and the cluster lists every member id, every
 *   file and every location. A cluster's id is its representative's id.
 *   Pass 1 could not settle a pair of clusters when they share a rule and their file sets overlap but are not equal (one
 *   may be a subset of the other). Those pairs are reported as `pending_pairs` { a, b, rule, shared_files, only_a, only_b, ... }
 *   with a < b, ids being pass-1 cluster ids. Clusters with different rules, or disjoint files, are never offered for merging.
 * PASS 2 (judgments supplied by the caller; this verb never asks a model). `--answers` holds a list (or { answers }) of
 *   { a, b, same: bool, p: 0..1, confidence: "high"|"medium"|"low" }; a and b may be in either order. A pair merges only
 *   when same is true AND p >= 0.5 AND confidence is "high": merging hides findings, so the bar is higher than raising one.
 *   Without answers, nothing merges and the pairs are listed for the calling workflow to judge.
 *   Answers for a pair that is not pending are ignored and listed in `ignored_answers`. Several answers for one pair must all
 *   clear the bar; if they disagree the pair stays apart and is listed in `conflicting_answers`.
 *   Transitive safety: approved merges are applied in sorted pair order, and a merge is skipped (listed in `blocked`) when it
 *   would put two clusters together that form a pending pair which was not approved (refused or unjudged). Chains therefore
 *   never merge across a pair nobody agreed on, and the result does not depend on the order of the answers.
 * Library: `await cluster(findings, { answers, decide })` — `decide(pair)` may be sync or async and returns a judgment (or
 *   null to leave the pair pending); it is called once, in sorted order, for each pending pair without an answer.
 * Output: { clusters, pending_pairs, judged_pairs, ignored_answers, conflicting_answers, blocked, stats }.
 * Exit 1 on invalid input. Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'cluster';
export const usage = 'cli.js cluster [--file <findings.json>] [--answers <answers.json>]   (groups duplicate findings by rule + file set; lists unsettled pairs; merges only on high-confidence answers; see the header of cluster.js)';
const bad = (m) => new KitExit(m, 1);

export const SEVERITY = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const CONFIDENCE = ['high', 'medium', 'low'];

export function normPath(p) {
  let s = String(p ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s.replace(/\/\.(?=\/)/g, '').replace(/\/+$/, '');
}

const uniqSorted = (a) => [...new Set(a)].sort();
const byStr = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

/** True when a judgment clears the bar to merge: same, p >= 0.5, confidence high. */
export function mergeBar(j) {
  return !!j && j.same === true && typeof j.p === 'number' && j.p >= 0.5 && j.confidence === 'high';
}

function checkJudgment(j, label) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw bad(`${label}: not an object`);
  if (typeof j.same !== 'boolean') throw bad(`${label}: "same" must be true or false`);
  if (typeof j.p !== 'number' || !(j.p >= 0 && j.p <= 1)) throw bad(`${label}: "p" must be a number from 0 to 1`);
  if (!CONFIDENCE.includes(j.confidence)) throw bad(`${label}: "confidence" must be high, medium or low`);
  return j;
}

function normaliseFinding(f, i) {
  const label = `finding #${i + 1}`;
  if (!f || typeof f !== 'object' || Array.isArray(f)) throw bad(`${label}: not an object`);
  if (typeof f.id !== 'string' || !f.id) throw bad(`${label}: "id" must be a non-empty string`);
  if (typeof f.rule !== 'string' || !f.rule.trim()) throw bad(`${label} (${f.id}): "rule" must be a non-empty string`);
  const sev = typeof f.severity === 'string' ? f.severity.toLowerCase() : '';
  if (!(sev in SEVERITY)) throw bad(`${label} (${f.id}): "severity" must be one of ${Object.keys(SEVERITY).join(', ')}`);
  const files = []; const locs = [];
  if (f.files !== undefined) {
    if (!Array.isArray(f.files)) throw bad(`${label} (${f.id}): "files" must be a list of paths`);
    for (const p of f.files) {
      const n = typeof p === 'string' ? normPath(p) : '';
      if (!n) throw bad(`${label} (${f.id}): every file must be a non-empty path string`);
      files.push(n);
    }
  }
  if (f.locations !== undefined) {
    if (!Array.isArray(f.locations)) throw bad(`${label} (${f.id}): "locations" must be a list`);
    for (const l of f.locations) {
      let file; let line = null;
      if (typeof l === 'string') {
        const m = /^(.*):(\d+)$/.exec(l);
        file = normPath(m ? m[1] : l); line = m ? Number(m[2]) : null;
      } else if (l && typeof l === 'object' && typeof l.file === 'string') {
        file = normPath(l.file);
        if (l.line !== undefined && l.line !== null) {
          if (!Number.isInteger(l.line) || l.line < 0) throw bad(`${label} (${f.id}): a location "line" must be a whole number >= 0`);
          line = l.line;
        }
      } else throw bad(`${label} (${f.id}): a location must be "path:line" or { file, line? }`);
      if (!file) throw bad(`${label} (${f.id}): a location has no file`);
      locs.push({ file, line });
    }
  }
  const all = uniqSorted([...files, ...locs.map(l => l.file)]);
  if (!all.length) throw bad(`${label} (${f.id}): needs at least one file (in "files" or "locations")`);
  for (const p of files) if (!locs.some(l => l.file === p)) locs.push({ file: p, line: null });
  return { id: f.id, rule: f.rule.trim(), severity: sev, title: typeof f.title === 'string' ? f.title : '', files: all, locations: locs };
}

const locKey = (l) => `${l.file}\0${l.line ?? ''}`;
function sortLocs(locs) {
  const m = new Map(locs.map(l => [locKey(l), l]));
  return [...m.values()].sort((x, y) => byStr(x.file, y.file) || (x.line ?? -1) - (y.line ?? -1));
}
const moreSevere = (x, y) => SEVERITY[x.severity] - SEVERITY[y.severity] || byStr(y.id, x.id); // >0 when x wins

function buildCluster(parts) {
  // parts: list of { rule, rep: {id,severity,title}, files, locations, members }
  const rep = parts.map(p => p.rep).sort((x, y) => -moreSevere(x, y))[0];
  return {
    id: rep.id, rule: parts[0].rule, representative: rep.id, severity: rep.severity, title: rep.title,
    files: uniqSorted(parts.flatMap(p => p.files)),
    locations: sortLocs(parts.flatMap(p => p.locations)),
    members: uniqSorted(parts.flatMap(p => p.members)),
    merged_from: uniqSorted(parts.map(p => p.id))
  };
}

/** Pass 1: validate, bucket, and find the pairs it cannot settle. Pure and deterministic. */
export function pass1(findings) {
  const list = Array.isArray(findings?.findings) ? findings.findings : findings;
  if (!Array.isArray(list)) throw bad('input must be a list of findings (or { findings: [...] })');
  const seen = new Set();
  const norm = list.map((f, i) => {
    const n = normaliseFinding(f, i);
    if (seen.has(n.id)) throw bad(`duplicate finding id "${n.id}"`);
    seen.add(n.id);
    return n;
  });
  const buckets = new Map();
  for (const n of norm) {
    const k = `${n.rule}\0${n.files.join('\0')}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(n);
  }
  const clusters = [...buckets.values()].map(ms => {
    const rep = [...ms].sort((x, y) => -moreSevere(x, y))[0];
    return buildCluster([{ id: rep.id, rule: rep.rule, rep, files: rep.files, locations: ms.flatMap(m => m.locations), members: ms.map(m => m.id) }]);
  }).sort((x, y) => byStr(x.id, y.id));
  const pending = [];
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i]; const b = clusters[j];
      if (a.rule !== b.rule) continue;
      const shared = a.files.filter(x => b.files.includes(x));
      if (!shared.length) continue; // disjoint: pass 1 settled it (different parts)
      pending.push({
        a: a.id, b: b.id, rule: a.rule, shared_files: shared,
        only_a: a.files.filter(x => !b.files.includes(x)), only_b: b.files.filter(x => !a.files.includes(x)),
        a_title: a.title, b_title: b.title, a_severity: a.severity, b_severity: b.severity
      });
    }
  }
  return { clusters, pending_pairs: pending };
}

const pairKey = (a, b) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

/** Parse the answers into a list of { a, b, same, p, confidence } (validated). */
export function normaliseAnswers(raw) {
  const list = Array.isArray(raw?.answers) ? raw.answers : raw;
  if (!Array.isArray(list)) throw bad('answers must be a list (or { answers: [...] })');
  return list.map((x, i) => {
    checkJudgment(x, `answer #${i + 1}`);
    if (typeof x.a !== 'string' || typeof x.b !== 'string' || !x.a || !x.b) throw bad(`answer #${i + 1}: "a" and "b" must be cluster ids`);
    return { a: x.a, b: x.b, same: x.same, p: x.p, confidence: x.confidence };
  });
}

/** Full run: pass 1, then judgments from `answers` and/or `decide(pair)`. Answers win over decide. */
export async function cluster(findings, { answers = [], decide } = {}) {
  const first = pass1(findings);
  const ans = normaliseAnswers(answers);
  if (decide !== undefined && typeof decide !== 'function') throw bad('decide must be a function');
  const pending = new Map(first.pending_pairs.map(p => [pairKey(p.a, p.b), p]));
  const byPair = new Map(); const ignored = [];
  for (const x of ans) {
    const k = pairKey(x.a, x.b);
    if (!pending.has(k)) { ignored.push({ a: x.a, b: x.b, reason: 'not a pending pair' }); continue; }
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(x);
  }
  const verdict = new Map(); // key -> 'approved' | 'refused'
  const conflicting = [];
  for (const [k, xs] of byPair) {
    const oks = xs.map(mergeBar);
    if (oks.every(Boolean)) verdict.set(k, 'approved');
    else { verdict.set(k, 'refused'); if (oks.some(Boolean)) conflicting.push({ a: pending.get(k).a, b: pending.get(k).b, answers: xs.length }); }
  }
  if (decide) {
    for (const p of first.pending_pairs) {
      const k = pairKey(p.a, p.b);
      if (verdict.has(k)) continue;
      const j = await decide({ ...p });
      if (j === null || j === undefined) continue;
      checkJudgment(j, `decide(${p.a}, ${p.b}) result`);
      verdict.set(k, mergeBar(j) ? 'approved' : 'refused');
    }
  }
  // Apply approved merges in sorted pair order; veto any merge that would join a pending pair nobody approved.
  const comp = new Map(first.clusters.map(c => [c.id, [c.id]])); // cluster id -> its component's member ids (shared array)
  const blocked = [];
  const approved = first.pending_pairs.filter(p => verdict.get(pairKey(p.a, p.b)) === 'approved');
  for (const p of approved) {
    const ca = comp.get(p.a); const cb = comp.get(p.b);
    if (ca === cb) continue;
    const veto = [];
    for (const x of ca) for (const y of cb) {
      const k = pairKey(x, y);
      if (pending.has(k) && verdict.get(k) !== 'approved') veto.push({ a: pending.get(k).a, b: pending.get(k).b, why: verdict.has(k) ? 'refused' : 'unjudged' });
    }
    if (veto.length) { blocked.push({ a: p.a, b: p.b, because: veto.sort((u, v) => byStr(pairKey(u.a, u.b), pairKey(v.a, v.b))) }); continue; }
    const merged = [...ca, ...cb];
    for (const id of merged) comp.set(id, merged);
  }
  const byId = new Map(first.clusters.map(c => [c.id, c]));
  const groups = new Set(comp.values());
  const clusters = [...groups].map(ids => {
    const parts = ids.map(id => byId.get(id));
    if (parts.length === 1) return parts[0];
    return buildCluster(parts.map(c => ({ id: c.id, rule: c.rule, rep: { id: c.representative, severity: c.severity, title: c.title }, files: c.files, locations: c.locations, members: c.members })));
  }).sort((x, y) => SEVERITY[y.severity] - SEVERITY[x.severity] || byStr(x.id, y.id));
  const outcome = (p) => {
    const v = verdict.get(pairKey(p.a, p.b));
    if (v === 'refused') return 'kept_apart';
    return comp.get(p.a) === comp.get(p.b) ? 'merged' : 'blocked';
  };
  const judged = first.pending_pairs.filter(p => verdict.has(pairKey(p.a, p.b))).map(p => ({ a: p.a, b: p.b, rule: p.rule, outcome: outcome(p) }));
  const open = first.pending_pairs.filter(p => !verdict.has(pairKey(p.a, p.b)));
  const findingsCount = first.clusters.reduce((n, c) => n + c.members.length, 0);
  return {
    clusters, pending_pairs: open, judged_pairs: judged,
    ignored_answers: ignored, conflicting_answers: conflicting, blocked,
    stats: { findings: findingsCount, pass1_clusters: first.clusters.length, clusters: clusters.length, pending_pairs: open.length, judged_pairs: judged.length, merged_clusters: first.clusters.length - clusters.length }
  };
}

async function readJsonFile(io, p, what) {
  let text;
  try { text = await fs.readFile(path.resolve(io.cwd, p), 'utf-8'); } catch { throw bad(`${what} file "${p}" cannot be read`); }
  try { return JSON.parse(text); } catch { throw bad(`${what} file "${p}" is not valid JSON`); }
}

export async function run(args, io) {
  let file = null; let answersFile = null;
  const rest = [...args];
  while (rest.length) {
    const a = rest.shift();
    if (a === '--help') return { usage };
    if (a !== '--file' && a !== '--answers') throw bad(`unknown argument "${a}" (see --help)`);
    if (!rest.length) throw bad(`${a} needs a value`);
    if (a === '--file') file = rest.shift(); else answersFile = rest.shift();
  }
  let input;
  if (file) input = await readJsonFile(io, file, 'findings');
  else {
    const text = io.stdinIsTTY ? '' : await io.stdin();
    if (!text.trim()) throw bad('no findings: pass --file <findings.json> or JSON on stdin');
    try { input = JSON.parse(text); } catch { throw bad('stdin is not valid JSON'); }
  }
  const answers = answersFile ? await readJsonFile(io, answersFile, 'answers') : [];
  return cluster(input, { answers });
}
