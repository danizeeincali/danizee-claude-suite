import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cssFor, guard, run, verb, usage } from '../src/lib/kit/bg-fill.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';

const base = { selector: '.bg', container: { w: 1000, h: 500 }, image: { w: 400, h: 300 } };
const MAX = 8 * 1024 * 1024;
const stdin = (text) => ({ stdinBytes: async (o) => { stdin.last = o; return Buffer.from(text, 'utf-8'); } });
const rejects1 = async (p) => assert.rejects(p, (e) => e instanceof KitExit && e.code === 1);
const props = (r) => r.violations.map(v => v.property);

describe('bg-fill css', () => {
  it('exports the verb and usage', () => {
    assert.equal(verb, 'bg-fill');
    assert.match(usage, /bg-fill/);
  });
  it('FILL is cover, centred', () => {
    assert.deepEqual(cssFor({ ...base, scale_mode: 'FILL' }).css, { 'background-size': 'cover', 'background-position': '50% 50%', 'background-repeat': 'no-repeat' });
  });
  it('FIT is contain, centred', () => {
    assert.deepEqual(cssFor({ ...base, scale_mode: 'FIT' }).css, { 'background-size': 'contain', 'background-position': '50% 50%', 'background-repeat': 'no-repeat' });
  });
  it('STRETCH is 100% 100%', () => {
    assert.deepEqual(cssFor({ ...base, scale_mode: 'STRETCH' }).css, { 'background-size': '100% 100%', 'background-position': '0 0', 'background-repeat': 'no-repeat' });
  });
  it('TILE uses the image size times tile_scale (default 1)', () => {
    assert.deepEqual(cssFor({ ...base, scale_mode: 'TILE', tile_scale: 0.5 }).css, { 'background-size': '200px 150px', 'background-position': '0 0', 'background-repeat': 'repeat' });
    assert.equal(cssFor({ ...base, scale_mode: 'TILE' }).css['background-size'], '400px 300px');
  });
  it('CROP derives size and offset from the 2x3 transform', () => {
    const r = cssFor({ ...base, scale_mode: 'CROP', transform: [[0.5, 0, 0.1], [0, 0.25, 0.2]] });
    assert.deepEqual(r.css, { 'background-size': '2000px 2000px', 'background-position': '-200px -400px', 'background-repeat': 'no-repeat' });
    const id = cssFor({ ...base, scale_mode: 'CROP', transform: [[1, 0, 0], [0, 1, 0]] });
    assert.equal(id.css['background-position'], '0px 0px');
    assert.equal(id.css['background-size'], '1000px 500px');
  });
  it('raw_css is a ready rule for the selector', () => {
    const r = cssFor({ ...base, scale_mode: 'FILL' });
    assert.equal(r.raw_css, '.bg {\n  background-size: cover;\n  background-position: 50% 50%;\n  background-repeat: no-repeat;\n}\n');
  });
  it('rejects rotated, skewed, flipped or malformed transforms with exit 1', async () => {
    for (const transform of [[[1, 0.2, 0], [0, 1, 0]], [[1, 0, 0], [-0.3, 1, 0]], [[0, 1, 0], [-1, 0, 0]], [[-1, 0, 1], [0, 1, 0]], [[1, 0], [0, 1]], [[1, 0, 0]]]) {
      await rejects1(run(['css'], stdin(JSON.stringify({ ...base, scale_mode: 'CROP', transform }))));
    }
    await rejects1(run(['css'], stdin(JSON.stringify({ ...base, scale_mode: 'CROP' }))));
  });
  it('rejects unknown keys, wrong types and mode-mismatched fields with exit 1', async () => {
    const bads = [
      { ...base, scale_mode: 'FILL', extra: 1 },
      { ...base, scale_mode: 'COVER' },
      { ...base, scale_mode: 'FILL', transform: [[1, 0, 0], [0, 1, 0]] },
      { ...base, scale_mode: 'FILL', tile_scale: 2 },
      { ...base, scale_mode: 'TILE', tile_scale: 0 },
      { ...base, container: { w: 0, h: 5 }, scale_mode: 'FILL' },
      { ...base, image: { w: '4', h: 5 }, scale_mode: 'FILL' },
      { ...base, selector: '', scale_mode: 'FILL' },
      { ...base, selector: '.a { x', scale_mode: 'FILL' },
      [],
    ];
    for (const b of bads) await rejects1(run(['css'], stdin(JSON.stringify(b))));
    await rejects1(run(['css'], stdin('not json')));
  });
});

describe('bg-fill guard', () => {
  const g = (css, sel = '.bg') => guard(css, sel);
  it('passes plain static rules for the background', () => {
    const r = g('.bg { background-image: url(a.jpg); background-size: cover; background-position: 50% 50%; }');
    assert.deepEqual(r, { selector: '.bg', violations: [], pass: true, exit: 0 });
  });
  it('flags a keyframes animating background-position on the selector (exit 2)', () => {
    const css = '@keyframes drift {\n  from { background-position: 0 0; }\n  to { background-position: 100% 0; }\n}\n.bg { animation: drift 10s linear infinite; }';
    const r = g(css);
    assert.equal(r.pass, false);
    assert.equal(r.exit, 2);
    assert.deepEqual(props(r), ['background-position', 'background-position']);
    assert.deepEqual(r.violations.map(v => v.line), [2, 3]);
    assert.match(r.violations[0].why, /drift/);
  });
  it('flags animation-name too, and ignores keyframes the selector does not use', () => {
    assert.equal(g('@keyframes k { to { filter: blur(4px); } }\n.bg { animation-name: k; }').exit, 2);
    assert.equal(g('@keyframes k { to { background-position: 9px 0; } }\n.bg { background-image: url(a.png); }').pass, true);
  });
  it('flags a transition on background-image, shorthand, all and implicit all', () => {
    for (const rule of ['transition: background-image 0.3s ease', 'transition-property: opacity, background-image', 'transition: all 1s', 'transition: 0.4s', 'transition: background-size .2s, opacity 1s']) {
      const r = g(`.bg { ${rule}; }`);
      assert.equal(r.exit, 2, rule);
      assert.match(r.violations[0].property, /^transition/);
    }
    assert.equal(g('.bg { transition: opacity 0.3s ease; }').pass, true);
    assert.equal(g('.bg { transition: none; }').pass, true);
  });
  it('flags a flat colour swap in :hover and in a media rule', () => {
    const h = g('.bg { background-image: url(a.jpg); }\n.bg:hover { background: #000; }');
    assert.equal(h.exit, 2);
    assert.deepEqual(h.violations, [{ line: 2, property: 'background', why: h.violations[0].why }]);
    assert.match(h.violations[0].why, /flat colour/);
    const m = g('.bg { background-image: url(a.jpg); }\n@media (max-width: 600px) {\n  .bg { background: red; }\n}');
    assert.equal(m.exit, 2);
    assert.equal(m.violations[0].line, 3);
    assert.match(m.violations[0].why, /flat colour/);
    assert.equal(g('@media print { .bg { background-image: none; } }').exit, 2);
  });
  it('flags a changed (not flat) background under a state or media rule', () => {
    const r = g('.bg { background-image: url(a.jpg); }\n.card:hover .bg { background-position: 10px 0; }');
    assert.equal(r.exit, 2);
    assert.equal(r.violations[0].property, 'background-position');
    assert.doesNotMatch(r.violations[0].why, /flat colour/);
  });
  it('flags backdrop-filter and filter on the background selector itself', () => {
    const b = g('.bg { background-image: url(a.jpg); backdrop-filter: blur(8px); }');
    assert.equal(b.exit, 2);
    assert.equal(b.violations[0].property, 'backdrop-filter');
    assert.match(b.violations[0].why, /sibling/);
    assert.equal(g('.bg { filter: grayscale(1); }').exit, 2);
    assert.equal(g('.bg { filter: none; }').pass, true);
    assert.equal(g('.panel { backdrop-filter: blur(8px); }').pass, true);
  });
  it('passes when an unrelated selector animates its background', () => {
    const css = '@keyframes pulse { to { background-color: red; background-position: 5px 0; } }\n.btn { animation: pulse 1s; transition: background 0.3s; }\n.btn:hover { background: blue; }\n.bg-two:hover { background: red; }\n.bgx { filter: blur(2px); }';
    assert.equal(g(css).pass, true);
  });
  it('ignores comments and strings and keeps line numbers true', () => {
    const css = '/* .bg:hover { background: #000; } */\n.bg { content: "} .bg:hover { background: red"; background-image: url("a;b{c}.jpg"); }\n/* multi\nline */\n.x::after { content: \'/*\'; }\n.bg:hover { background: url(data:image/png;base64,AAA); filter: sepia(1); }';
    const r = g(css);
    assert.deepEqual(r.violations.map(v => [v.line, v.property]), [[6, 'background'], [6, 'filter']]);
    assert.equal(g('.a { content: "/*"; }\n.bg { background: url(x.jpg); }\n.b { content: "*/"; }').pass, true);
  });
  it('matches selector lists, nested rules and qualified forms', () => {
    assert.equal(g('a, .bg:hover { background: #fff; }').exit, 2);
    assert.equal(g('.x,\n.bg { filter: blur(1px); }').violations[0].line, 2);
    assert.equal(g('.hero { .bg { background-image: url(a.jpg); &:hover { background: black; } } }').exit, 2);
    assert.equal(g('.bg.dark { background: #111; }').exit, 2);
    assert.equal(g('body .bg { background-image: url(a.jpg); }').pass, true);
    assert.equal(g('.bg::before { filter: blur(3px); }').pass, true);
    assert.equal(g('.a { background: red; }', '.a, .bg').pass, true);
    assert.equal(g('.bg { filter: blur(3px); }', '#none, .bg').exit, 2);
  });
  it('is exit 0 or 2, never other; bad selector is exit 1', async () => {
    for (const css of ['', '.bg {', '}}}', '@media', '.bg { background: ', '/* unterminated', '"unterminated']) {
      const r = g(css);
      assert.ok(r.exit === 0 || r.exit === 2);
    }
    await rejects1(run(['guard'], stdin('.bg{}')));
    await rejects1(run(['guard', '--selector', ''], stdin('.bg{}')));
  });
});

describe('bg-fill input reading', () => {
  it('guard happy path through stdinBytes requests MAX+1 bytes', async () => {
    const r = await run(['guard', '--selector', '.bg'], stdin('.bg { filter: blur(1px); }'));
    assert.equal(stdin.last.maxBytes, MAX + 1);
    assert.equal(r.exit, 2);
  });
  it('css happy path through stdinBytes', async () => {
    const r = await run(['css'], stdin(JSON.stringify({ ...base, scale_mode: 'STRETCH' })));
    assert.equal(r.css['background-size'], '100% 100%');
  });
  it('counts the cap in bytes: multibyte text under MAX characters but over MAX bytes is refused', async () => {
    const text = '€'.repeat(Math.ceil((MAX + 1) / 3));
    assert.ok(text.length < MAX);
    assert.ok(Buffer.byteLength(text) > MAX);
    await rejects1(run(['css'], stdin(text)));
    await rejects1(run(['guard', '--selector', '.bg'], stdin(text)));
  });
  it('refuses empty input, empty and repeated flags, unknown flags and subcommands', async () => {
    await rejects1(run(['css'], stdin('   ')));
    await rejects1(run(['css', '--file', ''], stdin('{}')));
    await rejects1(run(['css', '--file', 'a', '--file', 'b'], stdin('{}')));
    await rejects1(run(['guard', '--selector', '.a', '--selector', '.b'], stdin('.a{}')));
    await rejects1(run(['css', '--bogus', 'x'], stdin('{}')));
    await rejects1(run(['nope'], stdin('{}')));
    await rejects1(run([], stdin('{}')));
  });
  describe('--file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgfill-'));
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
    it('reads a regular file and gives the same result as stdin', async () => {
      const f = path.join(dir, 'a.css');
      fs.writeFileSync(f, '.bg:hover { background: red; }');
      const viaFile = await run(['guard', '--file', f, '--selector', '.bg'], { cwd: dir });
      const viaStdin = await run(['guard', '--selector', '.bg'], stdin('.bg:hover { background: red; }'));
      assert.deepEqual(viaFile, viaStdin);
    });
    it('refuses directories, missing files and oversized files', async () => {
      await rejects1(run(['css', '--file', dir], { cwd: dir }));
      await rejects1(run(['css', '--file', path.join(dir, 'missing')], { cwd: dir }));
      const big = path.join(dir, 'big.css');
      const fd = fs.openSync(big, 'w'); fs.ftruncateSync(fd, MAX + 1); fs.closeSync(fd);
      await rejects1(run(['guard', '--file', big, '--selector', '.bg'], { cwd: dir }));
    });
    it('refuses a FIFO', async () => {
      const fifo = path.join(dir, 'p');
      const { spawnSync } = await import('child_process');
      if (spawnSync('mkfifo', [fifo]).status === 0) await rejects1(run(['css', '--file', fifo], { cwd: dir }));
    });
  });
});
