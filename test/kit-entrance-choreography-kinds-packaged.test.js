import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('entrance: packaged', () => {
  let pkg;
  const groups = { groups: [
    { id: 'panel', kind: 'card', order: 1, items: 2 },
    { id: 'title', kind: 'text', order: 0 },
    { id: 'underlay', kind: 'photo', order: 2, covered: true },
    { id: 'divider', kind: 'rule', order: 3 },
  ] };
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('help lists the verb', () => {
    const r = pkg.kit(['help']);
    assert.equal(r.code, 0);
    assert.ok(r.json.verbs.includes('entrance'));
    assert.ok(r.json.usage.some(u => /entrance/.test(u)));
  });

  const check = r => {
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.timeline.map(t => t.id), ['title', 'panel', 'divider', 'underlay']);
    assert.deepEqual(r.json.timeline.map(t => t.delay_ms), [0, 120, 240, 360]);
    assert.deepEqual(r.json.timeline[1].item_delays_ms, [120, 180]);
    assert.equal(r.json.exit_order[0], 'underlay');
    assert.match(r.json.css, /@keyframes ent-panel/);
    assert.match(r.json.css, /prefers-reduced-motion: reduce/);
  };

  it('stdin happy path', () => check(pkg.kit(['entrance'], JSON.stringify(groups))));

  it('--file happy path gives the same result as stdin', async () => {
    const f = path.join(pkg.dir, 'groups.json');
    await fs.writeFile(f, JSON.stringify(groups));
    const viaFile = pkg.kit(['entrance', '--file', f]);
    check(viaFile);
    assert.deepEqual(viaFile.json, pkg.kit(['entrance'], JSON.stringify(groups)).json);
  });

  it('honours the stagger flags', () => {
    const r = pkg.kit(['entrance', '--stagger-ms', '10', '--container-stagger-ms', '30'], JSON.stringify(groups));
    assert.deepEqual(r.json.timeline.map(t => t.delay_ms), [0, 30, 60, 90]);
    assert.deepEqual(r.json.timeline[1].item_delays_ms, [30, 40]);
  });

  it('bad input exits 1', async () => {
    const ok = JSON.stringify(groups);
    const cases = [
      [['entrance'], JSON.stringify({ groups: [{ id: 'a', kind: 'banner', order: 0 }] })],
      [['entrance'], JSON.stringify({ groups: [{ id: 'a', kind: 'card', order: 0 }, { id: 'a', kind: 'text', order: 1 }] })],
      [['entrance'], JSON.stringify({ groups: [{ id: 'a', kind: 'icon', order: 0, override: { from: { scale: 0 } } }] })],
      [['entrance', '--stagger-ms', '-1'], ok],
      [['entrance', '--file', ''], ok],
      [['entrance', '--file', pkg.dir], ok],
      [['entrance', '--file', '/dev/stdin'], ok],
      [['entrance', '--stagger-ms', '1', '--stagger-ms', '2'], ok],
      [['entrance'], 'not json'],
      [['entrance'], ''],
    ];
    for (const [args, input] of cases) {
      const r = pkg.kit(args, input);
      assert.equal(r.code, 1, `${args.join(' ')} -> ${r.code}: ${r.err}`);
      assert.match(r.err, /^kit: /);
    }
  });

  it('refuses stdin over the byte cap', () => {
    const big = JSON.stringify({ groups: [] }) + ' '.repeat(8 * 1024 * 1024);
    const r = pkg.kit(['entrance'], big);
    assert.equal(r.code, 1);
    assert.match(r.err, /larger than/);
  });

  it('made no network attempts', () => assert.deepEqual(pkg.egress(), []));
});
