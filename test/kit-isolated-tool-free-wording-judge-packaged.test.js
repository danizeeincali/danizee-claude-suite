import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('wording-judge — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('scores, plans, judges with a stub runner inside the allow dir, resumes, and stops on a limit', async () => {
    const fx = path.join(pkg.dir, '.claude', 'helpers', 'kit', 'review-fixtures');
    const stub = path.join(pkg.dir, 'stub-runner.js');
    await fs.copyFile(path.join(import.meta.dirname, 'helpers', 'wording-stub.js'), stub);
    await fs.chmod(stub, 0o755);
    const out = path.join(pkg.dir, 'cal', 'scores');
    const s = pkg.kit(['review-score', '--specs', path.join(fx, 'specs'), '--reviews', path.join(fx, 'reviews-sample'), '--out', out]);
    assert.equal(s.code, 0, s.err);
    const before = await fs.readFile(path.join(out, 'scores.json'), 'utf-8');

    const dry = pkg.kit(['wording-judge', '--out', out, '--dry']);
    assert.equal(dry.code, 0, dry.err);
    assert.equal(dry.json.plan.calls, 2);
    await assert.rejects(fs.access(path.join(out, 'wording.json')));

    const first = pkg.kit(['wording-judge', '--out', out, '--runner', stub, '--cap', '1']);
    assert.equal(first.code, 0, first.err);
    assert.equal(first.json.calls, 1);
    const rest = pkg.kit(['wording-judge', '--out', out, '--runner', stub, '--resume']);
    assert.equal(rest.json.calls, 1);
    const w = JSON.parse(await fs.readFile(path.join(out, 'wording.json'), 'utf-8'));
    assert.equal(Object.keys(w.cases).length, 2);
    assert.equal(await fs.readFile(path.join(out, 'scores.json'), 'utf-8'), before);

    const lim = pkg.kit(['wording-judge', '--out', out, '--runner', stub], undefined, { extraEnv: { STUB_MODE: 'limit' } });
    assert.equal(lim.code, 0);
    assert.match(lim.json.stopped, /usage limit/);
    assert.equal(pkg.kit(['wording-judge']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
