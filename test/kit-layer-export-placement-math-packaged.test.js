import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('layer-place — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  const input = {
    frame: { x: 100, y: 50 },
    layers: [
      { id: 'top', z: 5, bounds: { x: 110, y: 70, w: 40, h: 20 }, render_bounds: { x: 106, y: 66, w: 48, h: 28 }, image: { w: 96, h: 56, scale: 2 } },
      { id: 'card', z: 1, bounds: { x: 110, y: 70, w: 40, h: 20 }, children_move: true },
      { id: 'arc', z: 3, bounds: { x: 120, y: 80, w: 10, h: 10 }, shape: 'arc' },
    ],
  };

  it('lists the verb, places layers from stdin and --file identically, rejects bad input, zero egress', () => {
    assert.ok(pkg.kit(['help']).json.verbs.includes('layer-place'));
    const body = JSON.stringify(input);
    const s = pkg.kit(['layer-place'], body);
    assert.equal(s.code, 0);
    assert.deepEqual(s.json.placements.map(p => p.id), ['card', 'arc', 'top']);
    assert.deepEqual(s.json.placements.map(p => p.rule), ['bounds', 'absolute-bounds', 'render-bounds']);
    assert.deepEqual([s.json.placements[2].left, s.json.placements[2].top, s.json.placements[2].width, s.json.placements[2].height], [6, 16, 48, 28]);
    assert.equal(s.json.rebuild_container_in_css, true);
    assert.equal(s.json.warnings.length, 1);

    const file = path.join(pkg.dir, 'layers.json');
    fs.writeFileSync(file, body);
    const f = pkg.kit(['layer-place', '--file', file]);
    assert.equal(f.code, 0);
    assert.deepEqual(f.json, s.json);

    assert.equal(pkg.kit(['layer-place'], JSON.stringify({ ...input, layers: [input.layers[0], input.layers[0]] })).code, 1);
    assert.equal(pkg.kit(['layer-place'], JSON.stringify({ frame: input.frame, layers: [{ id: 'a', z: 0, bounds: { x: 0, y: 0, w: -1, h: 1 } }] })).code, 1);
    assert.equal(pkg.kit(['layer-place', '--file', pkg.dir]).code, 1);
    assert.equal(pkg.kit(['layer-place', '--file', '']).code, 1);
    assert.equal(pkg.kit(['layer-place', '--file', '/dev/stdin'], body).code, 1);
    assert.equal(pkg.kit(['layer-place', '--file', file, '--file', file]).code, 1);
    assert.equal(pkg.kit(['layer-place'], '').code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
