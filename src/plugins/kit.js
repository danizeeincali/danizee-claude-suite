/**
 * Kit Plugin for Danizee Claude Suite
 * Installs the kit helper library (review and safety tools rebuilt from /w-bbs audits) into
 * .claude/helpers/kit/, verbatim, so a target project runs `node .claude/helpers/kit/cli.js <verb>`
 * with no npm package. No hooks or settings of its own: callers live in commands and helpers.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GITIGNORE_RULES = ['.claude/kit/secrets'];
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
  // The redact verb reads .claude/kit/secrets: real secret values, never committed.
  if (!dry && options.targetDir) {
    const gi = path.join(options.targetDir, '.gitignore');
    const current = (await exists(gi)) ? await fs.readFile(gi, 'utf-8') : '';
    const have = new Set(current.split('\n').map(l => l.trim()));
    const missing = GITIGNORE_RULES.filter(r => !have.has(r));
    if (missing.length) {
      const sep = current.length && !current.endsWith('\n') ? '\n' : '';
      await fs.writeFile(gi, `${current}${sep}\n# Kit: the redact verb's list of secret values is machine-local and never committed\n${missing.join('\n')}\n`, 'utf-8');
      files.push(`.gitignore (+ ${missing.length} kit rule)`);
    }
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
