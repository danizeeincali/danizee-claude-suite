/**
 * Agent Cookbook Plugin for Danizee Claude Suite
 * Integrates @agent-cookbook/client for recipe discovery and auto-receipts.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const DEFAULT_REGISTRY_URL = 'https://agent-cookbook.replit.app';
const CONFIG_DIR = path.join(os.homedir(), '.agent-cookbook');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  version: '1.0.0',
  auto_receipts: {
    enabled: true,
    min_grade: 0.8,
    require_tests: true,
    silent: true,
  },
  auto_recipes: {
    enabled: true,
    min_steps: 3,
    require_tests: true,
    confirm: true,
  },
  registry: {
    url: DEFAULT_REGISTRY_URL,
    cache_ttl: 3600,
    sync_interval: 86400,
  },
  privacy: {
    anonymous: true,
    public_key_only: true,
    opt_out_url: `${DEFAULT_REGISTRY_URL}/opt-out`,
  },
};

export function getNamespace() {
  return 'agent-cookbook';
}

/**
 * Install agent-cookbook plugin — creates global config + project marker
 */
export async function install(claudeDir, options = {}) {
  if (options.dryRun) {
    return { plugin: 'agent-cookbook', namespace: getNamespace(), configPath: CONFIG_PATH };
  }

  // Create global config directory
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  // Write global config if it doesn't exist (don't overwrite user config)
  try {
    await fs.access(CONFIG_PATH);
    // Config exists — merge defaults for any missing fields
    const existing = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
    const merged = {
      ...DEFAULT_CONFIG,
      ...existing,
      registry: { ...DEFAULT_CONFIG.registry, ...existing.registry },
      auto_receipts: { ...DEFAULT_CONFIG.auto_receipts, ...existing.auto_receipts },
      auto_recipes: { ...DEFAULT_CONFIG.auto_recipes, ...existing.auto_recipes },
      privacy: { ...DEFAULT_CONFIG.privacy, ...existing.privacy },
    };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  } catch {
    // Config doesn't exist — write defaults
    await fs.writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  }

  // Write project-local marker
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeDir, 'agent-cookbook.json'),
    JSON.stringify({ enabled: true, registry: DEFAULT_REGISTRY_URL }, null, 2),
    'utf-8'
  );

  return {
    plugin: 'agent-cookbook',
    namespace: getNamespace(),
    configPath: CONFIG_PATH,
    registryUrl: DEFAULT_REGISTRY_URL
  };
}

/**
 * Check if agent-cookbook is installed (project-local check)
 */
export async function isInstalled(claudeDir) {
  try {
    await fs.access(path.join(claudeDir, 'agent-cookbook.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Uninstall agent-cookbook plugin
 */
export async function uninstall(claudeDir) {
  // Remove project marker
  try {
    await fs.unlink(path.join(claudeDir, 'agent-cookbook.json'));
  } catch {
    // Doesn't exist
  }
}

export default { getNamespace, install, isInstalled, uninstall };
