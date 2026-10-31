import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('story-plan — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('templates, checks, emits a story page, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('story-plan'));
    const t = pkg.kit(['story-plan', 'template']);
    assert.equal(t.code, 0);
    assert.equal(t.json.steps.length, 3);
    fs.writeFileSync(path.join(pkg.dir, 'story.json'), t.out);
    fs.writeFileSync(path.join(pkg.dir, 'page.html'), '<html><head><style>.card{padding:8px}</style><script>1</script></head><body><div class="card"><button class="btn">Go</button></div></body></html>');

    const c = pkg.kit(['story-plan', 'check', '--file', 'story.json']);
    assert.equal(c.code, 0);
    assert.equal(c.json.ok, true);
    assert.equal(c.json.timeline.length, 3);
    assert.ok(c.json.duration_ms <= 10000);
    assert.deepEqual(pkg.kit(['story-plan', 'check'], t.out).json, c.json);

    const e = pkg.kit(['story-plan', 'emit', '--file', 'story.json', '--page', 'page.html']);
    assert.equal(e.code, 0);
    assert.equal(e.json.duration_ms, c.json.duration_ms);
    assert.ok(e.json.html.includes(`<meta name="story-duration-ms" content="${c.json.duration_ms}">`));
    assert.ok(!/<script/i.test(e.json.html));
    assert.equal((e.json.html.match(/<style data-story-step=/g) || []).length, 3);

    const o = pkg.kit(['story-plan', 'emit', '--file', 'story.json', '--page', 'page.html', '--out', 'story.html']);
    assert.equal(o.code, 0);
    assert.equal(fs.readFileSync(path.join(pkg.dir, 'story.html'), 'utf-8'), e.json.html);

    const badStory = JSON.stringify({ ...t.json, steps: t.json.steps.slice(0, 1) });
    const adv = pkg.kit(['story-plan', 'check'], badStory);
    assert.equal(adv.code, 0);
    assert.equal(adv.json.ok, false);
    assert.ok(adv.json.problems.some(p => p.code === 'step-count'));
    assert.equal(pkg.kit(['story-plan', 'check', '--strict'], badStory).code, 2);
    assert.equal(pkg.kit(['story-plan', 'emit', '--page', 'page.html'], badStory).code, 1);

    assert.equal(pkg.kit(['story-plan', 'check', '--file', 'missing.json']).code, 1);
    assert.equal(pkg.kit(['story-plan', 'check'], '').code, 1);
    assert.equal(pkg.kit(['story-plan', 'check'], '[1]').code, 1);
    assert.equal(pkg.kit(['story-plan', 'emit', '--file', 'story.json']).code, 1);
    assert.equal(pkg.kit(['story-plan', 'emit', '--file', 'story.json', '--page', 'nope.html']).code, 1);
    assert.equal(pkg.kit(['story-plan', 'nope']).code, 1);
    assert.equal(pkg.kit(['story-plan', 'check', '--file', 'story.json', '--file', 'story.json']).code, 1);
    assert.equal(pkg.kit(['story-plan', 'check'], 'é'.repeat(4.5 * 1024 * 1024)).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
