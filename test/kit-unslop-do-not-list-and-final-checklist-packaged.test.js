import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('redesign-checklist — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('lists, template-tests, checks before/after, blocks with --strict, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('redesign-checklist'));
    const l = pkg.kit(['redesign-checklist', 'list']);
    assert.equal(l.code, 0);
    assert.ok(l.json.do_not.length > 0 && l.json.checklist.length > 0);

    const before = '<section id="hero"><h1>Acme tracks pallets</h1></section><section id="benefits"><input name="dock"><a href="/a">a</a></section>';
    fs.writeFileSync(path.join(pkg.dir, 'before.html'), before);
    fs.writeFileSync(path.join(pkg.dir, 'after.html'), '<section id="hero"><h1>Acme tracks pallets</h1></section><section id="benefits"><a href="/a">a</a></section>');
    fs.writeFileSync(path.join(pkg.dir, 'same.html'), before);

    const t = pkg.kit(['redesign-checklist', 'template-test', '--name', 'Acme'], '<p>Acme tracks pallets.</p><p>A powerful platform.</p>');
    assert.equal(t.code, 0);
    assert.equal(t.json.generic.length, 1);
    assert.equal(t.json.pass, false);
    const tf = pkg.kit(['redesign-checklist', 'template-test', '--name', 'Acme', '--file', 'before.html']);
    assert.equal(tf.json.pass, true);

    const adv = pkg.kit(['redesign-checklist', 'check', '--before', 'before.html', '--after', 'after.html']);
    assert.equal(adv.code, 0);
    assert.deepEqual(adv.json.violations.map(v => v.rule), ['field-removed']);
    const strict = pkg.kit(['redesign-checklist', 'check', '--before', 'before.html', '--after', 'after.html', '--strict']);
    assert.equal(strict.code, 2);
    assert.equal(strict.json.pass, false);
    const ok = pkg.kit(['redesign-checklist', 'check', '--before', 'before.html', '--after', 'same.html', '--name', 'Acme', '--strict']);
    assert.equal(ok.code, 0);
    assert.equal(ok.json.pass, true);

    assert.equal(pkg.kit(['redesign-checklist', 'check', '--before', 'before.html']).code, 1);
    assert.equal(pkg.kit(['redesign-checklist', 'check', '--before', 'before.html', '--after', 'nope.html']).code, 1);
    assert.equal(pkg.kit(['redesign-checklist', 'template-test'], 'x').code, 1);
    assert.equal(pkg.kit(['redesign-checklist', 'template-test', '--name', 'A'], '').code, 1);
    assert.equal(pkg.kit(['redesign-checklist', 'nope']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });

  it('--format overrides the sniff through the real CLI (file and piped stdin)', () => {
    const r1 = '<p align="center"><img src="a.png"></p>\n\n## Install\n\nSee [docs](https://x.y/docs).\n\n## Usage\n\nRun it.\n';
    const r2 = '<p align="center"><img src="a.png"></p>\n\n## Usage\n\nRun it.\n\n## Install\n\nSee docs.\n';
    fs.writeFileSync(path.join(pkg.dir, 'r1.md'), r1);
    fs.writeFileSync(path.join(pkg.dir, 'r2.md'), r2);
    assert.equal(pkg.kit(['redesign-checklist', 'check', '--before', 'r1.md', '--after', 'r2.md', '--strict']).code, 0);
    const f = pkg.kit(['redesign-checklist', 'check', '--before', 'r1.md', '--after', 'r2.md', '--format', 'md', '--strict']);
    assert.equal(f.code, 2);
    assert.equal(f.json.exit, 2);
    assert.equal(pkg.kit(['redesign-checklist', 'check', '--before', 'r1.md', '--after', 'r2.md', '--format', 'rst']).code, 1);
    const t = pkg.kit(['redesign-checklist', 'template-test', '--name', 'Acme', '--format', 'md'], '<b>Acme</b> pallets');
    assert.equal(t.code, 0);
    assert.equal(t.json.name_found, true);
    fs.writeFileSync(path.join(pkg.dir, 'p.txt'), 'Search everything faster.');
    assert.equal(pkg.kit(['redesign-checklist', 'template-test', '--name', 'Arc', '--file', 'p.txt']).json.name_found, false);
  });
});
