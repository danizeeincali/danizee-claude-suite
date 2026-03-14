/**
 * Tests for Agent Browser integration in all applicable workflows
 * Validates: agent-browser reference, conditional language, install prompt, phase placement
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const SHORTCUTS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts');

// Workflows that SHOULD have agent-browser
const UI_WORKFLOWS = [
  'w-tdd-swarm.md',
  'w-plan-tdd-swarm.md',
  'w-debug.md',
  'w-fix.md',
  'w-hotfix.md',
  'w-swarm.md',
  'w-perf.md',
  'w-security.md',
  'w-review.md',
  'w-architect.md',
  'w-bg-tdd-swarm.md',
  'w-bg-debug.md',
  'w-bg-idea-tdd-swarm.md',
  'w-bg-perf.md',
  'w-bg-review.md',
  'w-bg-security.md',
];

// Workflows that should NOT have agent-browser
const NON_UI_WORKFLOWS = [
  'w-compound.md',
  'w-start.md',
  'w-end.md',
  'w-search.md',
  'w-multi-repo.md',
  'w-ralph-batch.md',
  'w-ralph-goals.md',
  'w-ralph-pick.md',
  'w-ralph-this.md',
];

// Workflows that have inline content in dot-shortcuts.js
const DOT_SHORTCUTS_WORKFLOWS = [
  'w-swarm',
  'w-tdd-swarm',
  'w-plan-tdd-swarm',
  'w-fix',
  'w-debug',
  'w-hotfix',
  'w-review',
  'w-security',
  'w-perf',
  'w-architect',
];

describe('Agent browser — shortcut files', () => {
  const contents = {};

  before(async () => {
    for (const file of [...UI_WORKFLOWS, ...NON_UI_WORKFLOWS]) {
      try {
        contents[file] = await fs.readFile(path.join(SHORTCUTS_DIR, file), 'utf-8');
      } catch {
        contents[file] = null;
      }
    }
  });

  for (const file of UI_WORKFLOWS) {
    it(`${file} contains agent-browser reference`, () => {
      assert.ok(contents[file], `${file} must exist`);
      assert.ok(
        contents[file].includes('agent-browser'),
        `${file} must reference agent-browser`
      );
    });
  }

  for (const file of UI_WORKFLOWS) {
    it(`${file} has conditional UI language`, () => {
      const lower = contents[file].toLowerCase();
      assert.ok(
        lower.includes('ui') || lower.includes('frontend') || lower.includes('visual'),
        `${file} browser block must be conditional on UI/frontend/visual changes`
      );
    });
  }

  for (const file of UI_WORKFLOWS) {
    it(`${file} has playwright install prompt`, () => {
      assert.ok(
        contents[file].includes('playwright'),
        `${file} must include playwright install prompt`
      );
    });
  }

  for (const file of NON_UI_WORKFLOWS) {
    it(`${file} does NOT contain agent-browser`, () => {
      if (contents[file]) {
        assert.ok(
          !contents[file].includes('agent-browser'),
          `${file} should NOT reference agent-browser`
        );
      }
    });
  }
});

describe('Agent browser — dot-shortcuts.js inline content', () => {
  let dotShortcutsContent;

  before(async () => {
    dotShortcutsContent = await fs.readFile(
      path.join(PROJECT_ROOT, 'src', 'plugins', 'dot-shortcuts.js'),
      'utf-8'
    );
  });

  for (const name of DOT_SHORTCUTS_WORKFLOWS) {
    it(`dot-shortcuts.js '${name}' entry contains agent-browser`, () => {
      // Find the entry block for this workflow
      const entryStart = dotShortcutsContent.indexOf(`'${name}':`);
      assert.ok(entryStart !== -1, `Entry '${name}' must exist in dot-shortcuts.js`);

      // Find the next entry or end of object
      const nextEntries = DOT_SHORTCUTS_WORKFLOWS
        .filter(n => n !== name)
        .map(n => dotShortcutsContent.indexOf(`'${n}':`, entryStart + 1))
        .filter(i => i > entryStart);
      const entryEnd = nextEntries.length > 0 ? Math.min(...nextEntries) : dotShortcutsContent.length;

      const entryContent = dotShortcutsContent.substring(entryStart, entryEnd);
      assert.ok(
        entryContent.includes('agent-browser'),
        `dot-shortcuts.js '${name}' inline content must reference agent-browser`
      );
    });
  }
});
