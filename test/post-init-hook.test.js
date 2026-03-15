/**
 * Tests for post-init hook support
 * Suite should run .claude/hooks/post-init.sh after writing shortcuts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { DaniZeeSuiteInstaller } from '../src/installer.js';

describe('Post-init hook — hook exists and is executable', () => {
  let testDir;
  let hookPath;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-hook-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create a hook that writes a marker file
    hookPath = path.join(testDir, '.claude', 'hooks', 'post-init.sh');
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, '#!/bin/bash\necho "hook-ran" > "$PWD/.hook-marker"\n', { mode: 0o755 });
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should run hook after install', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true });
    await installer.install();
    const marker = path.join(testDir, '.hook-marker');
    const content = await fs.readFile(marker, 'utf-8');
    assert.equal(content.trim(), 'hook-ran');
  });

  it('should still return success', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true });
    const result = await installer.install();
    assert.ok(result.success);
  });
});

describe('Post-init hook — no hook exists', () => {
  let testDir;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-nohook-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should install normally without hook', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true });
    const result = await installer.install();
    assert.ok(result.success);
  });

  it('should not create hook marker', async () => {
    const marker = path.join(testDir, '.hook-marker');
    try {
      await fs.access(marker);
      assert.fail('Hook marker should not exist when no hook is present');
    } catch (err) {
      assert.equal(err.code, 'ENOENT');
    }
  });
});

describe('Post-init hook — hook fails', () => {
  let testDir;

  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-failhook-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create a hook that fails
    const hookPath = path.join(testDir, '.claude', 'hooks', 'post-init.sh');
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, '#!/bin/bash\nexit 1\n', { mode: 0o755 });
  });

  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
  });

  it('should still return success when hook fails', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true });
    const result = await installer.install();
    assert.ok(result.success, 'Install should succeed even if hook fails');
  });
});
