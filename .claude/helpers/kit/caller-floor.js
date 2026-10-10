/**
 * callers — who calls a symbol, and what this answer could NOT see. A caller list is a floor, never the whole picture.
 *
 *   callers [--dir <path>] (--symbol <file:name>... | --diff <file|->)
 *
 * WHAT IT DOES. Reads the symbol graph (graph.js buildGraph, through its exports; no second parser) and, for each symbol,
 * lists the resolved callers (incoming `call` edges, each with its confidence) next to a count of the things that
 * could hide more. The counters are kept while indexing from the graph's own `unresolved` rows, its edges and its
 * `not_read` list; no source is re-scanned. Reasons (each a code, a count and a plain sentence):
 *   ambiguous_name        calls whose name fits several definitions (a call with `possible` edges to two or more
 *                         same-named definitions, or an `ambiguous` unresolved call), counted per call
 *   dynamic_call          unresolved calls through a value (`fn()`), an unknown member or a computed member (`o[k]()`)
 *                         whose name is the symbol's; a computed call cannot be tied to a name, so it is counted for
 *                         every method and for every symbol in the same file as that call
 *   interface_dispatch    the symbol is a method of a class that implements interface(s), or an interface itself:
 *                         a call typed as the interface reaches it without ever naming it
 *   unread_files          project files the graph did not read for a reason other than a budget (other language,
 *                         too large, unparseable): a caller may sit in one
 *   budget_cut_importers  files left unread because the time or parse budget ran out, plus unresolved calls cut off at
 *                         the graph's row cap: importers that were never resolved
 * A symbol is a `floor` when any reason applies. Name matching is by the last name of a call, so a count is a
 * "may apply", never a proof that one call reaches that symbol.
 *
 * WHAT IT NEVER CLAIMS. Zero callers is not proof of no use: with a floor the sentence says to check call sites by hand,
 * and without one it says only "in the files that were read". Graph-level `partial`, `not_read` and cuts are carried
 * into the output. A requested symbol the graph could not find is listed in `missing` with the reason (a file that was
 * not read is not "no such symbol"). At most 50 callers are listed per symbol; `callers_omitted` counts the rest.
 * JS/TS only (graph.js). It never runs the code it reads and makes no network call.
 *
 * Exit codes: 0 done, 1 invalid input or broken state, 2 policy refusal (an oversized diff).
 * Built from ideas audited by /w-bbs (run 2026-10-10-openqodex-2); no foreign code.
 */
import path from 'path';
import { KitExit } from './kit-exit.js';
import { gitPaths } from './git-paths.js';
import { safeGit, locateRepo } from './safe-git.js';
import { buildGraph, readDiffArg, normalizeRel, SUPPORTED_EXT } from './graph.js';

export const verb = 'callers';
export const usage = 'cli.js callers [--dir <path>] (--symbol <file:name>... | --diff <file|->)   '
  + '(resolved callers of a symbol plus what could not be seen: ambiguous same-name calls, calls through a value or computed member, interface dispatch, unread files, budget cuts; '
  + 'a symbol with any of these is a floor, never read zero callers as proof of no use; paths are relative to the repository top; --diff - reads a piped diff, never a terminal; exit 0 done, 1 invalid, 2 refused)';

export const CODES = Object.freeze(['ambiguous_name', 'dynamic_call', 'interface_dispatch', 'unread_files', 'budget_cut_importers']);
export const HAND_CHECK = 'Zero callers found, but this is a floor: check call sites by hand.';
export const MAX_LISTED_CALLERS = 50;
const BUDGET_REASONS = new Set(['budget', 'parse_cap']);
const DYNAMIC_REASONS = new Set(['value call', 'dynamic member', 'computed']);
const invalid = (m) => new KitExit(m, 1);

const lastName = (call) => String(call).split('.').pop();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const bump = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);

// ================================================================ the index

function graphLevel(graph) {
  const notRead = graph.not_read || [];
  const total = Math.max(graph.stats?.not_read_total ?? 0, notRead.length);
  const budget = notRead.filter((r) => BUDGET_REASONS.has(r.reason)).length;
  const other = notRead.length - budget;
  // not_read is capped; rows beyond the cap are of unknown reason and counted with the other reasons
  const unlisted = total - notRead.length;
  const unresolvedCut = Math.max(0, (graph.stats?.unresolved_total ?? 0) - (graph.unresolved || []).length);
  const byReason = {};
  for (const r of notRead) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  return { unread: other + unlisted, budget, unresolvedCut, byReason, unlisted };
}

/**
 * Counters from a graph: `{ nameCounts, edgeCounts, computedByFile, computedTotal, level }`. Kept apart from the
 * per-symbol entries so a removed symbol (not in the new graph) can be given an entry by name too.
 */
function counters(graph) {
  const ambiguous = new Map(); // def id → count (from edges)
  const ambiguousByName = new Map(); // name → count (unresolved `ambiguous`)
  const dynamicByName = new Map();
  const computedByFile = new Map();
  let computedTotal = 0;
  const defs = new Map((graph.defs || []).map((d) => [d.id, d]));
  const possibleGroups = new Map(); // `${from}\0${name}` → [target ids]
  for (const e of graph.edges || []) {
    if (e.kind !== 'call' || e.confidence !== 'possible') continue;
    const t = defs.get(e.to);
    if (!t) continue;
    const k = `${e.from}\0${t.name}`;
    if (!possibleGroups.has(k)) possibleGroups.set(k, []);
    possibleGroups.get(k).push(e.to);
  }
  for (const ids of possibleGroups.values()) if (ids.length > 1) for (const id of ids) bump(ambiguous, id);
  for (const u of graph.unresolved || []) {
    const name = lastName(u.call);
    if (u.reason === 'ambiguous') bump(ambiguousByName, name);
    else if (u.reason === 'computed') { computedTotal++; bump(computedByFile, String(u.from).split('::')[0]); }
    else if (DYNAMIC_REASONS.has(u.reason)) bump(dynamicByName, name);
  }
  return { ambiguous, ambiguousByName, dynamicByName, computedByFile, computedTotal, level: graphLevel(graph) };
}

function reasonsFor(c, sym, interfaceCount) {
  const out = [];
  const add = (code, count, sentence) => { if (count > 0) out.push({ code, count, sentence }); };
  const amb = (sym.id ? c.ambiguous.get(sym.id) || 0 : 0) + (c.ambiguousByName.get(sym.name) || 0);
  add('ambiguous_name', amb, `${plural(amb, 'call', 'calls')} named \`${sym.name}\` could not be tied to one definition.`);
  let dyn = c.dynamicByName.get(sym.name) || 0;
  let computed = 0;
  if (sym.kind === 'method') computed = c.computedTotal;
  else if (sym.file) computed = c.computedByFile.get(sym.file) || 0;
  dyn += computed;
  add('dynamic_call', dyn, `${plural(dyn, 'call goes', 'calls go')} through a value or computed member that could not be followed to a name, and ${dyn === 1 ? 'it may' : 'some may'} reach \`${sym.name}\`.`);
  add('interface_dispatch', interfaceCount, sym.kind === 'interface'
    ? `${plural(interfaceCount, 'class implements or extends', 'classes implement or extend')} \`${sym.name}\`, so calls typed as the interface reach ${interfaceCount === 1 ? 'it' : 'them'} without naming ${interfaceCount === 1 ? 'it' : 'them'}.`
    : `\`${sym.name}\` belongs to a class that implements ${plural(interfaceCount, 'interface', 'interfaces')}, so calls typed as the interface may reach it without naming it.`);
  const L = c.level;
  const readable = [...Object.entries(L.byReason).filter(([r]) => !BUDGET_REASONS.has(r)).map(([r, n]) => `${r}: ${n}`),
    ...(L.unlisted ? [`beyond the listed rows, reason not known: ${L.unlisted}`] : [])].join(', ');
  add('unread_files', L.unread, `${plural(L.unread, 'project file was', 'project files were')} not read${readable ? ` (${readable})` : ''}; a caller may be in ${L.unread === 1 ? 'it' : 'them'}.`);
  const budgetN = L.budget + L.unresolvedCut;
  const parts = [];
  if (L.budget) parts.push(`${plural(L.budget, 'file was', 'files were')} left unread when the time or parse budget ran out`);
  if (L.unresolvedCut) parts.push(`${plural(L.unresolvedCut, 'unresolved call was', 'unresolved calls were')} dropped at the graph's row cap`);
  add('budget_cut_importers', budgetN, `${parts.join(' and ')}, so importers of \`${sym.name}\` may be unresolved.`);
  return out;
}

function interfaceCountOf(graph, sym, helpers) {
  if (sym.kind === 'interface') return helpers.implementers.get(sym.id) || 0;
  if (sym.kind !== 'method') return 0;
  const cls = helpers.classes.get(`${sym.file}\0${sym.parent}`);
  return cls && Array.isArray(cls.implements) ? cls.implements.length : 0;
}

function helpersOf(graph) {
  const implementers = new Map();
  for (const e of graph.edges || []) if (e.kind === 'implements' || e.kind === 'extends') bump(implementers, e.to);
  const classes = new Map();
  for (const d of graph.defs || []) if (d.kind === 'class') classes.set(`${d.file}\0${d.name}`, d);
  return { implementers, classes };
}

/**
 * `callerIndex(graph)` → Map: def id → `{ id, file, name, qualified, kind, callers, floor, reasons }`. `callers` are the
 * resolved incoming `call` edges `[{ from, confidence }]`; `floor` is true when any of `reasons`
 * (`[{ code, count, sentence }]`, codes in CODES) applies. Pure: reads only the graph.
 */
export function callerIndex(graph) {
  const c = counters(graph);
  const h = helpersOf(graph);
  const callers = new Map();
  for (const e of graph.edges || []) {
    if (e.kind !== 'call') continue;
    if (!callers.has(e.to)) callers.set(e.to, []);
    callers.get(e.to).push({ from: e.from, confidence: e.confidence });
  }
  const index = new Map();
  for (const d of graph.defs || []) {
    const reasons = reasonsFor(c, d, interfaceCountOf(graph, d, h));
    index.set(d.id, { id: d.id, file: d.file, name: d.name, qualified: d.qualified, kind: d.kind, callers: callers.get(d.id) || [], floor: reasons.length > 0, reasons });
  }
  Object.defineProperty(index, 'forName', { // an entry for a symbol the graph does not hold (a removed one, a module-level caller)
    value: (sym, callerList = []) => {
      // a removed method keeps its class's interfaces: the class (still in the graph) is named by its qualified name
      const q = String(sym.qualified || sym.name).split('.');
      const parent = sym.parent ?? (q.length > 1 ? q[q.length - 2] : undefined);
      const probe = { name: sym.name, kind: sym.kind, file: sym.file, parent };
      const reasons = reasonsFor(c, probe, interfaceCountOf(graph, probe, h));
      return { id: sym.id, file: sym.file, name: sym.name, qualified: sym.qualified || sym.name, kind: sym.kind, callers: callerList, floor: reasons.length > 0, reasons };
    }
  });
  return index;
}

/** Sentences for an entry: its reasons, then the hand-check line. Zero callers never reads as "no use". */
export function renderFloor(entry) {
  const out = (entry.reasons || []).map((r) => r.sentence);
  const n = (entry.callers || []).length;
  if (entry.floor) out.push(n === 0 ? HAND_CHECK : 'This is a floor: check call sites by hand.');
  else if (n === 0) out.push('Zero callers found in the files that were read.');
  return out;
}

/** What the whole answer leaves out, as sentences (graph level, shown once above the entries). */
export function graphLimits(graph) {
  const out = [];
  const nr = graph.not_read || [];
  if (nr.length) out.push(`${plural(nr.length, 'file was', 'files were')} not read (${Object.entries(nr.reduce((m, r) => (m[r.reason] = (m[r.reason] || 0) + 1, m), {})).map(([r, n]) => `${r}: ${n}`).join(', ')}).`);
  const lost = Math.max(0, (graph.stats?.not_read_total ?? 0) - nr.length);
  if (lost) out.push(`${plural(lost, 'more unread file is', 'more unread files are')} not listed (the list is capped).`);
  const cut = Math.max(0, (graph.stats?.unresolved_total ?? 0) - (graph.unresolved || []).length);
  if (cut) out.push(`${plural(cut, 'unresolved call was', 'unresolved calls were')} dropped at the row cap.`);
  return out;
}

/**
 * Add `floor`, `reasons` and `sentences` to impact rows. `rows` need `file`, `name`, `kind` (and `id` for graph symbols);
 * a graph symbol keeps its resolved callers, anything else (removed symbols, module-level callers) is judged by name.
 * `callersFor(row)` may supply caller lists (a removed symbol's live callers).
 */
export function annotate(index, rows, callersFor = () => []) {
  return rows.map((r) => {
    const own = r.id && index.get(r.id);
    const e = own || index.forName(r, callersFor(r));
    const entry = own && callersFor(r).length ? { ...e, callers: [...e.callers, ...callersFor(r)] } : e;
    return { ...r, floor: entry.floor, reasons: entry.reasons, sentences: renderFloor(entry) };
  });
}

// ================================================================ CLI

const VALUE_FLAGS = ['dir', 'diff'];

export function parseArgs(args) {
  const f = { symbols: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') { f.help = true; continue; }
    if (a === '--symbol') {
      let k = i + 1;
      while (k < args.length && !args[k].startsWith('-')) f.symbols.push(args[k++]); // a following -h / --flag ends the list
      if (k === i + 1) throw invalid('--symbol needs at least one file:name (see --help)');
      i = k - 1;
      continue;
    }
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (name && VALUE_FLAGS.includes(name)) {
      if (i + 1 >= args.length) throw invalid(`--${name} needs a value (see --help)`);
      f[name] = args[++i];
      continue;
    }
    throw invalid(`${name ? 'unknown flag' : 'unexpected argument'} ${a} (see --help)`);
  }
  return f;
}

/** `file:name` split at the LAST colon (a file name may hold colons; a symbol name cannot). */
export function parseSymbolArg(s) {
  const k = s.lastIndexOf(':');
  if (k <= 0 || k === s.length - 1) throw invalid(`${JSON.stringify(s).slice(0, 80)} is not file:name (see --help)`);
  return { file: normalizeRel(s.slice(0, k), 'symbol file'), name: s.slice(k + 1) };
}

function shape(entry) {
  const sorted = [...entry.callers].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return {
    id: entry.id, file: entry.file, qualified: entry.qualified, kind: entry.kind,
    callers_total: sorted.length, callers: sorted.slice(0, MAX_LISTED_CALLERS), callers_omitted: Math.max(0, sorted.length - MAX_LISTED_CALLERS),
    floor: entry.floor, reasons: entry.reasons, sentences: renderFloor(entry)
  };
}

export async function run(args, io = {}) {
  const f = parseArgs(args);
  if (f.help) return { usage };
  if (!f.symbols.length && f.diff === undefined) throw invalid('give --symbol <file:name> or --diff <file|-> (see --help)');
  const cwd = io.cwd || process.cwd();
  const dir = path.resolve(cwd, f.dir || '.');
  const wanted = f.symbols.map(parseSymbolArg);
  let changes = [];
  let impact = null;
  if (f.diff !== undefined) {
    const diffText = await readDiffArg(f.diff, io, cwd);
    impact = await import('./impact.js'); // loaded here: impact.js imports this module, so a top-level import would be a cycle
    changes = impact.parseDiffLines(diffText, { cuts: true });
  }
  const loc = await locateRepo(dir);
  if (!loc.top) throw invalid(`${dir} has no work tree (a bare repository or a path inside .git)`);
  const exec = (a) => safeGit(loc.top, a, { git: io.git, env: io.env || process.env });
  const [top] = await gitPaths(exec, loc.top, ['toplevel'], 'cannot find the repository');
  const isSrc = (p) => SUPPORTED_EXT.includes(path.posix.extname(p).toLowerCase());
  const changed = [...wanted.map((w) => w.file), ...changes.filter((c) => !c.deleted && isSrc(c.path)).map((c) => c.path)];
  const graph = await buildGraph(top, { changed, git: io.git, env: io.env, clock: io.clock, onParse: io.onParse, cacheDir: io.cacheDir });
  const index = callerIndex(graph);
  const entries = [];
  const missing = [];
  const seen = new Set();
  const take = (e) => { if (!seen.has(e.id)) { seen.add(e.id); entries.push(shape(e)); } };
  const notRead = new Map((graph.not_read || []).map((r) => [r.file, r.reason]));
  for (const w of wanted) {
    const hits = (graph.defs || []).filter((d) => d.file === w.file && (d.qualified === w.name || d.name === w.name));
    if (hits.length) { for (const d of hits) take(index.get(d.id)); continue; }
    const readFile = (graph.files || []).some((x) => x.path === w.file);
    missing.push({ file: w.file, name: w.name, reason: notRead.has(w.file) ? `the file was not read (${notRead.get(w.file)}); this says nothing about its callers`
      : readFile ? 'no definition with that name in the file as read' : 'no such source file in the repository (nothing was read for it)' });
  }
  let unmapped = [];
  let module_level = [];
  if (impact) {
    const t = impact.touchedSymbols(graph, changes);
    for (const d of t.touched) take(index.get(d.id));
    unmapped = t.unmapped;
    module_level = [...new Set(t.module_level)];
  }
  const partial = !!(graph.partial || unmapped.length || missing.some((m) => m.reason.startsWith('the file was not read')));
  const notes = ['a caller list is a floor: zero callers is not proof that a symbol is unused'];
  // callers looks at definitions that still exist; a removed one (and a deleted file) is impact --base's job
  const removals_unchecked = [...new Set(changes.filter((c) => (c.deleted || c.removed.length) && isSrc(c.oldPath || c.path)).map((c) => c.oldPath || c.path))];
  if (removals_unchecked.length) notes.push(`lines were removed in ${removals_unchecked.length} source file(s): definitions that were removed are not checked here; run impact --diff with --base to find removed definitions that are still called`);
  if (impact && !entries.length) notes.push(removals_unchecked.length ? 'the diff touched no remaining definition that the graph could read (removals: see above)' : 'the diff touched no definition that the graph could read');
  return {
    root: top,
    partial,
    not_read: graph.not_read,
    limits: graphLimits(graph),
    entries,
    missing,
    unmapped,
    module_level,
    removals_unchecked,
    notes,
    stats: graph.stats
  };
}
