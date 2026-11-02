import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('design-tokens — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('emits, checks, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('design-tokens'));

    const e = pkg.kit(['design-tokens', 'emit', '--hue', '150', '--mode', 'dark', '--format', 'json', '--kind', 'landing']);
    assert.equal(e.code, 0);
    assert.equal(e.json.tokens.space['1'], '4px');
    assert.equal(e.json.tokens.layout['section-y'], '96px');
    assert.ok(e.json.contrast.primary >= 4.5 && e.json.contrast.secondary >= 4.5 && e.json.contrast.muted >= 3);

    const c = pkg.kit(['design-tokens', 'emit', '--accent', '#e11d48']);
    assert.equal(c.code, 0);
    assert.match(c.json.css, /--color-accent: #e11d48;/);

    const ok = pkg.kit(['design-tokens', 'check'], c.json.css);
    assert.equal(ok.code, 0);
    assert.equal(ok.json.ok, true);

    fs.writeFileSync(path.join(pkg.dir, 'a.css'), '.a { margin: 13px; font-weight: 800; color: #888; }\n');
    const f = pkg.kit(['design-tokens', 'check', '--file', 'a.css']);
    assert.equal(f.code, 0);
    assert.deepEqual(f.json.issues.map(i => i.code), ['OFF_GRID_SPACING', 'HEAVY_WEIGHT', 'PURE_GREY']);
    assert.deepEqual(pkg.kit(['design-tokens', 'check'], fs.readFileSync(path.join(pkg.dir, 'a.css'), 'utf-8')).json, f.json);
    const s = pkg.kit(['design-tokens', 'check', '--file', 'a.css', '--strict']);
    assert.equal(s.code, 2);
    assert.equal(s.json.ok, false);

    for (const a of [['emit', '--hue', '360'], ['emit', '--accent', 'blue'], ['emit', '--nope'], ['emit', '--mode', 'x'], ['check', '--file', 'missing.css'], ['check', '--bogus'], ['nope']]) {
      const r = pkg.kit(['design-tokens', ...a]);
      assert.equal(r.code, 1, a.join(' '));
      assert.equal(r.out, '');
    }
    assert.equal(pkg.kit(['design-tokens', 'check'], '').code, 1);
    assert.equal(pkg.kit(['design-tokens', 'check'], 'a'.repeat(9 * 1024 * 1024)).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
