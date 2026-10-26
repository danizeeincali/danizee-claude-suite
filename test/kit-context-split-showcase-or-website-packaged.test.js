import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installPackaged } from './helpers/packaged.js';

describe('motion-plan — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('plans a website and a showcase, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('motion-plan'));
    const site = pkg.kit(['motion-plan'], JSON.stringify({
      request: 'animate the landing page', has_site_codebase: true,
      sections: [{ id: 'hero', kind: 'hero' }, { id: 'feat', kind: 'cards', has_visual: true }, { id: 'copy', kind: 'text' }],
    }));
    assert.equal(site.code, 0);
    assert.equal(site.json.mode, 'website');
    assert.equal(site.json.plays, 'once-on-scroll');
    assert.deepEqual(site.json.sections.map(s => s.motion), [['load-in'], ['card-intro', 'story'], []]);
    const show = pkg.kit(['motion-plan'], JSON.stringify({ request: 'a looping demo', has_site_codebase: false, sections: [] }));
    assert.equal(show.code, 0);
    assert.equal(show.json.mode, 'showcase');
    assert.equal(show.json.plays, 'loop-from-empty');
    assert.equal(pkg.kit(['motion-plan'], '{"request":"x","has_site_codebase":false,"sections":[{"id":"a","kind":"hero"},{"id":"a","kind":"text"}]}').code, 1);
    assert.equal(pkg.kit(['motion-plan'], '{"nope":1}').code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
