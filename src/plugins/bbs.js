/**
 * BBS Plugin (Beg, borrow, steal) for Danizee Claude Suite
 * Installs the /w-bbs helper library and a default bbs.json. No hooks.
 *
 * The library is copied verbatim into .claude/helpers/bbs/ so a target project
 * needs no npm package to run `node .claude/helpers/bbs/cli.js <verb>`.
 * handoff --marathon imports the marathon library by the sibling path ../marathon/,
 * which the marathon plugin creates. So that bbs's own modules load even without the marathon plugin, the
 * marathon library modules (never its cli.js) are copied beside them when absent; `handoff --marathon`
 * still needs marathon/cli.js and says so when it is missing.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_CONFIG } from '../lib/bbs/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB_DIR = path.join(__dirname, '..', 'lib', 'bbs');
const MARATHON_LIB_DIR = path.join(__dirname, '..', 'lib', 'marathon');

export function getNamespace() {
  return 'bbs';
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Install the bbs plugin. With dryRun it only reports what it would write.
 */
export async function install(claudeDir, options = {}) {
  const dry = !!options.dryRun;
  const files = [];
  const plan = []; // [dest, content, onlyIfAbsent]

  const libFiles = (await fs.readdir(LIB_DIR)).filter(f => f.endsWith('.js')).sort();
  for (const f of libFiles) {
    plan.push([path.join(claudeDir, 'helpers', 'bbs', f), await fs.readFile(path.join(LIB_DIR, f), 'utf-8'), false]);
    files.push(`helpers/bbs/${f}`);
  }

  // handoff.js imports ../marathon/{gate,config}.js (and their siblings); never overwrite the marathon plugin's copy.
  // cli.js is left out on purpose: its presence is what marks the marathon plugin installed.
  for (const f of (await fs.readdir(MARATHON_LIB_DIR)).filter(f => f.endsWith('.js') && f !== 'cli.js').sort()) {
    plan.push([path.join(claudeDir, 'helpers', 'marathon', f), await fs.readFile(path.join(MARATHON_LIB_DIR, f), 'utf-8'), true]);
  }

  // Project config and the run-data folder marker are written once, never overwritten
  plan.push([path.join(claudeDir, 'bbs.json'), JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', true]);
  plan.push([path.join(claudeDir, 'bbs', '.gitkeep'), '# BBS runs live here: one folder per run-id\n', true]);

  for (const [dest, content, onlyIfAbsent] of plan) {
    const rel = path.relative(claudeDir, dest);
    if (onlyIfAbsent && await exists(dest)) continue;
    if (onlyIfAbsent) files.push(rel);
    if (dry) continue;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content, 'utf-8');
  }

  // fetched/ holds foreign source and must never be committed; the rest is machine-local state.
  if (!dry && options.targetDir) {
    const gi = path.join(options.targetDir, '.gitignore');
    const current = (await exists(gi)) ? await fs.readFile(gi, 'utf-8') : '';
    const have = new Set(current.split('\n').map(l => l.trim()));
    const rules = ['.claude/bbs/ACTIVE', '.claude/bbs/runs/*/fetched/', '.claude/bbs/runs/*/map.lock', '.claude/bbs/runs/*/*.tmp'];
    const missing = rules.filter(r => !have.has(r));
    if (missing.length) {
      const sep = current.length && !current.endsWith('\n') ? '\n' : '';
      await fs.writeFile(gi, `${current}${sep}\n# BBS: fetched/ holds foreign source and is never committed; the rest is machine-local state (active-run pointer, lock, temp files)\n${missing.join('\n')}\n`, 'utf-8');
      files.push(`.gitignore (+ ${missing.length} bbs rules)`);
    }
  }

  return { plugin: 'bbs', namespace: getNamespace(), files };
}

/**
 * Installed when the helper CLI is present
 */
export async function isInstalled(claudeDir) {
  return exists(path.join(claudeDir, 'helpers', 'bbs', 'cli.js'));
}

/**
 * Remove the helpers only. Run data under .claude/bbs/ and bbs.json are the user's and stay.
 */
export async function uninstall(claudeDir) {
  try { await fs.rm(path.join(claudeDir, 'helpers', 'bbs'), { recursive: true }); } catch {}
}

export default { getNamespace, install, isInstalled, uninstall };
