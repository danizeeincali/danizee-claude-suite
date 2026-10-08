#!/usr/bin/env node
/**
 * bbs helper CLI — `node cli.js <verb> [flags]`.
 * Verbs here: intake · status · report. Later streams add fetch, inventory, map, verdict, handoff
 * by registering them in VERBS.
 *
 * Exit codes: 0 ok · 1 invalid input / broken state · 2 reserved for policy refusals.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { loadConfig } from './config.js';
import { runDir as runDirOf, runsDir as runsDirOf, activeRunId } from './store.js';
import { intake, RUN_ID } from './intake.js';
import { loadState, nextStep, summary, renderStatusFile } from './status.js';

class CliExit extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const INTAKE_USAGE = 'usage: cli.js intake <source> [--paste-file <p>] [--as repo|url|local|paste] [--slug <s>] [--run <id>] [--project <dir>]';

/** Flags each verb accepts: value flags need a value, boolean flags take none. */
const FLAGS = {
  intake: { value: ['run', 'project', 'as', 'slug', 'paste-file'], bool: [], usage: INTAKE_USAGE },
  status: { value: ['run', 'project'], bool: ['next'], usage: 'usage: cli.js status [--run <id>] [--next] [--project <dir>]' },
  report: { value: ['run', 'project'], bool: [], usage: 'usage: cli.js report [--run <id>] [--project <dir>]' }
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
    } else positional.push(a);
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
  } catch { /* not a git checkout */ }
  return process.cwd();
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf-8');
}

async function resolveRun(projectDir, flags, cfg) {
  let id;
  if (typeof flags.run === 'string') id = flags.run;
  else {
    id = await activeRunId(projectDir);
    if (!id) fail('no active run — start one with `cli.js intake <source>` or pass --run <id>');
  }
  if (!RUN_ID.test(id)) fail(`invalid run id "${id}"`);
  const dir = runDirOf(projectDir, id, cfg);
  if (!path.resolve(dir).startsWith(path.resolve(runsDirOf(projectDir, cfg)) + path.sep)) fail(`invalid run id "${id}"`);
  try { await fs.stat(dir); } catch { fail(`unknown run "${id}"`); }
  return { id, dir };
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

  async status({ flags, projectDir, cfg }) {
    const { dir } = await resolveRun(projectDir, flags, cfg);
    const md = await renderStatusFile(dir);
    if (flags.next) out(nextStep(await loadState(dir)));
    else process.stdout.write(md);
  },

  async report({ flags, projectDir, cfg }) {
    const { dir } = await resolveRun(projectDir, flags, cfg);
    await renderStatusFile(dir);
    const s = summary(await loadState(dir));
    out(`found=${s.found} approved=${s.approved} skipped=${s.skip} buy=${s.buy} marathon=${s.marathon || 'none'}`);
  }
};

async function main(argv) {
  const { verb, flags, positional } = parseArgs(argv);
  if (!Object.hasOwn(VERBS, verb)) {
    fail(`usage: cli.js <${Object.keys(VERBS).join('|')}> [--run <id>] [flags]`);
  }
  const projectDir = resolveProjectDir(flags);
  const cfg = await loadConfig(projectDir);
  await VERBS[verb]({ flags, positional, projectDir, cfg });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => {
    if (err instanceof CliExit) {
      process.stderr.write(err.message.startsWith('usage:') ? err.message + '\n' : `bbs: ${err.message}\n`);
      process.exitCode = err.code;
    } else {
      process.stderr.write(`bbs: ${err.message}\n`);
      process.exitCode = 1;
    }
  });
}

export { main, parseArgs, VERBS };
