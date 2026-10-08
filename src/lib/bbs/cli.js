#!/usr/bin/env node
/**
 * bbs helper CLI — `node cli.js <verb> [flags]`.
 * Verbs here: intake · fetch · status · report. Later streams add inventory, map, verdict, handoff
 * by registering them in VERBS.
 *
 * Exit codes: 0 ok · 1 invalid input / broken state · 2 policy refusals (egress refused).
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
  map: { value: ['from', 'run', 'project'], bool: ['brief', 'force'], positionals: 0, usage: 'usage: cli.js map [--brief | --from <file|->] [--force] [--run <id>] [--project <dir>]' }
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
        flags[name] = next; i++;
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
        const result = await recordJudgments(projectDir, { run: id, input, now: () => new Date(), force: !!flags.force, cfg });
        out(result);
      } else {
        // Build the map
        const result = await buildMap(projectDir, { run: id, now: () => new Date(), force: !!flags.force, cfg });
        out(result);
      }
    } finally {
      const { writeError } = await renderStatusSafe(dir);
      if (writeError) warnStatusWrite(id, writeError);
    }
  }
};

async function main(argv) {
  const { verb, flags, positional } = parseArgs(argv);
  if (!Object.hasOwn(VERBS, verb)) {
    // Verbs in step order (the six steps, then the read-only verbs), so usage reads like the flow.
    const order = ['intake', 'fetch', 'inventory', 'map', 'verdict', 'handoff', 'status', 'report'];
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
    if (err instanceof EgressRefused || err?.code === 'EGRESS_REFUSED') {
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
