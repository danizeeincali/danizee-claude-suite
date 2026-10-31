import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('direction — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('templates, checks, builds a skeleton, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('direction'));
    const t = pkg.kit(['direction', 'template']);
    assert.equal(t.code, 0);
    assert.deepEqual(t.json.fields.map(f => f.id), ['product', 'character', 'world', 'moments', 'signature']);

    const good = {
      product: 'A prep-list printer for bakers who start at four.',
      character: 'Dry-humoured, punctual',
      world: 'A trade kitchen at dawn: steel shelves, chalk labels',
      moments: 'The total; the print button',
      signature: 'Every quantity has a tally-mark underline',
    };
    fs.writeFileSync(path.join(pkg.dir, 'direction.json'), JSON.stringify(good));
    const c = pkg.kit(['direction', 'check', '--file', 'direction.json']);
    assert.equal(c.code, 0);
    assert.equal(c.json.ok, true);

    const md = Object.entries(good).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)}: ${v}`).join('\n');
    assert.equal(pkg.kit(['direction', 'check'], md).json.ok, true);

    const weak = pkg.kit(['direction', 'check'], 'Product: a modern app\nCharacter: sleek');
    assert.equal(weak.code, 0);
    assert.equal(weak.json.ok, false);
    assert.ok(weak.json.problems.some(p => p.code === 'banned_word'));
    assert.equal(pkg.kit(['direction', 'check', '--strict'], 'Product: a modern app').code, 2);
    assert.equal(pkg.kit(['direction', 'check', '--strict'], JSON.stringify(good)).code, 0);

    fs.writeFileSync(path.join(pkg.dir, 'brief.json'), JSON.stringify({ kind: 'ui', answers: { offer: 'A prep-list printer', audience: 'bakers' } }));
    const b = pkg.kit(['direction', 'from-brief', '--file', 'brief.json']);
    assert.equal(b.code, 0);
    assert.equal(b.json.fields[0].todo, false);
    assert.equal(b.json.fields[3].todo, true);
    assert.equal(pkg.kit(['direction', 'from-brief'], '{"nope":1}').code, 1);

    assert.equal(pkg.kit(['direction', 'check', '--file', 'missing.json']).code, 1);
    assert.equal(pkg.kit(['direction', 'check'], '').code, 1);
    assert.equal(pkg.kit(['direction', 'nope']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
