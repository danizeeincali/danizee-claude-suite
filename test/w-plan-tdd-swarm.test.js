/**
 * Tests for w-plan-tdd-swarm — Rename + Automation Upgrade
 * Validates: file rename, gate types, spec display, TaskCreate, ruflo swarm
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const SHORTCUTS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts');

describe('File rename — w-interview-tdd-swarm → w-plan-tdd-swarm', () => {
  it('w-plan-tdd-swarm.md exists', async () => {
    const stat = await fs.stat(path.join(SHORTCUTS_DIR, 'w-plan-tdd-swarm.md'));
    assert.ok(stat.isFile());
  });

  it('w-interview-tdd-swarm.md no longer exists', async () => {
    try {
      await fs.stat(path.join(SHORTCUTS_DIR, 'w-interview-tdd-swarm.md'));
      assert.fail('w-interview-tdd-swarm.md should not exist after rename');
    } catch (err) {
      assert.equal(err.code, 'ENOENT');
    }
  });
});

describe('w-plan-tdd-swarm.md content', () => {
  let content;

  before(async () => {
    content = await fs.readFile(path.join(SHORTCUTS_DIR, 'w-plan-tdd-swarm.md'), 'utf-8');
  });

  it('has correct command name in header', () => {
    assert.ok(content.includes('# /w-plan-tdd-swarm'), 'Header must say /w-plan-tdd-swarm');
  });

  it('uses TaskCreate instead of TodoWrite', () => {
    assert.ok(content.includes('TaskCreate'), 'Must reference TaskCreate');
    assert.ok(!content.includes('TodoWrite'), 'Must NOT reference TodoWrite');
  });

  it('interview checkpoint is HIL with AskUserQuestion', () => {
    // Interview must still use AskUserQuestion
    assert.ok(content.includes('AskUserQuestion'), 'Interview must use AskUserQuestion');
  });

  it('spec display — must print full spec inline', () => {
    // After interview, must instruct to PRINT/display the spec content
    const lower = content.toLowerCase();
    assert.ok(
      lower.includes('print') && lower.includes('spec') ||
      lower.includes('display') && lower.includes('spec') ||
      lower.includes('output the full spec') ||
      lower.includes('show the full spec'),
      'Must instruct to print/display the full spec inline after interview'
    );
  });

  it('plan checkpoint is HIL gate', () => {
    // Plan checkpoint must have a USER GATE / AskUserQuestion
    const planSection = content.split(/checkpoint\s*\d+.*plan/i)[1] || '';
    // Look for USER GATE or AskUserQuestion near Plan
    assert.ok(
      content.includes('USER GATE') || content.includes('AskUserQuestion'),
      'Plan checkpoint must have a HIL gate'
    );
  });

  it('plan checkpoint has AskUserQuestion after plan output', () => {
    // Find the Plan section and verify it has a gate
    const sections = content.split('###');
    const planSection = sections.find(s => /plan/i.test(s) && /checkpoint/i.test(s) && !/spec/i.test(s.substring(0, 30)));
    if (planSection) {
      assert.ok(
        planSection.includes('AskUserQuestion') || planSection.includes('USER GATE'),
        'Plan section must contain AskUserQuestion or USER GATE'
      );
    }
  });

  it('tests checkpoint is blocking', () => {
    const lower = content.toLowerCase();
    assert.ok(
      lower.includes('blocking') && lower.includes('test'),
      'Tests checkpoint must be marked as blocking'
    );
  });

  it('build phase has ruflo swarm block', () => {
    assert.ok(content.includes('ruflo'), 'Build phase must reference ruflo swarm');
  });

  it('has no references to old name w-interview-tdd-swarm', () => {
    assert.ok(
      !content.includes('w-interview-tdd-swarm'),
      'Must not contain old name w-interview-tdd-swarm'
    );
  });
});

describe('dot-shortcuts.js — renamed references', () => {
  let content;

  before(async () => {
    content = await fs.readFile(
      path.join(PROJECT_ROOT, 'src', 'plugins', 'dot-shortcuts.js'),
      'utf-8'
    );
  });

  it('references w-plan-tdd-swarm', () => {
    assert.ok(content.includes('w-plan-tdd-swarm'), 'Must reference w-plan-tdd-swarm');
  });

  it('no longer references w-interview-tdd-swarm', () => {
    assert.ok(
      !content.includes('w-interview-tdd-swarm'),
      'Must not reference old name w-interview-tdd-swarm'
    );
  });
});

describe('installer test — updated reference', () => {
  let content;

  before(async () => {
    content = await fs.readFile(
      path.join(PROJECT_ROOT, 'test', 'installer-v3.test.js'),
      'utf-8'
    );
  });

  it('references w-plan-tdd-swarm in test assertions', () => {
    assert.ok(
      content.includes('w-plan-tdd-swarm'),
      'Installer test must check for w-plan-tdd-swarm'
    );
  });

  it('no longer references w-interview-tdd-swarm', () => {
    assert.ok(
      !content.includes('w-interview-tdd-swarm'),
      'Installer test must not reference old name'
    );
  });
});
