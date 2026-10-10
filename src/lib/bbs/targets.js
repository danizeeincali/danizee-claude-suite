/**
 * bbs targets — where each power lands, decided before anything is built.
 *
 * A power lands on a surface of the owner's project (surfaces.js): a UI page, an API endpoint, a job, a model step,
 * a CLI command, a feature flag, the library entry, or a Claude Code workflow. A target is
 *   { kind, surface, file, at, reach, how, mode, by }
 * — the surface id (`<kind>:<file>`), the anchor in it (a route, an endpoint, a function, a heading), how a user gets
 * there in one line ("Settings › Security", "POST /api/scan", "/pt › Phase 2"), what that place does with the power,
 * and whether it is advisory or blocking. Workflow targets also keep { workflow, step } and are checked against the
 * workflows the owner runs (usage.json). The verdict approves verdicts and targets together; a `rebuild` or `use`
 * with no standing target is refused (verdict.js): a power no user can reach is a car with no keys.
 *
 * targets.json: { run, ts, usage_evidence, targets: { "<power>": [target, ...] } }. `[]` is legal (the power lands
 * nowhere); it can then only be skipped or bought.
 */

import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, readJson, writeJson } from './store.js';
import { parseJsonOnly } from './inventory.js';
import { installedWorkflows, resolveName, usageLines } from './usage.js';
import { KINDS, allSurfaces, surfaceLines, ownerSurface } from './surfaces.js';

export const MODES = ['advisory', 'blocking'];
export const HOW_MAX_CHARS = 240;
export const OWNER_HOW = 'named by the owner at the verdict: the integration stream picks the step';
export const OWNER_REACH = 'named by the owner at the verdict: the integration stream writes how a user gets there';
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

export { normalizeStep, stepHeadings, matchStep } from './steps.js';
import { normalizeStep, stepHeadings, matchStep } from './steps.js';

async function loadRun(projectDir, run, cfg) {
  const dir = runDirOf(projectDir, run, cfg);
  const powers = await readJson(path.join(dir, 'powers.json'));
  if (!powers) throw new Error('no powers.json yet — run cli.js inventory first');
  const usage = await readJson(path.join(dir, 'usage.json'));
  if (!usage) throw new Error('no usage.json yet — run cli.js usage first: where a power lands depends on the workflows the owner runs');
  let surfaces;
  try { surfaces = await readJson(path.join(dir, 'surfaces.json')); } catch (err) { throw new Error(`${err.message} — run cli.js surfaces --force to rescan and replace it`); }
  if (!surfaces) throw new Error('no surfaces.json yet — run cli.js surfaces first: a power lands where a user meets it, found in the code');
  return { dir, names: (powers.powers || []).map(p => p.name), powers: powers.powers || [], usage, surfaces };
}

/**
 * A power the owner approved to build (rebuild/use) was approved with its landings: changing them afterwards needs
 * --force, so the recorded approval never silently stops matching where the power lands.
 */
async function refuseApproved(dir, powers, force) {
  if (force) return;
  let vj;
  try { vj = await readJson(path.join(dir, 'verdicts.json')); } catch { return; } // a corrupt verdicts.json is the verdict verb's to repair
  const approved = powers.filter(n => vj?.decisions?.[n] === 'rebuild' || vj?.decisions?.[n] === 'use');
  if (approved.length) throw new Error(`${approved.join(', ')} ${approved.length > 1 ? 'were' : 'was'} approved to build with ${approved.length > 1 ? 'their' : 'its'} current targets — pass --force to change where ${approved.length > 1 ? 'they land' : 'it lands'} after approval`);
}

/** The helper brief: the powers, the owner's workflows with their step headings, and the JSON shape. */
export async function targetsBrief(projectDir, { run, cfg = DEFAULT_CONFIG }) {
  const { powers, usage, surfaces } = await loadRun(projectDir, run, cfg);
  const lines = [
    '# Targets brief — where each power lands',
    '',
    'Building a power is not the deliverable; a user using it is. For every power below, name the places in this',
    'project where a user will meet it: the surface (from the lists below), the anchor in it, how a user gets there,',
    'one line on what that place does with the power, and whether it is advisory (reports, the flow goes on) or',
    'blocking (stops the flow). Match the power to the surface it serves: a power a person sees belongs on a ui page;',
    'one a client calls on an api endpoint; background work on a job; a model or prompt power on the model step;',
    'a developer tool on a cli command or a Claude Code workflow; a switchable behaviour behind a feature flag; a',
    'reusable building block on the lib entry. Pick only surfaces listed (or a workflow the owner runs). A power that',
    'fits none gets [] — say nothing else about it. Two or three good targets beat six weak ones.',
    '',
    '## Powers',
    ...powers.map(p => `- ${p.name}: ${String(p.summary ?? p.what ?? p.description ?? '').replace(/\s+/g, ' ').slice(0, 300)}`),
    '',
    `## Surfaces in this project (${surfaces.scanned ?? 0} files scanned)`,
    ...surfaceLines({ ...surfaces, surfaces: (surfaces.surfaces || []).filter(x => x.kind !== 'workflow') }),
    '',
    `## Workflows the owner runs (evidence: ${usage.evidence})`,
    ...usageLines(usage)
  ];
  // No evidence: every installed workflow is listed, unverified. The verdict question then asks the owner which they
  // use, and a decision keeps only the targets in their answer.
  const listed = usage.evidence === 'none'
    ? [...(await installedWorkflows(projectDir)).entries()].filter(([, v]) => !v.aliasOf).map(([name, v]) => ({ name, file: v.file }))
    : usage.workflows;
  if (usage.evidence === 'none') lines.push('', 'No evidence: every installed workflow is listed below. The owner confirms which they use at the verdict.');
  {
    for (const w of listed) {
      const heads = await stepHeadings(projectDir, w.file);
      lines.push('', `### ${w.name} — steps`, ...(heads.length ? heads.map(h => `- ${h}`) : ['- (no headings: use the whole workflow name as the step)']));
    }
  }
  lines.push('',
    '## Answer — JSON only',
    '```json',
    '{ "<power>": [',
    '  { "surface": "<kind>:<file> from the list>", "at": "<one of its at: values>", "reach": "<how a user gets there>", "how": "<one line>", "mode": "advisory" },',
    '  { "workflow": "<name from the list>", "step": "<a heading above>", "how": "<one line>", "mode": "advisory" }',
    '] }',
    '```',
    'A workflow the owner has not used is refused unless the row adds "unused_reason": "<why it still belongs there>".');
  return lines.join('\n');
}

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clean = (v) => String(v).replace(CONTROL, '').replace(/\s+/g, ' ').trim();

/** Validate one proposed target row; returns the stored row or throws naming the power and the field. */
async function checkTarget(projectDir, power, row, ctx) {
  if (!plain(row)) throw new Error(`${power}: each target must be an object { surface, at, reach, how, mode } or { workflow, step, how, mode }`);
  if (row.surface !== undefined && !(typeof row.surface === 'string' && row.surface.startsWith('workflow:'))) return checkSurfaceTarget(power, row, ctx);
  if (row.workflow === undefined && typeof row.surface === 'string') {
    // a workflow named by its surface id: the same row as { workflow, step }
    const file = row.surface.slice('workflow:'.length);
    const name = [...ctx.installed.entries()].find(([, v]) => v.file === file && !v.aliasOf)?.[0];
    if (!name) throw new Error(`${power}: "${row.surface}" is not an installed workflow`);
    row = { ...row, workflow: name, step: row.step ?? row.at };
  }
  return checkWorkflowTarget(projectDir, power, row, ctx);
}

/** Check the one-line text fields every target carries. */
function checkLines(power, where, row) {
  if (typeof row.how !== 'string' || !clean(row.how)) throw new Error(`${power}: ${where} needs "how" — one line on what that place does with the power`);
  if (clean(row.how).length > HOW_MAX_CHARS) throw new Error(`${power}: "how" must be one line (at most ${HOW_MAX_CHARS} characters)`);
  if (!MODES.includes(row.mode)) throw new Error(`${power}: "mode" must be ${MODES.join(' or ')}, got ${JSON.stringify(row.mode)}`);
}

/** A target on a code surface: the surface must be one found in the project (or named by the owner), `at` one of its anchors. */
async function checkSurfaceTarget(power, row, { surfaceById }) {
  const s = surfaceById.get(typeof row.surface === 'string' ? row.surface.trim() : '');
  if (!s) throw new Error(`${power}: "${row.surface}" is not a surface of this project (ids are <kind>:<file> from cli.js surfaces; the owner adds their own with cli.js surfaces --add)`);
  if (typeof row.at !== 'string' || !clean(row.at)) throw new Error(`${power}: ${s.id} needs "at" — ${s.anchors.length ? `one of ${s.anchors.slice(0, 8).map(a => JSON.stringify(a)).join(', ')}` : 'where in the file it lands'}`);
  let at = clean(row.at);
  if (s.anchors.length) {
    const hit = s.anchors.find(a => a === at) ?? s.anchors.find(a => a.toLowerCase() === at.toLowerCase());
    if (!hit) throw new Error(`${power}: "${at}" is not an anchor of ${s.id} (its anchors: ${s.anchors.slice(0, 8).map(a => JSON.stringify(a)).join(', ')})`);
    at = hit;
  }
  if (typeof row.reach !== 'string' || !clean(row.reach)) throw new Error(`${power}: ${s.id} needs "reach" — one line on how a user gets there`);
  if (clean(row.reach).length > HOW_MAX_CHARS) throw new Error(`${power}: "reach" must be one line (at most ${HOW_MAX_CHARS} characters)`);
  checkLines(power, s.id, row);
  return { kind: s.kind, surface: s.id, file: s.file, at, reach: clean(row.reach), how: clean(row.how), mode: row.mode, by: 'proposed' };
}

async function checkWorkflowTarget(projectDir, power, row, { installed, used, unverified, headingsOf }) {
  const { workflow: w, via } = resolveName(row.workflow ?? '', installed);
  if (!w) throw new Error(`${power}: "${row.workflow}" is not an installed workflow${via ? '' : ' name'}`);
  if (!used.has(w) && !(typeof row.unused_reason === 'string' && clean(row.unused_reason))) {
    throw new Error(`${power}: the owner has not used ${w} — pick a workflow they run, or add "unused_reason"`);
  }
  if (typeof row.step !== 'string' || !clean(row.step)) throw new Error(`${power}: ${w} needs a "step" (a heading of ${installed.get(w).file})`);
  const heads = await headingsOf(w);
  let step;
  try { step = heads.length ? matchStep(row.step, heads) : clean(row.step); } catch (err) { throw new Error(`${power}: ${w} step ${err.message}`); }
  if (!step) throw new Error(`${power}: "${clean(row.step)}" is not a step of ${w} (headings of ${installed.get(w).file})`);
  checkLines(power, w, row);
  const file = installed.get(w).file;
  const out = { kind: 'workflow', surface: `workflow:${file}`, file, at: step, reach: `/${w} › ${step}`, workflow: w, step, how: clean(row.how), mode: row.mode, by: 'proposed' };
  if (unverified) out.unverified = true;
  if (!used.has(w)) out.unused_reason = clean(row.unused_reason);
  return out;
}

function context(projectDir, installed, usage, surfaces) {
  const cache = new Map();
  return {
    installed,
    surfaceById: new Map(allSurfaces(surfaces).filter(x => x.kind !== 'workflow').map(x => [x.id, x])),
    // no evidence: any installed workflow may be proposed, marked unverified until the owner names theirs
    used: new Set(usage.evidence === 'none' ? [...installed.keys()] : usage.workflows.map(w => w.name)),
    unverified: usage.evidence === 'none',
    headingsOf: async (w) => {
      if (!cache.has(w)) cache.set(w, await stepHeadings(projectDir, installed.get(w).file));
      return cache.get(w);
    }
  };
}

/**
 * Record proposed targets ({ power: [rows] }). Rows for a power replace that power's earlier rows; powers not named
 * keep theirs. `force` starts from empty. Returns { recorded, remaining, no_target, next }.
 */
export async function recordTargets(projectDir, { run, input, force = false, now = () => new Date(), cfg = DEFAULT_CONFIG, label = 'targets' }) {
  const { dir, names, usage, surfaces } = await loadRun(projectDir, run, cfg);
  const parsed = parseJsonOnly(input, { label });
  if (!plain(parsed) || !Object.keys(parsed).length) throw new Error(`JSON only — ${label} must be an object of power → [targets]`);
  const installed = await installedWorkflows(projectDir);
  const ctx = context(projectDir, installed, usage, surfaces);
  const file = path.join(dir, 'targets.json');
  await refuseApproved(dir, Object.keys(parsed), force);
  const prior = force ? null : await readPrior(file);
  const targets = { ...(prior?.targets || {}) };
  for (const [power, rows] of Object.entries(parsed)) {
    if (!names.includes(power)) throw new Error(`unknown power "${power}"`);
    if (!Array.isArray(rows)) throw new Error(`${power}: expected a list of targets ([] when it lands nowhere)`);
    const out = [];
    for (const row of rows) {
      const t = await checkTarget(projectDir, power, row, ctx);
      if (out.some(o => o.surface === t.surface && o.at === t.at)) throw new Error(`${power}: ${t.workflow ?? t.surface} · ${t.at} is named twice`);
      out.push(t);
    }
    targets[power] = out;
  }
  return save(file, { run, names, usage, targets, now });
}

/**
 * The owner's word from the verdict answer: `<power>@<workflow>[,<workflow>]` sets that power's workflows. A workflow
 * the power already targets keeps its step; a new one is stored with step null, for the integration stream to pick.
 * The owner may name any installed workflow, used or not. An empty list (`<power>@`) means it lands nowhere.
 */
export async function setOwnerTargets(projectDir, { run, set, force = false, now = () => new Date(), cfg = DEFAULT_CONFIG }) {
  const { dir, names, usage } = await loadRun(projectDir, run, cfg);
  const at = String(set).indexOf('@');
  if (at <= 0) throw new Error(`--set needs <power>@<where>[,<where>] (a workflow, or <kind>:<file>[#<anchor>]), got "${set}"`);
  const power = set.slice(0, at);
  if (!names.includes(power)) throw new Error(`unknown power "${power}"`);
  await refuseApproved(dir, [power], force);
  const installed = await installedWorkflows(projectDir);
  const file = path.join(dir, 'targets.json');
  const prior = await readPrior(file);
  const targets = { ...(prior?.targets || {}) };
  const had = targets[power] || [];
  const out = [];
  for (const raw of set.slice(at + 1).split(',').map(s => s.trim()).filter(Boolean)) {
    const kind = raw.slice(0, raw.indexOf(':'));
    if (KINDS.includes(kind) && kind !== 'workflow' && !installed.has(raw)) {
      // a code surface: <kind>:<file>[#<anchor>]; the file must exist; with no anchor the integration stream picks one
      const s = await ownerSurface(projectDir, raw).catch(err => { throw new Error(`${power}: ${err.message}`); });
      const anchor = s.anchors[0] ?? null;
      if (out.some(o => o.surface === s.id && o.at === anchor)) continue;
      const kept = had.filter(t => t.surface === s.id && (anchor === null || t.at === anchor));
      if (kept.length) out.push(...kept.map(t => ({ ...t, by: 'owner' })));
      else out.push({ kind: s.kind, surface: s.id, file: s.file, at: anchor, reach: OWNER_REACH, how: OWNER_HOW, mode: 'advisory', by: 'owner' });
      continue;
    }
    const { workflow: w } = resolveName(kind === 'workflow' ? raw.slice('workflow:'.length) : raw, installed);
    if (!w) throw new Error(`${power}: "${raw}" is not an installed workflow, nor a <kind>:<file> surface (kinds: ${KINDS.filter(k => k !== 'workflow').join('|')})`);
    if (out.some(o => o.workflow === w)) continue;
    const kept = had.filter(t => t.workflow === w);
    if (kept.length) out.push(...kept.map(t => ({ ...t, by: 'owner' })));
    else {
      const wf = installed.get(w).file;
      out.push({ kind: 'workflow', surface: `workflow:${wf}`, file: wf, at: null, reach: `/${w}`, workflow: w, step: null, how: OWNER_HOW, mode: 'advisory', by: 'owner' });
    }
  }
  targets[power] = out;
  return save(file, { run, names, usage, targets, now });
}

/** targets.json as recorded; a corrupt file names its repair. */
async function readPrior(file) {
  try { return await readJson(file); } catch (err) { throw new Error(`${err.message} — run cli.js targets --force --from <file> to replace it`); }
}

async function save(file, { run, names, usage, targets, now }) {
  const ordered = Object.fromEntries(names.filter(n => Object.hasOwn(targets, n)).map(n => [n, targets[n]]));
  await writeJson(file, { run, ts: now().toISOString(), usage_evidence: usage.evidence, targets: ordered });
  const remaining = names.filter(n => !Object.hasOwn(ordered, n));
  return {
    runId: run,
    recorded: Object.keys(ordered).length,
    remaining,
    no_target: names.filter(n => Object.hasOwn(ordered, n) && !ordered[n].length),
    targets: Object.fromEntries(Object.entries(ordered).map(([n, ts]) => [n, ts.map(t => isWorkflow(t) ? `${t.workflow} · ${t.step ?? '(step to pick)'} · ${t.mode}` : `${t.surface} · ${t.at ?? '(place to pick)'} · ${t.mode}`)]))
  };
}

/**
 * The targets a decision can stand on. A code-surface target stands: it was checked against the project's own code
 * (or named by the owner). A workflow target stands when the owner named it, it carries an unused_reason, or its
 * workflow is one the owner runs according to the current usage.json; with no evidence of use, a proposed workflow
 * target does not stand until the owner names their workflows.
 */
export function standingTargets(list, usage) {
  if (!Array.isArray(list)) return [];
  const used = new Set(!usage || usage.evidence === 'none' ? [] : (usage.workflows || []).map(w => w.name));
  return list.filter(t => !isWorkflow(t) || t.by === 'owner' || (typeof t.unused_reason === 'string' && t.unused_reason) || used.has(t.workflow));
}

/** A workflow target (rows written before surfaces carry only { workflow, step }). */
export const isWorkflow = (t) => t?.kind === 'workflow' || (t?.kind === undefined && typeof t?.workflow === 'string');

/** Why a power has no standing target, for the table and the refusal: null when it has one. */
export function noLandingWhy(list, usage) {
  if (standingTargets(list, usage).length) return null;
  if (!Array.isArray(list)) return 'no targets proposed';
  if (!list.length) return 'its targets are empty: it lands nowhere';
  if (!usage || usage.evidence === 'none') return 'its workflow targets are unverified: the owner has not named the workflows they use (workflows=a,b)';
  return 'none of its targets is a workflow the owner runs';
}

/** Every power has a targets entry (possibly []). */
export const targetsComplete = (targets, names) => !!targets && names.every(n => Array.isArray(targets.targets?.[n]));

/** The Lands-in cell for the verdict table. */
export function landsIn(list) {
  if (!Array.isArray(list)) return 'not proposed';
  if (!list.length) return 'nowhere';
  return list.map(targetLabel).join('; ');
}

/** One target as `where · at · mode`: a workflow by name, a code surface by its id. */
export function targetLabel(t) {
  const where = isWorkflow(t) ? t.workflow : t.surface;
  const at = (isWorkflow(t) ? t.step : t.at) ?? (isWorkflow(t) ? 'step to pick' : 'place to pick');
  return `${where} · ${at} · ${t.mode}${t.unverified ? ' (unverified)' : ''}`;
}
