import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
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

  it('refuses a FIFO or /dev/stdin as --file, an empty --file and a repeated --file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'design-brief-'));
    try {
      const body = JSON.stringify({ kind: 'landing', answers: { offer: 'x' } });
      await assert.rejects(run(['assume', '--file', '/dev/stdin'], io(body, dir)), e => e.code === 1 && /regular file/.test(e.message));
      await assert.rejects(run(['assume', '--file', '/dev/null'], io(body, dir)), e => e.code === 1 && /regular file/.test(e.message));
      const fifo = path.join(dir, 'p.fifo');
      if (spawnSync('mkfifo', [fifo]).status === 0) {
        await assert.rejects(run(['assume', '--file', fifo], io(body, dir)), e => e.code === 1 && /regular file/.test(e.message));
      }
      await assert.rejects(run(['assume', '--file', ''], io(body, dir)), e => e.code === 1 && /needs a value/.test(e.message));
      await fs.writeFile(path.join(dir, 'b.json'), body);
      await assert.rejects(run(['assume', '--file', 'b.json', '--file', 'b.json'], io(body, dir)), e => e.code === 1 && /only once/.test(e.message));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('reads stdin through stdinBytes with a byte cap of 8 MiB, multibyte included', async () => {
    const body = JSON.stringify({ kind: 'landing', answers: { offer: 'x' } });
    const seen = [];
    const bytesIo = buf => ({ cwd: '/', stdinIsTTY: false, env: {}, stdinBytes: async o => { seen.push(o); return buf; } });
    assert.equal((await run(['questions'], bytesIo(Buffer.from(body)))).batch.length, 6);
    assert.equal(seen[0].maxBytes, 8 * 1024 * 1024 + 1);
    const over = Buffer.alloc(8 * 1024 * 1024 + 1, 32);
    await assert.rejects(run(['assume'], bytesIo(over)), e => e.code === 1 && /8 MiB/.test(e.message));
    // 4 Mi + 1 two-byte characters: fewer than 8 Mi characters, more than 8 MiB
    const multi = Buffer.from('\u00e9'.repeat(4 * 1024 * 1024 + 1));
    assert.ok(multi.toString('utf-8').length < 8 * 1024 * 1024 && multi.length > 8 * 1024 * 1024);
    await assert.rejects(run(['assume'], bytesIo(multi)), e => e.code === 1 && /8 MiB/.test(e.message));
    // the text-only fallback counts bytes too
    await assert.rejects(run(['assume'], io(multi.toString('utf-8'))), e => e.code === 1 && /8 MiB/.test(e.message));
  });
});

describe('integration fixes (carried findings)', () => {
  it('refuses /proc paths on the open handle, naming /proc', async () => {
    await assert.rejects(run(['assume', '--file', '/proc/self/status'], io('', os.tmpdir())), e => e instanceof KitExit && e.code === 1 && /\/proc/.test(e.message));
  });
  it('a JSON parse error keeps its reason', async () => {
    await assert.rejects(run(['assume'], io('{"kind": "landing",', os.tmpdir())), e => e.code === 1 && /not valid JSON: \S/.test(e.message) && !/not valid JSON$/.test(e.message));
    // the reason never quotes the input: a credentials file passed by mistake must not leak into stderr
    for (const bad of ['{"kind": "landing", "api_key": sk-live-0123456789}', 'OPENAI_API_KEY=sk-live-0123456789']) {
      await assert.rejects(run(['assume'], io(bad, os.tmpdir())), e => e.code === 1 && /not valid JSON: \S/.test(e.message) && !/sk-live|OPENAI/.test(e.message));
    }
  });
  it('refusals name their cause, not only the exit code', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-msg-'));
    try {
      await assert.rejects(run(['assume', '--file', dir], io('', dir)), e => e.code === 1 && /regular file/.test(e.message));
      await assert.rejects(run(['assume', '--file', 'nope.json'], io('', dir)), e => e.code === 1 && /cannot read .*nope\.json: ENOENT/.test(e.message));
      await assert.rejects(run(['assume'], io('  ', dir)), e => e.code === 1 && /no input/.test(e.message));
      await assert.rejects(run(['assume'], io('{"kind":"x"}', dir)), e => e.code === 1 && /kind must be one of/.test(e.message));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('handles a 2 MB adversarial answer list in under 2 s', async () => {
    const t0 = Date.now();
    await run(['questions'], io(JSON.stringify({ kind: 'landing', answers: { proof: Array(200000).fill('x'.repeat(8)) } }), os.tmpdir()));
    assert.ok(Date.now() - t0 < 2000);
  });
});
