/**
 * Tests for autoresearch workflow integration
 * - /w-autoresearch shortcut with both modes
 * - RC-A discovery in all compound phases
 * - Autoresearch skill/command/hook installation
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { DaniZeeSuiteInstaller } from '../src/installer.js';

describe('Autoresearch workflow shortcut', () => {
  let testDir;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-ar-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true });
    await installer.install();
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should install w-autoresearch shortcut', async () => {
    const shortcutsDir = path.join(testDir, '.claude', 'commands', '.shortcuts');
    const files = await fs.readdir(shortcutsDir);
    assert.ok(files.includes('w-autoresearch.md'), 'w-autoresearch.md should exist');
  });

  it('should include free-form mode in w-autoresearch', async () => {
    const content = await fs.readFile(
      path.join(testDir, '.claude', 'commands', '.shortcuts', 'w-autoresearch.md'),
      'utf-8'
    );
    assert.ok(content.includes('/w-autoresearch optimize'), 'Should have free-form usage example');
  });

  it('should include RC-A target mode in w-autoresearch', async () => {
    const content = await fs.readFile(
      path.join(testDir, '.claude', 'commands', '.shortcuts', 'w-autoresearch.md'),
      'utf-8'
    );
    assert.ok(content.includes('RC-A'), 'Should reference RC-A candidates');
  });

  it('should dispatch as background agent', async () => {
    const content = await fs.readFile(
      path.join(testDir, '.claude', 'commands', '.shortcuts', 'w-autoresearch.md'),
      'utf-8'
    );
    assert.ok(
      content.includes('background') || content.includes('Background'),
      'Should mention background execution'
    );
  });
});

describe('RC-A discovery in compound phases', () => {
  let testDir;
  let shortcutsDir;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-rca-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true });
    await installer.install();
    shortcutsDir = path.join(testDir, '.claude', 'commands', '.shortcuts');
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should have AUTORESEARCH CANDIDATE CHECK in all compound phases', async () => {
    const files = await fs.readdir(shortcutsDir);
    const workflowFiles = files.filter(f => f.startsWith('w-') && f.endsWith('.md') && f !== 'w-autoresearch.md');

    let compoundCount = 0;
    let rcaCount = 0;

    for (const file of workflowFiles) {
      const content = await fs.readFile(path.join(shortcutsDir, file), 'utf-8');
      if (content.includes('RALPH CANDIDATE CHECK')) {
        compoundCount++;
        if (content.includes('AUTORESEARCH CANDIDATE CHECK')) {
          rcaCount++;
        }
      }
    }

    assert.ok(compoundCount >= 10, `Expected at least 10 workflows with compound phases, found ${compoundCount}`);
    assert.equal(rcaCount, compoundCount,
      `All ${compoundCount} compound phases should have RC-A check, but only ${rcaCount} do`);
  });

  it('should include impact scoring formula', async () => {
    // Check one workflow as representative
    const content = await fs.readFile(
      path.join(shortcutsDir, 'w-tdd-swarm.md'),
      'utf-8'
    );
    assert.ok(content.includes('potential'), 'Should include potential dimension');
    assert.ok(content.includes('blast_radius'), 'Should include blast_radius dimension');
    assert.ok(content.includes('impact'), 'Should include impact scoring');
  });
});

describe('Autoresearch skill installation', () => {
  let testDir;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-arskill-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true });
    await installer.install();
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should install autoresearch skill', async () => {
    const skillPath = path.join(testDir, '.claude', 'skills', 'autoresearch', 'SKILL.md');
    await fs.access(skillPath);
    const content = await fs.readFile(skillPath, 'utf-8');
    assert.ok(content.includes('autoresearch'), 'Skill should reference autoresearch');
  });

  it('should install autoresearch command', async () => {
    const cmdPath = path.join(testDir, '.claude', 'commands', 'autoresearch.md');
    await fs.access(cmdPath);
    const content = await fs.readFile(cmdPath, 'utf-8');
    assert.ok(content.includes('autoresearch'), 'Command should reference autoresearch');
  });

  it('should install autoresearch hook', async () => {
    const hookPath = path.join(testDir, '.claude', 'hooks', 'autoresearch-context.sh');
    await fs.access(hookPath);
    const stat = await fs.stat(hookPath);
    // Check executable bit (owner execute = 0o100)
    assert.ok(stat.mode & 0o100, 'Hook should be executable');
  });
});
