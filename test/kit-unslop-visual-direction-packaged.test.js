import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('visual-direction — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('decides, checks a sentence, builds a prompt, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('visual-direction'));
    const d = pkg.kit(['visual-direction', 'decide'], JSON.stringify({ screen: 'landing', has_product_ui: false, works_without_visual: true, direction: { world: 'pottery' } }));
    assert.equal(d.code, 0);
    assert.equal(d.json.kind, 'scene');
    assert.equal(pkg.kit(['visual-direction', 'decide'], JSON.stringify({ screen: 'dashboard', has_product_ui: true, works_without_visual: true })).json.kind, 'none');

    const sentence = 'A potter shapes a clay bowl at a wooden bench in low morning sun.';
    const s = pkg.kit(['visual-direction', 'sentence'], JSON.stringify({ sentence }));
    assert.equal(s.code, 0);
    assert.equal(s.json.ok, true);
    assert.equal(pkg.kit(['visual-direction', 'sentence'], JSON.stringify({ sentence: 'A stunning neon blob.' })).json.ok, false);

    fs.writeFileSync(path.join(pkg.dir, 'ctx.json'), JSON.stringify({ sentence, style: 'illustration', palette: ['#1a2b3c'], aspect: '16:9' }));
    const p = pkg.kit(['visual-direction', 'prompt', '--file', 'ctx.json']);
    assert.equal(p.code, 0);
    assert.deepEqual(p.json.size, { w: 1600, h: 900 });
    assert.equal(p.json.placement.object_fit, 'cover');

    assert.equal(pkg.kit(['visual-direction', 'prompt', '--file', 'missing.json']).code, 1);
    assert.equal(pkg.kit(['visual-direction', 'decide'], '').code, 1);
    assert.equal(pkg.kit(['visual-direction', 'nope']).code, 1);
    assert.equal(pkg.kit(['visual-direction', 'decide', '--file', 'ctx.json', '--file', 'ctx.json']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
