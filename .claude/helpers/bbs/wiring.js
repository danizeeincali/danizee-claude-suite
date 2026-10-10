/**
 * bbs wiring — is a built power actually integrated where it was approved to land, and does the owner know?
 *
 * Integration is judged per target, by the target's kind:
 *   workflow  the workflow's installed command file runs the power's verb (`kit/cli.js <verb>`, inline code or a
 *             fenced block) inside the approved step: from that step's heading to the next heading of the same or a
 *             higher level; a target whose step was left for the integration stream (step null) may run it anywhere.
 *   any other surface (ui, api, job, model, cli, feature, lib) — two things, both required:
 *     linked  the surface file uses the power's entry: it imports the entry module and/or names the entry symbol
 *     reached a reach test recorded for that surface goes in through it (its text names the surface's anchor or
 *             imports the surface file) and passes when it is run now. A test that only calls the power is not a
 *             reach test: it proves the power works, not that a user can get to it.
 * Nothing else counts: a doc, a note, a review, a run folder or another module that names the power is not a caller.
 *
 * integration.json (the integration stream writes it with `cli.js integrate`):
 *   { run, ts, powers: { "<power>": { verb, entry, reach: [{ surface, at, test, command }] } } }
 * `delivered` writes the hand-over note — the keys: per approved power, what it does, where a user finds it now, the
 * test that proves it, and how to run it by hand.
 */

import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, readJson, writeJson, writeTextAtomic } from './store.js';
import { installedWorkflows } from './usage.js';
import { normalizeStep } from './steps.js';
import { standingTargets, isWorkflow } from './targets.js';

const VERB = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SYMBOL = /^[A-Za-z_$][\w$]{0,127}$/;
export const REACH_TIMEOUT_MS = 5 * 60 * 1000;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const posix = (p) => p.split(path.sep).join('/');

/** The pattern a wired workflow step must contain: the kit CLI run with this verb. */
export function verbCall(verb) {
  if (typeof verb !== 'string' || !VERB.test(verb)) throw new Error(`verb must be lower-case letters, digits and dashes, got ${JSON.stringify(verb)}`);
  return new RegExp(`(?:^|[\\s\`'"(/])(?:\\.claude/helpers/)?kit/cli\\.js\\s+${esc(verb)}(?![\\w-])`, 'm');
}

/**
 * A code power's entry: `<module>#<symbol>`, `<module>` or `<symbol>`. The module is a project path (its file stem is
 * what an import names); the symbol is the function or component a surface calls.
 */
export function parseEntry(entry) {
  if (typeof entry !== 'string' || !entry.trim()) throw new Error(`entry must be <module>#<symbol>, <module> or <symbol>, got ${JSON.stringify(entry)}`);
  const [mod, sym, extra] = entry.trim().split('#');
  if (extra !== undefined) throw new Error(`entry has more than one #: ${JSON.stringify(entry)}`);
  const isPath = (s) => /[/.]/.test(s);
  let module = null;
  let symbol = null;
  if (sym !== undefined) { module = mod; symbol = sym; } else if (isPath(mod)) module = mod; else symbol = mod;
  if (module !== null && (!module || module.startsWith('/') || posix(path.normalize(module)).startsWith('../'))) throw new Error(`entry module must be a path in the project, got ${JSON.stringify(module)}`);
  if (symbol !== null && !SYMBOL.test(symbol)) throw new Error(`entry symbol must be an identifier, got ${JSON.stringify(symbol)}`);
  const stem = module ? path.posix.basename(posix(module)).replace(/\.[^.]+$/, '') : null;
  return { module: module && posix(path.normalize(module)), symbol, stem };
}

/** Does `text` (a surface file) use the entry: import its module, and name its symbol outside the import lines? */
export function usesEntry(text, entry) {
  const { stem, symbol } = typeof entry === 'string' ? parseEntry(entry) : entry;
  const lines = String(text).split('\n');
  const importRe = stem ? new RegExp(`(?:\\bimport\\b|\\bfrom\\b|\\brequire\\s*\\(|\\bimport\\s*\\()[^\\n]*['"](?:[^'"]*/)?${esc(stem)}(?:\\.[\\w]+)?['"]`) : null;
  const pyImport = stem ? new RegExp(`^\\s*(?:from\\s+[\\w.]*\\b${esc(stem)}\\b\\s+import|import\\s+[\\w.]*\\b${esc(stem)}\\b)`) : null;
  const isImport = (l) => (importRe && importRe.test(l)) || (pyImport && pyImport.test(l)) || /^\s*(?:import|from)\b/.test(l);
  if (stem && !lines.some(l => importRe.test(l) || pyImport.test(l))) return { ok: false, why: `never imports ${stem}` };
  if (!symbol) return { ok: true };
  const sym = new RegExp(`(?<![\\w$])${esc(symbol)}(?![\\w$])`);
  return lines.some(l => sym.test(l) && !isImport(l)) ? { ok: true } : { ok: false, why: `never calls ${symbol}` };
}

/** The lines of `text` under the heading whose normalized text equals `step`, up to the next heading of its level or higher. */
export function stepSection(text, step) {
  const lines = String(text).split('\n');
  const want = normalizeStep(step);
  let fence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (start >= 0 && m[1].length <= level) return lines.slice(start, i).join('\n');
    if (start < 0 && normalizeStep(m[2]) === want) { start = i; level = m[1].length; }
  }
  return start >= 0 ? lines.slice(start).join('\n') : null;
}

/** Run a reach test command once per call; exit 0 within the timeout is a pass. */
function runReach(projectDir, command, cache, timeoutMs) {
  if (cache.has(command)) return cache.get(command);
  const r = spawnSync('sh', ['-c', command], { cwd: projectDir, encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const tail = `${r.stdout || ''}${r.stderr || ''}`.split('\n').filter(l => /not ok|Error|error|fail/i.test(l)).slice(0, 3).join(' | ');
  const res = r.error?.code === 'ETIMEDOUT' || r.signal ? { ok: false, why: `reach test timed out or was killed: ${command}` }
    : r.status === 0 ? { ok: true } : { ok: false, why: `reach test failed (exit ${r.status}): ${command}${tail ? ` — ${tail.slice(0, 200)}` : ''}` };
  cache.set(command, res);
  return res;
}

/** Does a reach test go in through the surface: name its anchor, or import the surface file? */
export function entersThrough(testText, target) {
  if (target.at && String(testText).includes(target.at)) return true;
  const stem = path.posix.basename(target.file).replace(/\.[^.]+$/, '');
  const dir = path.posix.basename(path.posix.dirname(target.file));
  // file-system routers name every page "page"/"route": the import must carry the folder too
  const needle = /^(page|route|index|\+page|\+server)$/.test(stem) ? `${dir}/${stem}` : stem;
  return new RegExp(`['"](?:[^'"]*/)?${esc(needle)}(?:\\.[\\w]+)?['"]`).test(testText);
}

/**
 * For each target, whether it is wired. Returns [{ kind, surface, workflow, step, at, reach, mode, file, wired, why,
 * test }]; `why` says what is missing when it is not. `verb` is checked on workflow targets; `entry` and `reach`
 * (from integration.json) on the others. `run: false` checks reach tests without running them (they then never count).
 */
export async function wiredTargets(projectDir, { verb, entry, reach, targets, run = true, timeoutMs = REACH_TIMEOUT_MS }) {
  const call = verb !== undefined && verb !== null ? verbCall(verb) : null;
  const parsed = entry ? parseEntry(entry) : null;
  const installed = (targets || []).some(isWorkflow) ? await installedWorkflows(projectDir) : new Map();
  const cache = new Map();
  const out = [];
  for (const t of targets || []) {
    const wf = isWorkflow(t);
    const row = {
      kind: wf ? 'workflow' : t.kind, surface: t.surface ?? null, workflow: t.workflow ?? null, step: t.step ?? null, at: wf ? (t.step ?? null) : (t.at ?? null),
      reach: t.reach ?? null, mode: t.mode, file: wf ? (installed.get(t.workflow)?.file ?? null) : (t.file ?? null), wired: false, why: null, test: null
    };
    out.push(row);
    if (!row.file) { row.why = wf ? 'the workflow is not installed' : 'the target names no file'; continue; }
    let text;
    try { text = await fs.readFile(path.join(projectDir, row.file), 'utf-8'); } catch { row.why = `${row.file} is unreadable`; continue; }
    if (wf) {
      if (!call) { row.why = 'no verb recorded for this power'; continue; }
      const scope = row.step === null ? text : stepSection(text, row.step);
      if (scope === null) row.why = `the step "${row.step}" is no longer a heading of ${row.file}`;
      else if (!call.test(scope)) row.why = `${row.step === null ? row.file : `"${row.step}"`} never runs kit/cli.js ${verb}`;
      else row.wired = true;
      continue;
    }
    if (!parsed) { row.why = 'no entry recorded for this power (cli.js integrate --entry <module>#<symbol>)'; continue; }
    const link = usesEntry(text, parsed);
    if (!link.ok) { row.why = `${row.file} ${link.why}`; continue; }
    const tests = (reach || []).filter(r => r.surface === row.surface && (!r.at || !row.at || r.at === row.at));
    if (!tests.length) { row.why = `no reach test recorded for ${row.surface}${row.at ? ` · ${row.at}` : ''} (cli.js integrate --reach)`; continue; }
    const whys = [];
    for (const r of tests) {
      let tt;
      try { tt = await fs.readFile(path.join(projectDir, r.test), 'utf-8'); } catch { whys.push(`reach test ${r.test} is missing`); continue; }
      if (!entersThrough(tt, row)) { whys.push(`reach test ${r.test} never goes through ${row.file}${row.at ? ` or "${row.at}"` : ''}`); continue; }
      if (!run) { whys.push(`reach test ${r.test} was not run`); continue; }
      const res = runReach(projectDir, r.command, cache, timeoutMs);
      if (!res.ok) { whys.push(res.why); continue; }
      row.wired = true;
      row.test = r.test;
      break;
    }
    if (!row.wired) row.why = whys.join('; ');
  }
  return out;
}

/** The targets a power was approved with (the standing ones, judged against the run's usage.json). */
export async function approvedTargets(projectDir, { run, power, cfg = DEFAULT_CONFIG }) {
  const dir = runDirOf(projectDir, run, cfg);
  const targets = await readJson(path.join(dir, 'targets.json'));
  const usage = await readJson(path.join(dir, 'usage.json'));
  if (!targets) throw new Error(`run ${run} has no targets.json — it was decided before the targets step`);
  return standingTargets(targets.targets?.[power], usage);
}

/** integration.json of a run, or an empty one. A corrupt file names its repair. */
export async function readIntegration(projectDir, { run, cfg = DEFAULT_CONFIG }) {
  const file = path.join(runDirOf(projectDir, run, cfg), 'integration.json');
  try { return (await readJson(file)) || { run, powers: {} }; } catch (err) { throw new Error(`${err.message} — re-record it with cli.js integrate --power <name> --force`); }
}

/**
 * Record how a power is integrated: its verb (workflow targets), its entry (code targets) and its reach tests.
 * `reach` items are `<surface id>[@<at>]=<test file>::<command>`. A power's rows merge unless `force`.
 */
export async function recordIntegration(projectDir, { run, power, verb, entry, reach = [], force = false, now = () => new Date(), cfg = DEFAULT_CONFIG }) {
  const dir = runDirOf(projectDir, run, cfg);
  const handoff = await readJson(path.join(dir, 'handoff.json'));
  if (!handoff) throw new Error(`run ${run} has no handoff.json — run cli.js handoff first`);
  if (!(handoff.powers || []).some(p => p.name === power)) throw new Error(`"${power}" is not a power this hand-off approved`);
  if (verb !== undefined) verbCall(verb);
  if (entry !== undefined) parseEntry(entry);
  const targets = await approvedTargets(projectDir, { run, power, cfg });
  const rows = [];
  for (const spec of reach) {
    const m = /^([a-z]+:[^@=]+?)(?:@([^=]+))?=([^=:]+)::(.+)$/.exec(String(spec));
    if (!m) throw new Error(`--reach needs <surface id>[@<at>]=<test file>::<command>, got "${spec}"`);
    const [surface, at, test, command] = m.slice(1).map(x => x?.trim());
    if (!targets.some(t => t.surface === surface && !isWorkflow(t))) throw new Error(`${power} has no approved target on ${surface} (its targets: ${targets.map(t => t.surface ?? t.workflow).join(', ') || 'none'})`);
    const testPath = posix(path.normalize(test));
    if (testPath.startsWith('../') || path.isAbsolute(testPath)) throw new Error(`reach test "${test}" is outside the project`);
    try { await fs.stat(path.join(projectDir, testPath)); } catch { throw new Error(`reach test "${testPath}" does not exist`); }
    rows.push({ surface, at: at || null, test: testPath, command });
  }
  const doc = await readIntegration(projectDir, { run, cfg }).catch(err => { if (force) return { run, powers: {} }; throw err; });
  const had = force ? {} : (doc.powers?.[power] || {});
  const merged = {
    verb: verb ?? had.verb ?? null,
    entry: entry ?? had.entry ?? null,
    reach: [...(had.reach || []).filter(r => !rows.some(n => n.surface === r.surface && n.at === r.at)), ...rows]
  };
  await writeJson(path.join(dir, 'integration.json'), { run, ts: now().toISOString(), powers: { ...(doc.powers || {}), [power]: merged } });
  return { run, power, ...merged, targets: targets.length };
}

/** One power's wiring now, from integration.json; `verbs` overrides its verb. */
async function powerWiring(projectDir, { run, name, integration, verbs, cfg, runTests }) {
  const rec = integration.powers?.[name] || {};
  const verb = verbs[name] ?? rec.verb ?? null;
  const entry = rec.entry ?? null;
  const targets = await approvedTargets(projectDir, { run, power: name, cfg });
  const checked = await wiredTargets(projectDir, { verb, entry, reach: rec.reach, targets, run: runTests });
  return { name, verb, entry, wired: checked.length > 0 && checked.every(t => t.wired), targets: checked };
}

/** Measure one power for its marathon line wired_<slug>: the number of wired targets (reach tests are run). */
export async function measureWired(projectDir, { run, power, verb, cfg = DEFAULT_CONFIG }) {
  const integration = await readIntegration(projectDir, { run, cfg });
  const w = await powerWiring(projectDir, { run, name: power, integration, verbs: verb ? { [power]: verb } : {}, cfg, runTests: true });
  return { ...w, value: w.targets.filter(t => t.wired).length, of: w.targets.length };
}

const OWNER_TEXT = /^named by the owner/;
const whereOf = (t) => (t.kind === 'workflow'
  ? `\`/${t.workflow}\` · ${t.step ?? 'step not picked'}`
  : `${t.reach && !OWNER_TEXT.test(t.reach) ? t.reach : t.surface} (\`${t.surface}\`${t.at ? ` · ${t.at}` : ''})`);

/**
 * Write <bbs run>/delivered.md for every power the hand-off approved (rebuild/use). `verbs` maps power → verb and
 * overrides integration.json. Returns { file, all_wired, powers: [{ name, verb, wired, targets }] }.
 */
export async function writeDelivered(projectDir, { run, verbs = {}, cfg = DEFAULT_CONFIG, now = () => new Date(), runTests = true }) {
  const dir = runDirOf(projectDir, run, cfg);
  const handoff = await readJson(path.join(dir, 'handoff.json'));
  if (!handoff) throw new Error(`run ${run} has no handoff.json — run cli.js handoff first`);
  const powers = (await readJson(path.join(dir, 'powers.json')))?.powers || [];
  const what = new Map(powers.map(p => [p.name, String(p.what ?? '').replace(/\s+/g, ' ').trim()]));
  for (const name of Object.keys(verbs)) {
    if (!(handoff.powers || []).some(p => p.name === name)) throw new Error(`"${name}" is not a power this hand-off approved`);
  }
  const integration = await readIntegration(projectDir, { run, cfg });
  const rows = [];
  for (const p of handoff.powers || []) rows.push(await powerWiring(projectDir, { run, name: p.name, integration, verbs, cfg, runTests }));
  const md = [`# What you got — bbs run ${run}`, '', `Written ${now().toISOString()}. Every power below was built from ${handoff.source?.ref ? 'the source this run audited' : 'this run'} and wired into the places you approved at the verdict.`, ''];
  for (const r of rows) {
    md.push(`## ${r.name}${r.wired ? '' : ' — NOT fully wired'}`, '');
    if (what.get(r.name)) md.push(what.get(r.name), '');
    md.push('Where it runs now:');
    for (const t of r.targets) {
      const tail = t.wired ? (t.test ? ` — proved by \`${t.test}\`` : '') : ` — ${t.why}`;
      md.push(`- ${t.wired ? '✓' : '✗'} ${whereOf(t)} · ${t.mode}${tail}`);
    }
    if (!r.targets.length) md.push('- (no approved target)');
    let byHand = 'Run it by hand: (no verb recorded)';
    if (r.verb) byHand = `Run it by hand: \`node .claude/helpers/kit/cli.js ${r.verb} …\` (its flags: \`node .claude/helpers/kit/cli.js help\`)`;
    else if (r.entry) {
      const e = parseEntry(r.entry);
      byHand = `Use it in code: ${e.module ? `\`import { ${e.symbol ?? '…'} } from './${e.module}'\`` : `\`${e.symbol}(…)\``}`;
    }
    md.push('', byHand, '');
  }
  const file = path.join(dir, 'delivered.md');
  await writeTextAtomic(file, md.join('\n'));
  const label = (t) => `${t.wired ? 'wired' : 'NOT wired'}: ${t.kind === 'workflow' ? t.workflow : t.surface} · ${t.at ?? 'any step'}`;
  return {
    file: posix(path.relative(projectDir, file)),
    all_wired: rows.length > 0 && rows.every(r => r.wired),
    powers: rows.map(r => ({ name: r.name, verb: r.verb, ...(r.entry ? { entry: r.entry } : {}), wired: r.wired, targets: r.targets.map(label) }))
  };
}
