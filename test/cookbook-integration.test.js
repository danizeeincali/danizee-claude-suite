/**
 * Tests for Agent Cookbook integration into workflow commands.
 * Verifies that discovery, auto-receipt, and auto-recipe instructions
 * are baked into the relevant workflow .md content.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let commands;

before(async () => {
  const mod = await import('../src/plugins/dot-shortcuts.js');
  commands = mod.getCommands();
});

// ============================================================
// Discovery Integration (at workflow START)
// ============================================================

describe('Cookbook Discovery — w-tdd-swarm', () => {
  it('should contain recipe discovery instructions', () => {
    const content = commands['w-tdd-swarm'].content;
    assert.ok(
      content.includes('discover') || content.includes('recipe'),
      'w-tdd-swarm should include recipe discovery'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-tdd-swarm'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-tdd-swarm should reference the cookbook registry'
    );
  });
});

describe('Cookbook Discovery — w-interview-tdd-swarm', () => {
  it('should contain recipe discovery instructions', () => {
    const content = commands['w-interview-tdd-swarm'].content;
    assert.ok(
      content.includes('discover') || content.includes('recipe'),
      'w-interview-tdd-swarm should include recipe discovery'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-interview-tdd-swarm'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-interview-tdd-swarm should reference the cookbook registry'
    );
  });
});

describe('Cookbook Discovery — w-debug', () => {
  it('should contain recipe discovery instructions', () => {
    const content = commands['w-debug'].content;
    assert.ok(
      content.includes('discover') || content.includes('recipe'),
      'w-debug should include recipe discovery'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-debug'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-debug should reference the cookbook registry'
    );
  });
});

// ============================================================
// Auto-Receipt Integration (at workflow END, after tests pass)
// ============================================================

describe('Auto-Receipt — w-tdd-swarm', () => {
  it('should contain receipt submission instructions', () => {
    const content = commands['w-tdd-swarm'].content;
    assert.ok(
      content.includes('receipt'),
      'w-tdd-swarm should include receipt submission'
    );
  });

  it('should reference config honor (auto_receipts)', () => {
    const content = commands['w-tdd-swarm'].content;
    assert.ok(
      content.includes('auto_receipts') || content.includes('config'),
      'w-tdd-swarm should mention config checking for receipts'
    );
  });
});

describe('Auto-Receipt — w-interview-tdd-swarm', () => {
  it('should contain receipt submission instructions', () => {
    const content = commands['w-interview-tdd-swarm'].content;
    assert.ok(
      content.includes('receipt'),
      'w-interview-tdd-swarm should include receipt submission'
    );
  });
});

describe('Auto-Receipt — w-debug', () => {
  it('should contain receipt submission instructions', () => {
    const content = commands['w-debug'].content;
    assert.ok(
      content.includes('receipt'),
      'w-debug should include receipt submission'
    );
  });
});

// ============================================================
// Auto-Recipe Integration (in compound workflows)
// ============================================================

describe('Auto-Recipe — w-compound', () => {
  it('should contain recipe extraction instructions', () => {
    const content = commands['w-compound'].content;
    assert.ok(
      content.includes('recipe') || content.includes('auto_recipe'),
      'w-compound should include recipe extraction'
    );
  });

  it('should reference config honor (auto_recipes)', () => {
    const content = commands['w-compound'].content;
    assert.ok(
      content.includes('auto_recipes') || content.includes('config'),
      'w-compound should mention config checking for recipes'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-compound'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-compound should reference the cookbook registry'
    );
  });
});

describe('Auto-Recipe — w-background-compound', () => {
  it('should contain recipe extraction instructions', () => {
    const content = commands['w-background-compound'].content;
    assert.ok(
      content.includes('recipe') || content.includes('auto_recipe'),
      'w-background-compound should include recipe extraction'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-background-compound'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-background-compound should reference the cookbook registry'
    );
  });
});
