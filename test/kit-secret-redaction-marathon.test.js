/** The caller: marathon's review-brief scrubs the diff with the project's .claude/kit/secrets. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = path.join(ROOT, 'src', 'templates', 'marathon');
const SECRET = 'sk_live_abcdef123456';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf-8' });

/** A project whose installed-style helpers live in .claude/helpers (marathon, and kit when withKit). */
async function project({ withKit }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-redact-'));
  const claude = path.join(dir, '.claude');
  await fs.mkdir(path.join(claude, 'marathon', 'reviewer'), { recursive: true });
  await fs.cp(path.join(ROOT, 'src', 'lib', 'marathon'), path.join(claude, 'helpers', 'marathon'), { recursive: true });
  if (withKit) await fs.cp(path.join(ROOT, 'src', 'lib', 'kit'), path.join(claude, 'helpers', 'kit'), { recursive: true });
  for (const f of ['severity.md', 'angles.md']) await fs.copyFile(path.join(TEMPLATES, 'reviewer', f), path.join(claude, 'marathon', 'reviewer', f));
  await fs.copyFile(path.join(TEMPLATES, 'rules.md'), path.join(claude, 'marathon', 'rules.md'));
  await fs.copyFile(path.join(TEMPLATES, 'finish-line.example.json'), path.join(claude, 'marathon', 'finish-line.example.json'));
  git(dir, ['init', '-q', '.']); git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'hi\n');
  git(dir, ['add', '.']); git(dir, ['commit', '-qm', 'init']);
  const base = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  await fs.writeFile(path.join(dir, 'conf.js'), `export const key = '${SECRET}';\nexport const ok = 1;\n`);
  git(dir, ['add', '.']); git(dir, ['commit', '-qm', 'conf']);
  return { dir, base, cli: path.join(claude, 'helpers', 'marathon', 'cli.js') };
}
const brief = (p) => {
  const step = (args) => { const r = spawnSync(process.execPath, [p.cli, ...args], { cwd: p.dir, encoding: 'utf-8' }); assert.equal(r.status, 0, r.stderr); };
  step(['init', 'rb', '--isolation', 'folder']);
  step(['stream', 'a', 'state=active', 'next=x']);
  return spawnSync(process.execPath, [p.cli, 'review-brief', '--stream', 'a', '--base', p.base], { cwd: p.dir, encoding: 'utf-8' });
};

describe('review-brief redacts the diff', () => {
  const dirs = [];
  after(async () => { for (const d of dirs) await fs.rm(d, { recursive: true, force: true }); });

  it('with the kit and a secrets file: the value is gone, the count is reported', async () => {
    const p = await project({ withKit: true }); dirs.push(p.dir);
    await fs.mkdir(path.join(p.dir, '.claude', 'kit'), { recursive: true });
    await fs.writeFile(path.join(p.dir, '.claude', 'kit', 'secrets'), `${SECRET}\n`);
    const r = brief(p);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(SECRET), 'the secret must not reach the brief');
    assert.match(r.stdout, /export const key = '\[REDACTED\]'/);
    assert.match(r.stdout, /Redacted 1 secret value/);
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
  });

  it('with the kit but no secrets file: the brief is untouched and no redaction note appears', async () => {
    const p = await project({ withKit: true }); dirs.push(p.dir);
    const r = brief(p);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(SECRET));
    assert.doesNotMatch(r.stdout, /Redacted \d+ secret/);
  });

  it('without the kit installed: marathon still works', async () => {
    const p = await project({ withKit: false }); dirs.push(p.dir);
    const r = brief(p);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /conf\.js/);
    assert.doesNotMatch(r.stdout, /Redacted \d+ secret/);
  });

  it('without the kit but with a secrets file: the brief is refused (fail closed, review r2)', async () => {
    const p = await project({ withKit: false }); dirs.push(p.dir);
    await fs.mkdir(path.join(p.dir, '.claude', 'kit'), { recursive: true });
    await fs.writeFile(path.join(p.dir, '.claude', 'kit', 'secrets'), `${SECRET}\n`);
    const r = brief(p);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /kit redact module/);
    assert.ok(!(r.stdout + r.stderr).includes(SECRET));
  });

  it('a dangling secrets symlink stops the brief naming the file (fail closed, review r2)', async () => {
    const p = await project({ withKit: true }); dirs.push(p.dir);
    await fs.mkdir(path.join(p.dir, '.claude', 'kit'), { recursive: true });
    await fs.symlink(path.join(p.dir, 'not-mounted', 'secrets'), path.join(p.dir, '.claude', 'kit', 'secrets'));
    const r = brief(p);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /cannot read \.claude\/kit\/secrets \(ENOENT\)/);
  });

  it('an unreadable secrets file stops the brief without printing values (fail closed, review r2)', { skip: process.getuid?.() === 0 ? 'root can read any file' : false }, async () => {
    const p = await project({ withKit: true }); dirs.push(p.dir);
    await fs.mkdir(path.join(p.dir, '.claude', 'kit'), { recursive: true });
    const f = path.join(p.dir, '.claude', 'kit', 'secrets');
    await fs.writeFile(f, `${SECRET}\n`);
    await fs.chmod(f, 0o000);
    const r = brief(p);
    await fs.chmod(f, 0o600);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /cannot read \.claude\/kit\/secrets \(EACCES\)/);
    assert.ok(!r.stderr.includes(SECRET));
  });

  it('a secrets path that is not a readable file (a directory) stops the brief (fail closed, review r2)', async () => {
    const p = await project({ withKit: true }); dirs.push(p.dir);
    await fs.mkdir(path.join(p.dir, '.claude', 'kit', 'secrets'), { recursive: true });
    const r = brief(p);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /cannot read \.claude\/kit\/secrets \(EISDIR\)/);
  });

  it('a broken secrets file stops the brief (fail closed) without printing values', async () => {
    const p = await project({ withKit: true }); dirs.push(p.dir);
    await fs.mkdir(path.join(p.dir, '.claude', 'kit'), { recursive: true });
    await fs.writeFile(path.join(p.dir, '.claude', 'kit', 'secrets'), '-----BEGIN KEY-----\nTOPSECRETBODY\n');
    const r = brief(p);
    assert.notEqual(r.status, 0);
    assert.ok(!(r.stdout + r.stderr).includes('TOPSECRETBODY'));
  });
});
