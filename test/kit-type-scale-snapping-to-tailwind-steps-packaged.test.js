import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('type-scale — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('snaps, audits a CSS file, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('type-scale'));
    const s = pkg.kit(['type-scale', 'snap', '--size', '15']);
    assert.equal(s.code, 0);
    assert.deepEqual(s.json, { step: 'sm', size_px: 14, line_height_px: 20, changed: true });
    assert.equal(pkg.kit(['type-scale', 'snap', '--size', '1.25rem']).json.changed, false);
    fs.writeFileSync(path.join(pkg.dir, 'a.css'), '/* font-size: 9px */\n.a { font-size: 15px; }\n.b { font-size: var(--x); }\n');
    const a = pkg.kit(['type-scale', 'audit', '--file', 'a.css']);
    assert.equal(a.code, 0);
    assert.equal(a.json.changes[0].line, 2);
    assert.equal(a.json.skipped.length, 1);
    assert.equal(pkg.kit(['type-scale', 'snap', '--size', 'big']).code, 1);
    assert.equal(pkg.kit(['type-scale', 'audit', '--file', 'nope.css']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });

  it('reads the same input from stdin and --file, refuses FIFO-ish and empty flags', () => {
    const css = '<p style="font-size:15px">x</p>\n';
    fs.writeFileSync(path.join(pkg.dir, 'b.html'), css);
    const f = pkg.kit(['type-scale', 'audit', '--file', 'b.html']);
    const s = pkg.kit(['type-scale', 'audit'], css);
    assert.equal(f.code, 0); assert.equal(s.code, 0);
    assert.equal(f.json.changes.length, 1);
    assert.deepEqual(s.json, f.json);
    assert.equal(pkg.kit(['type-scale', 'audit', '--file', ''], css).code, 1);
    assert.equal(pkg.kit(['type-scale', 'audit', '--file', 'b.html', '--file', 'b.html']).code, 1);
    assert.equal(pkg.kit(['type-scale', 'audit', '--file', '.']).code, 1);
    assert.equal(pkg.kit(['type-scale', 'audit', '--file', '/dev/null']).code, 1);
    const big = pkg.kit(['type-scale', 'audit'], 'é'.repeat(4 * 1024 * 1024 + 1));
    assert.equal(big.code, 1);
    assert.match(big.err, /8 MiB/);
  });
});
