#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { DaniZeeSuiteInstaller } from '../src/installer.js';

const program = new Command();

program
  .name('danizee-claude-suite')
  .description('Unified workflow shortcuts for Claude Code with knowledge compounding')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize Claude Code suite in the current project')
  .option('-f, --force', 'Overwrite existing configuration')
  .option('--dry-run', 'Preview changes without applying them')
  .option('-p, --path <path>', 'Target path for installation', process.cwd())
  .option('--with-pm', 'Include PM/management workflows (action items, follow-ups, knowledge capture, etc.)')
  .option('--without-cookbook', 'Skip Agent Cookbook installation')
  .action(async (options) => {
    const mode = options.withPm ? 'Full (Coding + PM)' : 'Coding';
    const spinner = ora(`Initializing Danizee Claude Suite (${mode})...`).start();

    try {
      const installer = new DaniZeeSuiteInstaller(options);
      const result = await installer.install();

      spinner.succeed(chalk.green(`Danizee Claude Suite initialized successfully! (${mode} mode)`));

      // Check for missing tools and display warnings
      if (result.tools) {
        const missingTools = result.tools.filter(t => !t.installed);
        if (missingTools.length > 0) {
          console.log('');
          for (const tool of missingTools) {
            console.log(chalk.yellow(`⚠️  ${tool.displayName} (${tool.name}) not found`));
            if (tool.installInstructions) {
              console.log(chalk.dim('   Install with:'));
              for (const instruction of tool.installInstructions) {
                console.log(chalk.dim(`     ${instruction}`));
              }
            }
          }
        }
      }

      console.log('\n' + chalk.cyan('Next steps:'));
      console.log('  1. Ensure claude-flow MCP is installed: ' + chalk.yellow('npx claude-flow@v3alpha mcp start'));
      console.log('  2. Review the generated WORKFLOW-SHORTCUTS.md');
      console.log('  3. Try a workflow: ' + chalk.yellow('/w-tdd-swarm [feature]') + ' or ' + chalk.yellow('"Full TDD Swarm on [feature]"'));
      if (options.withPm) {
        console.log('\n' + chalk.cyan('PM Module:'));
        console.log('  ' + chalk.yellow('/w-cos') + ' — Daily standup');
        console.log('  ' + chalk.yellow('/w-action [title]') + ' — Add action item');
        console.log('  ' + chalk.yellow('/w-hitlist') + ' — Top 3 priorities');
        console.log('  Requires: ' + chalk.dim('npm install better-sqlite3'));
      }
      console.log('\n' + chalk.dim('Tip: Use /w- prefix for quick access: /w-tdd-swarm, /w-swarm, /w-fix, /w-review, etc.'));
    } catch (error) {
      spinner.fail(chalk.red('Installation failed'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Verify installation status')
  .option('-p, --path <path>', 'Path to check', process.cwd())
  .action(async (options) => {
    const spinner = ora('Checking installation...').start();

    try {
      const installer = new DaniZeeSuiteInstaller(options);
      const status = await installer.check();

      spinner.stop();

      console.log(chalk.bold('\nDanizee Claude Suite Status\n'));
      console.log(`  ${status.installed ? chalk.green('✓') : chalk.red('✗')} Suite installed`);
      console.log(`  ${status.claudeDir ? chalk.green('✓') : chalk.red('✗')} .claude directory`);
      console.log(`  ${status.settings ? chalk.green('✓') : chalk.red('✗')} Settings configured`);
      console.log(`  ${status.shortcuts ? chalk.green('✓') : chalk.red('✗')} WORKFLOW-SHORTCUTS.md`);
      console.log(`  ${status.plugins.claudeFlow ? chalk.green('✓') : chalk.red('✗')} Claude Flow plugin`);
      console.log(`  ${status.plugins.compoundEngineering ? chalk.green('✓') : chalk.red('✗')} Compound Engineering plugin`);
      console.log(`  ${status.plugins.frontendDesign ? chalk.green('✓') : chalk.red('✗')} Frontend Design plugin`);
      console.log(`  ${status.plugins.dotShortcuts ? chalk.green('✓') : chalk.red('✗')} Workflow Shortcuts (/w-tdd-swarm, /w-swarm, /w-fix, etc.)`);
      console.log(`  ${status.plugins.agentCookbook ? chalk.green('✓') : chalk.dim('○')} Agent Cookbook (optional)`);
      console.log(`  ${status.plugins.pmShortcuts ? chalk.green('✓') : chalk.dim('○')} PM Module (optional, --with-pm)`);

      if (!status.installed) {
        console.log('\n' + chalk.yellow('Run `npx danizee-claude-suite init` to install.'));
      }
    } catch (error) {
      spinner.fail(chalk.red('Check failed'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program
  .command('update')
  .description('Update existing installation')
  .option('-p, --path <path>', 'Path to update', process.cwd())
  .action(async (options) => {
    const spinner = ora('Updating Danizee Claude Suite...').start();

    try {
      const installer = new DaniZeeSuiteInstaller({ ...options, force: true });
      await installer.install();

      spinner.succeed(chalk.green('Danizee Claude Suite updated successfully!'));
    } catch (error) {
      spinner.fail(chalk.red('Update failed'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program
  .command('uninstall')
  .description('Remove the suite from the project')
  .option('-p, --path <path>', 'Path to uninstall from', process.cwd())
  .option('--keep-settings', 'Keep settings.json modifications')
  .action(async (options) => {
    const spinner = ora('Uninstalling Danizee Claude Suite...').start();

    try {
      const installer = new DaniZeeSuiteInstaller(options);
      await installer.uninstall();

      spinner.succeed(chalk.green('Danizee Claude Suite uninstalled.'));
    } catch (error) {
      spinner.fail(chalk.red('Uninstall failed'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program.parse();
