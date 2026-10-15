import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as rg from '../src/lib/kit/replay-gate.js';
import { loadVerbs } from '../src/lib/kit/cli.js';

const { gate, run, verb } = rg;
const R = (extra = {}) => ({ steps: ['open', 'click', 'read'], checks: { title: 'Home', ok: false }, outputs: { body: 'hello' }, ...extra });
const V = (o = {}) => ({ id: 'c1', decided_by: 'replay', outcome: 'fail', runs: [R(), R()], ...o });
const cls = async (v, opts) => (await gate([v], opts)).results[0];
const bad = async (fn) => { try { await fn(); } catch (e) { assert.ok(e instanceof KitExit); assert.equal(e.code, 1); return e; } assert.fail('expected KitExit 1'); };

describe('replay-gate — classification', () => {
  it('is discovered as a verb', async () => {
    assert.equal(verb, 'replay-gate');
    assert.ok((await loadVerbs()).has ? (await loadVerbs()).has('replay-gate') : true);
  });
  it('program failure that two identical runs agree on blocks, exit 2', async () => {
    for (const kind of ['replay', 'exact-check', 'output-diff']) {
      const r = await gate([V({ decided_by: kind })]);
      assert.equal(r.results[0].class, 'blocking');
      assert.equal(r.exit, 2);
    }
  });
  it('key order inside runs does not count as a difference', async () => {
    const a = R({ checks: { a: 1, b: 2 } });
    const b = R({ checks: { b: 2, a: 1 } });
    assert.equal((await cls(V({ runs: [a, b] }))).class, 'blocking');
  });
  it('runs that differ downgrade to untested and name what differed', async () => {
    const r = await cls(V({ runs: [R(), R({ steps: ['open', 'click'] })] }));
    assert.equal(r.class, 'untested');
    assert.match(r.reason, /flaky/);
    assert.deepEqual(r.differed, ['steps']);
    const o = await cls(V({ runs: [R(), R({ outputs: { body: 'bye' }, checks: { title: 'Home', ok: true } })] }));
    assert.deepEqual(o.differed.sort(), ['checks.ok', 'outputs.body']);
    assert.match(o.reason, /outputs\.body/);
    assert.equal((await gate([V({ runs: [R(), R({ steps: [] })] })])).exit, 0);
  });
  it('a field present in one run only counts as a difference', async () => {
    const r = await cls(V({ runs: [R(), { steps: R().steps, checks: R().checks }] }));
    assert.equal(r.class, 'untested');
    assert.deepEqual(r.differed, ['outputs']);
  });
  it('a single run, or none, is untested', async () => {
    assert.equal((await cls(V({ runs: [R()] }))).class, 'untested');
    assert.match((await cls(V({ runs: [R()] }))).reason, /second run/);
    assert.equal((await cls(V({ runs: undefined }))).class, 'untested');
    assert.equal((await cls(V({ runs: [] }))).class, 'untested');
  });
  it('three runs must all agree', async () => {
    assert.equal((await cls(V({ runs: [R(), R(), R()] }))).class, 'blocking');
    assert.equal((await cls(V({ runs: [R(), R(), R({ steps: [] })] }))).class, 'untested');
  });
  it('any judgement is a comment, however confident, even with agreeing runs', async () => {
    for (const d of ['model', 'llm', 'human', 'Replay', 'replay ']) {
      const r = await cls(V({ decided_by: d }));
      assert.equal(r.class, 'comment', d);
    }
    const g = await gate([V({ decided_by: 'model' }), V({ id: 'c2', decided_by: 'model', outcome: 'pass', runs: undefined })]);
    assert.deepEqual(g.results.map(x => x.class), ['comment', 'comment']);
    assert.equal(g.exit, 0);
  });
  it('program pass is pass', async () => {
    assert.equal((await cls(V({ outcome: 'pass', runs: undefined }))).class, 'pass');
    assert.equal((await cls(V({ outcome: 'pass' }))).class, 'pass');
  });
  it('exit is 2 only when something blocks; counts add up', async () => {
    const g = await gate([V({ id: 'a' }), V({ id: 'b', decided_by: 'model' }), V({ id: 'c', runs: [R()] }), V({ id: 'd', outcome: 'pass' })]);
    assert.deepEqual(g.counts, { blocking: 1, untested: 1, comment: 1, pass: 1 });
    assert.equal(g.exit, 2);
    assert.deepEqual(g.results.map(r => r.id), ['a', 'b', 'c', 'd']);
  });
  it('empty verdict list is fine and exits 0', async () => {
    const g = await gate([]);
    assert.equal(g.exit, 0);
  });
});

describe('replay-gate — injected replay', () => {
  it('produces the second run when only one is present', async () => {
    let calls = 0;
    const replay = async v => { calls++; assert.equal(v.id, 'c1'); return R(); };
    const r = await cls(V({ runs: [R()] }), { replay });
    assert.equal(r.class, 'blocking');
    assert.equal(calls, 1);
  });
  it('a disagreeing replay is untested; a throwing replay is untested with the reason', async () => {
    assert.equal((await cls(V({ runs: [R()] }), { replay: () => R({ steps: [] }) })).class, 'untested');
    const t = await cls(V({ runs: [R()] }), { replay: () => { throw new Error('boom'); } });
    assert.equal(t.class, 'untested');
    assert.match(t.reason, /boom/);
  });
  it('is not called when two runs exist, nor for judgements or passes', async () => {
    const replay = () => assert.fail('must not replay');
    await gate([V(), V({ id: 'b', decided_by: 'model', runs: [R()] }), V({ id: 'c', outcome: 'pass', runs: [R()] })], { replay });
  });
  it('an invalid replay result makes that verdict untested; bad options are exit 1', async () => {
    for (const badRun of [{}, 'x']) {
      const r = await gate([V({ runs: [R()] })], { replay: () => badRun });
      assert.equal(r.results[0].class, 'untested');
      assert.equal(r.exit, 0);
    }
    await bad(() => gate([V()], { replay: 'nope' }));
    await bad(() => gate([V()], { replay: null, extra: 1 }));
  });
});

describe('replay-gate — invalid input', () => {
  it('rejects unknown keys at every level', async () => {
    await bad(() => gate([V({ colour: 1 })]));
    await bad(() => gate([V({ runs: [R({ extra: 1 }), R()] })]));
  });
  it('rejects malformed verdicts', async () => {
    await bad(() => gate('x'));
    await bad(() => gate([null]));
    await bad(() => gate([V({ id: '' })]));
    await bad(() => gate([V({ id: 3 })]));
    await bad(() => gate([V(), V()])); // duplicate id
    await bad(() => gate([V({ decided_by: '' })]));
    await bad(() => gate([V({ decided_by: undefined })]));
    await bad(() => gate([V({ outcome: 'maybe' })]));
    await bad(() => gate([V({ outcome: undefined })]));
    await bad(() => gate([V({ runs: 'x' })]));
    await bad(() => gate([V({ runs: [{}, {}] })])); // empty run proves nothing
    await bad(() => gate([V({ runs: [R({ steps: 'open' }), R()] })]));
    await bad(() => gate([V({ runs: [null, R()] })]));
  });
  it('does not mutate its input', async () => {
    const v = [V()];
    const copy = JSON.stringify(v);
    await gate(v);
    assert.equal(JSON.stringify(v), copy);
  });
});

describe('replay-gate — CLI run', () => {
  const io = (cwd, stdin = '') => ({ cwd, stdin: async () => stdin, stdinBytes: async () => Buffer.from(stdin), stdinIsTTY: false, env: {} });
  it('reads stdin, strips a BOM, and sets exit', async () => {
    const text = '﻿' + JSON.stringify({ verdicts: [V()] });
    const r = await run([], io('/', text));
    assert.equal(r.exit, 2);
    assert.equal(r.results[0].class, 'blocking');
  });
  it('reads --file relative to cwd, with a BOM', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rg-'));
    try {
      await fs.writeFile(path.join(dir, 'in.json'), '﻿' + JSON.stringify({ verdicts: [V({ outcome: 'pass' })] }));
      const r = await run(['--file', 'in.json'], io(dir));
      assert.equal(r.exit ?? 0, 0);
      assert.equal(r.results[0].class, 'pass');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('bad json, missing file, unknown flag/key, tty with no input are exit 1', async () => {
    await bad(() => run([], io('/', '{nope')));
    await bad(() => run([], io('/', '[]')));
    await bad(() => run([], io('/', JSON.stringify({ verdicts: [], extra: 1 }))));
    await bad(() => run([], io('/', JSON.stringify({}))));
    await bad(() => run(['--file', '/definitely/missing.json'], io('/')));
    await bad(() => run(['--bogus'], io('/', '{}')));
    await bad(() => run(['--file'], io('/', '{}')));
    await bad(() => run([], { ...io('/'), stdinIsTTY: true }));
  });
});

describe('replay-gate — round 1 findings', () => {
  const io2 = (cwd, stdin = '', tty = false) => ({ cwd, stdin: async () => stdin, stdinBytes: async () => Buffer.from(stdin), stdinIsTTY: tty, env: {} });
  it('library: non-JSON values in a run are refused with KitExit 1, never compared as equal', async () => {
    const odd = [
      { at: new Date(0) }, { m: new Map([[1, 2]]) }, { s: new Set([1]) }, { n: 10n }, { u: undefined }, { f: () => 1 },
      { sym: Symbol('x') }, { nan: NaN }, { inf: Infinity }, { list: [undefined] }, { list: [new Date(0)] }, { c: new (class X { constructor() { this.a = 1; } })() },
    ];
    for (const o of odd) {
      await bad(() => gate([V({ runs: [R({ outputs: o }), R({ outputs: o })] })]));
      await bad(() => gate([V({ runs: [R({ checks: o }), R()] })]));
    }
    await bad(() => gate([V({ runs: [R({ steps: [new Date(0)] }), R()] })]));
    await bad(() => gate([V({ runs: [R({ steps: [undefined] }), R()] })]));
  });
  it('library: Date outputs that differ do not block as equal', async () => {
    await bad(() => gate([V({ runs: [R({ outputs: { at: new Date(0) } }), R({ outputs: { at: new Date(9e12) } })] })]));
    await bad(() => gate([V({ runs: [R({ outputs: { m: new Map([[1, 2]]) } }), R({ outputs: { m: new Map([[1, 3]]) } })] })]));
  });
  it('plain JSON values and null-prototype objects still work', async () => {
    const o = Object.assign(Object.create(null), { a: 1 });
    assert.equal((await cls(V({ runs: [R({ outputs: o }), R({ outputs: { a: 1 } })] }))).class, 'blocking');
    assert.equal((await cls(V({ runs: [R({ outputs: { a: [1, 'x', null, true, { b: 2.5 }] } }), R({ outputs: { a: [1, 'x', null, true, { b: 2.5 }] } })] }))).class, 'blocking');
  });
  it('a malformed run from replay downgrades only that verdict to untested', async () => {
    const one = id => V({ id, runs: [R()] });
    const blocked = V({ id: 'b' });
    for (const badRun of [{}, { steps: ['a'], extra: 1 }, null, 'x', { outputs: { at: new Date(0) } }]) {
      const r = await gate([one('a'), blocked, one('c')], { replay: async () => badRun });
      assert.equal(r.exit, 2);
      assert.deepEqual(r.results.map(x => x.class), ['untested', 'blocking', 'untested']);
      assert.match(r.results[0].reason, /replay/);
    }
  });
  it('--file - reads stdin; a repeated --file is refused', async () => {
    const text = JSON.stringify({ verdicts: [V({ outcome: 'pass' })] });
    const r = await run(['--file', '-'], io2('/', text));
    assert.equal(r.results[0].class, 'pass');
    await bad(() => run(['--file', '-'], io2('/', text, true)));
    await bad(() => run(['--file', 'a.json', '--file', 'b.json'], io2('/', text)));
    await bad(() => run(['--file', '-', '--file', '-'], io2('/', text)));
  });
});
