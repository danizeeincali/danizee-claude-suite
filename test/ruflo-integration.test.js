/**
 * Tests for RuFlo Swarm Integration
 * Validates: plugin upgrade, MCP config, swarm workflows, auto-install
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);

describe('RuFlo Plugin — src/plugins/ruflo.js', () => {
  it('ruflo.js plugin file exists', async () => {
    const pluginPath = path.join(PROJECT_ROOT, 'src', 'plugins', 'ruflo.js');
    const stat = await fs.stat(pluginPath);
    assert.ok(stat.isFile(), 'src/plugins/ruflo.js must exist');
  });

  it('exports getMcpConfig function', async () => {
    const ruflo = await import(path.join(PROJECT_ROOT, 'src', 'plugins', 'ruflo.js'));
    assert.ok(typeof ruflo.getMcpConfig === 'function', 'getMcpConfig must be exported');
  });

  it('getMcpConfig returns ruflo@latest MCP server', async () => {
    const ruflo = await import(path.join(PROJECT_ROOT, 'src', 'plugins', 'ruflo.js'));
    const config = ruflo.getMcpConfig();
    const serverConfig = config['ruflo'] || config['claude-flow'];
    assert.ok(serverConfig, 'Must have a ruflo MCP server config');
    const args = serverConfig.args.join(' ');
    assert.ok(args.includes('ruflo@latest'), `MCP args must use ruflo@latest, got: ${args}`);
    assert.ok(!args.includes('claude-flow@v3alpha'), 'Must NOT reference claude-flow@v3alpha');
  });

  it('exports getCommands with ruflo CLI references', async () => {
    const ruflo = await import(path.join(PROJECT_ROOT, 'src', 'plugins', 'ruflo.js'));
    const commands = ruflo.getCommands();
    assert.ok(commands['swarm-init'], 'Must have swarm-init command');
    assert.ok(commands['swarm-init'].content.includes('ruflo'), 'swarm-init must reference ruflo');
  });
});

describe('Backward Compat — claude-flow.js re-exports', () => {
  it('claude-flow.js still exists for backward compat', async () => {
    const oldPath = path.join(PROJECT_ROOT, 'src', 'plugins', 'claude-flow.js');
    const stat = await fs.stat(oldPath);
    assert.ok(stat.isFile(), 'claude-flow.js should still exist as re-export');
  });

  it('claude-flow.js re-exports from ruflo.js', async () => {
    const content = await fs.readFile(
      path.join(PROJECT_ROOT, 'src', 'plugins', 'claude-flow.js'),
      'utf-8'
    );
    assert.ok(
      content.includes('./ruflo') || content.includes('ruflo.js'),
      'claude-flow.js must re-export from ruflo.js'
    );
  });
});

describe('Settings — .claude/settings.json', () => {
  let settings;

  before(async () => {
    const content = await fs.readFile(
      path.join(PROJECT_ROOT, '.claude', 'settings.json'),
      'utf-8'
    );
    settings = JSON.parse(content);
  });

  it('MCP server uses ruflo@latest', () => {
    const mcpServers = settings.mcpServers || {};
    const rufloServer = mcpServers['ruflo'] || mcpServers['claude-flow'];
    assert.ok(rufloServer, 'Must have ruflo MCP server in settings');
    const args = rufloServer.args.join(' ');
    assert.ok(args.includes('ruflo@latest'), `MCP args must use ruflo@latest, got: ${args}`);
  });

  it('permissions include ruflo', () => {
    const perms = settings.permissions?.allow || [];
    const hasRuflo = perms.some(p => p.includes('ruflo'));
    assert.ok(hasRuflo, `Permissions must include ruflo, got: ${perms}`);
  });

  it('no remaining claude-flow@v3alpha references', () => {
    const content = JSON.stringify(settings);
    assert.ok(
      !content.includes('claude-flow@v3alpha'),
      'Must not have any claude-flow@v3alpha references in settings'
    );
  });
});

describe('Installer — ruflo import', () => {
  it('installer.js imports ruflo plugin', async () => {
    const content = await fs.readFile(
      path.join(PROJECT_ROOT, 'src', 'installer.js'),
      'utf-8'
    );
    assert.ok(
      content.includes('ruflo') || content.includes('./plugins/ruflo'),
      'installer.js must import ruflo plugin'
    );
  });
});

describe('w-swarm.md — Full RuFlo Swarm', () => {
  let content;

  before(async () => {
    content = await fs.readFile(
      path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts', 'w-swarm.md'),
      'utf-8'
    );
  });

  it('contains ruflo swarm init command', () => {
    assert.ok(content.includes('ruflo'), 'w-swarm must reference ruflo');
    assert.ok(
      content.includes('swarm init') || content.includes('swarm-init'),
      'w-swarm must have swarm initialization'
    );
  });

  it('contains agent spawn instructions', () => {
    assert.ok(
      content.includes('agent') && content.includes('spawn'),
      'w-swarm must have agent spawn instructions'
    );
  });

  it('has task decomposition phase', () => {
    assert.ok(
      content.toLowerCase().includes('decompos') || content.toLowerCase().includes('task assignment'),
      'w-swarm must have task decomposition'
    );
  });

  it('has result collection phase', () => {
    assert.ok(
      content.toLowerCase().includes('collect') || content.toLowerCase().includes('aggregate') || content.toLowerCase().includes('results'),
      'w-swarm must have result collection'
    );
  });
});

describe('Swarm workflows — Build phase swarm blocks', () => {
  const workflows = [
    'w-tdd-swarm.md',
    'w-debug.md',
    'w-plan-tdd-swarm.md',
    'w-bg-tdd-swarm.md',
    'w-bg-debug.md',
    'w-bg-idea-tdd-swarm.md',
  ];

  for (const workflow of workflows) {
    it(`${workflow} has swarm execution block`, async () => {
      const content = await fs.readFile(
        path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts', workflow),
        'utf-8'
      );
      assert.ok(
        content.includes('ruflo') || content.includes('swarm'),
        `${workflow} must reference ruflo swarm in build phase`
      );
    });
  }
});

describe('Coordination commands — ruflo CLI', () => {
  it('swarm-init.md references ruflo@latest', async () => {
    const content = await fs.readFile(
      path.join(PROJECT_ROOT, '.claude', 'commands', 'coordination', 'swarm-init.md'),
      'utf-8'
    );
    assert.ok(content.includes('ruflo'), 'swarm-init must reference ruflo');
    assert.ok(
      !content.includes('claude-flow@v3alpha'),
      'swarm-init must NOT reference claude-flow@v3alpha'
    );
  });
});

describe('package.json — ruflo keyword', () => {
  it('keywords include ruflo', async () => {
    const content = await fs.readFile(
      path.join(PROJECT_ROOT, 'package.json'),
      'utf-8'
    );
    const pkg = JSON.parse(content);
    assert.ok(
      pkg.keywords.includes('ruflo'),
      `keywords must include ruflo, got: ${pkg.keywords}`
    );
  });
});

describe('No stale claude-flow@v3alpha references', () => {
  const filesToCheck = [
    'src/plugins/ruflo.js',
    '.claude/settings.json',
    '.claude/commands/.shortcuts/w-swarm.md',
    '.claude/commands/coordination/swarm-init.md',
  ];

  for (const file of filesToCheck) {
    it(`${file} has no claude-flow@v3alpha`, async () => {
      const content = await fs.readFile(
        path.join(PROJECT_ROOT, file),
        'utf-8'
      );
      assert.ok(
        !content.includes('claude-flow@v3alpha'),
        `${file} must not contain claude-flow@v3alpha`
      );
    });
  }
});
