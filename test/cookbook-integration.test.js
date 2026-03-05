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

describe('Cookbook Discovery — w-swarm', () => {
  it('should contain recipe discovery instructions', () => {
    const content = commands['w-swarm'].content;
    assert.ok(
      content.includes('discover') || content.includes('Recipe Discovery'),
      'w-swarm should include recipe discovery'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-swarm'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-swarm should reference the cookbook registry'
    );
  });
});

describe('Cookbook Discovery — w-fix', () => {
  it('should contain recipe discovery instructions', () => {
    const content = commands['w-fix'].content;
    assert.ok(
      content.includes('discover') || content.includes('Recipe Discovery'),
      'w-fix should include recipe discovery'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-fix'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-fix should reference the cookbook registry'
    );
  });
});

describe('Cookbook Discovery — w-hotfix', () => {
  it('should contain recipe discovery instructions', () => {
    const content = commands['w-hotfix'].content;
    assert.ok(
      content.includes('discover') || content.includes('Recipe Discovery'),
      'w-hotfix should include recipe discovery'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-hotfix'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-hotfix should reference the cookbook registry'
    );
  });
});

describe('Cookbook Discovery — w-architect', () => {
  it('should contain recipe discovery instructions', () => {
    const content = commands['w-architect'].content;
    assert.ok(
      content.includes('discover') || content.includes('Recipe Discovery'),
      'w-architect should include recipe discovery'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-architect'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-architect should reference the cookbook registry'
    );
  });
});

describe('Cookbook Discovery — w-agent-tdd-swarm', () => {
  it('should contain recipe discovery instructions', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      content.includes('discover') || content.includes('Recipe Discovery'),
      'w-agent-tdd-swarm should include recipe discovery'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-agent-tdd-swarm should reference the cookbook registry'
    );
  });
});

describe('Cookbook Discovery — w-agent-interview-swarm', () => {
  it('should contain recipe discovery instructions', () => {
    const content = commands['w-agent-interview-swarm'].content;
    assert.ok(
      content.includes('discover') || content.includes('Recipe Discovery'),
      'w-agent-interview-swarm should include recipe discovery'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-agent-interview-swarm'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-agent-interview-swarm should reference the cookbook registry'
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

describe('Auto-Receipt — w-swarm', () => {
  it('should contain receipt submission instructions', () => {
    const content = commands['w-swarm'].content;
    assert.ok(
      content.includes('receipt') || content.includes('Auto-Receipt'),
      'w-swarm should include receipt submission'
    );
  });

  it('should reference the registry URL', () => {
    const content = commands['w-swarm'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-swarm auto-receipt should reference the cookbook registry'
    );
  });
});

describe('Auto-Receipt — w-fix', () => {
  it('should contain receipt submission instructions', () => {
    const content = commands['w-fix'].content;
    assert.ok(
      content.includes('receipt') || content.includes('Auto-Receipt'),
      'w-fix should include receipt submission'
    );
  });
});

describe('Auto-Receipt — w-hotfix', () => {
  it('should contain receipt submission instructions', () => {
    const content = commands['w-hotfix'].content;
    assert.ok(
      content.includes('receipt') || content.includes('Auto-Receipt'),
      'w-hotfix should include receipt submission'
    );
  });
});

describe('Auto-Receipt — w-agent-tdd-swarm', () => {
  it('should contain receipt submission instructions', () => {
    const content = commands['w-agent-tdd-swarm'].content;
    assert.ok(
      content.includes('receipt') || content.includes('Auto-Receipt'),
      'w-agent-tdd-swarm should include receipt submission'
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

// Auto-recipe check in compound phases of build workflows
const workflowsWithAutoRecipe = [
  'w-tdd-swarm',
  'w-interview-tdd-swarm',
  'w-debug',
  'w-swarm',
  'w-fix',
  'w-hotfix',
  'w-architect',
  'w-agent-tdd-swarm',
  'w-review',
  'w-security',
  'w-perf',
  'w-multi-repo',
  'w-end',
];

describe('Auto-Recipe in Compound Phase', () => {
  for (const name of workflowsWithAutoRecipe) {
    it(`${name} compound phase should include auto-recipe check`, () => {
      const content = commands[name].content;
      assert.ok(
        content.includes('AUTO-RECIPE') || content.includes('auto_recipes') || content.includes('submit-recipe'),
        `${name} compound phase should include auto-recipe check`
      );
    });
  }
});

// ============================================================
// Suite Sync workflow
// ============================================================

describe('Suite Sync — w-suite-sync', () => {
  it('should exist as a command', () => {
    assert.ok(commands['w-suite-sync'], 'w-suite-sync command should exist');
  });

  it('should reference the suite sync recipe ID', () => {
    const content = commands['w-suite-sync'].content;
    assert.ok(
      content.includes('sha256:1bf583f6dcf5282fbc55ae1b70246bb8a25a908d1c003c315e15a027c4625014'),
      'w-suite-sync should reference the suite sync recipe ID'
    );
  });

  it('should reference the cookbook registry', () => {
    const content = commands['w-suite-sync'].content;
    assert.ok(
      content.includes('agent-cookbook.replit.app'),
      'w-suite-sync should reference the cookbook registry'
    );
  });

  it('should enforce additive-only changes', () => {
    const content = commands['w-suite-sync'].content;
    assert.ok(
      content.includes('additive') || content.includes('NEVER modify existing'),
      'w-suite-sync should enforce additive-only changes'
    );
  });

  it('should include regression verification', () => {
    const content = commands['w-suite-sync'].content;
    assert.ok(
      content.includes('regression') || content.includes('npm test'),
      'w-suite-sync should include regression verification'
    );
  });

  it('should include auto-receipt for the recipe', () => {
    const content = commands['w-suite-sync'].content;
    assert.ok(
      content.includes('receipt') || content.includes('Auto-Receipt'),
      'w-suite-sync should include auto-receipt'
    );
  });
});
