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
