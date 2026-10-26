import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installPackaged } from './helpers/packaged.js';

describe('design-brief — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('asks one batch, states assumptions, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('design-brief'));
    const body = JSON.stringify({ kind: 'landing', answers: { offer: 'Invoicing for freelancers', primary_action: ['Buy', 'Call'] } });
    const q = pkg.kit(['design-brief', 'questions'], body);
    assert.equal(q.code, 0);
    assert.equal(q.json.complete, false);
    assert.deepEqual(q.json.batch.map(b => b.field), ['audience', 'objections', 'proof', 'brand', 'references']);
    assert.equal(q.json.warnings.length, 1);
    const a = pkg.kit(['design-brief', 'assume'], body);
    assert.equal(a.code, 0);
    assert.equal(a.json.assumptions.length, 5);
    assert.match(a.json.assumptions[0].line, /^Assumed audience: /);
    assert.equal(pkg.kit(['design-brief', 'assume'], '{"kind":"landing","answers":{"offer":7}}').code, 1);
    assert.equal(pkg.kit(['design-brief', 'assume'], '{"kind":"landing","x":1}').code, 1);
    assert.equal(pkg.kit(['design-brief', 'nope'], body).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
