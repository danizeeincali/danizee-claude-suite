import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as rp from '../src/lib/kit/redline-passes.js';

const { run, plan, evaluate, verb } = rp;
const io = cwd => ({ cwd, stdin: async () => '', env: {} });
const exit = async (p, code = 1) => assert.rejects(Promise.resolve().then(p), e => e instanceof KitExit && e.code === code);
const IDS = ['spacing', 'color', 'icons', 'copy', 'type', 'layout', 'details', 'visuals', 'motion'];

let dir;
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redline-')); });
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
const call = args => run(args, io(dir));
const write = (name, text) => fs.writeFile(path.join(dir, name), typeof text === 'string' ? text : JSON.stringify(text));

describe('plan', () => {
  it('lists nine passes in fixed order with 4-7 checks and a reason each', () => {
    assert.equal(verb, 'redline-passes');
    const { passes } = plan();
    assert.deepEqual(passes.map(p => p.id), IDS);
    passes.forEach((p, i) => {
      assert.equal(p.n, i + 1);
      assert.ok(p.label && p.why_here);
      assert.ok(p.checks.length >= 4 && p.checks.length <= 7, p.id);
      p.checks.forEach(c => assert.equal(typeof c, 'string'));
    });
    assert.match(passes[3].why_here, /headline/);
    assert.ok(passes[0].checks.some(c => /4px/.test(c)));
    assert.ok(passes[8].checks.some(c => /color, opacity and transform/.test(c)));
  });
  it('is a copy, not shared state', () => {
    plan().passes[0].checks.push('x');
    assert.equal(plan().passes[0].checks.length, 5);
  });
  it('run plan rejects arguments; unknown and missing subcommands exit 1', async () => {
    assert.deepEqual(await call(['plan']), plan());
    await exit(() => call(['plan', 'x']));
    await exit(() => call([]));
    await exit(() => call(['bogus']));
  });
});

describe('next', () => {
  it('without a state file starts at spacing', async () => {
    const r = await call(['next']);
    assert.equal(r.next.id, 'spacing');
    assert.deepEqual(r.done, []);
    assert.deepEqual(r.remaining, IDS);
    assert.equal(r.ok, true);
  });
  it('a missing file means nothing done', async () => {
    const r = await call(['next', '--state', 'nope.json']);
    assert.equal(r.next.id, 'spacing');
  });
  it('advances after done passes and ends with null', async () => {
    await write('s1.json', { done: ['spacing', 'color'] });
    const r = await call(['next', '--state', 's1.json']);
    assert.equal(r.next.id, 'icons');
    assert.deepEqual(r.remaining, IDS.slice(2));
    await write('s2.json', { done: IDS });
    const e = await call(['next', '--state', 's2.json']);
    assert.equal(e.next, null);
    assert.deepEqual(e.remaining, []);
    assert.equal(e.ok, true);
  });
  it('flags a skipped pass as advisory, exit 0', async () => {
    await write('s3.json', { done: ['spacing', 'icons'] });
    const r = await call(['next', '--state', 's3.json']);
    assert.equal(r.ok, false);
    assert.match(r.problem, /icons.*color/);
    assert.equal(r.next.id, 'color');
    assert.ok(r.fix);
    assert.equal(r.exit, undefined);
  });
  it('--strict exits 2 on out of order but not on a clean state', async () => {
    await write('s3.json', { done: ['color'] });
    assert.equal((await call(['next', '--state', 's3.json', '--strict'])).exit, 2);
    await write('s4.json', { done: ['spacing'] });
    assert.equal((await call(['next', '--state', 's4.json', '--strict'])).exit, undefined);
  });
  it('flags unknown and repeated passes', async () => {
    await write('u.json', { done: ['spacing', 'sparkle'] });
    const r = await call(['next', '--state', 'u.json']);
    assert.equal(r.ok, false);
    assert.match(r.problem, /unknown/);
    await write('d.json', { done: ['spacing', 'spacing'] });
    assert.match((await call(['next', '--state', 'd.json'])).problem, /more than once/);
    assert.equal(evaluate([1]).ok, false);
  });
  it('--all-at-once returns the remaining passes as one batch with a reminder', async () => {
    await write('s5.json', { done: ['spacing'] });
    const r = await call(['next', '--state', 's5.json', '--all-at-once']);
    assert.deepEqual(r.batch.map(p => p.id), IDS.slice(1));
    assert.match(r.reminder, /applied/);
    assert.equal(r.next.id, 'color');
    assert.equal((await call(['next'])).batch, undefined);
  });
  it('rejects broken state and bad flags with exit 1', async () => {
    await write('bad.json', '{nope');
    await exit(() => call(['next', '--state', 'bad.json']));
    await write('arr.json', '[]');
    await exit(() => call(['next', '--state', 'arr.json']));
    await write('nodone.json', {});
    await exit(() => call(['next', '--state', 'nodone.json']));
    await write('nums.json', { done: [1] });
    await exit(() => call(['next', '--state', 'nums.json']));
    await write('empty.json', '');
    await exit(() => call(['next', '--state', 'empty.json']));
    await fs.writeFile(path.join(dir, 'bin.json'), Buffer.from([0xff, 0xfe, 0, 1]));
    await exit(() => call(['next', '--state', 'bin.json']));
    await exit(() => call(['next', '--state', dir]));
    await exit(() => call(['next', '--bogus']));
    await exit(() => call(['next', '--state']));
    await exit(() => call(['next', '--state', '']));
    await exit(() => call(['next', '--state', 'a', '--state', 'b']));
    await exit(() => call(['next', '--strict', '--strict']));
    await exit(() => call(['next', 'stray']));
  });
  it('rejects a state file over 8 MiB', async () => {
    await write('big.json', '{"done":[],"pad":"' + 'x'.repeat(8 * 1024 * 1024) + '"}');
    await exit(() => call(['next', '--state', 'big.json']));
  });
});

describe('mark', () => {
  it('creates the file, then appends passes in order', async () => {
    const f = path.join(dir, 'sub', 'p.json');
    const r1 = await call(['mark', '--state', 'sub/p.json', '--pass', 'spacing']);
    assert.deepEqual(r1, { marked: 'spacing', done: ['spacing'], next: 'color' });
    await call(['mark', '--state', 'sub/p.json', '--pass', 'color']);
    assert.deepEqual(JSON.parse(await fs.readFile(f, 'utf-8')).done, ['spacing', 'color']);
    assert.deepEqual((await fs.readdir(path.dirname(f))).filter(n => n.endsWith('.tmp') || n.endsWith('.lock')), []);
  });
  it('refuses an out-of-order or repeated pass with exit 2 and leaves the file untouched', async () => {
    await write('m.json', { done: ['spacing'] });
    const before = await fs.readFile(path.join(dir, 'm.json'), 'utf-8');
    await exit(() => call(['mark', '--state', 'm.json', '--pass', 'icons']), 2);
    await exit(() => call(['mark', '--state', 'm.json', '--pass', 'spacing']), 2);
    assert.equal(await fs.readFile(path.join(dir, 'm.json'), 'utf-8'), before);
  });
  it('completes all nine, then refuses another', async () => {
    for (const id of IDS) await call(['mark', '--state', 'all.json', '--pass', id]);
    assert.equal((await call(['next', '--state', 'all.json'])).next, null);
    await exit(() => call(['mark', '--state', 'all.json', '--pass', 'motion']), 2);
    assert.equal((await call(['mark', '--state', 'all2.json', '--pass', 'spacing'])).next, 'color');
  });
  it('keeps other keys in the state file', async () => {
    await write('k.json', { done: [], note: 'hi' });
    await call(['mark', '--state', 'k.json', '--pass', 'spacing']);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'k.json'), 'utf-8')).note, 'hi');
  });
  it('refuses to mark on top of an out-of-order state (exit 1)', async () => {
    await write('o.json', { done: ['color'] });
    await exit(() => call(['mark', '--state', 'o.json', '--pass', 'spacing']));
  });
  it('rejects missing, unknown and duplicate flags and broken files with exit 1', async () => {
    await exit(() => call(['mark', '--pass', 'spacing']));
    await exit(() => call(['mark', '--state', 'x.json']));
    await exit(() => call(['mark', '--state', 'x.json', '--pass', 'sparkle']));
    await exit(() => call(['mark', '--state', 'x.json', '--pass', 'spacing', '--pass', 'color']));
    await exit(() => call(['mark', '--state', 'x.json', '--pass', 'spacing', '--strict']));
    await write('broken.json', 'xx');
    await exit(() => call(['mark', '--state', 'broken.json', '--pass', 'spacing']));
    assert.equal(await fs.readFile(path.join(dir, 'broken.json'), 'utf-8'), 'xx');
  });
  it('serialises concurrent marks: only the right one wins', async () => {
    const results = await Promise.allSettled(IDS.slice(0, 3).map(id => call(['mark', '--state', 'race.json', '--pass', id])));
    const ok = results.filter(r => r.status === 'fulfilled');
    assert.ok(ok.length >= 1);
    const done = JSON.parse(await fs.readFile(path.join(dir, 'race.json'), 'utf-8')).done;
    assert.deepEqual(done, IDS.slice(0, done.length));
  });
});
