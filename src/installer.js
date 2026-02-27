/**
 * Main Installer for Danizee Claude Suite
 * Orchestrates plugin installation and configuration
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { runConflictChecks } from './utils/conflicts.js';
import { mergeSettings, removeSettings, readSettings } from './utils/settings.js';
import { writeWorkflowShortcuts, shortcutsExist } from './utils/shortcuts.js';
import * as claudeFlow from './plugins/claude-flow.js';
import * as compoundEngineering from './plugins/compound-engineering.js';
import * as frontendDesign from './plugins/frontend-design.js';
import * as dotShortcuts from './plugins/dot-shortcuts.js';
import * as pmShortcuts from './plugins/pm-shortcuts.js';
import * as agentCookbook from './plugins/agent-cookbook.js';
import * as terminalAgents from './plugins/terminal-agents.js';

// Get directory of this file for template resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    this.withPm = options.withPm || false;
    this.withoutCookbook = options.withoutCookbook || false;
  }

  /**
   * Run the installation
   */
  async install() {
    // Check required tools first
    const toolStatus = this.checkRequiredTools();

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

    // Install Pure Ralph templates
    const ralphResult = await this.installRalphTemplates();

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
      ralph: ralphResult,
      shortcuts: path.join(this.targetDir, 'WORKFLOW-SHORTCUTS.md'),
      tools: toolStatus
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
      path.join(this.claudeDir, 'commands', '.shortcuts'),
      path.join(this.claudeDir, 'helpers'),
      path.join(this.claudeDir, 'ralph'),
      path.join(this.claudeDir, 'plans')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Create specs directory at project root for Ralph specs
    await fs.mkdir(path.join(this.targetDir, 'specs'), { recursive: true });
  }

  /**
   * Install Pure Ralph templates
   */
  async installRalphTemplates() {
    const ralphDir = path.join(this.claudeDir, 'ralph');
    const templatesDir = path.join(__dirname, 'templates', 'ralph');

    // Files to copy from templates
    const templateFiles = [
      'loop.sh',
      'PROMPT_build.md',
      'PROMPT_plan.md',
      'AGENTS.md',
      'IMPLEMENTATION_PLAN.md'
    ];

    for (const file of templateFiles) {
      const sourcePath = path.join(templatesDir, file);
      const destPath = path.join(ralphDir, file);

      try {
        const content = await fs.readFile(sourcePath, 'utf-8');
        await fs.writeFile(destPath, content, 'utf-8');

        // Make loop.sh executable
        if (file === 'loop.sh') {
          await fs.chmod(destPath, 0o755);
        }
      } catch (err) {
        // Template file doesn't exist yet (during development), skip
        console.warn(`Warning: Could not copy Ralph template ${file}: ${err.message}`);
      }
    }

    // Create .gitkeep in specs directory
    await fs.writeFile(
      path.join(this.targetDir, 'specs', '.gitkeep'),
      '# Place Ralph specification files here\n',
      'utf-8'
    );

    return {
      ralphDir,
      files: templateFiles
    };
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

    // Install Dot Shortcuts (/.full-cycle, /.tdd, etc.)
    results.push(await dotShortcuts.install(this.claudeDir, {
      dryRun: this.dryRun,
      targetDir: this.targetDir
    }));

    // Install Agent Cookbook (unless opted out)
    if (!this.withoutCookbook) {
      results.push(await agentCookbook.install(this.claudeDir, {
        dryRun: this.dryRun,
        targetDir: this.targetDir
      }));
    }

    // Install Terminal Agents MCP server
    results.push(await terminalAgents.install(this.claudeDir, {
      dryRun: this.dryRun,
      targetDir: this.targetDir
    }));

    // Install PM Module (if opted in)
    if (this.withPm) {
      results.push(await pmShortcuts.install(this.claudeDir, {
        dryRun: this.dryRun,
        targetDir: this.targetDir
      }));

      // Initialize PM database
      if (!this.dryRun) {
        try {
          const dataDir = path.join(this.targetDir, 'data');
          await fs.mkdir(dataDir, { recursive: true });
          const { initDatabase } = await import('./lib/db.js');
          initDatabase(path.join(dataDir, 'chief-of-staff.db'));
        } catch (err) {
          console.warn(`Warning: Could not initialize PM database: ${err.message}`);
          console.warn('Install better-sqlite3 to enable PM features: npm install better-sqlite3');
        }
      }
    }

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
npx claude-flow@v3alpha mcp start

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
   * Check for required tools (gh CLI, etc.)
   * Returns array of tool status objects
   */
  checkRequiredTools() {
    const tools = [];

    // Check GitHub CLI
    try {
      const version = execSync('gh --version', { stdio: 'pipe', encoding: 'utf-8' });
      const versionMatch = version.match(/gh version ([\d.]+)/);
      tools.push({
        name: 'gh',
        displayName: 'GitHub CLI',
        installed: true,
        version: versionMatch ? versionMatch[1] : 'unknown'
      });
    } catch {
      tools.push({
        name: 'gh',
        displayName: 'GitHub CLI',
        installed: false,
        installInstructions: [
          'macOS:   brew install gh',
          'Linux:   sudo apt install gh  (or: sudo dnf install gh)',
          'Windows: winget install GitHub.cli',
          'Or visit: https://cli.github.com/'
        ]
      });
    }

    return tools;
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
      ralph: false,
      plugins: {
        claudeFlow: false,
        compoundEngineering: false,
        frontendDesign: false,
        dotShortcuts: false,
        agentCookbook: false,
        pmShortcuts: false,
        terminalAgents: false
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

    // Check Ralph installation
    try {
      const ralphDir = path.join(this.claudeDir, 'ralph');
      await fs.access(path.join(ralphDir, 'loop.sh'));
      status.ralph = true;
    } catch {
      status.ralph = false;
    }

    // Check plugins
    status.plugins.claudeFlow = await claudeFlow.isInstalled(this.claudeDir);
    status.plugins.compoundEngineering = await compoundEngineering.isInstalled(this.claudeDir);
    status.plugins.frontendDesign = await frontendDesign.isInstalled(this.claudeDir);
    status.plugins.dotShortcuts = await dotShortcuts.isInstalled(this.claudeDir);
    status.plugins.agentCookbook = await agentCookbook.isInstalled(this.claudeDir);
    status.plugins.pmShortcuts = await pmShortcuts.isInstalled(this.claudeDir);
    status.plugins.terminalAgents = await terminalAgents.isInstalled(this.claudeDir);

    // Overall status (core plugins only — PM and cookbook are optional)
    status.installed = status.claudeDir &&
      status.settings &&
      status.shortcuts &&
      status.ralph &&
      status.plugins.claudeFlow &&
      status.plugins.compoundEngineering &&
      status.plugins.frontendDesign &&
      status.plugins.dotShortcuts;

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
    await dotShortcuts.uninstall(this.claudeDir);
    await agentCookbook.uninstall(this.claudeDir);
    await pmShortcuts.uninstall(this.claudeDir);
    await terminalAgents.uninstall(this.claudeDir, { targetDir: this.targetDir });

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

    // Remove Ralph directory
    try {
      await fs.rm(path.join(this.claudeDir, 'ralph'), { recursive: true });
    } catch {
      // Directory doesn't exist
    }

    // Remove plans directory
    try {
      await fs.rm(path.join(this.claudeDir, 'plans'), { recursive: true });
    } catch {
      // Directory doesn't exist
    }

    // Remove empty command directories
    const commandDirs = ['workflows', 'coordination', 'analysis', '.shortcuts'];
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
        `${this.claudeDir}/commands/.shortcuts/`,
        `${this.claudeDir}/helpers/`,
        `${this.claudeDir}/ralph/`,
        `${this.claudeDir}/ralph/loop.sh`,
        `${this.claudeDir}/ralph/PROMPT_build.md`,
        `${this.claudeDir}/ralph/PROMPT_plan.md`,
        `${this.claudeDir}/ralph/AGENTS.md`,
        `${this.claudeDir}/ralph/IMPLEMENTATION_PLAN.md`,
        `${this.claudeDir}/plans/`,
        `${this.claudeDir}/settings.json`,
        `${this.targetDir}/specs/`,
        `${this.targetDir}/WORKFLOW-SHORTCUTS.md`,
        `${this.targetDir}/docs/solutions/`
      ],
      plugins: [
        'claude-flow',
        'compound-engineering',
        'frontend-design',
        'dot-shortcuts',
        'pure-ralph',
        ...(this.withoutCookbook ? [] : ['agent-cookbook']),
        ...(this.withPm ? ['pm-shortcuts'] : [])
      ]
    };
  }
}

export default DaniZeeSuiteInstaller;
