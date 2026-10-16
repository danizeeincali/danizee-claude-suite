import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installPackaged } from './helpers/packaged.js';

const run = (extra = {}) => ({ steps: ['open', 'submit'], checks: { status: 500 }, outputs: { body: 'error' }, ...extra });

describe('replay-gate — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('blocks only on an agreed program failure; flaky and model verdicts do not', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('replay-gate'));
    const verdicts = [
      { id: 'agreed', decided_by: 'replay', outcome: 'fail', runs: [run(), run()] },
      { id: 'flaky', decided_by: 'exact-check', outcome: 'fail', runs: [run(), run({ checks: { status: 200 } })] },
      { id: 'once', decided_by: 'output-diff', outcome: 'fail', runs: [run()] },
      { id: 'opinion', decided_by: 'model', outcome: 'fail', runs: [run(), run()] },
      { id: 'fine', decided_by: 'replay', outcome: 'pass' }
    ];
    const r = pkg.kit(['replay-gate'], '﻿' + JSON.stringify({ verdicts }));
    assert.equal(r.code, 2);
    assert.deepEqual(r.json.results.map(x => x.class), ['blocking', 'untested', 'untested', 'comment', 'pass']);
    assert.deepEqual(r.json.results[1].differed, ['checks.status']);
    assert.equal(r.json.counts.blocking, 1);

    const ok = pkg.kit(['replay-gate'], JSON.stringify({ verdicts: verdicts.slice(1) }));
    assert.equal(ok.code, 0);

    const invalid = pkg.kit(['replay-gate'], JSON.stringify({ verdicts: [{ id: 'x', decided_by: 'replay', outcome: 'fail', bogus: 1 }] }));
    assert.equal(invalid.code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
