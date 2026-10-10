/**
 * bbs surfaces — the places in the owner's project where a user meets a feature, found in the code, never assumed.
 *
 * A power is integrated when a user can reach it through one of these. The kinds:
 *   ui        a page, screen or route a person opens (Next app/pages, SvelteKit routes, <Route path>, views)
 *   api       an HTTP endpoint (Next route handlers, pages/api, express/fastify/koa routers, FastAPI/Flask, Django urls)
 *   job       work that runs on a schedule or a queue (CI workflows, cron, workers)
 *   model     a model or prompt step (LLM SDK calls, prompts/, pipelines/, fit/predict, notebooks)
 *   cli       a command a person types (package.json bin, pyproject scripts, commander/argparse subcommands)
 *   feature   a feature flag or switch (flag files, isEnabled/useFlag calls)
 *   lib       the package's public entry (package.json main/exports)
 *   workflow  an installed Claude Code command (.claude/commands), with its step headings
 *
 * surfaces.json: { run, ts, scanned, skipped, kinds: { kind: n }, surfaces: [surface], owner: [surface] }
 * surface: { id: "<kind>:<file>", kind, file, anchors: [string], label, evidence, activity }
 * `anchors` are what a target's `at` may name: a route path, an endpoint, a command, a flag, a heading. `activity` is
 * the number of commits that touched the file in the window (a count only), so the busiest surfaces are listed first.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, readJson, writeJson } from './store.js';
import { installedWorkflows } from './usage.js';
import { stepHeadings } from './steps.js';

export const KINDS = ['ui', 'api', 'job', 'model', 'cli', 'feature', 'lib', 'workflow'];
export const MAX_FILES = 20000;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_ANCHORS = 40;
export const ACTIVITY_DAYS = 90;

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|out|coverage|vendor|\.next|\.nuxt|\.svelte-kit|\.venv|venv|__pycache__|\.turbo|\.cache|target|fetched)(\/|$)/;
const SKIP_RUN_DIRS = /^\.claude\/(bbs|marathon)\//;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec|e2e|fixtures?)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/;
const CODE = /\.(m?[jt]sx?|cjs|cts|mts|py|rb|go|vue|svelte)$/;

const posix = (p) => p.split(path.sep).join('/');
const uniq = (xs) => [...new Set(xs)];
const all = (re, text, group = 1) => { const out = []; for (const m of text.matchAll(re)) if (m[group]) out.push(m[group]); return out; };

/** The route a file-system router serves for `file` (Next app/pages, SvelteKit); null when it is not one. */
export function fileRoute(file) {
  let m = /(?:^|\/)app\/(.*?)\/?(?:page|route)\.[cm]?[jt]sx?$/.exec(file);
  if (!m) m = /(?:^|\/)src\/routes\/(.*?)\/?\+(?:page|server)\.(?:svelte|[jt]s)$/.exec(file);
  if (m) return '/' + m[1].split('/').filter(s => s && !/^\(.*\)$/.test(s) && !s.startsWith('@')).join('/');
  m = /(?:^|\/)pages\/(.*)\.[cm]?[jt]sx?$/.exec(file);
  if (m && !/(^|\/)_(app|document|error)$/.test(m[1])) return '/' + m[1].replace(/(^|\/)index$/, '');
  return null;
}

/**
 * The surfaces one file offers: [{ kind, anchors, evidence }]. Pure: the path and the text decide. Tests and run
 * folders are never surfaces.
 */
export function detect(file, text) {
  const out = [];
  const add = (kind, anchors, evidence) => out.push({ kind, anchors: uniq(anchors).slice(0, MAX_ANCHORS), evidence });
  if (TEST_FILE.test(file)) return out;
  const route = fileRoute(file);
  if (route !== null) {
    const api = /(?:^|\/)app\/.*\/?route\.[cm]?[jt]s$|(?:^|\/)pages\/api\/|\+server\.[jt]s$/.test(file);
    add(api ? 'api' : 'ui', [route], api ? 'file-system route handler' : 'file-system page');
  }
  if (/\.(vue|svelte)$/.test(file) && /(^|\/)(views|pages|screens)\//.test(file)) add('ui', [path.posix.basename(file).replace(/\.\w+$/, '')], 'view component');
  if (/(^|\/)(screens|views)\/[^/]+\.[jt]sx$/.test(file)) add('ui', [path.posix.basename(file).replace(/\.\w+$/, '')], 'screen component');
  if (CODE.test(file)) {
    const routes = all(/<Route\b[^>]*\bpath=\{?["'`]([^"'`]+)/g, text).concat(all(/\bpath:\s*["'`](\/[^"'`]*)["'`]/g, text).filter(() => /createBrowserRouter|createRouter|routes\s*[:=]/.test(text)));
    if (routes.length) add('ui', routes, 'client router');
    const http = all(/\b(?:app|router|server|api|fastify|r)\.(?:get|post|put|patch|delete|all|route)\(\s*["'`](\/[^"'`]*)["'`]/g, text)
      .concat(all(/@(?:app|router|bp|blueprint|api)\.(?:get|post|put|patch|delete|route|api_route)\(\s*["'](\/[^"']*)["']/g, text));
    if (http.length) add('api', http, 'HTTP router');
    if (/(^|\/)urls\.py$/.test(file)) { const p = all(/\b(?:re_)?path\(\s*r?["']([^"']*)["']/g, text); if (p.length) add('api', p.map(x => '/' + x.replace(/^\^?\/?/, '')), 'Django urls'); }
    const jobs = all(/\bcron\.schedule\(\s*["'`]([^"'`]+)/g, text).concat(all(/\bnew\s+Worker\(\s*["'`]([^"'`]+)/g, text), all(/@(?:shared_task|celery\.task|app\.task)\b[^\n]*\n\s*(?:async\s+)?def\s+(\w+)/g, text), all(/\.process\(\s*["'`]([^"'`]+)/g, text));
    if (jobs.length) add('job', jobs, 'scheduler or queue worker');
    const llm = /\b(?:messages|chat\.completions|completions|responses|embeddings)\.create\(|\bgenerate(?:Text|Object)\(|\bChat(?:Anthropic|OpenAI)\(|\bpipeline\(\s*["']|\.fit\(|\.predict\(/.test(text);
    if (llm) add('model', all(/(?:export\s+)?(?:async\s+)?(?:function|def)\s+(\w+)/g, text).slice(0, MAX_ANCHORS), 'model or LLM call');
    const commands = all(/\.command\(\s*["'`]([\w:-]+)/g, text).concat(all(/\badd_parser\(\s*["']([\w:-]+)/g, text), all(/@(?:click|app|cli)\.command\(\s*(?:name\s*=\s*)?["']([\w:-]+)/g, text));
    if (commands.length) add('cli', commands, 'subcommand parser');
    const flags = all(/\b(?:isEnabled|isFeatureEnabled|useFlag|useFeature|useFeatureFlag|featureFlag|getFlag|variation)\(\s*["'`]([\w.:-]+)/g, text);
    if (flags.length) add('feature', flags, 'feature flag check');
  }
  if (/(^|\/)(prompts|pipelines|agents)\/[^/]+\.(md|txt|ya?ml|j2|jinja|prompt|py|[jt]s)$/.test(file) && !out.some(s => s.kind === 'model')) add('model', [path.posix.basename(file)], 'prompt or pipeline file');
  if (/\.ipynb$|(^|\/)(dvc\.ya?ml|MLproject)$/.test(file)) add('model', [path.posix.basename(file)], 'notebook or ML pipeline');
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) add('job', uniq([...all(/^\s*([\w-]+):\s*\n\s+(?:name|runs-on):/gm, text)]).slice(0, MAX_ANCHORS).concat([path.posix.basename(file)]), 'CI workflow');
  if (/(^|\/)(flags|features|feature-flags|feature_flags)\.(json|ya?ml|[jt]s)$/.test(file)) add('feature', all(/["']?([\w.-]+)["']?\s*:/g, text).slice(0, MAX_ANCHORS), 'flag registry');
  return out;
}

/** package.json / pyproject.toml entries: cli (bin, scripts) and lib (main, exports). */
export function manifestSurfaces(file, text) {
  const out = [];
  if (/(^|\/)package\.json$/.test(file) && !/node_modules/.test(file)) {
    let pj; try { pj = JSON.parse(text); } catch { return out; }
    const bin = typeof pj.bin === 'string' ? [pj.name || 'bin'] : Object.keys(pj.bin || {});
    if (bin.length) out.push({ kind: 'cli', anchors: bin, evidence: 'package.json bin' });
    const lib = [pj.main, ...(typeof pj.exports === 'string' ? [pj.exports] : Object.keys(pj.exports || {}))].filter(x => typeof x === 'string');
    if (lib.length && pj.private !== true) out.push({ kind: 'lib', anchors: lib, evidence: 'package.json main/exports' });
  }
  if (/(^|\/)pyproject\.toml$/.test(file)) {
    const block = /\[project\.scripts\]([\s\S]*?)(?:\n\[|$)/.exec(text);
    if (block) { const s = all(/^\s*([\w.-]+)\s*=/gm, block[1]); if (s.length) out.push({ kind: 'cli', anchors: s, evidence: 'pyproject scripts' }); }
  }
  return out;
}

const run = (cmd, args, cwd) => new Promise((resolve) => {
  execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (err, stdout) => resolve(err ? null : stdout));
});

/** The project's files: git's tracked and untracked-not-ignored list, else a bounded walk. Relative, posix. */
async function listFiles(projectDir) {
  const git = await run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], projectDir);
  if (git !== null) return { files: git.split('\0').filter(Boolean), via: 'git' };
  const files = [];
  async function walk(dir) {
    if (files.length >= MAX_FILES) return;
    let ents; try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const rel = posix(path.relative(projectDir, path.join(dir, e.name)));
      if (e.isDirectory()) { if (!SKIP_DIR.test(rel + '/')) await walk(path.join(dir, e.name)); }
      else if (e.isFile()) files.push(rel);
    }
  }
  await walk(projectDir);
  return { files, via: 'walk' };
}

/** Commits per file in the window (counts only), from one git log call; empty when git is unavailable. */
async function activity(projectDir, days, now) {
  const since = new Date(now().getTime() - days * 86400000).toISOString();
  const outText = await run('git', ['log', `--since=${since}`, '--name-only', '--format=', '--no-renames'], projectDir);
  const counts = new Map();
  for (const f of (outText || '').split('\n')) if (f) counts.set(f, (counts.get(f) || 0) + 1);
  return counts;
}

/** Scan the project. Returns { scanned, skipped, via, surfaces }. Workflows come from .claude/commands with their headings. */
export async function scanSurfaces(projectDir, { now = () => new Date(), days = ACTIVITY_DAYS } = {}) {
  const { files, via } = await listFiles(projectDir);
  const act = await activity(projectDir, days, now);
  const byId = new Map();
  let scanned = 0;
  let skipped = 0;
  const put = (kind, file, anchors, evidence) => {
    const id = `${kind}:${file}`;
    const s = byId.get(id) || { id, kind, file, anchors: [], label: null, evidence: [], activity: act.get(file) || 0 };
    s.anchors = uniq([...s.anchors, ...anchors]).slice(0, MAX_ANCHORS);
    if (!s.evidence.includes(evidence)) s.evidence.push(evidence);
    byId.set(id, s);
  };
  for (const file of files.slice(0, MAX_FILES)) {
    if (SKIP_DIR.test(file) || SKIP_RUN_DIRS.test(file) || file.startsWith('.claude/commands/')) continue;
    const manifest = /(^|\/)(package\.json|pyproject\.toml)$/.test(file);
    if (!manifest && !CODE.test(file) && !/\.(md|txt|ya?ml|json|j2|jinja|prompt|ipynb|toml)$/.test(file) && !/MLproject$/.test(file)) continue;
    let text;
    try {
      const st = await fs.stat(path.join(projectDir, file));
      if (!st.isFile() || st.size > MAX_FILE_BYTES) { skipped++; continue; }
      text = await fs.readFile(path.join(projectDir, file), 'utf-8');
    } catch { skipped++; continue; }
    scanned++;
    for (const s of manifest ? manifestSurfaces(file, text) : detect(file, text)) put(s.kind, file, s.anchors, s.evidence);
  }
  for (const [name, w] of await installedWorkflows(projectDir)) {
    if (w.aliasOf) continue;
    put('workflow', w.file, await stepHeadings(projectDir, w.file), 'installed Claude Code command');
    byId.get(`workflow:${w.file}`).label = `/${name}`;
  }
  const surfaces = [...byId.values()].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || b.activity - a.activity || a.file.localeCompare(b.file));
  for (const s of surfaces) if (!s.label) s.label = s.anchors[0] ? `${s.kind} ${s.anchors[0]}` : `${s.kind} ${s.file}`;
  return { scanned, skipped, via, surfaces };
}

/** Parse the owner's `<kind>:<file>[#<anchor>]`. The file must exist in the project. */
export async function ownerSurface(projectDir, spec) {
  const m = /^([a-z]+):([^#]+?)(?:#(.+))?$/.exec(String(spec).trim());
  if (!m || !KINDS.includes(m[1])) throw new Error(`a surface is <kind>:<file>[#<anchor>] with kind one of ${KINDS.join('|')}, got "${spec}"`);
  const file = posix(path.normalize(m[2])).replace(/^\.\//, '');
  if (file.startsWith('../') || path.isAbsolute(file)) throw new Error(`"${m[2]}" is outside the project`);
  try { if (!(await fs.stat(path.join(projectDir, file))).isFile()) throw new Error('not a file'); } catch { throw new Error(`"${file}" is not a file in the project`); }
  return { id: `${m[1]}:${file}`, kind: m[1], file, anchors: m[3] ? [m[3].trim()] : [], label: m[3] ? `${m[1]} ${m[3].trim()}` : `${m[1]} ${file}`, evidence: ['named by the owner'], activity: null, by: 'owner' };
}

/** Write surfaces.json for a run (scan), or add the owner's own surfaces to it (`add`). */
export async function recordSurfaces(projectDir, { run, add, force = false, now = () => new Date(), cfg = DEFAULT_CONFIG }) {
  const dir = runDirOf(projectDir, run, cfg);
  const file = path.join(dir, 'surfaces.json');
  let prior;
  try { prior = await readJson(file); } catch (err) {
    if (!force) throw new Error(`${err.message} — run cli.js surfaces --force to rescan and replace it`);
    prior = null;
  }
  let data;
  if (add?.length) {
    if (!prior) throw new Error('no surfaces.json yet — run cli.js surfaces first, then --add the owner\'s own');
    const owner = [...(prior.owner || [])];
    for (const spec of add) {
      const s = await ownerSurface(projectDir, spec);
      const had = owner.find(o => o.id === s.id);
      if (had) had.anchors = uniq([...had.anchors, ...s.anchors]); else owner.push(s);
    }
    data = { ...prior, ts: now().toISOString(), owner };
  } else {
    if (prior && !force) throw new Error(`surfaces.json already exists for run ${run}; pass --force to rescan (the owner's own surfaces are kept)`);
    const scan = await scanSurfaces(projectDir, { now });
    const kinds = Object.fromEntries(KINDS.map(k => [k, scan.surfaces.filter(s => s.kind === k).length]));
    data = { run, ts: now().toISOString(), scanned: scan.scanned, skipped: scan.skipped, via: scan.via, kinds, surfaces: scan.surfaces, owner: prior?.owner || [] };
  }
  await writeJson(file, data);
  const list = allSurfaces(data);
  return {
    run,
    scanned: data.scanned,
    kinds: Object.fromEntries(KINDS.map(k => [k, list.filter(s => s.kind === k).length]).filter(([, n]) => n)),
    owner: (data.owner || []).length,
    note: list.some(s => s.kind !== 'workflow') ? undefined
      : 'no UI, API, job, model, CLI, flag or library surface found: the verdict question must ask the owner where these powers belong (<power>@<kind>:<file>[#<anchor>])'
  };
}

/** Every surface of a surfaces.json, the owner's own included (theirs win on the same id). */
export function allSurfaces(doc) {
  const out = new Map();
  for (const s of doc?.surfaces || []) out.set(s.id, s);
  for (const s of doc?.owner || []) out.set(s.id, { ...(out.get(s.id) || {}), ...s, anchors: uniq([...(out.get(s.id)?.anchors || []), ...s.anchors]) });
  return [...out.values()];
}

/** Brief lines: surfaces grouped by kind, busiest first, with their anchors. */
export function surfaceLines(doc, { perKind = 25 } = {}) {
  const list = allSurfaces(doc);
  const lines = [];
  for (const kind of KINDS) {
    const of = list.filter(s => s.kind === kind);
    if (!of.length) continue;
    lines.push('', `### ${kind} (${of.length})`);
    for (const s of of.slice(0, perKind)) {
      const a = s.anchors.length ? ` — at: ${s.anchors.slice(0, 8).map(x => JSON.stringify(x)).join(', ')}${s.anchors.length > 8 ? ', …' : ''}` : '';
      lines.push(`- ${s.id}${s.by === 'owner' ? ' (named by the owner)' : s.activity ? ` (${s.activity} commits lately)` : ''}${a}`);
    }
    if (of.length > perKind) lines.push(`- … ${of.length - perKind} more ${kind} surfaces (any of them may be named by id)`);
  }
  return lines.length ? lines : ['(no surface found)'];
}
