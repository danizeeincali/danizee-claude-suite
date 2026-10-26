import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('sample-content — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('lints a file and stdin, filters rules, rejects bad input, zero egress', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('sample-content'));
    await fs.writeFile(path.join(pkg.dir, 'page.md'), '# Get Started With Our Product\nLorem ipsum\nJohn Doe at Acme Corp\n');
    const r = pkg.kit(['sample-content', 'lint', '--file', 'page.md']);
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.findings.map(f => [f.rule, f.line]), [['title-case', 1], ['lorem', 2], ['placeholder-person', 3], ['placeholder-company', 3]]);
    assert.ok(r.json.findings.every(f => f.hint));
    const only = pkg.kit(['sample-content', 'lint', '--file', 'page.md', '--rules', 'lorem']);
    assert.equal(only.json.counts.total, 1);
    const s = pkg.kit(['sample-content', 'lint'], '{"a":"A seamless thing"}');
    assert.equal(s.code, 0);
    assert.equal(s.json.findings[0].rule, 'hype');
    assert.equal(pkg.kit(['sample-content', 'lint', '--file', 'page.md', '--rules', 'nope']).code, 1);
    assert.equal(pkg.kit(['sample-content', 'lint', '--file', 'absent.md']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
