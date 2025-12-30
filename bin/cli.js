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
  .action(async (options) => {
    const spinner = ora('Initializing Danizee Claude Suite...').start();

    try {
      const installer = new DaniZeeSuiteInstaller(options);
      await installer.install();

      spinner.succeed(chalk.green('Danizee Claude Suite initialized successfully!'));

      console.log('\n' + chalk.cyan('Next steps:'));
      console.log('  1. Ensure claude-flow MCP is installed: ' + chalk.yellow('npx claude-flow@alpha mcp start'));
      console.log('  2. Review the generated WORKFLOW-SHORTCUTS.md');
      console.log('  3. Try a workflow: ' + chalk.yellow('"Run the full cycle workflow on [feature]"'));
      console.log('\n' + chalk.dim('Tip: Each workflow searches memory first, then compounds what you learn.'));
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

      if (!status.installed) {
        console.log('\n' + chalk.yellow('Run `node bin/cli.js init` to install.'));
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
