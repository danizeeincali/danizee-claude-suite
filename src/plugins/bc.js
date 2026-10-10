/**
 * /bc Plugin for Danizee Claude Suite
 * Installs the /bc helper library and the two compaction hooks, per project or once per user.
 *
 * Per project (`init`): .claude/helpers/bc/, .claude/hooks/bc-{precompact,session-start}.sh, and a
 * .claude/bc.json naming the project's status, kickoff and rules files (written once, never overwritten).
 *
 * Per user (`install-user`): /bc, /bcp and /w-background-compound go to ~/.claude/commands/, the
 * helper and hooks to ~/.claude/helpers/ and ~/.claude/hooks/, and the hook entries to
 * ~/.claude/settings.json. One copy then serves every project; a project only adds .claude/bc.json.
 * The user-level commands carry USER_MARKER so the shadowing check knows them for the suite's own.
 *
 * The helper imports ../marathon/{context,config}.js, so the marathon library is copied beside it
 * at user level (in a project the marathon plugin puts it there).
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_BC_CONFIG } from '../lib/bc/config.js';
import { getCommands } from './dot-shortcuts.js';
import { readSettings, writeSettings, mergeHooks, unmergeHooks } from '../utils/settings.js';
import { SUITE_COPY_MARKER } from '../lib/marathon/shadow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB_DIR = path.join(__dirname, '..', 'lib', 'bc');
const MARATHON_LIB_DIR = path.join(__dirname, '..', 'lib', 'marathon');
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'bc');

const HOOK_FILES = ['bc-precompact.sh', 'bc-session-start.sh'];
export const USER_COMMANDS = ['w-background-compound', 'bc', 'bcp'];
export const USER_MARKER = `<!-- ${SUITE_COPY_MARKER}; reinstall with \`danizee-claude-suite install-user\` -->`;
const USER_PERMISSION = 'Bash(node ~/.claude/helpers/bc/cli.js:*)';

function entries(hookPath) {
  return {
    PreCompact: [
      { hooks: [{ type: 'command', command: hookPath('bc-precompact.sh') }] }
    ],
    SessionStart: [
      { matcher: 'compact', hooks: [{ type: 'command', command: hookPath('bc-session-start.sh') }] }
    ]
  };
}

/**
 * Project hook entries, resolved from $CLAUDE_PROJECT_DIR so a session started in a
 * subdirectory still finds them.
 */
export function getHookEntries() {
  return entries((name) => `bash "\${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/${name}"`);
}

/** User-level hook entries for ~/.claude/settings.json. */
export function getUserHookEntries() {
  return entries((name) => `bash "$HOME/.claude/hooks/${name}"`);
}

export function getNamespace() {
  return 'bc';
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function libPlan(dir, destDir, label) {
  const plan = [];
  for (const f of (await fs.readdir(dir)).filter(f => f.endsWith('.js')).sort()) {
    plan.push({ dest: path.join(destDir, f), content: await fs.readFile(path.join(dir, f), 'utf-8'), rel: `${label}/${f}` });
  }
  return plan;
}

async function hookPlan(hooksDir, label) {
  const plan = [];
  for (const h of HOOK_FILES) {
    plan.push({ dest: path.join(hooksDir, h), content: await fs.readFile(path.join(TEMPLATES_DIR, h), 'utf-8'), mode: 0o755, rel: `${label}/${h}` });
  }
  return plan;
}

async function write(plan, dry) {
  const files = [];
  for (const { dest, content, mode, rel, onlyIfAbsent } of plan) {
    if (onlyIfAbsent && await exists(dest)) continue;
    files.push(rel);
    if (dry) continue;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content, mode ? { mode } : 'utf-8');
    if (mode) await fs.chmod(dest, mode);
  }
  return files;
}

/** The project's starting bc.json: paths only, so thresholds keep resolving through marathon.json. */
export function defaultProjectConfig() {
  const { status, kickoff, rules, memory, db } = DEFAULT_BC_CONFIG;
  return { status, kickoff, rules, memory, db };
}

/**
 * Install the /bc helper and hooks into a project. With dryRun it only reports what it would write.
 */
export async function install(claudeDir, options = {}) {
  const dry = !!options.dryRun;
  const plan = [
    ...await libPlan(LIB_DIR, path.join(claudeDir, 'helpers', 'bc'), 'helpers/bc'),
    ...await hookPlan(path.join(claudeDir, 'hooks'), 'hooks'),
    { dest: path.join(claudeDir, 'bc.json'), content: JSON.stringify(defaultProjectConfig(), null, 2) + '\n', rel: 'bc.json', onlyIfAbsent: true }
  ];
  return {
    plugin: 'bc',
    namespace: getNamespace(),
    files: await write(plan, dry),
    hooks: getHookEntries()
  };
}

/**
 * A suite command rewritten for ~/.claude/commands/: user commands have no `.shortcuts:` namespace.
 */
export function userCommandContent(name) {
  const cmd = getCommands()[name];
  if (!cmd) throw new Error(`unknown suite command ${name}`);
  return `${USER_MARKER}\n${cmd.content.replace(/\.shortcuts:/g, '')}`;
}

/**
 * Install /bc once for the user: commands, helper (+ the marathon library it imports), hooks and
 * the settings entries. Overwrites an earlier suite copy; refuses to overwrite a user's own
 * /bc (one without USER_MARKER) unless force is set, since that file is the shadowing bug.
 */
export async function installUser(homeDir, options = {}) {
  const dry = !!options.dryRun;
  const userClaude = path.join(homeDir, '.claude');
  const commandsDir = path.join(userClaude, 'commands');

  const replaced = [];
  for (const name of USER_COMMANDS) {
    const p = path.join(commandsDir, `${name}.md`);
    if (!(await exists(p))) continue;
    const current = await fs.readFile(p, 'utf-8');
    if (current.includes(USER_MARKER)) continue;
    if (!options.force) {
      throw new Error(`~/.claude/commands/${name}.md is your own command, not the suite's. Move it aside or rerun with --force to replace it.`);
    }
    replaced.push(name);
    if (!dry) await fs.copyFile(p, `${p}.bak`);
  }

  const plan = [
    ...USER_COMMANDS.map(name => ({ dest: path.join(commandsDir, `${name}.md`), content: userCommandContent(name), rel: `commands/${name}.md` })),
    ...await libPlan(LIB_DIR, path.join(userClaude, 'helpers', 'bc'), 'helpers/bc'),
    ...await libPlan(MARATHON_LIB_DIR, path.join(userClaude, 'helpers', 'marathon'), 'helpers/marathon'),
    ...await hookPlan(path.join(userClaude, 'hooks'), 'hooks')
  ];
  const files = await write(plan, dry);

  if (!dry) {
    const settings = await readSettings(userClaude);
    settings.hooks = mergeHooks(settings.hooks, getUserHookEntries());
    settings.permissions = settings.permissions || {};
    const allow = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
    if (!allow.includes(USER_PERMISSION)) allow.push(USER_PERMISSION);
    settings.permissions.allow = allow;
    await writeSettings(userClaude, settings);
  }
  files.push('settings.json (PreCompact + SessionStart(compact) hooks)');

  return { plugin: 'bc', scope: 'user', dir: userClaude, files, replaced, hooks: getUserHookEntries() };
}

/**
 * Installed in a project when its helper CLI is present.
 */
export async function isInstalled(claudeDir) {
  return exists(path.join(claudeDir, 'helpers', 'bc', 'cli.js'));
}

async function removeHooks(claudeDir, hookEntries) {
  for (const h of HOOK_FILES) {
    try { await fs.unlink(path.join(claudeDir, 'hooks', h)); } catch {}
  }
  const settings = await readSettings(claudeDir);
  if (settings.hooks) {
    settings.hooks = unmergeHooks(settings.hooks, hookEntries);
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    await writeSettings(claudeDir, settings);
  }
}

/**
 * Remove the project helper, hooks and hook entries. bc.json, the status file and the results
 * file are the user's and stay.
 */
export async function uninstall(claudeDir) {
  try { await fs.rm(path.join(claudeDir, 'helpers', 'bc'), { recursive: true }); } catch {}
  await removeHooks(claudeDir, getHookEntries());
}

/**
 * Remove the user-level copy: only commands that carry USER_MARKER, the helper, hooks and entries.
 * The marathon library copy stays, since a user-level marathon may use it.
 */
export async function uninstallUser(homeDir) {
  const userClaude = path.join(homeDir, '.claude');
  for (const name of USER_COMMANDS) {
    const p = path.join(userClaude, 'commands', `${name}.md`);
    try {
      if ((await fs.readFile(p, 'utf-8')).includes(USER_MARKER)) await fs.unlink(p);
    } catch {}
  }
  try { await fs.rm(path.join(userClaude, 'helpers', 'bc'), { recursive: true }); } catch {}
  await removeHooks(userClaude, getUserHookEntries());
  const settings = await readSettings(userClaude);
  if (settings.permissions?.allow?.includes(USER_PERMISSION)) {
    settings.permissions.allow = settings.permissions.allow.filter(p => p !== USER_PERMISSION);
    await writeSettings(userClaude, settings);
  }
}

export default {
  getHookEntries,
  getUserHookEntries,
  getNamespace,
  install,
  installUser,
  isInstalled,
  uninstall,
  uninstallUser
};
