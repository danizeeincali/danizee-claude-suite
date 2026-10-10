import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('redact — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('a developer lists secrets, scrubs a diff, then scrubs a title by fingerprint', async () => {
    assert.ok(pkg.kit(['help']).json.verbs.includes('redact'));
    const key = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\nhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
    await fs.mkdir(path.join(pkg.dir, '.claude', 'kit'), { recursive: true });
    await fs.writeFile(path.join(pkg.dir, '.claude', 'kit', 'secrets'), `ghp_exampleToken123456\n${key}\n`);

    const diff = '+token = "ghp_exampleToken123456"\n+partial MIIEvQIBADANBgkq\n+ok line\n';
    const sub = path.join(pkg.dir, '.claude');
    const r = pkg.kit(['redact', '--keep-lines'], diff, { cwd: sub });
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.text, '+token = "[REDACTED]"\n+partial [REDACTED]\n+ok line\n');
    assert.equal(r.json.replaced, 2);
    assert.equal(r.json.text.split('\n').length, diff.split('\n').length);

    const secrets = path.join(pkg.dir, '.claude', 'kit', 'secrets');
    const fp = pkg.kit(['redact', '--fingerprint', '--secrets-file', secrets], '');
    assert.equal(fp.code, 0, fp.err);
    assert.ok(!fp.out.includes('ghp_example') && !fp.out.includes('MIIEv'));
    const fpFile = path.join(pkg.dir, 'fp.json');
    await fs.writeFile(fpFile, fp.out);
    const t = pkg.kit(['redact', '--fingerprints', fpFile], 'PR: rotate ghp_exampleToken123456 now');
    assert.equal(t.json.text, 'PR: rotate [REDACTED] now');
    const big = pkg.kit(['redact', '--fingerprints', fpFile], 'x'.repeat(5000));
    assert.equal(big.code, 1);
    assert.match(big.err, /4096/);

    const bad = pkg.kit(['redact', '--nope'], '');
    assert.equal(bad.code, 1);
    assert.ok(!bad.err.includes('ghp_'));

    const gi = await fs.readFile(path.join(pkg.dir, '.gitignore'), 'utf-8');
    assert.ok(gi.split('\n').includes('.claude/kit/secrets'));
    assert.deepEqual(pkg.egress(), []);
  });
});
