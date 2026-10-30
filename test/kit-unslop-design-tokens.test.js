import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as dt from '../src/lib/kit/design-tokens.js';
import { CATALOGUE } from '../src/lib/kit/entrance.js';
import { SCALE } from '../src/lib/kit/type-scale.js';

const { run, emit, checkCss, contrastRatio, verb } = dt;
const io = (stdin, cwd) => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
const exit = async (p, code = 1) => assert.rejects(Promise.resolve().then(p), e => e instanceof KitExit && e.code === code);
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const chk = async css => run(['check'], io(css));
const codes = r => r.issues.map(i => i.code);

describe('module', () => {
  it('exports the verb and a usage line', () => {
    assert.equal(verb, 'design-tokens');
    assert.match(dt.usage, /design-tokens emit/);
  });
});

describe('emit css', () => {
  it('prints a :root block with the grid, roles and motion', async () => {
    const r = await run(['emit'], io(''));
    assert.equal(r.format, 'css');
    assert.equal(r.mode, 'light');
    assert.equal(r.kind, 'app');
    assert.match(r.css, /:root \{/);
    for (const px of [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96]) assert.match(r.css, new RegExp(`--space-${px / 4}: ${px}px;`));
    for (const s of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) assert.match(r.css, new RegExp(`--color-neutral-${s}: #[0-9a-f]{6};`));
    assert.match(r.css, /--color-text: #/);
    assert.match(r.css, /--color-accent-hover: #/);
    assert.match(r.css, /--font-weight-semibold: 600;/);
    assert.doesNotMatch(r.css, /--font-weight-[a-z]+: [789]\d\d/);
    assert.match(r.css, /--icon-stroke: 1.5px;/);
    assert.match(r.css, /--radius-nest-outer: 16px;/);
    assert.doesNotMatch(r.css, /nest-rule/);
    assert.equal(r.tokens, undefined);
  });
  it('app has layout values, landing has section rhythm', async () => {
    const app = await run(['emit', '--kind', 'app', '--format', 'json'], io(''));
    assert.equal(app.tokens.layout.sidebar, '240px');
    assert.ok(app.tokens.layout['row-compact'] && app.tokens.layout['content-max']);
    assert.equal(app.tokens.layout['section-y'], undefined);
    const land = await run(['emit', '--kind', 'landing', '--format', 'json'], io(''));
    assert.equal(land.tokens.layout['section-y'], '96px');
    assert.equal(land.tokens.layout.sidebar, undefined);
  });
});

describe('emit json', () => {
  it('nests the same values the css has', async () => {
    const j = await run(['emit', '--hue', '200', '--format', 'json'], io(''));
    const c = await run(['emit', '--hue', '200'], io(''));
    assert.equal(j.css, undefined);
    assert.equal(j.tokens.space['1'], '4px');
    assert.equal(j.tokens.color.neutral['500'].length, 7);
    assert.match(c.css, new RegExp(`--color-neutral-500: ${j.tokens.color.neutral['500']};`));
    assert.match(c.css, new RegExp(`--color-accent: ${j.tokens.color.accent.base};`));
    assert.equal(j.tokens.weight.regular, 400);
    assert.equal(j.tokens.weight.semibold, 600);
    assert.equal(j.tokens.radius.nest.rule, 'outer = inner + padding');
    assert.equal(j.tokens.icon.sm, '16px');
    assert.equal(j.tokens.icon.md, '20px');
    assert.deepEqual(Object.keys(j.tokens.shadow), ['sm', 'md']);
    assert.deepEqual(Object.keys(j.tokens.font).sort(), ['body', 'display']);
    assert.match(j.tokens.font.body, /sans-serif/);
  });
  it('reuses the entrance motion and the type-scale steps', async () => {
    const t = (await run(['emit', '--format', 'json'], io(''))).tokens;
    assert.equal(t.ease, CATALOGUE.card.easing);
    assert.equal(t.duration.entrance, `${CATALOGUE.card.duration_ms}ms`);
    assert.equal(t.stagger['max-items'], 6);
    for (const step of Object.keys(t.text)) {
      const s = SCALE.find(x => x.step === step);
      assert.equal(t.text[step].size, `${s.size_px}px`);
      assert.equal(t.text[step].line, `${s.line_height_px}px`);
    }
  });
  it('shadows are tinted, not pure black, and radii grid values are px', async () => {
    const t = (await run(['emit', '--format', 'json', '--mode', 'dark'], io(''))).tokens;
    for (const s of Object.values(t.shadow)) {
      const m = /rgb\((\d+) (\d+) (\d+) \//.exec(s);
      assert.ok(m && !(m[1] === m[2] && m[2] === m[3]), s);
    }
  });
});

describe('ramp', () => {
  for (const mode of ['light', 'dark']) {
    it(`is tinted and monotonic in ${mode}`, async () => {
      const t = (await run(['emit', '--format', 'json', '--mode', mode, '--hue', '140'], io(''))).tokens;
      const steps = Object.keys(t.color.neutral);
      assert.equal(steps.length, 11);
      let prev = null;
      for (const s of steps) {
        const [r, g, b] = rgb(t.color.neutral[s]);
        assert.ok(!(r === g && g === b), `step ${s} is pure grey`);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (prev !== null) assert.ok(lum < prev, `step ${s} not darker`);
        prev = lum;
      }
    });
  }
  it('light and dark ramps differ', async () => {
    const l = (await run(['emit', '--format', 'json'], io(''))).tokens.color.neutral;
    const d = (await run(['emit', '--format', 'json', '--mode', 'dark'], io(''))).tokens.color.neutral;
    assert.notDeepEqual(l, d);
  });
  it('tint follows the hue', async () => {
    const a = (await run(['emit', '--format', 'json', '--hue', '20'], io(''))).tokens.color.neutral['500'];
    const b = (await run(['emit', '--format', 'json', '--hue', '220'], io(''))).tokens.color.neutral['500'];
    assert.ok(rgb(a)[0] > rgb(a)[2]);
    assert.ok(rgb(b)[2] > rgb(b)[0]);
  });
});

describe('contrast', () => {
  it('holds 4.5 / 4.5 / 3 for many hues in both modes, and reports real ratios', async () => {
    for (const mode of ['light', 'dark']) {
      for (let hue = 0; hue < 360; hue += 15) {
        const r = await run(['emit', '--format', 'json', '--mode', mode, '--hue', String(hue)], io(''));
        assert.ok(r.contrast.primary >= 4.5, `${mode} ${hue} primary ${r.contrast.primary}`);
        assert.ok(r.contrast.secondary >= 4.5, `${mode} ${hue} secondary ${r.contrast.secondary}`);
        assert.ok(r.contrast.muted >= 3, `${mode} ${hue} muted ${r.contrast.muted}`);
        assert.ok(r.contrast.accent >= 4.5, `${mode} ${hue} accent ${r.contrast.accent}`);
        const c = r.tokens.color;
        const real = contrastRatio(rgb(c.text.primary), rgb(c.bg));
        assert.ok(Math.abs(real - r.contrast.primary) < 0.01);
        assert.ok(contrastRatio(rgb(c.text.muted), rgb(c.bg)) >= 3);
      }
    }
  });
});

describe('accent', () => {
  it('uses a given accent as is and derives hover and subtle', async () => {
    const r = await run(['emit', '--format', 'json', '--accent', '#E11D48'], io(''));
    assert.equal(r.tokens.color.accent.base, '#e11d48');
    assert.equal(r.accent, '#e11d48');
    assert.notEqual(r.tokens.color.accent.hover, '#e11d48');
    assert.match(r.tokens.color.accent.subtle, /^#[0-9a-f]{6}$/);
    assert.ok(r.contrast.accent > 1);
    assert.ok(r.hue >= 0 && r.hue < 360);
  });
  it('takes the ramp hue from the accent unless --hue is given', async () => {
    const a = await run(['emit', '--accent', '#e11d48', '--format', 'json'], io(''));
    const b = await run(['emit', '--accent', '#e11d48', '--hue', '100', '--format', 'json'], io(''));
    assert.ok(a.hue > 0 && a.hue !== 100);
    assert.equal(b.hue, 100);
  });
  it('derives a default accent from the hue', async () => {
    const r = await run(['emit', '--format', 'json', '--hue', '300'], io(''));
    assert.match(r.accent, /^#[0-9a-f]{6}$/);
    assert.equal(r.hue, 300);
  });
});

describe('emit errors', () => {
  it('rejects bad input with exit 1', async () => {
    for (const a of [
      ['--hue', '360'], ['--hue', '-1'], ['--hue', 'x'], ['--hue', '1e2'], ['--hue'],
      ['--accent', 'red'], ['--accent', '#12345'], ['--accent', '#gggggg'], ['--accent', '#fff'],
      ['--mode', 'sepia'], ['--format', 'yaml'], ['--kind', 'blog'],
      ['--nope', '1'], ['stray'], ['--hue', '10', '--hue', '20'], ['--mode', ''],
    ]) await exit(() => run(['emit', ...a], io('')));
  });
  it('rejects a missing or unknown subcommand', async () => {
    await exit(() => run([], io('')));
    await exit(() => run(['bogus'], io('')));
  });
});

describe('check', () => {
  it('passes clean css', async () => {
    const r = await chk(':root { --space-2: 8px; }\n.a { margin: 8px 16px; padding: 0; font-weight: 400; color: #14191e; box-shadow: 0 1px 2px rgb(15 23 31 / .06); }\n.b { font-weight: 600; }');
    assert.deepEqual(r.issues, []);
    assert.equal(r.ok, true);
    assert.equal(r.counts.total, 0);
    assert.equal(r.exit, undefined);
  });
  it('flags off-grid spacing with a fix and the right line', async () => {
    const r = await chk('.a {\n  margin: 8px 13px;\n  padding-left: 6px;\n  gap: 24px;\n  top: 7px;\n  margin-top: -10px;\n}');
    const g = r.issues.filter(i => i.code === 'OFF_GRID_SPACING');
    assert.deepEqual(g.map(i => [i.line, i.value]), [[2, 'margin: 13px'], [3, 'padding-left: 6px'], [6, 'margin-top: -10px']]);
    assert.match(g[0].fix, /12px/);
    assert.match(g[2].fix, /-8px|-12px/);
    assert.equal(r.counts.by_code.OFF_GRID_SPACING, 3);
  });
  it('skips calc, var and zero in spacing', async () => {
    const r = await chk('.a { margin: calc(100% - 13px); padding: var(--x, 13px); gap: 0px; }');
    assert.deepEqual(r.issues, []);
  });
  it('flags heavy weights and too many weights', async () => {
    const r = await chk('.a{font-weight:700}\n.b{font-weight:bold}\n.c{font-weight:500}\n.d{font-weight:400}\n.e{font-weight:normal}');
    assert.equal(r.issues.filter(i => i.code === 'HEAVY_WEIGHT').length, 2);
    const many = r.issues.filter(i => i.code === 'TOO_MANY_WEIGHTS');
    assert.equal(many.length, 1);
    assert.equal(many[0].line, 4);
    const two = await chk('.a{font-weight:400}.b{font-weight:600}.c{font-weight:400}');
    assert.deepEqual(two.issues, []);
  });
  it('flags a second saturated hue family but not tints of one accent', async () => {
    const one = await chk('.a{color:#3b82f6}.b{background:#2563eb}.c{border-color:hsl(220 90% 50%)}');
    assert.ok(!codes(one).includes('MULTIPLE_ACCENTS'));
    const two = await chk('.a{color:#3b82f6}\n.b{background:rgb(220, 38, 38)}\n.c{color:#16a34a}');
    const m = two.issues.filter(i => i.code === 'MULTIPLE_ACCENTS');
    assert.equal(m.length, 1);
    assert.equal(m[0].line, 2);
    assert.equal(two.ok, false);
  });
  it('hints at pure greys without failing', async () => {
    const r = await chk('.a{color:#888}.b{background:rgb(128,128,128)}.c{color:#000;border-color:#fff}.d{color:#14191e}');
    assert.deepEqual(r.issues.map(i => [i.code, i.severity, i.value]), [['PURE_GREY', 'hint', '#888'], ['PURE_GREY', 'hint', 'rgb(128,128,128)']]);
    assert.equal(r.ok, true);
    assert.deepEqual([r.counts.issues, r.counts.hints], [0, 2]);
  });
  it('flags more than two box-shadow declarations', async () => {
    const two = await chk('.a{box-shadow:0 1px #14191e}.b{box-shadow:0 2px #14191e}.c{box-shadow:none}');
    assert.deepEqual(two.issues, []);
    const three = await chk('.a{box-shadow:0 1px #14191e}\n.b{box-shadow:0 2px #14191e}\n.c{box-shadow:0 3px #14191e}');
    assert.deepEqual(three.issues.map(i => [i.code, i.line]), [['TOO_MANY_SHADOWS', 3]]);
  });
  it('ignores comments and handles crlf', async () => {
    const r = await chk('/* margin: 13px; font-weight: 900 */\r\n.a { margin: 5px; }\r\n');
    assert.deepEqual(r.issues.map(i => [i.code, i.line]), [['OFF_GRID_SPACING', 2]]);
  });
  it('--strict exits 2 with the report only when issues exist', async () => {
    const bad = await run(['check', '--strict'], io('.a{margin:5px}'));
    assert.equal(bad.exit, 2);
    assert.equal(bad.ok, false);
    const hintOnly = await run(['check', '--strict'], io('.a{color:#888}'));
    assert.equal(hintOnly.exit, undefined);
    const clean = await run(['check', '--strict'], io('.a{margin:8px}'));
    assert.equal(clean.exit, undefined);
    assert.equal((await run(['check'], io('.a{margin:5px}'))).exit, undefined);
  });
  it('checks the emitted sheet clean', async () => {
    for (const mode of ['light', 'dark']) {
      const r = await chk(emit({ mode, hue: 60 }).css);
      assert.equal(r.ok, true, JSON.stringify(r.issues));
      assert.equal(r.counts.hints, 0);
    }
  });
});

describe('check input', () => {
  it('reads --file and matches stdin', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dt-'));
    try {
      const css = '.a{margin:5px}';
      await fs.writeFile(path.join(dir, 'a.css'), css);
      assert.deepEqual(await run(['check', '--file', 'a.css'], io('', dir)), await chk(css));
      await exit(() => run(['check', '--file', 'missing.css'], io('', dir)));
      await exit(() => run(['check', '--file', dir], io('', dir)));
      await exit(() => run(['check', '--file', '/dev/null'], io('', dir)));
      await exit(() => run(['check', '--file', 'a.css', '--file', 'a.css'], io('', dir)));
      await fs.writeFile(path.join(dir, 'empty.css'), '  \n');
      await exit(() => run(['check', '--file', 'empty.css'], io('', dir)));
      await fs.writeFile(path.join(dir, 'bin.css'), Buffer.from([0x2e, 0x61, 0, 1, 2]));
      await exit(() => run(['check', '--file', 'bin.css'], io('', dir)));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('rejects empty, binary, oversize, tty and unknown flags', async () => {
    await exit(() => run(['check'], io('')));
    await exit(() => run(['check'], io('   \n')));
    await exit(() => run(['check'], io('.a{}\0')));
    await exit(() => run(['check'], io('a'.repeat(8 * 1024 * 1024 + 1))));
    await exit(() => run(['check'], { cwd: '.', stdin: async () => '', stdinIsTTY: true, env: {} }));
    await exit(() => run(['check', '--bogus'], io('.a{}')));
    await exit(() => run(['check', '--strict', '--strict'], io('.a{}')));
    await exit(() => run(['check', '--file'], io('.a{}')));
    await exit(() => run(['check', 'x'], io('.a{}')));
    await exit(() => run(['check', '--hue', '1'], io('.a{}')));
  });
  it('handles a large declaration-heavy file quickly', async () => {
    const css = '.a{margin:8px;color:#14191e}\n'.repeat(50000);
    const t = Date.now();
    const r = await chk(css);
    assert.equal(r.ok, true);
    assert.ok(Date.now() - t < 5000);
  });
});
