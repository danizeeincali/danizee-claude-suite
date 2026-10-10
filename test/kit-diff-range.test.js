/**
 * Contract for the `diff-range` kit verb — stream `diff-range` of marathon 2026-10-10-kit-wiring.
 *
 *   cli.js diff-range [--dir <repo>] [--base <ref>] [--no-untracked] [--base-only] [--json]
 *
 * Prints the review range as ONE unified diff on stdout, raw text (not JSON), so it pipes straight into
 * `cli.js lenses|graph|impact --diff -`. The range is the one /w-review's three bash blocks built by hand:
 *   - tracked changes from <base> to the working tree (committed since the base, plus uncommitted edits);
 *   - plus every untracked, not-ignored file as an added file (`git diff --no-index /dev/null <f>`), unless --no-untracked.
 * <base> is --base <ref> when given, else the merge base of HEAD and @{upstream}, else the empty tree (the whole history).
 * Paths are bare and relative to the repository top (--no-prefix), whatever diff.mnemonicPrefix says, and git runs
 * with hooks off, no external diff, no colour and no inherited GIT_* variables.
 *
 * Exit: 0 a non-empty diff was printed · 3 the range is empty (nothing printed) · 1 bad input or git failed
 * (not a repository, an unknown --base, a diff that could not be produced) · 2 refused.
 * --base-only prints the resolved base (a sha, or the empty-tree id) and a newline, exit 0.
 * --json prints { base, upstream, from_upstream, tracked, untracked, empty } instead of the diff (exit 0 even when empty).
 * The cli prints a verb result's `raw` string as is (no JSON) — that is how this verb writes the diff.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { run, verb, usage } from '../src/lib/kit/diff-range.js';
import { parseDiff } from '../src/lib/kit/lenses.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'src', 'lib', 'kit', 'cli.js');
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const sh = (cwd, ...a) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const cli = (cwd, args, input) => {
  const r = spawnSync(process.execPath, [CLI, 'diff-range', ...args], { cwd, encoding: 'utf-8', input, env: { ...process.env, GIT_DIR: '', GIT_WORK_TREE: '' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

describe('diff-range — the review range as one unified diff', () => {
  let dir;
  const io = (extra = {}) => ({ cwd: dir, stdin: async () => '', env: process.env, ...extra });
  const put = async (rel, content) => { await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await fs.writeFile(path.join(dir, rel), content); };
  const commit = (msg = 'c') => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg); return sh(dir, 'rev-parse', 'HEAD'); };
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diff-range-'));
    sh(dir, 'init', '-q', '.');
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('is a discoverable verb with a usage line that names every flag and the exit codes', () => {
    assert.equal(verb, 'diff-range');
    for (const flag of ['--dir', '--base', '--no-untracked', '--base-only', '--json']) assert.ok(usage.includes(flag), flag);
    assert.match(usage, /exit 0[^;]*3[^;]*empty|3 = empty|3 empty/i);
  });

  it('with no upstream the base is the empty tree: every committed file, uncommitted edits and untracked files are in the diff', async () => {
    await put('src/a.js', 'const a = 1;\n'); commit();
    await put('src/a.js', 'const a = 2;\n');             // uncommitted edit
    await put('src/new.js', 'export const n = 1;\n');    // untracked
    const r = await run([], io());
    assert.equal(r.exit, 0);
    assert.equal(typeof r.raw, 'string');
    const files = parseDiff(r.raw).map(f => f.path).sort();
    assert.deepEqual(files, ['src/a.js', 'src/new.js']);
    const a = parseDiff(r.raw).find(f => f.path === 'src/a.js');
    assert.deepEqual(a.added, ['const a = 2;'], 'the working tree, not HEAD, is the "after" side');
    const b = await run(['--base-only'], io());
    assert.equal(b.raw, `${EMPTY_TREE}\n`);
  });

  it('paths carry no prefix even when diff.mnemonicPrefix and diff.noprefix disagree with the default', async () => {
    await put('lib/x.js', 'x\n'); commit();
    sh(dir, 'config', 'diff.mnemonicPrefix', 'true');
    await put('lib/x.js', 'y\n');
    const r = await run([], io());
    assert.ok(!/^\+\+\+ [abcdiwo]\//m.test(r.raw), r.raw.split('\n').filter(l => l.startsWith('+++')).join(' | '));
    assert.ok(/^\+\+\+ lib\/x\.js$/m.test(r.raw));
  });

  it('with an upstream the base is the merge base: only commits since it, plus the working tree', async () => {
    await put('base.txt', 'base\n'); commit('base');
    const origin = await fs.mkdtemp(path.join(os.tmpdir(), 'diff-range-origin-'));
    try {
      sh(origin, 'init', '-q', '--bare', '.');
      sh(dir, 'remote', 'add', 'origin', origin);
      sh(dir, 'push', '-q', '-u', 'origin', 'HEAD');
      const mb = sh(dir, 'rev-parse', 'HEAD');
      await put('feat.txt', 'feature\n'); commit('feat');
      await put('feat.txt', 'feature 2\n');
      const j = await run(['--json'], io());
      assert.equal(j.base, mb);
      assert.equal(j.from_upstream, true);
      assert.deepEqual(j.tracked, ['feat.txt']);
      assert.deepEqual(j.untracked, []);
      assert.equal(j.empty, false);
      const r = await run([], io());
      const files = parseDiff(r.raw).map(f => f.path);
      assert.deepEqual(files, ['feat.txt'], 'base.txt is below the merge base and must not appear');
    } finally { await fs.rm(origin, { recursive: true, force: true }); }
  });

  it('--base <ref> wins over the upstream and accepts a sha, a ref name or HEAD~N', async () => {
    await put('one.txt', '1\n'); const c1 = commit('one');
    await put('two.txt', '2\n'); commit('two');
    await put('three.txt', '3\n'); commit('three');
    for (const base of [c1, 'HEAD~2']) {
      const r = await run(['--base', base], io());
      assert.equal(r.exit, 0);
      assert.deepEqual(parseDiff(r.raw).map(f => f.path).sort(), ['three.txt', 'two.txt'], base);
      const b = await run(['--base', base, '--base-only'], io());
      assert.equal(b.raw, `${c1}\n`, 'the base is printed resolved to its sha');
    }
  });

  it('--no-untracked leaves untracked files out; ignored files are never in the diff', async () => {
    await put('.gitignore', 'secret.env\n'); await put('a.txt', 'a\n'); commit();
    await put('a.txt', 'b\n');
    await put('secret.env', 'TOKEN=1\n');
    await put('loose.txt', 'loose\n');
    const all = await run([], io());
    assert.deepEqual(parseDiff(all.raw).map(f => f.path).sort(), ['.gitignore', 'a.txt', 'loose.txt'], 'no upstream: the committed files (including .gitignore) plus the loose file');
    assert.ok(!all.raw.includes('TOKEN=1'), 'an ignored file is not part of the range');
    const no = await run(['--no-untracked'], io());
    assert.deepEqual(parseDiff(no.raw).map(f => f.path).sort(), ['.gitignore', 'a.txt']);
  });

  it('an empty range prints nothing and is exit 3, not a failure; --json says empty:true with exit 0', async () => {
    await put('a.txt', 'a\n'); commit();
    const r = await run(['--base', 'HEAD'], io());
    assert.equal(r.exit, 3);
    assert.equal(r.raw, '');
    const j = await run(['--base', 'HEAD', '--json'], io());
    assert.equal(j.empty, true);
    assert.equal(j.exit ?? 0, 0);
    const c = cli(dir, ['--base', 'HEAD']);
    assert.equal(c.code, 3);
    assert.equal(c.out, '', 'nothing on stdout for an empty range');
  });

  it('outside a repository, or with an unknown --base, it is exit 1 with the reason; an unknown flag is exit 1', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'diff-range-plain-'));
    try {
      await assert.rejects(() => run([], io({ cwd: plain })), (e) => e instanceof KitExit && e.code === 1 && /not a git repository|cannot locate/i.test(e.message));
    } finally { await fs.rm(plain, { recursive: true, force: true }); }
    await put('a.txt', 'a\n'); commit();
    await assert.rejects(() => run(['--base', 'no-such-ref'], io()), (e) => e instanceof KitExit && e.code === 1 && /no-such-ref/.test(e.message));
    await assert.rejects(() => run(['--bogus'], io()), (e) => e instanceof KitExit && e.code === 1);
    await assert.rejects(() => run(['--base'], io()), (e) => e instanceof KitExit && e.code === 1);
  });

  it('--dir names the repository (its top or any folder inside it); paths stay relative to the top', async () => {
    await put('deep/inner/f.js', 'f\n'); commit();
    await put('deep/inner/f.js', 'g\n');
    const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), 'diff-range-elsewhere-'));
    try {
      const r = await run(['--dir', path.join(dir, 'deep')], io({ cwd: elsewhere }));
      assert.deepEqual(parseDiff(r.raw).map(f => f.path), ['deep/inner/f.js']);
    } finally { await fs.rm(elsewhere, { recursive: true, force: true }); }
  });

  it('through the cli the diff is raw text (no JSON wrapper) and pipes into `lenses --diff -`', async () => {
    await put('src/svc.js', 'const x = 1;\n'); commit();
    await put('src/svc.js', 'const x = 1;\nconsole.log("auth token", token);\n');
    const d = cli(dir, []);
    assert.equal(d.code, 0, d.err);
    assert.ok(d.out.startsWith('diff --git '), d.out.slice(0, 80));
    assert.throws(() => JSON.parse(d.out), 'raw text, not JSON');
    const l = spawnSync(process.execPath, [CLI, 'lenses', '--diff', '-'], { cwd: dir, encoding: 'utf-8', input: d.out });
    assert.equal(l.status, 0, l.stderr);
    assert.ok(JSON.parse(l.stdout).fired.some(f => f.name === 'secret-in-log'), l.stdout);
  });

  it('git runs with hooks off and without inherited GIT_* variables: a repo hook that would fail does not run', async () => {
    await put('a.txt', 'a\n'); commit();
    await put('a.txt', 'b\n');
    await fs.mkdir(path.join(dir, '.git', 'hooks'), { recursive: true });
    await fs.writeFile(path.join(dir, '.git', 'hooks', 'pre-auto-gc'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const r = await run([], io({ env: { ...process.env, GIT_DIR: '/nonexistent', GIT_WORK_TREE: '/nonexistent' } }));
    assert.equal(r.exit, 0);
    assert.deepEqual(parseDiff(r.raw).map(f => f.path), ['a.txt']);
  });
});
