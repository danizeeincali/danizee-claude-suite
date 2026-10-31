import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as sp from '../src/lib/kit/story-plan.js';

const { check, emit, template, timeline, run, verb, preparePage } = sp;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, '.claude', 'helpers', 'kit', 'cli.js');
const io = (stdin, cwd) => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
const exit = async (p, code = 1) => assert.rejects(Promise.resolve().then(p), e => e instanceof KitExit && e.code === code);
const codes = r => r.problems.map(p => p.code);
const mk = (over = {}) => ({ ...template(), ...over });
const PAGE = '<!doctype html><html><head><title>x</title><style>body{margin:0;background:#eee}.card{padding:10px}</style><link rel="stylesheet" href="https://x.test/a.css"><script>alert(1)</script></head><body class="app" onload="evil()"><h1 onclick="x()">Hi</h1><div class="card"><button class="btn" onmouseover="y()">Go</button></div><a href="javascript:alert(1)">z</a><iframe src="https://x.test"></iframe></body></html>';
const tmp = async () => fs.mkdtemp(path.join(os.tmpdir(), 'story-plan-'));

describe('header contract', () => {
  it('documents every code, flag and exit that the code produces', async () => {
    const src = await fs.readFile(path.join(ROOT, 'src/lib/kit/story-plan.js'), 'utf-8');
    const head = src.slice(0, src.indexOf('*/'));
    for (const c of ['bad-title', 'bad-format', 'unknown-key', 'bad-shape', 'step-count', 'step-id', 'step-id-duplicate', 'step-label', 'step-empty', 'css-selector', 'css-prop', 'css-value', 'css-content', 'pill-radius', 'swap-length', 'swap-count', 'swap-selector-reuse', 'tween-range', 'hold-range', 'easing', 'intro-outro', 'duration', 'redline-label', 'redline-measure', 'redline-selector-reuse', 'redline-missing', 'credit-length']) assert.ok(head.includes(c), c);
    for (const f of ['--file', '--strict', '--page', '--out', 'template', 'duration_ms', 'timeline', 'problems', 'story-duration-ms', 'prefers-reduced-motion', '8 MiB', 'no foreign code']) assert.ok(head.includes(f), f);
    for (const f of ['notes', 'credit-missing', 'camera', 'stripped: { scripts, links }', '{ out, bytes, duration_ms, steps, format, stripped }', 'same file as --page or --file', 'story-format', '--format wide', 'no crop', 'Redesign by the author', 'data-story-camera']) assert.ok(head.includes(f), f);
    assert.ok(head.includes(sp.DEFAULT_CREDIT));
    assert.equal(verb, 'story-plan');
    assert.ok(sp.usage.includes('story-plan'));
    const mod = await fs.readFile(path.join(ROOT, '.claude/helpers/kit/story-plan.js'), 'utf-8');
    assert.equal(mod, src);
  });
});

describe('template and check happy path', () => {
  it('the template passes check with a timeline', () => {
    const r = check(template());
    assert.equal(r.ok, true);
    assert.deepEqual(r.problems, []);
    assert.equal(r.timeline.length, 3);
    assert.ok(r.duration_ms <= 10000);
  });
  it('run template returns the same object and takes no arguments', async () => {
    assert.deepEqual(await run(['template'], io('')), template());
    await exit(() => run(['template', 'x'], io('')));
  });
});

describe('timeline math', () => {
  it('chains steps from the intro and adds the outro', () => {
    const story = mk({ intro_ms: 100, outro_ms: 200, steps: [
      { id: 'a', label: 'a', css: { x: { opacity: '1' } }, tween_ms: 300, hold_ms: 400 },
      { id: 'b', label: 'b', css: { x: { opacity: '1' } }, tween_ms: 0, hold_ms: 50 },
      { id: 'c', label: 'c', css: { x: { opacity: '1' } } },
    ] });
    const t = timeline(story);
    assert.deepEqual(t.timeline, [
      { id: 'a', start_ms: 100, end_ms: 800, tween_end_ms: 400 },
      { id: 'b', start_ms: 800, end_ms: 850, tween_end_ms: 800 },
      { id: 'c', start_ms: 850, end_ms: 2350, tween_end_ms: 1450 },
    ]);
    assert.equal(t.duration_ms, 2550);
    assert.equal(check(story).duration_ms, 2550);
  });
  it('uses defaults for intro and outro', () => {
    const s = mk(); delete s.intro_ms; delete s.outro_ms;
    const t = timeline(s);
    assert.equal(t.timeline[0].start_ms, 500);
    assert.equal(t.duration_ms, t.timeline.at(-1).end_ms + 1000);
  });
});

describe('check rules, one code each', () => {
  const only = (story, code) => { const r = check(story); assert.ok(codes(r).includes(code), `${code} in ${codes(r)}`); assert.equal(r.ok, false); return r; };
  const step = (over = {}) => ({ id: 'a', label: 'A', css: { '.x': { opacity: '0.5' } }, ...over });
  const withStep = over => { const s = mk(); s.steps = [step({ id: 'a' }), step({ id: 'b' }), step({ id: 'c', ...over })]; return s; };
  it('title and format', () => {
    only(mk({ title: '' }), 'bad-title');
    only(mk({ title: 'x'.repeat(81) }), 'bad-title');
    only(mk({ title: 5 }), 'bad-title');
    only(mk({ format: 'tall' }), 'bad-format');
    only(mk({ format: 'toString' }), 'bad-format');
    assert.equal(check(mk({ format: 'wide' })).ok, true);
  });
  it('unknown keys, including html on a step', () => {
    only(mk({ extra: 1 }), 'unknown-key');
    const r = only(withStep({ html: '<b>new</b>' }), 'unknown-key');
    assert.equal(r.problems.find(p => p.code === 'unknown-key').step, 'c');
    only(withStep({ __proto__x: 1 }), 'unknown-key');
  });
  it('step count 3-5', () => {
    const s = mk(); s.steps = s.steps.slice(0, 2);
    only(s, 'step-count');
    const six = mk(); six.steps = [1, 2, 3, 4, 5, 6].map(i => step({ id: 's' + i }));
    only(six, 'step-count');
    only(mk({ steps: 'no' }), 'step-count');
    const five = mk(); five.steps = [1, 2, 3, 4, 5].map(i => step({ id: 's' + i, tween_ms: 100, hold_ms: 100 }));
    assert.equal(check(five).ok, true);
    const four = mk(); four.steps = [1, 2, 3, 4].map(i => step({ id: 's' + i }));
    assert.equal(check(four).ok, true);
  });
  it('step shape, ids and labels', () => {
    const s = mk(); s.steps[1] = 'nope';
    only(s, 'bad-shape');
    only(withStep({ id: 'Bad Id' }), 'step-id');
    only(withStep({ id: 'b' }), 'step-id-duplicate');
    only(withStep({ label: '' }), 'step-label');
    only(withStep({ label: 'x'.repeat(61) }), 'step-label');
  });
  it('a step must change something', () => {
    only(withStep({ css: {} }), 'step-empty');
    const s = withStep({}); delete s.steps[2].css;
    only(s, 'step-empty');
    only(withStep({ css: 'x' }), 'bad-shape');
    only(withStep({ css: { '.x': 'x' } }), 'bad-shape');
  });
  it('selectors are plain', () => {
    for (const sel of ['.a{}', '.a;b', '@media', '.a::before', '.a:after', '</style>', '', '.a/*x*/', '.'.padEnd(201, 'a')]) only(withStep({ css: { [sel]: { opacity: '1' } } }), 'css-selector');
    assert.equal(check(withStep({ css: { 'ul > li:nth-child(2), [data-x="y"]': { opacity: '1' } } })).ok, true);
  });
  it('only tweenable properties, never content', () => {
    only(withStep({ css: { '.x': { 'background-image': 'linear-gradient(red, blue)' } } }), 'css-prop');
    only(withStep({ css: { '.x': { display: 'none' } } }), 'css-prop');
    only(withStep({ css: { '.x': { '--custom': '1' } } }), 'css-prop');
    const r = only(withStep({ css: { '.x': { content: '"hi"' } } }), 'css-content');
    assert.ok(codes(r).includes('css-content'));
    for (const p of ['color', 'background-color', 'opacity', 'transform', 'filter', 'letter-spacing', 'font-weight', 'box-shadow', 'gap', 'row-gap', 'column-gap', 'padding-top', 'margin-left', 'border-top-left-radius']) {
      const rr = check(withStep({ css: { '.x': { [p]: '1' } }, redline: { selector: '.x', label: 'slop' } }));
      assert.ok(!codes(rr).includes('css-prop'), p);
    }
    assert.equal(check(withStep({ css: { '.x': { Opacity: '1' } } })).ok, true);
  });
  it('values are plain strings', () => {
    for (const v of ['url(http://x)', 'red; color: blue', '1 !important', '{x}', '', 'a'.repeat(201), '<b>', 'expression(1)', '/* x */', null, ['a']]) only(withStep({ css: { '.x': { color: v } } }), 'css-value');
    assert.equal(check(withStep({ css: { '.x': { opacity: 0.5 } } })).ok, true);
  });
  it('pill radii cannot tween', () => {
    only(withStep({ css: { '.x': { 'border-radius': '999px' } }, redline: { selector: '.x', label: 'pill' } }), 'pill-radius');
    only(withStep({ css: { '.x': { 'border-radius': '9999' } }, redline: { selector: '.x', label: 'pill' } }), 'pill-radius');
    assert.equal(check(withStep({ css: { '.x': { 'border-radius': '24px' } }, redline: { selector: '.x', label: 'ok' } })).ok, true);
  });
  it('swaps: 80 chars, at most 3, one per element', () => {
    const sw = (n, sel = '.t') => ({ selector: sel, text: 'x'.repeat(n) });
    only(withStep({ swap: sw(81) }), 'swap-length');
    assert.equal(check(withStep({ swap: sw(80) })).ok, true);
    only(withStep({ swap: { selector: '.t' } }), 'bad-shape');
    const s = mk(); s.steps = [0, 1, 2, 3].map(i => step({ id: 's' + i, swap: sw(5, '.t' + i), tween_ms: 100, hold_ms: 100 }));
    only(s, 'swap-count');
    s.steps = [0, 1, 2].map(i => step({ id: 's' + i, swap: sw(5, '.t' + i) }));
    assert.equal(check(s).ok, true);
    s.steps[1].swap.selector = '.t0';
    only(s, 'swap-selector-reuse');
    only(withStep({ css: undefined, swap: { selector: '.t{', text: 'a' } }), 'css-selector');
    only(withStep({ swap: { selector: '.t', text: 'a', ink: 'red;' } }), 'css-value');
  });
  it('tween and hold ranges', () => {
    only(withStep({ tween_ms: 901 }), 'tween-range');
    only(withStep({ tween_ms: -1 }), 'tween-range');
    only(withStep({ tween_ms: 1.5 }), 'tween-range');
    only(withStep({ hold_ms: 5001 }), 'hold-range');
    only(withStep({ hold_ms: '9' }), 'hold-range');
    assert.equal(check(withStep({ tween_ms: 900, hold_ms: 100 })).ok, true);
  });
  it('one shared easing', () => {
    only(mk({ easing: 'bounce' }), 'easing');
    only(mk({ easing: [0.5, 0, 2, 1] }), 'easing');
    only(mk({ easing: [0.5, 0] }), 'easing');
    only(mk({ easing: 'toString' }), 'easing');
    assert.equal(check(mk({ easing: [0.2, 0, 0.2, 1] })).ok, true);
    assert.equal(check(mk({ easing: 'out' })).ok, true);
    const s = mk(); s.steps[0].easing = 'linear';
    only(s, 'unknown-key');
  });
  it('intro and outro', () => {
    only(mk({ intro_ms: -1 }), 'intro-outro');
    only(mk({ outro_ms: 5001 }), 'intro-outro');
    only(mk({ intro_ms: 'a' }), 'intro-outro');
  });
  it('total duration is at most 10000 ms, and the cap is reachable', () => {
    const mkDur = (hold, outro) => { const s = mk({ intro_ms: 0, outro_ms: outro }); s.steps = [1, 2, 3].map(i => step({ id: 's' + i, tween_ms: 900, hold_ms: hold })); return s; };
    assert.equal(check(mkDur(1900, 0)).duration_ms, 8400);
    assert.equal(check(mkDur(1900, 0)).ok, true);
    const exact = check(mkDur(2433, 1));
    assert.equal(exact.duration_ms, 10000);
    assert.equal(exact.ok, true);
    const over = check(mkDur(2433, 2));
    assert.equal(over.duration_ms, 10001);
    assert.ok(codes(over).includes('duration'));
    assert.equal(over.ok, false);
  });
  it('redlines', () => {
    const rl = over => withStep({ redline: { selector: '.x', label: 'slop', ...over } });
    assert.equal(check(rl({})).ok, true);
    only(rl({ label: '' }), 'redline-label');
    only(rl({ label: 'x'.repeat(41) }), 'redline-label');
    assert.equal(check(rl({ label: 'x'.repeat(40) })).ok, true);
    only(rl({ measure: 'x'.repeat(21) }), 'redline-measure');
    only(rl({ selector: '.x::after' }), 'css-selector');
    only(withStep({ redline: 'x' }), 'bad-shape');
    const s = mk(); s.steps = [0, 1, 2].map(i => step({ id: 's' + i, redline: { selector: '.same', label: 'l' } }));
    only(s, 'redline-selector-reuse');
  });
  it('spacing and corner steps need a redline', () => {
    only(withStep({ css: { '.x': { padding: '8px' } } }), 'redline-missing');
    only(withStep({ css: { '.x': { gap: '8px' } } }), 'redline-missing');
    only(withStep({ css: { '.x': { 'border-radius': '8px' } } }), 'redline-missing');
    assert.equal(check(withStep({ css: { '.x': { color: 'red' } } })).ok, true);
  });
  it('credit length', () => {
    only(mk({ credit: 'x'.repeat(61) }), 'credit-length');
    only(mk({ credit: 5 }), 'credit-length');
    assert.equal(check(mk({ credit: 'x'.repeat(60) })).ok, true);
  });
  it('rejects non-objects', () => {
    assert.throws(() => check(null), KitExit);
    assert.throws(() => check([]), KitExit);
    assert.throws(() => check('x'), KitExit);
  });
});

describe('emit', () => {
  const story = mk({ credit: 'A <b>credit</b>' });
  const r = emit(story, PAGE);
  it('returns html, duration and step count', () => {
    assert.equal(r.duration_ms, check(story).duration_ms);
    assert.equal(r.steps, 3);
    assert.equal(typeof r.html, 'string');
  });
  it('has the duration meta, no script, one layer per step, a credit', () => {
    assert.ok(r.html.includes(`<meta name="story-duration-ms" content="${r.duration_ms}">`));
    assert.ok(!/<script/i.test(r.html));
    assert.ok(!/<link/i.test(r.html));
    assert.ok(!/<iframe/i.test(r.html));
    assert.ok(!/\son[a-z]+\s*=/i.test(r.html));
    assert.ok(!/javascript:/i.test(r.html));
    assert.equal((r.html.match(/<style data-story-step=/g) || []).length, 3);
    for (const s of story.steps) assert.ok(r.html.includes(`<style data-story-step="${s.id}"`));
    assert.ok(r.html.includes('A &lt;b&gt;credit&lt;/b&gt;'));
    assert.ok(!r.html.includes('<b>credit'));
    assert.deepEqual(r.stripped.scripts >= 1, true);
  });
  it('structure: doctype, html class story-play, frame size, page inside', () => {
    assert.ok(r.html.startsWith('<!doctype html>'));
    assert.match(r.html, /<html lang="en" class="story-play">/);
    assert.match(r.html, /#story-frame\{[^}]*width:1080px;height:1080px/);
    assert.ok(r.html.includes('<h1>Hi</h1>'));
    assert.ok(r.html.includes('class="app"'));
    assert.ok(r.html.includes('#story-page{margin:0;background:#eee}'));
    assert.equal((r.html.match(/<body>/g) || []).length, 1);
    assert.equal((r.html.match(/<\/html>/g) || []).length, 1);
    const wide = emit(mk({ format: 'wide', credit: undefined }), PAGE).html;
    assert.match(wide, /width:1920px;height:1080px/);
    assert.ok(wide.includes(`<div id="story-credit">${sp.DEFAULT_CREDIT}</div>`));
  });
  it('animation timings in the CSS match the timeline', () => {
    const tl = check(story).timeline;
    story.steps.forEach((s, i) => {
      const m = new RegExp(`<style data-story-step="${s.id}" data-start-ms="(\\d+)" data-end-ms="(\\d+)">([\\s\\S]*?)</style>`).exec(r.html);
      assert.equal(Number(m[1]), tl[i].start_ms);
      assert.equal(Number(m[2]), tl[i].end_ms);
      const tweenMs = tl[i].tween_end_ms - tl[i].start_ms;
      const anims = [...m[3].matchAll(new RegExp(`story-s${i + 1}-\\d+ (\\d+)ms ([\\w-]+) (\\d+)ms 1 normal forwards`, 'g'))];
      assert.ok(anims.length >= 1);
      for (const a of anims) { assert.equal(Number(a[1]), tweenMs); assert.equal(a[2], 'ease-in-out'); assert.equal(Number(a[3]), tl[i].start_ms); }
      if (s.redline) {
        const rm = new RegExp(`story-r${i + 1}-tag (\\d+)ms linear (\\d+)ms`).exec(m[3]);
        assert.equal(Number(rm[1]), tl[i].end_ms - tl[i].start_ms);
        assert.equal(Number(rm[2]), tl[i].start_ms);
      }
    });
    const cm = /story-credit 300ms linear (\d+)ms/.exec(r.html);
    assert.equal(Number(cm[1]), r.duration_ms - 1200);
  });
  it('later steps start from the previous value and one easing is shared', () => {
    const s = mk(); s.easing = [0.2, 0, 0.2, 1];
    s.steps = [
      { id: 'a', label: 'a', css: { '.x': { color: 'red' } } },
      { id: 'b', label: 'b', css: { '.x': { color: 'blue' } } },
      { id: 'c', label: 'c', css: { '.y': { opacity: '0' } } },
    ];
    const h = emit(s, PAGE).html;
    assert.ok(h.includes('@keyframes story-s1-0{to{color:red}}'));
    assert.ok(h.includes('@keyframes story-s2-0{from{color:red}to{color:blue}}'));
    assert.equal((h.match(/cubic-bezier\(0\.2,0,0\.2,1\)/g) || []).length >= 3, true);
    assert.ok(!/ease-in-out \d+ms 1/.test(h));
  });
  it('redlines draw an outline and a tag, and appear only in their window', () => {
    assert.ok(r.html.includes('content:"uneven gaps  16px"'));
    assert.ok(r.html.includes('outline-color:#e5484d'));
    assert.match(r.html, /@keyframes story-r2-tag\{0%\{opacity:0\}/);
  });
  it('swap uses blur-out and blur-in, with reduced-motion final state', () => {
    assert.ok(r.html.includes('content:"Start free"'));
    assert.match(r.html, /@keyframes story-w3\{0%\{opacity:1;filter:blur\(0\)\}/);
  });
  it('reduced motion shows the final state', () => {
    const m = /<style data-story-step="space"[\s\S]*?<\/style>/.exec(r.html)[0];
    assert.match(m, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*padding:32px !important/);
    assert.match(m, /animation:none !important/);
    assert.match(r.html, /@media \(prefers-reduced-motion:reduce\)\{html\.story-play #story-credit\{opacity:1/);
  });
  it('css string escaping: labels cannot break out of the style', () => {
    const s = mk(); s.steps[1].redline = { selector: '.card', label: 'a"</style><script>x' };
    const h = emit(s, PAGE).html;
    assert.ok(!/<script/i.test(h));
    assert.equal((h.match(/<\/style>/g) || []).length, 1 + 1 + 3);
  });
  it('refuses a story that is not ok', () => {
    assert.throws(() => emit(mk({ format: 'x' }), PAGE), e => e instanceof KitExit && e.code === 1 && /bad-format/.test(e.message));
  });
  it('is deterministic', () => { assert.equal(emit(story, PAGE).html, r.html); });
  it('page prep: bare fragments, unclosed script and 8 MiB of tag-like text stay linear', () => {
    assert.ok(emit(mk(), '<p>just a fragment</p><script>x').html.includes('<p>just a fragment</p>'));
    assert.equal(preparePage('<style>html body{color:red} html{x:1}</style><body>ok</body>').css, '#story-page{color:red} #story-page{x:1}');
    const t0 = Date.now();
    emit(mk(), '<a '.repeat(2 * 1024 * 1024));
    emit(mk(), '<a "'.repeat(1024 * 1024));
    emit(mk(), `<style>${'a{b:c}'.repeat(1024 * 1024)}`);
    emit(mk(), '<script '.repeat(1024 * 1024));
    assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0}ms`);
  });
});

describe('run: check and emit', () => {
  it('check from stdin and --file; advisory exit 0, --strict exits 2', async () => {
    const dir = await tmp();
    const good = JSON.stringify(template());
    const badStory = JSON.stringify({ ...template(), format: 'x' });
    assert.equal((await run(['check'], io(good))).ok, true);
    await fs.writeFile(path.join(dir, 's.json'), badStory);
    const r = await run(['check', '--file', 's.json'], io('', dir));
    assert.equal(r.ok, false);
    assert.equal(r.exit, undefined);
    assert.equal((await run(['check', '--strict', '--file', 's.json'], io('', dir))).exit, 2);
    assert.equal((await run(['check', '--strict'], io(good))).exit, undefined);
  });
  it('input errors exit 1', async () => {
    const dir = await tmp();
    await exit(() => run(['check'], io('')));
    await exit(() => run(['check'], io('   \n')));
    await exit(() => run(['check'], io('{nope')));
    await exit(() => run(['check'], io('[]')));
    await exit(() => run(['check'], io('null')));
    await exit(() => run(['check'], io('"x"')));
    await exit(() => run(['check'], io('{"a":\0}')));
    await exit(() => run(['check', '--file', 'missing.json'], io('', dir)));
    await exit(() => run(['check', '--file', dir], io('', dir)));
    await exit(() => run(['check', '--file', '/dev/null'], io('')));
    await exit(() => run(['check', '--bogus'], io('{}')));
    await exit(() => run(['check', '--file'], io('{}')));
    await exit(() => run(['check', '--file', ''], io('{}')));
    await exit(() => run(['check', '--file', 'a', '--file', 'b'], io('{}')));
    await exit(() => run(['check', '--strict', '--strict'], io('{}')));
    await exit(() => run(['check', '--toString'], io('{}')));
    await exit(() => run(['check', '--page', 'x'], io('{}')));
    await exit(() => run([], io('')));
    await exit(() => run(['bogus'], io('')));
    await exit(() => run(['check'], io('x'.repeat(8 * 1024 * 1024 + 2))));
  });
  it('size cap and BOM through --file', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 'big.json'), Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
    await exit(() => run(['check', '--file', 'big.json'], io('', dir)));
    await fs.writeFile(path.join(dir, 'bom.json'), '﻿' + JSON.stringify(template()));
    assert.equal((await run(['check', '--file', 'bom.json'], io('', dir))).ok, true);
    await fs.writeFile(path.join(dir, 'bin.json'), Buffer.from([0x7b, 0, 0x7d]));
    await exit(() => run(['check', '--file', 'bin.json'], io('', dir)));
  });
  it('emit returns html, or writes --out; page errors exit 1', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 's.json'), JSON.stringify(template()));
    await fs.writeFile(path.join(dir, 'p.html'), PAGE);
    const r = await run(['emit', '--file', 's.json', '--page', 'p.html'], io('', dir));
    assert.ok(r.html.includes('story-duration-ms'));
    assert.equal(r.steps, 3);
    const o = await run(['emit', '--file', 's.json', '--page', 'p.html', '--out', 'out.html'], io('', dir));
    assert.equal(o.html, undefined);
    assert.equal(o.out, path.join(dir, 'out.html'));
    const written = await fs.readFile(o.out, 'utf-8');
    assert.equal(written, r.html);
    assert.equal(o.bytes, Buffer.byteLength(written));
    const viaStdin = await run(['emit', '--page', 'p.html'], io(JSON.stringify(template()), dir));
    assert.equal(viaStdin.html, r.html);
    await exit(() => run(['emit', '--file', 's.json'], io('', dir)));
    await exit(() => run(['emit', '--file', 's.json', '--page', 'nope.html'], io('', dir)));
    await fs.writeFile(path.join(dir, 'empty.html'), '  ');
    await exit(() => run(['emit', '--file', 's.json', '--page', 'empty.html'], io('', dir)));
    await fs.writeFile(path.join(dir, 'bin.html'), Buffer.from([0x3c, 0, 0x3e]));
    await exit(() => run(['emit', '--file', 's.json', '--page', 'bin.html'], io('', dir)));
    await fs.writeFile(path.join(dir, 'bad.json'), JSON.stringify({ ...template(), format: 'x' }));
    await exit(() => run(['emit', '--file', 'bad.json', '--page', 'p.html'], io('', dir)));
    await exit(() => run(['emit', '--file', 's.json', '--page', 'p.html', '--out', 'nodir/out.html'], io('', dir)));
    await exit(() => run(['emit', '--file', 's.json', '--page', 'p.html', '--page', 'p.html'], io('', dir)));
    await exit(() => run(['emit', '--file', 's.json', '--page', 'p.html', '--out'], io('', dir)));
  });
});

describe('real CLI path', () => {
  const cli = (args, input, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: 'utf-8' });
  it('--file and piped stdin agree; template feeds check and emit; --strict exits 2', async () => {
    const dir = await tmp();
    const t = cli(['story-plan', 'template'], '', dir);
    assert.equal(t.status, 0);
    await fs.writeFile(path.join(dir, 's.json'), t.stdout);
    await fs.writeFile(path.join(dir, 'p.html'), PAGE);
    const viaFile = cli(['story-plan', 'check', '--file', 's.json'], '', dir);
    const viaStdin = cli(['story-plan', 'check'], t.stdout, dir);
    assert.equal(viaFile.status, 0);
    assert.deepEqual(JSON.parse(viaFile.stdout), JSON.parse(viaStdin.stdout));
    assert.equal(JSON.parse(viaFile.stdout).ok, true);
    const e = cli(['story-plan', 'emit', '--file', 's.json', '--page', 'p.html'], '', dir);
    assert.equal(e.status, 0);
    const j = JSON.parse(e.stdout);
    assert.ok(j.html.includes('<meta name="story-duration-ms"'));
    const bad = JSON.stringify({ ...JSON.parse(t.stdout), steps: [] });
    const strict = cli(['story-plan', 'check', '--strict'], bad, dir);
    assert.equal(strict.status, 2);
    assert.equal(JSON.parse(strict.stdout).ok, false);
    assert.equal(cli(['story-plan', 'check'], bad, dir).status, 0);
    const err = cli(['story-plan', 'check'], '{nope', dir);
    assert.equal(err.status, 1);
    assert.equal(err.stdout, '');
    assert.ok(err.stderr.length > 0);
    assert.equal(cli(['story-plan', 'emit', '--file', 's.json'], '', dir).status, 1);
    await fs.writeFile(path.join(dir, 'big.json'), Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
    assert.equal(cli(['story-plan', 'check', '--file', 'big.json'], '', dir).status, 1);
    assert.ok(JSON.parse(cli(['help'], '', dir).stdout).verbs.includes('story-plan'));
  });
});

describe('review r1 regressions', () => {
  const swapStory = (text, sel = '.btn') => { const s = mk(); s.steps[2].swap = { selector: sel, text }; return s; };
  it('--out that is the same file as --page or --file is refused (path, symlink, hard link)', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 's.json'), JSON.stringify(template()));
    await fs.writeFile(path.join(dir, 'p.html'), PAGE);
    await fs.symlink(path.join(dir, 'p.html'), path.join(dir, 'sym.html'));
    await fs.link(path.join(dir, 'p.html'), path.join(dir, 'hard.html'));
    for (const out of ['p.html', './p.html', path.join(dir, 'p.html'), 'sym.html', 'hard.html', 's.json']) {
      await assert.rejects(run(['emit', '--file', 's.json', '--page', 'p.html', '--out', out], io('', dir)), e => e instanceof KitExit && e.code === 1 && /same file as --(page|file)/.test(e.message), out);
    }
    assert.equal(await fs.readFile(path.join(dir, 'p.html'), 'utf-8'), PAGE);
    assert.equal(await fs.readFile(path.join(dir, 's.json'), 'utf-8'), JSON.stringify(template()));
    const cli = spawnSync(process.execPath, [CLI, 'story-plan', 'emit', '--file', 's.json', '--page', 'p.html', '--out', 'p.html'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /refusing to overwrite an input/);
    assert.equal(await fs.readFile(path.join(dir, 'p.html'), 'utf-8'), PAGE);
  });
  it('redline and swap never set position on the element; the outline lives only in the animation', () => {
    const h = emit(mk(), PAGE).html;
    const steps = h.slice(h.indexOf('<style data-story-step'));
    assert.ok(!/position\s*:\s*relative/.test(steps));
    const motion = steps.split('</style>').map(x => x.split('@media (prefers-reduced-motion:reduce)')[0]).join('\n');
    for (const m of motion.matchAll(/html\.story-play :is\([^)]*\)\{([^}]*)\}/g)) {
      assert.ok(!/(^|;)\s*(position|outline|display|width|height)\s*:/.test(m[1]), m[0]);
    }
    assert.match(steps, /:is\(\.btn\)\{anchor-name:--story-r3;anchor-scope:--story-r3\}/);
    assert.match(steps, /::after\{content:"mixed radii  12px";position:absolute;position-anchor:--story-r3;left:anchor\(left,0px\);top:anchor\(top,0px\)/);
    assert.match(steps, /@keyframes story-r3\{0%,100%\{outline-style:solid;[^}]*outline-color:transparent\}/);
  });
  it('swap text is one line as wide as the new text, at the old text position (no insets, no width:100%)', () => {
    const h = emit(swapStory('Start free trial today'), PAGE).html;
    const rule = /:is\(\.btn\)::before\{([^}]*)\}/.exec(h)[1];
    assert.match(rule, /content:"Start free trial today"/);
    assert.match(rule, /white-space:nowrap/);
    assert.match(rule, /width:max-content/);
    assert.ok(!/width:100%/.test(rule));
    assert.ok(!/(^|;)(left|top|right|bottom|inset)\s*:/.test(rule));
  });
  it('a comment or attribute that mentions <script>/<style> does not cut the page; a missing close drops only the open tag', () => {
    const c = preparePage('<body><!-- analytics <script> removed --><div class=card>kept</div><p>after</p></body>');
    assert.ok(c.body.includes('<!-- analytics <script> removed -->'));
    assert.ok(c.body.includes('<div class=card>kept</div><p>after</p>'));
    assert.equal(c.stripped.scripts, 0);
    const a = preparePage('<body><div title="<style>">one</div><p data-x=\'<script>\'>two</p><span>three</span></body>');
    assert.ok(a.body.includes('<div title="<style>">one</div>'));
    assert.ok(a.body.includes('<span>three</span>'));
    assert.equal(a.css, '');
    const u = preparePage('<body><p>a</p><style>.x{}<p>b</p><script src=x><p>c</p><iframe><p>d</p><embed src=y><p>e</p></body>');
    for (const t of ['<p>a</p>', '<p>b</p>', '<p>c</p>', '<p>d</p>', '<p>e</p>']) assert.ok(u.body.includes(t), t);
    assert.ok(!/<style|<script|<iframe|<embed/i.test(u.body));
    const cm = preparePage('<!-- <body class=fake> --><body class="real"><!-- <style>.no{}</style> --><style>.yes{}</style>ok<!-- </body> --></body>');
    assert.equal(cm.bodyAttrs, 'class="real"');
    assert.equal(cm.css, '.yes{}');
    assert.ok(cm.body.includes('ok<!-- </body> -->'));
    const t = preparePage('<head><title>about <script> tags</title></head><body>x<script>bad()</script></body>');
    assert.equal(t.body, 'x');
    const e = emit(mk(), '<!-- analytics <script> removed --><div class=card>kept</div>').html;
    assert.ok(e.includes('<div class=card>kept</div>'));
    assert.ok(e.includes('id="story-credit"'));
  });
  it('the scanner stays linear on 8 MiB of unclosed comments, styles, quotes and close-less tags', () => {
    const t0 = Date.now();
    for (const unit of ['<style>', '<iframe>', '<title>', '<!--', '<a x="', '<p title="<style>">', '<textarea>']) preparePage(unit.repeat(Math.floor(8 * 1024 * 1024 / unit.length)));
    assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0}ms`);
  });
  it('html/:root font-size stays on the real <html> so rem matches', () => {
    const p = preparePage('<style>html{font-size:62.5%;background:#eee} :root , .x{font-size:20px;color:red}@media (min-width:1px){html{font-size:50%}}body{font-size:1.6rem}/* html{font-size:1px} */</style><body>x</body>');
    assert.ok(p.css.includes('#story-page{background:#eee}html{font-size:62.5%}'), p.css);
    assert.ok(p.css.includes('.x{font-size:20px;color:red}#story-page{color:red}html{font-size:20px}'), p.css);
    assert.ok(p.css.includes('@media (min-width:1px){#story-page{}html{font-size:50%}}'), p.css);
    assert.ok(p.css.includes('#story-page{font-size:1.6rem}'));
    assert.ok(!p.css.includes('html{font-size:1px}'), 'a commented-out rule is not lifted');
    assert.ok(!/#story-page\{[^}]*font-size:62\.5%/.test(p.css));
    const h = emit(mk(), '<style>html{font-size:62.5%}</style><body><p>x</p></body>').html;
    assert.match(h, /<style data-story-page>\n#story-page\{\}html\{font-size:62\.5%\}/);
  });
  it('no credit: emit shows the default credit and check notes credit-missing (advisory)', async () => {
    for (const credit of [undefined, '', '  ']) {
      const s = mk({ credit }); if (credit === undefined) delete s.credit;
      const c = check(s);
      assert.equal(c.ok, true);
      assert.deepEqual(c.notes.map(n => n.code), ['credit-missing']);
      assert.ok(emit(s, PAGE).html.includes(`<div id="story-credit">${sp.DEFAULT_CREDIT}</div>`));
      assert.equal((await run(['check', '--strict'], io(JSON.stringify(s)))).exit, undefined);
    }
    assert.deepEqual(check(template()).notes, []);
    assert.ok(emit(mk({ credit: 'By Ada' }), PAGE).html.includes('<div id="story-credit">By Ada</div>'));
  });
  it('camera: validated by check, applied as a transform on #story-page; default no crop', () => {
    const only = (camera, format = 'square') => { const r = check(mk({ camera, format })); assert.ok(codes(r).includes('camera'), JSON.stringify(camera)); assert.equal(r.ok, false); };
    for (const c of [null, 'x', [], {}, { selector: '' }, { selector: '.a{' }, { selector: 5 }, { selector: '.a', x: 1 }, { x: 0, y: 0, w: 100 }, { x: 0, y: 0, w: 100, h: '1' }, { x: -1, y: 0, w: 500, h: 500 }, { x: 0, y: 0, w: 0, h: 500 }, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 5000, h: 5000 }, { x: 0, y: 0, w: 500, h: 500, z: 1 }]) only(c);
    assert.equal(check(mk({ camera: { selector: '.card' } })).ok, true);
    assert.equal(check(mk({ camera: { x: 0, y: 0, w: 270, h: 270 } })).ok, true);
    assert.equal(check(mk({ camera: { x: 0, y: 0, w: 4320, h: 4320 } })).ok, true);
    const none = emit(mk(), PAGE).html;
    assert.ok(!/transform-origin/.test(none.slice(0, none.indexOf('<style data-story-page>'))));
    assert.ok(!none.includes('data-story-camera'));
    const rect = emit(mk({ camera: { x: 100, y: 1200, w: 540, h: 270 } }), PAGE).html;
    assert.deepEqual(sp.cameraFit({ x: 100, y: 1200, w: 540, h: 270 }, { w: 1080, h: 1080 }), { scale: 2, tx: -200, ty: -2130 });
    assert.ok(rect.includes('#story-page{height:1470px;transform-origin:0 0;transform:translate(-200px,-2130px) scale(2)}'));
    const sel = emit(mk({ camera: { selector: '.card' } }), PAGE).html;
    const scr = /<script data-story-camera>([\s\S]*?)<\/script>/.exec(sel);
    assert.ok(scr && scr[1].includes('querySelector(".card")'));
    assert.equal((sel.match(/<script/g) || []).length, 1);
    assert.ok(!/setTimeout|setInterval|requestAnimationFrame|Date|performance/.test(scr[1]));
    const wide = emit(mk({ format: 'wide', camera: { x: 0, y: 0, w: 960, h: 540 } }), PAGE).html;
    assert.ok(wide.includes('transform:translate(0px,0px) scale(2)'));
  });
  it('the page declares its format and emit reports format and stripped', async () => {
    assert.ok(emit(mk(), PAGE).html.includes('<meta name="story-format" content="square">'));
    const w = emit(mk({ format: 'wide' }), PAGE);
    assert.ok(w.html.includes('<meta name="story-format" content="wide">'));
    assert.equal(w.format, 'wide');
    assert.deepEqual(w.stripped, { scripts: 2, links: 1 });
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 's.json'), JSON.stringify(mk({ format: 'wide' })));
    await fs.writeFile(path.join(dir, 'p.html'), PAGE);
    const o = await run(['emit', '--file', 's.json', '--page', 'p.html', '--out', 'o.html'], io('', dir));
    assert.deepEqual(Object.keys(o).sort(), ['bytes', 'duration_ms', 'format', 'out', 'steps', 'stripped']);
    assert.equal(o.format, 'wide');
    assert.deepEqual(o.stripped, { scripts: 2, links: 1 });
    const r = await run(['emit', '--file', 's.json', '--page', 'p.html'], io('', dir));
    assert.deepEqual(Object.keys(r).sort(), ['duration_ms', 'format', 'html', 'steps', 'stripped']);
    const c = await run(['check', '--file', 's.json'], io('', dir));
    assert.deepEqual(Object.keys(c).sort(), ['duration_ms', 'notes', 'ok', 'problems', 'timeline']);
  });
});

describe('browser probe (skipped when playwright cannot be resolved; STORY_PLAN_PLAYWRIGHT may name its module path)', () => {
  it('the first frame matches the original page; rem matches; a longer swap stays on one line', async t => {
    let pw = null;
    try { pw = await import(process.env.STORY_PLAN_PLAYWRIGHT || 'playwright'); } catch { /* not installed */ }
    const chromium = pw && (pw.chromium || (pw.default && pw.default.chromium));
    if (!chromium) { t.skip('playwright not resolvable'); return; }
    let b;
    try { b = await chromium.launch(); } catch (e) { t.skip(`browser did not start: ${String(e.message).split('\n')[0]}`); return; }
    try {
      const dir = await tmp();
      const orig = '<!doctype html><html><head><style>html{font-size:62.5%}body{margin:0;font:1.6rem sans-serif}.card{position:relative;padding:2rem;height:12rem;width:40rem;background:#eee;margin:40px}.btn{position:absolute;right:10px;top:10px;padding:8px 12px}</style></head><body><!-- analytics <script> removed --><h1>Pricing</h1><div class="card"><button class="btn">Go</button></div></body></html>';
      await fs.writeFile(path.join(dir, 'o.html'), orig);
      await fs.writeFile(path.join(dir, 's.html'), emit(template(), orig).html);
      const p = await b.newPage({ viewport: { width: 1080, height: 1080 } });
      const rects = () => p.evaluate(() => ['.btn', '.card', 'h1'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
      await p.goto(`file://${path.join(dir, 'o.html')}`);
      const before = await rects();
      await p.goto(`file://${path.join(dir, 's.html')}`);
      const at = ms => p.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }), ms);
      await at(0);
      assert.deepEqual(await rects(), before);
      await at(check(template()).duration_ms);
      const sw = await p.evaluate(() => { const e = document.querySelector('.btn'), s = getComputedStyle(e, '::before'); return { ws: s.whiteSpace, h: parseFloat(s.height), fs: parseFloat(s.fontSize), pos: getComputedStyle(e).position }; });
      assert.equal(sw.ws, 'nowrap');
      assert.ok(sw.h < sw.fs * 2, `swap text is ${sw.h}px tall at ${sw.fs}px`);
      assert.equal(sw.pos, 'absolute');
    } finally { await b.close(); }
  });
});
