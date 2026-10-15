import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as mod from '../src/lib/kit/threshold-route.js';

const { routeItem, routeAll, autoFixEligible, resolveThresholds, run, verb, usage, ROUTES } = mod;
const T = { low: 0.4, high: 0.8 };
const ans = (kind, confidence, extra = {}) => ({ kind, confidence, ...extra });
const route = (item, t = T) => routeItem(item, t);

describe('threshold-route: shape', () => {
  it('exports verb and usage', () => {
    assert.equal(verb, 'threshold-route');
    assert.ok(usage.includes('threshold-route'));
  });
});

describe('threshold-route: fixed order', () => {
  it('ledger match ends as intended, even over a deterministic regression', () => {
    const r = route({ id: 'a', ledgerMatch: true, deterministicRegression: true, answer: ans('anomaly', 0.99) });
    assert.equal(r.route, 'as-intended');
    assert.equal(r.rule, 'ledger-match');
  });
  it('deterministic regression blocks and no model answer overrides it', () => {
    for (const a of [ans('not-anomalous', 1), ans('suppress', 1), ans('fix', 1), ans('ambiguous', 1, { ambiguity: 1 }), null]) {
      const r = route({ id: 'b', deterministicRegression: true, answer: a });
      assert.equal(r.route, 'block');
      assert.equal(r.rule, 'deterministic-regression');
      assert.equal(r.autoFixEligible, false);
    }
  });
  it('confident not-anomalous is ignored (>= high, boundary inclusive)', () => {
    assert.equal(route({ answer: ans('not-anomalous', 0.8) }).route, 'ignore');
    assert.equal(route({ answer: ans('not-anomalous', 0.95) }).route, 'ignore');
  });
  it('not-anomalous just below high is never ignored: it asks', () => {
    const r = route({ answer: ans('not-anomalous', 0.79) });
    assert.equal(r.route, 'ask-human');
    const low = route({ answer: ans('not-anomalous', 0.1) });
    assert.equal(low.route, 'ask-human');
  });
  it('confident not-anomalous is ignored even with high ambiguity (ignore comes first)', () => {
    assert.equal(route({ answer: ans('not-anomalous', 0.9, { ambiguity: 0.95 }) }).route, 'ignore');
  });
  it('high ambiguity escalates ahead of low-confidence ask and ahead of suppress/fix', () => {
    assert.equal(route({ answer: ans('anomaly', 0.1, { ambiguity: 0.8 }) }).route, 'escalate');
    assert.equal(route({ answer: ans('suppress', 0.99, { ambiguity: 0.9 }) }).route, 'escalate');
    assert.equal(route({ answer: ans('fix', 0.99, { ambiguity: 0.9 }) }).route, 'escalate');
  });
  it('ambiguity just below high does not escalate', () => {
    assert.notEqual(route({ answer: ans('anomaly', 0.9, { ambiguity: 0.79 }) }).route, 'escalate');
  });
  it('missing answer asks a human', () => {
    for (const item of [{ id: 'x' }, { id: 'y', answer: null }]) {
      const r = route(item);
      assert.equal(r.route, 'ask-human');
      assert.equal(r.rule, 'missing-answer');
    }
  });
  it('confidence below low asks a human', () => {
    const r = route({ answer: ans('anomaly', 0.39) });
    assert.equal(r.route, 'ask-human');
    assert.equal(r.rule, 'low-confidence');
    assert.equal(route({ answer: ans('suppress', 0.0) }).route, 'ask-human');
  });
  it('suppression needs high confidence, between the thresholds it asks', () => {
    assert.equal(route({ answer: ans('suppress', 0.8) }).route, 'suppress');
    assert.equal(route({ answer: ans('suppress', 0.79) }).route, 'ask-human');
    assert.equal(route({ answer: ans('suppress', 0.4) }).route, 'ask-human');
  });
  it('auto-fix needs high confidence, otherwise asks', () => {
    assert.equal(route({ answer: ans('fix', 0.8) }).route, 'auto-fix');
    assert.equal(route({ answer: ans('fix', 0.6) }).route, 'ask-human');
  });
  it('a model-only check verdict is downgraded to an issue, never a block', () => {
    for (const c of [0.5, 0.9, 1]) {
      const r = route({ answer: ans('check', c) });
      assert.equal(r.route, 'issue');
      assert.equal(r.rule, 'model-check-downgraded');
    }
  });
  it('anomaly and ambiguous kinds raise (issue / escalate), never silence', () => {
    assert.equal(route({ answer: ans('anomaly', 0.6) }).route, 'issue');
    assert.equal(route({ answer: ans('anomaly', 0.99) }).route, 'issue');
    assert.equal(route({ answer: ans('ambiguous', 0.6) }).route, 'escalate');
    assert.equal(route({ answer: ans('ambiguous', 0.99) }).route, 'escalate');
  });
  it('a block only ever comes from a deterministic regression', () => {
    const kinds = ['anomaly', 'not-anomalous', 'ambiguous', 'suppress', 'fix', 'check'];
    for (const kind of kinds) for (let c = 0; c <= 1.0001; c += 0.05) for (const amb of [undefined, 0, 0.5, 0.9]) {
      const r = route({ answer: ans(kind, Math.min(1, c), amb === undefined ? {} : { ambiguity: amb }) });
      assert.notEqual(r.route, 'block');
    }
  });
  it('silent routes (ignore, suppress, auto-fix) always have confidence >= high', () => {
    const kinds = ['anomaly', 'not-anomalous', 'ambiguous', 'suppress', 'fix', 'check'];
    for (const kind of kinds) for (let c = 0; c <= 1.0001; c += 0.05) for (const amb of [undefined, 0.2, 0.9]) {
      const conf = Math.min(1, c);
      const r = route({ answer: ans(kind, conf, amb === undefined ? {} : { ambiguity: amb }) });
      if (['ignore', 'suppress', 'auto-fix'].includes(r.route)) assert.ok(conf >= 0.8, `${kind} ${conf} -> ${r.route}`);
    }
  });
});

describe('threshold-route: autoFixEligible', () => {
  it('is true only for a confident fix with nothing overriding it', () => {
    assert.equal(autoFixEligible({ answer: ans('fix', 0.8) }, T), true);
    assert.equal(autoFixEligible({ answer: ans('fix', 0.79) }, T), false);
    assert.equal(autoFixEligible({ answer: ans('suppress', 0.99) }, T), false);
    assert.equal(autoFixEligible({ answer: ans('fix', 0.99), deterministicRegression: true }, T), false);
    assert.equal(autoFixEligible({ answer: ans('fix', 0.99), ledgerMatch: true }, T), false);
    assert.equal(autoFixEligible({ answer: ans('fix', 0.99, { ambiguity: 0.9 }) }, T), false);
    assert.equal(autoFixEligible({}, T), false);
  });
  it('agrees with the route', () => {
    for (const c of [0, 0.4, 0.7, 0.8, 1]) {
      const item = { answer: ans('fix', c) };
      assert.equal(autoFixEligible(item, T), route(item).route === 'auto-fix');
      assert.equal(route(item).autoFixEligible, autoFixEligible(item, T));
    }
  });
  it('defaults thresholds when omitted', () => {
    assert.equal(autoFixEligible({ answer: ans('fix', 0.8) }), true);
    assert.equal(autoFixEligible({ answer: ans('fix', 0.7) }), false);
  });
});

describe('threshold-route: thresholds', () => {
  it('defaults 0.4/0.8', () => assert.deepEqual(resolveThresholds({}), { low: 0.4, high: 0.8 }));
  it('custom thresholds shift the boundaries', () => {
    const t = { low: 0.2, high: 0.5 };
    assert.equal(route({ answer: ans('suppress', 0.5) }, t).route, 'suppress');
    assert.equal(route({ answer: ans('anomaly', 0.19) }, t).route, 'ask-human');
  });
  it('rejects low >= high, out of range, or non-numbers', () => {
    for (const bad of [{ low: 0.8, high: 0.8 }, { low: 0.9, high: 0.5 }, { low: -0.1, high: 0.5 }, { low: 0.1, high: 1.1 }, { low: 'a', high: 0.5 }, { low: NaN, high: 0.5 }]) {
      assert.throws(() => resolveThresholds(bad), (e) => e.code === 1);
    }
  });
});

describe('threshold-route: routeAll and input validation', () => {
  it('routes each item and reports blocks', () => {
    const out = routeAll([
      { id: 'one', deterministicRegression: true },
      { id: 'two', answer: ans('not-anomalous', 0.9) },
      { id: 'three' },
      { id: 'four', answer: ans('fix', 0.95) }
    ], T);
    assert.deepEqual(out.results.map((r) => r.route), ['block', 'ignore', 'ask-human', 'auto-fix']);
    assert.deepEqual(out.blocking, ['one']);
    assert.equal(out.blocks, true);
    assert.equal(out.counts.block, 1);
    assert.equal(out.counts['ask-human'], 1);
    assert.deepEqual(out.thresholds, T);
    assert.ok(out.results.every((r) => ROUTES.includes(r.route) && typeof r.rule === 'string' && typeof r.reason === 'string'));
    assert.equal(out.results[3].autoFixEligible, true);
  });
  it('empty list is valid', () => {
    const out = routeAll([], T);
    assert.equal(out.blocks, false);
    assert.deepEqual(out.results, []);
  });
  it('uses the index when an item has no id', () => {
    assert.equal(routeAll([{}], T).results[0].id, 0);
  });
  it('invalid items throw exit 1', () => {
    const bad = [
      'str', null, 5,
      { answer: 'x' },
      { answer: ans('nope', 0.5) },
      { answer: { kind: 'fix' } },
      { answer: ans('fix', 1.5) },
      { answer: ans('fix', -0.1) },
      { answer: ans('fix', '0.9') },
      { answer: ans('fix', NaN) },
      { answer: ans('fix', 0.9, { ambiguity: 2 }) },
      { answer: ans('fix', 0.9, { ambiguity: 'hi' }) },
      { ledgerMatch: 'yes' },
      { deterministicRegression: 1 }
    ];
    for (const b of bad) assert.throws(() => routeAll([b], T), (e) => e.code === 1, JSON.stringify(b));
    assert.throws(() => routeAll({}, T), (e) => e.code === 1);
  });
  it('a malformed answer on a ledger or regression item is still rejected', () => {
    assert.throws(() => routeAll([{ ledgerMatch: true, answer: ans('nope', 0.5) }], T), (e) => e.code === 1);
  });
});

describe('threshold-route: run', () => {
  const mk = async () => fs.mkdtemp(path.join(os.tmpdir(), 'thr-'));
  const io = (cwd, stdin = '') => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });

  it('reads an object with items from stdin', async () => {
    const dir = await mk();
    try {
      const r = await run([], io(dir, JSON.stringify({ items: [{ id: 'a', deterministicRegression: true }] })));
      assert.equal(r.results[0].route, 'block');
      assert.equal(r.exit, undefined);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('reads a bare array from --file and takes --low/--high', async () => {
    const dir = await mk();
    try {
      await fs.writeFile(path.join(dir, 'in.json'), JSON.stringify([{ id: 'a', answer: ans('suppress', 0.6) }]));
      const r = await run(['--file', 'in.json', '--low', '0.2', '--high', '0.5'], io(dir));
      assert.equal(r.results[0].route, 'suppress');
      assert.deepEqual(r.thresholds, { low: 0.2, high: 0.5 });
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('input may carry thresholds, flags win', async () => {
    const dir = await mk();
    try {
      const body = JSON.stringify({ thresholds: { low: 0.1, high: 0.3 }, items: [] });
      assert.deepEqual((await run([], io(dir, body))).thresholds, { low: 0.1, high: 0.3 });
      assert.deepEqual((await run(['--high', '0.9'], io(dir, body))).thresholds, { low: 0.1, high: 0.9 });
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('exit 1 on bad json, bad flags, bad thresholds, missing file, nothing to read', async () => {
    const dir = await mk();
    try {
      const cases = [
        [[], 'not json'],
        [[], ''],
        [['--bogus'], '[]'],
        [['--low'], '[]'],
        [['--low', 'x'], '[]'],
        [['--low', '0.9', '--high', '0.5'], '[]'],
        [['--high', '2'], '[]'],
        [['--file', 'missing.json'], ''],
        [[], JSON.stringify({ items: 'x' })],
        [[], JSON.stringify([{ answer: ans('fix', 5) }])]
      ];
      for (const [args, stdin] of cases) await assert.rejects(run(args, io(dir, stdin)), (e) => e.code === 1, JSON.stringify(args));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('--help returns usage', async () => {
    assert.equal((await run(['--help'], io('/'))).usage, usage);
  });
});
