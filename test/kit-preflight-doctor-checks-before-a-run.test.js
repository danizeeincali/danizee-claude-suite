import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { run, runDoctor, findOnPath, checkNode, parseConfig, verb } from '../src/lib/kit/doctor.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';

describe('doctor', () => {
  let dir, bin;
  const write = async (rel, text, mode) => { const p = path.join(dir, rel); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, text, mode ? { mode } : undefined); };
  const tool = async (n) => write(`bin/${n}`, '#!/bin/sh\n', 0o755);
  const env = (extra = {}) => ({ PATH: bin, ...extra });
  const kitFiles = async () => { await write('.claude/helpers/kit/cli.js', ''); await tool('git'); };
  const code = async (p) => { try { await p; return 0; } catch (e) { assert.ok(e instanceof KitExit); return e.code; } };
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-')); bin = path.join(dir, 'bin'); await fs.mkdir(bin); });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it('verb name', () => assert.equal(verb, 'doctor'));

  it('kit profile passes with everything present, deterministic order, row shape', async () => {
    await kitFiles();
    const r = await run([], { cwd: dir, env: env() });
    assert.equal(r.ok, true); assert.equal(r.exit, 0);
    assert.deepEqual(r.checks.map(c => c.name), ['node-version', 'bin:git', 'file:.claude/helpers/kit/cli.js']);
    for (const c of r.checks) assert.deepEqual(Object.keys(c), ['name', 'ok', 'fatal', 'found', 'fix']);
    assert.deepEqual(r, await run([], { cwd: dir, env: env() }));
  });

  it('fatal failures exit 2 and list every failing check with a fix', async () => {
    const r = await run([], { cwd: dir, env: env() });
    assert.equal(r.exit, 2); assert.equal(r.ok, false);
    assert.deepEqual(r.failed, ['bin:git', 'file:.claude/helpers/kit/cli.js']);
    for (const c of r.checks.filter(c => !c.ok)) assert.ok(c.fix.length > 10);
  });

  it('node version below 20 is fatal, 20+ passes', () => {
    assert.equal(checkNode('v18.19.0').ok, false);
    assert.equal(checkNode('v18.19.0').fatal, true);
    assert.equal(checkNode('v20.0.0').ok, true);
    assert.equal(checkNode('v22.1.0').ok, true);
    assert.equal(checkNode('garbage').ok, false);
  });

  it('nodeVersion is injectable in the library entry', async () => {
    await kitFiles();
    assert.equal((await runDoctor({ cwd: dir, env: env(), nodeVersion: 'v18.0.0' })).exit, 2);
  });

  it('marathon profile: valid json, git tree, claude advisory only', async () => {
    await kitFiles();
    await write('.claude/helpers/marathon/cli.js', '');
    await write('.claude/marathon.json', '{"a":1}');
    await write('.git/HEAD', '');
    const r = await run(['--profile', 'marathon'], { cwd: dir, env: env() });
    assert.equal(r.exit, 0);
    assert.deepEqual(r.warnings, ['bin:claude']);
    assert.equal(r.checks.find(c => c.name === 'bin:claude').fatal, false);
    await tool('claude');
    assert.deepEqual((await run(['--profile', 'marathon'], { cwd: dir, env: env() })).warnings, []);
  });

  it('marathon: broken json and missing git tree are fatal', async () => {
    await kitFiles();
    await write('.claude/helpers/marathon/cli.js', '');
    await write('.claude/marathon.json', '{oops');
    const r = await run(['--profile', 'marathon'], { cwd: dir, env: env() });
    // a temp dir may sit under a git repo; only assert the json one plus consistency
    assert.ok(r.failed.includes('json:.claude/marathon.json'));
    assert.match(r.checks.find(c => c.name === 'json:.claude/marathon.json').found, /not valid JSON/);
    assert.equal(r.exit, 2);
  });

  it('bbs and review profiles', async () => {
    await kitFiles();
    assert.deepEqual((await run(['--profile', 'bbs'], { cwd: dir, env: env() })).failed, ['file:.claude/helpers/bbs/cli.js']);
    const r = await run(['--profile', 'review'], { cwd: dir, env: env() });
    assert.equal(r.exit, 0); assert.deepEqual(r.warnings, ['bin:gh']);
  });

  it('gh is presence only: a gh stub that would fail is never run', async () => {
    await kitFiles();
    await write('bin/gh', '#!/bin/sh\ntouch RAN\nexit 1\n', 0o755);
    const r = await run(['--profile', 'review'], { cwd: dir, env: env() });
    assert.deepEqual(r.warnings, []);
    await assert.rejects(fs.stat(path.join(dir, 'RAN')));
  });

  it('findOnPath ignores non-executables, directories and empty entries', async () => {
    await write('bin/plain', 'x', 0o644);
    await fs.mkdir(path.join(bin, 'adir'));
    if (process.platform !== 'win32') assert.equal(await findOnPath('plain', { PATH: bin }), null);
    assert.equal(await findOnPath('adir', { PATH: bin }), null);
    assert.equal(await findOnPath('x', { PATH: '' }), null);
    assert.equal(await findOnPath('x', {}), null);
  });

  it('project checks: file, bin, json, env; env value never printed', async () => {
    await kitFiles();
    await tool('mytool');
    await write('data.json', '[]');
    await write('f.txt', '');
    await write('.claude/kit/doctor.json', JSON.stringify({ checks: [
      { name: 'a-file', kind: 'file', target: 'f.txt', fatal: true },
      { name: 'a-bin', kind: 'bin', target: 'mytool' },
      { name: 'a-json', kind: 'json', target: 'data.json' },
      { name: 'a-env', kind: 'env', target: 'MY_TOKEN', fatal: true }
    ] }));
    const r = await run([], { cwd: dir, env: env({ MY_TOKEN: 'sekret-value-123' }) });
    assert.equal(r.exit, 0);
    assert.deepEqual(r.checks.slice(3).map(c => c.name), ['a-file', 'a-bin', 'a-json', 'a-env']);
    assert.ok(!JSON.stringify(r).includes('sekret-value-123'));
    const miss = await run([], { cwd: dir, env: env() });
    assert.deepEqual(miss.failed, ['a-env']);
    assert.ok(!JSON.stringify(miss).includes('sekret'));
    const empty = await run([], { cwd: dir, env: env({ MY_TOKEN: '' }) });
    assert.deepEqual(empty.failed, ['a-env']);
  });

  it('project advisory failure is a warning with exit 0', async () => {
    await kitFiles();
    await write('.claude/kit/doctor.json', JSON.stringify({ checks: [{ name: 'opt', kind: 'file', target: 'nope' }] }));
    const r = await run([], { cwd: dir, env: env() });
    assert.equal(r.exit, 0); assert.deepEqual(r.warnings, ['opt']);
  });

  it('--config reads an explicit file; a missing explicit file is exit 1, a missing default is fine', async () => {
    await kitFiles();
    await write('mine.json', JSON.stringify({ checks: [{ name: 'x', kind: 'env', target: 'FOO', fatal: true }] }));
    assert.equal((await run(['--config', 'mine.json'], { cwd: dir, env: env() })).exit, 2);
    assert.equal(await code(run(['--config', 'absent.json'], { cwd: dir, env: env() })), 1);
    assert.equal((await run([], { cwd: dir, env: env() })).exit, 0);
  });

  it('bad input is exit 1', async () => {
    await kitFiles();
    const c = (args) => code(run(args, { cwd: dir, env: env() }));
    assert.equal(await c(['--profile', 'nope']), 1);
    assert.equal(await c(['--profile']), 1);
    assert.equal(await c(['--bogus']), 1);
    await write('.claude/kit/doctor.json', '{bad');
    assert.equal(await c([]), 1);
    for (const bad of [[], { checks: {} }, { checks: [1] }, { checks: [{ name: '', kind: 'file', target: 'a' }] },
      { checks: [{ name: 'n', kind: 'zip', target: 'a' }] }, { checks: [{ name: 'n', kind: 'file' }] },
      { checks: [{ name: 'n', kind: 'file', target: 'a', fatal: 'yes' }] },
      { checks: [{ name: 'n', kind: 'file', target: 'a' }, { name: 'n', kind: 'file', target: 'b' }] }]) {
      assert.throws(() => parseConfig(bad), KitExit);
    }
    await write('.claude/kit/doctor.json', JSON.stringify({ checks: [{ name: 'node-version', kind: 'file', target: 'a' }] }));
    assert.equal(await c([]), 1);
  });
});
