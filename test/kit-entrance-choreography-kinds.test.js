import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { run, plan, normalize, CATALOGUE, KINDS, MAX_BYTES, verb, usage } from '../src/lib/kit/entrance.js';

const g = (id, kind, order, extra = {}) => ({ id, kind, order, ...extra });
const P = (groups, opts) => plan({ groups }, opts);
const byId = (r, id) => r.timeline.find(t => t.id === id);
const io = (text, extra = {}) => ({ cwd: process.cwd(), stdinIsTTY: false, env: {}, stdin: async () => text, stdinBytes: async () => Buffer.from(text), ...extra });
const rejects = (fn, re) => assert.rejects(fn, e => e instanceof KitExit && e.code === 1 && (!re || re.test(e.message)));
const throws1 = (fn, re) => assert.throws(fn, e => e instanceof KitExit && e.code === 1 && (!re || re.test(e.message)));

describe('entrance: catalogue', () => {
  it('exports verb and usage', () => { assert.equal(verb, 'entrance'); assert.match(usage, /entrance/); });
  it('knows exactly the nine kinds', () => assert.deepEqual(KINDS, ['card', 'text', 'icon', 'bar', 'rule', 'photo', 'chip', 'chart', 'other']));
  const exact = {
    card: [{ opacity: 0, y: 16, blur: 8 }, { opacity: 1, y: 0, blur: 0 }],
    text: [{ opacity: 0, y: 6, blur: 2 }, { opacity: 1, y: 0, blur: 0 }],
    icon: [{ opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1 }],
    bar: [{ scaleX: 0 }, { scaleX: 1 }],
    rule: [{ scaleX: 0 }, { scaleX: 1 }],
    photo: [{ opacity: 0, blur: 12 }, { opacity: 1, blur: 0 }],
    chip: [{ opacity: 0, y: 4 }, { opacity: 1, y: 0 }],
    chart: [{ opacity: 0, scaleY: 0 }, { opacity: 1, scaleY: 1 }],
    other: [{ opacity: 0 }, { opacity: 1 }],
  };
  for (const [kind, [from, to]] of Object.entries(exact)) {
    it(`${kind}: from/to exactly`, () => {
      const t = byId(P([g('x', kind, 0)]), 'x');
      assert.deepEqual(t.from, from);
      assert.deepEqual(t.to, to);
      assert.equal(t.kind, kind);
      assert.equal(t.duration_ms, CATALOGUE[kind].duration_ms);
      assert.equal(t.easing, CATALOGUE[kind].easing);
    });
  }
  it('photo shimmers (mid step) before it sharpens', () => {
    const css = P([g('p', 'photo', 0)]).css;
    assert.match(css, /@keyframes ent-p \{[^]*40% \{ opacity: 0\.7; filter: blur\(12px\) \}[^]*100% \{ opacity: 1; filter: blur\(0px\) \}/);
  });
  it('grow kinds start from the start edge', () => {
    assert.match(P([g('b', 'bar', 0)]).css, /\[data-entrance="b"\][^\n]*transform-origin: left center/);
    assert.match(P([g('r', 'rule', 0)]).css, /\[data-entrance="r"\][^\n]*transform-origin: left center/);
  });
  it('never has a scale of 0 except the 1-D grow axis of bar, rule and chart', () => {
    for (const [kind, c] of Object.entries(CATALOGUE)) {
      for (const state of [c.from, c.to, c.mid || {}]) {
        for (const [k, v] of Object.entries(state)) {
          if (!k.startsWith('scale') || v !== 0) continue;
          assert.ok(['bar', 'rule', 'chart'].includes(kind), `${kind}.${k}`);
          assert.equal(k, c.grow, `${kind} zero scale must be its grow axis`);
        }
      }
    }
    for (const kind of ['card', 'text', 'icon', 'chip', 'photo', 'other']) assert.doesNotMatch(P([g('x', kind, 0)]).css, /scale\w*\(0\)/);
  });
});

describe('entrance: timeline', () => {
  it('staggers containers in reading order, ignoring input order', () => {
    const r = P([g('c', 'card', 3), g('a', 'text', 1), g('b', 'card', 2)], { containerStaggerMs: 100 });
    assert.deepEqual(r.timeline.map(t => t.id), ['a', 'b', 'c']);
    assert.deepEqual(r.timeline.map(t => t.delay_ms), [0, 100, 200]);
  });
  it('defaults: 120 ms between containers, 60 ms between items', () => {
    const r = P([g('a', 'card', 0, { items: 3 }), g('b', 'card', 1)]);
    assert.equal(byId(r, 'b').delay_ms, 120);
    assert.deepEqual(byId(r, 'a').item_delays_ms, [0, 60, 120]);
  });
  it('staggers items inside a container on top of the container delay', () => {
    const r = P([g('a', 'card', 0), g('b', 'card', 1, { items: 3 })], { staggerMs: 40, containerStaggerMs: 200 });
    assert.equal(byId(r, 'b').delay_ms, 200);
    assert.deepEqual(byId(r, 'b').item_delays_ms, [200, 240, 280]);
    assert.equal(byId(r, 'b').items, 3);
    assert.equal(byId(r, 'a').item_delays_ms, undefined);
    assert.match(r.css, /\[data-entrance="b"\] > :nth-child\(3\) \{[^}]*animation-delay: 280ms/);
  });
  it('keeps ties in order stable (input order)', () => {
    const r = P([g('z', 'card', 1), g('y', 'card', 1), g('x', 'card', 1), g('w', 'card', 0)]);
    assert.deepEqual(r.timeline.map(t => t.id), ['w', 'z', 'y', 'x']);
  });
  it('covered groups enter after every uncovered group and exit first', () => {
    const r = P([g('under', 'photo', 0, { covered: true }), g('a', 'card', 5), g('b', 'card', 9), g('under2', 'chip', 1, { covered: true })]);
    assert.deepEqual(r.timeline.map(t => t.id), ['a', 'b', 'under', 'under2']);
    const maxUncovered = Math.max(byId(r, 'a').delay_ms, byId(r, 'b').delay_ms);
    for (const id of ['under', 'under2']) assert.ok(byId(r, id).delay_ms > maxUncovered);
    assert.deepEqual(r.exit_order.slice(0, 2), ['under2', 'under']);
    assert.deepEqual([...r.exit_order].sort(), ['a', 'b', 'under', 'under2']);
  });
  it('an empty groups list is valid and yields only the reduced-motion block', () => {
    const r = P([]);
    assert.deepEqual(r.timeline, []);
    assert.deepEqual(r.exit_order, []);
    assert.match(r.css, /prefers-reduced-motion/);
  });
});

describe('entrance: scale and overrides', () => {
  it('refuses an override that sets a zero scale on a non-1-D kind', () => {
    throws1(() => P([g('x', 'card', 0, { override: { from: { scale: 0 } } })]), /override\.from\.scale/);
    throws1(() => P([g('x', 'icon', 0, { override: { from: { scale: 0 } } })]), /scale/);
    throws1(() => P([g('x', 'text', 0, { override: { to: { scaleX: 0 } } })]), /scaleX/);
    throws1(() => P([g('x', 'photo', 0, { override: { from: { scaleY: 0 } } })]), /scaleY/);
  });
  it('refuses a negative scale and a zero uniform scale on a grow kind', () => {
    throws1(() => P([g('x', 'icon', 0, { override: { from: { scale: -1 } } })]));
    throws1(() => P([g('x', 'bar', 0, { override: { from: { scale: 0 } } })]));
    throws1(() => P([g('x', 'bar', 0, { override: { from: { scaleY: 0 } } })]));
    throws1(() => P([g('x', 'chart', 0, { override: { from: { scaleX: 0 } } })]));
  });
  it('accepts the grow axis at 0 and a non-zero override', () => {
    const r = P([g('b', 'bar', 0, { override: { from: { scaleX: 0 } } }), g('i', 'icon', 1, { override: { from: { scale: 0.5 } } })]);
    assert.deepEqual(byId(r, 'b').from, { scaleX: 0 });
    assert.deepEqual(byId(r, 'i').from, { opacity: 0, scale: 0.5 });
  });
  it('merges an override over the catalogue entry', () => {
    const t = byId(P([g('c', 'card', 0, { override: { from: { y: 40 } } })]), 'c');
    assert.deepEqual(t.from, { opacity: 0, y: 40, blur: 8 });
    assert.deepEqual(t.to, { opacity: 1, y: 0, blur: 0 });
  });
  it('refuses bad override shapes', () => {
    throws1(() => P([g('x', 'card', 0, { override: { mid: {} } })]), /unknown key "mid"/);
    throws1(() => P([g('x', 'card', 0, { override: { from: { rotate: 3 } } })]), /unknown key "rotate"/);
    throws1(() => P([g('x', 'card', 0, { override: { from: { opacity: 2 } } })]), /opacity/);
    throws1(() => P([g('x', 'card', 0, { override: { from: { blur: -1 } } })]), /blur/);
    throws1(() => P([g('x', 'card', 0, { override: { from: { y: 'a' } } })]), /finite number/);
    throws1(() => P([g('x', 'card', 0, { override: [] })]), /override/);
  });
});

// Minimal CSS reader: balanced braces outside comments, returns the at-rules found.
function parseCss(css) {
  const s = css.replace(/\/\*[^]*?\*\//g, '');
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth++;
    if (ch === '}') { depth--; assert.ok(depth >= 0, 'closing brace without opener'); }
  }
  assert.equal(depth, 0, 'braces balance');
  const keyframes = [...s.matchAll(/@keyframes ([\w-]+) \{([^]*?)\n\}/g)].map(m => ({ name: m[1], body: m[2] }));
  return { s, keyframes };
}

describe('entrance: css', () => {
  const all = KINDS.map((k, i) => g(`g-${k}`, k, i, i % 2 ? { items: 2 } : {}));
  it('is balanced, with one keyframes block per group that has 0% and 100%', () => {
    const { s, keyframes } = parseCss(P(all).css);
    assert.equal(keyframes.length, all.length);
    for (const k of keyframes) {
      assert.match(k.body, /0% \{[^}]+\}/);
      assert.match(k.body, /100% \{[^}]+\}/);
      assert.match(s, new RegExp(`animation: ${k.name} \\d+ms`));
    }
  });
  it('ends with a prefers-reduced-motion block that removes motion', () => {
    const css = P(all).css;
    const i = css.indexOf('@media (prefers-reduced-motion: reduce)');
    assert.ok(i > 0);
    const block = css.slice(i);
    assert.match(block, /animation: none/);
    assert.match(block, /transform: none/);
    assert.match(block, /filter: none/);
    assert.match(block, /opacity: 1/);
    assert.equal(css.indexOf('@media', i + 1), -1, 'the reduced-motion block is last');
    parseCss(css);
  });
  it('is balanced for a thousand groups', () => {
    const many = Array.from({ length: 1000 }, (_, i) => g(`n${i}`, KINDS[i % 9], i, { items: 3 }));
    parseCss(P(many).css);
  });
});

describe('entrance: validation (exit 1)', () => {
  it('unknown kind', () => throws1(() => P([g('x', 'banner', 0)]), /groups\[0\]\.kind/));
  it('inherited property names are not kinds', () => throws1(() => P([g('x', 'constructor', 0)]), /kind/));
  it('duplicate ids', () => throws1(() => P([g('x', 'card', 0), g('x', 'text', 1)]), /duplicate/));
  it('unsafe or missing ids', () => {
    throws1(() => P([g('a b', 'card', 0)]), /id/);
    throws1(() => P([g('a"]{', 'card', 0)]), /id/);
    throws1(() => P([{ kind: 'card', order: 0 }]), /id/);
  });
  it('unknown keys, wrong types', () => {
    throws1(() => normalize({ groups: [], extra: 1 }), /unknown key "extra"/);
    throws1(() => normalize({ groups: [{ ...g('x', 'card', 0), color: 'red' }] }), /unknown key "color"/);
    throws1(() => normalize({}), /groups/);
    throws1(() => normalize([]), /object/);
    throws1(() => P([g('x', 'card', '1')]), /order/);
    throws1(() => P([g('x', 'card', 0, { covered: 'yes' })]), /covered/);
    throws1(() => P([g('x', 'card', 0, { items: -1 })]), /items/);
    throws1(() => P([g('x', 'card', 0, { items: 1.5 })]), /items/);
    throws1(() => P([g('x', 'card', 0, { items: 100000 })]), /items/);
  });
  it('negative or non-numeric stagger', async () => {
    const body = JSON.stringify({ groups: [g('x', 'card', 0)] });
    await rejects(() => run(['--stagger-ms', '-5'], io(body)), /negative/);
    await rejects(() => run(['--container-stagger-ms', '-1'], io(body)), /negative/);
    await rejects(() => run(['--stagger-ms', 'fast'], io(body)), /number/);
  });
});

describe('entrance: run input', () => {
  const body = JSON.stringify({ groups: [g('a', 'card', 1), g('b', 'text', 0)] });
  it('happy path through stdinBytes, honouring the flags', async () => {
    let seen;
    const r = await run(['--container-stagger-ms', '50'], io(body, { stdinBytes: async o => { seen = o; return Buffer.from(body); } }));
    assert.deepEqual(r.timeline.map(t => [t.id, t.delay_ms]), [['b', 0], ['a', 50]]);
    assert.equal(seen.maxBytes, MAX_BYTES + 1);
  });
  it('input method does not change the result', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'entrance-'));
    try {
      await fs.writeFile(path.join(dir, 'g.json'), body);
      assert.deepEqual(await run(['--file', 'g.json'], io('', { cwd: dir })), await run([], io(body)));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('strips a BOM', async () => assert.equal((await run([], io('﻿' + body))).timeline.length, 2));
  it('counts the stdin cap in bytes: multibyte text under the character cap but over the byte cap is refused', async () => {
    // 3 bytes per char: 3,000,000 chars is 9,000,000 bytes, over the 8 MiB cap, though under it in characters.
    const big = '€'.repeat(3_000_000);
    assert.ok(big.length < MAX_BYTES && Buffer.byteLength(big) > MAX_BYTES);
    await rejects(() => run([], io('', { stdinBytes: async () => Buffer.from(big) })), /larger than/);
  });
  it('accepts stdin of exactly the cap in bytes', async () => {
    const head = JSON.stringify({ groups: [g('a', 'card', 0)] });
    const buf = Buffer.concat([Buffer.from(head), Buffer.alloc(MAX_BYTES - Buffer.byteLength(head), 32)]);
    assert.equal(buf.length, MAX_BYTES);
    assert.equal((await run([], io('', { stdinBytes: async () => buf }))).timeline.length, 1);
  });
  it('empty or whitespace input, bad JSON, TTY without input', async () => {
    await rejects(() => run([], io('  \n')), /no input/);
    await rejects(() => run([], io('{nope')), /valid JSON/);
    await rejects(() => run([], io('', { stdinIsTTY: true })), /no input/);
  });
  it('refuses an empty flag value, a repeated flag, unknown flags and stray arguments', async () => {
    await rejects(() => run(['--file', ''], io(body)), /empty/);
    await rejects(() => run(['--stagger-ms', ''], io(body)), /empty/);
    await rejects(() => run(['--stagger-ms', '5', '--stagger-ms', '6'], io(body)), /more than once/);
    await rejects(() => run(['--file', 'a', '--file', 'b'], io(body)), /more than once/);
    await rejects(() => run(['--file'], io(body)), /needs a value/);
    await rejects(() => run(['--bogus', '1'], io(body)), /unknown flag/);
    await rejects(() => run(['stray'], io(body)), /unexpected argument/);
  });
  it('--file must be a regular file and within the cap', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'entrance-'));
    try {
      await rejects(() => run(['--file', dir], io('', { cwd: dir })), /regular file/);
      await rejects(() => run(['--file', 'missing.json'], io('', { cwd: dir })), /cannot read/);
      await rejects(() => run(['--file', '/dev/null'], io('', { cwd: dir })), /regular file/);
      const f = path.join(dir, 'big.json');
      await fs.writeFile(f, Buffer.alloc(MAX_BYTES + 1, 32));
      await rejects(() => run(['--file', 'big.json'], io('', { cwd: dir })), /larger than/);
      await fs.writeFile(f, '');
      await rejects(() => run(['--file', 'big.json'], io('', { cwd: dir })), /no input/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('--file refuses /dev/stdin and /proc paths even when stdin is a regular file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'entrance-'));
    try {
      const inp = path.join(dir, 'in.json');
      await fs.writeFile(inp, JSON.stringify({ groups: [{ id: 'a', kind: 'card', order: 0 }] }));
      const mod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/kit/entrance.js');
      const handle = await fs.open(inp, 'r');
      const fd = handle.fd;
      await fs.symlink('/proc/self/fd/0', path.join(dir, 'link.json'));
      for (const target of ['/dev/stdin', '/proc/self/fd/0', path.join(dir, 'link.json')]) {
        const script = `import(${JSON.stringify(mod)}).then(m => m.run(['--file', ${JSON.stringify(target)}], { cwd: '/', stdinIsTTY: false }))` +
          '.then(() => process.exit(0), e => { console.error(e.message); process.exit(e.code === 1 ? 1 : 9); });';
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf-8', timeout: 10000 });
        assert.equal(r.status, 1, `${target}: ${r.status} ${r.stderr}`);
        assert.match(r.stderr, /regular file/);
      }
      await handle.close();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('--file refuses a FIFO without hanging', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'entrance-'));
    try {
      const fifo = path.join(dir, 'p.json');
      assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
      await rejects(() => run(['--file', 'p.json'], io('', { cwd: dir })), /regular file/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('--file decides the size from the bytes read, not from st.size', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'entrance-'));
    const h0 = await fs.open(import.meta.filename, 'r');
    const proto = Object.getPrototypeOf(h0);
    await h0.close();
    const orig = proto.stat, origPathStat = fs.stat;
    const lie = st => new Proxy(st, { get: (t, k) => k === 'size' ? 5 : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
    try {
      const body = JSON.stringify({ groups: [{ id: 'a', kind: 'card', order: 0 }] });
      await fs.writeFile(path.join(dir, 'g.json'), body);
      proto.stat = async function (...a) { return lie(await orig.apply(this, a)); };
      fs.stat = async (...a) => lie(await origPathStat(...a));
      const r = await run(['--file', 'g.json'], io('', { cwd: dir }));
      assert.equal(r.timeline[0].id, 'a');
      const f = path.join(dir, 'big.json');
      await fs.writeFile(f, Buffer.alloc(MAX_BYTES + 1, 32));
      await rejects(() => run(['--file', 'big.json'], io('', { cwd: dir })), /larger than/);
    } finally { proto.stat = orig; fs.stat = origPathStat; await fs.rm(dir, { recursive: true, force: true }); }
  });

describe('entrance integration fixes (group D)', () => {
  it('an override cannot end a grow kind at scale 0; the 0 is allowed only in override.from', () => {
    throws1(() => P([g('b', 'bar', 0, { override: { to: { scaleX: 0 } } })]), /override\.to\.scaleX/);
    throws1(() => P([g('c', 'chart', 0, { override: { to: { scaleY: 0 } } })]), /override\.to\.scaleY/);
    assert.ok(P([g('b', 'bar', 0, { override: { from: { scaleX: 0 } } })]));
  });
});
});
