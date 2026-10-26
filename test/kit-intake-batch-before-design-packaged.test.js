import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
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

  it('drives --file through the installed CLI and refuses /dev/stdin and an empty value', async () => {
    const body = JSON.stringify({ kind: 'landing', answers: { offer: 'Invoicing for freelancers', primary_action: ['Buy', 'Call'] } });
    const f = path.join(pkg.dir, 'brief-input.json');
    await fs.writeFile(f, body);
    const viaStdin = pkg.kit(['design-brief', 'assume'], body);
    const viaFile = pkg.kit(['design-brief', 'assume', '--file', 'brief-input.json']);
    assert.equal(viaFile.code, 0);
    assert.deepEqual(viaFile.json, viaStdin.json);
    assert.equal(pkg.kit(['design-brief', 'assume', '--file', '/dev/stdin'], body).code, 1);
    assert.equal(pkg.kit(['design-brief', 'assume', '--file', ''], body).code, 1);
    assert.equal(pkg.kit(['design-brief', 'assume', '--file', 'brief-input.json', '--file', 'brief-input.json']).code, 1);
    const big = pkg.kit(['design-brief', 'assume'], Buffer.alloc(8 * 1024 * 1024 + 1, 32));
    assert.equal(big.code, 1);
    assert.match(big.err, /8 MiB/);
    assert.deepEqual(pkg.egress(), []);
  });
});
