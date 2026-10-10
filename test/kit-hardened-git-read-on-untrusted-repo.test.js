import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import {
  safeGit, safeGitEnv, safeGitConfig, checkReadArgs, clearSafeGitCache, defaultGitRunner,
  driversFromConfig, driversFromAttributes, run, READ_SUBCOMMANDS
} from '../src/lib/kit/safe-git.js';

const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const sh = (cwd, args, env = CLEAN_ENV) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf-8', env });
const exists = (p) => fs.access(p).then(() => true, () => false);

/** A repo whose config and attributes try to run code on every kind of git read. */
async function evilRepo(root, name = 'evil') {
  const dir = path.join(root, name);
  const markers = path.join(root, `${name}-markers`);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(markers, { recursive: true });
  const mk = (n) => path.join(markers, n);
  sh(dir, ['init', '-q', '.']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\n');
  sh(dir, ['add', 'a.txt']);
  sh(dir, ['commit', '-q', '-m', 'init']);
  const hooks = path.join(dir, 'myhooks');
  await fs.mkdir(hooks);
  const script = (file, marker) => fs.writeFile(file, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  for (const h of ['post-checkout', 'post-merge', 'reference-transaction', 'pre-commit', 'post-index-change']) {
    await script(path.join(hooks, h), mk(`hook-${h}`));
    await script(path.join(dir, '.git', 'hooks', h), mk(`ghook-${h}`));
  }
  const fsm = path.join(dir, 'fsm.sh');
  await script(fsm, mk('fsmonitor'));
  await fs.writeFile(path.join(dir, '.gitattributes'), '*.txt filter=evil diff=evil\n');
  sh(dir, ['config', 'core.hooksPath', hooks]);
  sh(dir, ['config', 'core.fsmonitor', fsm]);
  sh(dir, ['config', 'filter.evil.clean', `sh -c 'touch ${mk('clean')}; cat'`]);
  sh(dir, ['config', 'filter.evil.smudge', `sh -c 'touch ${mk('smudge')}; cat'`]);
  sh(dir, ['config', 'diff.external', `sh -c 'touch ${mk('extdiff')}'`]);
  sh(dir, ['config', 'diff.evil.textconv', `sh -c 'touch ${mk('textconv')}; cat' #`]);
  sh(dir, ['config', 'submodule.recurse', 'true']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'two\n'); // dirty, so a clean filter / fsmonitor would be consulted
  await fs.writeFile(path.join(dir, 'b.txt'), 'new\n');
  const fired = async () => (await fs.readdir(markers)).sort();
  return { dir, markers, fired, mk };
}

describe('safe-git — env', () => {
  it('removes every GIT_* variable (any case of the prefix) and sets the hardening variables; does not mutate its input', () => {
    const base = { PATH: '/bin', HOME: '/h', GIT_DIR: '/elsewhere', GIT_WORK_TREE: '/w', GIT_INDEX_FILE: '/i', GIT_CONFIG_COUNT: '1', GIT_ALTERNATE_OBJECT_DIRECTORIES: '/o' };
    const copy = { ...base };
    const env = safeGitEnv(base);
    assert.deepEqual(base, copy);
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) assert.equal(env[k], undefined, k);
    assert.equal(env.PATH, '/bin');
    assert.equal(env.HOME, '/h');
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.GIT_NO_LAZY_FETCH, '1');
    assert.equal(env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(env.GIT_LFS_SKIP_SMUDGE, '1');
  });
});

describe('safe-git — parsing', () => {
  it('reads driver names from config -z output, names may contain dots', () => {
    const out = 'filter.evil.clean\ncmd\0filter.a.b.smudge\nx\ny\0filter.evil.required\ntrue\0core.x\nno\0';
    assert.deepEqual([...driversFromConfig(out)].sort(), ['a.b', 'evil']);
  });
  it('reads filter= from attribute lines, ignoring comments, unset forms and empty values', () => {
    const t = '# filter=nope\n*.a filter=one text\n*.b -filter\n*.c !filter\n*.d filter=\n[attr]m filter=two\n';
    assert.deepEqual([...driversFromAttributes(t)].sort(), ['one', 'two']);
  });
});

describe('safe-git — argument policy', () => {
  it('allows reads and adds --no-ext-diff --no-textconv to diff-producing subcommands only', () => {
    for (const s of ['diff', 'show', 'log', 'diff-tree']) {
      const a = checkReadArgs([s, 'HEAD', '--', 'x']);
      assert.deepEqual(a.slice(0, 3), [s, '--no-ext-diff', '--no-textconv'], s);
      assert.deepEqual(a.slice(3), ['HEAD', '--', 'x']);
    }
    assert.deepEqual(checkReadArgs(['rev-parse', 'HEAD']), ['rev-parse', 'HEAD']);
  });
  it('refuses writing/fetching subcommands, global options, and options that undo the hardening (exit code 2)', () => {
    const bad = [['fetch'], ['pull'], ['push'], ['clone', 'x'], ['submodule', 'update'], ['checkout', 'x'], ['config', 'a', 'b'], ['blame', 'f'],
      ['-c', 'core.pager=x', 'log'], ['--git-dir=/x', 'log'], ['log', '--ext-diff'], ['diff', '--textconv'], ['diff', '--output=/tmp/x'],
      ['diff', '--no-index', 'a', 'b'], ['cat-file', '--textconv', 'HEAD:a'], ['log', '--format=%G?'], ['diff', '-O/bin/sh'], ['log', '--show-signature']];
    for (const a of bad) assert.throws(() => checkReadArgs(a), e => e instanceof KitExit && e.code === 2, a.join(' '));
    for (const s of ['fetch', 'pull', 'push', 'clone', 'submodule', 'checkout']) assert.ok(!READ_SUBCOMMANDS.includes(s));
  });
  it('an empty argv is invalid input (exit code 1)', () => {
    assert.throws(() => checkReadArgs([]), e => e instanceof KitExit && e.code === 1);
  });
});

describe('safe-git — on a real hostile repo', () => {
  let root;
  before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-git-')); });
  after(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('control: the same repo DOES run its code under plain git (so the marker checks below mean something)', async () => {
    const r = await evilRepo(root, 'control');
    sh(r.dir, ['status']);
    sh(r.dir, ['diff']);
    sh(r.dir, ['commit', '--allow-empty', '-q', '-m', 'x']);
    const fired = await r.fired();
    assert.ok(fired.includes('fsmonitor'), `fsmonitor fires under plain git: ${fired}`);
    assert.ok(fired.includes('clean'), `clean filter fires under plain git: ${fired}`);
    assert.ok(fired.some(f => f.startsWith('hook-') || f.startsWith('ghook-')), `a hook fires under plain git: ${fired}`);
  });

  it('status, diff, log -p, show, ls-files, rev-parse through safeGit fire no hook, filter, fsmonitor, external diff or textconv', async () => {
    clearSafeGitCache();
    const r = await evilRepo(root, 'guarded');
    const head = sh(r.dir, ['rev-parse', 'HEAD']).stdout.trim();
    const calls = [['status', '--porcelain'], ['diff'], ['diff', '--cached'], ['log', '-p'], ['show', 'HEAD'], ['ls-files'], ['rev-parse', 'HEAD'], ['cat-file', '-p', 'HEAD'], ['diff-files']];
    for (const c of calls) {
      const out = await safeGit(r.dir, c);
      assert.equal(out.code, 0, `${c.join(' ')}: ${out.stderr}`);
    }
    assert.equal((await safeGit(r.dir, ['rev-parse', 'HEAD'])).stdout.trim(), head);
    assert.match((await safeGit(r.dir, ['status', '--porcelain'])).stdout, /\?\? b\.txt/);
    assert.match((await safeGit(r.dir, ['diff'])).stdout, /\+two/);
    assert.deepEqual(await r.fired(), [], 'no marker file was created');
  });

  it('the overrides alone also neutralise smudge: a raw checkout-index with them writes no smudge marker, without them it does', async () => {
    clearSafeGitCache();
    const r = await evilRepo(root, 'smudge');
    const overrides = await safeGitConfig(r.dir);
    const raw = sh(r.dir, ['checkout-index', '-f', 'a.txt']);
    assert.equal(raw.status, 0, raw.stderr);
    assert.ok((await r.fired()).includes('smudge'), 'control: smudge fires without overrides');
    await fs.rm(r.mk('smudge'));
    await fs.rm(r.mk('clean'), { force: true });
    const safe = sh(r.dir, [...overrides, 'checkout-index', '-f', 'a.txt'], safeGitEnv(CLEAN_ENV));
    assert.equal(safe.status, 0, safe.stderr);
    assert.ok(!(await r.fired()).includes('smudge'));
  });

  it('lists every driver from the config AND from nested .gitattributes, info/attributes, with all four switches each', async () => {
    clearSafeGitCache();
    const r = await evilRepo(root, 'drivers');
    await fs.mkdir(path.join(r.dir, 'sub', 'deep'), { recursive: true });
    await fs.writeFile(path.join(r.dir, 'sub', 'deep', '.gitattributes'), '*.x filter=nested\n');
    await fs.appendFile(path.join(r.dir, '.git', 'info', 'attributes'), '*.y filter=infoattr\n');
    const args = await safeGitConfig(r.dir);
    const set = args.filter((_, i) => args[i - 1] === '-c');
    for (const n of ['evil', 'nested', 'infoattr']) {
      for (const v of ['clean', 'smudge', 'process']) assert.ok(set.includes(`filter.${n}.${v}=`), `${n}.${v}`);
      assert.ok(set.includes(`filter.${n}.required=false`));
    }
    for (const s of ['core.hooksPath=/dev/null', 'core.fsmonitor=false', 'submodule.recurse=false', 'protocol.allow=never', 'diff.external=']) assert.ok(set.includes(s), s);
  });

  it('a driver from an included config file is neutralised too', async () => {
    clearSafeGitCache();
    const r = await evilRepo(root, 'included');
    await fs.writeFile(path.join(r.dir, '.git', 'extra.cfg'), `[filter "viainclude"]\n\tclean = touch ${r.mk('included')}\n`);
    sh(r.dir, ['config', 'include.path', 'extra.cfg']);
    const args = await safeGitConfig(r.dir);
    assert.ok(args.includes('filter.viainclude.clean='));
  });

  it('refuses (exit 2) a driver name it cannot switch off safely, from config or attributes, and runs nothing', async () => {
    clearSafeGitCache();
    const r = await evilRepo(root, 'weird');
    await fs.appendFile(path.join(r.dir, '.gitattributes'), '*.z filter=bad=name\n');
    const calls = [];
    const git = (a, o) => { calls.push(a); return defaultGitRunner(a, o); };
    await assert.rejects(() => safeGit(r.dir, ['status'], { git }), e => e instanceof KitExit && e.code === 2 && /bad=name/.test(e.message));
    assert.ok(!calls.some(c => c.includes('status')), 'git status never ran');
    assert.deepEqual(await r.fired(), []);

    clearSafeGitCache();
    const r2 = await evilRepo(root, 'weird2');
    sh(r2.dir, ['config', 'filter.has space.clean', 'x']);
    await assert.rejects(() => safeGitConfig(r2.dir), e => e instanceof KitExit && e.code === 2 && /has space/.test(e.message));
  });

  it('ignores an inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE pointing at another repository', async () => {
    clearSafeGitCache();
    const mine = await evilRepo(root, 'mine');
    const other = path.join(root, 'other');
    await fs.mkdir(other);
    sh(other, ['init', '-q', '.']);
    sh(other, ['commit', '--allow-empty', '-q', '-m', 'other']);
    const want = sh(mine.dir, ['rev-parse', 'HEAD']).stdout.trim();
    const otherHead = sh(other, ['rev-parse', 'HEAD']).stdout.trim();
    assert.notEqual(want, otherHead);
    const env = { ...CLEAN_ENV, GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: other, GIT_INDEX_FILE: path.join(other, '.git', 'index') };
    // control: plain git with this env answers for the other repository
    assert.equal(sh(mine.dir, ['rev-parse', 'HEAD'], env).stdout.trim(), otherHead);
    assert.equal((await safeGit(mine.dir, ['rev-parse', 'HEAD'], { env })).stdout.trim(), want);
  });

  it('caches the overrides per real path (a symlink to the same folder shares the entry) and re-reads when the config changes or fresh is set', async () => {
    clearSafeGitCache();
    const r = await evilRepo(root, 'cached');
    const link = path.join(root, 'cached-link');
    await fs.symlink(r.dir, link);
    let configReads = 0;
    const git = (a, o) => { if (a[0] === 'config') configReads++; return defaultGitRunner(a, o); };
    await safeGitConfig(r.dir, { git });
    const afterFirst = configReads;
    assert.ok(afterFirst > 0);
    await safeGitConfig(link, { git });
    await safeGitConfig(r.dir, { git });
    assert.equal(configReads, afterFirst, 'no further config reads');
    await safeGitConfig(r.dir, { git, fresh: true });
    assert.ok(configReads > afterFirst, 'fresh re-reads');
    const before = configReads;
    await new Promise(res => setTimeout(res, 20));
    sh(r.dir, ['config', 'filter.late.clean', 'x']);
    const args = await safeGitConfig(r.dir, { git });
    assert.ok(configReads > before);
    assert.ok(args.includes('filter.late.clean='), 'a driver added to the config later is caught');
  });

  it('closes stdin without input (a git that would read stdin does not hang) and passes input when given', async () => {
    clearSafeGitCache();
    const r = await evilRepo(root, 'stdin');
    const seen = [];
    const git = (a, o) => { seen.push(o); return defaultGitRunner(a, o); };
    const head = sh(r.dir, ['rev-parse', 'HEAD']).stdout.trim();
    const out = await safeGit(r.dir, ['cat-file', '--batch-check'], { git, input: `${head}\n` });
    assert.match(out.stdout, new RegExp(`^${head} commit`));
    const closed = await safeGit(r.dir, ['cat-file', '--batch-check'], { git });
    assert.equal(closed.code, 0);
    assert.equal(closed.stdout, '');
    assert.equal(seen.at(-1).input, undefined);
  });

  it('reports git itself failing as that, and a non-repository as an error (fail closed)', async () => {
    clearSafeGitCache();
    const plain = path.join(root, 'plain');
    await fs.mkdir(plain);
    await assert.rejects(() => safeGit(plain, ['status']), e => e instanceof KitExit && e.code === 1 && /not a readable git repository/.test(e.message));
    await assert.rejects(() => safeGit(path.join(root, 'nope'), ['status']), e => e instanceof KitExit && e.code === 1);
    const missing = () => { throw new KitExit('cannot run git: spawn git ENOENT', 1); };
    const r = await evilRepo(root, 'nogit');
    await assert.rejects(() => safeGit(r.dir, ['status'], { git: missing }), /cannot run git/);
  });

  it('does not rely on --path-format: a git that echoes unknown flags the way old git does cannot smuggle in paths', async () => {
    clearSafeGitCache();
    const r = await evilRepo(root, 'oldgit');
    const seen = [];
    const git = (a, o) => {
      seen.push(a);
      if (a[0] === 'rev-parse' && a.some(x => x.startsWith('--path-format'))) return { code: 0, stdout: a.filter(x => x.startsWith('--path-format')).join('\n') + '\n', stderr: '' };
      return defaultGitRunner(a, o);
    };
    const out = await safeGit(r.dir, ['status', '--porcelain'], { git });
    assert.equal(out.code, 0);
    assert.ok(!seen.flat().some(x => String(x).includes('--path-format')));
  });
});

describe('safe-git — CLI run()', () => {
  let root;
  before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-git-cli-')); clearSafeGitCache(); });
  after(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('prints { stdout, code } for --dir <path> -- <git args>', async () => {
    const r = await evilRepo(root, 'cli');
    const out = await run(['--dir', r.dir, '--', 'ls-files'], { cwd: os.tmpdir(), env: CLEAN_ENV });
    assert.equal(out.code, 0);
    assert.equal(out.stdout, 'a.txt\n');
    assert.deepEqual(await r.fired(), []);
  });
  it('refuses unknown flags, a missing command and a missing --dir value (exit 1); a write subcommand is exit 2', async () => {
    const r = await evilRepo(root, 'cli2');
    for (const a of [['--bogus', '--', 'status'], ['--dir', r.dir], ['--dir'], ['--dir', '--', 'status']]) {
      await assert.rejects(() => run(a, { cwd: root, env: CLEAN_ENV }), e => e instanceof KitExit && e.code === 1, a.join(' '));
    }
    await assert.rejects(() => run(['--dir', r.dir, '--', 'fetch', 'origin'], { cwd: root, env: CLEAN_ENV }), e => e instanceof KitExit && e.code === 2);
  });
});

describe('safe-git — caller: bbs fetch rev-parse of the fetched clone', () => {
  let root;
  before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-git-fetch-')); clearSafeGitCache(); });
  after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

  it('kit present: headOf reads HEAD of a hostile clone through safeGit and no marker appears', async () => {
    const { headOf } = await import('../src/lib/bbs/fetch.js');
    const r = await evilRepo(root, 'fetched');
    const want = sh(r.dir, ['rev-parse', 'HEAD']).stdout.trim();
    await fs.rm(r.markers, { recursive: true });
    await fs.mkdir(r.markers);
    const env = { ...CLEAN_ENV, GIT_DIR: '/nonexistent' };
    assert.equal(await headOf(r.dir, env, { timeout: 20000 }), want);
    assert.deepEqual(await r.fired(), []);
  });

  it('kit missing: headOf falls back to the injected/plain runner with the old arguments', async () => {
    const { headOf } = await import('../src/lib/bbs/fetch.js');
    const calls = [];
    const git = (args, cwd, env, opts) => { calls.push({ args, cwd }); return 'abc\n'; };
    const out = await headOf('/x/y', {}, { git, hardened: true, load: async () => null, timeout: 5 });
    assert.equal(out, 'abc');
    assert.deepEqual(calls[0].args, ['rev-parse', 'HEAD']);
    assert.equal(calls[0].cwd, '/x/y');
  });

  it('loadSafeGit resolves the sibling kit module here, and a loader failure other than "not installed" is not swallowed', async () => {
    const { loadSafeGit, headOf } = await import('../src/lib/bbs/fetch.js');
    const mod = await loadSafeGit();
    assert.equal(typeof mod.safeGit, 'function');
    await assert.rejects(() => headOf('/x', {}, { hardened: true, load: async () => { throw new SyntaxError('broken kit'); } }), /broken kit/);
  });

  it('cloneRepo fails closed (and removes the clone) when the fetched repo names a driver that cannot be switched off', async () => {
    const { cloneRepo } = await import('../src/lib/bbs/fetch.js');
    const dest = path.join(root, 'clone-weird');
    const git = async (args) => {
      if (args[0] !== 'clone') throw new Error('unexpected');
      await fs.mkdir(dest);
      sh(dest, ['init', '-q', '.']);
      sh(dest, ['commit', '--allow-empty', '-q', '-m', 'x']);
      await fs.writeFile(path.join(dest, '.gitattributes'), '* filter=a=b\n');
      return '';
    };
    await assert.rejects(() => cloneRepo('https://github.com/a/b.git', dest, { git, lookup, hardened: true, onEgress: () => {} }),
      /rev-parse HEAD failed after clone: .*a=b/);
    assert.equal(await exists(dest), false);
  });

  it('cloneRepo with an injected git and no hardened flag keeps the plain call (existing behaviour)', async () => {
    const { cloneRepo } = await import('../src/lib/bbs/fetch.js');
    const calls = [];
    const git = (args) => { calls.push(args); return args[0] === 'rev-parse' ? 'abcdef1234567890abcdef1234567890abcdef12\n' : ''; };
    const r = await cloneRepo('https://github.com/a/b.git', path.join(root, 'plain-dest'), { git, lookup, onEgress: () => {} });
    assert.equal(r.sha, 'abcdef1234567890abcdef1234567890abcdef12');
    assert.deepEqual(calls[1], ['rev-parse', 'HEAD']);
  });
});
