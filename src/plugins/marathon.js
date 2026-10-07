/**
 * Marathon Plugin for Danizee Claude Suite
 * Installs the /w-marathon helper library, the PreCompact / SessionStart hooks,
 * the reviewer kit, the standing rules and a default marathon.json.
 *
 * The library is copied verbatim into .claude/helpers/marathon/ so a target project
 * needs no npm package to run `node .claude/helpers/marathon/cli.js <verb>`.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_CONFIG } from '../lib/marathon/config.js';
import { readSettings, writeSettings, unmergeHooks } from '../utils/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIB_DIR = path.join(__dirname, '..', 'lib', 'marathon');
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'marathon');

const HOOK_FILES = ['marathon-precompact.sh', 'marathon-session-start.sh'];

/**
 * Hook entries merged into .claude/settings.json (idempotently, by command string).
 * Claude Code runs hook commands with $CLAUDE_PROJECT_DIR set; resolving from it rather
 * than the cwd keeps the hooks working when a session starts in a subdirectory.
 */
export function getHookEntries() {
  const hook = (name) => `bash "\${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/${name}"`;
  return {
    PreCompact: [
      { hooks: [{ type: 'command', command: hook('marathon-precompact.sh') }] }
    ],
    SessionStart: [
      { matcher: 'compact', hooks: [{ type: 'command', command: hook('marathon-session-start.sh') }] }
    ]
  };
}

export function getNamespace() {
  return 'marathon';
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Install the marathon plugin. With dryRun it only reports what it would write.
 */
export async function install(claudeDir, options = {}) {
  const dry = !!options.dryRun;
  const files = [];
  const plan = []; // [dest, content, mode?, onlyIfAbsent]

  const libFiles = (await fs.readdir(LIB_DIR)).filter(f => f.endsWith('.js'));
  for (const f of libFiles) {
    plan.push([path.join(claudeDir, 'helpers', 'marathon', f), await fs.readFile(path.join(LIB_DIR, f), 'utf-8'), undefined, false]);
    files.push(`helpers/marathon/${f}`);
  }

  for (const h of HOOK_FILES) {
    plan.push([path.join(claudeDir, 'hooks', h), await fs.readFile(path.join(TEMPLATES_DIR, h), 'utf-8'), 0o755, false]);
    files.push(`hooks/${h}`);
  }

  // Project config and the human-owned seeds are written once, never overwritten
  const runsDir = path.join(claudeDir, 'marathon');
  plan.push([path.join(claudeDir, 'marathon.json'), JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', undefined, true]);
  plan.push([path.join(runsDir, '.gitkeep'), '# Marathon runs live here: one folder per run-id\n', undefined, true]);
  for (const f of ['severity.md', 'angles.md']) {
    plan.push([path.join(runsDir, 'reviewer', f), await fs.readFile(path.join(TEMPLATES_DIR, 'reviewer', f), 'utf-8'), undefined, true]);
  }
  for (const f of ['rules.md', 'finish-line.example.json']) {
    plan.push([path.join(runsDir, f), await fs.readFile(path.join(TEMPLATES_DIR, f), 'utf-8'), undefined, true]);
  }

  for (const [dest, content, mode, onlyIfAbsent] of plan) {
    const rel = path.relative(claudeDir, dest);
    if (onlyIfAbsent && await exists(dest)) continue;
    if (onlyIfAbsent) files.push(rel);
    if (dry) continue;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content, mode ? { mode } : 'utf-8');
    if (mode) await fs.chmod(dest, mode);
  }

  // Machine-local state never belongs in git: the ACTIVE pointer (a stream worktree would carry a
  // stale copy), wake logs, lock and temp files, and quarantined corrupt rows. Add the rules once.
  if (!dry && options.targetDir) {
    const gi = path.join(options.targetDir, '.gitignore');
    const current = (await exists(gi)) ? await fs.readFile(gi, 'utf-8') : '';
    const have = new Set(current.split('\n').map(l => l.trim()));
    const rules = ['.claude/marathon/ACTIVE', '.claude/marathon/*/wake.log', '.claude/marathon/*/*.lock', '.claude/marathon/*/store/*.lock',
      '.claude/marathon/*/*.tmp', '.claude/marathon/*/store/*.tmp', '.claude/marathon/*/store/*.corrupt'];
    const missing = rules.filter(r => !have.has(r));
    if (missing.length) {
      const sep = current.length && !current.endsWith('\n') ? '\n' : '';
      await fs.writeFile(gi, `${current}${sep}\n# Marathon: machine-local state (active-run pointer, wake logs, locks, quarantined rows)\n${missing.join('\n')}\n`, 'utf-8');
      files.push(`.gitignore (+ ${missing.length} marathon rules)`);
    }
  }

  return {
    plugin: 'marathon',
    namespace: getNamespace(),
    files,
    hooks: getHookEntries()
  };
}

/**
 * Installed when the helper CLI is present
 */
export async function isInstalled(claudeDir) {
  return exists(path.join(claudeDir, 'helpers', 'marathon', 'cli.js'));
}

/**
 * Remove helpers, hooks and the hook entries in settings.json.
 * Run data under .claude/marathon/<run-id>/ is the user's and stays.
 */
export async function uninstall(claudeDir) {
  try { await fs.rm(path.join(claudeDir, 'helpers', 'marathon'), { recursive: true }); } catch {}
  for (const h of HOOK_FILES) {
    try { await fs.unlink(path.join(claudeDir, 'hooks', h)); } catch {}
  }
  const settings = await readSettings(claudeDir);
  if (settings.hooks) {
    settings.hooks = unmergeHooks(settings.hooks, getHookEntries());
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    await writeSettings(claudeDir, settings);
  }
}

export default {
  getHookEntries,
  getNamespace,
  install,
  isInstalled,
  uninstall
};
