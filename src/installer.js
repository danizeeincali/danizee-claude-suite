/**
 * Main Installer for Danizee Claude Suite
 * Orchestrates plugin installation and configuration
 */

import fs from 'fs/promises';
import path from 'path';
import { runConflictChecks } from './utils/conflicts.js';
import { mergeSettings, removeSettings, readSettings } from './utils/settings.js';
import { writeWorkflowShortcuts, shortcutsExist } from './utils/shortcuts.js';
import * as claudeFlow from './plugins/claude-flow.js';
import * as compoundEngineering from './plugins/compound-engineering.js';
import * as frontendDesign from './plugins/frontend-design.js';

/**
 * DaniZee Suite Installer
 */
export class DaniZeeSuiteInstaller {
  constructor(options = {}) {
    this.targetDir = options.path || process.cwd();
    this.claudeDir = path.join(this.targetDir, '.claude');
    this.force = options.force || false;
    this.dryRun = options.dryRun || false;
    this.keepSettings = options.keepSettings || false;
  }

  /**
   * Run the installation
   */
  async install() {
    // Check for conflicts
    const conflictCheck = await runConflictChecks(this.claudeDir, {
      force: this.force
    });

    if (conflictCheck.hasConflicts && !this.force) {
      const errors = conflictCheck.conflicts.map(c => c.message).join('\n');
      throw new Error(`Installation conflicts detected:\n${errors}`);
    }

    if (this.dryRun) {
      return this.dryRunReport();
    }

    // Create .claude directory structure
    await this.createDirectoryStructure();

    // Install plugins
    const results = await this.installPlugins();

    // Merge settings
    await mergeSettings(this.claudeDir, {
      force: this.force,
      targetDir: this.targetDir
    });

    // Generate WORKFLOW-SHORTCUTS.md
    await writeWorkflowShortcuts(this.targetDir);

    // Create helper scripts
    await this.createHelperScripts();

    return {
      success: true,
      plugins: results,
      shortcuts: path.join(this.targetDir, 'WORKFLOW-SHORTCUTS.md')
    };
  }

  /**
   * Create directory structure
   */
  async createDirectoryStructure() {
    const dirs = [
      this.claudeDir,
      path.join(this.claudeDir, 'commands', 'workflows'),
      path.join(this.claudeDir, 'commands', 'coordination'),
      path.join(this.claudeDir, 'commands', 'analysis'),
      path.join(this.claudeDir, 'helpers')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Install all plugins
   */
  async installPlugins() {
    const results = [];

    // Install Claude Flow
    results.push(await claudeFlow.install(this.claudeDir, {
      dryRun: this.dryRun,
      targetDir: this.targetDir
    }));

    // Install Compound Engineering
    results.push(await compoundEngineering.install(this.claudeDir, {
      dryRun: this.dryRun,
      targetDir: this.targetDir
    }));

    // Install Frontend Design
    results.push(await frontendDesign.install(this.claudeDir, {
      dryRun: this.dryRun,
      targetDir: this.targetDir
    }));

    return results;
  }

  /**
   * Create helper scripts
   */
  async createHelperScripts() {
    const helpersDir = path.join(this.claudeDir, 'helpers');

    // Quick start script
    const quickStart = `#!/bin/bash
# Danizee Claude Suite Quick Start

echo "🚀 Danizee Claude Suite Quick Start"
echo ""
echo "Available workflows:"
echo "  • Full Cycle:     'Run the full cycle workflow on [feature]'"
echo "  • Swarm Build:    'Use swarm to build [task]'"
echo "  • TDD:            'TDD workflow for [feature]'"
echo "  • Full TDD Swarm: 'Full TDD Swarm on [feature]'"
echo "  • Quick Fix:      'Quick fix for [bug]'"
echo "  • Deep Debug:     'Debug workflow for [issue]'"
echo "  • Full Review:    'Full review of PR [number]'"
echo ""
echo "See WORKFLOW-SHORTCUTS.md for complete documentation."
`;

    await fs.writeFile(
      path.join(helpersDir, 'quick-start.sh'),
      quickStart,
      { mode: 0o755 }
    );

    // MCP setup script
    const mcpSetup = `#!/bin/bash
# Setup Claude Flow MCP Server

echo "Setting up Claude Flow MCP server..."
npx claude-flow@alpha mcp start

echo ""
echo "MCP server started. You can now use memory and swarm operations."
`;

    await fs.writeFile(
      path.join(helpersDir, 'setup-mcp.sh'),
      mcpSetup,
      { mode: 0o755 }
    );
  }

  /**
   * Check installation status
   */
  async check() {
    const status = {
      installed: false,
      claudeDir: false,
      settings: false,
      shortcuts: false,
      plugins: {
        claudeFlow: false,
        compoundEngineering: false,
        frontendDesign: false
      }
    };

    // Check .claude directory
    try {
      await fs.access(this.claudeDir);
      status.claudeDir = true;
    } catch {
      return status;
    }

    // Check settings
    const settings = await readSettings(this.claudeDir);
    status.settings = !!settings['danizee-suite'];

    // Check shortcuts
    status.shortcuts = await shortcutsExist(this.targetDir);

    // Check plugins
    status.plugins.claudeFlow = await claudeFlow.isInstalled(this.claudeDir);
    status.plugins.compoundEngineering = await compoundEngineering.isInstalled(this.claudeDir);
    status.plugins.frontendDesign = await frontendDesign.isInstalled(this.claudeDir);

    // Overall status
    status.installed = status.claudeDir &&
      status.settings &&
      status.shortcuts &&
      status.plugins.claudeFlow &&
      status.plugins.compoundEngineering &&
      status.plugins.frontendDesign;

    return status;
  }

  /**
   * Uninstall the suite
   */
  async uninstall() {
    // Remove plugins
    await claudeFlow.uninstall(this.claudeDir);
    await compoundEngineering.uninstall(this.claudeDir);
    await frontendDesign.uninstall(this.claudeDir);

    // Remove settings
    await removeSettings(this.claudeDir, this.keepSettings);

    // Remove WORKFLOW-SHORTCUTS.md
    try {
      await fs.unlink(path.join(this.targetDir, 'WORKFLOW-SHORTCUTS.md'));
    } catch {
      // File doesn't exist
    }

    // Remove helpers
    try {
      await fs.rm(path.join(this.claudeDir, 'helpers'), { recursive: true });
    } catch {
      // Directory doesn't exist
    }

    // Remove empty command directories
    const commandDirs = ['workflows', 'coordination', 'analysis'];
    for (const dir of commandDirs) {
      try {
        await fs.rmdir(path.join(this.claudeDir, 'commands', dir));
      } catch {
        // Not empty or doesn't exist
      }
    }

    try {
      await fs.rmdir(path.join(this.claudeDir, 'commands'));
    } catch {
      // Not empty
    }

    return { success: true };
  }

  /**
   * Generate dry run report
   */
  async dryRunReport() {
    return {
      dryRun: true,
      wouldCreate: [
        `${this.claudeDir}/`,
        `${this.claudeDir}/commands/workflows/`,
        `${this.claudeDir}/commands/coordination/`,
        `${this.claudeDir}/commands/analysis/`,
        `${this.claudeDir}/helpers/`,
        `${this.claudeDir}/settings.json`,
        `${this.targetDir}/WORKFLOW-SHORTCUTS.md`,
        `${this.targetDir}/docs/solutions/`
      ],
      plugins: [
        'claude-flow',
        'compound-engineering',
        'frontend-design'
      ]
    };
  }
}

export default DaniZeeSuiteInstaller;
