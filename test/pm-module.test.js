/**
 * Tests for PM Module — Database, Libraries, and Plugin
 * All tests should FAIL before implementation (TDD red phase)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ============================================================
// Database Schema Tests
// ============================================================

describe('Database Schema (src/lib/db.js)', () => {
  let initDatabase, getDb;
  let testDbPath;

  before(async () => {
    testDbPath = path.join(os.tmpdir(), `test-cos-${Date.now()}.db`);
    const db = await import('../src/lib/db.js');
    initDatabase = db.initDatabase;
    getDb = db.getDb;
  });

  after(async () => {
    try { await fs.unlink(testDbPath); } catch {}
  });

  it('should export initDatabase and getDb', () => {
    assert.equal(typeof initDatabase, 'function');
    assert.equal(typeof getDb, 'function');
  });

  it('should create database with all required tables', () => {
    const db = initDatabase(testDbPath);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name);

    const requiredTables = [
      'action_items', 'chronicled_facts', 'chronicled_preferences',
      'contexts', 'deferred_items', 'doc_favorites', 'facts',
      'goals', 'ideas', 'initiatives', 'insights', 'knowledge',
      'meetings', 'notes', 'opportunities', 'priorities',
      'project_sessions', 'projects', 'ramblings', 'rambling_versions',
      'sessions', 'follow_ups', 'share_links', 'uploads'
    ];

    for (const table of requiredTables) {
      assert.ok(tables.includes(table), `Missing table: ${table}`);
    }
  });

  it('should create all required indexes', () => {
    const db = initDatabase(testDbPath);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    ).all().map(r => r.name);

    assert.ok(indexes.length >= 40, `Expected 40+ indexes, got ${indexes.length}`);
    assert.ok(indexes.includes('idx_action_items_priority'));
    assert.ok(indexes.includes('idx_follow_ups_status'));
    assert.ok(indexes.includes('idx_insights_domain'));
    assert.ok(indexes.includes('idx_ramblings_status'));
  });

  it('should be idempotent (safe to call multiple times)', () => {
    const db1 = initDatabase(testDbPath);
    const db2 = initDatabase(testDbPath);
    assert.ok(db2);
  });
});

// ============================================================
// Priority Utils Tests
// ============================================================

describe('Priority Utils (src/lib/priority-utils.js)', () => {
  let getFibonacciLimit, groupByPriority;

  before(async () => {
    const mod = await import('../src/lib/priority-utils.js');
    getFibonacciLimit = mod.getFibonacciLimit;
    groupByPriority = mod.groupByPriority;
  });

  it('should return correct Fibonacci limits', () => {
    assert.equal(getFibonacciLimit(0), 1);
    assert.equal(getFibonacciLimit(1), 1);
    assert.equal(getFibonacciLimit(2), 2);
    assert.equal(getFibonacciLimit(3), 3);
    assert.equal(getFibonacciLimit(4), 5);
    assert.equal(getFibonacciLimit(5), 8);
    assert.equal(getFibonacciLimit(6), 13);
    assert.equal(getFibonacciLimit(7), 21);
  });

  it('should group items by priority', () => {
    const items = [
      { id: '1', priority: 0 },
      { id: '2', priority: 1 },
      { id: '3', priority: 1 },
      { id: '4', priority: 3 },
    ];
    const grouped = groupByPriority(items);
    assert.equal(grouped[0].length, 1);
    assert.equal(grouped[1].length, 2);
    assert.equal(grouped[3].length, 1);
  });
});

// ============================================================
// Action Items Tests
// ============================================================

describe('Action Items (src/lib/action-items.js)', () => {
  let addActionItem, getActionItemsByPriority, cascadeDown, moveActionItem;
  let initDatabase;
  let testDbPath;

  before(async () => {
    testDbPath = path.join(os.tmpdir(), `test-actions-${Date.now()}.db`);
    const db = await import('../src/lib/db.js');
    initDatabase = db.initDatabase;
    initDatabase(testDbPath);

    const mod = await import('../src/lib/action-items.js');
    addActionItem = mod.addActionItem;
    getActionItemsByPriority = mod.getActionItemsByPriority;
    cascadeDown = mod.cascadeDown;
    moveActionItem = mod.moveActionItem;
  });

  after(async () => {
    try { await fs.unlink(testDbPath); } catch {}
  });

  it('should add an action item', () => {
    const result = addActionItem('Test task', 3, { notes: 'test notes' });
    assert.ok(result.item);
    assert.equal(result.item.title, 'Test task');
    assert.equal(result.item.priority, 3);
    assert.ok(result.cascade);
  });

  it('should cascade when Fibonacci limit exceeded', () => {
    // P0 limit is 1. Add 2 items at P0 — second should cascade the first to P1
    addActionItem('P0 first', 0);
    const result = addActionItem('P0 second', 0);
    assert.ok(result.cascade.moved.length > 0, 'Expected cascade');
    assert.equal(result.cascade.moved[0].from, 0);
    assert.equal(result.cascade.moved[0].to, 1);
  });

  it('should get items by priority', () => {
    const items = getActionItemsByPriority(3);
    assert.ok(Array.isArray(items));
    assert.ok(items.length > 0);
  });
});

// ============================================================
// Follow-Up Detector Tests
// ============================================================

describe('Follow-Up Detector (src/lib/follow-up-detector.js)', () => {
  let detectFollowUp;

  before(async () => {
    const mod = await import('../src/lib/follow-up-detector.js');
    detectFollowUp = mod.detectFollowUp;
  });

  it('should detect explicit follow-up phrases', () => {
    const result = detectFollowUp('Follow up with John about the API');
    assert.equal(result.isFollowUp, true);
    assert.ok(result.confidence >= 0.5);
    assert.equal(result.person, 'John');
  });

  it('should detect waiting indicators', () => {
    const result = detectFollowUp('Waiting for Sarah to send the report');
    assert.equal(result.isFollowUp, true);
    assert.equal(result.person, 'Sarah');
  });

  it('should NOT flag regular action items', () => {
    const result = detectFollowUp('Implement the login page');
    assert.equal(result.isFollowUp, false);
    assert.ok(result.confidence < 0.5);
  });

  it('should extract date patterns', () => {
    const result = detectFollowUp('Check with Bob on Tuesday');
    assert.ok(result.datePattern);
  });
});

// ============================================================
// Category Detector Tests
// ============================================================

describe('Category Detector (src/lib/category-detector.js)', () => {
  let detectCategory;

  before(async () => {
    const mod = await import('../src/lib/category-detector.js');
    detectCategory = mod.detectCategory;
  });

  it('should detect security changes', () => {
    const diff = 'sanitize input to prevent xss injection vulnerability';
    assert.equal(detectCategory(diff), 'security');
  });

  it('should detect bug fixes', () => {
    const diff = 'fix bug in error handling fallback for missing data';
    assert.equal(detectCategory(diff), 'bug');
  });

  it('should detect performance changes', () => {
    const diff = 'add cache layer and memoize expensive computation batch';
    assert.equal(detectCategory(diff), 'performance');
  });

  it('should detect architecture changes', () => {
    const diff = 'refactor migration to restructure the data layer';
    assert.equal(detectCategory(diff), 'architecture');
  });

  it('should default to feature on empty diff', () => {
    assert.equal(detectCategory(''), 'feature');
  });
});

// ============================================================
// Follow-Ups Library Tests
// ============================================================

describe('Follow-Ups (src/lib/follow-ups.js)', () => {
  let createFollowUp, getDueFollowUps, completeFollowUp, snoozeFollowUp;
  let testDbPath;

  before(async () => {
    testDbPath = path.join(os.tmpdir(), `test-followups-${Date.now()}.db`);
    const db = await import('../src/lib/db.js');
    db.initDatabase(testDbPath);

    const mod = await import('../src/lib/follow-ups.js');
    createFollowUp = mod.createFollowUp;
    getDueFollowUps = mod.getDueFollowUps;
    completeFollowUp = mod.completeFollowUp;
    snoozeFollowUp = mod.snoozeFollowUp;
  });

  after(async () => {
    try { await fs.unlink(testDbPath); } catch {}
  });

  it('should create a follow-up', () => {
    const fu = createFollowUp({
      content: 'Check with Alice about design',
      person: 'Alice',
      due_date: new Date().toISOString().split('T')[0]
    });
    assert.ok(fu.id);
    assert.equal(fu.content, 'Check with Alice about design');
    assert.equal(fu.person, 'Alice');
    assert.equal(fu.status, 'active');
  });

  it('should get due follow-ups', () => {
    const due = getDueFollowUps();
    assert.ok(Array.isArray(due));
    assert.ok(due.length > 0);
  });

  it('should complete a follow-up', () => {
    const fu = createFollowUp({ content: 'Test follow-up' });
    const completed = completeFollowUp(fu.id, 'Got the answer');
    assert.equal(completed.status, 'completed');
    assert.equal(completed.outcome, 'Got the answer');
  });
});

// ============================================================
// Deferred Items Tests
// ============================================================

describe('Deferred Items (src/lib/deferred-items.js)', () => {
  let createDeferredItem, getPendingDeferredItems, actionDeferredItem, dismissDeferredItem;
  let testDbPath;

  before(async () => {
    testDbPath = path.join(os.tmpdir(), `test-deferred-${Date.now()}.db`);
    const db = await import('../src/lib/db.js');
    db.initDatabase(testDbPath);

    const mod = await import('../src/lib/deferred-items.js');
    createDeferredItem = mod.createDeferredItem;
    getPendingDeferredItems = mod.getPendingDeferredItems;
    actionDeferredItem = mod.actionDeferredItem;
    dismissDeferredItem = mod.dismissDeferredItem;
  });

  after(async () => {
    try { await fs.unlink(testDbPath); } catch {}
  });

  it('should create a deferred item', () => {
    const item = createDeferredItem({
      type: 'next_step',
      content: 'Implement auth module',
      source_workflow: 'w-end',
      context: { session_summary: 'Built the API' }
    });
    assert.ok(item.id);
    assert.equal(item.status, 'pending');
    assert.equal(item.source_workflow, 'w-end');
  });

  it('should get pending items', () => {
    const pending = getPendingDeferredItems();
    assert.ok(Array.isArray(pending));
    assert.ok(pending.length > 0);
  });

  it('should action and dismiss items', () => {
    const item = createDeferredItem({
      type: 'test',
      content: 'Test item',
      source_workflow: 'w-end'
    });
    const actioned = actionDeferredItem(item.id);
    assert.equal(actioned.status, 'actioned');

    const item2 = createDeferredItem({
      type: 'test',
      content: 'Dismiss me',
      source_workflow: 'w-end'
    });
    const dismissed = dismissDeferredItem(item2.id);
    assert.equal(dismissed.status, 'dismissed');
  });
});

// ============================================================
// Insights Tests
// ============================================================

describe('Insights (src/lib/insights.js)', () => {
  let createInsight, getInsightsToSurface, calculateSurfacingScore;
  let testDbPath;

  before(async () => {
    testDbPath = path.join(os.tmpdir(), `test-insights-${Date.now()}.db`);
    const db = await import('../src/lib/db.js');
    db.initDatabase(testDbPath);

    const mod = await import('../src/lib/insights.js');
    createInsight = mod.createInsight;
    getInsightsToSurface = mod.getInsightsToSurface;
    calculateSurfacingScore = mod.calculateSurfacingScore;
  });

  after(async () => {
    try { await fs.unlink(testDbPath); } catch {}
  });

  it('should create an insight', () => {
    const insight = createInsight({
      content: 'Users prefer dark mode',
      impact: 'engagement',
      domain: 'ux'
    });
    assert.ok(insight.id);
    assert.equal(insight.impact, 'engagement');
    assert.equal(insight.status, 'active');
  });

  it('should calculate surfacing score', () => {
    const insight = createInsight({
      content: 'Revenue insight',
      impact: 'revenue'
    });
    const score = calculateSurfacingScore(insight);
    assert.equal(typeof score, 'number');
    assert.ok(score >= 0);
  });
});

// ============================================================
// Notes Tests
// ============================================================

describe('Notes (src/lib/notes.js)', () => {
  let parseNoteContent, createNote, searchNotes;
  let testDbPath;

  before(async () => {
    testDbPath = path.join(os.tmpdir(), `test-notes-${Date.now()}.db`);
    const db = await import('../src/lib/db.js');
    db.initDatabase(testDbPath);

    const mod = await import('../src/lib/notes.js');
    parseNoteContent = mod.parseNoteContent;
    createNote = mod.createNote;
    searchNotes = mod.searchNotes;
  });

  after(async () => {
    try { await fs.unlink(testDbPath); } catch {}
  });

  it('should parse people from note content', () => {
    const parsed = parseNoteContent('Met with Alice and talked to Bob about revenue');
    assert.ok(parsed.people.includes('Alice'));
    assert.ok(parsed.people.includes('Bob'));
  });

  it('should parse topics', () => {
    const parsed = parseNoteContent('Discussed analytics and UX improvements');
    assert.ok(parsed.topics.length > 0);
  });

  it('should detect potential actions', () => {
    const parsed = parseNoteContent('We should start building the dashboard');
    assert.ok(parsed.potential_actions.length > 0);
  });

  it('should create and search notes', () => {
    createNote({ content: 'Meeting with team about analytics dashboard' });
    const results = searchNotes('analytics');
    assert.ok(results.length > 0);
  });
});

// ============================================================
// Context Linker Tests
// ============================================================

describe('Context Linker (src/lib/context-linker.js)', () => {
  let findRelevantContext, buildActionItemNotes, parseActionItemNotes;

  before(async () => {
    const mod = await import('../src/lib/context-linker.js');
    findRelevantContext = mod.findRelevantContext;
    buildActionItemNotes = mod.buildActionItemNotes;
    parseActionItemNotes = mod.parseActionItemNotes;
  });

  it('should build and parse action item notes JSON', () => {
    const notes = buildActionItemNotes({
      text: 'Some notes',
      linked_facts: ['fact-1'],
      linked_insights: ['insight-1'],
      linked_ideas: []
    });
    assert.equal(typeof notes, 'string');

    const parsed = parseActionItemNotes(notes);
    assert.equal(parsed.text, 'Some notes');
    assert.deepEqual(parsed.linked_facts, ['fact-1']);
    assert.deepEqual(parsed.linked_insights, ['insight-1']);
  });

  it('should handle null notes', () => {
    const parsed = parseActionItemNotes(null);
    assert.equal(parsed.text, null);
    assert.deepEqual(parsed.linked_facts, []);
  });
});

// ============================================================
// Git Utils Tests
// ============================================================

describe('Git Utils (src/lib/git-utils.js)', () => {
  let validateBranchName, getCurrentBranch;

  before(async () => {
    const mod = await import('../src/lib/git-utils.js');
    validateBranchName = mod.validateBranchName;
    getCurrentBranch = mod.getCurrentBranch;
  });

  it('should validate branch names', () => {
    assert.equal(validateBranchName('feature/my-branch'), true);
    assert.equal(validateBranchName('main'), true);
    assert.equal(validateBranchName('feat_1.0'), true);
    assert.equal(validateBranchName('bad..branch'), false);
    assert.equal(validateBranchName('has spaces'), false);
    assert.equal(validateBranchName(''), false);
  });

  it('should get current branch', () => {
    const branch = getCurrentBranch();
    assert.equal(typeof branch, 'string');
    assert.ok(branch.length > 0);
  });
});

// ============================================================
// Plugin Interface Tests
// ============================================================

describe('Agent Cookbook Plugin (src/plugins/agent-cookbook.js)', () => {
  let install, isInstalled, uninstall;

  before(async () => {
    const mod = await import('../src/plugins/agent-cookbook.js');
    install = mod.install;
    isInstalled = mod.isInstalled;
    uninstall = mod.uninstall;
  });

  it('should export install, isInstalled, uninstall', () => {
    assert.equal(typeof install, 'function');
    assert.equal(typeof isInstalled, 'function');
    assert.equal(typeof uninstall, 'function');
  });
});

describe('PM Shortcuts Plugin (src/plugins/pm-shortcuts.js)', () => {
  let install, isInstalled, uninstall, getCommands;

  before(async () => {
    const mod = await import('../src/plugins/pm-shortcuts.js');
    install = mod.install;
    isInstalled = mod.isInstalled;
    uninstall = mod.uninstall;
    getCommands = mod.getCommands;
  });

  it('should export plugin interface', () => {
    assert.equal(typeof install, 'function');
    assert.equal(typeof isInstalled, 'function');
    assert.equal(typeof uninstall, 'function');
    assert.equal(typeof getCommands, 'function');
  });

  it('should define all 34 PM workflow commands', () => {
    const commands = getCommands();
    const commandNames = Object.keys(commands);

    const requiredCommands = [
      'w-action', 'w-action-done', 'w-action-list', 'w-action-rebalance', 'w-hitlist',
      'w-followup', 'w-followup-done',
      'w-fact', 'w-fact-enrich', 'w-fact-search',
      'w-insight',
      'w-idea', 'w-idea-refine', 'w-idea-share',
      'w-ramble', 'w-ramble-refine', 'w-ramble-search',
      'w-knowledge', 'w-knowledge-search',
      'w-goal', 'w-initiative', 'w-project',
      'w-cos',
      'w-notes',
      'w-research',
      'w-context-switch', 'w-meeting-prep',
      'w-doc-review',
      'w-ui-references', 'w-ui-references-review',
      'w-systems-design',
      'w-share', 'w-share-list', 'w-share-revoke',
    ];

    for (const cmd of requiredCommands) {
      assert.ok(commandNames.includes(cmd), `Missing PM command: ${cmd}`);
    }
  });

  it('each command should have name, description, and content', () => {
    const commands = getCommands();
    for (const [name, cmd] of Object.entries(commands)) {
      assert.ok(cmd.name, `${name} missing name`);
      assert.ok(cmd.description, `${name} missing description`);
      assert.ok(cmd.content, `${name} missing content`);
      assert.ok(cmd.content.includes('CHECKPOINT'), `${name} missing checkpoints`);
    }
  });
});
