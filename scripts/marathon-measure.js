#!/usr/bin/env node
/**
 * Record the three measured finish-line lines for one kit stream of a marathon run:
 *   packaged_<stream>     the stream's packaged check (node --test <file>) passes
 *   egress_zero_<stream>  that check passed AND the no-egress preload logged nothing
 *   callers_<stream>      installed harness files (commands, hooks, skills, other helpers) that call the verb
 *                         or import the module — the module itself and kit/cli.js are not callers
 *
 * usage: node scripts/marathon-measure.js --stream <name> --verb <verb> --module <file.js> --test <path>
 *          [--run <id>] [--dry]
 * Prints one JSON object; with --dry nothing is recorded.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    const k = argv[i].slice(2);
    if (k === 'dry') { out.dry = true; continue; }
    out[k] = argv[++i];
  }
  for (const k of ['stream', 'verb', 'module', 'test']) if (!out[k]) throw new Error(`--${k} is required`);
  return out;
}

async function walk(dir) {
  const out = [];
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Files under an installed .claude that call `kit/cli.js <verb>` or import the kit module. */
export async function countCallers(claudeDir, verb, moduleFile) {
  const self = path.join(claudeDir, 'helpers', 'kit', moduleFile);
  const cli = path.join(claudeDir, 'helpers', 'kit', 'cli.js');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const callsVerb = new RegExp(`kit/cli\\.js\\s+${esc(verb)}\\b`);
  const imports = new RegExp(`from\\s+['"][^'"]*(?:kit/|\\./)${esc(moduleFile)}['"]|import\\(\\s*['"][^'"]*(?:kit/|\\./)${esc(moduleFile)}['"]`);
  const callers = [];
  for (const f of await walk(claudeDir)) {
    if (f === self || f === cli) continue;
    if (!/\.(md|js|mjs|sh|json)$/.test(f)) continue;
    const text = await fsp.readFile(f, 'utf-8');
    const inKit = path.dirname(f) === path.dirname(self);
    if (callsVerb.test(text) || (imports.test(text) && (inKit || /kit\//.test(text.match(imports)[0])))) callers.push(path.relative(claudeDir, f));
  }
  return callers.sort();
}

async function main() {
  const a = args(process.argv.slice(2));
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'kit-measure-'));
  const log = path.join(tmp, 'egress.jsonl');
  try {
    const t = spawnSync(process.execPath, ['--test', a.test], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, KIT_EGRESS_LOG: log } });
    const packaged = t.status === 0;
    const egress = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean) : [];
    const egressZero = packaged && egress.length === 0;

    const project = path.join(tmp, 'project');
    await fsp.mkdir(project);
    const { DaniZeeSuiteInstaller } = await import(path.join(ROOT, 'src', 'installer.js'));
    const res = await new DaniZeeSuiteInstaller({ path: project, force: true, withoutCookbook: true }).install();
    if (!res.success) throw new Error('suite install failed');
    const callers = await countCallers(path.join(project, '.claude'), a.verb, a.module);

    const out = {
      stream: a.stream,
      packaged,
      egress_zero: egressZero,
      egress_rows: egress.slice(0, 5),
      callers: callers.length,
      caller_files: callers,
      test_tail: packaged ? undefined : (t.stdout + t.stderr).split('\n').filter(l => /not ok|Error|error:/.test(l)).slice(0, 10)
    };
    if (!a.dry) {
      const cli = path.join(ROOT, '.claude', 'helpers', 'marathon', 'cli.js');
      const run = a.run ? ['--run', a.run] : [];
      for (const [key, value] of [[`packaged_${a.stream}`, packaged], [`egress_zero_${a.stream}`, egressZero], [`callers_${a.stream}`, callers.length]]) {
        const r = spawnSync(process.execPath, [cli, 'record', 'measure', `key=${key}`, `value=${value}`, ...run], { cwd: ROOT, encoding: 'utf-8' });
        if (r.status !== 0) throw new Error(`record measure ${key} failed: ${r.stderr.trim()}`);
      }
      out.recorded = true;
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main().catch(err => { process.stderr.write(`marathon-measure: ${err.message}\n`); process.exitCode = 1; });
