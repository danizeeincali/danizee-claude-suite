/**
 * bbs targets — where each power lands in the owner's workflows, decided before anything is built.
 *
 * A target is { workflow, step, how, mode, by }: the installed workflow (from usage.json, or named by the owner),
 * the step heading in that workflow's command file the power changes, one line saying what that step does with it,
 * and whether it is advisory or blocking. The verdict approves verdicts and targets together; a `rebuild` or `use`
 * with no target is refused (verdict.js), because a power nobody's workflow runs is a car with no keys.
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

export const MODES = ['advisory', 'blocking'];
export const HOW_MAX_CHARS = 240;
export const OWNER_HOW = 'named by the owner at the verdict: the integration stream picks the step';
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

export { normalizeStep, stepHeadings, matchStep } from './steps.js';
import { normalizeStep, stepHeadings, matchStep } from './steps.js';

async function loadRun(projectDir, run, cfg) {
  const dir = runDirOf(projectDir, run, cfg);
  const powers = await readJson(path.join(dir, 'powers.json'));
  if (!powers) throw new Error('no powers.json yet — run cli.js inventory first');
  const usage = await readJson(path.join(dir, 'usage.json'));
  if (!usage) throw new Error('no usage.json yet — run cli.js usage first: where a power lands depends on the workflows the owner runs');
  return { dir, names: (powers.powers || []).map(p => p.name), powers: powers.powers || [], usage };
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
  const { powers, usage } = await loadRun(projectDir, run, cfg);
  const lines = [
    '# Targets brief — where each power lands',
    '',
    'For every power below, name the workflows the owner actually runs (listed under "Workflows") where the power',
    'should be used, the exact step heading it changes, one line on what that step does with it, and whether the',
    'step is advisory (reports, the workflow goes on) or blocking (stops the workflow).',
    'Pick only from the workflows listed. A power that fits none of them gets [] — say nothing else about it.',
    'Prefer the workflows the owner runs most. Two or three good targets beat six weak ones.',
    '',
    '## Powers',
    ...powers.map(p => `- ${p.name}: ${String(p.summary ?? p.what ?? p.description ?? '').replace(/\s+/g, ' ').slice(0, 300)}`),
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
    '{ "<power>": [ { "workflow": "<name from the list>", "step": "<a heading above>", "how": "<one line>", "mode": "advisory" } ] }',
    '```',
    'A workflow the owner has not used is refused unless the row adds "unused_reason": "<why it still belongs there>".');
  return lines.join('\n');
}

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clean = (v) => String(v).replace(CONTROL, '').replace(/\s+/g, ' ').trim();

/** Validate one proposed target row; returns the stored row or throws naming the power and the field. */
async function checkTarget(projectDir, power, row, { installed, used, unverified, headingsOf }) {
  if (!plain(row)) throw new Error(`${power}: each target must be an object { workflow, step, how, mode }`);
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
  if (typeof row.how !== 'string' || !clean(row.how)) throw new Error(`${power}: ${w} needs "how" — one line on what the step does with the power`);
  if (clean(row.how).length > HOW_MAX_CHARS) throw new Error(`${power}: "how" must be one line (at most ${HOW_MAX_CHARS} characters)`);
  if (!MODES.includes(row.mode)) throw new Error(`${power}: "mode" must be ${MODES.join(' or ')}, got ${JSON.stringify(row.mode)}`);
  const out = { workflow: w, step, how: clean(row.how), mode: row.mode, by: 'proposed' };
  if (unverified) out.unverified = true;
  if (!used.has(w)) out.unused_reason = clean(row.unused_reason);
  return out;
}

function context(projectDir, installed, usage) {
  const cache = new Map();
  return {
    installed,
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
  const { dir, names, usage } = await loadRun(projectDir, run, cfg);
  const parsed = parseJsonOnly(input, { label });
  if (!plain(parsed) || !Object.keys(parsed).length) throw new Error(`JSON only — ${label} must be an object of power → [targets]`);
  const installed = await installedWorkflows(projectDir);
  const ctx = context(projectDir, installed, usage);
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
      if (out.some(o => o.workflow === t.workflow && o.step === t.step)) throw new Error(`${power}: ${t.workflow} · ${t.step} is named twice`);
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
  if (at <= 0) throw new Error(`--set needs <power>@<workflow>[,<workflow>], got "${set}"`);
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
    const { workflow: w } = resolveName(raw, installed);
    if (!w) throw new Error(`${power}: "${raw}" is not an installed workflow`);
    if (out.some(o => o.workflow === w)) continue;
    const kept = had.filter(t => t.workflow === w);
    if (kept.length) out.push(...kept.map(t => ({ ...t, by: 'owner' })));
    else out.push({ workflow: w, step: null, how: OWNER_HOW, mode: 'advisory', by: 'owner' });
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
    targets: Object.fromEntries(Object.entries(ordered).map(([n, ts]) => [n, ts.map(t => `${t.workflow} · ${t.step ?? '(step to pick)'} · ${t.mode}`)]))
  };
}

/**
 * The targets a decision can stand on: the owner named it, it carries an unused_reason, or its workflow is one the
 * owner runs according to the current usage.json. With no evidence of use, nothing proposed stands.
 */
export function standingTargets(list, usage) {
  if (!Array.isArray(list) || !usage) return [];
  const used = new Set(usage.evidence === 'none' ? [] : (usage.workflows || []).map(w => w.name));
  return list.filter(t => t.by === 'owner' || (typeof t.unused_reason === 'string' && t.unused_reason) || used.has(t.workflow));
}

/** Every power has a targets entry (possibly []). */
export const targetsComplete = (targets, names) => !!targets && names.every(n => Array.isArray(targets.targets?.[n]));

/** The Lands-in cell for the verdict table. */
export function landsIn(list) {
  if (!Array.isArray(list)) return 'not proposed';
  if (!list.length) return 'nowhere';
  return list.map(t => `${t.workflow} · ${t.step ?? 'step to pick'} · ${t.mode}`).join('; ');
}
