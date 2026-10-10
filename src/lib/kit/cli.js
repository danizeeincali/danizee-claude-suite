#!/usr/bin/env node
/**
 * kit helper CLI — `node cli.js <verb> [args]`.
 * Verbs are discovered: every sibling module that exports `verb` (a string) and `run(args, io)` is one verb.
 * `run` returns a JSON-serialisable result or throws a KitExit. Output is JSON on stdout, errors on stderr.
 * Built from ideas audited by /w-bbs (run 2026-10-10-openqodex-2); no foreign code.
 *
 * Exit codes: 0 ok · 1 invalid input / broken state · 2 policy refusal (the verb said no).
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { KitExit } from './kit-exit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Map of verb → module, from the sibling modules that export a verb. */
export async function loadVerbs(dir = HERE) {
  const verbs = new Map();
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.js') && f !== 'cli.js' && f !== 'kit-exit.js').sort();
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    if (typeof mod.verb !== 'string' || typeof mod.run !== 'function') continue;
    if (verbs.has(mod.verb)) throw new Error(`verb "${mod.verb}" is exported by ${verbs.get(mod.verb).file} and ${f}`);
    verbs.set(mod.verb, { file: f, run: mod.run, usage: mod.usage || `cli.js ${mod.verb}` });
  }
  return verbs;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf-8');
}

export async function main(argv = process.argv.slice(2)) {
  const verbs = await loadVerbs();
  const [verb, ...args] = argv;
  if (!verb || verb === '--help' || verb === 'help') {
    process.stdout.write(JSON.stringify({ verbs: [...verbs.keys()], usage: [...verbs.values()].map(v => v.usage) }, null, 2) + '\n');
    return 0;
  }
  const entry = verbs.get(verb);
  if (!entry) {
    process.stderr.write(`kit: unknown verb "${verb}" — known: ${[...verbs.keys()].join(', ') || 'none'}\n`);
    return 1;
  }
  try {
    const result = await entry.run(args, { cwd: process.cwd(), stdin: readStdin, stdinIsTTY: !!process.stdin.isTTY, env: process.env });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result && typeof result.exit === 'number' ? result.exit : 0;
  } catch (err) {
    if (err instanceof KitExit) {
      process.stderr.write(`kit: ${err.code === 2 ? 'refused: ' : ''}${err.message}\n`);
      return err.code;
    }
    process.stderr.write(`kit: ${err.message}\n`);
    return 1;
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main().then(code => { process.exitCode = code; });
