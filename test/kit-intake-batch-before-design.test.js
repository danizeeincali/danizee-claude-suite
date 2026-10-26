import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as db from '../src/lib/kit/design-brief.js';

const { questions, assume, normalize, run, FIELDS, KINDS } = db;
const exit = (fn, code = 1) => assert.throws(fn, e => e instanceof KitExit && e.code === code);
const io = (stdin, cwd) => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
const full = () => ({
  offer: 'Invoicing for freelancers', primary_action: 'Start free trial', audience: 'Freelance designers',
  objections: ['price'], proof: ['120 customers'], brand: 'Dark, serif', references: ['stripe.com'],
});

describe('questions', () => {
  it('returns every missing field as one batch in the fixed order', () => {
    const r = questions({ kind: 'landing' });
    assert.deepEqual(r.batch.map(b => b.field), FIELDS);
    assert.equal(r.complete, false);
    for (const b of r.batch) { assert.ok(b.question.endsWith('?')); assert.ok(b.why.length > 10); }
  });
  it('treats empty, blank, null and empty arrays as missing and skips answered fields', () => {
    const r = questions({ kind: 'ui', answers: { offer: 'x', audience: '  ', objections: [], proof: [''], brand: null, references: 'a' } });
    assert.deepEqual(r.batch.map(b => b.field), ['primary_action', 'audience', 'objections', 'proof', 'brand']);
  });
  it('is complete when everything is answered', () => {
    const r = questions({ kind: 'motion', answers: full() });
    assert.deepEqual(r, { kind: 'motion', batch: [], complete: true, warnings: [] });
  });
  it('words questions per kind', () => {
    const q = k => questions({ kind: k }).batch.find(b => b.field === 'primary_action').question;
    assert.notEqual(q('landing'), q('ui'));
    assert.notEqual(q('ui'), q('motion'));
  });
  it('warns when primary_action is plural', () => {
    const r = questions({ kind: 'landing', answers: { ...full(), primary_action: ['Buy', 'Book a call'] } });
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /primary_action must be one action/);
    assert.equal(r.complete, true);
  });
});

describe('assume', () => {
  it('fills each missing field with a one-sentence "Assumed" line and keeps answers', () => {
    for (const kind of KINDS) {
      const r = assume({ kind, answers: { offer: 'Tea subscriptions', proof: ['4.8 stars'] } });
      assert.deepEqual(Object.keys(r.brief), FIELDS);
      assert.equal(r.brief.offer, 'Tea subscriptions');
      assert.deepEqual(r.brief.proof, ['4.8 stars']);
      assert.deepEqual(r.assumptions.map(a => a.field), FIELDS.filter(f => f !== 'offer' && f !== 'proof'));
      for (const a of r.assumptions) {
        assert.match(a.line, /^Assumed /);
        assert.ok(a.line.endsWith('.'));
        assert.equal((a.line.match(/\. /g) || []).length, 0, a.line);
        assert.equal(r.brief[a.field], a.value);
      }
    }
  });
  it('has no assumptions when complete and keeps the first of several primary actions with a warning', () => {
    assert.deepEqual(assume({ kind: 'landing', answers: full() }).assumptions, []);
    const r = assume({ kind: 'landing', answers: { ...full(), primary_action: ['Buy', 'Call'] } });
    assert.equal(r.brief.primary_action, 'Buy');
    assert.equal(r.warnings.length, 1);
  });
  it('does not mutate its input', () => {
    const i = { kind: 'ui', answers: { offer: ' x ' } };
    const copy = JSON.stringify(i);
    assume(i); questions(i);
    assert.equal(JSON.stringify(i), copy);
  });
});

describe('bad input', () => {
  it('rejects wrong shapes, kinds, unknown keys and types', () => {
    exit(() => normalize([]));
    exit(() => normalize({}));
    exit(() => normalize({ kind: 'poster' }));
    exit(() => normalize({ kind: 'ui', extra: 1 }));
    exit(() => normalize({ kind: 'ui', answers: [] }));
    exit(() => normalize({ kind: 'ui', answers: { colour: 'red' } }));
    exit(() => normalize({ kind: 'ui', answers: { offer: 5 } }));
    exit(() => normalize({ kind: 'ui', answers: { offer: ['a'] } }));
    exit(() => normalize({ kind: 'ui', answers: { proof: [1] } }));
  });
  it('names the field in the message', () => {
    assert.throws(() => normalize({ kind: 'ui', answers: { audience: 3 } }), /answers\.audience/);
  });
});

describe('run', () => {
  it('reads stdin and --file and refuses bad invocations', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'design-brief-'));
    try {
      const body = JSON.stringify({ kind: 'landing', answers: { offer: 'x' } });
      assert.equal((await run(['questions'], io(body, dir))).batch.length, 6);
      await fs.writeFile(path.join(dir, 'b.json'), '﻿' + body);
      assert.equal((await run(['assume', '--file', 'b.json'], io('', dir))).assumptions.length, 6);
      await assert.rejects(run(['assume', '--file', 'nope.json'], io('', dir)), e => e.code === 1);
      await assert.rejects(run(['plan'], io(body, dir)), e => e.code === 1);
      await assert.rejects(run(['assume', '--bogus'], io(body, dir)), e => e.code === 1);
      await assert.rejects(run(['assume', '--file'], io(body, dir)), e => e.code === 1);
      await assert.rejects(run(['assume'], io('   ', dir)), e => e.code === 1);
      await assert.rejects(run(['assume'], io('{nope', dir)), e => e.code === 1);
      await assert.rejects(run(['assume'], io('{"kind":"x"}', dir)), e => e.code === 1);
      await fs.writeFile(path.join(dir, 'big.json'), Buffer.alloc(8 * 1024 * 1024 + 1, 32));
      await assert.rejects(run(['assume', '--file', 'big.json'], io('', dir)), /8 MiB/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
