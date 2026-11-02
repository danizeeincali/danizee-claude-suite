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
    results.filter(r => r.status === 'rejected').forEach(r => assert.ok(r.reason instanceof KitExit && r.reason.code === 2, String(r.reason)));
    const done = JSON.parse(await fs.readFile(path.join(dir, 'race.json'), 'utf-8')).done;
    assert.equal(done.length, ok.length);
    assert.deepEqual(done, IDS.slice(0, done.length));
  });
});

describe('review r1 fixes', () => {
  it('header documents the real exit codes, signature and next rule (both copies)', async () => {
    for (const f of ['../src/lib/kit/redline-passes.js', '../.claude/helpers/kit/redline-passes.js']) {
      const src = (await fs.readFile(new URL(f, import.meta.url), 'utf-8')).replace(/\n \* ?/g, ' ');
      assert.match(src, /out of order or already done exits 2 with the file untouched; an unknown pass id exits 1/, f);
      assert.doesNotMatch(src, /already\s+done or unknown exits 2/, f);
      assert.match(src, /\{ next, done, remaining, ok, problem\?, fix\?, batch\?, reminder\?, exit\? \}/, f);
      assert.match(src, /first plan pass after the in-order prefix/, f);
    }
  });
  it('fix text names the right remedy for each problem kind', () => {
    const unk = evaluate(['spacing', 'bogus', 'color']);
    assert.equal(unk.next.id, 'color');
    assert.match(unk.fix, /Remove "bogus"/);
    const rep = evaluate(['spacing', 'spacing']);
    assert.match(rep.fix, /Remove the repeated "spacing"/);
    const ooo = evaluate(['color']);
    assert.match(ooo.fix, /Redo the passes in plan order/);
    assert.match(ooo.fix, /"spacing"/);
  });
});

describe('review r2 fixes', () => {
  it('remaining and batch keep the misplaced pass on an out-of-order state', async () => {
    assert.deepEqual(evaluate(['spacing', 'motion']).remaining, IDS.slice(1));
    assert.deepEqual(evaluate(['color']).remaining, IDS);
    assert.deepEqual(evaluate(['spacing', 'color', 'spacing']).remaining, IDS.slice(2));
    await write('r2a.json', { done: ['spacing', 'motion'] });
    const r = await call(['next', '--state', 'r2a.json', '--all-at-once']);
    assert.equal(r.ok, false);
    assert.deepEqual(r.remaining, IDS.slice(1));
    assert.deepEqual(r.batch.map(p => p.id), IDS.slice(1));
    assert.equal(r.next.id, 'color');
    const plain = await call(['next', '--state', 'r2a.json']);
    assert.equal(plain.remaining.length, 8);
  });
  it('inherited Object.prototype names are not flags', async () => {
    for (const n of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      await exit(() => call(['next', n, 'x']));
      await exit(() => call(['mark', '--state', 'x.json', '--pass', 'spacing', n, 'y']));
    }
  });
  it('a refused mark does not create the state folder', async () => {
    await exit(() => call(['mark', '--state', 'ghost/x.json', '--pass', 'color']), 2);
    await assert.rejects(fs.stat(path.join(dir, 'ghost')), { code: 'ENOENT' });
  });
  it('header says a non-string entry exits 1 (both copies)', async () => {
    for (const f of ['../src/lib/kit/redline-passes.js', '../.claude/helpers/kit/redline-passes.js']) {
      const src = (await fs.readFile(new URL(f, import.meta.url), 'utf-8')).replace(/\n \* ?/g, ' ');
      assert.match(src, /a non-string entry, like a missing `done`, exits 1/, f);
    }
  });
});

describe('header contract and real producer output', () => {
  it('every documented output field is present and every documented exit code is produced', async () => {
    const n = await call(['next', '--all-at-once']);
    for (const k of ['next', 'done', 'remaining', 'ok', 'batch', 'reminder']) assert.ok(k in n, k);
    await write('hc.json', { done: ['icons'] });
    const bad = await call(['next', '--state', 'hc.json', '--strict']);
    for (const k of ['problem', 'fix', 'exit']) assert.ok(k in bad, k);
    assert.equal(bad.exit, 2);
    const m = await call(['mark', '--state', 'hc2.json', '--pass', 'spacing']);
    assert.deepEqual(Object.keys(m).sort(), ['done', 'marked', 'next']);
    const p = await call(['plan']);
    assert.deepEqual(Object.keys(p.passes[0]).sort(), ['checks', 'id', 'label', 'n', 'why_here']);
    await exit(() => call([]), 1);
    await exit(() => call(['mark', '--state', 'hc2.json', '--pass', 'motion']), 2);
  });
  it('plan output ids feed mark and next end to end', async () => {
    const { passes } = await call(['plan']);
    let last;
    for (const p of passes) last = await call(['mark', '--state', 'prod.json', '--pass', p.id]);
    assert.equal(last.next, null);
    const r = await call(['next', '--state', 'prod.json']);
    assert.deepEqual(r.done, passes.map(p => p.id));
    assert.equal(r.next, null);
    // the printed next/batch passes are valid plan passes
    const b = await call(['next', '--all-at-once']);
    assert.deepEqual(b.batch, passes);
    assert.deepEqual(b.next, passes[0]);
  });
  it('edge shapes: blank items, duplicate keys, null and array JSON, inherited keys in done', async () => {
    await write('e1.json', { done: ['spacing', ''] });
    const blank = await call(['next', '--state', 'e1.json']);
    assert.equal(blank.ok, false);
    assert.match(blank.problem, /unknown/);
    assert.equal(blank.next.id, 'color');
    await exit(() => call(['mark', '--state', 'e1.json', '--pass', 'color']));
    await write('e2.json', '{"done":["spacing"],"done":[]}');
    assert.equal((await call(['next', '--state', 'e2.json'])).next.id, 'spacing');
    await write('e3.json', '{"done":[],"done":["spacing"]}');
    assert.equal((await call(['next', '--state', 'e3.json'])).next.id, 'color');
    await write('e4.json', 'null');
    await exit(() => call(['next', '--state', 'e4.json']));
    await exit(() => call(['mark', '--state', 'e4.json', '--pass', 'spacing']));
    assert.equal(await fs.readFile(path.join(dir, 'e4.json'), 'utf-8'), 'null');
    await write('e5.json', '[]');
    await exit(() => call(['next', '--state', 'e5.json']));
    await write('e6.json', { done: ['toString', 'constructor', '__proto__'] });
    const inh = await call(['next', '--state', 'e6.json']);
    assert.equal(inh.ok, false);
    assert.match(inh.problem, /unknown pass "toString"/);
    await write('e7.json', { done: ['spacing', null] });
    await exit(() => call(['next', '--state', 'e7.json']));
    await write('e8.json', { done: {} });
    await exit(() => call(['next', '--state', 'e8.json']));
  });
});
