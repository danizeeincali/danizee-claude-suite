import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('keyframes — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  const spec = {
    loop_ms: 2000,
    stories: [
      { id: 'a', card: 'x', pattern: 'pulse-highlight', sentence: 'The highlight pulses once.', tracks: { glow: [{ t: 0, v: 0 }, { t: 1000, v: 10 }, { t: 2000, v: 0 }] } },
      { id: 'b', card: 'y', pattern: 'scrubber-glide', sentence: 'One. Two.', offset_ms: 500, tracks: { x: [{ t: 0, v: 0, ease: 'out' }, { t: 1000, v: 8 }, { t: 2000, v: 0 }] } },
    ],
  };

  it('lists the verb, checks and samples via stdin and --file, emits, rejects bad input, zero egress', () => {
    assert.ok(pkg.kit(['help'], undefined).json.verbs.includes('keyframes'));
    const body = JSON.stringify(spec);
    const c = pkg.kit(['keyframes', 'check'], body);
    assert.equal(c.code, 0);
    assert.equal(c.json.ok, false);
    assert.equal(c.json.findings[0].rule, 'sentence-not-single');
    const f = path.join(pkg.dir, 'spec.json');
    fs.writeFileSync(f, body);
    assert.deepEqual(pkg.kit(['keyframes', 'check', '--file', f], '').json, c.json);
    const s = pkg.kit(['keyframes', 'sample', '--at', '1000'], body);
    assert.equal(s.code, 0);
    assert.equal(s.json.values.a.glow, 10);
    assert.deepEqual(pkg.kit(['keyframes', 'sample', '--file', f, '--at', '1000'], '').json, s.json);
    assert.equal(pkg.kit(['keyframes', 'patterns'], '').json.patterns.length, 7);
    const e = pkg.kit(['keyframes', 'emit'], '');
    assert.equal(e.code, 0);
    assert.match(e.out, /export function createLoop/);
    const bad = pkg.kit(['keyframes', 'check'], JSON.stringify({ ...spec, extra: 1 }));
    assert.equal(bad.code, 1);
    assert.match(bad.err, /extra/);
    assert.equal(pkg.kit(['keyframes', 'check', '--file', '/dev/stdin'], body).code, 1);
    assert.equal(pkg.kit(['keyframes', 'check', '--file', ''], body).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
