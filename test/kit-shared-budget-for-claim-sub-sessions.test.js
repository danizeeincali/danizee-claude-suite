import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as sb from '../src/lib/kit/shared-budget.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';

async function withDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-budget-'));
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
const call = (dir, args) => sb.run(['--state', 'b.json', ...args], { cwd: dir });
const code = async (p) => { try { await p; return 0; } catch (e) { assert.ok(e instanceof KitExit); return e.code; } };

describe('shared-budget library', () => {
  it('exports the verb contract', () => {
    assert.equal(sb.verb, 'shared-budget');
    assert.equal(typeof sb.usage, 'string');
  });

  it('grant returns the remainder of each limit', () => {
    let s = sb.openBudget({ steps: 10, cost: 5, timeMs: 1000 }, 0);
    s = sb.recordSpend(s, { helper: 'a', steps: 3, cost: 1.5, outcome: 'ok' }).state;
    const g = sb.grantFor(s, { helper: 'b' }, 100);
    assert.equal(g.skip, false);
    assert.deepEqual(g.remaining, { steps: 7, cost: 3.5, timeMs: 1000 });
  });

  it('unlimited dimensions are null in a grant', () => {
    const s = sb.openBudget({ steps: 4 }, 0);
    assert.deepEqual(sb.grantFor(s, { helper: 'a' }, 0).remaining, { steps: 4, cost: null, timeMs: null });
  });

  it('skips with a reason when any limit is exhausted', () => {
    let s = sb.openBudget({ steps: 2, cost: 10 }, 0);
    s = sb.recordSpend(s, { helper: 'a', steps: 2, cost: 1, outcome: 'ok' }).state;
    const g = sb.grantFor(s, { helper: 'b' }, 0);
    assert.equal(g.skip, true);
    assert.match(g.reason, /steps/);
  });

  it('a check grant ignores steps and cost but obeys time', () => {
    let s = sb.openBudget({ steps: 1, cost: 1, timeMs: 100 }, 0);
    s = sb.recordSpend(s, { helper: 'a', steps: 5, cost: 5, outcome: 'ok' }).state;
    assert.equal(sb.grantFor(s, { helper: 'c', kind: 'check' }, 0).skip, false);
    assert.equal(sb.grantFor(s, { helper: 'c' }, 0).skip, true);
    s = sb.startClock(s, 0);
    const late = sb.grantFor(s, { helper: 'c', kind: 'check' }, 150);
    assert.equal(late.skip, true);
    assert.match(late.reason, /time/);
  });

  it('clock runs only while active; nested starts count once', () => {
    let s = sb.openBudget({ timeMs: 1000 }, 0);
    assert.equal(sb.elapsed(s, 500), 0);
    s = sb.startClock(s, 100);
    s = sb.startClock(s, 200); // nested
    assert.equal(s.clock.depth, 2);
    s = sb.stopClock(s, 300);  // inner stop: still running
    assert.equal(sb.elapsed(s, 400), 300);
    s = sb.stopClock(s, 500);
    assert.equal(s.clock.depth, 0);
    assert.equal(sb.elapsed(s, 9000), 400);
  });

  it('stop without start is invalid', () => {
    assert.throws(() => sb.stopClock(sb.openBudget({}, 0), 1), (e) => e instanceof KitExit && e.code === 1);
  });

  it('a clock that moves backwards never subtracts time', () => {
    let s = sb.openBudget({ timeMs: 100 }, 0);
    s = sb.startClock(s, 500);
    assert.equal(sb.elapsed(s, 400), 0);
    s = sb.stopClock(s, 300);
    assert.equal(sb.elapsed(s, 300), 0);
  });

  it('records failed spend and reports an overrun truthfully', () => {
    let s = sb.openBudget({ steps: 3, cost: 2 }, 0);
    const r = sb.recordSpend(s, { helper: 'a', steps: 5, cost: 1, outcome: 'failed' });
    assert.deepEqual(r.overrun, { steps: 2 });
    assert.equal(r.state.spent.steps, 5);
    const st = sb.statusOf(r.state, 0);
    assert.equal(st.remaining.steps, 0);
    assert.equal(st.helpers[0].failed, 1);
    assert.equal(st.helpers[0].steps, 5);
  });

  it('per-helper rows accumulate and skips are logged', () => {
    let s = sb.openBudget({ steps: 1 }, 0);
    s = sb.recordSpend(s, { helper: 'a', steps: 1, cost: 0, outcome: 'ok' }).state;
    s = sb.recordSpend(s, { helper: 'a', steps: 0, cost: 0, outcome: 'ok' }).state;
    s = sb.recordGrant(s, 'b', sb.grantFor(s, { helper: 'b' }, 0));
    const st = sb.statusOf(s, 0);
    const a = st.helpers.find((h) => h.helper === 'a');
    const b = st.helpers.find((h) => h.helper === 'b');
    assert.equal(a.ok, 2);
    assert.equal(b.skipped, 1);
  });

  it('validates limits and spend input', () => {
    for (const bad of [{ steps: 0 }, { steps: -1 }, { steps: 1.5 }, { cost: 0 }, { cost: NaN }, { timeMs: -5 }, { steps: '3' }]) {
      assert.throws(() => sb.openBudget(bad, 0), (e) => e instanceof KitExit && e.code === 1, JSON.stringify(bad));
    }
    const s = sb.openBudget({}, 0);
    assert.throws(() => sb.recordSpend(s, { helper: 'a', steps: -1, cost: 0, outcome: 'ok' }), KitExit);
    assert.throws(() => sb.recordSpend(s, { helper: 'a', steps: 1, cost: 0, outcome: 'meh' }), KitExit);
    assert.throws(() => sb.recordSpend(s, { helper: '', steps: 1, cost: 0, outcome: 'ok' }), KitExit);
  });

  it('rejects corrupt state', () => {
    assert.throws(() => sb.checkState({ version: 1 }), KitExit);
    assert.throws(() => sb.checkState(null), KitExit);
    const s = sb.openBudget({}, 0);
    s.clock.depth = -1;
    assert.throws(() => sb.checkState(s), KitExit);
  });
});

describe('shared-budget CLI', () => {
  it('full lifecycle with an injected clock', () => withDir(async (dir) => {
    const o = await call(dir, ['open', '--steps', '4', '--cost', '10', '--time-ms', '1000', '--now', '0']);
    assert.equal(o.opened, true);
    assert.equal((await call(dir, ['start', '--now', '100'])).depth, 1);
    assert.equal((await call(dir, ['start', '--now', '150'])).depth, 2);
    const g = await call(dir, ['grant', '--helper', 'h1', '--now', '200']);
    assert.deepEqual(g.remaining, { steps: 4, cost: 10, timeMs: 900 });
    const sp = await call(dir, ['spend', '--helper', 'h1', '--steps', '2', '--cost', '4', '--outcome', 'ok', '--now', '250']);
    assert.equal(sp.remaining.steps, 2);
    await call(dir, ['stop', '--now', '300']);
    const last = await call(dir, ['stop', '--now', '400']);
    assert.equal(last.elapsedMs, 300);
    const st = await call(dir, ['status', '--now', '5000']);
    assert.equal(st.elapsedMs, 300);
    assert.equal(st.helpers[0].helper, 'h1');
    const left = JSON.parse(await fs.readFile(path.join(dir, 'b.json'), 'utf8'));
    assert.equal(left.spent.steps, 2);
    assert.deepEqual((await fs.readdir(dir)).filter((f) => f.includes('.tmp')), []);
  }));

  it('exhaustion is a skip with exit 0, not a failure', () => withDir(async (dir) => {
    await call(dir, ['open', '--steps', '1', '--now', '0']);
    await call(dir, ['spend', '--helper', 'a', '--steps', '3', '--cost', '0', '--outcome', 'failed', '--now', '1']);
    const g = await call(dir, ['grant', '--helper', 'b', '--now', '2']);
    assert.equal(g.skip, true);
    assert.ok(g.reason);
    assert.equal(g.exit, undefined);
    const sp = await call(dir, ['spend', '--helper', 'c', '--steps', '1', '--cost', '0', '--outcome', 'ok', '--now', '3']);
    assert.deepEqual(sp.overrun, { steps: 3 });
  }));

  it('exit 1 on bad input and corrupt state', () => withDir(async (dir) => {
    assert.equal(await code(call(dir, ['status'])), 1); // no state
    assert.equal(await code(call(dir, ['bogus'])), 1);
    assert.equal(await code(sb.run(['open'], { cwd: dir })), 1); // no --state
    assert.equal(await code(call(dir, ['open', '--steps', '0'])), 1);
    assert.equal(await code(call(dir, ['open', '--steps', 'x'])), 1);
    await call(dir, ['open', '--steps', '3']);
    assert.equal(await code(call(dir, ['open', '--steps', '3'])), 1); // exists
    assert.equal(await code(call(dir, ['grant'])), 1); // helper missing
    assert.equal(await code(call(dir, ['grant', '--helper', 'a', '--kind', 'weird'])), 1);
    assert.equal(await code(call(dir, ['spend', '--helper', 'a', '--outcome', 'ok'])), 1); // nothing spent
    assert.equal(await code(call(dir, ['stop'])), 1);
    assert.equal(await code(call(dir, ['status', '--now', '-1'])), 1);
    await fs.writeFile(path.join(dir, 'b.json'), '{not json');
    assert.equal(await code(call(dir, ['status'])), 1);
  }));
});
