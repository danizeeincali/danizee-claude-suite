#!/usr/bin/env node
/**
 * bbs helper CLI — `node cli.js <verb> [flags]`.
 * Verbs here: intake · fetch · inventory · map · usage · verdict · handoff · status · report. Later streams add verbs
 * by registering them in VERBS.
 *
 * Exit codes: 0 ok · 1 invalid input / broken state · 2 policy refusals (egress refused, illegal verdict).
 */

import fs from 'fs/promises';
import { existsSync, realpathSync } from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { loadConfig } from './config.js';
import { runDir as runDirOf, runsDir as runsDirOf, activeRunId, readJson } from './store.js';
import { intake, RUN_ID, invalidRunId } from './intake.js';
import { loadState, nextStep, summary, renderStatusSafe } from './status.js';
import { fetchRun, EgressRefused } from './fetch.js';
import { writeInventory, inventoryBrief, listSourceFiles } from './inventory.js';
import { buildMap, mapBrief, recordJudgments } from './harness-map.js';
import { computeVerdicts, recordProbe, recordDecisions, verdictTable, PolicyRefused } from './verdict.js';
import { buildHandoff } from './handoff.js';
import { recordUsage } from './usage.js';

class CliExit extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const INTAKE_USAGE = 'usage: cli.js intake <source|-> [--paste-file <p>] [--as repo|url|local|paste] [--slug <s>] [--run <id>] [--project <dir>]';

/** Flags each verb accepts: value flags need a value, boolean flags take none. */
const FLAGS = {
  intake: { value: ['run', 'project', 'as', 'slug', 'paste-file'], bool: [], positionals: 1, usage: INTAKE_USAGE },
  fetch: { value: ['run', 'project', 'max-bytes', 'max-links'], bool: [], positionals: 0, usage: 'usage: cli.js fetch [--run <id>] [--max-bytes <n>] [--max-links <n>] [--project <dir>]' },
  status: { value: ['run', 'project'], bool: ['next'], positionals: 0, usage: 'usage: cli.js status [--run <id>] [--next] [--project <dir>]' },
  report: { value: ['run', 'project'], bool: [], positionals: 0, usage: 'usage: cli.js report [--run <id>] [--project <dir>]' },
  inventory: { value: ['from', 'run', 'project'], bool: ['brief', 'force'], positionals: 0, usage: 'usage: cli.js inventory (--brief | --from <file|->) [--force] [--run <id>] [--project <dir>]' },
  map: { value: ['from', 'run', 'project'], bool: ['brief', 'force'], positionals: 0, usage: 'usage: cli.js map [--brief | --from <file|->] [--force] [--run <id>] [--project <dir>]' },
  usage: { value: ['run', 'project', 'days', 'root', 'workflows'], bool: ['force'], positionals: 0, repeat: ['root'], usage: 'usage: cli.js usage [--days <n>] [--root <dir>]... [--workflows <a,b>] [--force] [--run <id>] [--project <dir>]' },
  verdict: { value: ['probe', 'evidence', 'decide', 'from', 'run', 'project'], bool: ['table', 'force'], positionals: 0, usage: 'usage: cli.js verdict [--table | --probe <power>=<clean|found|incomplete> [--evidence <text>] | --decide <power>=<verdict> | --from <file|->] [--force] [--run <id>] [--project <dir>]' },
  handoff: { value: ['run', 'project'], bool: ['marathon', 'force'], positionals: 0, usage: 'usage: cli.js handoff [--marathon] [--force] [--run <id>] [--project <dir>]' }
};

function parseArgs(argv) {
  const [verb, ...rest] = argv;
  const spec = Object.hasOwn(FLAGS, verb) ? FLAGS[verb] : null;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = rest[i + 1];
      if (!spec) { // unknown verb: main reports it; parse loosely
        if (next !== undefined && !next.startsWith('--')) { flags[name] = next; i++; } else flags[name] = true;
      } else if (spec.value.includes(name)) {
        if (next === undefined || next.startsWith('--')) fail(`${spec.usage}\n  --${name} needs a value`);
        if (spec.repeat?.includes(name)) (flags[name] ||= []).push(next);
        else flags[name] = next;
        i++;
      } else if (spec.bool.includes(name)) {
        flags[name] = true;
      } else {
        fail(`${spec.usage}\n  unknown flag --${name}`);
      }
    } else {
      if (spec && positional.length >= spec.positionals) {
        fail(`${spec.usage}\n  unexpected argument "${a}"${spec.positionals === 0 ? ' (use --run <id>)' : ''}`);
      }
      positional.push(a);
    }
  }
  return { verb, flags, positional };
}

const out = (obj) => process.stdout.write((typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) + '\n');
const fail = (msg, code = 1) => { throw new CliExit(msg, code); };

function resolveProjectDir(flags) {
  if (typeof flags.project === 'string') return path.resolve(flags.project);
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (top) return top;
  } catch { /* no git, or not a git checkout: look for a marker instead */ }
  const cwd = process.cwd();
  let home = path.resolve(os.homedir());
  try { home = realpathSync(home); } catch { /* keep the unresolved path */ }
  for (let d = cwd; ; d = path.dirname(d)) {
    const isHome = d === home; // every Claude Code user has ~/.claude: it is not a project marker
    if ((!isHome && existsSync(path.join(d, '.claude'))) || existsSync(path.join(d, '.git'))) return d;
    if (isHome || path.dirname(d) === d) break;
  }
  process.stderr.write(`bbs: warning: no git checkout found, using ${cwd} as the project root (pass --project to override)\n`);
  return cwd;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks); // raw bytes: identity must match --paste-file for the same input
}

async function resolveRun(projectDir, flags, cfg) {
  let id;
  const fromFlag = typeof flags.run === 'string';
  if (fromFlag) id = RUN_ID.test(flags.run) ? flags.run.toLowerCase() : flags.run;
  else {
    id = await activeRunId(projectDir);
    if (!id) fail('no active run — start one with `cli.js intake <source>` or pass --run <id>');
  }
  if (!RUN_ID.test(id)) fail(invalidRunId(id));
  const dir = runDirOf(projectDir, id, cfg);
  if (!path.resolve(dir).startsWith(path.resolve(runsDirOf(projectDir, cfg)) + path.sep)) fail(invalidRunId(id));
  try { await fs.stat(dir); } catch {
    const rel = path.relative(projectDir, runsDirOf(projectDir, cfg)).split(path.sep).join('/');
    if (fromFlag) fail(`unknown run "${id}" — no directory under ${rel}/; omit --run to use the active run`);
    const activeRel = path.relative(projectDir, path.join(runsDirOf(projectDir, cfg), '..', 'ACTIVE')).split(path.sep).join('/');
    fail(`active run "${id}" (from ${activeRel}) has no directory under ${rel}/; start one with \`cli.js intake <source>\` or pass --run <id>`);
  }
  return { id, dir };
}

function warnStatusWrite(id, err) {
  process.stderr.write(`bbs: warning: could not write ${id}/status.md (${err.code || err.message})\n`);
}

/** A --flag value that must be a positive integer; undefined when the flag is absent. */
function positiveInt(flags, name, usage) {
  const v = flags[name];
  if (v === undefined) return undefined;
  const n = Number(v);
  if (typeof v !== 'string' || !/^[1-9][0-9]*$/.test(v) || !Number.isSafeInteger(n)) {
    fail(`${usage}\n  --${name} must be a positive integer, got "${v}"`);
  }
  return n;
}

const VERBS = {
  async intake({ flags, positional, projectDir, cfg }) {
    const source = positional.find(p => typeof p === 'string');
    if (!source && typeof flags['paste-file'] !== 'string') fail(INTAKE_USAGE);
    if (typeof flags['paste-file'] === 'string' && source !== undefined && source !== '-') {
      fail(`${INTAKE_USAGE}\n  --paste-file takes the paste from the file: drop "${source}" or pass "-"`);
    }
    const pasteFile = typeof flags['paste-file'] === 'string' ? flags['paste-file'] : undefined;
    const stdin = source === '-' && !pasteFile ? await readStdin() : undefined;
    const result = await intake(projectDir, source ?? '-', {
      stdin, pasteFile,
      as: typeof flags.as === 'string' ? flags.as : undefined,
      slug: typeof flags.slug === 'string' ? flags.slug : undefined,
      run: typeof flags.run === 'string' ? flags.run : undefined,
      cfg
    });
    out(result);
  },

  async fetch({ flags, projectDir, cfg }) {
    const usage = FLAGS.fetch.usage;
    const maxBytes = positiveInt(flags, 'max-bytes', usage);
    const maxUrls = positiveInt(flags, 'max-links', usage);
    const { id, dir } = await resolveRun(projectDir, flags, cfg);
    try {
      out(await fetchRun(projectDir, { run: id, cfg, maxBytes, maxUrls }));
    } finally {
      const { writeError } = await renderStatusSafe(dir);
      if (writeError) warnStatusWrite(id, writeError);
    }
  },

  async status({ flags, projectDir, cfg }) {
    const { id, dir } = await resolveRun(projectDir, flags, cfg);
    const { md, writeError } = await renderStatusSafe(dir);
    if (writeError) warnStatusWrite(id, writeError);
    if (flags.next) out(nextStep(await loadState(dir)));
    else process.stdout.write(md);
  },

  async report({ flags, projectDir, cfg }) {
    const { id, dir } = await resolveRun(projectDir, flags, cfg);
    const { writeError } = await renderStatusSafe(dir);
    if (writeError) warnStatusWrite(id, writeError);
    const s = summary(await loadState(dir));
    out(`found=${s.found} approved=${s.approved} skipped=${s.skip} buy=${s.buy} marathon=${s.marathon || 'none'}`);
  },

  async inventory({ flags, positional, projectDir, cfg }) {
    const usage = FLAGS.inventory.usage;
    const hasBrief = !!flags.brief;
    const hasFrom = typeof flags.from === 'string';
    if (!hasBrief && !hasFrom) fail(`${usage}\n  inventory needs exactly one of --brief or --from <file|->`);
    if (hasBrief && hasFrom) fail(`${usage}\n  inventory needs exactly one of --brief or --from <file|->`);

    const { id, dir } = await resolveRun(projectDir, flags, cfg);

    if (hasBrief) {
      // Print the brief for the active run
      const source = await readJson(path.join(dir, 'source.json'));
      const files = await listSourceFiles(dir, source, { maxFiles: cfg.limits.max_files });
      const brief = inventoryBrief({ source, files, maxPowers: cfg.limits.max_powers });
      process.stdout.write(brief + '\n');
    } else {
      // Read from file and write powers.json
      let input;
      if (flags.from === '-') {
        input = await readStdin();
      } else {
        try {
          input = await fs.readFile(flags.from, 'utf-8');
        } catch (err) {
          if (err.code === 'ENOENT') fail(`file not found: ${flags.from}`);
          fail(`could not read ${flags.from}: ${err.message}`);
        }
      }
      const label = flags.from === '-' ? '--from - (stdin)' : `--from ${flags.from}`;
      const result = await writeInventory(projectDir, { run: id, input, force: !!flags.force, now: () => new Date(), cfg, label });
      out(result);
      if (result.warning) {
        // powers.json is already written: report, exit 0, and do not re-render over the unreadable file
        process.stderr.write(`bbs: warning: ${result.warning}\n`);
        return;
      }
    }

    const { writeError } = await renderStatusSafe(dir);
    if (writeError) warnStatusWrite(id, writeError);
  },

  async map({ flags, projectDir, cfg }) {
    const usage = FLAGS.map.usage;
    const hasBrief = !!flags.brief;
    const hasFrom = typeof flags.from === 'string';
    if (hasBrief && hasFrom) fail(`${usage}\n  map needs at most one of --brief or --from <file|->`);

    const { id, dir } = await resolveRun(projectDir, flags, cfg);

    try {
      if (hasBrief) {
        // Print the brief for the user to judge
        const brief = await mapBrief(projectDir, { run: id }, cfg);
        process.stdout.write(brief + '\n');
      } else if (hasFrom) {
        // Read judgments from file and record them
        let input;
        if (flags.from === '-') {
          const buf = await readStdin();
          input = buf.toString('utf-8');
        } else {
          try {
            input = await fs.readFile(flags.from, 'utf-8');
          } catch (err) {
            if (err.code === 'ENOENT') fail(`file not found: ${flags.from}`);
            fail(`could not read ${flags.from}: ${err.message}`);
          }
        }
        const label = flags.from === '-' ? '--from - (stdin)' : `--from ${flags.from}`;
        const result = await recordJudgments(projectDir, { run: id, input, now: () => new Date(), force: !!flags.force, cfg, label });
        out(result);
        if (result.warning) process.stderr.write(`bbs: warning: ${result.warning}\n`);
      } else {
        // Build the map
        const result = await buildMap(projectDir, { run: id, now: () => new Date(), force: !!flags.force, cfg });
        out(result);
        if (result.warning) process.stderr.write(`bbs: warning: ${result.warning}\n`);
      }
    } catch (err) {
      // The verb failed: re-render status so it names the real state. On success the library already rendered once.
      try {
        const { writeError } = await renderStatusSafe(dir);
        if (writeError) warnStatusWrite(id, writeError);
      } catch { /* the original error is the one to report */ }
      throw err;
    }
  },

  async usage({ flags, projectDir, cfg }) {
    const usage = FLAGS.usage.usage;
    const days = positiveInt(flags, 'days', usage);
    if (flags.workflows !== undefined && (flags.root !== undefined || days !== undefined)) {
      fail(`${usage}\n  --workflows is the owner's own list: it takes no --root or --days`);
    }
    const { id, dir } = await resolveRun(projectDir, flags, cfg);
    try {
      out(await recordUsage(projectDir, { run: id, roots: flags.root, days, workflows: flags.workflows, force: !!flags.force, cfg }));
    } finally {
      const { writeError } = await renderStatusSafe(dir);
      if (writeError) warnStatusWrite(id, writeError);
    }
  },

  async handoff({ flags, projectDir, cfg }) {
    const { id, dir } = await resolveRun(projectDir, flags, cfg);
    try {
      out(await buildHandoff(projectDir, { run: id, now: () => new Date(), force: !!flags.force, marathon: !!flags.marathon, cfg }));
    } finally {
      const { writeError } = await renderStatusSafe(dir);
      if (writeError) warnStatusWrite(id, writeError);
    }
  },

  async verdict({ flags, projectDir, cfg }) {
    const usage = FLAGS.verdict.usage;
    const modes = ['table', 'probe', 'decide', 'from'].filter(m => flags[m] !== undefined);
    if (modes.length > 1) fail(`${usage}\n  verdict takes at most one of --table, --probe, --decide or --from (got ${modes.map(m => '--' + m).join(', ')})`);
    if (flags.evidence !== undefined && flags.probe === undefined) fail(`${usage}\n  --evidence goes with --probe`);
    const probe = flags.probe !== undefined ? powerPair(flags, 'probe', '<power>=<clean|found|incomplete>', usage) : null;
    const decide = flags.decide !== undefined ? powerPair(flags, 'decide', '<power>=<verdict>', usage) : null;
    const sandboxOverride = sandboxFromEnv(); // checked before anything runs, whatever the mode

    const { id, dir } = await resolveRun(projectDir, flags, cfg);
    const force = !!flags.force;
    const now = () => new Date();
    try {
      let result;
      if (probe) {
        result = await recordProbe(projectDir, { run: id, power: probe[0], result: probe[1], evidence: flags.evidence, now, force, cfg, sandbox: useSandboxOverride(sandboxOverride) });
      } else if (decide || typeof flags.from === 'string') {
        let input;
        let label = 'decisions';
        if (decide) {
          input = JSON.stringify({ [decide[0]]: decide[1] });
          label = `--decide ${flags.decide}`;
        } else if (flags.from === '-') {
          input = (await readStdin()).toString('utf-8');
          label = '--from - (stdin)';
        } else {
          try { input = await fs.readFile(flags.from, 'utf-8'); } catch (err) {
            if (err.code === 'ENOENT') fail(`file not found: ${flags.from}`);
            fail(`could not read ${flags.from}: ${err.message}`);
          }
          label = `--from ${flags.from}`;
        }
        result = await recordDecisions(projectDir, { run: id, input, now, force, cfg, label, sandbox: useSandboxOverride(sandboxOverride) });
      } else if (flags.table) {
        // A view: print the recorded table when there is one, so viewing never re-runs the sandbox check
        const existing = force ? null : await readJson(path.join(dir, 'verdicts.json'));
        if (existing && existing.rows) { out(verdictTable(existing.rows)); return; }
        const computed = await computeVerdicts(projectDir, { run: id, sandbox: useSandboxOverride(sandboxOverride), now, force, cfg });
        out(computed.table);
        warnSandboxOverride(sandboxOverride);
        if (computed.warning) process.stderr.write(`bbs: warning: ${computed.warning}\n`);
        return;
      } else {
        result = await computeVerdicts(projectDir, { run: id, sandbox: useSandboxOverride(sandboxOverride), now, force, cfg });
      }
      out(result);
      warnSandboxOverride(sandboxOverride);
      if (result.warning) process.stderr.write(`bbs: warning: ${result.warning}\n`);
    } catch (err) {
      // The verb failed: re-render status so it names the real state. On success the library already rendered once.
      try {
        const { writeError } = await renderStatusSafe(dir);
        if (writeError) warnStatusWrite(id, writeError);
      } catch { /* the original error is the one to report */ }
      throw err;
    }
  }
};

/** Split a `<power>=<value>` flag value at its last `=`; fail naming the expected shape. */
function powerPair(flags, name, shape, usage) {
  const v = flags[name];
  const at = typeof v === 'string' ? v.lastIndexOf('=') : -1;
  if (at <= 0 || at === v.length - 1) fail(`${usage}\n  --${name} needs ${shape}, got "${v}"`);
  return [v.slice(0, at), v.slice(at + 1)];
}

/**
 * BBS_SANDBOX=absent marks the sandbox missing (the safe direction); unset or empty → undefined (real detection).
 * Any other value — `present` above all — exits 1: the sandbox can be assumed missing, never present.
 */
function sandboxFromEnv() {
  const v = process.env.BBS_SANDBOX;
  if (v === undefined || v === '') return undefined;
  if (v === 'absent') return { present: false, kind: null, reason: 'no sandbox on this machine: BBS_SANDBOX=absent' };
  fail('BBS_SANDBOX may only be "absent" (the sandbox can be assumed missing, never present); unset it to run real detection');
}

/**
 * The override as passed to computeVerdicts. The stderr warning is written by warnSandboxOverride once the verb
 * has succeeded, so a refusal (exit 2) starts its stderr with `bbs: refused:` and nothing before it.
 */
function useSandboxOverride(override) {
  return override;
}

function warnSandboxOverride(override) {
  if (override) process.stderr.write('bbs: warning: sandbox detection overridden by BBS_SANDBOX=absent\n');
}

async function main(argv) {
  const { verb, flags, positional } = parseArgs(argv);
  if (!Object.hasOwn(VERBS, verb)) {
    // Verbs in step order (the six steps, then the read-only verbs), so usage reads like the flow.
    const order = ['intake', 'fetch', 'inventory', 'map', 'usage', 'verdict', 'handoff', 'status', 'report'];
    const verbs = [...order.filter(v => VERBS[v]), ...Object.keys(VERBS).filter(v => !order.includes(v))];
    const lines = verbs.map(v => '  ' + (FLAGS[v] ? FLAGS[v].usage.replace(/^usage: /, '') : `cli.js ${v}`));
    fail([`usage: cli.js <${verbs.join('|')}> ...`, ...lines, '  <source> may be - to read a paste from stdin'].join('\n'));
  }
  const projectDir = resolveProjectDir(flags);
  const cfg = await loadConfig(projectDir);
  await VERBS[verb]({ flags, positional, projectDir, cfg });
}

function isMain() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  try { return realpathSync(self) === realpathSync(process.argv[1]); }
  catch { return self === path.resolve(process.argv[1]); }
}

if (isMain()) {
  main(process.argv.slice(2)).catch((err) => {
    if (err instanceof EgressRefused || err?.code === 'EGRESS_REFUSED' || err instanceof PolicyRefused || err?.code === 'POLICY_REFUSED') {
      process.stderr.write(`bbs: refused: ${err.message}\n`);
      process.exitCode = 2;
    } else if (err instanceof CliExit) {
      process.stderr.write(err.message.startsWith('usage:') ? err.message + '\n' : `bbs: ${err.message}\n`);
      process.exitCode = err.code;
    } else {
      process.stderr.write(`bbs: ${err.message}\n`);
      process.exitCode = 1;
    }
  });
}

export { main, parseArgs, VERBS };
