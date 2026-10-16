#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import os from 'os';
import fs from 'fs';
import { DaniZeeSuiteInstaller } from '../src/installer.js';
import * as bc from '../src/plugins/bc.js';
import { runDoctor, loadProjectChecks } from '../src/lib/kit/doctor.js';
import { classify, CLASSES } from '../src/lib/kit/exit-codes.js';
import { storeCheck } from '../src/lib/kit/store.js';

const program = new Command();

/**
 * Exit status of `check` for a doctor status, through the kit's exit-code contract (src/lib/kit/exit-codes.js):
 * doctor 0 -> clean (0), doctor 1 -> usage (1), doctor 2 (a fatal prerequisite is missing) -> precondition (4).
 * Infrastructure (5) and product failure (2) are never produced by a preflight: nothing is judged here.
 */
function checkExitCode(doctorExit) {
  return CLASSES[classify({ code: doctorExit, verb: 'doctor' }).class].code;
}

/**
 * A ~/.claude/commands/<name>.md silently wins over the project's .claude/commands copy.
 * Say so, and show the one-line fix.
 */
function printShadowing(shadowing = []) {
  if (!shadowing.length) return;
  console.log('');
  console.log(chalk.yellow(`⚠️  User-level commands shadow suite commands: ${shadowing.map(n => '/' + n).join(', ')}`));
  console.log(chalk.dim('   ~/.claude/commands/<name>.md is loaded instead of the project copy. Rename or remove:'));
  for (const name of shadowing) {
    console.log(chalk.dim(`     mv ~/.claude/commands/${name}.md ~/.claude/commands/${name}-old.md`));
  }
  if (shadowing.some(n => bc.USER_COMMANDS.includes(n))) {
    console.log(chalk.dim('   For /bc, then run `danizee-claude-suite install-user` so one suite copy serves every project.'));
  }
}

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

      printShadowing(result.shadowing);

      console.log('\n' + chalk.cyan('Next steps:'));
      console.log('  1. Ensure claude-flow MCP is installed: ' + chalk.yellow('npx claude-flow@v3alpha mcp start'));
      console.log('  2. Review the generated WORKFLOW-SHORTCUTS.md');
      console.log('  3. Try a workflow: ' + chalk.yellow('/w-tdd-swarm [feature]') + ' or ' + chalk.yellow('"Full TDD Swarm on [feature]"'));
      console.log('  4. For a run that lasts days: ' + chalk.yellow('/w-marathon [finish line]') + ' (alias ' + chalk.yellow('/mt') + ')');
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
  .description('Verify installation status, then run the preflight doctor checks (exit 0 ok, 1 usage, 4 a fatal prerequisite is missing)')
  .option('-p, --path <path>', 'Path to check', process.cwd())
  .option('--profile <profile>', 'Doctor profile: kit, marathon, bbs or review', 'kit')
  .action(async (options) => {
    let isDir = false;
    try { isDir = fs.statSync(options.path).isDirectory(); } catch { /* missing */ }
    if (!isDir) {
      console.error(`check: --path ${options.path} does not exist (or is not a directory)`);
      process.exit(checkExitCode(1));
    }
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
      console.log(`  ${status.plugins.marathon ? chalk.green('✓') : chalk.red('✗')} Marathon helpers + hooks (/w-marathon)`);
      console.log(`  ${status.plugins.bc ? chalk.green('✓') : chalk.red('✗')} /bc helper + compaction hooks (/bc, /bcp)`);
      console.log(`  ${status.plugins.bbs ? chalk.green('✓') : chalk.red('✗')} BBS helpers (/w-bbs, /bbs)`);
      console.log(`  ${status.plugins.agentCookbook ? chalk.green('✓') : chalk.dim('○')} Agent Cookbook (optional)`);
      console.log(`  ${status.plugins.pmShortcuts ? chalk.green('✓') : chalk.dim('○')} PM Module (optional, --with-pm)`);

      printShadowing(status.shadowing);

      if (!status.installed) {
        console.log('\n' + chalk.yellow('Run `npx danizee-claude-suite init` to install.'));
      }

      // Preflight doctor: named checks, fatal ones block (exit 4), advisory ones only warn.
      const project = await loadProjectChecks(options.path); // .claude/kit/doctor.json; an invalid one throws (usage)
      const doctor = await runDoctor({ profile: options.profile, cwd: options.path, env: process.env, custom: project.checks, customBase: project.base });
      console.log(chalk.bold('\nDoctor checks (' + doctor.profile + ')\n'));
      for (const c of doctor.checks) {
        const mark = c.ok ? chalk.green('✓') : (c.fatal ? chalk.red('✗') : chalk.yellow('!'));
        console.log(`  ${mark} ${c.name}: ${c.found}`);
        if (!c.ok && c.fix) console.log(chalk.dim(`      fix: ${c.fix}`));
      }
      if (doctor.failed.length) {
        console.log('\n' + chalk.red(`Fatal: ${doctor.failed.join(', ')}`));
      }
      // Kit state store: one line. A project on sqlite whose engine cannot load is a fatal prerequisite (exit 4).
      const store = await storeCheck({ cwd: options.path, env: process.env });
      console.log('\n' + `  ${store.ok ? chalk.green('✓') : chalk.red('✗')} ${store.line}` + (store.fix ? chalk.dim(` (fix: ${store.fix})`) : ''));
      process.exitCode = checkExitCode(store.fatal && doctor.exit === 0 ? 2 : doctor.exit);
    } catch (error) {
      spinner.fail(chalk.red('Check failed'));
      console.error(chalk.red(error.message));
      process.exit(checkExitCode(1));
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

program
  .command('install-user')
  .description('Install /bc, /bcp and the compaction hooks once, in ~/.claude, for every project')
  .option('--dry-run', 'Preview changes without applying them')
  .option('-f, --force', 'Replace your own ~/.claude/commands/bc.md (kept as bc.md.bak)')
  .option('--home <dir>', 'Home directory to install into', os.homedir())
  .action(async (options) => {
    try {
      const result = await bc.installUser(options.home, { dryRun: !!options.dryRun, force: !!options.force });
      console.log(chalk.green(`${options.dryRun ? 'Would install' : 'Installed'} /bc for every project in ${result.dir}`));
      for (const f of result.files) console.log(chalk.dim(`  ${f}`));
      for (const n of result.replaced) console.log(chalk.yellow(`  replaced your own /${n} (saved as commands/${n}.md.bak)`));
      console.log('\n' + chalk.cyan('In each project, add .claude/bc.json naming its status, kickoff and rules files:'));
      console.log(chalk.dim('  ' + JSON.stringify(bc.defaultProjectConfig())));
    } catch (error) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program
  .command('uninstall-user')
  .description('Remove the user-level /bc copy and its hooks from ~/.claude')
  .option('--home <dir>', 'Home directory to uninstall from', os.homedir())
  .action(async (options) => {
    try {
      await bc.uninstallUser(options.home);
      console.log(chalk.green('Removed the user-level /bc.'));
    } catch (error) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

// Listed for --help only: the call itself is routed to the kit verb below, before commander parses.
program
  .command('db <sub>')
  .description('Kit state store: db init | export | off | status | prune [--keep <n>] (optional SQLite .claude/kit/suite.db; JSON files stay the default)');

// `danizee-claude-suite db <sub> [args]` is the kit's `db` verb (same flags, JSON output and exit codes as
// `node .claude/helpers/kit/cli.js db <sub>`), run in the current folder.
if (process.argv[2] === 'db') {
  const { main } = await import('../src/lib/kit/cli.js');
  process.exitCode = await main(process.argv.slice(2));
} else {
  program.parse();
}
