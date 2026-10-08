/**
 * bbs handoff — approved powers become marathon streams with finish lines and briefs.
 * Refused unless every power in powers.json has a decision in verdicts.json and verdicts.json was computed from the
 * current powers.json (powers_ts). Approved powers: one brief per rebuild/use in <bbs run>/briefs/, one memo per buy in
 * <bbs run>/memos/, skips listed; slug collisions across rebuild, use and buy are refused before anything is written.
 * The finish line (five checks per rebuild/use power plus three standard lines) is written before the build.
 * When marathon=true, `cli.js init bbs-<bbs run id minus its YYYY-MM-DD- prefix>` creates the marathon run; its id and
 * run dir come from init and must sit under the marathon runs dir; a run that already holds a hand-off is refused
 * unless force. Then finish-line.json, kickoff.md (four sections filled in place, plus ## Source) and one queued stream
 * per power (plan = the project-relative brief path) are written; handoff.json is written last.
 * Briefs carry the idea in our words and only location tokens from the evidence — never source code.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { readJson, writeJson, writeTextAtomic, runDir as runDirOf, moveAsideStale, withMapLockDetailed } from './store.js';
import { validateFinishLine } from '../marathon/gate.js';
import { loadConfig as loadMarathonConfig, activeRunId as marathonActiveRun, setActiveRun as setMarathonActiveRun } from '../marathon/config.js';
import { renderStatusSafe } from './status.js';
import { loadConfig } from './config.js';
import { VERDICTS, POWERS_CHANGED } from './verdict.js';
import { redactRef } from './intake.js';

// The five checks per power, written in the finish line before the build
export const CHECKS = ['tests_green', 'egress_zero', 'six_sigma_claim', 'callers_ge_1', 'packaged_check'];

/**
 * Marathon-safe id: lower-case [a-z0-9_-], no runs of multiple - or other chars,
 * trim trailing -, cap 40 chars (trim a trailing - after the cap), 'power' when empty.
 */
export function slugPower(name) {
  if (typeof name !== 'string') return 'power';
  // NFD normalize, remove combining marks, lower-case
  let slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Replace runs of anything outside [a-z0-9_-] with a single dash
  slug = slug.replace(/[^a-z0-9_-]+/g, '-');
  // Collapse multiple dashes
  slug = slug.replace(/--+/g, '-');
  // Trim leading and trailing dashes
  slug = slug.replace(/^-+|-+$/g, '');
  // Cap at 40 chars, trim trailing dash after cap
  slug = slug.slice(0, 40).replace(/-+$/, '');
  // Default to 'power' if empty
  return slug || 'power';
}

/**
 * Extract the base name from a check name (strip _claim, _ge_1, _check suffixes).
 */
function checkIdBase(checkName) {
  return checkName.replace(/_(?:claim|ge_1|check)$/, '');
}

/**
 * Build a finish line with five checks per approved power plus three standard lines.
 * Powers with verdict 'rebuild', 'use', or 'buy' are approved.
 * Returns { tolerance, lines, byPower } where { tolerance, lines } passes validateFinishLine and
 * byPower maps each approved power's name to exactly its own five lines.
 */
export function buildFinishLine(powers, { tolerance }) {
  const limit = (v) => v === null || (Number.isInteger(v) && v >= 0);
  const bad = !tolerance || typeof tolerance !== 'object' ? ['tolerance must be an object'] : [
    ...['high', 'medium', 'low'].filter(k => !limit(tolerance[k])).map(k => `tolerance.${k} must be a non-negative integer or null for unlimited (got ${JSON.stringify(tolerance[k]) ?? 'nothing'})`),
    ...(Number.isInteger(tolerance.passes_in_a_row) && tolerance.passes_in_a_row >= 1 ? [] : [`tolerance.passes_in_a_row must be a positive integer (got ${JSON.stringify(tolerance.passes_in_a_row) ?? 'nothing'})`])
  ];
  if (bad.length) throw new Error(bad.join('; '));

  const approved = Array.isArray(powers) ?
    powers.filter(p => ['rebuild', 'use'].includes(p.verdict)) :
    [];
  const slugs = new Map();
  const lines = [];
  const byPower = {};

  // Build lines for each approved power
  for (const power of approved) {
    const slug = slugPower(power.name);
    if (slugs.has(slug) && slugs.get(slug) !== power.name) {
      throw new Error(`slug collision: "${slugs.get(slug)}" and "${power.name}" both slug to ${slug}`);
    }
    slugs.set(slug, power.name);

    // Five checks per power
    const own = [];
    for (const check of CHECKS) {
      const idBase = checkIdBase(check);
      const id = `${idBase}_${slug}`;

      // Define each check
      let line;
      if (idBase === 'tests_green') {
        line = { id, label: `${slug}: green unit runs in a row`, type: 'number', op: 'at_least', value: 1, owner: 'build', source: 'runs.streak:unit' };
      } else if (idBase === 'egress_zero') {
        line = { id, label: `${slug}: zero egress in the packaged check`, type: 'bool', op: 'is', value: true, owner: 'build', source: `measure:egress_zero_${slug}` };
      } else if (idBase === 'six_sigma') {
        line = { id, label: `${slug}: clean reviews in a row`, type: 'number', op: 'at_least', value: tolerance.passes_in_a_row, owner: 'build', source: 'reviews.streak' };
      } else if (idBase === 'callers') {
        line = { id, label: `${slug}: callers in the harness`, type: 'number', op: 'at_least', value: 1, owner: 'build', source: `measure:callers_${slug}` };
      } else if (idBase === 'packaged') {
        line = { id, label: `${slug}: packaged check passes`, type: 'bool', op: 'is', value: true, owner: 'build', source: `measure:packaged_${slug}` };
      }
      lines.push(line);
      own.push(line);
    }
    byPower[power.name] = own;
  }

  // Add standard lines
  lines.push(
    { id: 'clean_reviews', label: 'Clean reviews in a row', type: 'number', op: 'at_least', value: tolerance.passes_in_a_row, owner: 'build', source: 'reviews.streak' },
    { id: 'latest_high', label: 'High findings in the latest review', type: 'number', op: 'at_most', value: 0, owner: 'build', source: 'reviews.latest.high' },
    { id: 'open_high', label: 'Open high findings', type: 'number', op: 'at_most', value: 0, owner: 'build', source: 'findings.open:high' }
  );

  const errors = validateFinishLine({ tolerance, lines });
  if (errors.length) throw new Error(errors[0]);
  return { tolerance, lines, byPower };
}

const LOCATION = /(?:[\w./-]+\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?)|https?:\/\/\S+/g;

/**
 * The location tokens in an evidence string (path.ext, path.ext:line, path.ext:a-b, http(s) URLs), deduped in order.
 * Nothing else from the string is kept: a brief never carries source code.
 */
export function evidenceLocations(text) {
  if (text == null) return [];
  return [...new Set(String(text).match(LOCATION) || [])];
}

const evidenceBullet = (evidence) => {
  const locs = evidenceLocations(evidence);
  return `- Evidence: ${locs.length ? locs.join(', ') : '(no location given)'}`;
};

const sourceLabel = (source) => `${source.type}${source.ref ? ' ' + redactRef(source.ref) : ''}`;

// Kickoff lines shared by every brief and the marathon kickoff.md
const MAY_DECIDE = [
  '- How to structure the code behind each power\'s interface, within its brief',
  '- Test names, fixtures and file layout'
];
const ASK_BEFORE = [
  '- Adding a dependency',
  '- Any network call, account, purchase or signature',
  '- Changing a finish line'
];
const NEVER = [
  '- Never execute fetched foreign code',
  '- Never copy source code from the source'
];

/**
 * Render a brief for a power (rebuild or use verdict): idea, provenance, judgment, finish line, kickoff lines.
 * ctx: { source, row, lines, decided_at }
 */
export function renderBrief(power, ctx) {
  const { source, row, lines, decided_at } = ctx;
  const slug = slugPower(power.name);

  const md = [];
  md.push(`# ${power.name} — ${row.decision}`);
  md.push('');

  // Idea section
  md.push('## Idea (in our words)');
  md.push(power.idea || '');
  md.push('');

  // Provenance section
  md.push('## Provenance');
  if (source) {
    md.push(`- Source: ${sourceLabel(source)}`);
    // Redact identity to just a prefix if it looks like a git hash (keep 8 chars after git: prefix)
    let ident = source.identity;
    if (ident && ident.startsWith('git:') && ident.length > 11) {
      ident = ident.slice(0, 11); // 'git:' (4) + 7 more chars
    }
    md.push(`- Identity: ${ident}`);
  }
  md.push(`- Licence: ${power.licence} (${row.licence_class})`);
  md.push(`- Verdict: ${row.decision}`);
  if (source && source.run) md.push(`- Run: ${source.run}`);
  md.push(`- Decided: ${decided_at}`);
  md.push(evidenceBullet(power.evidence));
  md.push('');

  // What we have section
  md.push('## What we have');
  const judgment = row.judgment;
  if (judgment) {
    // Extract just the tool basename
    const toolPath = judgment.tool || '';
    const toolName = toolPath.split('/').pop() || toolPath;
    const parts = [judgment.status];
    if (toolName) parts.push(toolName);
    if (judgment.why) parts.push(judgment.why);
    md.push(`${parts.join(' — ')}`);
  }
  md.push('');

  // Finish line section
  md.push('## Finish line (5 checks, written before the build)');
  for (const line of lines) {
    md.push(`- \`${line.id}\`: ${line.label}`);
  }
  md.push('');

  // Kickoff lines section
  md.push('## Kickoff lines');
  md.push('');
  md.push('Done means');
  for (const line of lines) {
    md.push(`- ${power.name}: ${line.label}`);
  }
  md.push('');

  md.push('You may decide on your own');
  md.push(...MAY_DECIDE);
  md.push('');

  md.push('Ask me before');
  md.push(...ASK_BEFORE);
  md.push('');

  md.push('Never');
  md.push(...NEVER);
  if (row.removed && Array.isArray(row.removed)) {
    for (const rem of row.removed) {
      md.push(`- Never execute (${rem.reason})`);
    }
  }
  md.push('');

  // For 'use' verdict, add wrapping rule and probe
  if (row.decision === 'use') {
    md.push('## Wrapping rule');
    md.push('- Behind our interface');
    md.push('- Our tests');
    md.push('- In the sandbox');
    md.push('');
    if (row.probe) {
      md.push(`probe: ${row.probe.result}`);
      md.push('');
    }
  }

  return md.join('\n');
}

/**
 * Render a memo for a power (buy verdict): what it is, why buy (from the licence class and the data it sends off the
 * machine, never the idea text), data, licence, provenance (source ref, run, network, evidence locations).
 * ctx: { source, row }
 */
export function renderMemo(power, ctx) {
  const { row, source } = ctx;

  const why = [];
  if (row.licence_class === 'commercial') {
    why.push(`- The licence is commercial (${power.licence}): rebuilding from it or using it here is not legal, so it is bought, not built.`);
  }
  const data = typeof power.data_needed === 'string' ? power.data_needed.trim() : '';
  if (power.network === 'outbound' && data && data.toLowerCase() !== 'none') {
    why.push(`- It sends data off the machine (${data}): a vendor holds that data whichever way it is run.`);
  }
  if (!why.length) why.push('- Chosen at the verdict step; neither a commercial licence nor outbound data is recorded for it.');

  const md = [];
  md.push(`# ${power.name} — buy memo`);
  md.push('');
  md.push(`## What it is`);
  md.push(power.what || '');
  md.push('');
  md.push('## Why buy');
  md.push(...why);
  md.push('');
  md.push('## Data');
  md.push(power.data_needed || 'none');
  md.push('');
  md.push(`## Licence`);
  md.push(`${power.licence} (${row.licence_class})`);
  md.push('');
  md.push('## Provenance');
  if (source) {
    md.push(`- Source: ${sourceLabel(source)}`);
    if (source.run) md.push(`- Run: ${source.run}`);
  }
  md.push(`- Network: ${power.network || 'none recorded'}`);
  md.push(evidenceBullet(power.evidence));
  md.push('');
  md.push('## Account and signing');
  md.push('- No account was created');
  md.push('- Nothing was signed');
  md.push('');

  return md.join('\n');
}

/** The marathon run id shape this bridge accepts from `cli.js init` (letters, digits and dashes, starting alnum). */
export const MARATHON_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,80}$/;
const HANDOFF_LINE = /^(?:tests_green|egress_zero)_/;
const KICKOFF_SECTIONS = ['Done means', 'You may decide on your own', 'Ask me before', 'Never'];

const posix = (p) => p.split(path.sep).join('/');
const firstLine = (err) => String(err?.stderr || err?.message || err).split('\n')[0];

/** The marathon slug for a bbs run: `bbs-` + the run id with its leading `YYYY-MM-DD-` removed. */
export function marathonSlug(run) {
  return `bbs-${String(run).replace(/^\d{4}-\d{2}-\d{2}-/, '')}`;
}

/**
 * Fill kickoff.md in place: replace the bodies of the four seeded sections, add or replace `## Source` right after
 * `## Never`, keep every other section (title, Budget, Models) as init wrote it. Throws naming a missing section.
 */
export function fillKickoff(text, bodies, file = 'kickoff.md') {
  const blocks = [{ head: null, body: [] }];
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) blocks.push({ head: line.slice(3).trim(), body: [] });
    else blocks[blocks.length - 1].body.push(line);
  }
  for (const name of KICKOFF_SECTIONS) {
    if (!blocks.some(b => b.head === name)) throw new Error(`${file} has no "## ${name}" section — marathon init seeds it; restore it`);
  }
  const out = blocks.filter(b => b.head !== 'Source');
  const neverAt = out.findIndex(b => b.head === 'Never');
  out.splice(neverAt + 1, 0, { head: 'Source', body: [] });
  const md = [];
  for (const b of out) {
    if (b.head === null) { md.push(...b.body); continue; }
    md.push(`## ${b.head}`);
    if (Object.hasOwn(bodies, b.head)) md.push(...bodies[b.head], '');
    else md.push(...b.body);
  }
  return md.join('\n').replace(/\n*$/, '\n');
}

/** Read the example tolerance: default only when the file is absent; a corrupt or tolerance-less file is an error. */
async function loadTolerance(projectDir) {
  const examplePath = path.join(projectDir, '.claude', 'marathon', 'finish-line.example.json');
  const example = await readJson(examplePath); // null when absent; throws `corrupt JSON in <file>` otherwise
  if (example === null) return { tolerance: { high: 0, medium: 2, low: 5, passes_in_a_row: 2 }, from: null };
  if (typeof example !== 'object' || Array.isArray(example) || example.tolerance === undefined) {
    throw new Error(`${examplePath}: tolerance is missing — add { "tolerance": { high, medium, low, passes_in_a_row } } or remove the file`);
  }
  return { tolerance: example.tolerance, from: examplePath };
}

/** Refuse unless verdicts.json was computed from the current powers.json and every power has a decision. */
async function decidedPowers(runDir, verdicts) {
  const powers = await readJson(path.join(runDir, 'powers.json'));
  if (!powers || !Array.isArray(powers.powers)) throw new Error('inventory first — powers.json is missing');
  if (!Object.hasOwn(verdicts, 'powers_ts')) throw new Error('verdicts.json does not record which powers.json it was computed from (no powers_ts) — run cli.js verdict first');
  if ((verdicts.powers_ts ?? null) !== (powers.ts ?? null)) throw new Error(POWERS_CHANGED);
  const undecided = powers.powers.filter(p => !VERDICTS.includes(verdicts.rows[p.name]?.decision)).map(p => p.name);
  if (undecided.length) throw new Error(`verdict first — undecided powers: ${undecided.join(', ')} (cli.js verdict --decide <power>=<verdict>)`);
  return powers.powers;
}

/** Validate what `cli.js init` printed: a well-formed run id whose run dir is exactly <marathon runs dir>/<id>. */
function checkInit(initData, projectDir, runsRoot) {
  const runId = initData?.runId;
  if (typeof runId !== 'string' || !MARATHON_RUN_ID.test(runId)) {
    throw new Error(`marathon: init returned an invalid run id ${JSON.stringify(runId)} — expected letters, digits and dashes (${MARATHON_RUN_ID})`);
  }
  const want = path.join(runsRoot, runId);
  const got = typeof initData.runDir === 'string' ? path.resolve(projectDir, initData.runDir) : null;
  if (got !== want) {
    throw new Error(`marathon: init returned run dir ${JSON.stringify(initData.runDir)} for run ${runId} — expected ${posix(path.relative(projectDir, want))} under the marathon runs dir`);
  }
  return { runId, dir: want };
}

/**
 * Orchestrate the handoff: rebuild/use powers become briefs, buy becomes memos, skips are listed.
 * When marathon=true, init a marathon run, write finish-line, kickoff, stream rows, then handoff.json last.
 * force: replace handoff.json and refill a marathon run that already holds a hand-off.
 * marathonRunner: injectable (args, cwd) => stdout for testing, default execFileSync of the marathon CLI.
 */
export async function buildHandoff(projectDir, opts = {}) {
  const cfg = opts.cfg || await loadConfig(projectDir);
  const runDir = runDirOf(projectDir, opts.run, cfg);
  // Everything runs under the run lock verdict/map hold: verdicts.json, powers.json and handoff.json are read and
  // written inside it, so a concurrent verdict --from or handoff cannot interleave.
  const { result, warning } = await withMapLockDetailed(runDir, () => buildHandoffLocked(projectDir, runDir, { ...opts, cfg }));
  return warning ? { ...result, warning } : result;
}

async function claimJson(file, data) {
  const text = JSON.stringify(data, null, 2) + '\n';
  const tmp = `${file}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    try { await fs.link(tmp, file); }
    catch (err) {
      if (err.code === 'EEXIST') throw new Error('handoff.json exists — pass --force to replace it (it appeared while this hand-off was running)');
      if (!['EPERM', 'ENOTSUP', 'ENOSYS', 'EXDEV', 'EACCES'].includes(err.code)) throw err;
      let fh;
      try { fh = await fs.open(file, 'wx'); }
      catch (e) { if (e.code === 'EEXIST') throw new Error('handoff.json exists — pass --force to replace it (it appeared while this hand-off was running)'); throw e; }
      try { await fh.writeFile(text); await fh.sync(); } finally { await fh.close(); }
    }
  } finally { await fs.rm(tmp, { force: true }); }
}

async function buildHandoffLocked(projectDir, runDir, { run, now, force, marathon, marathonRunner, cfg }) {
  if (typeof now !== 'function') now = () => new Date();

  // Check that verdicts are recorded
  const verdicts = await readJson(path.join(runDir, 'verdicts.json'));
  if (!verdicts || !verdicts.rows || typeof verdicts.rows !== 'object') {
    throw new Error('verdict step must complete first — every power needs a decision');
  }

  // Check that handoff doesn't already exist (unless --force)
  const handoffPath = path.join(runDir, 'handoff.json');
  if (!force) {
    try {
      await fs.stat(handoffPath);
      throw new Error('handoff.json exists — pass --force to replace it');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  const allPowers = await decidedPowers(runDir, verdicts);
  const source = await readJson(path.join(runDir, 'source.json'));

  // Separate powers by decision
  const approved = []; // rebuild and use go into the finish line
  const allApproved = []; // rebuild, use and buy
  const skipped = [];
  for (const power of allPowers) {
    const decision = verdicts.rows[power.name].decision;
    if (decision === 'skip') skipped.push(power.name);
    else {
      const p = { ...power, verdict: decision };
      allApproved.push(p);
      if (decision !== 'buy') approved.push(p);
    }
  }

  // Slug collisions across rebuild, use and buy — before anything is written
  const bySlug = new Map();
  for (const power of allApproved) {
    const slug = slugPower(power.name);
    if (bySlug.has(slug)) throw new Error(`slug collision: "${bySlug.get(slug)}" and "${power.name}" both slug to ${slug} — rename one in powers.json`);
    bySlug.set(slug, power.name);
  }

  const { tolerance, from: toleranceFile } = await loadTolerance(projectDir);
  let finishLine;
  try {
    finishLine = buildFinishLine(approved, { tolerance });
  } catch (err) {
    if (toleranceFile) throw new Error(`${toleranceFile}: ${err.message}`);
    throw err;
  }
  const flFile = { tolerance: finishLine.tolerance, lines: finishLine.lines };

  // Marathon preflight, before any write
  let prevMarathonRun = null; // forced hand-off with nothing approved: the run the previous hand-off filled
  if (force && marathon && approved.length === 0) {
    let prev = null;
    try { prev = await readJson(handoffPath); } catch { /* unreadable old handoff.json: it is replaced below */ }
    if (typeof prev?.marathonRun === 'string' && MARATHON_RUN_ID.test(prev.marathonRun)) prevMarathonRun = prev.marathonRun;
  }
  const useMarathon = marathon && (approved.length > 0 || prevMarathonRun !== null);
  let marathonCliPath = null;
  let runsRoot = null;
  let mcfg = null;
  if (useMarathon) {
    marathonCliPath = path.join(projectDir, cfg.paths.marathon_cli);
    try {
      await fs.stat(marathonCliPath);
    } catch {
      throw new Error(`marathon helpers are absent (${cfg.paths.marathon_cli}) — install the suite`);
    }
    mcfg = await loadMarathonConfig(projectDir);
    runsRoot = path.resolve(projectDir, mcfg.paths.runs);
    const rel = path.relative(path.resolve(projectDir), runsRoot);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`marathon: paths.runs ${JSON.stringify(mcfg.paths.runs)} in .claude/marathon.json must stay inside the project`);
    }
  }

  // Write briefs and memos
  const briefsDir = path.join(runDir, 'briefs');
  const memosDir = path.join(runDir, 'memos');
  await fs.mkdir(briefsDir, { recursive: true });
  await fs.mkdir(memosDir, { recursive: true });

  const briefRel = (slug) => posix(path.relative(projectDir, path.join(briefsDir, `${slug}.md`)));
  const outputPowers = [];
  const memos = [];
  for (const power of allApproved) {
    const slug = slugPower(power.name);
    const verdictRow = verdicts.rows[power.name];
    if (power.verdict === 'buy') {
      await writeTextAtomic(path.join(memosDir, `${slug}.md`), renderMemo(power, { source, row: verdictRow }) + '\n');
      memos.push({ name: power.name, slug, memo: `memos/${slug}.md` });
      continue;
    }
    const powerLines = finishLine.byPower[power.name];
    const brief = renderBrief(power, { source, row: verdictRow, lines: powerLines, decided_at: now().toISOString() });
    await writeTextAtomic(path.join(briefsDir, `${slug}.md`), brief + '\n');
    outputPowers.push({ name: power.name, slug, verdict: power.verdict, brief: `briefs/${slug}.md`, brief_path: briefRel(slug), lines: powerLines });
  }

  // Marathon integration
  let marathonRun = null;
  let resume_line = null;
  let stale_streams = [];
  let removed_files = [];
  let note = approved.length === 0 ? 'no approved power — nothing to hand off to a marathon run' : null;

  if (useMarathon) {
    if (!marathonRunner) {
      marathonRunner = (args, cwd) => execFileSync(process.execPath, [marathonCliPath, ...args], {
        cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000
      });
    }
    const verdictNow = (slug) => {
      const hit = allPowers.find(p => slugPower(p.name) === slug);
      return hit ? verdicts.rows[hit.name].decision : 'no longer in powers.json';
    };
    // Block (the marathon CLI has no remove verb) every row of `dir` whose name is not in `keep`
    const blockStale = async (id, rows, keep) => {
      const ts = now().toISOString();
      const names = [];
      for (const row of rows) {
        if (keep.has(row.name)) continue;
        marathonRunner(['stream', row.name, '--run', id, 'state=blocked', `next=dropped by a forced hand-off refill on ${ts}: this power is now ${verdictNow(row.name)}`], projectDir);
        names.push(row.name);
      }
      return names;
    };
    const rowsOfStreams = (st) => (Array.isArray(st) ? st : (st?.streams || [])).filter(r => r?.name !== '_meta');

    if (approved.length === 0) {
      // forced hand-off with nothing approved: the run the previous hand-off filled must not keep queued streams
      const pDir = path.join(runsRoot, prevMarathonRun);
      let rows = [];
      try { rows = rowsOfStreams(await readJson(path.join(pDir, 'streams.json'))); }
      catch (err) { throw new Error(`marathon run ${prevMarathonRun} (from the previous hand-off): ${firstLine(err)} — its stream rows were not blocked; fix or remove it, then re-run with --force`); }
      try { stale_streams = await blockStale(prevMarathonRun, rows, new Set()); }
      catch (err) { throw new Error(`marathon: ${firstLine(err)} — the previous hand-off's run ${prevMarathonRun} is only partly blocked; re-run with --force`); }
      note = `no approved power — nothing to hand off to a marathon run; the previous hand-off's run ${prevMarathonRun} had ${stale_streams.length} stream${stale_streams.length === 1 ? '' : 's'} blocked` +
        ' (a forced refill drops them); its finish-line.json is unchanged — close or remove that run';
    } else {
    const prevActive = await marathonActiveRun(projectDir, mcfg);
    const restoreActive = async () => {
      const now0 = await marathonActiveRun(projectDir, mcfg);
      if (now0 === prevActive) return;
      if (prevActive) await setMarathonActiveRun(projectDir, prevActive, mcfg);
      else await fs.rm(path.join(runsRoot, 'ACTIVE'), { force: true });
    };
    const activeWas = () => (prevActive ? `restored to ${prevActive}` : 'cleared');
    let mRun = null;
    let mDir = null;
    let mRel = null;
    let oldRows;
    try {
      // From here init may have moved ACTIVE: every failure before the guarded block restores it and says so
      let raw;
      try { raw = marathonRunner(['init', marathonSlug(run)], projectDir); }
      catch (err) { throw new Error(`marathon: ${firstLine(err)}`); }
      let initData;
      try { initData = JSON.parse(raw); }
      catch { initData = undefined; }
      if (initData === undefined) {
        const shown = String(raw).trim().slice(0, 80);
        await restoreActive();
        throw new Error(`marathon init printed no JSON (${shown}) — check .claude/marathon/ACTIVE (it was ${activeWas()})`);
      }
      try { ({ runId: mRun, dir: mDir } = checkInit(initData, projectDir, runsRoot)); }
      catch (err) { await restoreActive(); throw new Error(`${err.message} — ACTIVE was ${activeWas()}; check .claude/marathon/ACTIVE`); }
      mRel = posix(path.relative(projectDir, mDir));

      // A run that already holds a hand-off is refilled only with force; an unreadable file counts as held under force
      const corrupt = [];
      const looseRead = async (name) => {
        try { return await readJson(path.join(mDir, name)); }
        catch (err) {
          if (!String(err.message).startsWith('corrupt JSON in ')) throw err;
          corrupt.push(name);
          return null;
        }
      };
      const oldFl = await looseRead('finish-line.json');
      const oldStreams = await looseRead('streams.json');
      oldRows = rowsOfStreams(oldStreams);
      if (corrupt.length && !force) {
        await restoreActive();
        throw new Error(`marathon run ${mRun}: ${corrupt.join(' and ')} is not valid JSON — pass --force to move it aside as <name>.stale-<ts>.json and refill the run (ACTIVE was ${activeWas()})`);
      }
      const holds = corrupt.length > 0 || oldRows.length > 0 || (Array.isArray(oldFl?.lines) && oldFl.lines.some(l => HANDOFF_LINE.test(String(l?.id))));
      if (holds && !force) {
        await restoreActive();
        throw new Error(`marathon run ${mRun} already holds a hand-off — pass --force to refill it or pick another source slug`);
      }
      if (corrupt.length) await moveAsideStale(mDir, corrupt, now);
    } catch (err) {
      if (mRun && !String(err.message).includes('ACTIVE')) {
        throw new Error(`marathon: ${firstLine(err)} — marathon run ${mRun} was created and is ACTIVE but incomplete — re-run cli.js handoff --marathon --force to refill it, or remove ${mRel}`);
      }
      throw err;
    }

    try {
      await writeJson(path.join(mDir, 'finish-line.json'), flFile);

      const kickoffPath = path.join(mDir, 'kickoff.md');
      let seeded;
      try { seeded = await fs.readFile(kickoffPath, 'utf-8'); }
      catch (err) { throw new Error(`${mRel}/kickoff.md is unreadable (${err.code || err.message}) — marathon init seeds it`); }
      const sourceLines = [`- Source: ${source ? sourceLabel(source) : 'unknown (source.json is missing)'}`, `- bbs run: ${run}`, `- bbs run dir: ${posix(path.relative(projectDir, runDir))}`];
      for (const p of outputPowers) sourceLines.push(`- Brief (${p.name}): ${p.brief_path}`);
      for (const m of memos) sourceLines.push(`- Buy memo (${m.name}): ${posix(path.relative(projectDir, path.join(runDir, m.memo)))}`);
      const kickoff = fillKickoff(seeded, {
        'Done means': approved.map(p => `- ${p.name}: ${finishLine.byPower[p.name].map(l => l.label).join(', ')}`),
        'You may decide on your own': MAY_DECIDE,
        'Ask me before': ASK_BEFORE,
        'Never': NEVER,
        'Source': sourceLines
      }, `${mRel}/kickoff.md`);
      await writeTextAtomic(kickoffPath, kickoff);

      for (const p of outputPowers) {
        marathonRunner(['stream', p.slug, '--run', mRun, 'state=queued', `plan=${p.brief_path}`, 'next=read the brief, write the contract and failing tests'], projectDir);
      }
      if (force) stale_streams = await blockStale(mRun, oldRows, new Set(outputPowers.map(p => p.slug)));
    } catch (err) {
      throw new Error(`marathon: ${firstLine(err)} — marathon run ${mRun} was created and is ACTIVE but incomplete — re-run cli.js handoff --marathon --force to refill it, or remove ${mRel}`);
    }

    marathonRun = mRun;
    resume_line = `/w-marathon --resume ${marathonRun}`;
    }
  }

  // A forced refill leaves no brief or memo of a power that is no longer rebuild/use/buy in this hand-off
  if (force) {
    const keep = { briefs: new Set(outputPowers.map(p => `${p.slug}.md`)), memos: new Set(memos.map(m => `${m.slug}.md`)) };
    for (const [dirName, dirPath] of [['briefs', briefsDir], ['memos', memosDir]]) {
      for (const f of (await fs.readdir(dirPath)).sort()) {
        if (!f.endsWith('.md') || keep[dirName].has(f)) continue;
        await fs.rm(path.join(dirPath, f), { force: true });
        removed_files.push(posix(path.relative(projectDir, path.join(dirPath, f))));
      }
    }
  }

  // handoff.json LAST: it marks the step as done. Claimed exclusively unless forced: nothing may have created it meanwhile.
  const handoffDoc = {
    run,
    source: source || null,
    marathonRun,
    powers: outputPowers,
    memos,
    skipped,
    finish_line: flFile,
    note,
    ...(force ? { stale_streams, removed_files } : {}),
    ts: now().toISOString()
  };
  if (force) await writeJson(handoffPath, handoffDoc);
  else await claimJson(handoffPath, handoffDoc);

  await renderStatusSafe(runDir);

  return {
    runId: marathonRun,
    marathonRun,
    resume_line,
    powers: outputPowers,
    memos,
    skipped,
    note,
    ...(force ? { stale_streams, removed_files } : {}),
    next: 'done'
  };
}
