/**
 * impact — the blast radius of a change: which definitions the diff touches, and who depends on them.
 *
 *   impact [--dir <path>] --diff <file|-> [--base <ref>] [--hops N] [--json]
 *
 * WHAT IT DOES. (1) Reads the unified diff (lenses.parseDiff, the one shared diff reader) into changed new-side line
 * ranges and removed old-side line ranges per file. (2) Builds the symbol graph (graph.js, changed files first) and maps
 * each changed range to the INNERMOST definitions around it; a changed line outside every definition is reported as a
 * module-level change. (3) Walks incoming `call`, `extends` and `implements` edges backwards, up to --hops hops (default
 * 2, at most 3), and ranks what it finds: certain before likely before possible (a path is as strong as its weakest
 * edge), production code before tests, then fewer hops, then nearer folders before distant ones. (4) With --base, builds the
 * facts of each changed file as it was at <ref> (`git cat-file blob <ref>:<path>`, read-only, through safe-git), finds
 * definitions the change removes, and flags each removed one that the new tree still calls: a call the graph could not
 * link because the name is gone (`unknown export`, a `value call` in the same file, a member call nothing answers to).
 * (5) Scores the risk from the number of touched symbols, direct callers and removed exported names.
 *
 * LIMITS (every one is recorded in `cuts` as {at, kind, omitted}). A symbol with more than `maxHubFanIn` incoming edges
 * is a hub: it is NOT expanded (kind hub_fan_in, omitted = its fan-in; it also appears in `hubs`). Each hop keeps at
 * most `maxPerHop` of its best-ranked symbols (per_hop), and the whole walk at most `maxSymbols` (max_symbols). The
 * default text output lists the first 25 impacted symbols (list_limit); --json lists all that the walk kept. The risk
 * score caps its inputs (5 touched symbols, 8 direct callers), so one widely implemented interface cannot make every
 * change high; a removed symbol with a live caller is high by itself.
 *
 * WHAT IT DOES NOT CLAIM. The graph is the graph's: `partial` and `not_read` are carried through from it, a changed
 * source file the graph could not read is listed in `unmapped`, and the old-side files it could not read in
 * `old_not_read`. When any of that is non-empty, or the walk was cut, `risk.lower_bound` is true: the level is a floor,
 * never "nothing else is affected". Without --base, removed symbols are not checked, and the output says so.
 * It reads JS/TS only; it never runs the code it reads, makes no network call, and reads git only through safe-git.
 *
 * Exit codes: 0 done, 1 invalid input or broken state, 2 policy refusal (an oversized diff).
 * Built from ideas audited by /w-bbs (run 2026-10-10-openqodex-2); no foreign code.
 */
import path from 'path';
import { KitExit } from './kit-exit.js';
import { gitPaths } from './git-paths.js';
import { safeGit, locateRepo } from './safe-git.js';
import { parseDiff } from './lenses.js';
import { buildGraph, extractFacts, readDiffArg, SUPPORTED_EXT } from './graph.js';

export const verb = 'impact';
export const usage = 'cli.js impact [--dir <path>] --diff <file|-> [--base <ref>] [--hops N] [--json]   '
  + '(which definitions a diff touches and what depends on them, 2 hops by default, at most 3; --base <ref> also finds removed definitions that are still called; '
  + '`partial`, `not_read` and `cuts` say what the answer leaves out; --diff - reads a piped diff, never a terminal; exit 0 done, 1 invalid, 2 refused)';

export const LIMITS = Object.freeze({ hops: 2, maxHops: 3, maxHubFanIn: 50, maxPerHop: 40, maxSymbols: 100, maxOldFiles: 300, listLimit: 25, maxOldBytes: 1024 * 1024 });
const EDGE_KINDS = new Set(['call', 'extends', 'implements']);
const CONF = { possible: 0, likely: 1, certain: 2 };
const invalid = (m) => new KitExit(m, 1);
const isSource = (p) => SUPPORTED_EXT.includes(path.posix.extname(p).toLowerCase());

// ================================================================ diff → ranges

function toRanges(nums) {
  const out = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}

/**
 * A unified diff → `[{ path, oldPath, deleted, added: [[start, end]], removed: [[start, end]] }]`. `added` are new-side
 * line ranges, `removed` old-side ones (consecutive lines merged). One reader for every prefix style (lenses.parseDiff).
 * `{ cuts: true }` adds `cuts`: the new-side line each removal sits just before (pure deletions map through these).
 */
export function parseDiffLines(diffText, { cuts = false } = {}) {
  return parseDiff(diffText, { lines: true })
    .filter((f) => f.path && f.path !== '/dev/null')
    .map((f) => ({ path: f.path, oldPath: f.oldPath, deleted: !!f.deleted, added: toRanges(f.addedAt), removed: toRanges(f.removedAt), ...(cuts ? { cuts: [...new Set(f.removedNewAt || [])].sort((a, b) => a - b) } : {}) }));
}

// ================================================================ touched symbols

/**
 * Decided per changed LINE: each line maps to the smallest definition that contains it (none = module level), and the
 * touched set is the union over lines. So an outer function whose own lines changed stays touched next to a nested
 * one that changed too. Returns { hit: [defs], outside: true when some changed line is in no definition }.
 * `cuts` are pure deletions: new-side line p means lines were removed between p-1 and p. A cut belongs to the smallest
 * definition holding both p-1 and p (a deleted check inside a function that still exists touches that function).
 */
function mapLines(defs, ranges, cuts = []) {
  const hit = new Set();
  let outside = false;
  for (const [s, e] of ranges) {
    for (let n = s; n <= e; n++) {
      let best = null;
      for (const d of defs) {
        if (d.start > n || d.end < n) continue;
        if (!best || d.end - d.start < best.end - best.start || (d.end - d.start === best.end - best.start && d.start > best.start)) best = d;
      }
      if (best) hit.add(best); else outside = true;
    }
  }
  for (const p of cuts) {
    let best = null;
    for (const d of defs) {
      if (d.start > p - 1 || d.end < p) continue;
      if (!best || d.end - d.start < best.end - best.start || (d.end - d.start === best.end - best.start && d.start > best.start)) best = d;
    }
    if (best) hit.add(best); else outside = true;
  }
  return { hit: [...hit], outside };
}

/**
 * Map changes to definitions. `graph` is buildGraph's result; `changes` is parseDiffLines' output. `oldGraph`
 * (`{ files: { [path]: defs }, not_read: [...] }`, see buildOldSide) enables removed-symbol detection.
 * Returns { touched, removed, removed_unchecked, module_level, unmapped, not_source }.
 */
export function touchedSymbols(graph, changes, { oldGraph } = {}) {
  const readFiles = new Set((graph.files || []).map((f) => f.path));
  const notRead = new Map((graph.not_read || []).map((r) => [r.file, r.reason]));
  const defsOf = new Map();
  for (const d of graph.defs || []) { if (!defsOf.has(d.file)) defsOf.set(d.file, []); defsOf.get(d.file).push(d); }
  const out = { touched: [], removed: [], removed_unchecked: [], module_level: [], unmapped: [], not_source: [] };
  const seen = new Set();
  for (const c of changes) {
    const src = isSource(c.path) || (c.oldPath && isSource(c.oldPath));
    if (!src) { out.not_source.push(c.path); continue; }
    if (!c.deleted && (c.added.length || (c.cuts || []).length)) {
      if (!readFiles.has(c.path)) out.unmapped.push({ file: c.path, reason: notRead.get(c.path) || 'not_read' });
      else {
        const defs = defsOf.get(c.path) || [];
        const { hit, outside } = mapLines(defs, c.added, c.cuts || []);
        for (const d of hit) if (!seen.has(d.id)) { seen.add(d.id); out.touched.push(d); }
        // any changed line that no definition contains is a module-level change
        if (outside) out.module_level.push(c.path);
      }
    }
    const old = oldGraph && c.oldPath && oldGraph.files[c.oldPath];
    if (old && c.removed.length) {
      const newDefs = defsOf.get(c.path) || [];
      const newKnown = c.deleted || readFiles.has(c.path);
      for (const d of old) {
        if (!c.removed.some(([s, e]) => d.start >= s && d.start <= e)) continue; // its declaration line was not removed
        if (!newKnown) { out.removed_unchecked.push({ file: c.oldPath, qualified: d.qualified, reason: notRead.get(c.path) || 'not_read' }); continue; }
        if (newDefs.some((n) => n.qualified === d.qualified)) continue; // still defined (maybe edited): not a removal
        out.removed.push({ file: c.oldPath, name: d.name, qualified: d.qualified, kind: d.kind, start: d.start, end: d.end, exported: !!d.exported, file_deleted: c.deleted });
      }
    }
  }
  return out;
}

// ================================================================ removed symbols that are still called

const lastName = (call) => String(call).split('.').pop();

/**
 * Removed symbols the new tree still calls. The graph lists the calls it could not link; a call whose name is a removed
 * symbol's and whose reason is that the name no longer exists (`unknown export`; `value call` in the removing file itself;
 * `dynamic member` for a removed method; `unread target` when the whole file was deleted) is a live caller. Returns [{ symbol, callers: [{ from, call, reason, confidence }] }];
 * the graph's unresolved list is capped, so `search_partial` says when it could not be searched to the end.
 */
export function removedWithLiveCallers(graph, removed) {
  const rows = graph.unresolved || [];
  const search_partial = !!(graph.stats && graph.stats.unresolved_total > rows.length);
  const out = [];
  for (const r of removed) {
    const callers = [];
    for (const u of rows) {
      if (lastName(u.call) !== r.name) continue;
      const fromFile = String(u.from).split('::')[0];
      let confidence = null;
      if (u.reason === 'unknown export') confidence = 'likely';
      else if (u.reason === 'value call' && fromFile === r.file && !String(u.call).includes('.')) confidence = 'likely';
      else if (u.reason === 'dynamic member' && r.kind === 'method') confidence = 'possible';
      else if (u.reason === 'unread target' && r.file_deleted) confidence = 'likely'; // the importer's target file is gone
      if (confidence) callers.push({ from: u.from, call: u.call, reason: u.reason, confidence });
    }
    if (callers.length) out.push({ symbol: r, callers, search_partial });
  }
  return out;
}

// ================================================================ the walk

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|__mocks__|fixtures)\//i;
const TEST_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/i;
export const isTestFile = (p) => TEST_PATH.test(p) || TEST_NAME.test(path.posix.basename(p));

function folderDistance(a, b) {
  const x = path.posix.dirname(a).split('/').filter((s) => s !== '.');
  const y = path.posix.dirname(b).split('/').filter((s) => s !== '.');
  let k = 0;
  while (k < x.length && k < y.length && x[k] === y[k]) k++;
  return x.length - k + (y.length - k);
}

const byRank = (a, b) => (CONF[b.confidence] - CONF[a.confidence]) || (Number(a.test) - Number(b.test)) || (a.hop - b.hop)
  || (a.distance - b.distance) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Follow incoming call / extends / implements edges backwards from `touched` for `hops` hops. Options: hops (default 2,
 * 1 to 3), maxHubFanIn, maxPerHop, maxSymbols. Returns { impacted, cuts, hubs, hops }. impacted rows:
 * { id, file, name, qualified, kind, hop, confidence, test, distance, root, path: [ids from the touched symbol], via: [edge kinds] }.
 */
export function walk(graph, touched, opts = {}) {
  const o = { ...LIMITS, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
  for (const k of ['hops', 'maxHubFanIn', 'maxPerHop', 'maxSymbols']) {
    if (!Number.isSafeInteger(o[k]) || o[k] < 1) throw invalid(`${k} must be a positive whole number`);
  }
  if (o.hops > LIMITS.maxHops) throw invalid(`--hops is at most ${LIMITS.maxHops} (see --help)`);
  const nodes = new Map((graph.defs || []).map((d) => [d.id, d]));
  const incoming = new Map();
  for (const e of graph.edges || []) {
    if (!EDGE_KINDS.has(e.kind)) continue;
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e);
  }
  const nodeOf = (id) => {
    const d = nodes.get(id);
    if (d) return d;
    const file = id.split('::')[0]; // a module-level caller: `file::<module>`
    return { id, file, name: '<module>', qualified: '<module>', kind: 'module' };
  };
  const visited = new Set(touched.map((t) => t.id));
  let frontier = touched.map((t) => ({ id: t.id, file: t.file, conf: 'certain', path: [t.id], via: [], root: t.file }));
  const impacted = [];
  const cuts = [];
  const hubs = [];
  for (let hop = 1; hop <= o.hops && frontier.length; hop++) {
    const found = new Map();
    for (const f of [...frontier].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const inc = incoming.get(f.id) || [];
      const callers = new Set(inc.map((e) => e.from));
      if (callers.size > o.maxHubFanIn) {
        cuts.push({ at: f.id, kind: 'hub_fan_in', omitted: callers.size });
        hubs.push({ id: f.id, fan_in: callers.size });
        continue;
      }
      for (const e of inc) {
        if (visited.has(e.from)) continue;
        const conf = CONF[e.confidence] < CONF[f.conf] ? e.confidence : f.conf;
        const n = nodeOf(e.from);
        const cand = { id: e.from, file: n.file, name: n.name, qualified: n.qualified, kind: n.kind, hop, confidence: conf, test: isTestFile(n.file),
          distance: folderDistance(n.file, f.root), root: f.root, path: [...f.path, e.from], via: [...f.via, e.kind] };
        const old = found.get(e.from);
        if (!old || byRank(cand, old) < 0) found.set(e.from, cand);
      }
    }
    let cands = [...found.values()].sort(byRank);
    if (cands.length > o.maxPerHop) {
      cuts.push({ at: `hop ${hop}`, kind: 'per_hop', omitted: cands.length - o.maxPerHop });
      cands = cands.slice(0, o.maxPerHop);
    }
    const room = o.maxSymbols - impacted.length;
    if (cands.length > room) {
      cuts.push({ at: `hop ${hop}`, kind: 'max_symbols', omitted: cands.length - room });
      cands = cands.slice(0, Math.max(0, room));
    }
    for (const c of cands) { visited.add(c.id); impacted.push(c); }
    frontier = cands.map((c) => ({ id: c.id, file: c.file, conf: c.confidence, path: c.path, via: c.via, root: c.root }));
  }
  impacted.sort(byRank);
  return { impacted, cuts, hubs, hops: o.hops };
}

// ================================================================ risk

export const RISK = Object.freeze({ touchedCap: 5, callersCap: 8, publicPoints: 3, publicCap: 6, medium: 5, high: 14 });

/**
 * Score a result: { touched, impacted, removed, live, hubs, cuts, partial }. Points: touched symbols (cap 5) + direct
 * callers (cap 8; a possible edge counts half; a hub counts as the cap) + 3 per removed exported name (cap 6). 5 is
 * medium, 14 is high; a removed symbol with a live caller is high on its own. The caps keep a widely implemented
 * interface at medium. `lower_bound` is true when the graph was partial or the walk was cut: the level is a floor.
 */
export function risk(result) {
  const touched = (result.touched || []).length;
  const direct = (result.impacted || []).filter((i) => i.hop === 1);
  const hub = (result.hubs || []).length > 0;
  const weighted = direct.reduce((n, i) => n + (i.confidence === 'possible' ? 0.5 : 1), 0);
  const callers = Math.min(hub ? RISK.callersCap : Math.ceil(weighted), RISK.callersCap);
  const pub = (result.removed || []).filter((r) => r.exported).length;
  const live = (result.live || []).length;
  const score = Math.min(touched, RISK.touchedCap) + callers + Math.min(pub * RISK.publicPoints, RISK.publicCap);
  const reasons = [];
  if (touched) reasons.push(`${touched} touched symbol${touched === 1 ? '' : 's'}${touched > RISK.touchedCap ? ` (counted up to ${RISK.touchedCap})` : ''}`);
  if (direct.length || hub) reasons.push(`${hub ? 'a hub with more callers than the walk limit' : `${direct.length} direct caller${direct.length === 1 ? '' : 's'}`}${callers >= RISK.callersCap ? ` (counted up to ${RISK.callersCap})` : ''}`);
  if (pub) reasons.push(`${pub} removed exported name${pub === 1 ? '' : 's'}`);
  if (live) reasons.push(`${live} removed symbol${live === 1 ? '' : 's'} still called`);
  let level = score >= RISK.high ? 'high' : score >= RISK.medium ? 'medium' : 'low';
  if (live) level = 'high';
  const lower_bound = !!(result.partial || (result.cuts || []).length);
  if (result.partial) reasons.push('the graph is partial: this level is a lower bound');
  if ((result.cuts || []).length) reasons.push(`the walk was cut (${result.cuts.reduce((n, c) => n + c.omitted, 0)} items left out): this level is a lower bound`);
  return { level, score, reasons, lower_bound };
}

// ================================================================ old side (--base)

const qualifiedDefs = (facts) => facts.defs.map((d) => {
  const chain = [d.name];
  for (let u = d.up, g = 0; u >= 0 && g++ < 64; u = facts.defs[u].up) chain.unshift(facts.defs[u].name);
  return { name: d.name, qualified: chain.join('.'), kind: d.kind, start: d.start, end: d.end, exported: d.exported };
});

/**
 * Facts of the changed files as they were at `base`: `{ files: { path → defs }, not_read }`. `exec(args)` runs read-only
 * git (safe-git). A file that did not exist at base (not in `ls-tree <base> -- <path>`) is simply absent; one that
 * existed but whose blob cannot be read (a partial clone: safe-git never fetches) or scanned is in not_read, so the
 * result is partial rather than silently missing a removal.
 */
export async function buildOldSide(exec, base, changes, { maxFiles = LIMITS.maxOldFiles, clock } = {}) {
  const files = {};
  const not_read = [];
  const todo = [...new Set(changes.filter((c) => c.removed.length && c.oldPath && c.oldPath !== '/dev/null' && isSource(c.oldPath)).map((c) => c.oldPath))];
  for (const p of todo.slice(maxFiles)) not_read.push({ file: p, reason: 'budget' });
  for (const p of todo.slice(0, maxFiles)) {
    const r = await exec(['cat-file', 'blob', `${base}:${p}`]);
    if (r.code !== 0) {
      const ls = await exec(['ls-tree', '-z', '--name-only', base, '--', p]);
      if (ls.code === 0 && !String(ls.stdout).split('\0').includes(p)) continue; // not in base: a new file has nothing removed
      not_read.push({ file: p, reason: 'missing_object' }); // it was there, but its content is not available here
      continue;
    }
    if (Buffer.byteLength(r.stdout) > LIMITS.maxOldBytes) { not_read.push({ file: p, reason: 'too_large' }); continue; }
    const facts = extractFacts(r.stdout, { path: p, clock, maxMs: 2000 });
    if (facts.unread) { not_read.push({ file: p, reason: facts.unread }); continue; }
    files[p] = qualifiedDefs(facts);
  }
  return { files, not_read };
}

// ================================================================ the whole analysis

/** touched → removed → live callers → walk → risk, from a built graph and parsed changes. Pure. */
export function analyze(graph, changes, { oldGraph, walkOpts = {} } = {}) {
  const t = touchedSymbols(graph, changes, { oldGraph });
  const live = removedWithLiveCallers(graph, t.removed);
  const w = walk(graph, t.touched, walkOpts);
  const oldNotRead = (oldGraph && oldGraph.not_read) || [];
  const partial = !!(graph.partial || t.unmapped.length || oldNotRead.length || t.removed_unchecked.length);
  const rk = risk({ touched: t.touched, impacted: w.impacted, removed: t.removed, live, hubs: w.hubs, cuts: w.cuts, partial });
  return { ...t, live, ...w, old_not_read: oldNotRead, partial, risk: rk };
}

// ================================================================ CLI

const VALUE_FLAGS = ['dir', 'diff', 'base', 'hops'];

export function parseArgs(args) {
  const f = { json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') { f.help = true; continue; }
    if (a === '--json') { f.json = true; continue; }
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (name && VALUE_FLAGS.includes(name)) {
      if (i + 1 >= args.length) throw invalid(`--${name} needs a value (see --help)`);
      f[name] = args[++i];
      continue;
    }
    throw invalid(`${name ? 'unknown flag' : 'unexpected argument'} ${a} (see --help)`);
  }
  if (f.hops !== undefined && !/^[1-9]$/.test(f.hops)) throw invalid(`--hops needs a whole number from 1 to ${LIMITS.maxHops} (see --help)`);
  if (f.hops !== undefined && Number(f.hops) > LIMITS.maxHops) throw invalid(`--hops needs a whole number from 1 to ${LIMITS.maxHops} (see --help)`);
  if (f.base !== undefined && (f.base === '' || f.base.startsWith('-') || /[\0\s]/.test(f.base))) throw invalid('--base needs a git ref or object name (see --help)');
  return f;
}

const slim = (n) => ({ id: n.id, file: n.file, qualified: n.qualified, kind: n.kind, lines: [n.start, n.end] });

export async function run(args, io = {}) {
  const f = parseArgs(args);
  if (f.help) return { usage };
  if (f.diff === undefined) throw invalid('--diff <file|-> is required (see --help)');
  const cwd = io.cwd || process.cwd();
  const dir = path.resolve(cwd, f.dir || '.');
  const diffText = await readDiffArg(f.diff, io, cwd);
  const changes = parseDiffLines(diffText, { cuts: true });
  const loc = await locateRepo(dir);
  if (!loc.top) throw invalid(`${dir} has no work tree (a bare repository or a path inside .git)`);
  const exec = (a) => safeGit(loc.top, a, { git: io.git, env: io.env || process.env });
  const [top] = await gitPaths(exec, loc.top, ['toplevel'], 'cannot find the repository');
  if (f.base !== undefined) {
    const ok = await exec(['rev-parse', '--verify', '--quiet', `${f.base}^{tree}`]);
    if (ok.code !== 0) throw invalid(`--base ${JSON.stringify(f.base).slice(0, 80)} is not a commit or tree in this repository (see --help)`);
  }
  if (!changes.length) { // an empty diff is not an error (graph treats it the same way): nothing touched, nothing to follow
    return {
      root: top, base: f.base ?? null, hops: f.hops ? Number(f.hops) : LIMITS.hops, partial: false, graph_partial: false, not_read: [], unmapped: [],
      old_not_read: [], removed_unchecked: [], touched: [], module_level: [], removed: [], removed_with_live_callers: [], impacted_total: 0,
      impacted: [], hubs: [], cuts: [], risk: { level: 'low', score: 0, reasons: [], lower_bound: false },
      notes: ['the diff names no files: nothing was touched, so nothing was mapped or followed'], stats: null
    };
  }
  let oldGraph;
  if (f.base !== undefined) {
    oldGraph = await buildOldSide(exec, f.base, changes, { clock: io.clock });
  }
  const graph = await buildGraph(top, {
    changed: changes.filter((c) => !c.deleted && isSource(c.path)).map((c) => c.path),
    git: io.git, env: io.env, clock: io.clock, onParse: io.onParse, cacheDir: io.cacheDir
  });
  const hops = f.hops ? Number(f.hops) : LIMITS.hops;
  const r = analyze(graph, changes, { oldGraph, walkOpts: { hops } });
  const notes = [];
  if (f.base === undefined) notes.push('no --base: removed definitions were not checked');
  if (r.not_source.length) notes.push(`${r.not_source.length} changed file(s) are not JS/TS and were not mapped to definitions`);
  if (r.module_level.length) notes.push('changed lines outside any definition (module level) are listed in module_level; nothing is followed from them');
  const cuts = [...r.cuts];
  let impacted = r.impacted;
  if (!f.json && impacted.length > LIMITS.listLimit) {
    cuts.push({ at: 'summary', kind: 'list_limit', omitted: impacted.length - LIMITS.listLimit });
    impacted = impacted.slice(0, LIMITS.listLimit);
  }
  return {
    root: top,
    base: f.base ?? null,
    hops: r.hops,
    partial: r.partial,
    graph_partial: graph.partial,
    not_read: graph.not_read,
    unmapped: r.unmapped,
    old_not_read: r.old_not_read,
    removed_unchecked: r.removed_unchecked,
    touched: r.touched.map(slim),
    module_level: [...new Set(r.module_level)],
    removed: r.removed,
    removed_with_live_callers: r.live,
    impacted_total: r.impacted.length,
    impacted,
    hubs: r.hubs,
    cuts,
    risk: r.risk,
    notes,
    stats: graph.stats
  };
}
