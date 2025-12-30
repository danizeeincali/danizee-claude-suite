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
        args: ['claude-flow@alpha', 'mcp', 'start'],
        description: 'Claude Flow multi-agent orchestration with memory and swarm support'
      }
    },
    permissions: {
      allow: [
        'Bash(npx claude-flow*)',
        'Bash(git worktree*)',
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
  mergeSettings,
  removeSettings,
  validateSettings,
  deepMerge
};
