/**
 * Tests for Verification Checkpoint — cross-method validation in all workflows
 * Validates: verification block present, independent checks, retry logic
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const SHORTCUTS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts');

// Workflows that SHOULD have verification checkpoint
const VERIFIED_WORKFLOWS = [
  'w-tdd-swarm.md', 'w-plan-tdd-swarm.md', 'w-debug.md', 'w-fix.md',
  'w-hotfix.md', 'w-swarm.md', 'w-perf.md', 'w-security.md',
  'w-review.md', 'w-architect.md',
  'w-bg-tdd-swarm.md', 'w-bg-debug.md', 'w-bg-idea-tdd-swarm.md',
  'w-bg-perf.md', 'w-bg-review.md', 'w-bg-security.md',
];

// Workflows that should NOT have verification checkpoint
const NO_VERIFY_WORKFLOWS = [
  'w-compound.md', 'w-start.md', 'w-end.md', 'w-search.md',
  'w-multi-repo.md', 'w-ralph-batch.md', 'w-ralph-goals.md',
  'w-ralph-pick.md', 'w-ralph-this.md',
];

// Workflows with dot-shortcuts.js inline entries
const DOT_SHORTCUTS_WORKFLOWS = [
  'w-swarm', 'w-tdd-swarm', 'w-plan-tdd-swarm', 'w-fix', 'w-debug',
  'w-hotfix', 'w-review', 'w-security', 'w-perf', 'w-architect',
];

describe('Verification checkpoint — shortcut files', () => {
  const contents = {};

  before(async () => {
    for (const file of [...VERIFIED_WORKFLOWS, ...NO_VERIFY_WORKFLOWS]) {
      try {
        contents[file] = await fs.readFile(path.join(SHORTCUTS_DIR, file), 'utf-8');
      } catch {
        contents[file] = null;
      }
    }
  });

  for (const file of VERIFIED_WORKFLOWS) {
    it(`${file} has VERIFICATION checkpoint`, () => {
      assert.ok(contents[file], `${file} must exist`);
      const lower = contents[file].toLowerCase();
      assert.ok(
        lower.includes('verification'),
        `${file} must contain a VERIFICATION checkpoint`
      );
    });
  }

  for (const file of VERIFIED_WORKFLOWS) {
    it(`${file} has independent/cross-method language`, () => {
      const lower = contents[file].toLowerCase();
      assert.ok(
        lower.includes('independent') || lower.includes('cross-method'),
        `${file} must reference independent or cross-method validation`
      );
    });
  }

  for (const file of VERIFIED_WORKFLOWS) {
    it(`${file} has test re-run instruction`, () => {
      const lower = contents[file].toLowerCase();
      assert.ok(
        (lower.includes('re-run') || lower.includes('rerun') || lower.includes('run tests') || lower.includes('run the test')) &&
        lower.includes('independent'),
        `${file} must instruct to independently re-run tests`
      );
    });
  }

  for (const file of VERIFIED_WORKFLOWS) {
    it(`${file} has retry/escalation logic`, () => {
      const lower = contents[file].toLowerCase();
      assert.ok(
        lower.includes('retry') || lower.includes('retries') || lower.includes('escalat'),
        `${file} must include retry or escalation logic`
      );
    });
  }

  for (const file of NO_VERIFY_WORKFLOWS) {
    it(`${file} does NOT have VERIFICATION checkpoint`, () => {
      if (contents[file]) {
        // Check for the specific verification checkpoint, not just the word
        assert.ok(
          !contents[file].includes('VERIFICATION CHECKPOINT') &&
          !contents[file].includes('Cross-Method Verification'),
          `${file} should NOT have a verification checkpoint`
        );
      }
    });
  }
});

describe('Verification checkpoint — dot-shortcuts.js', () => {
  let content;

  before(async () => {
    content = await fs.readFile(
      path.join(PROJECT_ROOT, 'src', 'plugins', 'dot-shortcuts.js'),
      'utf-8'
    );
  });

  for (const name of DOT_SHORTCUTS_WORKFLOWS) {
    it(`dot-shortcuts.js '${name}' has verification block`, () => {
      const entryStart = content.indexOf(`'${name}':`);
      assert.ok(entryStart !== -1, `Entry '${name}' must exist`);

      // Find the content between this entry and the next
      const nextEntries = DOT_SHORTCUTS_WORKFLOWS
        .filter(n => n !== name)
        .map(n => content.indexOf(`'${n}':`, entryStart + 1))
        .filter(i => i > entryStart);
      const entryEnd = nextEntries.length > 0 ? Math.min(...nextEntries) : content.length;

      const entryContent = content.substring(entryStart, entryEnd).toLowerCase();
      assert.ok(
        entryContent.includes('verification'),
        `dot-shortcuts.js '${name}' must contain verification checkpoint`
      );
    });
  }
});
