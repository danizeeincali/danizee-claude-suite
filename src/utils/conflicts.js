/**
 * Conflict detection utilities for Danizee Claude Suite
 * Prevents duplicate installations and naming conflicts
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Calculate Levenshtein distance between two strings
 * Used for detecting similar command names
 */
function levenshteinDistance(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if two strings are similar (within threshold)
 */
function areSimilar(a, b, threshold = 0.3) {
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return distance / maxLength <= threshold;
}

/**
 * Detect duplicate command directories
 */
export async function detectDuplicateCommands(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands');
  const conflicts = [];

  try {
    const subdirs = await fs.readdir(commandsDir);

    for (const subdir of subdirs) {
      const subdirPath = path.join(commandsDir, subdir);
      const stat = await fs.stat(subdirPath);

      if (stat.isDirectory()) {
        const files = await fs.readdir(subdirPath);

        for (let i = 0; i < files.length; i++) {
          for (let j = i + 1; j < files.length; j++) {
            const nameA = files[i].replace('.md', '');
            const nameB = files[j].replace('.md', '');

            if (areSimilar(nameA, nameB)) {
              conflicts.push({
                type: 'similar_commands',
                directory: subdir,
                files: [files[i], files[j]],
                message: `Similar command names detected: "${nameA}" and "${nameB}"`
              });
            }
          }
        }
      }
    }
  } catch {
    // Commands directory doesn't exist yet, no conflicts
  }

  return conflicts;
}

/**
 * Check for settings conflicts
 */
export async function detectSettingsConflicts(claudeDir) {
  const conflicts = [];
  const settingsPath = path.join(claudeDir, 'settings.json');
  const localSettingsPath = path.join(claudeDir, 'settings.local.json');

  try {
    const settingsExists = await fs.access(settingsPath).then(() => true).catch(() => false);
    const localExists = await fs.access(localSettingsPath).then(() => true).catch(() => false);

    if (settingsExists && localExists) {
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      const localSettings = JSON.parse(await fs.readFile(localSettingsPath, 'utf-8'));

      // Check for conflicting plugin namespaces
      if (settings.plugins && localSettings.plugins) {
        for (const plugin of Object.keys(settings.plugins)) {
          if (localSettings.plugins[plugin]) {
            conflicts.push({
              type: 'plugin_override',
              plugin,
              message: `Plugin "${plugin}" is defined in both settings.json and settings.local.json`
            });
          }
        }
      }

      // Check for conflicting MCP servers
      if (settings.mcpServers && localSettings.mcpServers) {
        for (const server of Object.keys(settings.mcpServers)) {
          if (localSettings.mcpServers[server]) {
            conflicts.push({
              type: 'mcp_server_override',
              server,
              message: `MCP server "${server}" is defined in both settings files`
            });
          }
        }
      }
    }
  } catch {
    // Settings don't exist yet, no conflicts
  }

  return conflicts;
}

/**
 * Check for existing Danizee suite installation
 */
export async function detectExistingInstallation(claudeDir) {
  const settingsPath = path.join(claudeDir, 'settings.json');

  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content);

    if (settings['danizee-suite']) {
      return {
        installed: true,
        version: settings['danizee-suite'].version || 'unknown',
        installedAt: settings['danizee-suite'].installedAt
      };
    }
  } catch {
    // No existing installation
  }

  return { installed: false };
}

/**
 * Check for MCP server duplicates
 */
export async function detectMcpConflicts(claudeDir) {
  const conflicts = [];
  const settingsPath = path.join(claudeDir, 'settings.json');

  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content);

    if (settings.mcpServers) {
      const servers = Object.entries(settings.mcpServers);

      for (let i = 0; i < servers.length; i++) {
        for (let j = i + 1; j < servers.length; j++) {
          const [nameA, configA] = servers[i];
          const [nameB, configB] = servers[j];

          // Check if same command is used
          if (configA.command === configB.command &&
              JSON.stringify(configA.args) === JSON.stringify(configB.args)) {
            conflicts.push({
              type: 'duplicate_mcp',
              servers: [nameA, nameB],
              message: `Duplicate MCP server configuration: "${nameA}" and "${nameB}"`
            });
          }
        }
      }
    }
  } catch {
    // No settings file
  }

  return conflicts;
}

/**
 * Run all conflict checks
 */
export async function runConflictChecks(claudeDir, options = {}) {
  const allConflicts = [];

  const [duplicateCommands, settingsConflicts, mcpConflicts, existing] = await Promise.all([
    detectDuplicateCommands(claudeDir),
    detectSettingsConflicts(claudeDir),
    detectMcpConflicts(claudeDir),
    detectExistingInstallation(claudeDir)
  ]);

  allConflicts.push(...duplicateCommands, ...settingsConflicts, ...mcpConflicts);

  if (existing.installed && !options.force) {
    allConflicts.push({
      type: 'existing_installation',
      version: existing.version,
      message: `Danizee Claude Suite v${existing.version} is already installed. Use --force to overwrite.`
    });
  }

  return {
    hasConflicts: allConflicts.length > 0,
    conflicts: allConflicts,
    existing
  };
}

export default {
  detectDuplicateCommands,
  detectSettingsConflicts,
  detectExistingInstallation,
  detectMcpConflicts,
  runConflictChecks,
  areSimilar,
  levenshteinDistance
};
