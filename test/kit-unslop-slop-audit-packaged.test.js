import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('slop-audit — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('lists signs, scans text and files, blocks under --strict, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('slop-audit'));

    const s = pkg.kit(['slop-audit', 'signs']);
    assert.equal(s.code, 0);
    assert.ok(s.json.groups.some(g => g.id === 'template-look'));
    assert.ok(s.json.groups.flatMap(g => g.signs).every(x => x.id && x.label && x.fix));

    const page = '<h1 class="font-black">Welcome back!</h1>\n<div style="margin:13px">x</div>\n';
    fs.writeFileSync(path.join(pkg.dir, 'page.html'), page);
    const a = pkg.kit(['slop-audit', 'scan', '--file', 'page.html']);
    assert.equal(a.code, 0);
    assert.equal(a.json.format, 'html');
    assert.deepEqual(a.json.hits.map(h => h.sign), ['heavy-weight', 'greeting-headline', 'exclamation-marks', 'off-grid-spacing']);
    assert.equal(a.json.total, 4);
    assert.equal(a.json.counts.copy, 2);
    assert.ok(a.json.manual.includes('inter-default'));
    assert.deepEqual(pkg.kit(['slop-audit', 'scan'], page).json, a.json);

    const strict = pkg.kit(['slop-audit', 'scan', '--strict', '--file', 'page.html']);
    assert.equal(strict.code, 2);
    assert.equal(strict.json.total, 4);
    assert.equal(pkg.kit(['slop-audit', 'scan', '--strict'], '<p>Fine.</p>').code, 0);
    assert.equal(pkg.kit(['slop-audit', 'scan', '--format', 'css'], 'a{font-weight:900}').json.format, 'css');

    assert.equal(pkg.kit(['slop-audit', 'scan', '--file', 'missing.html']).code, 1);
    assert.equal(pkg.kit(['slop-audit', 'scan'], '').code, 1);
    assert.equal(pkg.kit(['slop-audit', 'scan'], 'a\0b').code, 1);
    assert.equal(pkg.kit(['slop-audit', 'scan', '--format', 'pdf'], 'x').code, 1);
    assert.equal(pkg.kit(['slop-audit', 'scan', '--bogus'], 'x').out, '');
    assert.equal(pkg.kit(['slop-audit', 'nope']).code, 1);
    assert.equal(pkg.kit(['slop-audit', 'scan'], 'é'.repeat(4.5 * 1024 * 1024)).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
