import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('bg-fill — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('lists the verb, builds css via stdin and --file, judges via stdin and --file, rejects bad input, zero egress', () => {
    assert.ok(pkg.kit(['help']).json.verbs.includes('bg-fill'));
    const input = JSON.stringify({ selector: '.hero-bg', container: { w: 1200, h: 800 }, image: { w: 600, h: 400 }, scale_mode: 'TILE', tile_scale: 2 });
    const a = pkg.kit(['bg-fill', 'css'], input);
    assert.equal(a.code, 0);
    assert.equal(a.json.css['background-size'], '1200px 800px');
    assert.equal(a.json.css['background-repeat'], 'repeat');
    fs.writeFileSync(path.join(pkg.dir, 'in.json'), input);
    const b = pkg.kit(['bg-fill', 'css', '--file', 'in.json']);
    assert.deepEqual(b.json, a.json);

    const bad = '.hero-bg { background-image: url(a.jpg); }\n.hero-bg:hover { background: #000; }\n';
    const s = pkg.kit(['bg-fill', 'guard', '--selector', '.hero-bg'], bad);
    assert.equal(s.code, 2);
    assert.equal(s.json.pass, false);
    assert.equal(s.json.violations[0].line, 2);
    fs.writeFileSync(path.join(pkg.dir, 'in.css'), bad);
    const f = pkg.kit(['bg-fill', 'guard', '--file', 'in.css', '--selector', '.hero-bg']);
    assert.equal(f.code, 2);
    assert.deepEqual(f.json, s.json);
    const ok = pkg.kit(['bg-fill', 'guard', '--selector', '.hero-bg'], '.hero-bg { background-image: url(a.jpg); }');
    assert.equal(ok.code, 0);
    assert.equal(ok.json.pass, true);

    assert.equal(pkg.kit(['bg-fill', 'css'], JSON.stringify({ selector: '.a', container: { w: 1, h: 1 }, image: { w: 1, h: 1 }, scale_mode: 'CROP', transform: [[1, 0.5, 0], [0, 1, 0]] })).code, 1);
    assert.equal(pkg.kit(['bg-fill', 'css'], '').code, 1);
    assert.equal(pkg.kit(['bg-fill', 'guard'], '.a{}').code, 1);
    assert.equal(pkg.kit(['bg-fill', 'css', '--file', ''], input).code, 1);
    assert.equal(pkg.kit(['bg-fill', 'css', '--file', 'in.json', '--file', 'in.json']).code, 1);
    assert.equal(pkg.kit(['bg-fill', 'css', '--file', '.'], '').code, 1);

    const blocks = pkg.kit(['exit-codes', 'blocks', '2', '--verb', 'bg-fill']);
    assert.equal(blocks.json.blocks, true);
    assert.deepEqual(pkg.egress(), []);
  });
});
