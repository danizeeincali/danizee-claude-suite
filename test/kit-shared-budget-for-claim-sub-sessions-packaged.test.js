import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('shared-budget — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('one review allowance shared by sub-sessions, skip is not a failure', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('shared-budget'));
    const k = (...a) => pkg.kit(['shared-budget', '--state', 'review-budget.json', ...a]);

    assert.equal(k('open', '--steps', '5', '--cost', '2.5', '--time-ms', '1000', '--now', '0').code, 0);
    assert.equal(k('open', '--steps', '5').code, 1, 'will not overwrite an open budget');
    assert.equal(k('start', '--now', '10').json.depth, 1);
    assert.equal(k('start', '--now', '20').json.depth, 2);

    const g1 = k('grant', '--helper', 'claim-1', '--now', '30');
    assert.equal(g1.code, 0);
    assert.deepEqual(g1.json.remaining, { steps: 5, cost: 2.5, timeMs: 980 });
    const s1 = k('spend', '--helper', 'claim-1', '--steps', '4', '--cost', '1', '--outcome', 'failed', '--now', '40');
    assert.equal(s1.code, 0);
    assert.equal(s1.json.overrun, null);

    const g2 = k('grant', '--helper', 'claim-2', '--now', '50');
    assert.deepEqual(g2.json.remaining, { steps: 1, cost: 1.5, timeMs: 960 });
    const s2 = k('spend', '--helper', 'claim-2', '--steps', '3', '--cost', '0', '--outcome', 'ok', '--now', '60');
    assert.equal(s2.code, 0);
    assert.deepEqual(s2.json.overrun, { steps: 2 });

    const skip = k('grant', '--helper', 'claim-3', '--now', '70');
    assert.equal(skip.code, 0);
    assert.equal(skip.json.skip, true);
    assert.match(skip.json.reason, /steps/);
    assert.equal(k('grant', '--helper', 'replay', '--kind', 'check', '--now', '70').json.skip, false);

    k('stop', '--now', '80');
    assert.equal(k('stop', '--now', '100').json.elapsedMs, 90);
    assert.equal(k('stop', '--now', '110').code, 1);
    const st = k('status', '--now', '99999');
    assert.equal(st.json.elapsedMs, 90);
    assert.deepEqual(st.json.helpers.map(h => h.helper).sort(), ['claim-1', 'claim-2', 'claim-3', 'replay']);

    const file = path.join(pkg.dir, 'review-budget.json');
    await fs.writeFile(file, '{"version":2}');
    assert.equal(k('status').code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
