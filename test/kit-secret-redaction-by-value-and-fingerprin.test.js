import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { redactSecrets, fingerprintSecrets, redactByFingerprint, parseSecretsFile, run, verb, MARKER } from '../src/lib/kit/redact.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { DaniZeeSuiteInstaller } from '../src/installer.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const tmp = async fn => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redact-'));
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
};

describe('redactSecrets', () => {
  it('replaces each secret with the marker and counts', () => {
    assert.equal(MARKER, '[REDACTED]');
    assert.deepEqual(redactSecrets('a token-abc123 and token-abc123 b', ['token-abc123']), { text: 'a [REDACTED] and [REDACTED] b', replaced: 2 });
  });
  it('skips strings shorter than six characters', () => {
    assert.deepEqual(redactSecrets('abcde abcdef', ['abcde', '', 'ab']), { text: 'abcde abcdef', replaced: 0 });
    assert.equal(redactSecrets('abcdef', ['abcdef']).text, '[REDACTED]');
  });
  it('a multi-line secret also contributes its trimmed lines', () => {
    const key = '-----BEGIN KEY-----\n  MIIBVgIBADANBg  \nqwertyuiop12\n-----END KEY-----';
    const r = redactSecrets('partial: MIIBVgIBADANBg here', [key]);
    assert.equal(r.text, 'partial: [REDACTED] here');
    assert.equal(redactSecrets(`x ${key} y`, [key]).text, 'x [REDACTED] y');
  });
  it('locates on the original and merges overlaps: no tail from a short secret inside a longer one', () => {
    assert.deepEqual(redactSecrets('pre supersecretvalue post', ['secretval', 'supersecretvalue']), { text: 'pre [REDACTED] post', replaced: 1 });
    // partial overlap of two different secrets
    assert.deepEqual(redactSecrets('xxabcdefghijxx', ['abcdefgh', 'efghij12'.slice(0, 6) + '']), { text: 'xx[REDACTED]xx', replaced: 1 });
    // a run of overlapping matches is one span; separate occurrences stay separate
    assert.deepEqual(redactSecrets('aaaaaaaaaaaa', ['aaaaaa']), { text: '[REDACTED]', replaced: 1 });
    assert.deepEqual(redactSecrets('abcdef abcdef', ['abcdef']), { text: '[REDACTED] [REDACTED]', replaced: 2 });
  });
  it('keepLines keeps the line breaks so line numbers still match', () => {
    const key = 'BEGINKEY\nsecretline-one\nsecretline-two\nENDKEY';
    const text = 'l1\n' + key + '\nl6\r\nl7';
    const flat = redactSecrets(text, [key]);
    assert.equal(flat.text, 'l1\n[REDACTED]\nl6\r\nl7');
    const kept = redactSecrets(text, [key], { keepLines: true });
    assert.equal(kept.text.split('\n').length, text.split('\n').length);
    assert.equal(kept.text, 'l1\n[REDACTED]\n[REDACTED]\n[REDACTED]\n[REDACTED]\nl6\r\nl7');
    assert.equal(kept.replaced, 1);
  });
  it('non-string input is refused without echoing values', () => {
    assert.throws(() => redactSecrets(5, ['abcdefg']), KitExit);
    assert.throws(() => redactSecrets('x', 'abcdefg'), KitExit);
  });
});

describe('fingerprints', () => {
  it('store only lengths and hashes, no values; short ones skipped; deduplicated', () => {
    const fp = fingerprintSecrets(['hunter2hunter2', 'hunter2hunter2', 'abc']);
    assert.deepEqual(fp, { version: 1, prints: [{ length: 14, sha256: sha('hunter2hunter2') }] });
    assert.ok(!JSON.stringify(fp).includes('hunter2'));
  });
  it('a multi-line secret fingerprints its trimmed lines too', () => {
    const fp = fingerprintSecrets(['-----BEGIN-----\n  linebody12345 \n-----END-----']);
    assert.ok(fp.prints.some(p => p.sha256 === sha('linebody12345')));
  });
  it('scrubs short text by sliding a window of each length', () => {
    const fp = fingerprintSecrets(['hunter2hunter2', 'tok_9f8e7d']);
    const r = redactByFingerprint('Fix: use tok_9f8e7d and hunter2hunter2!', fp.prints);
    assert.deepEqual(r, { text: 'Fix: use [REDACTED] and [REDACTED]!', replaced: 2 });
    assert.deepEqual(redactByFingerprint('nothing here', fp.prints), { text: 'nothing here', replaced: 0 });
  });
  it('overlapping windows merge into one marker', () => {
    const fp = fingerprintSecrets(['abcdefgh', 'efghijkl']);
    assert.deepEqual(redactByFingerprint('..abcdefghijkl..', fp.prints), { text: '..[REDACTED]..', replaced: 1 });
  });
  it('refuses text over maxLength (default 4096) with a clear error', () => {
    const fp = fingerprintSecrets(['abcdefgh']);
    assert.throws(() => redactByFingerprint('x'.repeat(4097), fp.prints), e => e instanceof KitExit && e.code === 1 && /4096/.test(e.message));
    assert.equal(redactByFingerprint('x'.repeat(4096), fp.prints).replaced, 0);
    assert.throws(() => redactByFingerprint('x'.repeat(11), fp.prints, { maxLength: 10 }), /10/);
  });
  it('rejects malformed fingerprint data', () => {
    for (const bad of [null, [{ length: 3, sha256: 'x' }], [{ length: 8 }], 'nope']) assert.throws(() => redactByFingerprint('abc', bad), KitExit);
  });
});

describe('secrets file format', () => {
  it('one secret per line; BEGIN/END blocks are one multi-line entry; blank lines ignored', () => {
    const f = 'alpha-secret\n\n-----BEGIN PRIVATE KEY-----\nAAAA1111\nBBBB2222\n-----END PRIVATE KEY-----\r\nbeta-secret\n';
    assert.deepEqual(parseSecretsFile(f), ['alpha-secret', '-----BEGIN PRIVATE KEY-----\nAAAA1111\nBBBB2222\n-----END PRIVATE KEY-----', 'beta-secret']);
  });
  it('an unterminated block is an error that does not print the value', () => {
    assert.throws(() => parseSecretsFile('-----BEGIN KEY-----\nSUPERSECRETBODY\n'), e => e instanceof KitExit && !e.message.includes('SUPERSECRETBODY'));
  });
});

describe('run (CLI contract)', () => {
  const repo = async dir => { spawnSync('git', ['init', '-q', '.'], { cwd: dir }); await fs.mkdir(path.join(dir, 'sub'), { recursive: true }); };
  const io = (cwd, text = '') => ({ cwd, stdin: async () => text, env: {} });

  it('verb name', () => assert.equal(verb, 'redact'));
  it('redacts stdin with --secrets-file, with and without --keep-lines', () => tmp(async dir => {
    await repo(dir);
    await fs.writeFile(path.join(dir, 's.txt'), 'passw0rd-xyz\n');
    const r = await run(['--secrets-file', path.join(dir, 's.txt')], io(dir, 'a passw0rd-xyz b'));
    assert.deepEqual(r, { text: 'a [REDACTED] b', replaced: 1 });
  }));
  it('--fingerprint prints the fingerprint JSON; --fingerprints scrubs with it', () => tmp(async dir => {
    await repo(dir);
    await fs.writeFile(path.join(dir, 's.txt'), 'passw0rd-xyz\n');
    const fp = await run(['--fingerprint', '--secrets-file', path.join(dir, 's.txt')], io(dir));
    assert.equal(fp.version, 1);
    assert.ok(!JSON.stringify(fp).includes('passw0rd'));
    await fs.writeFile(path.join(dir, 'fp.json'), JSON.stringify(fp));
    assert.deepEqual(await run(['--fingerprints', path.join(dir, 'fp.json')], io(dir, 'x passw0rd-xyz')), { text: 'x [REDACTED]', replaced: 1 });
    await assert.rejects(run(['--fingerprints', path.join(dir, 'fp.json')], io(dir, 'x'.repeat(5000))), /4096/);
  }));
  it('the default file is <git toplevel>/.claude/kit/secrets, found from a subdirectory; missing = nothing to redact', () => tmp(async dir => {
    await repo(dir);
    const sub = path.join(dir, 'sub');
    assert.deepEqual(await run([], io(sub, 'keep passw0rd-xyz')), { text: 'keep passw0rd-xyz', replaced: 0 });
    await fs.mkdir(path.join(dir, '.claude', 'kit'), { recursive: true });
    await fs.writeFile(path.join(dir, '.claude', 'kit', 'secrets'), 'passw0rd-xyz\n');
    assert.deepEqual(await run([], io(sub, 'keep passw0rd-xyz')), { text: 'keep [REDACTED]', replaced: 1 });
  }));
  it('refuses unknown flags, a missing explicit file, conflicting modes and a non-repo default; never echoes values', () => tmp(async dir => {
    await repo(dir);
    await assert.rejects(run(['--bogus'], io(dir)), /unknown flag --bogus/);
    await assert.rejects(run(['--secrets-file', path.join(dir, 'nope')], io(dir)), KitExit);
    await assert.rejects(run(['--fingerprints', 'a', '--secrets-file', 'b'], io(dir)), KitExit);
    await fs.writeFile(path.join(dir, 'fp.json'), '{ not json passw0rd-xyz');
    await assert.rejects(run(['--fingerprints', path.join(dir, 'fp.json')], io(dir, 'x')), e => e instanceof KitExit && !e.message.includes('passw0rd'));
    await assert.rejects(run([], io(os.tmpdir() + '/definitely-not-a-repo-' + process.pid)), KitExit);
  }));
});

describe('kit plugin and review-brief caller', () => {
  it('the installer adds the .claude/kit/secrets gitignore rule once; the repo ignores it too', async () => tmp(async dir => {
    const install = () => new DaniZeeSuiteInstaller({ path: dir, force: true, withoutCookbook: true }).install();
    await install(); await install();
    const gi = (await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')).split('\n');
    assert.equal(gi.filter(l => l === '.claude/kit/secrets').length, 1);
    assert.ok((await fs.readFile(path.join(ROOT, '.gitignore'), 'utf-8')).split('\n').includes('.claude/kit/secrets'));
  }));
});
