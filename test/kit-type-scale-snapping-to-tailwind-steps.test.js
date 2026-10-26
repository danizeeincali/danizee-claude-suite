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
const ioBytes = (cwd, stdin = '', seen = []) => ({ cwd, stdin: async () => { throw new Error('stdin() must not be used'); }, stdinBytes: async o => { seen.push(o); return Buffer.from(stdin, 'utf-8'); }, stdinIsTTY: false, env: {} });

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

describe('review r1 fixes', () => {
  it('finds inline style font-size in markup', () => {
    const a = auditCss('<p style="font-size:15px">x</p>');
    assert.deepEqual(a.changes.map(c => [c.line, c.from, c.to_step]), [[1, '15px', 'sm']]);
    const b = auditCss("<p style='a:b;font-size:15px'>x</p>");
    assert.deepEqual(b.changes.map(c => c.to_step), ['sm']);
    const c = auditCss('<p style="color:red;font-size:15px">x</p>');
    assert.equal(c.changes.length, 1);
    assert.deepEqual(c.skipped, []);
  });
  it('counts lines in linear time', () => {
    const n = 40000;
    const text = Array.from({ length: n }, () => 'a{font-size:15px}').join('\n');
    const t = Date.now();
    const r = auditCss(text);
    assert.equal(r.changes.length, n);
    assert.equal(r.changes[n - 1].line, n);
    assert.ok(Date.now() - t < 3000, 'audit of 40k declarations must be fast');
  });
  it('line numbers stay right across blank lines and comments', () => {
    const r = auditCss('/* a\nb */\n\n.x{font-size:15px}\n.y{\n font-size: 13px }');
    assert.deepEqual(r.changes.map(c => c.line), [4, 6]);
  });
  it('treats text-[length:15px] as a size', () => {
    const r = auditCss('<i class="text-[length:15px] text-[length:16px] text-[length:var(--s)] text-[#fff]">');
    assert.deepEqual(r.changes.map(c => [c.from, c.to_step]), [['text-[length:15px]', 'sm']]);
    assert.equal(r.on_scale, 1);
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].reason, 'dynamic value');
  });
  it('reads stdin with stdinBytes and a byte cap (happy path)', async () => {
    const seen = [];
    const r = await run(['audit'], ioBytes('/tmp', 'a{font-size:15px}', seen));
    assert.equal(r.changes.length, 1);
    assert.deepEqual(seen, [{ maxBytes: 8 * 1024 * 1024 + 1 }]);
  });
  it('rejects over-cap multibyte stdin counted in bytes', async () => {
    const text = 'é'.repeat(4 * 1024 * 1024 + 1); // 4M+1 chars, 8M+2 bytes
    assert.ok(text.length < 8 * 1024 * 1024);
    await assert.rejects(() => run(['audit'], ioBytes('/tmp', text)), e => e instanceof KitExit && e.code === 1 && /8 MiB/.test(e.message));
  });
  it('--file is read in bytes with the same cap and must be a regular file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-ts-'));
    try {
      await fs.writeFile(path.join(dir, 'big.css'), 'é'.repeat(4 * 1024 * 1024 + 1));
      await assert.rejects(() => run(['audit', '--file', 'big.css'], ioBytes(dir)), e => e instanceof KitExit && e.code === 1);
      await fs.mkdir(path.join(dir, 'd.css'));
      await assert.rejects(() => run(['audit', '--file', 'd.css'], ioBytes(dir)), e => e instanceof KitExit && e.code === 1 && /regular file/.test(e.message));
      await fs.writeFile(path.join(dir, 'ok.css'), 'a{font-size:15px}');
      assert.equal((await run(['audit', '--file', 'ok.css'], ioBytes(dir))).changes.length, 1);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('refuses empty and repeated flags, never falling back to stdin', async () => {
    for (const args of [['audit', '--file', ''], ['snap', '--size', ''], ['audit', '--root-px', ''], ['snap', '--size', '1', '--size', '2'], ['audit', '--file', 'a', '--file', 'b'], ['audit', '--root-px', '16', '--root-px', '16']]) {
      await assert.rejects(() => run(args, ioBytes('/tmp', 'a{font-size:15px}')), e => e instanceof KitExit && e.code === 1, args.join(' '));
    }
  });
});

describe('integration fixes (carried findings)', () => {
  it('one zero or overflowing size is skipped, not fatal to the audit', () => {
    const huge = '9'.repeat(400);
    const r = auditCss(`a{font-size:0.0px}\nb{font-size:0px}\nc{font-size:${huge}px}\nd{font-size:15px}\n<p class="text-[0px] text-[${huge}rem] text-[15px]">`);
    assert.deepEqual(r.changes.map(c => [c.line, c.from, c.to_step]), [[4, '15px', 'sm'], [5, 'text-[15px]', 'sm']]);
    assert.equal(r.skipped.length, 5);
    assert.ok(r.skipped.every(s => /zero|range/.test(s.reason)));
  });
  it('audit at a terminal refuses instead of waiting for stdin', async () => {
    const tty = { cwd: os.tmpdir(), stdinIsTTY: true, env: {}, stdin: () => new Promise(() => {}), stdinBytes: () => new Promise(() => {}) };
    await assert.rejects(run(['audit'], tty), e => e instanceof KitExit && e.code === 1 && /terminal|no input/.test(e.message));
  });
  it('refuses /proc paths even when they are regular files', async () => {
    await assert.rejects(run(['audit', '--file', '/proc/self/status'], io(os.tmpdir())), e => e instanceof KitExit && e.code === 1 && /\/proc/.test(e.message));
  });
  it('scans unclosed openers in linear time (2 MB adversarial inputs)', () => {
    const MB2 = 2 * 1024 * 1024;
    for (const t of ['text-[x'.repeat(MB2 / 7), 'font-size: '.repeat(MB2 / 11), 'font-size:'.repeat(MB2 / 10) + '\n', '/*'.repeat(MB2 / 2)]) {
      const t0 = Date.now();
      auditCss(t);
      assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
    }
  });
});
