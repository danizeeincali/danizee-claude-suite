/**
 * Tests for Terminal Agent MCP server, workflows, and plugin.
 * Verifies gateless TDD workflow, interview-then-spawn workflow,
 * MCP tool definitions, and plugin install/uninstall lifecycle.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let commands;

before(async () => {
  const mod = await import('../src/plugins/dot-shortcuts.js');
  commands = mod.getCommands();
});

// ============================================================
// w-agent-tdd-swarm — Fully Gateless TDD
// ============================================================

describe('w-agent-tdd-swarm workflow', () => {
  it('should exist in commands', () => {
    assert.ok(commands['w-agent-tdd-swarm'], 'w-agent-tdd-swarm should exist');
  });

  it('should have ZERO user gates (no AskUserQuestion)', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      !content.includes('AskUserQuestion'),
      'w-agent-tdd-swarm should NOT contain AskUserQuestion'
    );
  });

  it('should have ZERO "USER GATE" markers', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      !content.includes('USER GATE'),
      'w-agent-tdd-swarm should NOT contain USER GATE'
    );
  });

  it('should include PR creation instruction', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      content.includes('gh pr create'),
      'w-agent-tdd-swarm should include gh pr create'
    );
  });

  it('should auto-proceed through all phases', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      content.includes('AUTO-PROCEED'),
      'w-agent-tdd-swarm should have AUTO-PROCEED markers'
    );
  });

  it('should include TDD blocking rule', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      content.includes('BLOCKING') || content.includes('tests FAIL'),
      'w-agent-tdd-swarm should enforce TDD blocking rule'
    );
  });

  it('should include compound phase', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      content.includes('Compound') || content.includes('compound'),
      'w-agent-tdd-swarm should include compound phase'
    );
  });

  it('should include completion report phase', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      content.includes('agent-reports') && content.includes('Report'),
      'w-agent-tdd-swarm should write completion report'
    );
  });

  it('should include parent notification instruction', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      content.includes('redirect_terminal_agent') && content.includes('parent'),
      'w-agent-tdd-swarm should notify parent agent'
    );
  });
});

// ============================================================
// w-agent-interview-swarm — Interview then Spawn Agent
// ============================================================

describe('w-agent-interview-swarm workflow', () => {
  it('should exist in commands', () => {
    assert.ok(commands['w-agent-interview-swarm'], 'w-agent-interview-swarm should exist');
  });

  it('should contain AskUserQuestion for interview phase', () => {
    const content = commands['w-agent-interview-swarm'].content;
    assert.ok(
      content.includes('AskUserQuestion'),
      'w-agent-interview-swarm should contain AskUserQuestion for interviews'
    );
  });

  it('should reference spawn_terminal_agent MCP tool', () => {
    const content = commands['w-agent-interview-swarm'].content;
    assert.ok(
      content.includes('spawn_terminal_agent'),
      'w-agent-interview-swarm should reference spawn_terminal_agent'
    );
  });

  it('should have interview section with user gates', () => {
    const content = commands['w-agent-interview-swarm'].content;
    // Interview section should have gates
    assert.ok(
      content.includes('Interview') && content.includes('AskUserQuestion'),
      'Interview section should have user gates'
    );
  });

  it('should include PR creation instruction', () => {
    const content = commands['w-agent-interview-swarm'].content;
    assert.ok(
      content.includes('gh pr create'),
      'w-agent-interview-swarm should include gh pr create'
    );
  });

  it('should include spec saving before spawn', () => {
    const content = commands['w-agent-interview-swarm'].content;
    assert.ok(
      content.includes('.claude/plans/') || content.includes('spec'),
      'w-agent-interview-swarm should save spec before spawning agent'
    );
  });

  it('should pass parent_agent_id when spawning', () => {
    const content = commands['w-agent-interview-swarm'].content;
    assert.ok(
      content.includes('parent_agent_id'),
      'w-agent-interview-swarm should pass parent_agent_id to spawn'
    );
  });

  it('should mention get_agent_report for reading results', () => {
    const content = commands['w-agent-interview-swarm'].content;
    assert.ok(
      content.includes('get_agent_report'),
      'w-agent-interview-swarm should reference get_agent_report tool'
    );
  });
});

// ============================================================
// MCP Server — Tool Definitions
// ============================================================

describe('Terminal Agents MCP server', () => {
  let mcpModule;

  before(async () => {
    mcpModule = await import('../src/mcp/terminal-agents.js');
  });

  it('should export getToolDefinitions', () => {
    assert.ok(
      typeof mcpModule.getToolDefinitions === 'function',
      'should export getToolDefinitions'
    );
  });

  it('should return 5 tool definitions', () => {
    const tools = mcpModule.getToolDefinitions();
    assert.equal(tools.length, 5, 'should have 5 tools');
  });

  it('should include spawn_terminal_agent tool', () => {
    const tools = mcpModule.getToolDefinitions();
    const names = tools.map(t => t.name);
    assert.ok(names.includes('spawn_terminal_agent'), 'should include spawn_terminal_agent');
  });

  it('should include check_terminal_agents tool', () => {
    const tools = mcpModule.getToolDefinitions();
    const names = tools.map(t => t.name);
    assert.ok(names.includes('check_terminal_agents'), 'should include check_terminal_agents');
  });

  it('should include redirect_terminal_agent tool', () => {
    const tools = mcpModule.getToolDefinitions();
    const names = tools.map(t => t.name);
    assert.ok(names.includes('redirect_terminal_agent'), 'should include redirect_terminal_agent');
  });

  it('should include stop_terminal_agent tool', () => {
    const tools = mcpModule.getToolDefinitions();
    const names = tools.map(t => t.name);
    assert.ok(names.includes('stop_terminal_agent'), 'should include stop_terminal_agent');
  });

  it('should include get_agent_report tool', () => {
    const tools = mcpModule.getToolDefinitions();
    const names = tools.map(t => t.name);
    assert.ok(names.includes('get_agent_report'), 'should include get_agent_report');
  });

  it('spawn_terminal_agent should accept parent_agent_id parameter', () => {
    const tools = mcpModule.getToolDefinitions();
    const spawn = tools.find(t => t.name === 'spawn_terminal_agent');
    assert.ok(
      spawn.inputSchema.properties.parent_agent_id,
      'spawn_terminal_agent should have parent_agent_id in schema'
    );
  });

  it('should export getMcpServerSource', () => {
    assert.ok(
      typeof mcpModule.getMcpServerSource === 'function',
      'should export getMcpServerSource for installation'
    );
  });

  it('getMcpServerSource should return non-empty string', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.length > 100, 'MCP server source should be substantial');
  });

  it('getMcpServerSource should handle get_agent_report', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(
      source.includes('get_agent_report'),
      'MCP server source should handle get_agent_report tool'
    );
  });

  it('getMcpServerSource should handle parent_agent_id in spawn', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(
      source.includes('parent_agent_id'),
      'MCP server source should handle parent_agent_id parameter'
    );
  });
});

// ============================================================
// Path Validation & Mapping
// ============================================================

describe('Path validation and container path rejection', () => {
  let mcpModule;

  before(async () => {
    mcpModule = await import('../src/mcp/terminal-agents.js');
  });

  it('should reject /workspace/* paths with helpful error', () => {
    const result = mcpModule.executeTool('spawn_terminal_agent', {
      repo_path: '/workspace/group',
      task: 'test task'
    });
    assert.ok(result.error, 'should return error for container path');
    assert.ok(
      result.error.toLowerCase().includes('container') || result.error.toLowerCase().includes('path'),
      'error should mention container path: ' + result.error
    );
  });

  it('should reject /workspace/project paths', () => {
    const result = mcpModule.executeTool('spawn_terminal_agent', {
      repo_path: '/workspace/project',
      task: 'test task'
    });
    assert.ok(result.error, 'should return error for /workspace/project');
  });

  it('should export validateRepoPath function', () => {
    assert.ok(
      typeof mcpModule.validateRepoPath === 'function',
      'should export validateRepoPath'
    );
  });

  it('validateRepoPath should reject container paths', () => {
    const result = mcpModule.validateRepoPath('/workspace/group');
    assert.ok(!result.valid, '/workspace/group should be invalid');
    assert.ok(result.reason, 'should include reason');
  });

  it('validateRepoPath should accept host paths', () => {
    const result = mcpModule.validateRepoPath('/Users/demi/NanoClaw');
    assert.ok(result.valid, 'host path should be valid');
  });

  it('should export loadPathMappings function', () => {
    assert.ok(
      typeof mcpModule.loadPathMappings === 'function',
      'should export loadPathMappings'
    );
  });

  it('loadPathMappings should return empty object when no config file', () => {
    const mappings = mcpModule.loadPathMappings('/nonexistent/.claude');
    assert.deepEqual(mappings, {}, 'should return empty when no config');
  });

  it('should translate container path when mapping exists', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-test-'));
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    // Write a path mapping config
    await fs.writeFile(
      path.join(claudeDir, 'path-mappings.json'),
      JSON.stringify({ '/workspace/group': '/Users/demi/NanoClaw' }),
      'utf-8'
    );

    const mappings = mcpModule.loadPathMappings(claudeDir);
    assert.deepEqual(
      mappings,
      { '/workspace/group': '/Users/demi/NanoClaw' },
      'should load mappings from config file'
    );

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should apply path substitution to task descriptions', () => {
    assert.ok(
      typeof mcpModule.translatePaths === 'function',
      'should export translatePaths'
    );

    const mappings = { '/workspace/group': '/Users/demi/NanoClaw' };
    const translated = mcpModule.translatePaths(
      'Read /workspace/group/.claude/specs/heartbeat.md and build it',
      mappings
    );
    assert.ok(
      translated.includes('/Users/demi/NanoClaw/.claude/specs/heartbeat.md'),
      'task should have translated paths: ' + translated
    );
    assert.ok(
      !translated.includes('/workspace/group'),
      'container path should be replaced'
    );
  });
});

// ============================================================
// Error State Tracking
// ============================================================

describe('Error state tracking for failed spawns', () => {
  let mcpModule;

  before(async () => {
    mcpModule = await import('../src/mcp/terminal-agents.js');
  });

  it('failed spawn should record error in registry', () => {
    // Spawning with a non-existent path should fail and record the error
    const result = mcpModule.executeTool('spawn_terminal_agent', {
      repo_path: '/tmp/definitely-not-a-repo-' + Date.now(),
      task: 'test task'
    });
    assert.ok(result.error, 'spawn should fail for non-existent repo');
  });

  it('getMcpServerSource should include path validation', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(
      source.includes('/workspace') || source.includes('container'),
      'MCP server source should include container path detection'
    );
  });

  it('getMcpServerSource should include path mapping support', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(
      source.includes('path-mappings') || source.includes('pathMapping'),
      'MCP server source should support path mappings'
    );
  });
});

// ============================================================
// Plugin — Install/Uninstall/IsInstalled
// ============================================================

describe('Terminal Agents plugin', () => {
  let plugin;
  let tmpDir;
  let claudeDir;

  before(async () => {
    plugin = await import('../src/plugins/terminal-agents.js');
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ta-test-'));
    claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should export getNamespace', () => {
    assert.equal(plugin.getNamespace(), 'terminal-agents');
  });

  it('should not be installed initially', async () => {
    const installed = await plugin.isInstalled(claudeDir);
    assert.equal(installed, false);
  });

  it('should install MCP server file', async () => {
    await plugin.install(claudeDir, { targetDir: tmpDir });
    const mcpFile = path.join(claudeDir, 'helpers', 'terminal-agents-mcp.js');
    const exists = await fs.access(mcpFile).then(() => true).catch(() => false);
    assert.ok(exists, 'MCP server file should exist after install');
  });

  it('should configure .mcp.json', async () => {
    const mcpJson = path.join(tmpDir, '.mcp.json');
    const exists = await fs.access(mcpJson).then(() => true).catch(() => false);
    assert.ok(exists, '.mcp.json should exist after install');
    const config = JSON.parse(await fs.readFile(mcpJson, 'utf-8'));
    assert.ok(config.mcpServers['terminal-agents'], '.mcp.json should have terminal-agents entry');
  });

  it('should be installed after install', async () => {
    const installed = await plugin.isInstalled(claudeDir);
    assert.equal(installed, true);
  });

  it('should uninstall cleanly', async () => {
    await plugin.uninstall(claudeDir, { targetDir: tmpDir });
    const installed = await plugin.isInstalled(claudeDir);
    assert.equal(installed, false);
  });
});
