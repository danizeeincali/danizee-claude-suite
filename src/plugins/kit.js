/**
 * Kit Plugin for Danizee Claude Suite
 * Installs the kit helper library (review and safety tools rebuilt from /w-bbs audits) into
 * .claude/helpers/kit/, verbatim, so a target project runs `node .claude/helpers/kit/cli.js <verb>`
 * with no npm package. No hooks or settings of its own: callers live in commands and helpers.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { addGitignoreRules } from '../lib/kit/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The optional SQLite store (see lib/kit/store.js) needs no rule: it lives outside the project, in a per-user folder.
const GITIGNORE_RULES = ['.claude/kit/secrets', '.claude/kit/cache/', '.claude/kit/scrub-patterns.local'];
const LIB_DIR = path.join(__dirname, '..', 'lib', 'kit');

export function getNamespace() {
  return 'kit';
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Copy every library file (.js and data files under lib/kit, recursively) into helpers/kit. */
async function listLib(dir, rel = '') {
  const out = [];
  for (const ent of (await fs.readdir(path.join(dir, rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = path.join(rel, ent.name);
    if (ent.isDirectory()) out.push(...await listLib(dir, r));
    else if (ent.isFile()) out.push(r);
  }
  return out;
}

export async function install(claudeDir, options = {}) {
  const dry = !!options.dryRun;
  const files = [];
  for (const rel of await listLib(LIB_DIR)) {
    const dest = path.join(claudeDir, 'helpers', 'kit', rel);
    files.push(path.join('helpers', 'kit', rel));
    if (dry) continue;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(LIB_DIR, rel), dest);
  }
  // The redact verb reads .claude/kit/secrets: real secret values, never committed. The graph verb caches
  // per-file facts under .claude/kit/cache/: machine-local and rebuilt on demand.
  if (!dry && options.targetDir) {
    const missing = await addGitignoreRules(options.targetDir, GITIGNORE_RULES, "Kit: the redact verb's secret values, the scrub verb's private patterns and the graph verb's fact cache are machine-local and never committed");
    if (missing.length) files.push(`.gitignore (+ ${missing.length} kit rule)`);
  }
  return { plugin: 'kit', namespace: getNamespace(), files };
}

export async function isInstalled(claudeDir) {
  return exists(path.join(claudeDir, 'helpers', 'kit', 'cli.js'));
}

export async function uninstall(claudeDir) {
  try { await fs.rm(path.join(claudeDir, 'helpers', 'kit'), { recursive: true }); } catch {}
}

export default { getNamespace, install, isInstalled, uninstall };
