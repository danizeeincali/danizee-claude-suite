import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';
import { encodePng } from '../src/lib/kit/fidelity.js';

const solid = (v) => encodePng(8, 8, new Uint8Array(8 * 8 * 3).fill(v), 3);

describe('fidelity — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('is listed, passes identical frames, fails a poor one with exit 2 (a blocking regression), rejects bad input, zero egress', () => {
    assert.ok(pkg.kit(['help']).json.verbs.includes('fidelity'));
    const w = (n, b) => fs.writeFileSync(path.join(pkg.dir, n), b);
    w('ref.png', solid(100)); w('same.png', solid(100)); w('off.png', solid(180));
    const ok = pkg.kit(['fidelity', '--ref', 'ref.png', '--actual', 'same.png', '--diff-out', 'd.png']);
    assert.equal(ok.code, 0);
    assert.equal(ok.json.identical, true); assert.equal(ok.json.psnr, null); assert.equal(ok.json.pass, true);
    assert.equal(fs.readFileSync(path.join(pkg.dir, 'd.png')).subarray(1, 4).toString(), 'PNG');
    const no = pkg.kit(['fidelity', '--ref', 'ref.png', '--actual', 'off.png']);
    assert.equal(no.code, 2);
    assert.equal(no.json.pass, false); assert.equal(no.json.exit, 2);
    const cls = pkg.kit(['exit-codes', 'classify', '--code', '2', '--verb', 'fidelity', '--result', '-'], no.out);
    assert.equal(cls.code, 0);
    assert.equal(cls.json.class, 'regression'); assert.equal(cls.json.blocks, true);
    w('big.png', encodePng(8, 9, new Uint8Array(8 * 9 * 3), 3));
    assert.equal(pkg.kit(['fidelity', '--ref', 'ref.png', '--actual', 'big.png']).code, 1);
    assert.equal(pkg.kit(['fidelity', '--ref', 'ref.png']).code, 1);
    w('junk.png', 'not a png');
    assert.equal(pkg.kit(['fidelity', '--ref', 'junk.png', '--actual', 'ref.png']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
