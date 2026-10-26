import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('landing-sections — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('plans, checks a spec and a page, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('landing-sections'));
    const p = pkg.kit(['landing-sections', 'plan']);
    assert.equal(p.code, 0);
    assert.equal(p.json.sections[0].id, 'hero');
    assert.equal(p.json.sections.at(-1).id, 'final-cta');

    fs.writeFileSync(path.join(pkg.dir, 'spec.md'), '## Hero\n[Try it](/a)\n\n## Benefits\n\n## Final CTA\n[Try it](/a)\n');
    const c = pkg.kit(['landing-sections', 'check', '--file', 'spec.md']);
    assert.equal(c.code, 0);
    assert.deepEqual(c.json.found, ['hero', 'benefits', 'final-cta']);
    assert.deepEqual(c.json.missing, ['problem-solution', 'how-it-works', 'social-proof']);
    assert.equal(c.json.cta.mirrors, true);

    const h = pkg.kit(['landing-sections', 'check'], '<section id="faq"></section><section data-section="hero"></section>');
    assert.equal(h.code, 0);
    assert.deepEqual(h.json.out_of_order, [{ id: 'hero', expected_after: null }]);

    assert.equal(pkg.kit(['landing-sections', 'check', '--file', 'missing.md']).code, 1);
    assert.equal(pkg.kit(['landing-sections', 'check'], '').code, 1);
    assert.equal(pkg.kit(['landing-sections', 'nope']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
