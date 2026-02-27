/**
 * Terminal Agents Plugin for Danizee Claude Suite
 * Installs the MCP server for terminal agent orchestration (tmux + git worktrees).
 */

import fs from 'fs/promises';
import path from 'path';
import { getMcpServerSource } from '../mcp/terminal-agents.js';

export function getNamespace() {
  return 'terminal-agents';
}

/**
 * Install terminal-agents MCP server
 */
export async function install(claudeDir, options = {}) {
  const targetDir = options.targetDir || path.resolve(claudeDir, '..');

  if (options.dryRun) {
    return { plugin: 'terminal-agents', namespace: getNamespace() };
  }

  // Write MCP server script to helpers/
  const helpersDir = path.join(claudeDir, 'helpers');
  await fs.mkdir(helpersDir, { recursive: true });
  const mcpServerPath = path.join(helpersDir, 'terminal-agents-mcp.js');
  await fs.writeFile(mcpServerPath, getMcpServerSource(), 'utf-8');

  // Configure .mcp.json
  const mcpJsonPath = path.join(targetDir, '.mcp.json');
  let mcpConfig = { mcpServers: {} };
  try {
    const existing = await fs.readFile(mcpJsonPath, 'utf-8');
    mcpConfig = JSON.parse(existing);
    if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
  } catch {
    // File doesn't exist or is invalid
  }

  mcpConfig.mcpServers['terminal-agents'] = {
    command: 'node',
    args: ['.claude/helpers/terminal-agents-mcp.js'],
  };

  await fs.writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');

  return {
    plugin: 'terminal-agents',
    namespace: getNamespace(),
    mcpServerPath,
  };
}

/**
 * Check if terminal-agents is installed
 */
export async function isInstalled(claudeDir) {
  try {
    await fs.access(path.join(claudeDir, 'helpers', 'terminal-agents-mcp.js'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Uninstall terminal-agents MCP server
 */
export async function uninstall(claudeDir, options = {}) {
  const targetDir = options.targetDir || path.resolve(claudeDir, '..');

  // Remove MCP server file
  try {
    await fs.unlink(path.join(claudeDir, 'helpers', 'terminal-agents-mcp.js'));
  } catch { /* doesn't exist */ }

  // Remove from .mcp.json
  const mcpJsonPath = path.join(targetDir, '.mcp.json');
  try {
    const existing = await fs.readFile(mcpJsonPath, 'utf-8');
    const mcpConfig = JSON.parse(existing);
    if (mcpConfig.mcpServers) {
      delete mcpConfig.mcpServers['terminal-agents'];
      await fs.writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
    }
  } catch { /* file doesn't exist */ }

  // Remove agent registry
  try {
    await fs.unlink(path.join(claudeDir, 'terminal-agents.json'));
  } catch { /* doesn't exist */ }
}

export default { getNamespace, install, isInstalled, uninstall };
