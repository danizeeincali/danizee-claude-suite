import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installPackaged } from './helpers/packaged.js';

describe('render — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('renders SARIF, JUnit and the sticky comment from stdin, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('render'));
    const body = JSON.stringify({
      findings: [
        { id: 'r1', message: 'Bad <thing> & more', severity: 'blocking', file: 'a.js', line: 3, testCase: 'suite > case' },
        { id: 'r2', message: 'orphan', severity: 'advisory' },
        { id: 'r3', message: 'later', severity: 'advisory', disposition: 'filed' },
      ],
      incomplete: true, reason: 'ran out of time',
    });
    const s = pkg.kit(['render', 'sarif'], '﻿' + body);
    assert.equal(s.code, 0);
    assert.deepEqual(s.json.content.runs[0].results.map(r => r.level), ['error', 'warning', 'warning']);
    const j = pkg.kit(['render', 'junit'], body);
    assert.equal(j.code, 0);
    assert.match(j.json.content, /<failure/);
    assert.match(j.json.content, /unattributed/);
    assert.match(j.json.content, /ran out of time/);
    assert.ok(j.json.content.includes('Bad &lt;thing&gt; &amp; more'));
    const c = pkg.kit(['render', 'comment', '--key', 'ci'], body);
    assert.equal(c.code, 0);
    assert.ok(c.json.content.startsWith('<!-- kit-render:ci -->\n'));
    assert.equal(pkg.kit(['render', 'comment'], '{"findings":[],"x":1}').code, 1);
    assert.equal(pkg.kit(['render', 'pdf'], body).code, 1);
    const f = pkg.kit(['render', 'sarif'], JSON.stringify({ findings: [{ message: 'no file', severity: 'blocking', disposition: 'filed' }] }));
    assert.ok(f.json.content.runs[0].results[0].locations[0]);
    assert.ok(f.json.content.runs[0].results[0].ruleId);
    assert.match(pkg.kit(['render', 'comment'], JSON.stringify({ findings: [{ message: 'no file', severity: 'blocking', disposition: 'filed' }] })).json.content, /no open blocking findings/);
    assert.deepEqual(pkg.egress(), []);
  });
});
