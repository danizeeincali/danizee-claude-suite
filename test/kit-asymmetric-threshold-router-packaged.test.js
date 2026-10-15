import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('threshold-route — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  const items = [
    { id: 'reg', deterministicRegression: true, answer: { kind: 'not-anomalous', confidence: 1 } },
    { id: 'led', ledgerMatch: true },
    { id: 'quiet', answer: { kind: 'not-anomalous', confidence: 0.92 } },
    { id: 'amb', answer: { kind: 'anomaly', confidence: 0.9, ambiguity: 0.85 } },
    { id: 'none' },
    { id: 'mid-supp', answer: { kind: 'suppress', confidence: 0.6 } },
    { id: 'supp', answer: { kind: 'suppress', confidence: 0.9 } },
    { id: 'fix', answer: { kind: 'fix', confidence: 0.95 } },
    { id: 'chk', answer: { kind: 'check', confidence: 0.99 } }
  ];

  it('is listed and routes realistic input with exit 0 even when items block', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('threshold-route'));
    const r = pkg.kit(['threshold-route'], JSON.stringify({ items }));
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.results.map((x) => [x.id, x.route]), [
      ['reg', 'block'], ['led', 'as-intended'], ['quiet', 'ignore'], ['amb', 'escalate'], ['none', 'ask-human'],
      ['mid-supp', 'ask-human'], ['supp', 'suppress'], ['fix', 'auto-fix'], ['chk', 'issue']
    ]);
    assert.equal(r.json.blocks, true);
    assert.deepEqual(r.json.blocking, ['reg']);
    assert.deepEqual(r.json.results.filter((x) => x.autoFixEligible).map((x) => x.id), ['fix']);
  });

  it('reads --file and custom thresholds', async () => {
    await fs.writeFile(path.join(pkg.dir, 'in.json'), JSON.stringify(items.slice(5, 7)));
    const r = pkg.kit(['threshold-route', '--file', 'in.json', '--low', '0.2', '--high', '0.5']);
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.results.map((x) => x.route), ['suppress', 'suppress']);
    assert.equal(r.json.blocks, false);
  });

  it('exit 1 on invalid input and thresholds', () => {
    assert.equal(pkg.kit(['threshold-route'], 'nope').code, 1);
    assert.equal(pkg.kit(['threshold-route', '--low', '0.9', '--high', '0.1'], '[]').code, 1);
    assert.equal(pkg.kit(['threshold-route'], JSON.stringify([{ ledgerMatch: 'yes' }])).code, 1);
  });
  it('a malformed model answer exits 0 and still blocks a regression in the batch', () => {
    const r = pkg.kit(['threshold-route'], JSON.stringify([{ id: 'r', deterministicRegression: true }, { id: 'm', answer: { kind: 'fix', confidence: 3 } }]));
    assert.equal(r.code, 0);
    assert.match(JSON.stringify(r), /malformed-answer/);
  });

  it('makes no network call', () => assert.deepEqual(pkg.egress(), []));
});
