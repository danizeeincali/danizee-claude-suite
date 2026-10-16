import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('test-plan — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('plans from stdin JSON and a diff, flags low confidence, exits 1 on bad input, no egress', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('test-plan'));
    const input = {
      targets: [
        { id: 'login', files: ['src/login.js', 'src/ui.js'], entry: true },
        { id: 'cart', files: ['src/cart.js', 'src/ui.js'] },
        { id: 'pay', files: ['src/pay.js'] },
        { id: 'faq', files: ['src/faq.js'] }
      ],
      flows: [{ id: 'buy', targets: ['cart', 'pay'] }],
      edges: [['login', 'cart'], ['cart', 'pay']],
      always: ['faq']
    };
    await fs.writeFile(path.join(pkg.dir, 'plan.json'), JSON.stringify(input));
    await fs.writeFile(path.join(pkg.dir, 'c.diff'), '--- a/src/cart.js\n+++ b/src/cart.js\n@@ -1 +1 @@\n-a\n+b\n');
    const ok = pkg.kit(['test-plan', '--in', 'plan.json', '--diff', 'c.diff']);
    assert.equal(ok.code, 0);
    assert.deepEqual(ok.json.plan.map(i => `${i.id}:${i.reason}`), ['cart:direct-change', 'pay:flow', 'faq:always']);
    assert.equal(ok.json.low_confidence, false);

    const low = pkg.kit(['test-plan', '--smoke', '1'], JSON.stringify({ ...input, changed: ['README.md'] }));
    assert.equal(low.code, 0);
    assert.equal(low.json.low_confidence, true);
    assert.deepEqual(low.json.coverage.unmapped, ['README.md']);
    assert.ok(low.json.plan.some(i => i.id === 'login' && i.reason === 'smoke'));

    assert.equal(pkg.kit(['test-plan'], '{nope').code, 1);
    assert.equal(pkg.kit(['test-plan'], '{"targets":[]}').code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
