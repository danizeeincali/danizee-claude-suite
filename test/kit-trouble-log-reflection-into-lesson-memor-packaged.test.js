import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('reflect — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('trouble log (redacted) then guarded lessons', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('reflect'));
    await fs.mkdir(path.join(pkg.dir, '.claude/kit'), { recursive: true });
    await fs.writeFile(path.join(pkg.dir, '.claude/kit/secrets'), 'tok-PLANTED-98765\n');
    const events = [
      ...[1, 2, 3].map(() => ({ type: 'tool', name: 'Bash', input: { command: 'deploy --token tok-PLANTED-98765' }, ok: false, error: 'denied tok-PLANTED-98765' })),
      { type: 'wait' }, { type: 'wait' }, { type: 'wait' },
      { type: 'stop', reason: 'max_turns' }
    ].map((e) => JSON.stringify(e)).join('\n');
    const t = pkg.kit(['reflect', 'trouble-log'], events);
    assert.equal(t.code, 0);
    assert.ok(!t.out.includes('PLANTED'));
    assert.equal(t.json.stop, 'max_turns');
    assert.equal(t.json.counts.failed, 3);
    assert.ok(t.json.lines.includes('waited 3 times in a row'));

    const s1 = pkg.kit(['reflect', 'lessons', 'save', '--role', 'fixer', '--session', 's', '--text', 'Retry the deploy only after refreshing the access token.']);
    assert.equal(s1.code, 0);
    const dup = pkg.kit(['reflect', 'lessons', 'save', '--role', 'fixer', '--session', 's', '--text', 'Retry deploy only after refreshing the access token.']);
    assert.equal(dup.code, 2);
    assert.match(dup.err, /L1/);
    assert.equal(pkg.kit(['reflect', 'lessons', 'save', '--role', 'fixer', '--session', 's', '--text', 'Retry deploy only after refreshing the access token.', '--confirm', 'L1']).json.lesson.kept, 1);
    assert.equal(pkg.kit(['reflect', 'lessons', 'retire', '--id', 'L1', '--reason', 'token was not the cause']).code, 0);
    assert.equal(pkg.kit(['reflect', 'lessons', 'save', '--role', 'fixer', '--text', 'Retry the deploy only after refreshing the access token.']).code, 1, 'no --session');
    assert.equal(pkg.kit(['reflect', 'lessons', 'list']).json.lessons.length, 0);
    assert.equal(pkg.kit(['reflect', 'lessons', 'list', '--all']).json.lessons[0].status, 'retired');
    assert.equal(pkg.kit(['reflect', 'lessons', 'bogus']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
