import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('cluster — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('clusters, lists pending pairs, merges only on a high-confidence answer, exits 1 on bad input', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('cluster'));
    const findings = [
      { id: 'f1', rule: 'a11y-label', severity: 'low', files: ['ui/Button.js', 'ui/Icon.js'], title: 'Button lacks label' },
      { id: 'f2', rule: 'a11y-label', severity: 'high', files: ['ui/Icon.js', 'ui/Button.js'], title: 'Icon button lacks label' },
      { id: 'f3', rule: 'a11y-label', severity: 'medium', files: ['ui/Icon.js', 'ui/Menu.js'], title: 'Menu icon lacks label' },
      { id: 'f4', rule: 'xss', severity: 'critical', files: ['api/render.js'], title: 'Unescaped output' }
    ];
    const r = pkg.kit(['cluster'], JSON.stringify(findings));
    assert.equal(r.code, 0);
    assert.equal(r.json.clusters.length, 3);
    assert.equal(r.json.clusters[0].representative, 'f4');
    const dup = r.json.clusters.find(c => c.members.includes('f1'));
    assert.deepEqual(dup.members, ['f1', 'f2']);
    assert.equal(dup.representative, 'f2');
    assert.equal(r.json.pending_pairs.length, 1);
    const { a, b } = r.json.pending_pairs[0];

    await fs.writeFile(path.join(pkg.dir, 'findings.json'), JSON.stringify(findings));
    await fs.writeFile(path.join(pkg.dir, 'weak.json'), JSON.stringify([{ a, b, same: true, p: 0.9, confidence: 'medium' }, { a: 'ghost', b, same: true, p: 1, confidence: 'high' }]));
    const weak = pkg.kit(['cluster', '--file', 'findings.json', '--answers', 'weak.json']);
    assert.equal(weak.code, 0);
    assert.equal(weak.json.clusters.length, 3);
    assert.equal(weak.json.ignored_answers.length, 1);

    await fs.writeFile(path.join(pkg.dir, 'strong.json'), JSON.stringify({ answers: [{ a: b, b: a, same: true, p: 0.8, confidence: 'high' }] }));
    const strong = pkg.kit(['cluster', '--file', 'findings.json', '--answers', 'strong.json']);
    assert.equal(strong.code, 0);
    assert.equal(strong.json.clusters.length, 2);
    assert.deepEqual(strong.json.clusters.find(c => c.rule === 'a11y-label').members, ['f1', 'f2', 'f3']);
    assert.equal(strong.json.pending_pairs.length, 0);

    assert.equal(pkg.kit(['cluster'], '{nope').code, 1);
    assert.equal(pkg.kit(['cluster'], JSON.stringify([{ id: 'x', rule: 'r', severity: 'low', files: [] }])).code, 1);
    assert.equal(pkg.kit(['cluster', '--file', 'findings.json', '--answers', 'nope.json']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
