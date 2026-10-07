/**
 * Tests for src/lib/marathon/resume.js — AC 23.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resumeLine } from '../src/lib/marathon/resume.js';

const base = { runId: '2026-10-07-bbs', runDirRel: '.claude/marathon/2026-10-07-bbs' };

describe('resume — resumeLine', () => {
  it('names the run files and the active stream, phase and skill to reload', () => {
    const out = resumeLine({
      ...base,
      activeStream: { name: 'intake', state: 'active', phase: 'Build', skill: 'pt', next: 'make tests pass' }
    });
    assert.match(out, /kickoff\.md/);
    assert.match(out, /status\.md/);
    assert.match(out, /rules\.md/);
    assert.match(out, /intake/);
    assert.match(out, /Build/);
    assert.match(out, /\/pt/);
    assert.match(out, /reload/i);
    assert.match(out, /make tests pass/);
  });

  it('plain omits the status row and is a single line', () => {
    const out = resumeLine({ ...base, activeStream: { name: 'intake', phase: 'Build', skill: 'pt', next: 'x' }, plain: true });
    assert.ok(!out.includes('\n'));
    assert.ok(!out.includes('|'));
    assert.match(out, /intake/);
  });

  it('says so when no stream is active', () => {
    const out = resumeLine({ ...base, activeStream: null });
    assert.match(out, /no active stream/i);
    assert.match(out, /--status/);
  });
});
