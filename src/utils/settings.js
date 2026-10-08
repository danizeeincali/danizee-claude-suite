/**
 * Settings management utilities for Danizee Claude Suite
 * Handles merging and configuring .claude/settings.json
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Deep merge two objects
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Get default suite settings
 */
export function getDefaultSettings() {
  return {
    'danizee-suite': {
      version: '1.0.0',
      installedAt: new Date().toISOString(),
      plugins: {
        'claude-flow': true,
        'compound-engineering': true,
        'frontend-design': true
      }
    },
    mcpServers: {
      'claude-flow': {
        command: 'npx',
        args: ['claude-flow@v3alpha', 'mcp', 'start'],
        description: 'Claude Flow multi-agent orchestration with memory and swarm support'
      }
    },
    permissions: {
      allow: [
        'Bash(npx claude-flow:*)',
        'Bash(git worktree:*)',
        // The marathon loop calls its helper CLI dozens of times unattended; a prompt would stall it.
        'Bash(node .claude/helpers/marathon/cli.js:*)',
        // /w-bbs drives its helper CLI step by step; a prompt per verb would stall the run.
        'Bash(node .claude/helpers/bbs/cli.js:*)',
        'Read(docs/solutions/**)',
        'Write(docs/solutions/**)'
      ]
    },
    features: {
      'danizee-compound-memory': true,
      'danizee-compound-checkpoints': true,
      'danizee-compound-docs': true
    }
  };
}

/**
 * The default suite settings, evaluated once (installedAt is the import time; use getDefaultSettings() for a fresh stamp)
 */
export const DEFAULT_SETTINGS = getDefaultSettings();

/**
 * Get plugin-specific settings
 */
export function getPluginSettings(pluginName) {
  const settings = {
    'claude-flow': {
      namespace: 'danizee-flow',
      swarm: {
        topologies: ['hierarchical', 'mesh', 'ring', 'star'],
        defaultTopology: 'hierarchical'
      },
      memory: {
        enabled: true,
        namespaces: [
          'project/features/*',
          'project/bugs/*',
          'project/security/*',
          'project/performance/*',
          'project/architecture/*',
          'project/reviews/*',
          'project/incidents/*',
          'project/tdd/*',
          'project/implementations/*',
          'project/debugging/*',
          'project/full-tdd-swarm/*',
          'project/multi-repo/*'
        ]
      },
      agents: [
        'coder',
        'tester',
        'reviewer',
        'security-sentinel',
        'performance-oracle',
        'architecture-strategist',
        'pattern-recognition-specialist',
        'code-simplicity-reviewer',
        'analyst',
        'git-history-analyzer',
        'system-architect'
      ]
    },
    'compound-engineering': {
      namespace: 'danizee-compound',
      commands: ['plan', 'work', 'review', 'compound'],
      docsPath: 'docs/solutions',
      checkpoints: {
        enabled: true,
        pauseMessage: 'Say "continue" to proceed or give feedback to redirect.'
      }
    },
    'frontend-design': {
      namespace: 'danizee-frontend',
      commands: ['design', 'component', 'layout', 'theme'],
      frameworks: ['react', 'vue', 'svelte']
    }
  };

  return settings[pluginName] || {};
}

/**
 * Read existing settings file
 */
export async function readSettings(claudeDir) {
  const settingsPath = path.join(claudeDir, 'settings.json');

  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Write settings file
 */
export async function writeSettings(claudeDir, settings) {
  const settingsPath = path.join(claudeDir, 'settings.json');

  await fs.writeFile(
    settingsPath,
    JSON.stringify(settings, null, 2),
    'utf-8'
  );
}

/**
 * Merge hook entries into an existing `hooks` block without duplicating.
 * An entry is considered present when any existing entry for the same event
 * already runs one of its command strings — so `update` is idempotent.
 */
export function mergeHooks(existing = {}, additions = {}) {
  const result = { ...existing };

  for (const [event, entries] of Object.entries(additions)) {
    const current = Array.isArray(result[event]) ? [...result[event]] : [];
    for (const entry of entries) {
      const commands = (entry.hooks || []).map(h => h.command);
      const present = current.some(e => (e.hooks || []).some(h => commands.includes(h.command)));
      if (!present) current.push(entry);
    }
    result[event] = current;
  }

  return result;
}

/**
 * Remove hook entries by command string — the inverse of mergeHooks.
 * An event left with no entries is dropped from the block.
 */
export function unmergeHooks(existing = {}, removals = {}) {
  const result = { ...existing };

  for (const [event, entries] of Object.entries(removals)) {
    if (!Array.isArray(result[event])) continue;
    const commands = new Set(entries.flatMap(e => (e.hooks || []).map(h => h.command)));
    const kept = result[event].filter(e => !(e.hooks || []).some(h => commands.has(h.command)));
    if (kept.length) result[event] = kept;
    else delete result[event];
  }

  return result;
}

/**
 * Merge suite settings with existing settings
 */
export async function mergeSettings(claudeDir, options = {}) {
  const existing = await readSettings(claudeDir);
  const defaultSettings = getDefaultSettings();

  // Get all plugin settings
  const allPluginSettings = {};
  for (const plugin of ['claude-flow', 'compound-engineering', 'frontend-design']) {
    allPluginSettings[plugin] = getPluginSettings(plugin);
  }

  // Merge everything
  let merged = deepMerge(existing, defaultSettings);
  merged.plugins = deepMerge(merged.plugins || {}, allPluginSettings);

  // Permission lists are a union, never a replacement: a project's own allow/deny entries
  // (e.g. the test command a headless marathon wake-up needs) must survive every update.
  merged.permissions = merged.permissions || {};
  for (const list of ['allow', 'deny']) {
    const user = existing.permissions?.[list] || [];
    const ours = defaultSettings.permissions?.[list] || [];
    if (user.length || ours.length) merged.permissions[list] = [...new Set([...user, ...ours])];
  }

  // Register plugin hooks (idempotent)
  if (options.hooks) {
    merged.hooks = mergeHooks(merged.hooks, options.hooks);
  }

  // Update installation timestamp if forcing
  if (options.force) {
    merged['danizee-suite'].installedAt = new Date().toISOString();
    merged['danizee-suite'].updatedAt = new Date().toISOString();
  }

  await writeSettings(claudeDir, merged);

  return merged;
}

/**
 * Remove suite settings
 */
export async function removeSettings(claudeDir, keepSettings = false) {
  if (keepSettings) {
    // Just remove the danizee-suite marker
    const settings = await readSettings(claudeDir);
    delete settings['danizee-suite'];
    await writeSettings(claudeDir, settings);
  } else {
    // Remove entire settings file
    const settingsPath = path.join(claudeDir, 'settings.json');
    try {
      await fs.unlink(settingsPath);
    } catch {
      // File doesn't exist
    }
  }
}

/**
 * Validate settings structure
 */
export function validateSettings(settings) {
  const errors = [];

  if (!settings['danizee-suite']) {
    errors.push('Missing danizee-suite configuration');
  }

  if (!settings.mcpServers?.['claude-flow']) {
    errors.push('Missing claude-flow MCP server configuration');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  getDefaultSettings,
  getPluginSettings,
  readSettings,
  writeSettings,
  mergeHooks,
  unmergeHooks,
  mergeSettings,
  removeSettings,
  validateSettings,
  deepMerge
};
