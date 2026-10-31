import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as ie from '../src/lib/kit/image-effects.js';

const { run, emitEffect, checkPalette, parsePalette, duotoneTables, contrastRatio } = ie;
const rejects = (args, code = 1) => assert.rejects(run(args), e => e instanceof KitExit && e.code === code);
const PAL = '#0b1020,#f5c542';
const parses = js => assert.doesNotThrow(() => new vm.Script(js));

describe('image-effects list', () => {
  it('lists the four treatments and the one-treatment rule', async () => {
    const r = await run(['list']);
    assert.deepEqual(r.effects.map(e => e.id), ['glyph', 'halftone', 'dither', 'duotone']);
    for (const e of r.effects) for (const k of ['id', 'label', 'when', 'cost', 'notes']) assert.equal(typeof e[k], 'string');
    assert.match(r.rule, /one treatment/i);
    assert.match(r.rule, /main visual only/i);
  });
  it('takes no options', () => rejects(['list', '--kind', 'glyph']));
});

describe('image-effects verb shape', () => {
  it('exports verb and usage', () => {
    assert.equal(ie.verb, 'image-effects');
    assert.match(ie.usage, /image-effects emit/);
  });
});

describe('duotone', () => {
  it('maps dark to palette[0] and light to palette[1] in the filter tables', async () => {
    const r = await run(['emit', '--kind', 'duotone', '--palette', '#102030,#f0e0d0']);
    assert.equal(r.js, undefined);
    assert.match(r.html, /<svg[^>]*aria-hidden="true"/);
    assert.match(r.html, /<feColorMatrix type="matrix"/);
    assert.match(r.html, /tableValues="0.0627 0.9412"/); // red 0x10, 0xf0
    assert.match(r.html, /<feFuncG type="table" tableValues="0.1255 0.8784"/);
    assert.match(r.html, /<feFuncB type="table" tableValues="0.1882 0.8157"/);
    const id = /<filter id="([^"]+)"/.exec(r.html)[1];
    assert.equal(r.css, `img[data-image-effect]{filter:url(#${id})}`);
  });
  it('duotoneTables computes values from 0..1', () => {
    assert.deepEqual(duotoneTables(parsePalette('#000,#fff')), { r: [0, 1], g: [0, 1], b: [0, 1] });
    assert.deepEqual(duotoneTables(parsePalette('#000000,#ff0000,#ffffff')).r, [0, 1, 1]);
    assert.deepEqual(duotoneTables(parsePalette('#000000,#ff0000,#ffffff')).g, [0, 0, 1]);
  });
  it('luminance coefficients sum to one so grey stays grey', async () => {
    const r = await run(['emit', '--kind', 'duotone', '--palette', PAL]);
    const row = /values="([^"]+)"/.exec(r.html)[1].split(/\s+/).map(Number);
    assert.ok(Math.abs(row[0] + row[1] + row[2] - 1) < 1e-9);
  });
  it('uses a custom selector', async () => {
    const r = await run(['emit', '--kind', 'duotone', '--palette', PAL, '--selector', '.hero img']);
    assert.match(r.css, /^\.hero img\{filter:url\(#/);
  });
  it('rejects --cell and --chars', async () => {
    await rejects(['emit', '--kind', 'duotone', '--palette', PAL, '--cell', '8']);
    await rejects(['emit', '--kind', 'duotone', '--palette', PAL, '--chars', 'ab']);
  });
});

describe('canvas kinds', () => {
  for (const kind of ['glyph', 'halftone', 'dither']) {
    it(`${kind}: valid JS with the safety properties`, async () => {
      const r = await run(['emit', '--kind', kind, '--palette', PAL]);
      assert.equal(r.kind, kind);
      parses(r.js);
      assert.equal(r.html, undefined);
      assert.match(r.js, /Math\.min\(window\.devicePixelRatio\|\|1,2\)/);
      assert.match(r.js, /MAXC=40000/);
      assert.match(r.js, /aria-hidden/);
      assert.match(r.js, /ie-done/);
      assert.match(r.js, /getImageData/);
      assert.match(r.js, /try\{render\(\);\}catch\(e\)\{fallback\(\);\}/);
      assert.match(r.js, /"load"/);
      assert.ok(!/requestAnimationFrame|setInterval|setTimeout/.test(r.js), 'no animation loop');
      assert.match(r.css, /prefers-reduced-motion:no-preference/);
      assert.ok(r.notes.some(n => /main visual only/.test(n)));
      assert.ok(r.notes.some(n => /prefers-reduced-motion/.test(n)));
      assert.ok(r.js.includes('"img[data-image-effect]"'));
    });
  }
  it('halftone paints palette[0] dots on palette[1]', async () => {
    const r = await run(['emit', '--kind', 'halftone', '--palette', '#ffffff,#000000']);
    assert.match(r.js, /P=\[\[255,255,255\],\[0,0,0\]\]/);
    assert.match(r.js, /fillStyle=rgb\(P\[1\]\)/);
  });
  it('dither and glyph sort the palette dark to light', async () => {
    for (const kind of ['dither', 'glyph']) {
      const r = await run(['emit', '--kind', kind, '--palette', '#ffffff,#000000,#808080']);
      assert.match(r.js, /P=\[\[0,0,0\],\[128,128,128\],\[255,255,255\]\]/);
    }
  });
  it('dither uses a Bayer 4x4 matrix', async () => {
    const r = await run(['emit', '--kind', 'dither', '--palette', PAL]);
    assert.match(r.js, /B=\[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5\]/);
    assert.match(r.css, /ie-pixel/);
  });
  it('glyph uses the default ramp and honours --chars', async () => {
    const d = await run(['emit', '--kind', 'glyph', '--palette', PAL]);
    assert.ok(d.js.includes(JSON.stringify(ie.DEFAULT_CHARS)));
    const c = await run(['emit', '--kind', 'glyph', '--palette', PAL, '--chars', ' $€£¥']);
    assert.ok(c.js.includes('" $€£¥"'));
    parses(c.js);
  });
  it('--chars cannot break out of the script', async () => {
    const r = await run(['emit', '--kind', 'glyph', '--palette', PAL, '--chars', ' </script>"\\']);
    assert.ok(!r.js.includes('</script>'));
    parses(r.js);
  });
  it('--cell sets the grid size', async () => {
    const r = await run(['emit', '--kind', 'halftone', '--palette', PAL, '--cell', '12']);
    assert.match(r.js, /CELL=12,/);
    assert.match((await run(['emit', '--kind', 'glyph', '--palette', PAL])).js, /CELL=8,/);
    assert.match((await run(['emit', '--kind', 'dither', '--palette', PAL])).js, /CELL=3,/);
  });
  it('a selector with quotes stays a valid string literal', async () => {
    const r = await run(['emit', '--kind', 'dither', '--palette', PAL, '--selector', 'img[alt="Hero"]']);
    parses(r.js);
  });
  it('warns in notes when contrast is low', async () => {
    const r = await run(['emit', '--kind', 'halftone', '--palette', '#777777,#888888']);
    assert.ok(r.notes.some(n => /contrast ratio/.test(n)));
  });
});

describe('image-effects check', () => {
  it('reports contrast for a good palette', async () => {
    const r = await run(['check', '--kind', 'duotone', '--palette', PAL]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.palette, ['#0b1020', '#f5c542']);
    assert.equal(r.darkest, '#0b1020');
    assert.equal(r.lightest, '#f5c542');
    assert.ok(r.contrast > 3);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.fix, undefined);
  });
  it('warns under 3 with a fix, still exit 0', async () => {
    const r = await run(['check', '--kind', 'dither', '--palette', '#777,#888']);
    assert.equal(r.ok, false);
    assert.ok(r.contrast < 3);
    assert.equal(r.warnings.length, 1);
    assert.equal(typeof r.fix, 'string');
  });
  it('picks darkest and lightest from three colors in any order', () => {
    const r = checkPalette('glyph', '#ffffff,#000000,#808080');
    assert.equal(r.darkest, '#000000');
    assert.equal(r.lightest, '#ffffff');
    assert.equal(r.contrast, 21);
  });
  it('contrastRatio black on white is 21', () => assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21));
  it('expands #rgb', () => assert.deepEqual(checkPalette('glyph', '#000,#fff').palette, ['#000000', '#ffffff']));
});

describe('image-effects errors', () => {
  it('no or unknown subcommand', async () => {
    await rejects([]);
    await rejects(['nope']);
    await rejects(['toString']);
  });
  it('missing or unknown kind', async () => {
    await rejects(['emit', '--palette', PAL]);
    await rejects(['emit', '--kind', 'sepia', '--palette', PAL]);
    await rejects(['check', '--kind', 'sepia', '--palette', PAL]);
  });
  it('bad palettes', async () => {
    for (const p of ['#fff', '#fff,#000,#888,#111', '#fff,red', '#ggg,#000', '#fffff,#000', 'url(x),#000', '#fff,,#000'])
      await rejects(['emit', '--kind', 'glyph', '--palette', p]);
    await rejects(['emit', '--kind', 'glyph']);
    await rejects(['check', '--kind', 'glyph']);
    await rejects(['check', '--kind', 'glyph', '--palette', '#fff']);
  });
  it('unsafe selectors', async () => {
    for (const s of ['a{}', 'img;x', '</style>', 'a\\b', 'x'.repeat(201), '  '])
      await rejects(['emit', '--kind', 'duotone', '--palette', PAL, '--selector', s]);
  });
  it('bad chars', async () => {
    await rejects(['emit', '--kind', 'glyph', '--palette', PAL, '--chars', 'a']);
    await rejects(['emit', '--kind', 'glyph', '--palette', PAL, '--chars', 'a'.repeat(65)]);
    await rejects(['emit', '--kind', 'glyph', '--palette', PAL, '--chars', 'a\nb']);
    await rejects(['emit', '--kind', 'halftone', '--palette', PAL, '--chars', 'ab']);
  });
  it('bad cell', async () => {
    for (const c of ['1', '65', '2.5', 'x', '-3', '1e1'])
      await rejects(['emit', '--kind', 'halftone', '--palette', PAL, '--cell', c]);
  });
  it('unknown, duplicate, valueless and empty flags', async () => {
    await rejects(['emit', '--kind', 'glyph', '--palette', PAL, '--bogus', '1']);
    await rejects(['check', '--kind', 'glyph', '--palette', PAL, '--cell', '8']);
    await rejects(['emit', '--kind', 'glyph', '--kind', 'dither', '--palette', PAL]);
    await rejects(['emit', '--kind', 'glyph', '--palette']);
    await rejects(['emit', '--kind', 'glyph', '--palette', '']);
    await rejects(['emit', '--kind', '--palette', PAL]);
    await rejects(['emit', 'glyph', '--palette', PAL]);
  });
  it('binary-looking input is just a bad value', async () => {
    await rejects(['emit', '--kind', 'glyph', '--palette', '\u0000\u0001�']);
  });
});

// ---- review r1 fixes ----

/** Run an emitted script against a small fake DOM; returns the recorded calls. */
function harness(js, { w = 4, h = 2, pixels, reduced = false, noIO = false, hidden = false } = {}) {
  const log = { arcs: 0, draws: 0, intervals: [], cleared: 0, observers: [], canvases: [], listeners: {} };
  const px = pixels || new Uint8ClampedArray(w * h * 4).fill(255);
  const mkCanvas = () => {
    const cv = { style: {}, width: 0, height: 0, className: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, parentNode: null,
      getContext: () => ({ scale() {}, fillRect() {}, beginPath() {}, arc() { log.arcs++; }, fill() {}, fillText() {},
        drawImage() { log.draws++; }, getImageData: (x, y, cw, ch) => ({ data: px.length === cw * ch * 4 ? px : new Uint8ClampedArray(cw * ch * 4).fill(255).map((v, i) => px[i % px.length]) }),
        createImageData: (cw, ch) => ({ data: new Uint8ClampedArray(cw * ch * 4) }), putImageData() {} }) };
    log.canvases.push(cv);
    return cv;
  };
  const img = { tagName: 'IMG', complete: true, naturalWidth: 400, naturalHeight: 200, clientWidth: 400, classList: { add() {}, remove() {} },
    parentNode: { insertBefore(c) { c.parentNode = this; } }, nextSibling: null, addEventListener() {} };
  const document = { hidden, querySelectorAll: () => [img], createElement: () => mkCanvas(),
    addEventListener: (t, f) => { (log.listeners[t] ||= []).push(f); } };
  const window = { devicePixelRatio: 1, document,
    matchMedia: q => ({ matches: reduced && /reduce/.test(q), addEventListener() {} }),
    IntersectionObserver: noIO ? undefined : function (cb) { this.observe = el => { log.observers.push({ cb, el }); }; } };
  const ctx = { window, document, Math, Array, setInterval: (f, ms) => { log.intervals.push({ f, ms }); return log.intervals.length; },
    clearInterval: () => { log.cleared++; } };
  if (noIO) delete window.IntersectionObserver;
  vm.runInNewContext(js, { ...ctx, IntersectionObserver: window.IntersectionObserver });
  log.document = document;
  return log;
}

describe('review r1: halftone transparency', () => {
  it('a transparent pixel gets no dot while an opaque black pixel does', async () => {
    const r = await run(['emit', '--kind', 'halftone', '--palette', '#0b1020,#f5f0e0', '--cell', '2']);
    // 400x200 at cell 2 -> big grid; use 2 distinct pixels cycled by the fake
    const transparent = harness(r.js, { pixels: new Uint8ClampedArray([0, 0, 0, 0]) });
    assert.equal(transparent.arcs, 0, 'transparent areas draw no dots');
    const black = harness(r.js, { pixels: new Uint8ClampedArray([0, 0, 0, 255]) });
    assert.ok(black.arcs > 0, 'opaque black draws dots');
  });
  it('dither and glyph still treat transparent as dark', async () => {
    const g = await run(['emit', '--kind', 'glyph', '--palette', PAL]);
    assert.match(g.js, /var BGL=0;/);
    const h = await run(['emit', '--kind', 'halftone', '--palette', PAL]);
    assert.match(h.js, /var BGL=1;/);
  });
});

describe('review r1: glyph --animate', () => {
  it('default glyph has no timers and --animate is refused elsewhere', async () => {
    const r = await run(['emit', '--kind', 'glyph', '--palette', PAL]);
    assert.ok(!/setInterval|IntersectionObserver|ANIM/.test(r.js));
    for (const k of ['halftone', 'dither', 'duotone']) await rejects(['emit', '--kind', k, '--palette', PAL, '--animate']);
    await rejects(['emit', '--kind', 'glyph', '--palette', PAL, '--animate', '--animate']);
    await rejects(['check', '--kind', 'glyph', '--palette', PAL, '--animate']);
    await rejects(['emit', '--kind', 'glyph', '--palette', PAL, '--chars', '--animate']);
  });
  it('the animated script parses and its timing constants match the contract', async () => {
    const r = await run(['emit', '--kind', 'glyph', '--palette', PAL, '--animate']);
    parses(r.js);
    const m = /STEPS=(\d+),TICK=([\d.]+),SHARE=([\d.]+)/.exec(r.js);
    assert.ok(m, 'constants present');
    const [steps, tick, share] = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert.ok(steps >= 8 && steps <= 12);
    assert.equal(steps, 10);
    assert.equal(tick, 1000 / steps);
    assert.ok(share <= 0.05);
    assert.deepEqual(ie.ANIMATE, { steps: 10, share: 0.05, minSteps: 8, maxSteps: 12 });
    assert.match(r.js, /IntersectionObserver/);
    assert.match(r.js, /visibilitychange/);
    assert.match(r.js, /document\.hidden/);
    assert.match(r.js, /prefers-reduced-motion: reduce/);
    assert.match(r.js, /clearInterval/);
    assert.ok(r.notes.some(n => /Animated/.test(n)));
  });
  it('runs on a timer, redraws at most 5% of the cells per tick, and only while visible', async () => {
    const r = await run(['emit', '--kind', 'glyph', '--palette', PAL, '--animate']);
    const log = harness(r.js);
    assert.equal(log.intervals.length, 0, 'does not start until the canvas is on screen');
    assert.equal(log.observers.length, 1);
    const { cb, el } = log.observers[0];
    cb([{ isIntersecting: true, target: el }]);
    assert.equal(log.intervals.length, 1);
    assert.equal(log.intervals[0].ms, 100);
    const before = log.draws;
    log.intervals[0].f();
    const changed = log.draws - before;
    const total = Math.round(400 / 8) * Math.round(200 / 8);
    assert.ok(changed > 0 && changed <= Math.floor(total * 0.05), `${changed} of ${total} cells`);
    cb([{ isIntersecting: false, target: el }]);
    assert.equal(log.cleared, 1, 'paused off screen');
  });
  it('pauses when the tab is hidden and resumes', async () => {
    const r = await run(['emit', '--kind', 'glyph', '--palette', PAL, '--animate']);
    const log = harness(r.js);
    log.observers[0].cb([{ isIntersecting: true }]);
    assert.equal(log.intervals.length, 1);
    log.document.hidden = true;
    log.listeners.visibilitychange.forEach(f => f());
    assert.equal(log.cleared, 1);
    log.document.hidden = false;
    log.listeners.visibilitychange.forEach(f => f());
    assert.equal(log.intervals.length, 2);
  });
  it('never runs under prefers-reduced-motion', async () => {
    const r = await run(['emit', '--kind', 'glyph', '--palette', PAL, '--animate']);
    const log = harness(r.js, { reduced: true });
    assert.equal(log.observers.length, 0);
    assert.equal(log.intervals.length, 0);
  });
  it('without IntersectionObserver it still starts (visible by default)', async () => {
    const r = await run(['emit', '--kind', 'glyph', '--palette', PAL, '--animate']);
    const log = harness(r.js, { noIO: true });
    assert.equal(log.intervals.length, 1);
  });
});

describe('review r1: palette order', () => {
  it('list documents the one rule', async () => {
    const r = await run(['list']);
    assert.match(r.paletteOrder, /dither and glyph sort/i);
    assert.match(r.paletteOrder, /duotone and halftone use the order given/i);
  });
  it('halftone refuses a third color (emit and check)', async () => {
    await rejects(['emit', '--kind', 'halftone', '--palette', '#000,#888,#fff']);
    await rejects(['check', '--kind', 'halftone', '--palette', '#000,#888,#fff']);
    assert.equal((await run(['check', '--kind', 'halftone', '--palette', '#000,#fff'])).ok, true);
    assert.equal((await run(['emit', '--kind', 'glyph', '--palette', '#000,#888,#fff'])).kind, 'glyph');
  });
  it('notes flag a light-to-dark order for duotone and halftone only', async () => {
    for (const k of ['duotone', 'halftone']) {
      const r = await run(['emit', '--kind', k, '--palette', '#f5c542,#0b1020']);
      assert.ok(r.notes.some(n => /light to dark/.test(n)), k);
      const ok = await run(['emit', '--kind', k, '--palette', '#0b1020,#f5c542']);
      assert.ok(!ok.notes.some(n => /light to dark/.test(n)), k);
    }
    const d = await run(['emit', '--kind', 'dither', '--palette', '#f5c542,#0b1020']);
    assert.ok(!d.notes.some(n => /light to dark/.test(n)));
  });
});

describe('review r1: aspect ratio', () => {
  it('every canvas kind sets the CSS aspect-ratio from the natural size', async () => {
    for (const kind of ['glyph', 'halftone', 'dither']) {
      const r = await run(['emit', '--kind', kind, '--palette', PAL, '--cell', '64']);
      assert.match(r.js, /cv\.style\.aspectRatio=nw\+" \/ "\+nh/);
      const log = harness(r.js);
      assert.equal(log.canvases.at(-1).style.aspectRatio, '400 / 200', kind);
    }
  });
});

describe('review r1: selector and --chars', () => {
  it('unbalanced quotes or brackets are refused', async () => {
    for (const s of ['img[alt="x]', 'img[alt=x', 'a)', 'a:not(b', 'a[b)', "img[alt='x]", 'img[alt="a"]"'])
      await rejects(['emit', '--kind', 'duotone', '--palette', PAL, '--selector', s]);
    for (const s of ['img[alt="a]b"]', ".hero img:not([src$='.svg'])", 'img[data-x]'])
      assert.equal((await run(['emit', '--kind', 'duotone', '--palette', PAL, '--selector', s])).kind, 'duotone');
  });
  it('the script does not throw at top level when querySelectorAll throws', async () => {
    const r = await run(['emit', '--kind', 'dither', '--palette', PAL]);
    assert.match(r.js, /try\{list=document\.querySelectorAll\(SEL\);\}catch\(e\)\{\}/);
  });
  it('--chars may start with "--" but not be another flag', async () => {
    const r = await run(['emit', '--kind', 'glyph', '--palette', PAL, '--chars', '--==##']);
    assert.ok(r.js.includes('"--==##"'));
    await rejects(['emit', '--kind', 'glyph', '--chars', '--palette', PAL]);
    await rejects(['emit', '--kind', 'glyph', '--palette', '--kind', 'x']);
  });
});

describe('review r1: header wording', () => {
  it('says duotone applies to every match and canvas kinds to the first', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/lib/kit/image-effects.js', import.meta.url), 'utf8');
    assert.match(src, /duotone's CSS rule filters every element the selector matches/);
    assert.match(src, /canvas kinds treat the first matching <img> only/);
    const d = (await run(['list'])).effects.find(e => e.id === 'duotone');
    assert.match(d.notes, /every element the selector matches/);
  });
});
