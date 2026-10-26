import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { evaluate, ease, check, run, verb, emitModule, PATTERNS } from '../src/lib/kit/keyframes.js';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} not within ${eps} of ${b}`);
const story = (over = {}) => ({
  id: 's1', card: 'a', pattern: 'pulse-highlight', sentence: 'The highlight pulses once.',
  tracks: { glow: [{ t: 0, v: 0 }, { t: 1000, v: 1, ease: 'in-out' }, { t: 2000, v: 0 }] }, ...over,
});
const spec = (stories = [story()], loop_ms = 2000) => ({ loop_ms, stories });
const exit1 = async (p, re) => assert.rejects(p, e => e instanceof KitExit && e.code === 1 && re.test(e.message));

let dir;
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kf-')); });
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
const io = (stdin = '') => ({ cwd: dir, stdinBytes: async () => Buffer.from(stdin), stdin: async () => stdin });
const write = async (name, obj) => { const f = path.join(dir, name); await fs.writeFile(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };

describe('keyframes engine', () => {
  const lin = [{ t: 0, v: 0 }, { t: 100, v: 10 }];
  it('evaluates at and between keyframes (linear)', () => {
    assert.equal(evaluate(lin, 0), 0);
    assert.equal(evaluate(lin, 50), 5);
    assert.equal(evaluate(lin, 100), 10);
    assert.equal(evaluate(lin, 500), 10);
    const three = [{ t: 0, v: 0 }, { t: 100, v: 10 }, { t: 300, v: 30 }];
    assert.equal(evaluate(three, 200), 20);
  });
  it('shapes each ease', () => {
    assert.equal(ease('linear', 0.5), 0.5);
    assert.ok(ease('in', 0.5) < 0.5 && ease('out', 0.5) > 0.5);
    near(ease('in', 0.5) + ease('out', 0.5), 1);
    near(ease('in-out', 0.5), 0.5);
    assert.ok(ease('in-out', 0.25) < 0.25 && ease('in-out', 0.75) > 0.75);
    for (const k of ['in', 'out', 'in-out', [0.1, 0.9, 0.9, 0.1]]) { assert.equal(ease(k, 0), 0); assert.equal(ease(k, 1), 1); }
    assert.equal(evaluate([{ t: 0, v: 0, ease: 'in' }, { t: 100, v: 100 }], 50), ease('in', 0.5) * 100);
  });
  it('cubic-bezier hits a known midpoint', () => {
    near(ease([0.25, 0.1, 0.25, 1], 0.5), 0.8024, 1e-3); // the CSS "ease" curve
    near(ease([0, 0, 1, 1], 0.3), 0.3);
    near(ease([0, 1, 1, 0], 0.5), 0.5);
    near(evaluate([{ t: 0, v: 0, ease: [0.25, 0.1, 0.25, 1] }, { t: 100, v: 10 }], 50), 8.024, 1e-2);
  });
  it('interpolates arrays per component', () => {
    const tr = [{ t: 0, v: [0, 100, -10] }, { t: 100, v: [10, 0, 10] }];
    assert.deepEqual(evaluate(tr, 50), [5, 50, 0]);
    const r = evaluate(tr, 0); r[0] = 99;
    assert.equal(tr[0].v[0], 0, 'returns a copy');
  });
  it('wraps t by the loop length', () => {
    assert.equal(evaluate(lin, 150, 100), evaluate(lin, 50, 100));
    assert.equal(evaluate(lin, -50, 100), evaluate(lin, 50, 100));
    assert.equal(evaluate(lin, 1050, 100), 5);
  });
});

describe('keyframes check', () => {
  const rules = r => r.findings.map(f => f.rule);
  it('passes a clean spec', () => {
    const r = check(spec());
    assert.deepEqual(r, { ok: true, findings: [], warnings: [] });
  });
  it('flags a track not starting at 0', () => {
    const r = check(spec([story({ tracks: { g: [{ t: 100, v: 0 }, { t: 2000, v: 0 }] } })]));
    assert.deepEqual(rules(r), ['track-start']); assert.equal(r.ok, false);
  });
  it('flags a track not ending at loop_ms', () => {
    const r = check(spec([story({ tracks: { g: [{ t: 0, v: 0 }, { t: 1500, v: 0 }] } })]));
    assert.deepEqual(rules(r), ['track-end']);
  });
  it('flags an end value that differs from the start (numbers and arrays)', () => {
    assert.deepEqual(rules(check(spec([story({ tracks: { g: [{ t: 0, v: 0 }, { t: 2000, v: 1 }] } })]))), ['end-differs-from-start']);
    assert.deepEqual(rules(check(spec([story({ tracks: { g: [{ t: 0, v: [1, 2] }, { t: 2000, v: [1, 3] }] } })]))), ['end-differs-from-start']);
    assert.equal(check(spec([story({ tracks: { g: [{ t: 0, v: [1, 2] }, { t: 2000, v: [1, 2] }] } })])).ok, true);
  });
  it('flags non-increasing times', () => {
    const r = check(spec([story({ tracks: { g: [{ t: 0, v: 0 }, { t: 1000, v: 1 }, { t: 1000, v: 2 }, { t: 2000, v: 0 }] } })]));
    assert.deepEqual(rules(r), ['time-not-increasing']);
    assert.match(r.findings[0].message, /keyframe 2/);
    assert.deepEqual(rules(check(spec([story({ tracks: { g: [{ t: 0, v: 0 }, { t: 1500, v: 1 }, { t: 1000, v: 2 }, { t: 2000, v: 0 }] } })]))), ['time-not-increasing']);
  });
  it('makes each extra sentence a finding with ok:false', () => {
    const r = check(spec([story({ sentence: 'It pulses. Then it rests! Does it loop? Yes.' })]));
    assert.deepEqual(rules(r), ['sentence-not-single']);
    assert.match(r.findings[0].message, /4 sentences/);
    assert.equal(r.ok, false);
    assert.equal(check(spec([story({ sentence: 'It grows to 1.5 times its size.' })])).ok, true);
    assert.deepEqual(rules(check(spec([story({ sentence: '  ' })]))), ['sentence-empty']);
  });
  it('warns when stories on different cards share an offset', () => {
    const w = check(spec([story({ id: 'a', card: 'x' }), story({ id: 'b', card: 'y' })])).warnings;
    assert.equal(w.length, 1);
    assert.match(w[0].message, /acts in unison|act in unison/);
    assert.deepEqual(w[0].stories, ['a', 'b']);
    assert.equal(check(spec([story({ id: 'a', card: 'x' }), story({ id: 'b', card: 'y', offset_ms: 300 })])).warnings.length, 0);
    assert.equal(check(spec([story({ id: 'a', card: 'x' }), story({ id: 'b', card: 'x' })])).warnings.length, 0, 'same card is fine');
  });
});

describe('keyframes bad input exits 1 naming the field', () => {
  const cases = [
    ['unknown top key', { ...spec(), extra: 1 }, /unknown key "extra" in input/],
    ['unknown story key', spec([{ ...story(), nope: 1 }]), /unknown key "nope" in stories\[0\]/],
    ['unknown keyframe key', spec([story({ tracks: { g: [{ t: 0, v: 0, q: 1 }, { t: 2000, v: 0 }] } })]), /unknown key "q" in stories\[0\]\.tracks\.g\[0\]/],
    ['loop_ms type', { ...spec(), loop_ms: '2000' }, /input\.loop_ms/],
    ['loop_ms zero', { ...spec(), loop_ms: 0 }, /input\.loop_ms/],
    ['stories type', { loop_ms: 1, stories: {} }, /input\.stories/],
    ['id type', spec([story({ id: 3 })]), /stories\[0\]\.id/],
    ['pattern', spec([story({ pattern: 'spin' })]), /stories\[0\]\.pattern/],
    ['sentence type', spec([story({ sentence: 4 })]), /stories\[0\]\.sentence/],
    ['offset type', spec([story({ offset_ms: 'x' })]), /stories\[0\]\.offset_ms/],
    ['duplicate id', spec([story(), story({ card: 'b' })]), /stories\[1\]\.id/],
    ['t type', spec([story({ tracks: { g: [{ t: '0', v: 0 }] } })]), /tracks\.g\[0\]\.t/],
    ['v type', spec([story({ tracks: { g: [{ t: 0, v: 'a' }] } })]), /tracks\.g\[0\]\.v/],
    ['empty track', spec([story({ tracks: { g: [] } })]), /tracks\.g must be a non-empty/],
    ['mismatched array lengths', spec([story({ tracks: { g: [{ t: 0, v: [1, 2] }, { t: 2000, v: [1, 2, 3] }] } })]), /tracks\.g\[1\]\.v has 3 components/],
    ['number then array', spec([story({ tracks: { g: [{ t: 0, v: 1 }, { t: 2000, v: [1] }] } })]), /tracks\.g\[1\]\.v is an array/],
    ['bad ease name', spec([story({ tracks: { g: [{ t: 0, v: 0, ease: 'bounce' }] } })]), /tracks\.g\[0\]\.ease/],
    ['bezier length', spec([story({ tracks: { g: [{ t: 0, v: 0, ease: [0, 0, 1] }] } })]), /tracks\.g\[0\]\.ease/],
    ['bezier x out of range', spec([story({ tracks: { g: [{ t: 0, v: 0, ease: [1.5, 0, 0.5, 1] }] } })]), /ease x1 and x2/],
    ['bezier NaN', spec([story({ tracks: { g: [{ t: 0, v: 0, ease: [0, 'a', 1, 1] }] } })]), /tracks\.g\[0\]\.ease/],
  ];
  for (const [name, body, re] of cases) it(name, async () => exit1(run(['check'], io(JSON.stringify(body))), re));
  it('refuses invalid JSON, empty input and deep nesting', async () => {
    await exit1(run(['check'], io('{nope')), /not valid JSON/);
    await exit1(run(['check'], io('  ')), /no input/);
    await exit1(run(['check'], io('['.repeat(100) + ']'.repeat(100))), /nested deeper/);
  });
  it('refuses a bad command line', async () => {
    await exit1(run([], io()), /sub-command/);
    await exit1(run(['bogus'], io()), /sub-command/);
    await exit1(run(['check', '--file', ''], io()), /must not be empty/);
    await exit1(run(['check', '--file', 'a', '--file', 'b'], io()), /more than once/);
    await exit1(run(['check', '--nope', 'a'], io()), /unknown flag/);
    await exit1(run(['sample'], io()), /--at/);
    await exit1(run(['sample', '--at', 'soon'], io(JSON.stringify(spec()))), /--at/);
    await exit1(run(['sample', '--at', '1', '--at', '2'], io()), /more than once/);
    await exit1(run(['emit', '--file', 'x'], io()), /unknown flag/);
  });
});

describe('keyframes input reading', () => {
  it('gives the same result from --file and stdin', async () => {
    const body = spec([story({ sentence: 'One. Two.' })]);
    const f = await write('a.json', body);
    assert.deepEqual(await run(['check', '--file', f], io()), await run(['check'], io(JSON.stringify(body))));
    assert.equal(verb, 'keyframes');
  });
  it('strips a BOM and accepts a relative --file against io.cwd', async () => {
    await write('bom.json', '﻿' + JSON.stringify(spec()));
    assert.equal((await run(['check', '--file', 'bom.json'], io())).ok, true);
  });
  it('refuses a directory, a missing file, /dev and /proc paths and a FIFO', async () => {
    await exit1(run(['check', '--file', dir], io()), /not a regular file/);
    await exit1(run(['check', '--file', path.join(dir, 'missing.json')], io()), /cannot open/);
    await exit1(run(['check', '--file', '/dev/stdin'], io()), /refused/);
    await exit1(run(['check', '--file', '/dev/null'], io()), /refused/);
    await exit1(run(['check', '--file', '/proc/self/status'], io()), /refused/);
    const link = path.join(dir, 'devlink');
    await fs.symlink('/dev/zero', link);
    await exit1(run(['check', '--file', link], io()), /refused/);
    const fifo = path.join(dir, 'fifo');
    const { spawnSync } = await import('child_process');
    if (spawnSync('mkfifo', [fifo]).status === 0) await exit1(run(['check', '--file', fifo], io()), /not a regular file/);
  });
  it('counts the stdin cap in bytes, not characters', async () => {
    const text = '€'.repeat(3_000_000); // 3M characters, 9M bytes
    assert.ok(text.length < 8 * 1024 * 1024);
    let asked;
    const over = { cwd: dir, stdinBytes: async o => { asked = o; return Buffer.from(text); } };
    await exit1(run(['check'], over), /larger than/);
    assert.equal(asked.maxBytes, 8 * 1024 * 1024 + 1);
  });
  it('refuses a --file over the cap', async () => {
    const f = path.join(dir, 'big.json');
    await fs.writeFile(f, Buffer.alloc(8 * 1024 * 1024 + 1, 32));
    await exit1(run(['check', '--file', f], io()), /larger than/);
  });
  it('finishes about 2 MB of adversarial input in under 2 seconds', async () => {
    const t0 = Date.now();
    // many stories, each with a many-keyframe track
    const kfs = []; for (let i = 0; i <= 2000; i++) kfs.push({ t: i, v: i === 2000 ? 0 : i % 7 });
    const stories = []; for (let i = 0; i < 40; i++) stories.push(story({ id: 's' + i, card: 'c' + i, offset_ms: i, tracks: { g: kfs } }));
    const big = JSON.stringify({ loop_ms: 2000, stories });
    assert.ok(big.length > 1_000_000);
    check(JSON.parse(big));
    await run(['check'], io(big));
    await run(['sample', '--at', '999'], io(big));
    // a 2 MB sentence of terminators, 2 MB of openers, 2 MB of unclosed strings
    const sentence = '. '.repeat(1_000_000);
    assert.equal(check(spec([story({ sentence })])).findings[0].rule, 'sentence-not-single');
    await exit1(run(['check'], io('['.repeat(2_000_000))), /nested deeper/);
    await exit1(run(['check'], io('{"a":"' + '\\'.repeat(2_000_000))), /./);
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  });
});

describe('keyframes sample, patterns, emit', () => {
  it('sample returns every property at that time, with the offset applied', async () => {
    const body = spec([
      story({ id: 'a', card: 'x', tracks: { glow: [{ t: 0, v: 0 }, { t: 1000, v: 10 }, { t: 2000, v: 0 }], pos: [{ t: 0, v: [0, 0] }, { t: 2000, v: [0, 0] }] } }),
      story({ id: 'b', card: 'y', offset_ms: 500, tracks: { glow: [{ t: 0, v: 0 }, { t: 1000, v: 10 }, { t: 2000, v: 0 }] } }),
    ]);
    const r = await run(['sample', '--at', '500'], io(JSON.stringify(body)));
    assert.deepEqual(Object.keys(r.values.a).sort(), ['glow', 'pos']);
    assert.deepEqual(r.values.a.pos, [0, 0]);
    near(r.values.a.glow, ease('in-out', 0.5) * 0 + evaluate(body.stories[0].tracks.glow, 500));
    near(r.values.b.glow, evaluate(body.stories[1].tracks.glow, 1000));
    assert.equal(r.values.b.glow, 10);
    assert.equal(r.at_ms, 500); assert.equal(r.loop_ms, 2000);
    assert.deepEqual((await run(['sample', '--at', '2500'], io(JSON.stringify(body)))).values.a.glow, evaluate(body.stories[0].tracks.glow, 500));
  });
  it('patterns lists the seven names', async () => {
    const r = await run(['patterns'], io());
    assert.deepEqual(r.patterns.map(p => p.name), ['stack-landing', 'scrubber-glide', 'donut-ease-out', 'typed-prompt', 'marquee-one-set', 'counter-tick', 'pulse-highlight']);
    for (const p of r.patterns) assert.equal(check(spec([story({ pattern: p.name, sentence: p.story })])).findings.length, 0, p.name);
    assert.equal(PATTERNS.length, 7);
  });
  it('emit returns a module that imports cleanly and agrees with evaluate', async () => {
    const { raw } = await run(['emit'], io());
    assert.equal(raw, emitModule());
    const f = path.join(dir, 'engine.mjs');
    await fs.writeFile(f, raw);
    const m = await import(pathToFileURL(f).href);
    assert.deepEqual(Object.keys(m).sort(), ['createLoop', 'ease', 'evaluate']);
    const body = spec([
      story({ id: 'a', card: 'x', tracks: { glow: [{ t: 0, v: 0, ease: 'out' }, { t: 700, v: 10, ease: [0.25, 0.1, 0.25, 1] }, { t: 2000, v: 0 }], pos: [{ t: 0, v: [0, 5], ease: 'in' }, { t: 1000, v: [4, 1] }, { t: 2000, v: [0, 5] }] } }),
      story({ id: 'b', card: 'y', offset_ms: 450, tracks: { glow: [{ t: 0, v: 0 }, { t: 1000, v: 10, ease: 'in-out' }, { t: 2000, v: 0 }] } }),
    ]);
    let clock = 5000;
    const loop = m.createLoop(body.stories, { loop_ms: 2000, now: () => clock, raf: null });
    const seen = [];
    loop.start(v => seen.push(v));
    assert.equal(seen.length, 1);
    for (const ms of [0, 123, 700, 1000, 1999, 2000, 4321]) {
      clock = 5000 + ms;
      const got = loop.read();
      for (const s of body.stories) for (const prop of Object.keys(s.tracks)) {
        assert.deepEqual(got[s.id][prop], evaluate(s.tracks[prop], ms + (s.offset_ms || 0), 2000), `${s.id}.${prop} @${ms}`);
        assert.deepEqual(m.evaluate(s.tracks[prop], ms + (s.offset_ms || 0), 2000), got[s.id][prop]);
      }
      assert.deepEqual(got, (await run(['sample', '--at', String(ms)], io(JSON.stringify(body)))).values);
    }
    loop.stop();
  });
  it('createLoop drives frames through an injected raf and stops', async () => {
    const f = path.join(dir, 'engine2.mjs');
    await fs.writeFile(f, emitModule());
    const m = await import(pathToFileURL(f).href);
    let clock = 0, pending = null, cancelled = null;
    const loop = m.createLoop([{ id: 'a', tracks: { x: [{ t: 0, v: 0 }, { t: 100, v: 10 }] } }], { loop_ms: 100, now: () => clock, raf: cb => { pending = cb; return 7; }, caf: h => { cancelled = h; } });
    const frames = [];
    loop.start(v => frames.push(v.a.x));
    clock = 50; pending();
    clock = 250; pending();
    assert.deepEqual(frames, [0, 5, 5]);
    loop.stop();
    assert.equal(cancelled, 7);
    const n = frames.length; pending && pending(); assert.equal(frames.length, n);
  });
});
