/**
 * Tests for Pi Brain migration — replacing Agent Cookbook with Pi Brain (pi.ruv.io)
 * Validates: no cookbook references remain, Pi Brain endpoints present
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const SHORTCUTS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts');

// All workflow shortcut files
const ALL_WORKFLOWS = [
  'w-tdd-swarm.md', 'w-plan-tdd-swarm.md', 'w-debug.md', 'w-fix.md',
  'w-hotfix.md', 'w-swarm.md', 'w-perf.md', 'w-security.md',
  'w-review.md', 'w-architect.md', 'w-compound.md', 'w-start.md',
  'w-end.md', 'w-search.md', 'w-multi-repo.md', 'w-ralph-batch.md',
  'w-ralph-goals.md', 'w-ralph-pick.md', 'w-ralph-this.md',
  'w-bg-tdd-swarm.md', 'w-bg-debug.md', 'w-bg-idea-tdd-swarm.md',
  'w-bg-perf.md', 'w-bg-review.md', 'w-bg-security.md',
];

// Workflows that had cookbook blocks (Discovery, Auto-Receipt, Auto-Recipe)
const WORKFLOWS_WITH_BRAIN_BLOCKS = [
  'w-tdd-swarm.md', 'w-plan-tdd-swarm.md', 'w-debug.md', 'w-fix.md',
  'w-hotfix.md', 'w-swarm.md', 'w-perf.md', 'w-security.md',
  'w-review.md', 'w-architect.md',
  'w-bg-tdd-swarm.md', 'w-bg-debug.md', 'w-bg-idea-tdd-swarm.md',
  'w-bg-perf.md', 'w-bg-review.md', 'w-bg-security.md',
];

describe('Pi Brain migration — no cookbook in shortcut files', () => {
  const contents = {};

  before(async () => {
    for (const file of ALL_WORKFLOWS) {
      try {
        contents[file] = await fs.readFile(path.join(SHORTCUTS_DIR, file), 'utf-8');
      } catch {
        contents[file] = null;
      }
    }
  });

  for (const file of ALL_WORKFLOWS) {
    it(`${file} has zero cookbook references`, () => {
      if (contents[file]) {
        const lower = contents[file].toLowerCase();
        assert.ok(
          !lower.includes('cookbook') && !lower.includes('agent-cookbook'),
          `${file} must not contain cookbook or agent-cookbook references`
        );
      }
    });
  }
});

describe('Pi Brain migration — no cookbook in dot-shortcuts.js', () => {
  let content;

  before(async () => {
    content = await fs.readFile(
      path.join(PROJECT_ROOT, 'src', 'plugins', 'dot-shortcuts.js'),
      'utf-8'
    );
  });

  it('dot-shortcuts.js has zero cookbook references', () => {
    const lower = content.toLowerCase();
    assert.ok(
      !lower.includes('cookbook'),
      'dot-shortcuts.js must not contain cookbook references'
    );
  });

  it('dot-shortcuts.js has zero agent-cookbook references', () => {
    assert.ok(
      !content.includes('agent-cookbook'),
      'dot-shortcuts.js must not contain agent-cookbook references'
    );
  });
});

describe('Pi Brain migration — Pi Brain present in w-plan-tdd-swarm.md', () => {
  let content;

  before(async () => {
    content = await fs.readFile(path.join(SHORTCUTS_DIR, 'w-plan-tdd-swarm.md'), 'utf-8');
  });

  it('has Pi Brain discovery block', () => {
    assert.ok(
      content.includes('pi.ruv.io') || content.includes('ruvector'),
      'Must reference pi.ruv.io or ruvector for discovery'
    );
  });

  it('discovery uses brain search', () => {
    const lower = content.toLowerCase();
    assert.ok(
      lower.includes('brain search') || lower.includes('brain_search') || lower.includes('memories/search'),
      'Discovery must use brain search or memories/search'
    );
  });

  it('auto-receipt uses brain vote', () => {
    const lower = content.toLowerCase();
    assert.ok(
      lower.includes('brain vote') || lower.includes('brain_vote') || lower.includes('/vote'),
      'Auto-receipt must use brain vote'
    );
  });

  it('compound uses brain share', () => {
    const lower = content.toLowerCase();
    assert.ok(
      lower.includes('brain share') || lower.includes('brain_share') || lower.includes('post /v1/memories'),
      'Compound must use brain share'
    );
  });
});

describe('Pi Brain migration — dot-shortcuts.js has Pi Brain content', () => {
  let content;

  before(async () => {
    content = await fs.readFile(
      path.join(PROJECT_ROOT, 'src', 'plugins', 'dot-shortcuts.js'),
      'utf-8'
    );
  });

  it('references pi.ruv.io or ruvector', () => {
    assert.ok(
      content.includes('pi.ruv.io') || content.includes('ruvector'),
      'dot-shortcuts.js must reference pi.ruv.io or ruvector'
    );
  });

  it('has brain search for discovery', () => {
    const lower = content.toLowerCase();
    assert.ok(
      lower.includes('brain search') || lower.includes('brain_search') || lower.includes('memories/search'),
      'Must have brain search for discovery blocks'
    );
  });

  it('has brain vote for receipts', () => {
    const lower = content.toLowerCase();
    assert.ok(
      lower.includes('brain vote') || lower.includes('brain_vote') || lower.includes('/vote'),
      'Must have brain vote for auto-receipt blocks'
    );
  });

  it('has brain share for compound', () => {
    const lower = content.toLowerCase();
    assert.ok(
      lower.includes('brain share') || lower.includes('brain_share'),
      'Must have brain share for compound auto-recipe blocks'
    );
  });
});
