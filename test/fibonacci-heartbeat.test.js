/**
 * Tests for Fibonacci-filtered heartbeat system.
 *
 * Covers:
 *   - fibonacci-heartbeat.js library (beat schedule, timing, heartbeat records, FibonacciHeartbeat class)
 *   - MCP tool definitions (send_agent_heartbeat, get_agent_heartbeats)
 *   - Heartbeat protocol in MCP server source
 *   - Instant ack on redirect
 *   - Heartbeat storage and retrieval
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

// ============================================================
// fibonacci-heartbeat.js — Core Library
// ============================================================

describe('Fibonacci heartbeat library', () => {
  let lib;

  before(async () => {
    lib = await import('../src/lib/fibonacci-heartbeat.js');
  });

  describe('getBeatSchedule', () => {
    it('should return 9 beat times', () => {
      const schedule = lib.getBeatSchedule();
      assert.equal(schedule.length, 9);
    });

    it('should return [1, 2, 4, 7, 12, 20, 33, 54, 88]', () => {
      const schedule = lib.getBeatSchedule();
      assert.deepEqual(schedule, [1, 2, 4, 7, 12, 20, 33, 54, 88]);
    });

    it('should return a copy (not mutable reference)', () => {
      const a = lib.getBeatSchedule();
      const b = lib.getBeatSchedule();
      a[0] = 999;
      assert.notEqual(b[0], 999);
    });
  });

  describe('getBeatDeltas', () => {
    it('should return 9 deltas', () => {
      const deltas = lib.getBeatDeltas();
      assert.equal(deltas.length, 9);
    });

    it('should return Fibonacci deltas [1, 1, 2, 3, 5, 8, 13, 21, 34]', () => {
      const deltas = lib.getBeatDeltas();
      assert.deepEqual(deltas, [1, 1, 2, 3, 5, 8, 13, 21, 34]);
    });

    it('deltas should sum to match beat schedule', () => {
      const deltas = lib.getBeatDeltas();
      const schedule = lib.getBeatSchedule();
      let sum = 0;
      for (let i = 0; i < deltas.length; i++) {
        sum += deltas[i];
        assert.equal(sum, schedule[i], `cumulative delta at index ${i} should match schedule`);
      }
    });
  });

  describe('getCurrentBeat', () => {
    it('should return -1 before first beat', () => {
      assert.equal(lib.getCurrentBeat(0), -1);
      assert.equal(lib.getCurrentBeat(0.5), -1);
    });

    it('should return 0 at 1 second', () => {
      assert.equal(lib.getCurrentBeat(1), 0);
    });

    it('should return 1 at 2 seconds', () => {
      assert.equal(lib.getCurrentBeat(2), 1);
    });

    it('should return 2 at 4 seconds', () => {
      assert.equal(lib.getCurrentBeat(4), 2);
    });

    it('should return correct beat for each schedule point', () => {
      const schedule = lib.getBeatSchedule();
      for (let i = 0; i < schedule.length; i++) {
        assert.equal(lib.getCurrentBeat(schedule[i]), i, `beat at ${schedule[i]}s should be ${i}`);
      }
    });

    it('should return 8 after 88 seconds', () => {
      assert.equal(lib.getCurrentBeat(88), 8);
      assert.equal(lib.getCurrentBeat(100), 8);
      assert.equal(lib.getCurrentBeat(1000), 8);
    });

    it('should handle mid-interval correctly', () => {
      assert.equal(lib.getCurrentBeat(3), 1, '3s is between beat 1 (2s) and beat 2 (4s)');
      assert.equal(lib.getCurrentBeat(10), 3, '10s is between beat 3 (7s) and beat 4 (12s)');
    });
  });

  describe('getNextBeat', () => {
    it('should return beat 0 when at 0 seconds', () => {
      const next = lib.getNextBeat(0);
      assert.ok(next);
      assert.equal(next.beatIndex, 0);
      assert.equal(next.beatTime, 1);
      assert.equal(next.delayMs, 1000);
    });

    it('should return beat 1 after 1 second', () => {
      const next = lib.getNextBeat(1);
      assert.ok(next);
      assert.equal(next.beatIndex, 1);
      assert.equal(next.beatTime, 2);
      assert.equal(next.delayMs, 1000);
    });

    it('should return null after all beats exhausted', () => {
      const next = lib.getNextBeat(88);
      assert.equal(next, null);
    });

    it('should return null for very large elapsed times', () => {
      const next = lib.getNextBeat(1000);
      assert.equal(next, null);
    });

    it('should calculate correct delay for mid-interval', () => {
      const next = lib.getNextBeat(1.5);
      assert.ok(next);
      assert.equal(next.beatIndex, 1);
      assert.equal(next.delayMs, 500);
    });
  });

  describe('HeartbeatType', () => {
    it('should have ack, progress, complete, error types', () => {
      assert.equal(lib.HeartbeatType.ACK, 'ack');
      assert.equal(lib.HeartbeatType.PROGRESS, 'progress');
      assert.equal(lib.HeartbeatType.COMPLETE, 'complete');
      assert.equal(lib.HeartbeatType.ERROR, 'error');
    });
  });

  describe('createHeartbeat', () => {
    it('should create a valid heartbeat record', () => {
      const hb = lib.createHeartbeat({
        agentId: 'agent-test-1234',
        type: 'progress',
        beatIndex: 3,
        message: 'Building components...',
      });
      assert.equal(hb.agentId, 'agent-test-1234');
      assert.equal(hb.type, 'progress');
      assert.equal(hb.beatIndex, 3);
      assert.equal(hb.beatTime, 7); // FIBONACCI_BEATS[3] = 7
      assert.equal(hb.message, 'Building components...');
      assert.ok(hb.timestamp);
    });

    it('should create ack heartbeat with beatIndex -1', () => {
      const hb = lib.createHeartbeat({
        agentId: 'agent-test-1234',
        type: 'ack',
        beatIndex: -1,
        message: '...',
      });
      assert.equal(hb.beatIndex, -1);
      assert.equal(hb.beatTime, 0);
    });

    it('should include metadata when provided', () => {
      const hb = lib.createHeartbeat({
        agentId: 'agent-test-1234',
        type: 'progress',
        beatIndex: 0,
        message: 'Working...',
        metadata: { phase: 'search', progress: 25 },
      });
      assert.deepEqual(hb.metadata, { phase: 'search', progress: 25 });
    });

    it('should default metadata to empty object', () => {
      const hb = lib.createHeartbeat({
        agentId: 'agent-test-1234',
        type: 'ack',
        beatIndex: -1,
        message: '...',
      });
      assert.deepEqual(hb.metadata, {});
    });
  });

  describe('FibonacciHeartbeat class', () => {
    it('should emit ack immediately on start', () => {
      const beats = [];
      const hb = new lib.FibonacciHeartbeat('agent-test', (b) => beats.push(b));
      hb.start();
      hb._stop(); // prevent timers from running

      assert.equal(beats.length, 1);
      assert.equal(beats[0].type, 'ack');
      assert.equal(beats[0].message, '...');
    });

    it('should accept custom ack message', () => {
      const beats = [];
      const hb = new lib.FibonacciHeartbeat('agent-test', (b) => beats.push(b));
      hb.start('Processing your request...');
      hb._stop();

      assert.equal(beats[0].message, 'Processing your request...');
    });

    it('should emit complete heartbeat', () => {
      const beats = [];
      const hb = new lib.FibonacciHeartbeat('agent-test', (b) => beats.push(b));
      hb.start();
      hb.complete('Done! PR created.', { prUrl: 'https://github.com/test/pr/1' });

      assert.equal(beats.length, 2);
      assert.equal(beats[1].type, 'complete');
      assert.equal(beats[1].message, 'Done! PR created.');
      assert.deepEqual(beats[1].metadata, { prUrl: 'https://github.com/test/pr/1' });
    });

    it('should emit error heartbeat', () => {
      const beats = [];
      const hb = new lib.FibonacciHeartbeat('agent-test', (b) => beats.push(b));
      hb.start();
      hb.error('Build failed: test failures');

      assert.equal(beats.length, 2);
      assert.equal(beats[1].type, 'error');
      assert.equal(beats[1].message, 'Build failed: test failures');
    });

    it('should stop scheduling after complete', () => {
      const hb = new lib.FibonacciHeartbeat('agent-test', () => {});
      hb.start();
      hb.complete('Done');
      assert.equal(hb.stopped, true);
      assert.equal(hb.timer, null);
    });

    it('should track history', () => {
      const hb = new lib.FibonacciHeartbeat('agent-test', () => {});
      hb.start();
      hb.complete('Done');

      const history = hb.getHistory();
      assert.equal(history.length, 2);
      assert.equal(history[0].type, 'ack');
      assert.equal(history[1].type, 'complete');
    });

    it('should update pending message', () => {
      const hb = new lib.FibonacciHeartbeat('agent-test', () => {});
      hb.start();
      hb.update('Running tests...', { phase: 'test' });
      assert.deepEqual(hb.pendingMessage, { message: 'Running tests...', metadata: { phase: 'test' } });
      hb._stop();
    });

    it('getElapsed should return 0 before start', () => {
      const hb = new lib.FibonacciHeartbeat('agent-test', () => {});
      assert.equal(hb.getElapsed(), 0);
    });

    it('getElapsed should return positive after start', () => {
      const hb = new lib.FibonacciHeartbeat('agent-test', () => {});
      hb.start();
      assert.ok(hb.getElapsed() >= 0);
      hb._stop();
    });
  });
});

// ============================================================
// MCP Tool Definitions — Heartbeat Tools
// ============================================================

describe('MCP heartbeat tool definitions', () => {
  let mcpModule;

  before(async () => {
    mcpModule = await import('../src/mcp/terminal-agents.js');
  });

  it('should return 7 tool definitions (5 original + 2 heartbeat)', () => {
    const tools = mcpModule.getToolDefinitions();
    assert.equal(tools.length, 7);
  });

  it('should include send_agent_heartbeat tool', () => {
    const tools = mcpModule.getToolDefinitions();
    const names = tools.map(t => t.name);
    assert.ok(names.includes('send_agent_heartbeat'));
  });

  it('should include get_agent_heartbeats tool', () => {
    const tools = mcpModule.getToolDefinitions();
    const names = tools.map(t => t.name);
    assert.ok(names.includes('get_agent_heartbeats'));
  });

  it('send_agent_heartbeat should require agent_id, type, and message', () => {
    const tools = mcpModule.getToolDefinitions();
    const tool = tools.find(t => t.name === 'send_agent_heartbeat');
    assert.deepEqual(tool.inputSchema.required, ['agent_id', 'type', 'message']);
  });

  it('send_agent_heartbeat should accept beat_index and metadata', () => {
    const tools = mcpModule.getToolDefinitions();
    const tool = tools.find(t => t.name === 'send_agent_heartbeat');
    assert.ok(tool.inputSchema.properties.beat_index);
    assert.ok(tool.inputSchema.properties.metadata);
  });

  it('send_agent_heartbeat type should be enum of ack/progress/complete/error', () => {
    const tools = mcpModule.getToolDefinitions();
    const tool = tools.find(t => t.name === 'send_agent_heartbeat');
    assert.deepEqual(tool.inputSchema.properties.type.enum, ['ack', 'progress', 'complete', 'error']);
  });

  it('get_agent_heartbeats should require agent_id', () => {
    const tools = mcpModule.getToolDefinitions();
    const tool = tools.find(t => t.name === 'get_agent_heartbeats');
    assert.deepEqual(tool.inputSchema.required, ['agent_id']);
  });

  it('get_agent_heartbeats should accept optional since_timestamp', () => {
    const tools = mcpModule.getToolDefinitions();
    const tool = tools.find(t => t.name === 'get_agent_heartbeats');
    assert.ok(tool.inputSchema.properties.since_timestamp);
  });
});

// ============================================================
// MCP Server Source — Heartbeat Support
// ============================================================

describe('MCP server source heartbeat support', () => {
  let mcpModule;

  before(async () => {
    mcpModule = await import('../src/mcp/terminal-agents.js');
  });

  it('getMcpServerSource should include HEARTBEATS_PATH', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes('HEARTBEATS_PATH'), 'should define heartbeats storage path');
  });

  it('getMcpServerSource should include FIBONACCI_BEATS array', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes('FIBONACCI_BEATS'), 'should define Fibonacci beats');
  });

  it('getMcpServerSource should handle send_agent_heartbeat', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes('send_agent_heartbeat'), 'should handle send_agent_heartbeat tool');
  });

  it('getMcpServerSource should handle get_agent_heartbeats', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes('get_agent_heartbeats'), 'should handle get_agent_heartbeats tool');
  });

  it('getMcpServerSource should include heartbeat notification support', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes('notifications/heartbeat'), 'should emit heartbeat notifications');
  });

  it('getMcpServerSource should include heartbeat capability in initialize', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes('heartbeat: true'), 'should advertise heartbeat capability');
  });

  it('getMcpServerSource should record ack on spawn', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(
      source.includes('recordHB') && source.includes("type: 'ack'"),
      'should record ack heartbeat on spawn'
    );
  });

  it('getMcpServerSource should record ack on redirect', () => {
    const source = mcpModule.getMcpServerSource();
    // The redirect handler should call recordHB with ack
    const redirectSection = source.substring(
      source.indexOf("'redirect_terminal_agent'"),
      source.indexOf("'stop_terminal_agent'")
    );
    assert.ok(redirectSection.includes('recordHB'), 'redirect should record heartbeat');
  });

  it('getMcpServerSource should include heartbeat protocol in spawn prompt', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes('HEARTBEAT PROTOCOL'), 'spawn prompt should instruct agents about heartbeat protocol');
  });

  it('getMcpServerSource should include notify function', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes('function notify'), 'should define notify function for JSON-RPC notifications');
  });

  it('getMcpServerSource should report server version 2.0.0', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes("version: '2.0.0'"), 'server version should be 2.0.0');
  });

  it('getMcpServerSource should show heartbeat in check_terminal_agents', () => {
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes('Last heartbeat'), 'check_terminal_agents should display latest heartbeat');
  });
});

// ============================================================
// Heartbeat Storage — File-based heartbeat persistence
// ============================================================

describe('Heartbeat storage via executeTool', () => {
  let mcpModule;
  let tmpDir;
  let origCwd;

  before(async () => {
    mcpModule = await import('../src/mcp/terminal-agents.js');
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-test-'));
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    // Write a fake registry with a test agent
    const registry = {
      agents: [{
        id: 'agent-test-hb-1234',
        repoPath: tmpDir,
        worktreePath: tmpDir,
        branch: 'feat/test',
        tmuxSession: 'agent-test-hb-1234',
        status: 'running',
        prompt: 'Test heartbeat task',
        startedAt: new Date().toISOString(),
      }]
    };
    await fs.writeFile(
      path.join(claudeDir, 'terminal-agents.json'),
      JSON.stringify(registry, null, 2)
    );

    // Change cwd so the module finds the registry
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  after(async () => {
    process.chdir(origCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('send_agent_heartbeat should record ack heartbeat', () => {
    const result = mcpModule.executeTool('send_agent_heartbeat', {
      agent_id: 'agent-test-hb-1234',
      type: 'ack',
      message: '...',
      beat_index: -1,
    });
    assert.ok(result.success, 'should succeed');
    assert.equal(result.heartbeat.type, 'ack');
    assert.equal(result.heartbeat.beatIndex, -1);
  });

  it('send_agent_heartbeat should record progress heartbeat', () => {
    const result = mcpModule.executeTool('send_agent_heartbeat', {
      agent_id: 'agent-test-hb-1234',
      type: 'progress',
      message: 'Searching codebase...',
      beat_index: 0,
      metadata: { phase: 'search' },
    });
    assert.ok(result.success);
    assert.equal(result.heartbeat.type, 'progress');
    assert.equal(result.heartbeat.beatIndex, 0);
    assert.equal(result.heartbeat.beatTime, 1); // FIBONACCI_BEATS[0] = 1
  });

  it('send_agent_heartbeat should map beat_index to correct beat time', () => {
    const expectedTimes = [1, 2, 4, 7, 12, 20, 33, 54, 88];
    for (let i = 0; i < expectedTimes.length; i++) {
      const result = mcpModule.executeTool('send_agent_heartbeat', {
        agent_id: 'agent-test-hb-1234',
        type: 'progress',
        message: `Beat ${i}`,
        beat_index: i,
      });
      assert.equal(result.heartbeat.beatTime, expectedTimes[i], `beat_index ${i} should map to ${expectedTimes[i]}s`);
    }
  });

  it('send_agent_heartbeat should record complete heartbeat', () => {
    const result = mcpModule.executeTool('send_agent_heartbeat', {
      agent_id: 'agent-test-hb-1234',
      type: 'complete',
      message: 'PR created: https://github.com/test/pr/42',
      metadata: { prUrl: 'https://github.com/test/pr/42' },
    });
    assert.ok(result.success);
    assert.equal(result.heartbeat.type, 'complete');
  });

  it('send_agent_heartbeat should fail for unknown agent', () => {
    const result = mcpModule.executeTool('send_agent_heartbeat', {
      agent_id: 'agent-nonexistent',
      type: 'ack',
      message: '...',
    });
    assert.ok(result.error);
    assert.ok(result.error.includes('not found'));
  });

  it('get_agent_heartbeats should return all recorded heartbeats', () => {
    const result = mcpModule.executeTool('get_agent_heartbeats', {
      agent_id: 'agent-test-hb-1234',
    });
    assert.ok(!result.error);
    assert.ok(result.heartbeats.length >= 3, 'should have at least ack + progress + complete');
    assert.equal(result.agentId, 'agent-test-hb-1234');
    assert.deepEqual(result.fibonacciSchedule, [1, 2, 4, 7, 12, 20, 33, 54, 88]);
  });

  it('get_agent_heartbeats should support since_timestamp filtering', () => {
    // Get all heartbeats first
    const allResult = mcpModule.executeTool('get_agent_heartbeats', {
      agent_id: 'agent-test-hb-1234',
    });
    const totalCount = allResult.total;

    // Use a future timestamp — should return 0
    const futureResult = mcpModule.executeTool('get_agent_heartbeats', {
      agent_id: 'agent-test-hb-1234',
      since_timestamp: new Date(Date.now() + 60000).toISOString(),
    });
    assert.equal(futureResult.total, 0);

    // Use a past timestamp — should return all
    const pastResult = mcpModule.executeTool('get_agent_heartbeats', {
      agent_id: 'agent-test-hb-1234',
      since_timestamp: new Date(0).toISOString(),
    });
    assert.equal(pastResult.total, totalCount);
  });

  it('get_agent_heartbeats should fail for unknown agent', () => {
    const result = mcpModule.executeTool('get_agent_heartbeats', {
      agent_id: 'agent-nonexistent',
    });
    assert.ok(result.error);
    assert.ok(result.error.includes('not found'));
  });

  it('heartbeats should persist to agent-heartbeats.json', async () => {
    const hbPath = path.join(tmpDir, '.claude', 'agent-heartbeats.json');
    const exists = await fs.access(hbPath).then(() => true).catch(() => false);
    assert.ok(exists, 'agent-heartbeats.json should exist');

    const content = JSON.parse(await fs.readFile(hbPath, 'utf-8'));
    assert.ok(content['agent-test-hb-1234'], 'should have entries for test agent');
    assert.ok(content['agent-test-hb-1234'].length > 0, 'should have heartbeat entries');
  });

  it('send_agent_heartbeat should update lastHeartbeat in agent registry', () => {
    // Read registry directly
    const regPath = path.join(tmpDir, '.claude', 'terminal-agents.json');
    const registry = JSON.parse(fsSync.readFileSync(regPath, 'utf-8'));
    const agent = registry.agents.find(a => a.id === 'agent-test-hb-1234');
    assert.ok(agent.lastHeartbeat, 'agent should have lastHeartbeat field');
    assert.equal(agent.lastHeartbeat.type, 'complete', 'last heartbeat should be complete');
  });
});

// ============================================================
// Spawn + Redirect Ack Heartbeat
// ============================================================

describe('Spawn and redirect heartbeat protocol', () => {
  let mcpModule;

  before(async () => {
    mcpModule = await import('../src/mcp/terminal-agents.js');
  });

  it('spawn prompt should include HEARTBEAT PROTOCOL instruction', () => {
    // We can verify this by checking the getMcpServerSource output
    const source = mcpModule.getMcpServerSource();
    assert.ok(source.includes('HEARTBEAT PROTOCOL'));
    assert.ok(source.includes('send_agent_heartbeat'));
  });

  it('redirect_terminal_agent description should still be about sending messages', () => {
    const tools = mcpModule.getToolDefinitions();
    const redirect = tools.find(t => t.name === 'redirect_terminal_agent');
    assert.ok(redirect.description.includes('Send a message'));
  });
});

// ============================================================
// Default export
// ============================================================

describe('fibonacci-heartbeat default export', () => {
  let lib;

  before(async () => {
    lib = await import('../src/lib/fibonacci-heartbeat.js');
  });

  it('should export all functions via default', () => {
    const def = lib.default;
    assert.ok(typeof def.getBeatSchedule === 'function');
    assert.ok(typeof def.getBeatDeltas === 'function');
    assert.ok(typeof def.getCurrentBeat === 'function');
    assert.ok(typeof def.getNextBeat === 'function');
    assert.ok(typeof def.createHeartbeat === 'function');
    assert.ok(def.HeartbeatType);
    assert.ok(def.FibonacciHeartbeat);
  });
});
