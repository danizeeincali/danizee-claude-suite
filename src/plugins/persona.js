/**
 * Persona Plugin for Danizee Claude Suite
 * Installs the persona-testing library (a project file, rounds, briefs, a tester connector, a reader and a deck) into
 * .claude/helpers/persona/, verbatim, so a target project runs `node .claude/helpers/persona/cli.js <verb>` with no npm
 * package. The folder `persona-testing/` in the project is the user's: uninstall leaves it alone.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB_DIR = path.join(__dirname, '..', 'lib', 'persona');

export function getNamespace() {
  return 'persona';
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Every file under lib/persona (.js, .sql, .toml), recursively, relative to it. */
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
    const dest = path.join(claudeDir, 'helpers', 'persona', rel);
    files.push(path.join('helpers', 'persona', rel));
    if (dry) continue;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(LIB_DIR, rel), dest);
  }
  return { plugin: 'persona', namespace: getNamespace(), files };
}

export async function isInstalled(claudeDir) {
  return exists(path.join(claudeDir, 'helpers', 'persona', 'cli.js'));
}

/** Removes the helpers only; the project's persona-testing/ folder (project file, keys, reports) stays. */
export async function uninstall(claudeDir) {
  try { await fs.rm(path.join(claudeDir, 'helpers', 'persona'), { recursive: true }); } catch {}
}

export default { getNamespace, install, isInstalled, uninstall };
