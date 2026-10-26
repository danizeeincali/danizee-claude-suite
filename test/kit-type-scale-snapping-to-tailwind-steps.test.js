import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as ts from '../src/lib/kit/type-scale.js';

const { SCALE, snap, parseSize, auditCss, run } = ts;
const exit = fn => assert.throws(fn, e => e instanceof KitExit && e.code === 1);
const io = (cwd, stdin = '') => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });

describe('scale data', () => {
  it('is the Tailwind default scale', () => {
    assert.deepEqual(SCALE.map(s => s.step), ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl']);
    assert.deepEqual(SCALE.find(s => s.step === '3xl'), { step: '3xl', size_px: 30, line_height_px: 36 });
  });
});

describe('snap', () => {
  it('keeps exact steps', () => {
    for (const s of SCALE) assert.deepEqual(snap(s.size_px), { step: s.step, size_px: s.size_px, line_height_px: s.line_height_px, changed: false });
  });
  it('snaps between steps down', () => {
    assert.deepEqual(snap(15), { step: 'sm', size_px: 14, line_height_px: 20, changed: true });
    assert.equal(snap(29.9).step, '2xl');
    assert.equal(snap(47).step, '4xl');
    assert.equal(snap(100).step, '8xl');
  });
  it('below xs goes to xs, above 9xl to 9xl', () => {
    assert.equal(snap(8).step, 'xs');
    assert.equal(snap(8).changed, true);
    assert.equal(snap(500).step, '9xl');
  });
  it('converts rem with a root', () => {
    assert.equal(snap('1.25rem').step, 'xl');
    assert.equal(snap('1.25rem').changed, false);
    assert.equal(snap('1rem', { rootPx: 20 }).size_px, 20);
    assert.equal(snap('1rem', { rootPx: 20 }).step, 'xl');
    assert.equal(snap('15px').step, 'sm');
  });
  it('rejects bad input', () => {
    for (const v of ['', 'abc', '-4', '0', '12em', 'NaN', undefined, null, {}, Infinity]) exit(() => snap(v));
    exit(() => snap(16, { rootPx: 0 }));
    exit(() => snap(16, { rootPx: 'x' }));
  });
  it('parseSize', () => {
    assert.equal(parseSize('0.5rem'), 8);
    assert.equal(parseSize(' 12.5PX '), 12.5);
  });
});

describe('auditCss', () => {
  const css = [
    '/* font-size: 99px; */',            // 1 comment
    '.a { font-size: 15px; }',           // 2 off
    '.b { font-size: 1rem }',            // 3 on
    '.c { font-size: var(--x); }',       // 4 skip
    '.d { font-size: calc(1rem + 2px); }', // 5 skip
    '.e { font-size: 120%; }',           // 6 skip
    '/* multi',                          // 7
    'font-size: 77px */',                // 8
    '.f {',                              // 9
    '  font-size: 0.8rem !important;',   // 10 12.8 -> xs
    '}',
    '.g { font-size: 2.1rem; }',         // 12 33.6 -> 3xl
  ].join('\n');
  it('reports changes with lines, counts on-scale, skips dynamic values', () => {
    const r = auditCss(css);
    assert.deepEqual(r.changes.map(c => [c.line, c.from, c.to_step, c.size_px, c.line_height_px]), [
      [2, '15px', 'sm', 14, 20],
      [10, '0.8rem', 'xs', 12, 16],
      [12, '2.1rem', '3xl', 30, 36],
    ]);
    assert.equal(r.on_scale, 1);
    assert.deepEqual(r.skipped.map(s => s.line), [4, 5, 6]);
    assert.ok(r.skipped.every(s => s.value && s.reason));
  });
  it('honours --root-px', () => {
    const r = auditCss('a{font-size:1rem}', { rootPx: 10 });
    assert.equal(r.changes[0].to_step, 'xs');
  });
  it('reports Tailwind arbitrary classes with their line', () => {
    const r = auditCss('<div class="p-2 text-[15px] md:text-[1.5rem] hover:text-[13px]">\n<p class="text-[20px] text-lg text-[var(--x)]"></p>');
    assert.deepEqual(r.changes.map(c => [c.line, c.from, c.to_step]), [[1, 'text-[15px]', 'sm'], [1, 'text-[13px]', 'xs']]);
    assert.equal(r.on_scale, 2);
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].line, 2);
  });
  it('rejects non-string input', () => { exit(() => auditCss(5)); });
});

describe('run', () => {
  it('snap prints the object; audit reads a file or stdin; bad input exits 1', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-ts-'));
    try {
      assert.equal((await run(['snap', '--size', '15'], io(dir))).step, 'sm');
      assert.equal((await run(['snap', '--size', '1rem', '--root-px', '20'], io(dir))).size_px, 20);
      await fs.writeFile(path.join(dir, 'a.css'), 'a{font-size:15px}');
      const a = await run(['audit', '--file', 'a.css'], io(dir));
      assert.equal(a.changes[0].line, 1);
      assert.equal((await run(['audit'], io(dir, 'a{font-size:16px}'))).on_scale, 1);
      for (const args of [[], ['nope'], ['snap'], ['snap', '--size'], ['snap', '--size', 'x'], ['snap', '--size', '1', '--bogus', '2'], ['audit', '--file', 'missing.css'], ['audit', '--size', '1'], ['snap', '--size', '1', '--root-px', '-1']]) {
        await assert.rejects(() => run(args, io(dir)), e => e instanceof KitExit && e.code === 1, args.join(' '));
      }
      await assert.rejects(() => run(['audit'], io(dir, '')), e => e instanceof KitExit && e.code === 1);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
