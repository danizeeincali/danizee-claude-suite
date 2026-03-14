/**
 * Tests for Installer v3 — CLI flags, conditional plugins, backward compat
 * All tests should FAIL before implementation (TDD red phase)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { DaniZeeSuiteInstaller } from '../src/installer.js';

describe('Installer v3 — Coding Mode (default)', () => {
  let testDir;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-test-coding-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should install without PM module by default', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true });
    const result = await installer.install();
    assert.ok(result.success);
  });

  it('should have coding workflow shortcuts', async () => {
    const shortcutsDir = path.join(testDir, '.claude', 'commands', '.shortcuts');
    const files = await fs.readdir(shortcutsDir);
    assert.ok(files.includes('w-tdd-swarm.md'));
    assert.ok(files.includes('w-swarm.md'));
    assert.ok(files.includes('w-fix.md'));
    // Renamed command
    assert.ok(files.includes('w-plan-tdd-swarm.md'), 'w-idea-tdd-swarm should be renamed to w-plan-tdd-swarm');
    assert.ok(!files.includes('w-idea-tdd-swarm.md'), 'w-idea-tdd-swarm should no longer exist');
    assert.ok(!files.some(f => f.includes('interview')), 'old interview name should no longer exist');
    // New command
    assert.ok(files.includes('w-background-compound.md'));
  });

  it('should NOT have PM shortcuts in coding-only mode', async () => {
    const shortcutsDir = path.join(testDir, '.claude', 'commands', '.shortcuts');
    const files = await fs.readdir(shortcutsDir);
    assert.ok(!files.includes('w-action.md'), 'PM command w-action should not exist in coding mode');
    assert.ok(!files.includes('w-cos.md'), 'PM command w-cos should not exist in coding mode');
    assert.ok(!files.includes('w-followup.md'), 'PM command w-followup should not exist in coding mode');
  });

  it('should NOT have database in coding-only mode', async () => {
    const dbPath = path.join(testDir, 'data', 'chief-of-staff.db');
    try {
      await fs.access(dbPath);
      assert.fail('Database should not exist in coding-only mode');
    } catch (err) {
      assert.equal(err.code, 'ENOENT');
    }
  });

  it('should have agent-cookbook configured by default', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir });
    const status = await installer.check();
    assert.ok(status.plugins.agentCookbook, 'Agent cookbook should be installed by default');
  });
});

describe('Installer v3 — PM Mode (--with-pm)', () => {
  let testDir;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-test-pm-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should install with PM module when withPm is true', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true, withPm: true });
    const result = await installer.install();
    assert.ok(result.success);
  });

  it('should have PM workflow shortcuts', async () => {
    const shortcutsDir = path.join(testDir, '.claude', 'commands', '.shortcuts');
    const files = await fs.readdir(shortcutsDir);
    assert.ok(files.includes('w-action.md'));
    assert.ok(files.includes('w-cos.md'));
    assert.ok(files.includes('w-followup.md'));
    assert.ok(files.includes('w-hitlist.md'));
    assert.ok(files.includes('w-fact.md'));
    assert.ok(files.includes('w-insight.md'));
    assert.ok(files.includes('w-goal.md'));
  });

  it('should also have coding shortcuts', async () => {
    const shortcutsDir = path.join(testDir, '.claude', 'commands', '.shortcuts');
    const files = await fs.readdir(shortcutsDir);
    assert.ok(files.includes('w-tdd-swarm.md'));
    assert.ok(files.includes('w-fix.md'));
  });

  it('should have database created', async () => {
    const dbPath = path.join(testDir, 'data', 'chief-of-staff.db');
    await fs.access(dbPath); // Should not throw
  });

  it('should have enhanced w-start (PM version)', async () => {
    const wStart = await fs.readFile(
      path.join(testDir, '.claude', 'commands', '.shortcuts', 'w-start.md'),
      'utf-8'
    );
    assert.ok(wStart.includes('session'), 'PM w-start should reference sessions');
    assert.ok(wStart.includes('strategic') || wStart.includes('goal'),
      'PM w-start should reference strategic context');
  });

  it('should have enhanced w-end (PM version)', async () => {
    const wEnd = await fs.readFile(
      path.join(testDir, '.claude', 'commands', '.shortcuts', 'w-end.md'),
      'utf-8'
    );
    assert.ok(wEnd.includes('deferred'), 'PM w-end should reference deferred items');
    assert.ok(wEnd.includes('strategic') || wEnd.includes('goal'),
      'PM w-end should reference strategic context');
  });

  it('check should report PM module installed', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir });
    const status = await installer.check();
    assert.ok(status.plugins.pmShortcuts, 'PM shortcuts should show as installed');
  });
});

describe('Installer v3 — Without Cookbook', () => {
  let testDir;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-test-nocookbook-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should skip cookbook when withoutCookbook is true', async () => {
    const installer = new DaniZeeSuiteInstaller({
      path: testDir, force: true, withoutCookbook: true
    });
    const result = await installer.install();
    assert.ok(result.success);

    const status = await installer.check();
    assert.equal(status.plugins.agentCookbook, false);
  });
});

describe('Installer v3 — Backward Compatibility', () => {
  let testDir;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-test-compat-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should still install all original 19 workflows (minus renamed)', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true });
    await installer.install();

    const shortcutsDir = path.join(testDir, '.claude', 'commands', '.shortcuts');
    const files = await fs.readdir(shortcutsDir);

    // All original commands except w-idea-tdd-swarm (renamed)
    const originalCommands = [
      'w-swarm.md', 'w-tdd-swarm.md', 'w-fix.md', 'w-debug.md',
      'w-hotfix.md', 'w-review.md', 'w-security.md', 'w-perf.md',
      'w-architect.md', 'w-compound.md', 'w-search.md', 'w-start.md',
      'w-end.md', 'w-multi-repo.md', 'w-ralph-this.md', 'w-ralph-goals.md',
      'w-ralph-pick.md', 'w-ralph-batch.md',
      // Renamed
      'w-plan-tdd-swarm.md',
      // New
      'w-background-compound.md'
    ];

    for (const cmd of originalCommands) {
      assert.ok(files.includes(cmd), `Missing original command: ${cmd}`);
    }
  });
});
