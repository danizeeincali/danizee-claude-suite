/**
 * Tests for src/lib/marathon/keeplist.js
 * AC 22. Property: no done stream ever appears; output is one line.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildKeepList } from '../src/lib/marathon/keeplist.js';

const input = {
  runId: '2026-10-07-bbs',
  kickoffPath: '.claude/marathon/2026-10-07-bbs/kickoff.md',
  rulesPath: '.claude/marathon/2026-10-07-bbs/rules.md',
  streams: [
    { name: 'alpha-intake', state: 'active', next: 'write failing tests' },
    { name: 'beta-fetch', state: 'done', next: '' },
    { name: 'gamma-map', state: 'queued', next: 'start' }
  ],
  findings: [{ id: 'f1', status: 'open' }, { id: 'f2', status: 'fixed' }, { id: 'f3', status: 'open' }],
  lastCommit: 'abc1234',
  runningTasks: ['task-9']
};

describe('keeplist — buildKeepList', () => {
  it('AC22: one line starting with /compact naming kickoff, rules, open streams, open findings, commit, tasks', () => {
    const out = buildKeepList(input);
    assert.ok(out.startsWith('/compact '), out);
    assert.ok(!out.includes('\n'));
    assert.match(out, /kickoff\.md/);
    assert.match(out, /rules\.md/);
    assert.match(out, /alpha-intake/);
    assert.match(out, /gamma-map/);
    assert.match(out, /write failing tests/);
    assert.match(out, /f1/);
    assert.match(out, /f3/);
    assert.match(out, /abc1234/);
    assert.match(out, /task-9/);
    assert.ok(!out.includes('beta-fetch'), 'finished stream excluded');
    assert.ok(!/\bf2\b/.test(out), 'fixed finding excluded');
    assert.match(out, /drop/i);
  });

  it('works with empty collections', () => {
    const out = buildKeepList({ ...input, streams: [], findings: [], runningTasks: [], lastCommit: null });
    assert.ok(out.startsWith('/compact '));
    assert.ok(!out.includes('\n'));
  });

  it('property: no done stream name ever appears; single line', () => {
    const name = fc.stringMatching(/^[0-9a-f]{8}$/).map(h => `zz${h}`);
    fc.assert(fc.property(
      fc.uniqueArray(name, { maxLength: 8 }).chain(names => fc.tuple(
        fc.constant(names),
        fc.array(fc.constantFrom('active', 'queued', 'blocked', 'done'), { minLength: names.length, maxLength: names.length })
      )),
      ([names, states]) => {
        const streams = names.map((n, i) => ({ name: n, state: states[i], next: 'n' }));
        const out = buildKeepList({ ...input, streams });
        assert.ok(!out.includes('\n'));
        for (const s of streams) {
          if (s.state === 'done') assert.ok(!out.includes(s.name), `done stream ${s.name} leaked`);
          else assert.ok(out.includes(s.name), `open stream ${s.name} missing`);
        }
      }
    ), { numRuns: 200 });
  });
});
