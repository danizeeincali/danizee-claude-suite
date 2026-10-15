import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('doctor — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('runs from the installed kit, refuses on a fatal gap, warns on an advisory one, never egresses', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('doctor'));
    const ok = pkg.kit(['doctor']);
    assert.equal(ok.code, 0);
    assert.equal(ok.json.ok, true);

    const mpath = path.join(pkg.dir, '.claude/marathon.json');
    const names = (r) => r.json.checks.map(c => c.name);
    const marathonEnv = { extraEnv: { PATH: path.dirname(process.execPath) + path.delimiter + '/usr/bin' } };
    const mara = pkg.kit(['doctor', '--profile', 'marathon'], '', marathonEnv);
    for (const n of ['file:.claude/helpers/marathon/cli.js', 'json:.claude/marathon.json', 'git-work-tree', 'bin:claude']) assert.ok(names(mara).includes(n), n);
    assert.ok(mara.json.checks.every(c => 'name' in c && 'ok' in c && 'fatal' in c && 'found' in c && 'fix' in c));
    assert.equal(mara.json.checks.find(c => c.name === 'bin:claude').fatal, false);
    assert.ok(!mara.json.failed.includes('bin:claude'));
    assert.ok(mara.json.checks.find(c => c.name === 'git-work-tree').ok);
    // dropping marathon.json must make the fatal check run and refuse
    const saved = await fs.readFile(mpath, 'utf-8').catch(() => null);
    await fs.rm(mpath, { force: true });
    const gone = pkg.kit(['doctor', '--profile', 'marathon'], '', marathonEnv);
    assert.equal(gone.code, 2);
    assert.ok(gone.json.failed.includes('json:.claude/marathon.json'));
    assert.ok(!gone.json.failed.includes('bin:claude'));
    if (saved !== null) await fs.writeFile(mpath, saved);

    await fs.mkdir(path.join(pkg.dir, '.claude/kit'), { recursive: true });
    await fs.writeFile(path.join(pkg.dir, '.claude/kit/doctor.json'), JSON.stringify({ checks: [
      { name: 'need-token', kind: 'env', target: 'DOCTOR_PKG_TOKEN', fatal: true },
      { name: 'nice-file', kind: 'file', target: 'missing.txt' }
    ] }));
    const refused = pkg.kit(['doctor']);
    assert.equal(refused.code, 2);
    assert.deepEqual(refused.json.failed, ['need-token']);
    assert.deepEqual(refused.json.warnings, ['nice-file']);

    const pass = pkg.kit(['doctor'], '', { extraEnv: { DOCTOR_PKG_TOKEN: 'topsecret-xyz' } });
    assert.equal(pass.code, 0);
    assert.ok(!pass.out.includes('topsecret-xyz'));

    await fs.writeFile(path.join(pkg.dir, '.claude/kit/doctor.json'), '{broken');
    assert.equal(pkg.kit(['doctor']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
