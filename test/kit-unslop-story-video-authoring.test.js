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
const ATTACKS = [
  `<img/onerror="fetch('http://example.com/x')" src=x>`,
  `<img src=x y=< onerror="fetch('http://example.com/y')">`,
  `<img src="x"/onerror=alert(2)>`,
  `<img\tonerror=alert(1) src=x>`,
  `<img src=x\nonerror=alert(1)>`,
  `<img src='x'onerror=alert(1)>`,
  `<svg><animate onbegin=alert(3) /></svg>`,
  `<a href=" javascript:alert(1)">x</a>`,
  `<a href="&#106;avascript:alert(1)">y</a>`,
  `<a href="jav&#x09;ascript:alert(1)">y</a>`,
  `<form action=javascript:alert(1)><button formaction="java&Tab;script:alert(1)">z</button></form>`,
  `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>`,
  `<!--><img src=x onerror=alert(1)>`,
];
const tmp = async () => fs.mkdtemp(path.join(os.tmpdir(), 'story-plan-'));
// Each emit carries a fresh random CSP nonce (review r5); comparisons of two emits replace it with N, and nonceOf reads it.
const unnonce = h => h.replace(/nonce="[A-Za-z0-9+/=]{24}"/g, 'nonce="N"').replace(/'nonce-[A-Za-z0-9+/=]{24}'/g, "'nonce-N'");
const nonceOf = h => /<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-([A-Za-z0-9+/=]{24})'/.exec(h)[1];

describe('header contract', () => {
  it('documents every code, flag and exit that the code produces', async () => {
    const src = await fs.readFile(path.join(ROOT, 'src/lib/kit/story-plan.js'), 'utf-8');
    const head = src.slice(0, src.indexOf('*/'));
    for (const c of ['bad-title', 'bad-format', 'unknown-key', 'bad-shape', 'step-count', 'step-id', 'step-id-duplicate', 'step-label', 'step-empty', 'css-selector', 'css-prop', 'css-value', 'css-content', 'pill-radius', 'swap-length', 'swap-count', 'swap-selector-reuse', 'tween-range', 'hold-range', 'easing', 'intro-outro', 'duration', 'redline-label', 'redline-measure', 'redline-selector-reuse', 'redline-missing', 'credit-length']) assert.ok(head.includes(c), c);
    for (const f of ['--file', '--strict', '--page', '--out', 'template', 'duration_ms', 'timeline', 'problems', 'story-duration-ms', 'prefers-reduced-motion', '8 MiB', 'no foreign code']) assert.ok(head.includes(f), f);
    for (const f of ['notes', 'credit-missing', 'camera', 'stripped: { scripts, links }', '{ out, bytes, duration_ms, steps, format, stripped }', 'same file as --page or --file', 'story-format', '--format wide', 'no crop', 'Redesign by the author', 'data-story-camera']) assert.ok(head.includes(f), f);
    assert.ok(head.includes('500px and up') && !head.includes('999px and up'));
    assert.ok(head.includes('new text wider than the') && head.includes('overflows it') && head.includes('wide enough'));
    for (const f of ['swap-replaced', 'swap-ink', 'REPLACED', 'data-story-marks', '<story-swap>', '<story-tag>', '<story-layer>', '--story-aN', 'document.fonts', 'window load event', 'x + w']) assert.ok(head.includes(f), f);
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
    for (const [v, bad] of [['499px', false], ['499.9', false], ['500px', true], ['500', true]]) assert.equal(check(withStep({ css: { '.x': { 'border-radius': v } }, redline: { selector: '.x', label: 'r' } })).problems.some(p => p.code === 'pill-radius'), bad, v);
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
    // The page's own script is gone; the only script is the emitted one that places the swap text and redline tags.
    assert.ok(!r.html.includes('alert(1)'));
    assert.deepEqual(unnonce(r.html).match(/<script[^>]*>/gi), ['<script data-story-marks nonce="N">']);
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
    // html/:root rules go to #story-page (the root), body rules, class and style to #story-body inside it.
    assert.ok(r.html.includes('#story-body{margin:0;background:#eee}'));
    assert.ok(r.html.includes('<div id="story-page">\n<div id="story-body" class="app">\n<h1>Hi</h1>'));
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
    assert.ok(!/<script>x/i.test(h));
    assert.deepEqual(unnonce(h).match(/<script[^>]*>/gi), ['<script data-story-marks nonce="N">']);
    assert.ok(h.includes('content:"a\\"\\3c /style\\3e \\3c script\\3e x"'));
    assert.equal((h.match(/<\/style>/g) || []).length, 1 + 1 + 3);
  });
  it('refuses a story that is not ok', () => {
    assert.throws(() => emit(mk({ format: 'x' }), PAGE), e => e instanceof KitExit && e.code === 1 && /bad-format/.test(e.message));
  });
  it('is deterministic', () => {
    const again = emit(story, PAGE).html;
    assert.equal(unnonce(again), unnonce(r.html));
    assert.notEqual(nonceOf(again), nonceOf(r.html), 'only the CSP nonce differs, and it does');
  });
  it('page prep: bare fragments, unclosed script and 8 MiB of tag-like text stay linear', () => {
    assert.ok(emit(mk(), '<p>just a fragment</p><script>x').html.includes('<p>just a fragment</p>'));
    assert.equal(preparePage('<style>html body{color:red} html{x:1}</style><body>ok</body>').css, '#story-body{color:red} #story-page{x:1}');
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
    assert.equal(unnonce(written), unnonce(r.html));
    assert.equal(o.bytes, Buffer.byteLength(written));
    const viaStdin = await run(['emit', '--page', 'p.html'], io(JSON.stringify(template()), dir));
    assert.equal(unnonce(viaStdin.html), unnonce(r.html));
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
    // The tag is an overlay <story-tag> anchored to the element (a unique anchor-name per matched element, set by the
    // emitted script), never the element's own ::after.
    assert.ok(!/:is\([^)]*\)::(before|after)/.test(steps));
    assert.match(steps, /story-tag\[data-story-tag="r3"\]\{position:absolute;left:anchor\(left,0px\);top:anchor\(top,0px\)/);
    assert.ok(steps.includes('story-tag[data-story-tag="r3"]::before{content:"mixed radii  12px"}'));
    assert.match(h, /e\.style\.setProperty\("anchor-name"/);
    assert.match(h, /t\.style\.setProperty\("position-anchor",a\)/);
    assert.match(steps, /@keyframes story-r3\{0%,100%\{outline-style:solid;[^}]*outline-color:transparent\}/);
  });
  it('swap text is one line as wide as the new text, at the old text position (no insets, no width:100%)', () => {
    const h = emit(swapStory('Start free trial today'), PAGE).html;
    const rule = /story-swap\[data-story-swap="w3"\]\{([^}]*)\}/.exec(h)[1];
    assert.ok(h.includes('story-swap[data-story-swap="w3"]::before{content:"Start free trial today"}'));
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
  it('on* handlers and javascript: URLs are removed whatever separates them from the tag', () => {
    for (const a of ATTACKS) {
      const b = preparePage(`<body>${a}<p class=ok onclick=x()>kept</p></body>`).body;
      assert.ok(!/(?:\s|\/|['"])on[a-z]+\s*=/i.test(b), `${a} -> ${b}`);
      assert.ok(!/javascript:/i.test(b.replace(/&#(x?)[0-9a-f]+;?/gi, '')) || !/(href|src|action)=/.test(b), `${a} -> ${b}`);
      assert.ok(b.includes('<p class=ok >kept</p>') || b.includes('<p class=ok>kept</p>'), `${a} -> ${b}`);
      assert.ok(!/\bon[a-z]+\s*=/i.test(emit(mk(), a).html.split('story-page')[0] || ''), a);
    }
    assert.ok(preparePage('<img src=x loading=lazy alt=a>').body.includes('loading="eager"'));
    assert.ok(preparePage('<a href="https://x.test/?a=1&b=2" title="on x=1">k</a>').body.includes('href="https://x.test/?a=1&b=2" title="on x=1"'));
  });
  it('a tag that never ends and holds an on*= attribute is dropped', () => {
    for (const t of ['<img src="x" onerror=alert(1)', '<img src="x onerror=alert(1)', '<img "onerror=alert(1)']) {
      const b = preparePage(`<body><p>a</p>${t}`).body;
      assert.ok(!/onerror/.test(b) || !/\bonerror\s*=/.test(b), b);
    }
    assert.equal(preparePage('<body><p>a</p><img src="x').body, '<p>a</p><img src="x');
  });
  it('<base> and <meta http-equiv> are dropped anywhere in the page and counted in stripped.links', () => {
    const p = preparePage('<html><head><meta http-equiv="refresh" content="0;url=http://example.com/"><meta charset="utf-8"><base href="http://example.com/"></head><body><meta http-equiv="refresh" content="0;url=http://example.com/r"><base href="http://example.com/base/"><img src="rel.png"><META HTTP-EQUIV=refresh content=0></body></html>');
    assert.ok(!/<base|http-equiv/i.test(p.body), p.body);
    assert.ok(p.body.includes('<img src="rel.png">'));
    assert.equal(p.stripped.links, 5);
  });
  it('the tag cleaner stays linear on 8 MiB of handler-like and unterminated tags', () => {
    const t0 = Date.now();
    for (const unit of ['<a x=<', '<img/on', '<a onerror=', '<a on', '<meta http-equiv', '<base ', '<noscript>', '<a b=c/', '<xmp>', '<a "', '<img/onerror=x ']) preparePage(unit.repeat(Math.floor(8 * 1024 * 1024 / unit.length)));
    preparePage('on'.repeat(4 * 1024 * 1024));
    assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0}ms`);
  });
  it('html/:root font-size stays on the real <html> so rem matches', () => {
    const p = preparePage('<style>html{font-size:62.5%;background:#eee} :root , .x{font-size:20px;color:red}@media (min-width:1px){html{font-size:50%}}body{font-size:1.6rem}/* html{font-size:1px} */</style><body>x</body>');
    assert.ok(p.css.includes('#story-page{background:#eee}html{font-size:62.5%}'), p.css);
    assert.ok(p.css.includes('.x{font-size:20px;color:red}#story-page{color:red}html{font-size:20px}'), p.css);
    assert.ok(p.css.includes('@media (min-width:1px){#story-page{}html{font-size:50%}}'), p.css);
    assert.ok(p.css.includes('#story-body{font-size:1.6rem}'));
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
    const scr = /<script data-story-camera nonce="[^"]+">([\s\S]*?)<\/script>/.exec(sel);
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

describe('browser probe: stripped pages run no handlers and stay on the page (skipped when playwright cannot be resolved)', () => {
  it('none of the handlers run and no base or refresh moves the page', async t => {
    let pw = null;
    try { pw = await import(process.env.STORY_PLAN_PLAYWRIGHT || 'playwright'); } catch { /* not installed */ }
    const chromium = pw && (pw.chromium || (pw.default && pw.default.chromium));
    if (!chromium) { t.skip('playwright not resolvable'); return; }
    let b;
    try { b = await chromium.launch(); } catch (e) { t.skip(`browser did not start: ${String(e.message).split('\n')[0]}`); return; }
    try {
      const dir = await tmp();
      const orig = `<!doctype html><html><body><meta http-equiv="refresh" content="0;url=http://example.com/r"><base href="http://example.com/base/">${ATTACKS.join('')}<img src="rel.png"><div class=card><button class=btn>Go</button><h1>Hi</h1></div></body></html>`;
      await fs.writeFile(path.join(dir, 's.html'), emit(template(), orig).html);
      const p = await b.newPage();
      const reqs = [], dialogs = [];
      await p.route('**/*', r => { const u = r.request().url(); if (!u.startsWith('file:')) { reqs.push(u); return r.abort(); } return r.continue(); });
      p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
      const url = `file://${path.join(dir, 's.html')}`;
      await p.goto(url);
      await p.waitForTimeout(500);
      assert.deepEqual(reqs, []);
      assert.deepEqual(dialogs, []);
      assert.equal(p.url(), url);
    } finally { await b.close(); }
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
      const sw = await p.evaluate(() => { const e = document.querySelector('.btn'), s = getComputedStyle(e.querySelector(':scope > story-swap')); return { ws: s.whiteSpace, h: parseFloat(s.height), fs: parseFloat(s.fontSize), pos: getComputedStyle(e).position }; });
      assert.equal(sw.ws, 'nowrap');
      assert.ok(sw.h < sw.fs * 2, `swap text is ${sw.h}px tall at ${sw.fs}px`);
      assert.equal(sw.pos, 'absolute');
    } finally { await b.close(); }
  });
});

describe('review r2 regressions', () => {
  const base = { title: 't', format: 'square', credit: 'x' };
  const st = (id, over) => ({ id, label: id, ...over });
  const mixedSelectors = { ...base, steps: [st('a', { css: { h1: { color: 'rgb(0,0,255)' } } }), st('b', { swap: { selector: '.hero h1', text: 'Hello' } }), st('c', { css: { '.q': { opacity: '0.5' } } })] };
  const colorAfterSwap = { ...base, steps: [st('a', { swap: { selector: '.btn', text: 'Start free' } }), st('b', { css: { '.btn': { color: 'rgb(255,255,255)', 'background-color': 'rgb(0,0,0)' } } }), st('c', { css: { '.q': { opacity: '0.5' } } })] };
  const pseudoStory = { ...base, steps: [st('a', { css: { '.row': { padding: '10px' } }, redline: { selector: '.row', label: 'pad' } }), st('b', { swap: { selector: '.btn', text: 'Start' } }), st('c', { css: { '.q': { opacity: '0.5' } }, redline: { selector: 'img', label: 'img' } })] };
  const cameraStory = { ...base, camera: { selector: '.card' }, steps: [st('a', { css: { '.card': { 'background-color': 'red' } } }), st('b', { css: { '.q': { color: 'red' } } }), st('c', { css: { '.q': { opacity: '0.5' } } })] };

  it('two selector strings for one element share one animation list (custom property slots, no inheritance)', () => {
    assert.equal(check(mixedSelectors).ok, true);
    const h = emit(mixedSelectors, '<body><div class="hero"><h1>Hi</h1></div><p class="q">q</p></body>').html;
    assert.ok(h.includes('html.story-play *{--story-a1:none;--story-a2:none;--story-a3:none;--story-a4:none}'));
    assert.ok(h.includes('html.story-play :is(h1,.hero h1,.q){animation:var(--story-a1,none),var(--story-a2,none),var(--story-a4,none),var(--story-a3,none)}'));
    assert.ok(h.includes('html.story-play :is(h1){--story-a1:story-s1-0 600ms ease-in-out 500ms 1 normal forwards}'));
    // The swap's element-side slots play only once the marks script has run (html.story-marks).
    assert.ok(h.includes('html.story-play.story-marks :is(.hero h1){--story-a2:story-w2 600ms ease-in-out 2000ms 1 normal forwards;--story-a3:story-w2-hide 0ms linear 2600ms 1 normal forwards}'));
    assert.ok(!/:is\([^)]*\)\{animation:story-/.test(h), 'no per-selector animation shorthand that another selector could override');
  });
  it('a swap hide slot comes after every other slot, so a later colour step cannot bring the old text back; check notes swap-ink', () => {
    const h = emit(colorAfterSwap, '<body><button class="btn">Go</button><p class="q">q</p></body>').html;
    const list = /:is\(\.btn,\.q\)\{animation:([^}]*)\}/.exec(h)[1].split(/,(?=var)/);
    assert.deepEqual(list, ['var(--story-a1,none)', 'var(--story-a3,none)', 'var(--story-a4,none)', 'var(--story-a2,none)']);
    assert.ok(h.includes('--story-a2:story-w1-hide 0ms linear 1100ms 1 normal forwards'));
    assert.match(h, /@media \(prefers-reduced-motion:reduce\)\{html\.story-play\.story-marks :is\(\.btn\):not\(#story-nil#story-nil#story-nil\)\{color:transparent !important\}\}/);
    const c = check(colorAfterSwap);
    assert.equal(c.ok, true);
    assert.deepEqual(c.notes.map(n => n.code), ['swap-ink']);
    assert.match(c.notes[0].message, /^b: "\.btn"/);
  });
  it('swap and redline never style the element\'s own ::before/::after; the overlay base rules ship with the page', () => {
    const h = emit(pseudoStory, '<style>.btn::before{content:"\\2192 "}</style><body><div class="row"></div><button class="btn">Go</button></body>').html;
    const steps = h.slice(h.indexOf('<style data-story-step'));
    assert.ok(!/::(before|after)/.test(steps.replace(/story-(swap|tag)\[[^\]]*\]::before/g, '')));
    assert.ok(h.includes('story-layer{display:contents !important}'));
    assert.ok(h.includes('@supports not (anchor-name:--story-a){story-tag{display:none !important}}'));
    assert.match(h, /e\.insertBefore\(n,e\.firstChild\)/);
    assert.match(h, /if\(k\)P\.appendChild\(L\)/);
  });
  it('the selector camera measures on load and again when fonts are ready, from the t=0 state, without timers', () => {
    const h = emit(cameraStory, '<body><img src="big.svg"><div class="card">c</div><p class="q">q</p></body>').html;
    const scr = /<script data-story-camera nonce="[^"]+">([\s\S]*?)<\/script>/.exec(h)[1];
    assert.ok(scr.includes('if(document.readyState==="complete")fit();else addEventListener("load",fit);'));
    assert.ok(scr.includes('document.fonts.ready.then(function(){if(document.readyState==="complete")fit()})'));
    assert.ok(scr.includes('P.style.transform="";P.style.height="";'));
    assert.ok(scr.includes('x.currentTime=0'));
    assert.ok(!/setTimeout|setInterval|requestAnimationFrame|Date|performance/.test(scr));
    assert.equal((h.match(/<script/g) || []).length, 1);
  });
  it('check refuses a camera rect past the page\'s right edge', () => {
    const cam = (camera, format = 'square') => codes(check({ ...cameraStory, camera, format })).includes('camera');
    for (const c of [{ x: 1080, y: 0, w: 540, h: 540 }, { x: 600, y: 0, w: 540, h: 540 }, { x: 10, y: 0, w: 2160, h: 2160 }, { x: 1500, y: 0, w: 960, h: 540 }]) assert.ok(cam(c, c.x === 1500 ? 'wide' : 'square'), JSON.stringify(c));
    for (const c of [{ x: 540, y: 0, w: 540, h: 540 }, { x: 0, y: 3000, w: 1080, h: 1080 }, { x: 0, y: 0, w: 4320, h: 4320 }]) assert.ok(!cam(c), JSON.stringify(c));
    assert.ok(!cam({ x: 960, y: 0, w: 960, h: 540 }, 'wide'));
  });
  it('check flags a swap on an element that cannot hold text (img, input, video, ...); a redline on one is fine', () => {
    const sw = sel => codes(check({ ...base, steps: [st('a', { swap: { selector: sel, text: 'x' } }), st('b', { css: { '.q': { opacity: '0' } } }), st('c', { css: { '.q': { opacity: '1' } } })] }));
    for (const sel of ['img', 'input', '.card img', 'div > video.hero', '.a, input[type="text"]', 'textarea', 'svg', 'select:focus', 'br']) assert.ok(sw(sel).includes('swap-replaced'), sel);
    for (const sel of ['.img', '.card', 'button', 'a[href="img"]', 'p:not(img)', '#input', 'img-box']) assert.ok(!sw(sel).includes('swap-replaced'), sel);
    assert.deepEqual(sp.lastTypes('.a img, b > input:hover, .c'), ['img', 'input']);
    for (const tag of sp.REPLACED) assert.ok(sw(`.wrap > ${tag}`).includes('swap-replaced'), tag);
    assert.equal(check(pseudoStory).ok, true);
  });

  describe('browser probes (skipped when playwright cannot be resolved)', () => {
    const browser = async (t, fn) => {
      let pw = null;
      try { pw = await import(process.env.STORY_PLAN_PLAYWRIGHT || 'playwright'); } catch { /* not installed */ }
      const chromium = pw && (pw.chromium || (pw.default && pw.default.chromium));
      if (!chromium) { t.skip('playwright not resolvable'); return; }
      let b;
      try { b = await chromium.launch(); } catch (e) { t.skip(`browser did not start: ${String(e.message).split('\n')[0]}`); return; }
      try { await fn(b, await tmp()); } finally { await b.close(); }
    };
    const open = async (b, file, opts = {}) => {
      const p = await b.newPage({ viewport: { width: 1080, height: 1080 }, ...opts });
      await p.goto(`file://${file}`);
      p.at = ms => p.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }), ms);
      return p;
    };

    it('selector camera: an image without dimensions above the target is loaded before the measure, also under a paused fake clock', async t => browser(t, async (b, dir) => {
      await fs.writeFile(path.join(dir, 'big.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#36c"/></svg>');
      await fs.writeFile(path.join(dir, 's.html'), emit(cameraStory, '<body style="margin:0"><img src="big.svg"><div class="card" style="width:200px;height:100px;background:#eee">c</div><p class="q">q</p></body>').html);
      const read = p => p.evaluate(() => {
        const a = document.getElementById('story-page'), tr = a.style.transform;
        a.style.transform = '';
        const top = document.querySelector('.card').getBoundingClientRect().top - a.getBoundingClientRect().top;
        a.style.transform = tr;
        return { tr, top };
      });
      const want = top => { const y = top - 24, h = 148, s = Math.min(4, 1080 / 248, 1080 / h); return `translate(${(1080 - 248 * s) / 2 - (-24) * s}px, ${(1080 - h * s) / 2 - y * s}px) scale(${s})`; };
      const live = await read(await open(b, path.join(dir, 's.html')));
      assert.ok(live.top >= 300, `card sits below the 300px image, at ${live.top}`);
      assert.equal(live.tr, want(live.top));
      // As story-render drives it: a fake clock paused before load, then every animation paused at t=0 for frame 0.
      const ctx = await b.newContext({ viewport: { width: 1080, height: 1080 } });
      const p = await ctx.newPage();
      await p.clock.install({ time: 0 });
      await p.clock.pauseAt(1000);
      await p.goto(`file://${path.join(dir, 's.html')}`);
      await p.evaluate(() => document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; }));
      const f0 = await read(p);
      assert.equal(f0.tr, live.tr);
      await ctx.close();
    }));

    it('h1 and .hero h1: both steps run on the one element', async t => browser(t, async (b, dir) => {
      await fs.writeFile(path.join(dir, 's.html'), emit(mixedSelectors, '<body><div class="hero"><h1 style="color:rgb(255,0,0)">Hi</h1></div><p class="q">q</p></body>').html);
      const p = await open(b, path.join(dir, 's.html'));
      const color = () => p.evaluate(() => getComputedStyle(document.querySelector('h1')).color);
      assert.deepEqual(await p.evaluate(() => document.querySelector('h1').getAnimations().map(a => a.animationName)), ['story-s1-0', 'story-w2', 'story-w2-hide']);
      assert.deepEqual(await p.evaluate(() => document.querySelector('.q').getAnimations().map(a => a.animationName)), ['story-s3-0']);
      await p.at(0); assert.equal(await color(), 'rgb(255, 0, 0)');
      await p.at(1100); assert.equal(await color(), 'rgb(0, 0, 255)');
      await p.at(check(mixedSelectors).duration_ms); assert.equal(await color(), 'rgba(0, 0, 0, 0)');
    }));

    it('a colour step after a swap keeps the old text hidden, with and without reduced motion', async t => browser(t, async (b, dir) => {
      await fs.writeFile(path.join(dir, 's.html'), emit(colorAfterSwap, '<body><button class="btn" style="color:rgb(0,0,0)">Go</button><p class="q">q</p></body>').html);
      const D = check(colorAfterSwap).duration_ms;
      const probe = p => p.evaluate(() => { const e = document.querySelector('.btn'), n = e.querySelector(':scope > story-swap'); return { old: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor, text: getComputedStyle(n, '::before').content, ink: getComputedStyle(n).color, op: getComputedStyle(n).opacity }; });
      const p = await open(b, path.join(dir, 's.html'));
      await p.at(D);
      // No swap.ink: the new text takes the element's own colour when the swap starts (black here; check notes swap-ink
      // because step b turns the background black), and under reduced motion the element's final colour (white).
      assert.deepEqual(await probe(p), { old: 'rgba(0, 0, 0, 0)', bg: 'rgb(0, 0, 0)', text: '"Start free"', ink: 'rgb(0, 0, 0)', op: '1' });
      const r = await open(b, path.join(dir, 's.html'), { reducedMotion: 'reduce' });
      assert.deepEqual(await probe(r), { old: 'rgba(0, 0, 0, 0)', bg: 'rgb(0, 0, 0)', text: '"Start free"', ink: 'rgb(255, 255, 255)', op: '1' });
    }));

    it('frame 0 is pixel-identical to the original with an icon ::before and a clearfix ::after on the swapped and redlined elements', async t => browser(t, async (b, dir) => {
      const img = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#c33"/></svg>').toString('base64');
      const orig = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}.btn::before{content:"\\2192 "}.row{background:#def}.row::after{content:"";display:table;clear:both}.f{float:left;height:100px;width:50px;background:#9ab}.row>:last-child{margin-bottom:0}</style></head><body><div class="row"><div class="f"></div></div><p class="after">below</p><button class="btn">Go</button><p class="q">q</p><img src="${img}" style="margin:40px"></body></html>`;
      await fs.writeFile(path.join(dir, 'o.html'), orig);
      await fs.writeFile(path.join(dir, 's.html'), emit(pseudoStory, orig).html);
      const probe = () => ({ icon: getComputedStyle(document.querySelector('.btn'), '::before').content, rowH: document.querySelector('.row').getBoundingClientRect().height, belowY: document.querySelector('.after').getBoundingClientRect().y, btn: JSON.stringify(document.querySelector('.btn').getBoundingClientRect()) });
      const o = await open(b, path.join(dir, 'o.html'));
      const want = await o.evaluate(probe);
      const shot0 = await o.screenshot();
      assert.equal(want.rowH, 100);
      const p = await open(b, path.join(dir, 's.html'));
      await p.at(0);
      assert.deepEqual(await p.evaluate(probe), want);
      // Pixel compare. Chromium antialiases an element that has an opacity/filter/transform animation (even one not yet
      // started, or plain will-change) up to 1 level differently, so a channel may differ by 1; a lost icon or clearfix
      // differs by far more. The same compare at the end must find the icon and swap text changed (it is not blind).
      const diff = async (x, y) => o.evaluate(async ([x, y]) => {
        const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
        const [ia, ib] = await Promise.all([load(x), load(y)]);
        const px = i => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
        const da = px(ia), db = px(ib);
        let m = 0; for (let k = 0; k < da.length; k++) m = Math.max(m, Math.abs(da[k] - db[k]));
        return m;
      }, [x, y].map(buf => `data:image/png;base64,${buf.toString('base64')}`));
      assert.ok(await diff(await p.screenshot(), shot0) <= 1, 'frame 0 differs from the original screen');
      // Inside the redline windows the tags sit on their elements (the img too), and the page's pseudo-elements stay.
      const tl = check(pseudoStory).timeline;
      const tag = (key, sel) => p.evaluate(([key, sel]) => { const t = document.querySelector(`story-tag[data-story-tag="${key}"]`).getBoundingClientRect(), e = document.querySelector(sel).getBoundingClientRect(); return { dx: Math.round(t.left - e.left), dy: Math.round(t.bottom - e.top), op: Number(getComputedStyle(document.querySelector(`story-tag[data-story-tag="${key}"]`)).opacity) }; }, [key, sel]);
      await p.at(tl[0].start_ms + 700);
      assert.deepEqual(await tag('r1', '.row'), { dx: 0, dy: 0, op: 1 });
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.row'), '::after').display), 'table');
      await p.at(tl[2].start_ms + 700);
      assert.deepEqual(await tag('r3', 'img'), { dx: 0, dy: 0, op: 1 });
      await p.at(check(pseudoStory).duration_ms);
      const end = await p.evaluate(() => ({ icon: getComputedStyle(document.querySelector('.btn'), '::before').content, text: getComputedStyle(document.querySelector('.btn > story-swap'), '::before').content, op: getComputedStyle(document.querySelector('.btn > story-swap')).opacity }));
      assert.deepEqual(end, { icon: want.icon, text: '"Start"', op: '1' });
      assert.ok(await diff(await p.screenshot(), shot0) > 100, 'the end frame shows the swap');
    }));
  });
});

describe('review r3 regressions', () => {
  const base = { title: 't', format: 'square', credit: 'x' };
  const st = (id, over) => ({ id, label: id, ...over });
  const cssOnly = { ...base, steps: [st('a', { css: { h1: { color: 'rgb(0,0,255)' } } }), st('b', { css: { '.q': { opacity: '0.5' } } }), st('c', { css: { '.q': { 'letter-spacing': '1px' } } })] };
  const swapsA = { ...base, steps: [st('a', { swap: { selector: 'h1', text: 'Simple pricing' } }), st('b', { swap: { selector: 'p.r', text: 'Go' } }), st('c', { swap: { selector: 'button.btn', text: 'Go' } })] };
  const swapsB = { ...base, camera: { x: 0, y: 0, w: 540, h: 540 }, steps: [st('a', { swap: { selector: '.flex', text: 'Go' } }), st('b', { swap: { selector: 'p.l', text: 'Go' } }), st('c', { css: { '.q': { opacity: '0.5' } } })] };

  it('a css-only story emits no <script> at all, with no camera and with a rect camera', () => {
    assert.equal(check(cssOnly).ok, true);
    const page = '<body><h1>Hi</h1><p class="q">q</p><script>x()</script></body>';
    assert.equal(emit(cssOnly, page).html.match(/<script/gi), null);
    assert.equal(emit({ ...cssOnly, camera: { x: 0, y: 0, w: 540, h: 540 } }, page).html.match(/<script/gi), null);
    assert.equal(emit({ ...cssOnly, camera: { selector: 'h1' } }, page).html.match(/<script/gi).length, 1);
  });
  it('loading="lazy" is rewritten to eager in every quoting form; other attributes stay', () => {
    const b = preparePage('<body><img loading="lazy" src="a.png"><img src=b.png loading=lazy><img LOADING = \'lazy\' alt="loading=lazy"><img loading="eager" src="c.png"><img data-loading="lazy"></body>').body;
    assert.ok(!/\sloading\s*=\s*["']?lazy/i.test(b.replace('alt="loading=lazy"', '')), b);
    assert.equal((b.match(/loading\s*=\s*"eager"/gi) || []).length, 4, b);
    assert.ok(b.includes('alt="loading=lazy"') && b.includes('data-loading="lazy"') && b.includes('src=b.png'), b);
  });
  it('the swap slots on the element are gated on html.story-marks, which only the script adds', () => {
    const h = emit(swapsA, '<body><h1>Pricing</h1><p class="r">Right</p><button class="btn">Get started</button></body>').html;
    assert.match(h, /html\.story-play\.story-marks :is\(h1\)\{--story-a1:story-w1 [^}]*;--story-a2:story-w1-hide /);
    assert.ok(!/html\.story-play :is\((h1|p\.r|button\.btn)\)\{--story-a/.test(h));
    assert.ok(h.includes('document.documentElement.classList.add("story-marks")'));
    assert.ok(!/class="[^"]*story-marks/.test(h));
    const scr = /<script data-story-marks nonce="[^"]+">([\s\S]*?)<\/script>/.exec(h)[1];
    assert.ok(scr.includes('createRange()') && scr.includes('z(place);'), 'swaps are placed from a Range over the old text');
    assert.ok(!/setTimeout|setInterval|requestAnimationFrame|Date|performance/.test(scr));
  });
  it('body rules go to #story-body, which keeps the browser margin by default; background propagates only without a root background', () => {
    const h = emit(cssOnly, '<style>body{background:#eee}</style><body class="app"><h1>Hi</h1></body>').html;
    assert.ok(h.includes(':where(#story-body){display:block;margin:8px}'));
    assert.ok(!/html,body\{margin:0[^}]*\}[\s\S]*#story-body\{margin:0/.test(h.split('<style data-story-page>')[0]));
    assert.ok(h.includes('#story-body::before{content:"" !important;'));
    assert.ok(h.includes('#story-body{-webkit-background-clip:text !important;background-clip:text !important}'));
    const root = emit(cssOnly, '<style>html{background:#ddd}body{background:#fff}</style><body><h1>Hi</h1></body>').html;
    assert.ok(!root.includes('background-clip:text'));
    const both = emit(cssOnly, '<style>body::before{content:"a"}</style><body><h1>Hi</h1></body>').html;
    assert.ok(both.includes('#story-body::after{content:"" !important;') && !both.includes('#story-body::before{content:"" !important;'));
  });

  describe('browser probes (skipped when playwright cannot be resolved)', () => {
    const browser = async (t, fn, opts) => {
      let pw = null;
      try { pw = await import(process.env.STORY_PLAN_PLAYWRIGHT || 'playwright'); } catch { /* not installed */ }
      const chromium = pw && (pw.chromium || (pw.default && pw.default.chromium));
      if (!chromium) { t.skip('playwright not resolvable'); return; }
      let b;
      try { b = await chromium.launch(); } catch (e) { t.skip(`browser did not start: ${String(e.message).split('\n')[0]}`); return; }
      try { await fn(b, await tmp()); } finally { await b.close(); }
    };
    const open = async (b, file, opts = {}) => {
      const ctx = await b.newContext({ viewport: { width: 1080, height: 1080 }, ...opts });
      const p = await ctx.newPage();
      await p.goto(`file://${file}`);
      p.at = ms => p.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }), ms);
      return p;
    };
    const maxDiff = async (p, x, y) => p.evaluate(async ([x, y]) => {
      const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const px = i => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
      const da = px(ia), db = px(ib);
      let m = 0; for (let k = 0; k < da.length; k++) m = Math.max(m, Math.abs(da[k] - db[k]));
      return m;
    }, [x, y].map(buf => `data:image/png;base64,${buf.toString('base64')}`));
    // Old text = a Range over the element's contents after the <story-swap>; new text = the <story-swap> box.
    const where = p => p.evaluate(() => [...document.querySelectorAll('story-swap')].map(s => {
      const e = s.parentElement, r = document.createRange();
      r.selectNodeContents(e); r.setStartAfter(s);
      const o = r.getBoundingClientRect(), n = s.getBoundingClientRect();
      return { el: e.localName + (e.className ? '.' + e.className : ''), o: [o.left, o.right, (o.top + o.bottom) / 2, o.width], n: [n.left, n.right, (n.top + n.bottom) / 2, n.width] };
    }));
    const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} vs ${b}`);
    const checkPlace = (got, modes) => {
      assert.equal(got.length, Object.keys(modes).length, JSON.stringify(got));
      for (const g of got) {
        const m = modes[g.el];
        assert.ok(m, g.el);
        assert.ok(Math.abs(g.o[3] - g.n[3]) > 20, `${g.el}: the new text differs in width, so the check can tell the modes apart`);
        if (m === 'center') near((g.o[0] + g.o[1]) / 2, (g.n[0] + g.n[1]) / 2, `${g.el} centre`);
        if (m === 'right') near(g.o[1], g.n[1], `${g.el} right edge`);
        if (m === 'left') near(g.o[0], g.n[0], `${g.el} left edge`);
        near(g.o[2], g.n[2], `${g.el} vertical centre`);
      }
    };

    it('the swapped-in text lands on the old text: centred h1, right-aligned p, a <button>, a flex-centred button, a left p under a 2x camera', async t => browser(t, async (b, dir) => {
      const pa = '<!doctype html><html><head><style>h1{text-align:center;font:40px sans-serif}p.r{text-align:right;font:18px sans-serif}.btn{width:300px;font:20px sans-serif;padding:10px}</style></head><body><h1>Pricing that scales</h1><p class="r">Right aligned words here</p><div class="card"><button class="btn">Get started now</button></div></body></html>';
      await fs.writeFile(path.join(dir, 'a.html'), emit(swapsA, pa).html);
      const a = await open(b, path.join(dir, 'a.html'));
      for (const ms of [0, check(swapsA).duration_ms]) { await a.at(ms); checkPlace(await where(a), { h1: 'center', 'p.r': 'right', 'button.btn': 'center' }); }
      const pb = '<!doctype html><html><head><style>.flex{display:flex;justify-content:center;align-items:center;width:300px;height:60px;font:20px sans-serif}p.l{font:18px sans-serif;margin:30px}</style></head><body><button class="flex">Get started now</button><p class="l">Left aligned words here</p><p class="q">q</p></body></html>';
      await fs.writeFile(path.join(dir, 'b.html'), emit(swapsB, pb).html);
      const c = await open(b, path.join(dir, 'b.html'));
      await c.at(0);
      checkPlace(await where(c), { 'button.flex': 'center', 'p.l': 'left' });
    }));

    it('a loading=lazy image above a selector camera target loads before the measure, so the target stays in frame', async t => browser(t, async (b, dir) => {
      await fs.writeFile(path.join(dir, 'big.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="red"/></svg>');
      const story = { ...base, camera: { selector: '#target' }, steps: [st('a', { css: { '.btn': { color: '#ff0' } } }), st('b', { swap: { selector: '.btn', text: 'Go' } }), st('c', { css: { '.card': { opacity: '0.9' } } })] };
      const page = '<!doctype html><html><head><style>.btn{display:block;width:300px;text-align:center;font:20px sans-serif}</style></head><body><div class="card"><a class="btn">Get started now</a></div><div style="height:1500px">filler</div><img loading="lazy" src="big.svg"><h2 id="target">Target heading</h2></body></html>';
      const h = emit(story, page).html;
      assert.ok(h.includes('<img loading="eager" src="big.svg">'));
      await fs.writeFile(path.join(dir, 's.html'), h);
      const p = await open(b, path.join(dir, 's.html'));
      await p.at(0);
      const r = await p.evaluate(() => ({ img: document.querySelector('img').complete && document.querySelector('img').naturalHeight, t: document.getElementById('target').getBoundingClientRect().toJSON() }));
      assert.equal(r.img, 600);
      assert.ok(r.t.top >= 0 && r.t.bottom <= 1080, JSON.stringify(r.t));
    }));

    it('with JavaScript disabled a swapped element keeps its old text (no blank button)', async t => browser(t, async (b, dir) => {
      const page = '<!doctype html><html><head><style>.btn{color:rgb(0,0,0);font:20px sans-serif}</style></head><body><h1 style="color:rgb(10,20,30)">Pricing</h1><p class="r">r</p><button class="btn">Get started</button></body></html>';
      await fs.writeFile(path.join(dir, 's.html'), emit(swapsA, page).html);
      const D = check(swapsA).duration_ms;
      const probe = p => p.evaluate(() => ['h1', '.btn'].map(s => { const c = getComputedStyle(document.querySelector(s)); return [c.color, c.opacity, c.filter]; }).concat([document.querySelectorAll('story-swap').length, document.documentElement.className]));
      for (const reducedMotion of ['no-preference', 'reduce']) {
        const p = await open(b, path.join(dir, 's.html'), { javaScriptEnabled: false, reducedMotion });
        for (const ms of [0, 2000, D]) {
          await p.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }), ms).catch(() => {});
          assert.deepEqual(await probe(p), [['rgb(10, 20, 30)', '1', 'none'], ['rgb(0, 0, 0)', '1', 'none'], 0, 'story-play'], `${reducedMotion} at ${ms}`);
        }
      }
      // The same page with JavaScript on does swap (the gate opens).
      const on = await open(b, path.join(dir, 's.html'));
      await on.at(D);
      assert.deepEqual((await on.evaluate(() => [getComputedStyle(document.querySelector('.btn')).color, document.querySelectorAll('story-swap').length])), ['rgba(0, 0, 0, 0)', 3]);
    }));

    it('a page without a margin reset: frame 0 matches the original (body, class and root backgrounds) and a camera rect lines up', async t => browser(t, async (b, dir) => {
      const story = { ...base, steps: [st('a', { swap: { selector: 'h1', text: 'New' } }), st('b', { css: { '.q': { opacity: '0.5' } }, redline: { selector: '.q', label: 'q' } }), st('c', { css: { '.q': { opacity: '1' } } })] };
      const body = '<h1>Pricing that scales</h1><p class="q">Some text in a paragraph.</p><div class="box" style="width:200px;height:100px;background:#36c;margin-left:30px"></div>';
      const pages = {
        plain: `<!doctype html><html><head><style>h1{font:32px sans-serif}</style></head><body>${body}</body></html>`,
        bodybg: `<!doctype html><html><head><style>body{background:#f0e6d2;font:16px sans-serif}</style></head><body>${body}</body></html>`,
        classbg: `<!doctype html><html><head><style>.tint{background-color:rgb(249 250 251)}</style></head><body class="tint">${body}</body></html>`,
        rootbg: `<!doctype html><html><head><style>html{background:#ddd}body{background:#fff}</style></head><body>${body}</body></html>`,
      };
      for (const [name, orig] of Object.entries(pages)) {
        await fs.writeFile(path.join(dir, `${name}-o.html`), orig);
        await fs.writeFile(path.join(dir, `${name}-s.html`), emit(story, orig).html);
        const o = await open(b, path.join(dir, `${name}-o.html`));
        const rects = p => p.evaluate(() => ['h1', '.q', '.box'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
        const want = await rects(o);
        assert.equal(want[0][0], 8, `${name}: the original keeps the 8px body margin`);
        const p = await open(b, path.join(dir, `${name}-s.html`));
        await p.at(0);
        assert.deepEqual(await rects(p), want, name);
        assert.ok(await maxDiff(o, await p.screenshot(), await o.screenshot()) <= 1, `${name}: frame 0 differs from the original screen`);
        const box = want[2];
        // A 2x crop measured on the original: the box must land where the original's pixels say it is, scaled.
        const cam = { x: 0, y: Math.max(0, Math.round(box[1]) - 100), w: 540, h: 540 };
        await fs.writeFile(path.join(dir, `${name}-c.html`), emit({ ...story, camera: cam }, orig).html);
        const c = await open(b, path.join(dir, `${name}-c.html`));
        await c.at(0);
        const s = Math.min(1080 / cam.w, 1080 / cam.h);
        const got = (await rects(c))[2];
        for (const [i, v] of [(1080 - cam.w * s) / 2 + (box[0] - cam.x) * s, (1080 - cam.h * s) / 2 + (box[1] - cam.y) * s, box[2] * s, box[3] * s].entries()) near(got[i], v, `${name}: camera rect [${i}]`);
      }
    }));
  });
});

describe('review r5 regressions', () => {
  const base = { title: 't', format: 'square', credit: 'x' };
  const st = (id, over) => ({ id, label: id, ...over });
  const swapOnly = { ...base, steps: [st('a', { css: { '.q': { opacity: '0.5' } } }), st('b', { swap: { selector: '.btn', text: 'Start free' } }), st('c', { css: { '.q': { opacity: '1' } } })] };
  // A browser ends a comment at '--!>' too, and inside <svg>/<math> title, textarea, xmp and plaintext hold live markup.
  const R5_ATTACKS = [
    `<!-- x --!><img src=x onerror=alert(51)> -->`,
    `<!-- x --!><script>alert(52)</script> -->`,
    `<!--><img src=x onerror=alert(53)>`,
    `<!---><img src=x onerror=alert(54)>`,
    `<svg><title><img src=x onerror=alert(55)></title></svg>`,
    `<svg><textarea><img src=x onerror=alert(56)></textarea></svg>`,
    `<math><mi><title><img src=x onerror=alert(57)></title></mi></math>`,
    `<svg><title><script>alert(58)</script></title></svg>`,
    `<svg><xmp><img src=x onerror=alert(59)></xmp></svg>`,
    `<svg><plaintext><img src=x onerror=alert(60)></plaintext></svg>`,
    `<textarea><p title="</textarea><img src=x onerror=alert(61)>"></textarea>`,
    `<xmp><a title="</xmp><script>alert(62)</script>">x</a></xmp>`,
    `<title><!--</title><img src=x onerror=alert(63)>--></title>`,
    `<svg><title><a title="</title><img src=x onerror=alert(64)>"></a></title></svg>`,
  ];
  const browser = async (t, fn) => {
    let pw = null;
    try { pw = await import(process.env.STORY_PLAN_PLAYWRIGHT || 'playwright'); } catch { /* not installed */ }
    const chromium = pw && (pw.chromium || (pw.default && pw.default.chromium));
    if (!chromium) { t.skip('playwright not resolvable'); return; }
    let b;
    try { b = await chromium.launch(); } catch (e) { t.skip(`browser did not start: ${String(e.message).split('\n')[0]}`); return; }
    try { await fn(b, await tmp()); } finally { await b.close(); }
  };
  const open = async (b, file, opts = {}) => {
    const ctx = await b.newContext({ viewport: { width: 1080, height: 1080 }, ...opts });
    const p = await ctx.newPage();
    p.dialogs = [];
    p.on('dialog', d => { p.dialogs.push(d.message()); d.dismiss(); });
    await p.goto(`file://${file}`);
    p.at = ms => p.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }), ms);
    return p;
  };

  it('comments end at --!>, <!--> and <!--->; title/textarea/xmp/plaintext text is cleaned as markup (svg/math)', () => {
    for (const a of R5_ATTACKS) {
      const p = preparePage(`<body>${a}<p class=ok onclick=x()>kept</p></body>`);
      assert.ok(!/(?:\s|\/|['"])on[a-z]+\s*=/i.test(p.body), `${a} -> ${p.body}`);
      assert.ok(!/<script/i.test(p.body), `${a} -> ${p.body}`);
      assert.ok(p.body.includes('<p class=ok >kept</p>') || p.body.includes('<p class=ok>kept</p>'), `${a} -> ${p.body}`);
    }
    // A <script> mentioned in an HTML title's text still costs only the open tag, and a script holding '</textarea>' in
    // a string, outside any textarea, is still dropped whole.
    assert.equal(preparePage('<head><title>about <script> tags</title></head><body>x<script>bad()</script></body>').body, 'x');
    assert.equal(preparePage('<body>a<script>var s="</textarea>"</script>b<textarea>t</textarea></body>').body, 'ab<textarea>t</textarea>');
    assert.equal(preparePage('<body><textarea>plain <b>text</b></textarea><p>after</p></body>').body, '<textarea>plain <b>text</b></textarea><p>after</p>');
  });
  it('the r5 scanner paths stay linear on 8 MiB', () => {
    const t0 = Date.now();
    for (const unit of ['<textarea><!--', '<title><a b="', '<!-- --!', '<svg><title>', '<xmp><p x="</xmp>', '<!-->', '<title></title', '<textarea>', '</textarea>']) preparePage(unit.repeat(Math.floor(8 * 1024 * 1024 / unit.length)));
    assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0}ms`);
  });
  it('the cleaned r5 attacks run nothing in a browser, even with no CSP around them', async t => browser(t, async (b, dir) => {
    const body = preparePage(`<body>${R5_ATTACKS.join('')}<p>end</p></body>`).body;
    await fs.writeFile(path.join(dir, 'plain.html'), `<!doctype html><html><body>${body}</body></html>`);
    const p = await open(b, path.join(dir, 'plain.html'));
    await p.waitForTimeout(300);
    assert.deepEqual(p.dialogs, []);
    // And the same attacks uncleaned do fire, so the probe is not blind.
    await fs.writeFile(path.join(dir, 'raw.html'), `<!doctype html><html><body>${R5_ATTACKS.join('')}</body></html>`);
    const r = await open(b, path.join(dir, 'raw.html'));
    await r.waitForTimeout(300);
    assert.ok(r.dialogs.length >= 5, JSON.stringify(r.dialogs));
  }));

  it('CSP: a meta as the first child of <head>, a fresh nonce per emit carried only by the verb\'s script', () => {
    const h = emit(mk(), PAGE).html, h2 = emit(mk(), PAGE).html;
    const n = nonceOf(h);
    assert.ok(h.includes(`<head>\n<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${n}'; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'">\n<meta charset="utf-8">`));
    assert.notEqual(nonceOf(h2), n);
    assert.deepEqual(h.match(/nonce="[^"]*"/g), [`nonce="${n}"`]);
    assert.ok(h.includes(`<script data-story-marks nonce="${n}">`));
    const cam = emit(mk({ camera: { selector: '.card' } }), PAGE).html;
    assert.ok(cam.includes(`<script data-story-camera nonce="${nonceOf(cam)}">`));
    // A css-only story has no script but still carries the policy.
    const cssOnly = { ...base, steps: [st('a', { css: { h1: { color: 'red' } } }), st('b', { css: { '.q': { opacity: '0.5' } } }), st('c', { css: { '.q': { opacity: '1' } } })] };
    const c = emit(cssOnly, '<body><h1>x</h1></body>').html;
    assert.ok(c.includes('<meta http-equiv="Content-Security-Policy"') && !/<script/i.test(c));
  });
  it('CSP: a handler and a script injected after cleaning run nothing; the verb\'s script, styles and images still work', async t => browser(t, async (b, dir) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await fs.writeFile(path.join(dir, 'dot.png'), png);
    const page = `<!doctype html><html><head><style>.card{background-color:rgb(1,2,3)}</style></head><body><div class="card"><button class="btn">Go</button></div><h1>Hi</h1><img id="f" src="dot.png"><img id="d" src="data:image/png;base64,${png.toString('base64')}"></body></html>`;
    const injected = `<img src=x onerror="alert('handler')"><svg onload="alert('svg')"></svg><script>alert('script')</script><a id="js" href="javascript:alert('url')">j</a><form id="fm" action="http://example.com/"><button>s</button></form>`;
    await fs.writeFile(path.join(dir, 's.html'), emit(template(), page).html.replace('</body>', `${injected}</body>`));
    const p = await open(b, path.join(dir, 's.html'));
    const reqs = [];
    p.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) reqs.push(r.url()); });
    await p.waitForTimeout(300);
    await p.click('#js').catch(() => {});
    await p.waitForTimeout(200);
    assert.deepEqual(p.dialogs, []);
    await p.at(0);
    const st8 = await p.evaluate(() => ({
      marks: document.documentElement.classList.contains('story-marks'),
      swaps: document.querySelectorAll('story-swap').length,
      tags: document.querySelectorAll('story-tag').length,
      bg: getComputedStyle(document.querySelector('.card')).backgroundColor,
      f: document.getElementById('f').naturalWidth,
      d: document.getElementById('d').naturalWidth,
    }));
    assert.deepEqual(st8, { marks: true, swaps: 1, tags: 2, bg: 'rgb(1, 2, 3)', f: 1, d: 1 });
    assert.deepEqual(reqs, []);
  }));

  it('reduced motion: a swap-only selector gets animation none, so the element itself shows its final state', () => {
    const h = emit(swapOnly, '<body><button class="btn">Go</button><p class="q">q</p></body>').html;
    const layer = /<style data-story-step="b"[\s\S]*?<\/style>/.exec(h)[0];
    assert.match(layer.split('@media (prefers-reduced-motion:reduce)')[1], /html\.story-play :is\(\.btn\)\{animation:none !important\}/);
  });
  it('reduced motion: mid-tween the swapped element has no blur and full opacity, and shows only the new text', async t => browser(t, async (b, dir) => {
    await fs.writeFile(path.join(dir, 's.html'), emit(swapOnly, '<!doctype html><html><head><style>.btn{color:rgb(0,0,0);font:20px sans-serif}</style></head><body><button class="btn">Get started</button><p class="q">q</p></body></html>').html);
    const tl = check(swapOnly).timeline[1];
    const probe = p => p.evaluate(() => { const e = document.querySelector('.btn'), c = getComputedStyle(e), n = getComputedStyle(e.querySelector('story-swap')); return [c.filter, c.opacity, c.color, n.opacity]; });
    const r = await open(b, path.join(dir, 's.html'), { reducedMotion: 'reduce' });
    for (const ms of [0, Math.round((tl.start_ms + tl.tween_end_ms) / 2), tl.end_ms]) {
      await r.at(ms);
      assert.deepEqual(await probe(r), ['none', '1', 'rgba(0, 0, 0, 0)', '1'], `reduce at ${ms}`);
    }
    // Without reduced motion the same moment is mid-blur, so the probe can tell.
    const p = await open(b, path.join(dir, 's.html'));
    await p.at(tl.start_ms + 250);
    assert.notEqual((await probe(p))[0], 'none');
  }));

  it('the page\'s <html lang> and dir, and the body\'s dir and lang, are kept; lang="en" only when the page has none', () => {
    const ar = emit(swapOnly, '<!doctype html><html lang="ar" dir="RTL"><body><h1>مرحبا</h1></body></html>').html;
    assert.match(ar, /<html lang="ar" dir="rtl" class="story-play">/);
    const he = emit(swapOnly, '<html lang=he><body dir="rtl" lang="he-IL" class="app"><h1>שלום</h1></body></html>').html;
    assert.match(he, /<html lang="he" class="story-play">/);
    assert.match(he, /<div id="story-body" class="app" dir="rtl" lang="he-IL">/);
    assert.match(emit(swapOnly, '<body><h1>x</h1></body>').html, /<html lang="en" class="story-play">/);
    assert.match(emit(swapOnly, '<html lang=\'"><x\' dir="sideways"><body>x</body></html>').html, /<html lang="&quot;&gt;&lt;x" class="story-play">/);
    assert.match(emit(swapOnly, '<html data-lang="fr" lang="de"><body data-dir="rtl">x</body></html>').html, /<html lang="de" class="story-play">[\s\S]*<div id="story-body">/);
  });
  it('an rtl/ar page renders right to left with lang ar, and frame 0 lines up with the original', async t => browser(t, async (b, dir) => {
    for (const [name, orig] of Object.entries({
      html: '<!doctype html><html lang="ar" dir="rtl"><head><style>h1{font:32px sans-serif}</style></head><body><h1>مرحبا بالعالم</h1><p class="q">نص قصير</p><button class="btn">ابدأ</button></body></html>',
      body: '<!doctype html><html lang="ar"><head><style>h1{font:32px sans-serif}</style></head><body dir="rtl"><h1>مرحبا بالعالم</h1><p class="q">نص قصير</p><button class="btn">ابدأ</button></body></html>',
    })) {
      await fs.writeFile(path.join(dir, `${name}-o.html`), orig);
      await fs.writeFile(path.join(dir, `${name}-s.html`), emit(swapOnly, orig).html);
      const read = p => p.evaluate(() => ({ lang: document.documentElement.lang, dir: getComputedStyle(document.querySelector('h1')).direction, rects: ['h1', '.q', '.btn'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }) }));
      const want = await read(await open(b, path.join(dir, `${name}-o.html`)));
      assert.equal(want.dir, 'rtl');
      const p = await open(b, path.join(dir, `${name}-s.html`));
      await p.at(0);
      assert.deepEqual(await read(p), want, name);
    }
  }));

  it('a swap without ink emits no colour for the new text; the script takes the element\'s colour at the swap start', () => {
    const h = emit(swapOnly, '<body><button class="btn">Go</button><p class="q">q</p></body>').html;
    const rule = /story-swap\[data-story-swap="w2"\]\{([^}]*)\}/.exec(h)[1];
    assert.ok(!/(^|;)color:/.test(rule), rule);
    assert.ok(!h.includes('#111'));
    assert.ok(h.includes(`[[".btn","w2",${check(swapOnly).timeline[1].start_ms}]]`));
    assert.ok(h.includes('p[1].style.color=getComputedStyle(p[0]).color'));
    const inked = { ...swapOnly, steps: swapOnly.steps.map(s => (s.swap ? { ...s, swap: { ...s.swap, ink: 'rgb(9,9,9)' } } : s)) };
    const hi = emit(inked, '<body><button class="btn">Go</button><p class="q">q</p></body>').html;
    assert.match(/story-swap\[data-story-swap="w2"\]\{([^}]*)\}/.exec(hi)[1], /color:rgb\(9,9,9\);/);
    assert.ok(hi.includes('[[".btn","w2",null]]') && !hi.includes('p[1].style.color'));
  });
  it('a white label on a blue button swapped without ink stays white (AA contrast kept); an ink still wins', async t => browser(t, async (b, dir) => {
    const page = '<!doctype html><html><head><style>.btn{color:#fff;background:#1d4ed8;font:20px sans-serif;padding:10px}</style></head><body><button class="btn">Get started</button><p class="q">q</p></body></html>';
    await fs.writeFile(path.join(dir, 's.html'), emit(swapOnly, page).html);
    const inked = { ...swapOnly, steps: swapOnly.steps.map(s => (s.swap ? { ...s, swap: { ...s.swap, ink: 'rgb(255, 255, 0)' } } : s)) };
    await fs.writeFile(path.join(dir, 'i.html'), emit(inked, page).html);
    const D = check(swapOnly).duration_ms;
    const ink = p => p.evaluate(() => getComputedStyle(document.querySelector('.btn > story-swap')).color);
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const p = await open(b, path.join(dir, 's.html'), { reducedMotion });
      await p.at(D);
      assert.equal(await ink(p), 'rgb(255, 255, 255)', reducedMotion);
      const i = await open(b, path.join(dir, 'i.html'), { reducedMotion });
      await i.at(D);
      assert.equal(await ink(i), 'rgb(255, 255, 0)', reducedMotion);
    }
  }));
});
