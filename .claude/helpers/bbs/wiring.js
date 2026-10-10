/**
 * bbs wiring — is a built power actually wired into the workflows it was approved to land in, and does the owner know?
 *
 * A target is wired when its workflow's installed command file runs the power's verb (`kit/cli.js <verb>`, inline code
 * or a fenced block) inside the approved step: from that step's heading to the next heading of the same or a higher
 * level. A target whose step was left for the integration stream to pick (step null) is wired when the verb is run
 * anywhere in the file. Nothing else counts: a doc, a note, a review, a run folder or another kit module that names the
 * verb is not a caller.
 *
 * `delivered` writes the hand-over note — the keys: per approved power, what it does, where it now runs, and the
 * command to run it by hand.
 */

import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, readJson, writeTextAtomic } from './store.js';
import { installedWorkflows } from './usage.js';
import { normalizeStep, standingTargets } from './targets.js';

const VERB = /^[a-z0-9][a-z0-9-]{0,63}$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern a wired step must contain: the kit CLI run with this verb. */
export function verbCall(verb) {
  if (typeof verb !== 'string' || !VERB.test(verb)) throw new Error(`verb must be lower-case letters, digits and dashes, got ${JSON.stringify(verb)}`);
  return new RegExp(`(?:^|[\\s\`'"(/])(?:\\.claude/helpers/)?kit/cli\\.js\\s+${esc(verb)}(?![\\w-])`, 'm');
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

/**
 * For each target, whether it is wired. Returns [{ workflow, step, mode, file, wired, why }]; `why` says what is
 * missing when it is not.
 */
export async function wiredTargets(projectDir, { verb, targets }) {
  const call = verbCall(verb);
  const installed = await installedWorkflows(projectDir);
  const out = [];
  for (const t of targets || []) {
    const row = { workflow: t.workflow, step: t.step ?? null, mode: t.mode, file: installed.get(t.workflow)?.file ?? null, wired: false, why: null };
    if (!row.file) { row.why = 'the workflow is not installed'; out.push(row); continue; }
    let text;
    try { text = await fs.readFile(path.join(projectDir, row.file), 'utf-8'); } catch { row.why = 'the command file is unreadable'; out.push(row); continue; }
    const scope = row.step === null ? text : stepSection(text, row.step);
    if (scope === null) row.why = `the step "${row.step}" is no longer a heading of ${row.file}`;
    else if (!call.test(scope)) row.why = `${row.step === null ? row.file : `"${row.step}"`} never runs kit/cli.js ${verb}`;
    else row.wired = true;
    out.push(row);
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

/**
 * Write <bbs run>/delivered.md for every power the hand-off approved (rebuild/use). `verbs` maps power → verb.
 * Returns { file, all_wired, powers: [{ name, verb, wired, targets }] }. A power with no verb recorded is not wired.
 */
export async function writeDelivered(projectDir, { run, verbs = {}, cfg = DEFAULT_CONFIG, now = () => new Date() }) {
  const dir = runDirOf(projectDir, run, cfg);
  const handoff = await readJson(path.join(dir, 'handoff.json'));
  if (!handoff) throw new Error(`run ${run} has no handoff.json — run cli.js handoff first`);
  const powers = (await readJson(path.join(dir, 'powers.json')))?.powers || [];
  const what = new Map(powers.map(p => [p.name, String(p.what ?? '').replace(/\s+/g, ' ').trim()]));
  for (const name of Object.keys(verbs)) {
    if (!(handoff.powers || []).some(p => p.name === name)) throw new Error(`"${name}" is not a power this hand-off approved`);
  }
  const rows = [];
  for (const p of handoff.powers || []) {
    const verb = verbs[p.name] ?? null;
    const targets = await approvedTargets(projectDir, { run, power: p.name, cfg });
    const checked = verb ? await wiredTargets(projectDir, { verb, targets }) : targets.map(t => ({ ...t, wired: false, why: 'no verb recorded for this power' }));
    rows.push({ name: p.name, verb, wired: checked.length > 0 && checked.every(t => t.wired), targets: checked });
  }
  const md = [`# What you got — bbs run ${run}`, '', `Written ${now().toISOString()}. Every power below was built from ${handoff.source?.ref ? 'the source this run audited' : 'this run'} and wired into the workflows you approved at the verdict.`, ''];
  for (const r of rows) {
    md.push(`## ${r.name}${r.wired ? '' : ' — NOT fully wired'}`, '');
    if (what.get(r.name)) md.push(what.get(r.name), '');
    md.push('Where it runs now:');
    for (const t of r.targets) md.push(`- ${t.wired ? '✓' : '✗'} \`/${t.workflow}\` · ${t.step ?? 'step not picked'} · ${t.mode}${t.wired ? '' : ` — ${t.why}`}`);
    if (!r.targets.length) md.push('- (no approved target)');
    md.push('', r.verb ? `Run it by hand: \`node .claude/helpers/kit/cli.js ${r.verb} …\` (its flags: \`node .claude/helpers/kit/cli.js help\`)` : 'Run it by hand: (no verb recorded)', '');
  }
  const file = path.join(dir, 'delivered.md');
  await writeTextAtomic(file, md.join('\n'));
  return { file: path.relative(projectDir, file).split(path.sep).join('/'), all_wired: rows.length > 0 && rows.every(r => r.wired), powers: rows.map(r => ({ name: r.name, verb: r.verb, wired: r.wired, targets: r.targets.map(t => `${t.wired ? 'wired' : 'NOT wired'}: ${t.workflow} · ${t.step ?? 'any step'}`) })) };
}
