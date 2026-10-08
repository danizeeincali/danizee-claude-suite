/**
 * bbs handoff — approved powers become marathon streams with finish lines and briefs.
 * Approved (rebuild/use/buy) powers: one brief per rebuild/use, one memo per buy, skip listed.
 * Finish line written before the build; when marathon=true, a separate /w-marathon run queues each stream.
 * Kickoff and briefs show the five checks per power; memos show licence and data; both redact source.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { readJson, writeJson, writeTextAtomic, runDir as runDirOf } from './store.js';
import { validateFinishLine } from '../marathon/gate.js';
import { renderStatusSafe } from './status.js';
import { loadConfig } from './config.js';

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
 * Returns { tolerance, lines } that passes validateFinishLine.
 */
export function buildFinishLine(powers, { tolerance }) {
  if (!tolerance || typeof tolerance.high !== 'number' || typeof tolerance.medium !== 'number' ||
      typeof tolerance.low !== 'number' || !Number.isInteger(tolerance.passes_in_a_row)) {
    throw new Error('tolerance must have numeric high, medium, low and passes_in_a_row');
  }

  const approved = Array.isArray(powers) ?
    powers.filter(p => ['rebuild', 'use'].includes(p.verdict)) :
    [];
  const slugs = new Map();
  const lines = [];

  // Build lines for each approved power
  for (const power of approved) {
    const slug = slugPower(power.name);
    if (slugs.has(slug) && slugs.get(slug) !== power.name) {
      throw new Error(`slug collision: "${slugs.get(slug)}" and "${power.name}" both slug to ${slug}`);
    }
    slugs.set(slug, power.name);

    // Five checks per power
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
    }
  }

  // Add standard lines
  lines.push(
    { id: 'clean_reviews', label: 'Clean reviews in a row', type: 'number', op: 'at_least', value: tolerance.passes_in_a_row, owner: 'build', source: 'reviews.streak' },
    { id: 'latest_high', label: 'High findings in the latest review', type: 'number', op: 'at_most', value: 0, owner: 'build', source: 'reviews.latest.high' },
    { id: 'open_high', label: 'Open high findings', type: 'number', op: 'at_most', value: 0, owner: 'build', source: 'findings.open:high' }
  );

  const fl = { tolerance, lines };
  const errors = validateFinishLine(fl);
  if (errors.length) throw new Error(errors[0]);
  return fl;
}

/**
 * Strip anything after the first location marker from an evidence string.
 * Keep location (e.g., 'src/drift.js:12') but drop code after ' — ' or from first backtick/(/{
 */
function stripEvidenceCode(evidence) {
  if (!evidence) return '';
  const s = String(evidence);
  // Split on common separators for code
  const stripped = s.split(/[—\n`({]/)[0];
  return stripped.trim();
}

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
    md.push(`- Source: ${source.type} ${source.ref}`);
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
  md.push('- ');
  md.push('');

  md.push('Ask me before');
  md.push('- ');
  md.push('');

  md.push('Never');
  md.push('- Never execute fetched foreign code');
  md.push('- Never copy source code from the source');
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

  // Add evidence location (if available, after stripping code)
  if (power.evidence) {
    const loc = stripEvidenceCode(power.evidence);
    if (loc) md.push(`${loc}`);
  }

  return md.join('\n');
}

/**
 * Render a memo for a power (buy verdict): what it is, why buy, data, licence.
 */
export function renderMemo(power, ctx) {
  const { row } = ctx;

  const md = [];
  md.push(`# ${power.name} — buy memo`);
  md.push('');
  md.push(`## What it is`);
  md.push(power.what || '');
  md.push('');
  md.push('## Why buy');
  md.push(power.idea || '');
  md.push('');
  md.push('## Data');
  md.push(power.data_needed || 'none');
  md.push('');
  md.push(`## Licence`);
  md.push(`${power.licence} (${row.licence_class})`);
  md.push('');
  md.push('## Account and signing');
  md.push('- No account was created');
  md.push('- Nothing was signed');
  md.push('');

  return md.join('\n');
}

/**
 * Orchestrate the handoff: approve powers become briefs, buy becomes memos.
 * When marathon=true, init a marathon run, write finish-line, kickoff, stream rows, then handoff.json last.
 * marathonRunner: injectable function for testing, default execFileSync
 */
export async function buildHandoff(projectDir, { run, now, force, marathon, marathonRunner, cfg } = {}) {
  if (typeof now !== 'function') now = () => new Date();
  if (!cfg) cfg = await loadConfig(projectDir);
  const runDir = runDirOf(projectDir, run, cfg);

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

  // Load related data
  const source = await readJson(path.join(runDir, 'source.json'));
  const powers = await readJson(path.join(runDir, 'powers.json'));

  // Build the decision map from verdicts.rows
  const decisions = {};
  for (const [powerName, row] of Object.entries(verdicts.rows || {})) {
    if (row && row.decision) {
      decisions[powerName] = row.decision;
    }
  }

  // Separate powers by decision
  const approved = []; // Only rebuild and use go into the finish line
  const allApproved = []; // rebuild, use, and buy for output
  const skipped = [];
  for (const power of (powers?.powers || [])) {
    const decision = decisions[power.name];
    if (['rebuild', 'use'].includes(decision)) {
      const powerWithVerd = { ...power, verdict: decision };
      approved.push(powerWithVerd);
      allApproved.push(powerWithVerd);
    } else if (decision === 'buy') {
      allApproved.push({ ...power, verdict: decision });
    } else if (decision === 'skip') {
      skipped.push(power.name);
    }
  }

  // Get tolerance from the project example if it exists
  let tolerance = { high: 0, medium: 2, low: 5, passes_in_a_row: 2 };
  const examplePath = path.join(projectDir, '.claude', 'marathon', 'finish-line.example.json');
  try {
    const example = await readJson(examplePath);
    if (example && example.tolerance) tolerance = example.tolerance;
  } catch {
    // use default tolerance
  }

  // Build finish line
  const finishLine = buildFinishLine(approved, { tolerance });

  // Write briefs and memos
  const briefsDir = path.join(runDir, 'briefs');
  const memosDir = path.join(runDir, 'memos');
  await fs.mkdir(briefsDir, { recursive: true });
  await fs.mkdir(memosDir, { recursive: true });

  const outputPowers = [];
  for (const power of allApproved) {
    const slug = slugPower(power.name);
    const verdictRow = verdicts.rows[power.name] || {};

    // Get the relevant finish line rows (5 per power)
    const powerLines = finishLine.lines.filter(l =>
      l.id.endsWith(`_${slug}`) && !['clean_reviews', 'latest_high', 'open_high'].includes(l.id)
    );

    if (power.verdict === 'rebuild' || power.verdict === 'use') {
      // Write brief
      const briefPath = path.join(briefsDir, `${slug}.md`);
      const brief = renderBrief(power, {
        source,
        row: verdictRow,
        lines: powerLines,
        decided_at: now().toISOString()
      });
      await writeTextAtomic(briefPath, brief + '\n');
      outputPowers.push({
        name: power.name,
        slug,
        verdict: power.verdict,
        brief: `briefs/${slug}.md`,
        lines: powerLines
      });
    }

    if (power.verdict === 'buy') {
      // Write memo
      const memoPath = path.join(memosDir, `${slug}.md`);
      const memo = renderMemo(power, { row: verdictRow });
      await writeTextAtomic(memoPath, memo + '\n');
    }
  }

  // Marathon integration
  let marathonRun = null;
  let resume_line = null;

  if (marathon && approved.length > 0) {
    // Check that marathon CLI exists
    const marathonCliPath = path.join(projectDir, cfg.paths.marathon_cli);
    try {
      await fs.stat(marathonCliPath);
    } catch {
      throw new Error(`marathon helpers are absent (${cfg.paths.marathon_cli}) — install the suite`);
    }

    // Default marathonRunner if not provided
    if (!marathonRunner) {
      marathonRunner = (args, cwd) => {
        const result = execFileSync(process.execPath, [marathonCliPath, ...args], {
          cwd,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60000
        });
        return result;
      };
    }

    // Get the source slug from the run id
    const runIdSlug = run.split('-').pop();
    const initSlug = `bbs-${runIdSlug}`;

    try {
      // Call marathon init
      const initOutput = marathonRunner(['init', initSlug], projectDir);
      const initData = JSON.parse(initOutput);
      marathonRun = initData.runId;

      // Write finish-line.json to the marathon run
      const marathonRunDir = path.join(projectDir, '.claude', 'marathon', marathonRun);
      await writeJson(path.join(marathonRunDir, 'finish-line.json'), finishLine);

      // Build kickoff.md content
      const kickoffLines = [];
      kickoffLines.push('## Done means');
      for (const power of approved) {
        const slug = slugPower(power.name);
        const powerLines = finishLine.lines.filter(l => l.id.endsWith(`_${slug}`) && !['clean_reviews', 'latest_high', 'open_high'].includes(l.id));
        const labels = powerLines.map(l => l.label).join(', ');
        kickoffLines.push(`- ${power.name}: ${labels}`);
      }
      kickoffLines.push('');
      kickoffLines.push('## You may decide on your own');
      kickoffLines.push('- ');
      kickoffLines.push('');
      kickoffLines.push('## Ask me before');
      kickoffLines.push('- ');
      kickoffLines.push('');
      kickoffLines.push('## Never');
      kickoffLines.push('- Never execute fetched foreign code');
      kickoffLines.push('- Never copy source code from the source');
      kickoffLines.push('');
      kickoffLines.push(`Source: ${source?.type || 'paste'}`);

      const kickoffContent = kickoffLines.join('\n');
      await writeTextAtomic(path.join(marathonRunDir, 'kickoff.md'), kickoffContent + '\n');

      // Queue streams for each power
      for (const power of approved) {
        const slug = slugPower(power.name);
        const streamName = slug;
        const briefPath = `briefs/${slug}.md`;

        marathonRunner(
          ['stream', streamName, 'state=queued', `plan=${briefPath}`, 'next=read the brief, write the contract and failing tests'],
          projectDir
        );
      }

      resume_line = `/w-marathon --resume ${marathonRun}`;
    } catch (err) {
      const msg = err.stderr || err.message || String(err);
      throw new Error(`marathon: ${msg}`.split('\n')[0]);
    }
  }

  // Write handoff.json (LAST)
  const memos = [];
  for (const power of allApproved) {
    if (power.verdict === 'buy') {
      const slug = slugPower(power.name);
      memos.push({
        name: power.name,
        slug,
        memo: `memos/${slug}.md`
      });
    }
  }

  const note = approved.length === 0 ? 'no approved power — nothing to hand off to a marathon run' : null;

  const handoffData = {
    run,
    source: source || null,
    marathonRun,
    powers: outputPowers,
    memos,
    skipped,
    finish_line: finishLine,
    note,
    ts: now().toISOString()
  };

  await writeJson(handoffPath, handoffData);

  // Re-render status
  await renderStatusSafe(runDir);

  return {
    runId: marathonRun,
    marathonRun,
    resume_line,
    powers: outputPowers,
    memos,
    skipped,
    note,
    next: 'done'
  };
}
