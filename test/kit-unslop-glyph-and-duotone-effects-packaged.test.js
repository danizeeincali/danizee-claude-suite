import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installPackaged } from './helpers/packaged.js';

describe('image-effects — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('lists, emits all four kinds, checks, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('image-effects'));
    const l = pkg.kit(['image-effects', 'list']);
    assert.equal(l.code, 0);
    assert.deepEqual(l.json.effects.map(e => e.id), ['glyph', 'halftone', 'dither', 'duotone']);

    for (const kind of ['glyph', 'halftone', 'dither']) {
      const r = pkg.kit(['image-effects', 'emit', '--kind', kind, '--palette', '#0b1020,#f5c542', '--cell', '10']);
      assert.equal(r.code, 0);
      assert.equal(r.json.kind, kind);
      assert.doesNotThrow(() => new vm.Script(r.json.js));
    }
    const d = pkg.kit(['image-effects', 'emit', '--kind', 'duotone', '--palette', '#000,#fff', '--selector', '.hero img']);
    assert.equal(d.code, 0);
    assert.match(d.json.html, /feComponentTransfer/);
    assert.match(d.json.css, /^\.hero img\{filter:url/);

    const c = pkg.kit(['image-effects', 'check', '--kind', 'glyph', '--palette', '#777,#888']);
    assert.equal(c.code, 0);
    assert.equal(c.json.ok, false);

    for (const args of [
      ['image-effects'], ['image-effects', 'nope'],
      ['image-effects', 'emit', '--kind', 'sepia', '--palette', '#000,#fff'],
      ['image-effects', 'emit', '--kind', 'glyph', '--palette', '#000'],
      ['image-effects', 'emit', '--kind', 'glyph', '--palette', '#000,#fff', '--cell', '1'],
      ['image-effects', 'emit', '--kind', 'glyph', '--kind', 'dither', '--palette', '#000,#fff']
    ]) {
      const r = pkg.kit(args);
      assert.equal(r.code, 1);
      assert.equal(r.out, '');
    }
    assert.deepEqual(pkg.egress(), []);
  });
});
