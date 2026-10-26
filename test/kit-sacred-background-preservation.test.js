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
    assert.equal(g('.bg { background: url(a.jpg); }\n'+'.panel { backdrop-filter: blur(8px); }').pass, true);
  });
  it('passes when an unrelated selector animates its background', () => {
    const css = '.bg { background: url(a.jpg); }\n@keyframes pulse { to { background-color: red; background-position: 5px 0; } }\n.btn { animation: pulse 1s; transition: background 0.3s; }\n.btn:hover { background: blue; }\n.bg-two:hover { background: red; }\n.bgx { filter: blur(2px); }';
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
    assert.equal(g('.bg { background: url(a.jpg); }\n'+'.bg::before { filter: blur(3px); }').pass, true);
    assert.equal(g('.a { background: red; }', '.a, .bg').pass, true);
    assert.equal(g('.bg { filter: blur(3px); }', '#none, .bg').exit, 2);
  });
  it('is exit 0 or 2, never other; bad selector is exit 1', async () => {
    for (const css of ['', '.bg {', '}}}', '@media', '.bg { background: ', '/* unterminated', '"unterminated']) {
      let r;
      try { r = g(css); } catch (e) { assert.ok(e instanceof KitExit && e.code === 1 && /no rule selects/.test(e.message), css); continue; }
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

describe('bg-fill guard — review r1', () => {
  const g = (css, sel = '.bg') => guard(css, sel);
  it('flags a flat colour or changed background in an ancestor-qualified or repeated rule', () => {
    for (const css of [
      '.bg { background: url(a.jpg); }\n.dark .bg { background: #000; }',
      '.bg { background: url(a.jpg); }\nbody.dark .bg { background: #000; }',
      '.bg { background: url(a.jpg); }\n#app .bg { background-image: none; }',
      '.bg { background: url(a.jpg); }\n.bg { background: none; }',
      '.bg { background: url(a.jpg); }\n.bg { background: #000; }',
    ]) {
      const r = g(css);
      assert.equal(r.exit, 2, css);
      assert.equal(r.violations[0].line, 2, css);
      assert.match(r.violations[0].why, /flat colour/, css);
    }
    const ch = g('.bg { background-image: url(a.jpg); background-position: 0 0; }\n.theme-x .bg { background-position: 50% 0; }\n.bg { background-image: url(b.jpg); }');
    assert.equal(ch.exit, 2);
    assert.deepEqual(ch.violations.map(v => [v.line, v.property]), [[2, 'background-position'], [3, 'background-image']]);
    const before = g('.dark .bg { background: #000; }\n.bg { background: url(a.jpg); }');
    assert.equal(before.exit, 2);
    assert.equal(before.violations[0].line, 1);
    // restating the same design, or splitting it over two plain rules, is not a change
    assert.equal(g('.bg { background-image: url(a.jpg); }\n.bg { background-image: url(a.jpg); background-size: cover; }').pass, true);
    assert.equal(g('body .bg { background-image: url(a.jpg); background-size: cover; }').pass, true);
  });
  it('flags vendor-prefixed backdrop-filter, filter, transitions and keyframes', () => {
    for (const css of [
      '.bg { -webkit-backdrop-filter: blur(8px); }',
      '.bg { -webkit-filter: blur(8px); }',
      '.bg { transition: -webkit-filter 1s; }',
      '.bg { transition-property: -webkit-backdrop-filter; }',
      '@keyframes k { to { -webkit-filter: blur(2px); } }\n.bg { animation: k 1s; }',
      '@-webkit-keyframes k { to { -webkit-backdrop-filter: blur(2px); } }\n.bg { -webkit-animation: k 1s; }',
      '.bg { background: url(a.jpg); }\n.bg:hover { -webkit-background-size: 10px; }',
    ]) assert.equal(g(css).exit, 2, css);
    assert.equal(g('.bg { -webkit-backdrop-filter: blur(8px); }').violations[0].property, '-webkit-backdrop-filter');
    assert.match(g('.bg { -webkit-backdrop-filter: blur(8px); }').violations[0].why, /sibling/);
    assert.equal(g('.bg { -webkit-filter: none; -webkit-transition: opacity 1s; }').pass, true);
  });
  it('matches a target with an ancestor on compound boundaries', () => {
    const t = '.page .hero';
    assert.equal(g('.hero:hover { background: none; }', t).exit, 2);
    assert.equal(g('.page > .hero:hover { background: none; }', t).exit, 2);
    assert.equal(g('body .page .hero:focus { background-position: 1px 0; }', t).exit, 2);
    assert.equal(g('div.page .hero:hover { background: none; }', t).exit, 2);
    assert.throws(() => g('.subpage .hero:hover { background: none; }', 'page .hero'), (e) => e instanceof KitExit && e.code === 1 && /no rule selects/.test(e.message));
    assert.throws(() => g('.other .hero:hover { background: none; }', t), (e) => e instanceof KitExit && e.code === 1 && /no rule selects/.test(e.message));
    assert.equal(g('.page .hero { background: url(a.jpg); }', t).pass, true);
  });
  it('matches quoted @keyframes names and animation names', () => {
    for (const css of [
      '@keyframes "pan" { to { background-position: 9px 0; } }\n.bg { animation: "pan" 3s; }',
      '@keyframes pan { to { background-position: 9px 0; } }\n.bg { animation-name: \'pan\'; }',
      '@keyframes "pan" { to { background-position: 9px 0; } }\n.bg { animation: pan 3s; }',
    ]) {
      const r = g(css);
      assert.equal(r.exit, 2, css);
      assert.equal(r.violations[0].property, 'background-position');
      assert.match(r.violations[0].why, /@keyframes pan\b/);
    }
    assert.equal(g('@keyframes "pan" { to { background-position: 9px 0; } }\n.bg { animation: "other" 3s; }').pass, true);
  });
  it('refuses nesting deeper than the cap with exit 1', () => {
    assert.throws(() => g('a{'.repeat(300)), (e) => e instanceof KitExit && e.code === 1 && /nest/.test(e.message));
    assert.ok([0, 2].includes(g('a{'.repeat(200) + '.bg{filter:blur(1px)}' + '}'.repeat(200)).exit));
  });
  it('reports each keyframes declaration once however many rules use it', () => {
    const css = '@keyframes k { to { background-position: 1px 0; } }\n' + '.bg { animation: k 1s; }\n'.repeat(50);
    assert.deepEqual(g(css).violations.map(v => v.line), [1]);
  });
});

describe('bg-fill guard — timing on about 2 MB of adversarial input', () => {
  const N = 2 * 1024 * 1024;
  const within2s = (name, css, sel = '.bg') => {
    assert.ok(css.length >= N * 0.9, `${name} input is ${css.length} chars`);
    const t0 = process.hrtime.bigint();
    let exit;
    try { exit = guard(css, sel).exit; } catch (e) { assert.ok(e instanceof KitExit && e.code === 1, `${name}: ${e}`); exit = 1; }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok([0, 1, 2].includes(exit), name);
    assert.ok(ms < 2000, `${name} took ${ms.toFixed(0)} ms`);
  };
  it('deeply nested or unclosed braces', () => {
    within2s('a{', 'a{'.repeat(N / 2));
    within2s('a{} nested 200', ('a{'.repeat(200) + '}'.repeat(200)).repeat(Math.ceil(N / 600)));
    within2s('a{b:c; nested 200', ('a,b{b:c;'.repeat(200) + '}'.repeat(200)).repeat(Math.ceil(N / 1800)));
    within2s('.bg{ nested 200', ('.bg:hover{background:none;'.repeat(200) + '}'.repeat(200)).repeat(Math.ceil(N / 5400)));
  });
  it('repeated animation and keyframes', () => {
    const frames = Array.from({ length: 30000 }, (_, i) => `${i % 100}%{background-position:${i}px 0}`).join('');
    within2s('anim x frames', '.bg{animation:k}\n'.repeat(30000) + `@keyframes k{${frames}}` + '.bg{animation:k}'.repeat(Math.ceil((N - 1500000) / 16)));
    within2s('many keyframes', '@keyframes k{to{filter:blur(1px)}}'.repeat(N / 34) + '.bg{animation:k}');
  });
  it('transition and transition-property values with many spaces', () => {
    within2s('transition spaces', '.bg{background:url(a.jpg)} .bg{transition:' + 'a '.repeat(N / 2) + '}');
    within2s('transition-property spaces', '.bg{background:url(a.jpg)} .bg{transition-property:' + 'a '.repeat(N / 2) + '}');
  });
  it('unclosed url( and quotes', () => {
    within2s('url(', '.bg{background:url(a '.repeat(N / 22));
    within2s('quotes', '.bg{content:"a\n'.repeat(N / 16));
    within2s('comments', '.bg{/*'.repeat(N / 6));
  });
});

describe('bg-fill --file is checked on the open handle', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgfill-fh-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  it('refuses paths under /proc and /dev even when they look like regular files', async () => {
    assert.ok(fs.statSync('/proc/self/status').isFile());
    await rejects1(run(['guard', '--file', '/proc/self/status', '--selector', '.bg'], { cwd: dir }));
    await rejects1(run(['guard', '--file', '/dev/null', '--selector', '.bg'], { cwd: dir }));
    const link = path.join(dir, 'proc-link');
    fs.symlinkSync('/proc/self/status', link);
    await rejects1(run(['guard', '--file', link, '--selector', '.bg'], { cwd: dir }));
  });
  it('does not stat the path and then reopen it: a swap to a FIFO after the check cannot block or slip through', { timeout: 10000 }, async () => {
    const { spawnSync } = await import('child_process');
    const fsp = (await import('fs/promises')).default;
    const f = path.join(dir, 'swap.css');
    fs.writeFileSync(f, '.bg { filter: blur(1px); }');
    const realStat = fsp.stat;
    let unblock;
    fsp.stat = async (p, ...rest) => {
      const st = await realStat.call(fsp, p, ...rest);
      if (path.resolve(String(p)) === f) {
        fs.rmSync(f);
        if (spawnSync('mkfifo', [f]).status === 0) unblock = setTimeout(() => { try { fs.closeSync(fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)); } catch {} }, 1500);
      }
      return st;
    };
    try {
      const r = await run(['guard', '--file', f, '--selector', '.bg'], { cwd: dir });
      assert.equal(r.exit, 2);
      assert.equal(r.violations[0].property, 'filter');
    } finally { fsp.stat = realStat; clearTimeout(unblock); }
  });
});

describe('bg-fill — review r2 fixes', () => {
  const exit1 = (re) => (e) => e instanceof KitExit && e.code === 1 && re.test(e.message);
  it('accepts a child combinator and a backslash escape in --selector, in guard and css', async () => {
    const r = guard('.page > .hero { background: url(a.jpg); }\n.page > .hero:hover { background: #000; }', '.page > .hero');
    assert.equal(r.exit, 2);
    const e = guard('.md\\:bg { background: url(a.jpg); }\n.md\\:bg:hover { background: #000; }', '.md\\:bg');
    assert.equal(e.exit, 2);
    assert.equal(guard('.md\\:bg { background: url(a.jpg); }', '.md\\:bg').pass, true);
    assert.match(cssFor({ ...base, selector: '.page > .hero', scale_mode: 'FILL' }).raw_css, /^\.page > \.hero \{/);
    assert.match(cssFor({ ...base, selector: '.md\\:bg', scale_mode: 'FILL' }).raw_css, /^\.md\\:bg \{/);
    const cli = await run(['guard', '--selector', '.page > .hero'], stdin('.page > .hero { filter: blur(1px); }'));
    assert.equal(cli.exit, 2);
    for (const bad of ['.a { x', '.a}', '.a<b', '.a;b', '.a\nb']) assert.throws(() => guard('.a{}', bad), exit1(/cannot appear/));
  });
  it('guard exits 1 when no rule selects the target (typo or malformed selector)', async () => {
    const css = '.bg { background: url(a.jpg); }\n.bg:hover { background: #000; }';
    assert.throws(() => guard(css, '.bgg'), exit1(/no rule selects \.bgg/));
    assert.throws(() => guard(css, '.bg >'), exit1(/no rule selects/));
    await rejects1(run(['guard', '--selector', '.bgg'], stdin(css)));
    assert.equal(guard(css, '.bg').exit, 2);
  });
  it('refuses comment markers in a selector so raw_css cannot become a comment', () => {
    assert.throws(() => cssFor({ ...base, selector: '.bg /*', scale_mode: 'FILL' }), exit1(/comment/));
    assert.throws(() => cssFor({ ...base, selector: '.bg */', scale_mode: 'FILL' }), exit1(/comment/));
    assert.throws(() => guard('.bg{}', '.bg /*'), exit1(/comment/));
    assert.ok(cssFor({ ...base, selector: '.a /x', scale_mode: 'FILL' }).raw_css.startsWith('.a /x {'));
  });
  it('css refuses a non-finite or exponent length with exit 1 naming the field', () => {
    assert.throws(() => cssFor({ ...base, scale_mode: 'TILE', image: { w: 1e300, h: 1 }, tile_scale: 1e10 }), exit1(/image\.w \* tile_scale/));
    assert.throws(() => cssFor({ ...base, scale_mode: 'CROP', container: { w: 1e30, h: 5 }, transform: [[1, 0, 0], [0, 1, 0]] }), exit1(/container\.w/));
    assert.throws(() => cssFor({ ...base, scale_mode: 'CROP', transform: [[1e-8, 0, 1e12], [0, 1, 0]] }), exit1(/out of range/));
    assert.equal(cssFor({ ...base, scale_mode: 'TILE', tile_scale: 2 }).css['background-size'], '800px 600px');
  });
  it('sees background swaps behind :is() and :where() wrappers', () => {
    const img = '.bg { background: url(a.jpg); }\n';
    for (const sel of [':is(.bg):hover', ':where(.bg):hover', ':is(.x, .bg):focus', '.page :is(.bg):hover', ':is(:where(.bg)):hover']) {
      const r = guard(img + sel + ' { background: #000; }', sel.startsWith('.page') ? '.page .bg' : '.bg');
      assert.equal(r.exit, 2, sel);
    }
    assert.equal(guard(img + ':is(.x, .y):hover { background: #000; }', '.bg').pass, true);
    assert.equal(guard(img + ':is(.bg) { background: url(a.jpg); }', '.bg').pass, true);
  });
});

describe('bg-fill — review r3 fixes (fail-closed guard)', () => {
  const g = (css, sel = '.bg') => guard(css, sel);
  it('flags a later plain longhand the design did not set, or set only through its shorthand', () => {
    for (const css of [
      '.bg{background:url(a.jpg) center/cover}\n.bg{background-image:url(b.jpg)}',
      '.bg{background:url(a.jpg) center/cover}\n.bg{background-size:200% 200%}',
      '.bg{background-image:url(a.jpg)}\n.bg{background-size:10px}',
      '.bg{background:url(a.jpg)}\n.bg{-webkit-background-size:10px}',
    ]) {
      const r = g(css);
      assert.equal(r.exit, 2, css);
      assert.equal(r.pass, false, css);
      assert.equal(r.violations[0].line, 2, css);
      assert.match(r.violations[0].why, /later rule/, css);
    }
  });
  it('flags the IE star and underscore hacks', () => {
    for (const [css, prop] of [
      ['.bg{background:url(a.jpg)}\n.bg{*background:none}', '*background'],
      ['.bg{background:url(a.jpg)}\n.bg{_background:#000}', '_background'],
      ['.bg{background:url(a.jpg)}\n.bg:hover{*background-image:none}', '*background-image'],
    ]) {
      const r = g(css);
      assert.equal(r.exit, 2, css);
      assert.deepEqual(r.violations.map(v => [v.line, v.property]), [[2, prop]], css);
      assert.match(r.violations[0].why, /flat colour/, css);
    }
  });
  it('takes the first rule that carries an image as the design, so a fallback colour first passes', () => {
    assert.deepEqual(g('.bg{background:#333}\n.bg{background:#333 url(a.jpg) center/cover}'), { selector: '.bg', violations: [], pass: true, exit: 0 });
    const r = g('.bg{background:#333}\n.bg{background:#333 url(a.jpg) center/cover}\n.bg{background:#333}');
    assert.equal(r.exit, 2);
    assert.deepEqual(r.violations.map(v => v.line), [3]);
  });
  it('counts CR, CRLF and form feed as line breaks', () => {
    for (const nl of ['\r', '\r\n', '\f', '\n']) {
      const r = g(`.bg{background:url(a.jpg)}${nl}/* a${nl}b */${nl}.bg:hover{background:#000}`);
      assert.deepEqual(r.violations.map(v => v.line), [4], JSON.stringify(nl));
    }
  });
  it('class: any background-related declaration after the design is a change unless provably equal', () => {
    const design = '.bg{background:url(a.jpg) center/cover}\n';
    const longhand = '.bg{background-image:url(a.jpg)}\n';
    for (const [css, exit] of [
      // longhand after shorthand
      [design + '.bg{background-position:0 0}', 2],
      [design + '.bg{background-repeat:no-repeat}', 2],
      [design + '.bg{background-size:cover}', 0],
      [design + '.bg{background-position:center}', 0],
      [design + '.bg{background-image:url(a.jpg)}', 0],
      [design + '.bg{background:url(a.jpg) center / cover}', 0],
      [design + '.bg{background:url(a.jpg) center/contain}', 2],
      // prefixed longhand
      [design + '.bg{-moz-background-size:10px}', 2],
      [design + '.bg{-webkit-background-size:cover}', 0],
      [design + '.bg{-o-background-position:0 0}', 2],
      // hacks
      [design + '.bg{*background-image:url(b.jpg)}', 2],
      [design + '.bg{_background-size:auto}', 2],
      [design + '.bg{background:url(a.jpg); *background:none}', 2],
      // a property the design never set
      [longhand + '.bg{background-repeat:no-repeat}', 2],
      [longhand + '.bg{background-attachment:fixed}', 2],
      [longhand + '.bg{background-position-x:10px}', 2],
      [longhand + '.bg{background-blend-mode:multiply}', 2],
      [longhand + '.bg{background-color:#000}', 2],
      [longhand + '.bg{all:unset}', 2],
      [longhand + '.bg{background-repeat:repeat}', 0],
      [longhand + '.bg{background-size:auto}', 0],
      // cannot be proved equal: fail closed
      ['.bg{background:var(--hero)}\n.bg{background-size:cover}', 2],
      [design + '.bg{background-size:var(--s)}', 2],
      [design + '.bg{background:inherit}', 2],
      // conditional rules: any background-related property
      [design + '.bg:hover{background-color:red}', 2],
      [design + '@media (min-width:1px){.bg{-webkit-background-size:cover}}', 2],
      [design + '.bg:hover{_background-position:0 0}', 2],
    ]) assert.equal(g(css).exit, exit, css);
  });
});
