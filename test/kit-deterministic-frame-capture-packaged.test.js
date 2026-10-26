import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installPackaged } from './helpers/packaged.js';

describe('frame-capture — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('plans, checks a seam by stdin and --file, refuses bad input and non-local URLs, zero egress', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('frame-capture'));
    const p = pkg.kit(['frame-capture', 'plan', '--fps', '30', '--frames', '30', '--loop-ms', '1000']);
    assert.equal(p.code, 0);
    assert.deepEqual(p.json.steps_ms.slice(0, 3), [33, 33, 34]);
    const manifest = JSON.stringify({ fps: 30, frames: p.json.frames });
    const viaStdin = pkg.kit(['frame-capture', 'seam', '--loop-ms', '1000'], manifest);
    assert.equal(viaStdin.code, 0);
    assert.equal(viaStdin.json.ok, true);
    await fs.writeFile(path.join(pkg.dir, 'm.json'), manifest);
    const viaFile = pkg.kit(['frame-capture', 'seam', '--file', 'm.json', '--loop-ms', '1000']);
    assert.deepEqual(viaFile.json, viaStdin.json);
    const broken = pkg.kit(['frame-capture', 'seam', '--loop-ms', '1000'], JSON.stringify({ fps: 30, frames: p.json.frames.slice(0, 29) }));
    assert.equal(broken.code, 0);
    assert.equal(broken.json.ok, false);
    assert.equal(pkg.kit(['frame-capture', 'plan', '--fps', '30']).code, 1);
    assert.equal(pkg.kit(['frame-capture', 'seam', '--loop-ms', '1000'], '').code, 1);
    assert.equal(pkg.kit(['frame-capture', 'seam', '--file', '/dev/null', '--loop-ms', '1000']).code, 1);
    const refused = pkg.kit(['frame-capture', 'capture', '--url', 'https://example.com', '--out', 'o', '--fps', '30', '--frames', '2']);
    assert.equal(refused.code, 2);
    assert.match(refused.err, /refused/);
    await assert.rejects(fs.stat(path.join(pkg.dir, 'o')));
    assert.deepEqual(pkg.egress(), []);
  });
});
