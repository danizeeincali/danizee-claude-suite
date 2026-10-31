import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('image-gate — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('requests, gates, approves, uses, declines, slots, reports, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('image-gate'));
    fs.writeFileSync(path.join(pkg.dir, 'prompt.txt'), 'A paper boat on calm water, flat shapes, warm palette\n');
    const base = ['--state', '.claude/kit/image-gate.json'];
    const r = pkg.kit(['image-gate', 'request', ...base, '--prompt-file', 'prompt.txt', '--model', 'imagegen-1', '--size', '1200x800', '--asset', 'assets/boat.png']);
    assert.equal(r.code, 0);
    assert.equal(r.json.status, 'pending');
    assert.match(r.json.question, /1200x800/);
    const id = r.json.id;
    const same = ['--prompt-file', 'prompt.txt', '--model', 'imagegen-1', '--size', '1200x800', '--asset', 'assets/boat.png'];

    const blocked = pkg.kit(['image-gate', 'check', ...base, ...same, '--id', id]);
    assert.equal(blocked.code, 2);
    assert.equal(blocked.json.approved, false);

    assert.equal(pkg.kit(['image-gate', 'approve', ...base, '--id', id]).code, 0);
    const ok = pkg.kit(['image-gate', 'check', ...base, ...same, '--id', id]);
    assert.equal(ok.code, 0);
    assert.equal(ok.json.approved, true);
    assert.equal(pkg.kit(['image-gate', 'check', ...base, ...same]).code, 0);
    fs.writeFileSync(path.join(pkg.dir, 'edited.txt'), 'A different boat entirely');
    const changed = pkg.kit(['image-gate', 'check', ...base, '--prompt-file', 'edited.txt', '--model', 'imagegen-1', '--size', '1200x800', '--asset', 'assets/boat.png']);
    assert.equal(changed.code, 2);
    assert.equal(changed.json.approved, false);
    assert.equal(pkg.kit(['image-gate', 'used', ...base, '--id', id]).code, 0);
    assert.equal(pkg.kit(['image-gate', 'check', ...base, ...same, '--id', id]).json.status, 'used');
    assert.equal(pkg.kit(['image-gate', 'check', ...base, ...same, '--id', id]).code, 2);
    assert.equal(pkg.kit(['image-gate', 'approve', ...base, '--id', id]).code, 2);
    const reroll = pkg.kit(['image-gate', 'request', ...base, '--prompt-file', 'prompt.txt', '--model', 'imagegen-1', '--size', '1200x800', '--asset', 'assets/boat.png']);
    assert.equal(reroll.json.reroll, true);

    fs.writeFileSync(path.join(pkg.dir, 'prompt2.txt'), 'A lighthouse at night');
    const r2 = pkg.kit(['image-gate', 'request', ...base, '--prompt-file', 'prompt2.txt', '--model', 'imagegen-1', '--size', '800x800']);
    assert.equal(pkg.kit(['image-gate', 'decline', ...base, '--id', r2.json.id]).code, 0);
    const rep = pkg.kit(['image-gate', 'report', ...base]);
    assert.equal(rep.code, 0);
    assert.equal(rep.json.count, 1);
    assert.equal(rep.json.requests[0].prompt, 'A lighthouse at night');
    assert.equal(pkg.kit(['image-gate', 'status', ...base]).json.count, 2);

    const s = pkg.kit(['image-gate', 'slot', '--width', '800', '--height', '800', '--radius', '16']);
    assert.equal(s.code, 0);
    assert.match(s.json.css, /width:800px;height:800px;border-radius:16px/);

    for (const a of ['/tmp/x.png', '../x.png', 'https://x.test/a.png']) {
      const bad = pkg.kit(['image-gate', 'request', ...base, '--prompt-file', 'prompt.txt', '--model', 'm', '--size', '10x10', '--asset', a]);
      assert.equal(bad.code, 1);
      assert.equal(bad.out, '');
    }
    assert.equal(pkg.kit(['image-gate', 'request', ...base, '--prompt-file', 'nope.txt', '--model', 'm', '--size', '10x10']).code, 1);
    assert.equal(pkg.kit(['image-gate', 'nope']).code, 1);
    assert.equal(pkg.kit(['image-gate', 'check', ...base, '--prompt-file', 'prompt.txt', '--model', 'zzz', '--size', '10x10', '--id', 'abcdef012345']).code, 2);
    assert.deepEqual(pkg.egress(), []);
  });
});
