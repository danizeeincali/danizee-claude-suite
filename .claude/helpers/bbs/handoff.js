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
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readJson, writeJson, writeTextAtomic, runDir as runDirOf, moveAsideStale, withMapLockDetailed } from './store.js';
import { validateFinishLine } from '../marathon/gate.js';
import { loadConfig as loadMarathonConfig, activeRunId as marathonActiveRun, setActiveRun as setMarathonActiveRun } from '../marathon/config.js';
import { renderStatusSafe } from './status.js';
import { loadConfig } from './config.js';
import { VERDICTS, POWERS_CHANGED } from './verdict.js';
import { redactRef, redactUrlsInText } from './intake.js';

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
const LINE_SUFFIX = /:\d+(?:-\d+)?$/;
const TOKEN_SEGMENT = /[A-Za-z0-9_-]{20,}/;

/**
 * The location tokens in an evidence string, deduped in order. Nothing else from the string is kept: a brief never
 * carries source code. The whole string first goes through redactUrlsInText, so a URL is kept only redacted (userinfo
 * removed, token-like query values masked). A dotted token is kept only with a '/' (a path) or a ':<line>' /
 * ':<a>-<b>' suffix, and any token holding a run of 20+ base64-url characters (a key or JWT-shaped string) is dropped.
 */
export function evidenceLocations(text) {
  if (text == null) return [];
  const found = redactUrlsInText(String(text)).match(LOCATION) || [];
  const kept = found.filter((t) => {
    if (TOKEN_SEGMENT.test(t)) return false;
    if (/^https?:\/\//i.test(t)) return true;
    return t.includes('/') || LINE_SUFFIX.test(t);
  });
  return [...new Set(kept)];
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

/** One Done-means bullet: the check id, then its label without the "<slug>: " prefix the finish line carries. */
const doneBullet = (line, slug, indent = '') => `${indent}- ${line.id} — ${String(line.label).startsWith(`${slug}: `) ? String(line.label).slice(slug.length + 2) : line.label}`;

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
    md.push(doneBullet(line, slug));
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
      md.push(`- Never run the upstream code (${rem.verdict || 'use'} was removed: ${rem.reason})`);
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

const execFileP = promisify(execFile);
const MARATHON_CALL_TIMEOUT_MS = 30000; // well under LOCK_STALE_MS - LOCK_REFRESH_MS
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
  if (!powers || !Array.isArray(powers.powers)) throw new Error(`inventory first — powers.json is missing (cli.js inventory --brief --run ${path.basename(runDir)})`);
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
 * marathonRunner: injectable (args, cwd) => stdout (or a Promise of it) for testing, default async execFile of the marathon CLI.
 * Every call is [verb, '--project', <projectDir>, ...rest]: a linked worktree must not be mapped to the main checkout.
 * lockOpts: passed to the run lock (tests shorten its stale and refresh windows).
 */
export async function buildHandoff(projectDir, opts = {}) {
  const cfg = opts.cfg || await loadConfig(projectDir);
  const runDir = runDirOf(projectDir, opts.run, cfg);
  // Everything runs under the run lock verdict/map hold: verdicts.json, powers.json and handoff.json are read and
  // written inside it, so a concurrent verdict --from or handoff cannot interleave.
  const { result, warning } = await withMapLockDetailed(runDir, () => buildHandoffLocked(projectDir, runDir, { ...opts, cfg }), opts.lockOpts);
  return warning ? { ...result, warning } : result;
}

export async function claimJson(file, data, ops = {}) {
  const link = ops.link || fs.link.bind(fs);
  const open = ops.open || fs.open.bind(fs);
  const text = JSON.stringify(data, null, 2) + '\n';
  const tmp = `${file}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    try { await link(tmp, file); }
    catch (err) {
      if (err.code === 'EEXIST') throw new Error('handoff.json exists — pass --force to replace it (it appeared while this hand-off was running)');
      if (!['EPERM', 'ENOTSUP', 'ENOSYS', 'EXDEV', 'EACCES'].includes(err.code)) throw err;
      let fh;
      try { fh = await open(file, 'wx'); }
      catch (e) { if (e.code === 'EEXIST') throw new Error('handoff.json exists — pass --force to replace it (it appeared while this hand-off was running)'); throw e; }
      // this call created the file: a failed write must not leave a partial handoff.json that reads as done
      try { await fh.writeFile(text); await fh.sync(); }
      catch (e) { try { await fh.close(); } catch { /* the write error wins */ } fh = null; await fs.rm(file, { force: true }); throw e; }
      finally { if (fh) await fh.close(); }
    }
  } finally { await fs.rm(tmp, { force: true }); }
}

async function buildHandoffLocked(projectDir, runDir, { run, now, force, marathon, marathonRunner, cfg }) {
  if (typeof now !== 'function') now = () => new Date();
  const rerun = `cli.js handoff --marathon --force --run ${path.basename(runDir)}`;

  // Check that verdicts are recorded
  const verdicts = await readJson(path.join(runDir, 'verdicts.json'));
  if (!verdicts || !verdicts.rows || typeof verdicts.rows !== 'object') {
    throw new Error(`verdict step must complete first — every power needs a decision (cli.js verdict --table --run ${path.basename(runDir)})`);
  }

  // Check that handoff doesn't already exist (unless --force)
  const handoffPath = path.join(runDir, 'handoff.json');
  if (!force) {
    try {
      await fs.stat(handoffPath);
      throw new Error(`handoff.json exists at ${posix(path.relative(projectDir, handoffPath))} — pass --force (cli.js handoff --force --run ${path.basename(runDir)})`);
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
  // A forced hand-off reads the previous handoff.json: its run (when nothing is approved now) and the briefs/memos it wrote
  let prev = null;
  if (force) {
    try { prev = await readJson(handoffPath); } catch { /* unreadable old handoff.json: it is replaced below; nothing it listed is removed */ }
  }
  let prevMarathonRun = null; // forced hand-off with nothing approved: the run the previous hand-off filled
  if (force && marathon && approved.length === 0) {
    if (typeof prev?.marathonRun === 'string' && MARATHON_RUN_ID.test(prev.marathonRun)) prevMarathonRun = prev.marathonRun;
  }
  const useMarathon = marathon && (approved.length > 0 || prevMarathonRun !== null);
  let marathonCliPath = null;
  let runsRoot = null;
  let mcfg = null;
  if (useMarathon) {
    marathonCliPath = path.resolve(projectDir, cfg.paths.marathon_cli);
    const cliRel = path.relative(path.resolve(projectDir), marathonCliPath);
    if (!cliRel || cliRel.startsWith('..') || path.isAbsolute(cliRel)) {
      throw new Error(`marathon: paths.marathon_cli ${JSON.stringify(cfg.paths.marathon_cli)} must stay under the project`);
    }
    try {
      await fs.stat(marathonCliPath);
    } catch {
      throw new Error(`marathon helpers are absent (${cfg.paths.marathon_cli}) — install the suite (npx danizee-claude-suite init)`);
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
  const skipped_files = [];
  const staleGroups = []; // [{ run, names, closeHint }]: the runs whose streams were blocked, not removed
  let note = approved.length === 0 ? 'no approved power — nothing to hand off to a marathon run' : null;

  if (useMarathon) {
    if (!marathonRunner) {
      // async, so the run lock's refresh timer keeps firing while the marathon CLI works
      marathonRunner = async (args, cwd) => (await execFileP(process.execPath, [marathonCliPath, ...args], {
        cwd, encoding: 'utf-8', timeout: MARATHON_CALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024
      })).stdout;
    }
    const projectAbs = path.resolve(projectDir);
    const mcall = async (verb, ...rest) => marathonRunner([verb, '--project', projectAbs, ...rest], projectDir);
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
        await mcall('stream', row.name, '--run', id, 'state=blocked', `next=dropped by a forced hand-off refill on ${ts}: this power is now ${verdictNow(row.name)}`);
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
      catch (err) { throw new Error(`marathon run ${prevMarathonRun} (from the previous hand-off): ${firstLine(err)} — its stream rows were not blocked; fix or remove it, then re-run ${rerun}`); }
      try { stale_streams = await blockStale(prevMarathonRun, rows, new Set()); }
      catch (err) { throw new Error(`marathon: ${firstLine(err)} — the previous hand-off's run ${prevMarathonRun} is only partly blocked; re-run ${rerun}`); }
      note = `no approved power — nothing to hand off to a marathon run; the previous hand-off's run ${prevMarathonRun} had ${stale_streams.length} stream${stale_streams.length === 1 ? '' : 's'} blocked` +
        ` (a forced refill drops them); its finish-line.json is unchanged — close it with node ${cfg.paths.marathon_cli} finish --run ${prevMarathonRun}, or remove it`;
      staleGroups.push({ run: prevMarathonRun, names: stale_streams, closeHint: true });
    } else {
    const prevActive = await marathonActiveRun(projectDir, mcfg);
    const restoreActive = async () => {
      const now0 = await marathonActiveRun(projectDir, mcfg);
      if (now0 === prevActive) return;
      if (prevActive) await setMarathonActiveRun(projectDir, prevActive, mcfg);
      else await fs.rm(path.join(runsRoot, 'ACTIVE'), { force: true });
    };
    const activeWas = () => (prevActive ? `restored to ${prevActive}` : 'cleared');
    const likelyRunDir = posix(path.relative(projectDir, path.join(runsRoot, `${new Date().toISOString().slice(0, 10)}-${marathonSlug(run)}`)));
    let mRun = null;
    let mDir = null;
    let mRel = null;
    let oldRows;
    try {
      // From here init may have moved ACTIVE: every failure before the guarded block restores it and says so
      let raw;
      try { raw = await mcall('init', marathonSlug(run)); }
      catch (err) {
        let restored;
        try { await restoreActive(); restored = `ACTIVE was restored to ${prevActive || 'cleared'}`; }
        catch (e) { restored = `ACTIVE could NOT be restored (${firstLine(e)}) — it may point at the half-made run; check .claude/marathon/ACTIVE (it was ${prevActive || 'unset'})`; }
        throw new Error(`marathon: ${firstLine(err)} — ${restored}; a run dir ${likelyRunDir} may have been created and may need removing`);
      }
      let initData;
      try { initData = JSON.parse(raw); }
      catch { initData = undefined; }
      if (initData === undefined) {
        const shown = String(raw).trim().slice(0, 80);
        await restoreActive();
        throw new Error(`marathon init printed no JSON (${shown}) — check .claude/marathon/ACTIVE (it was ${activeWas()})`);
      }
      try { ({ runId: mRun, dir: mDir } = checkInit(initData, projectDir, runsRoot)); }
      catch (err) {
        await restoreActive();
        const left = typeof initData?.runDir === 'string' ? initData.runDir : typeof initData?.runId === 'string' ? initData.runId : likelyRunDir;
        throw new Error(`${err.message} — ACTIVE was ${activeWas()}; check .claude/marathon/ACTIVE; a run dir ${left} may have been created and may need removing`);
      }
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
        throw new Error(`marathon run ${mRun}: ${corrupt.join(' and ')} is not valid JSON — pass --force to move it aside as <name>.stale-<ts>.json and refill the run (ACTIVE was ${activeWas()}; command: ${rerun})`);
      }
      const holds = corrupt.length > 0 || oldRows.length > 0 || (Array.isArray(oldFl?.lines) && oldFl.lines.some(l => HANDOFF_LINE.test(String(l?.id))));
      if (holds && !force) {
        await restoreActive();
        throw new Error(`marathon run ${mRun} already holds a hand-off — pass --force to refill it or pick another source slug (${rerun}; ACTIVE was ${activeWas()})`);
      }
      if (corrupt.length) await moveAsideStale(mDir, corrupt, now);
    } catch (err) {
      if (mRun && !String(err.message).includes('ACTIVE')) {
        throw new Error(`marathon: ${firstLine(err)} — marathon run ${mRun} was created and is ACTIVE but incomplete — re-run cli.js handoff --marathon --force to refill it, or remove ${mRel} — full command: ${rerun}`);
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
        'Done means': approved.flatMap(p => [`- ${p.name}: 5 checks below`, ...finishLine.byPower[p.name].map(l => doneBullet(l, slugPower(p.name), '  '))]),
        'You may decide on your own': MAY_DECIDE,
        'Ask me before': ASK_BEFORE,
        'Never': NEVER,
        'Source': sourceLines
      }, `${mRel}/kickoff.md`);
      await writeTextAtomic(kickoffPath, kickoff);

      for (const p of outputPowers) {
        await mcall('stream', p.slug, '--run', mRun, 'state=queued', `plan=${p.brief_path}`, 'next=read the brief, write the contract and failing tests');
      }
      if (force) {
        stale_streams = await blockStale(mRun, oldRows, new Set(outputPowers.map(p => p.slug)));
        if (stale_streams.length) staleGroups.push({ run: mRun, names: [...stale_streams] });
        // A later-day refill creates a new run: the run the previous hand-off filled keeps its queued streams unless blocked here
        const pr = prev?.marathonRun;
        if (typeof pr === 'string' && MARATHON_RUN_ID.test(pr) && pr !== mRun) {
          const pDir = path.join(runsRoot, pr);
          if (await fs.stat(pDir).then(st => st.isDirectory(), () => false)) {
            let pRows;
            try { pRows = rowsOfStreams(await readJson(path.join(pDir, 'streams.json'))); }
            catch (err) { throw new Error(`marathon run ${pr} (from the previous hand-off): ${firstLine(err)} — its stream rows were not blocked; fix or remove it, then re-run ${rerun}`); }
            const blocked = await blockStale(pr, pRows, new Set());
            if (blocked.length) {
              stale_streams.push(...blocked.map(n => `${pr}/${n}`));
              staleGroups.push({ run: pr, names: blocked, closeHint: true });
            }
          }
        }
      }
    } catch (err) {
      throw new Error(`marathon: ${firstLine(err)} — marathon run ${mRun} was created and is ACTIVE but incomplete — re-run cli.js handoff --marathon --force to refill it, or remove ${mRel} — full command: ${rerun}`);
    }

    marathonRun = mRun;
    resume_line = `/w-marathon --resume ${marathonRun}`;
    }
  }

  // A forced refill removes the briefs and memos the previous handoff.json listed (powers[].brief, memos[].memo) that
  // this hand-off does not keep. Nothing else in briefs/ or memos/ is touched. A listed entry that does not sit directly
  // in its own dir as <name>.md, or is not a regular file, is left alone and reported in skipped_files.
  if (force) {
    const keep = new Set([...outputPowers.map(p => p.brief), ...memos.map(m => m.memo)]);
    const listed = [
      ...(Array.isArray(prev?.powers) ? prev.powers.map(p => ['briefs', briefsDir, p?.brief]) : []),
      ...(Array.isArray(prev?.memos) ? prev.memos.map(m => ['memos', memosDir, m?.memo]) : [])
    ];
    const seen = new Set();
    for (const [dirName, dirPath, entry] of listed) {
      if (entry == null || seen.has(entry)) continue;
      seen.add(entry);
      if (keep.has(entry)) continue;
      const target = typeof entry === 'string' ? path.resolve(runDir, entry) : null;
      if (!target || path.dirname(target) !== dirPath || !target.endsWith('.md') || entry !== `${dirName}/${path.basename(target)}`) {
        skipped_files.push(String(entry));
        continue;
      }
      let st;
      try { st = await fs.lstat(target); }
      catch (err) { if (err.code === 'ENOENT') continue; throw err; }
      const rel = posix(path.relative(projectDir, target));
      if (!st.isFile()) { skipped_files.push(rel); continue; }
      await fs.rm(target, { force: true });
      removed_files.push(rel);
    }
  }

  // One sentence per non-empty list, so nobody has to guess what the bare lists mean
  const sentences = [
    ...staleGroups.map(g => `streams blocked in ${g.run}, not removed: ${g.names.join(', ')}${g.closeHint ? ` (close that run with node ${cfg.paths.marathon_cli} finish --run ${g.run})` : ''}`),
    ...(removed_files.length ? [`brief/memo files deleted: ${removed_files.join(', ')}`] : []),
    ...(skipped_files.length ? [`left in place for manual review (not a regular <dir>/<name>.md): ${skipped_files.join(', ')}`] : [])
  ];
  const noteHas = (t) => note != null && note.includes(t);
  const extra = sentences.filter(t => !noteHas(t));
  if (extra.length) note = [note, ...extra].filter(Boolean).join('. ');

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
    ...(force ? { stale_streams, removed_files, skipped_files } : {}),
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
    ...(force ? { stale_streams, removed_files, skipped_files } : {}),
    next: 'done'
  };
}
