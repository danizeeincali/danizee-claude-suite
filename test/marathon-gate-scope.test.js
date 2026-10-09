/**
 * Finish-line lines may declare a scope: `run` lines are judged only by the run-wide gate and are
 * reported as `run_scoped` (never counted) when a stream is given; `stream` lines (and lines with
 * no scope, for compatibility) are counted per stream as before. RC-D010 from marathon 2026-10-07-bbs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate, validateFinishLine, SCOPES } from '../src/lib/marathon/gate.js';

const line = (o) => ({ type: 'number', op: 'at_least', owner: 'build', label: o.id, ...o });
const greenRuns = (n, kind, stream) => Array.from({ length: n }, (_, i) => ({ id: `${kind}${i}`, kind, status: 'green', stream }));
const review = (id, pass, stream) => ({ id, pass, counts: { high: 0, medium: 0, low: 0 }, stream });

const finishLine = {
  tolerance: { high: 0, medium: 2, low: 5, passes_in_a_row: 2 },
  lines: [
    line({ id: 'e2e_streak', value: 6, source: 'runs.streak:e2e', scope: 'run' }),
    line({ id: 'clean_reviews', value: 2, source: 'reviews.streak', scope: 'stream' }),
    line({ id: 'latest_high', op: 'at_most', value: 0, source: 'reviews.latest.high' }),
    line({ id: 'packaged', type: 'bool', op: 'is', value: true, source: 'measure:packaged', scope: 'run' }),
    line({ id: 'pushed', type: 'bool', op: 'is', value: true, owner: 'human', source: 'checklist:pushed', scope: 'run' })
  ]
};

describe('gate — scope on finish-line lines', () => {
  it('SCOPES are run and stream; validateFinishLine accepts them, defaults to none, and refuses anything else', () => {
    assert.deepEqual(SCOPES, ['run', 'stream']);
    assert.deepEqual(validateFinishLine(finishLine), []);
    const bad = { ...finishLine, lines: [line({ id: 'x', value: 1, source: 'runs.streak:unit', scope: 'global' })] };
    const errors = validateFinishLine(bad);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /scope must be one of run, stream \(got "global"\)/);
  });

  it('with a stream, run-scoped lines are reported as run_scoped and never counted; stream lines decide the stream gate', () => {
    const ctx = {
      finishLine, stream: 'intake',
      runs: greenRuns(1, 'e2e', 'command-docs'),
      reviews: [review('a', true, 'intake'), review('b', true, 'intake')],
      findings: [], helpers: [], measurements: [], checklist: {}
    };
    const g = evaluateGate(ctx);
    const by = Object.fromEntries(g.lines.map(l => [l.id, l]));
    assert.equal(by.e2e_streak.status, 'run_scoped');
    assert.equal(by.e2e_streak.scope, 'run');
    assert.equal(by.packaged.status, 'run_scoped');
    assert.equal(by.pushed.status, 'run_scoped');
    assert.equal(by.clean_reviews.status, 'met');
    assert.equal(by.clean_reviews.scope, 'stream');
    assert.equal(by.latest_high.status, 'met');
    assert.equal(by.latest_high.scope, null, 'no scope declared stays null');
    assert.deepEqual(g.failing, []);
    assert.deepEqual(g.waitingOnHuman, []);
    assert.equal(g.buildGateMet, true, 'the stream gate ignores run-scoped lines');
    assert.equal(g.gateMet, true);
    assert.deepEqual(g.runScoped, ['e2e_streak', 'packaged', 'pushed']);
  });

  it('without a stream, run-scoped lines count exactly as before', () => {
    const g = evaluateGate({
      finishLine,
      runs: greenRuns(1, 'e2e', 'command-docs'),
      reviews: [review('a', true, 'intake'), review('b', true, 'intake')],
      findings: [], helpers: [], measurements: [], checklist: {}
    });
    const by = Object.fromEntries(g.lines.map(l => [l.id, l]));
    assert.equal(by.e2e_streak.status, 'failing');
    assert.equal(by.packaged.status, 'failing');
    assert.equal(by.pushed.status, 'waiting_on_human');
    assert.equal(g.buildGateMet, false);
    assert.deepEqual(g.runScoped, []);
  });

  it('a stream whose only counted lines are run-scoped has no build gate (an empty gate is not met)', () => {
    const onlyRun = { ...finishLine, lines: finishLine.lines.filter(l => l.scope === 'run') };
    const g = evaluateGate({ finishLine: onlyRun, stream: 'intake', runs: [], reviews: [], findings: [], helpers: [], measurements: [], checklist: {} });
    assert.equal(g.buildGateMet, false);
    assert.equal(g.gateMet, false);
    assert.deepEqual(g.failing, []);
  });

  it('a stream-scoped line that fails still fails the stream gate', () => {
    const g = evaluateGate({ finishLine, stream: 'intake', runs: [], reviews: [review('a', false, 'intake')], findings: [], helpers: [], measurements: [], checklist: {} });
    assert.deepEqual(g.failing, ['clean_reviews']);
    assert.equal(g.buildGateMet, false);
  });
});
