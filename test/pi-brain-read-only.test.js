/**
 * Tests for Pi Brain read-only mode in suite workflows.
 *
 * - Search uses real HTTP API (curl with Bearer anonymous)
 * - No auto-share checkpoints in any workflow
 * - No auto-vote checkpoints in any workflow
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { DaniZeeSuiteInstaller } from '../src/installer.js';

describe('Pi Brain read-only mode', () => {
  let testDir;
  let shortcutsDir;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-pi-brain-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true });
    await installer.install();
    shortcutsDir = path.join(testDir, '.claude', 'commands', '.shortcuts');
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should use HTTP API for Pi Brain search, not npx ruvector', async () => {
    const files = await fs.readdir(shortcutsDir);
    for (const file of files.filter(f => f.startsWith('w-') && f.endsWith('.md'))) {
      const content = await fs.readFile(path.join(shortcutsDir, file), 'utf-8');
      if (content.includes('Pi Brain') && content.includes('search')) {
        assert.ok(
          content.includes('pi.ruv.io') || content.includes('curl'),
          `${file}: Pi Brain search should use HTTP API, not npx ruvector`
        );
        assert.ok(
          !content.includes('npx ruvector brain search'),
          `${file}: Should NOT reference nonexistent 'npx ruvector brain search' command`
        );
      }
    }
  });

  it('should NOT have auto-share checkpoints in any workflow', async () => {
    const files = await fs.readdir(shortcutsDir);
    for (const file of files.filter(f => f.startsWith('w-') && f.endsWith('.md'))) {
      const content = await fs.readFile(path.join(shortcutsDir, file), 'utf-8');
      assert.ok(
        !content.includes('PI BRAIN AUTO-SHARE'),
        `${file}: Should NOT have PI BRAIN AUTO-SHARE checkpoint`
      );
      assert.ok(
        !content.includes('npx ruvector brain share'),
        `${file}: Should NOT have ruvector brain share command`
      );
    }
  });

  it('should NOT have auto-vote checkpoints in any workflow', async () => {
    const files = await fs.readdir(shortcutsDir);
    for (const file of files.filter(f => f.startsWith('w-') && f.endsWith('.md'))) {
      const content = await fs.readFile(path.join(shortcutsDir, file), 'utf-8');
      assert.ok(
        !content.includes('Pi Brain — Auto-Vote'),
        `${file}: Should NOT have Pi Brain Auto-Vote checkpoint`
      );
      assert.ok(
        !content.includes('npx ruvector brain vote'),
        `${file}: Should NOT have ruvector brain vote command`
      );
    }
  });

  it('should still have Pi Brain search checkpoint (read-only)', async () => {
    // At least some workflows should have the search checkpoint
    const content = await fs.readFile(
      path.join(shortcutsDir, 'w-tdd-swarm.md'), 'utf-8'
    );
    assert.ok(
      content.includes('Pi Brain') && content.includes('search'),
      'w-tdd-swarm should still have Pi Brain search checkpoint'
    );
  });
});
