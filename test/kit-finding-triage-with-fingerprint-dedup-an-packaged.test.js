import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('triage — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('raise, decide, recur, close by absence, reopen; no egress', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('triage'));
    const visit = (session, violations, scopes = [], enabled = ['contrast', 'overlap']) =>
      pkg.kit(['triage', 'visit', '--session', session], JSON.stringify({ violations, scopes, enabled }));
    const viol = (el, rule = 'contrast', source = 'auto') => ({ scope: 'page:/login', rule, source, element: el, detail: 'low' });

    const first = visit('run-1', [viol('button.a'), viol('button.b'), viol('span.c')]);
    assert.equal(first.code, 0);
    assert.equal(first.json.raise.length, 1);
    assert.equal(first.json.raise[0].count, 3);
    const fp = first.json.raise[0].fingerprint;

    const filed = pkg.kit(['triage', 'decide', fp, '--as', 'filed', '--issue', 'GH-12']);
    assert.equal(filed.code, 0);
    assert.equal(filed.json.issue, 'GH-12');
    assert.ok((await fs.stat(path.join(pkg.dir, '.claude/kit/triage.json'))).isFile());

    const again = visit('run-2', [viol('button.a'), viol('button.b')]);
    assert.deepEqual(again.json.raise, []);
    assert.equal(again.json.recurred[0].issue, 'GH-12');
    assert.equal(again.json.recurred[0].occurrences, 2);

    // an agent-found issue on another scope never closes
    visit('run-2b', [{ scope: 'page:/help', rule: 'overlap', source: 'agent', element: 'div.x' }]);

    assert.deepEqual(visit('run-3', [], ['page:/login']).json.closed, []);
    // check not enabled: no evidence
    assert.equal(visit('run-4', [], ['page:/login'], ['overlap']).json.skipped.find((s) => s.fingerprint === fp).reason, 'check_not_enabled');
    assert.deepEqual(visit('run-5', [], ['page:/login']).json.closed, []);
    const closed = visit('run-6', [], ['page:/login', 'page:/help']);
    assert.deepEqual(closed.json.closed.map((c) => [c.fingerprint, c.issue]), [[fp, 'GH-12']]);
    assert.ok(closed.json.skipped.some((s) => s.reason === 'agent_sourced'));

    const back = visit('run-7', [viol('button.a')]);
    assert.equal(back.json.raise[0].status, 'reopened');
    assert.equal(back.json.raise[0].issue, 'GH-12');

    assert.equal(pkg.kit(['triage', 'visit', '--session', 'x'], '{"enabled":[]}').code, 1);
    assert.equal(pkg.kit(['triage', 'decide', 'deadbeefdeadbeef', '--as', 'dismissed']).code, 1);
    await fs.writeFile(path.join(pkg.dir, '.claude/kit/triage.json'), '{broken');
    assert.equal(visit('run-8', [viol('button.a')]).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
