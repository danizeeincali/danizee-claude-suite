import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import crypto from 'crypto';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import {
  safeGit, safeGitEnv, safeGitConfig, checkReadArgs, clearSafeGitCache, defaultGitRunner,
  driversFromConfig, driversFromAttributes, run, READ_SUBCOMMANDS,
  parseConfigList, allowedCore, repoFormat, describeDirtyPlan, buildShadow, DEFAULT_LIMITS,
  resolveGit, absolutePathEntries, unsafeIndexPath, escapingPath, usage
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
  it('allows reads and adds --no-ext-diff --no-textconv --ignore-submodules=all to diff-producing subcommands only', () => {
    for (const s of ['diff', 'show', 'log', 'diff-tree', 'diff-index', 'diff-files']) {
      const a = checkReadArgs([s, 'HEAD', '--', 'x']);
      assert.deepEqual(a.slice(0, 4), [s, '--no-ext-diff', '--no-textconv', '--ignore-submodules=all'], s);
      assert.deepEqual(a.slice(4), ['HEAD', '--', 'x']);
    }
    assert.deepEqual(checkReadArgs(['status', '--porcelain']), ['status', '--ignore-submodules=all', '--porcelain']);
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
    for (const s of ['core.hooksPath=/dev/null', 'core.fsmonitor=', 'submodule.recurse=false', 'protocol.allow=never', 'diff.external=']) assert.ok(set.includes(s), s);
    // before git 2.36 core.fsmonitor is a hook path: "false" would run a program named false; only EMPTY is off everywhere
    assert.ok(!set.some(s => /^core\.fsmonitor=./i.test(s)), `fsmonitor override is empty: ${set.filter(s => /fsmonitor/i.test(s))}`);
  });

  it('a driver from an included config file never runs (includes are not even opened: the shadow never uses them)', async () => {
    clearSafeGitCache();
    const r = await evilRepo(root, 'included');
    await fs.writeFile(path.join(r.dir, '.git', 'extra.cfg'), `[filter "viainclude"]\n\tclean = touch ${r.mk('included')}\n`);
    sh(r.dir, ['config', 'include.path', 'extra.cfg']);
    // review round 4: config is read with --no-includes, so an included driver is not discovered from the include ...
    assert.ok(!(await safeGitConfig(r.dir)).includes('filter.viainclude.clean='), 'the include is not read');
    // ... yet it never runs: the shadow config defines no driver (whatever attributes name it)
    await fs.writeFile(path.join(r.dir, '.gitattributes'), '*.txt filter=evil diff=evil\nb.txt filter=viainclude\n');
    sh(r.dir, ['add', 'b.txt']);
    assert.ok((await r.fired()).includes('included'), 'control: the included filter fires under plain git');
    await fs.rm(r.mk('included'));
    await fs.writeFile(path.join(r.dir, 'b.txt'), 'changed, a different size\n');
    for (const c of [['status', '--porcelain'], ['diff'], ['diff', '--cached'], ['ls-files', '--stage']]) {
      assert.equal((await safeGit(r.dir, c)).code, 0, c.join(' '));
    }
    assert.ok(!(await r.fired()).includes('included'), `the included filter never runs: ${await r.fired()}`);
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

  it('never serves stale overrides: a symlink to the same folder gives the same list, every call re-reads the config, a later driver is caught', async () => {
    clearSafeGitCache();
    const r = await evilRepo(root, 'cached');
    const link = path.join(root, 'cached-link');
    await fs.symlink(r.dir, link);
    let configReads = 0;
    const git = (a, o) => { if (a[0] === 'config') configReads++; return defaultGitRunner(a, o); };
    const first = await safeGitConfig(r.dir, { git });
    const afterFirst = configReads;
    assert.ok(afterFirst > 0);
    assert.deepEqual(await safeGitConfig(link, { git }), first, 'the symlink resolves to the same repository');
    assert.ok(configReads > afterFirst, 'no cache: the second call read the config again');
    const before = configReads;
    sh(r.dir, ['config', 'filter.late.clean', 'x']);
    const args = await safeGitConfig(r.dir, { git });
    assert.ok(configReads > before);
    assert.ok(args.includes('filter.late.clean='), 'a driver added to the config later is caught (no mtime race: nothing is cached)');
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

  it('kit missing: headOf falls back to the injected/plain runner: rev-parse HEAD of the clone via --git-dir, run from its parent', async () => {
    const { headOf } = await import('../src/lib/bbs/fetch.js');
    const calls = [];
    const git = (args, cwd, env, opts) => { calls.push({ args, cwd }); return 'abc\n'; };
    const out = await headOf('/x/y', {}, { git, hardened: true, load: async () => null, timeout: 5 });
    assert.equal(out, 'abc');
    assert.deepEqual(calls[0].args, ['--git-dir', path.join('/x/y', '.git'), 'rev-parse', 'HEAD']);
    assert.equal(calls[0].cwd, '/x');
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
    const git = (args) => { calls.push(args); return args.includes('rev-parse') ? 'abcdef1234567890abcdef1234567890abcdef12\n' : ''; };
    const r = await cloneRepo('https://github.com/a/b.git', path.join(root, 'plain-dest'), { git, lookup, onEgress: () => {} });
    assert.equal(r.sha, 'abcdef1234567890abcdef1234567890abcdef12');
    assert.deepEqual(calls[1], ['--git-dir', path.join(root, 'plain-dest', '.git'), 'rev-parse', 'HEAD']);
  });
});

describe('safe-git — review round 1 regressions (config.worktree, linked worktrees, abbreviated options)', () => {
  let root;
  before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-git-r1-')); });
  after(async () => { await fs.rm(root, { recursive: true, force: true }); });

  /** A plain committed repo plus a markers folder; nothing hostile yet. */
  async function plainRepo(name) {
    const dir = path.join(root, name);
    const markers = path.join(root, `${name}-markers`);
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(markers, { recursive: true });
    sh(dir, ['init', '-q', '.']);
    await fs.writeFile(path.join(dir, 'f.txt'), 'one\n');
    sh(dir, ['add', 'f.txt']);
    sh(dir, ['commit', '-q', '-m', 'init']);
    return { dir, markers, mk: (n) => path.join(markers, n), fired: async () => (await fs.readdir(markers)).sort() };
  }

  /** extensions.worktreeConfig + a clean filter and core.attributesFile (a file inside .git) set only in config.worktree. */
  async function worktreeConfigRepo(name) {
    const r = await plainRepo(name);
    sh(r.dir, ['config', 'extensions.worktreeConfig', 'true']);
    await fs.writeFile(path.join(r.dir, '.git', 'evilattrs'), '* filter=wtevil\n');
    sh(r.dir, ['config', '--worktree', 'filter.wtevil.clean', `sh -c 'touch ${r.mk('clean')}; cat'`]);
    sh(r.dir, ['config', '--worktree', 'core.attributesFile', '.git/evilattrs']);
    assert.equal(sh(r.dir, ['config', '--local', '--get', 'filter.wtevil.clean']).status, 1, 'setup: the driver is NOT in .git/config');
    await fs.writeFile(path.join(r.dir, 'f.txt'), 'two\n');
    return r;
  }

  it('control: a clean filter set only in config.worktree DOES run under plain git diff', async () => {
    const r = await worktreeConfigRepo('wtcfg-control');
    sh(r.dir, ['diff']);
    assert.ok((await r.fired()).includes('clean'), 'control: config.worktree clean filter fires under plain git');
  });

  it('a clean filter + core.attributesFile set only in config.worktree is neutralised: diff/status through safeGit run nothing', async () => {
    clearSafeGitCache();
    const r = await worktreeConfigRepo('wtcfg');
    const args = await safeGitConfig(r.dir);
    assert.ok(args.includes('filter.wtevil.clean='), 'driver from config.worktree is listed');
    for (const c of [['diff'], ['status', '--porcelain'], ['diff-files'], ['log', '-p']]) {
      const out = await safeGit(r.dir, c);
      assert.equal(out.code, 0, `${c.join(' ')}: ${out.stderr}`);
    }
    assert.match((await safeGit(r.dir, ['diff'])).stdout, /\+two/);
    assert.deepEqual(await r.fired(), [], 'no marker file was created');
  });

  it('a driver named only in core.attributesFile inside .git (set in config.worktree, no config key) is still switched off', async () => {
    clearSafeGitCache();
    const r = await plainRepo('attrfile-only');
    sh(r.dir, ['config', 'extensions.worktreeConfig', 'true']);
    await fs.writeFile(path.join(r.dir, '.git', 'evilattrs'), '* filter=onlyattr diff=onlydiff merge=onlymerge\n');
    sh(r.dir, ['config', '--worktree', 'core.attributesFile', '.git/evilattrs']);
    const args = await safeGitConfig(r.dir);
    for (const n of ['onlyattr', 'onlydiff', 'onlymerge']) {
      for (const k of ['filter.%.clean=', 'filter.%.smudge=', 'filter.%.process=', 'filter.%.required=false', 'diff.%.command=', 'diff.%.textconv=', 'merge.%.driver=']) {
        assert.ok(args.includes(k.replace('%', n)), k.replace('%', n));
      }
    }
  });

  /** A main repo plus a linked worktree whose own config.worktree names a clean filter; returns the linked worktree. */
  async function linkedWorktree(name) {
    const main = await plainRepo(name);
    const wt = path.join(root, `${name}-wt`);
    const add = sh(main.dir, ['worktree', 'add', '-q', wt]);
    assert.equal(add.status, 0, add.stderr);
    sh(main.dir, ['config', 'extensions.worktreeConfig', 'true']);
    sh(wt, ['config', '--worktree', 'filter.lwevil.clean', `sh -c 'touch ${main.mk('clean')}; cat'`]);
    sh(wt, ['config', '--worktree', 'diff.lwdiff.textconv', `sh -c 'touch ${main.mk('textconv')}; cat' #`]);
    // the attributes come from the COMMON dir's info/attributes, not .git/worktrees/<x>/info/attributes
    await fs.mkdir(path.join(main.dir, '.git', 'info'), { recursive: true });
    await fs.writeFile(path.join(main.dir, '.git', 'info', 'attributes'), '* filter=lwevil diff=lwdiff\n*.none filter=commonattr\n');
    assert.equal(sh(main.dir, ['config', '--get', 'filter.lwevil.clean']).status, 1, 'setup: the main worktree does not see it');
    await fs.writeFile(path.join(wt, 'f.txt'), 'two\n');
    return { ...main, wt };
  }

  it('control: in a linked worktree the config.worktree clean filter (attributes from the common dir) DOES run under plain git', async () => {
    const r = await linkedWorktree('linked-control');
    sh(r.wt, ['diff']);
    assert.ok((await r.fired()).includes('clean'), `clean filter fires under plain git: ${await r.fired()}`);
  });

  it('a linked worktree: drivers from its config.worktree and from the common dir info/attributes are switched off; nothing runs', async () => {
    clearSafeGitCache();
    const r = await linkedWorktree('linked');
    const args = await safeGitConfig(r.wt);
    for (const s of ['filter.lwevil.clean=', 'diff.lwdiff.textconv=', 'filter.commonattr.clean=', 'filter.commonattr.required=false']) {
      assert.ok(args.includes(s), s);
    }
    for (const c of [['diff'], ['status', '--porcelain'], ['diff-files'], ['log', '-p'], ['show', 'HEAD']]) {
      const out = await safeGit(r.wt, c);
      assert.equal(out.code, 0, `${c.join(' ')}: ${out.stderr}`);
    }
    assert.match((await safeGit(r.wt, ['diff'])).stdout, /\+two/);
    assert.deepEqual(await r.fired(), [], 'no marker file was created');
  });

  it('a config.worktree written after the first call invalidates the cache', async () => {
    clearSafeGitCache();
    const r = await plainRepo('wtcache');
    sh(r.dir, ['config', 'extensions.worktreeConfig', 'true']);
    await safeGitConfig(r.dir);
    await new Promise(res => setTimeout(res, 20));
    sh(r.dir, ['config', '--worktree', 'filter.later.clean', 'x']);
    assert.ok((await safeGitConfig(r.dir)).includes('filter.later.clean='));
  });

  /** A repo whose committed .gitattributes sends f.txt through a textconv and a smudge filter that drop markers. */
  async function textconvRepo(name) {
    const r = await plainRepo(name);
    await fs.writeFile(path.join(r.dir, '.gitattributes'), '* diff=tc filter=sm\n');
    sh(r.dir, ['add', '.gitattributes']);
    sh(r.dir, ['commit', '-q', '-m', 'attrs']);
    sh(r.dir, ['config', 'diff.tc.textconv', `sh -c 'touch ${r.mk('textconv')}; cat' #`]);
    sh(r.dir, ['config', 'filter.sm.smudge', `sh -c 'touch ${r.mk('smudge')}; cat'`]);
    return r;
  }

  it('control: plain git cat-file with an ABBREVIATED --textc / --filt runs the repository textconv / smudge', async () => {
    const r = await textconvRepo('abbrev-control');
    const t = sh(r.dir, ['cat-file', '--textc', 'HEAD:f.txt']);
    assert.equal(t.status, 0, t.stderr);
    const f = sh(r.dir, ['cat-file', '--filt', 'HEAD:f.txt']);
    assert.equal(f.status, 0, f.stderr);
    assert.deepEqual(await r.fired(), ['smudge', 'textconv']);
  });

  it('refuses (exit 2) every abbreviation of a denied long option, with or without =value, and runs nothing', async () => {
    clearSafeGitCache();
    const r = await textconvRepo('abbrev');
    const calls = [];
    const git = (a, o) => { calls.push(a); return defaultGitRunner(a, o); };
    const bad = [['cat-file', '--textc', 'HEAD:f.txt'], ['cat-file', '--textconv', 'HEAD:f.txt'], ['cat-file', '--tex', 'HEAD:f.txt'],
      ['cat-file', '--filt', 'HEAD:f.txt'], ['cat-file', '--filters', 'HEAD:f.txt'], ['cat-file', '--batch', '--filt'],
      ['cat-file', '--batch=%(objectname)', '--textc'], ['cat-file', '--batch-command', '--filters'],
      ['diff', '--ext-d'], ['log', '--ext'], ['log', '--show-sig'], ['diff', '--outp=/tmp/x'], ['diff', '--out', '/tmp/x'],
      ['diff', '--no-ind', 'a', 'b'], ['show', '--textc=yes'], ['log', '--='], ['diff', '--open-files']];
    for (const a of bad) {
      assert.throws(() => checkReadArgs(a), e => e instanceof KitExit && e.code === 2, a.join(' '));
      await assert.rejects(() => safeGit(r.dir, a, { git }), e => e instanceof KitExit && e.code === 2, a.join(' '));
    }
    assert.ok(!calls.some(c => c.includes('cat-file') || c.includes('diff') || c.includes('log')), 'the refused command never ran');
    assert.deepEqual(await r.fired(), []);
  });

  it('keeps ordinary long options working (no-textconv, name-only, output-indicator-new, batch-check, exit-code)', async () => {
    clearSafeGitCache();
    const r = await textconvRepo('abbrev-ok');
    for (const a of [['diff', '--no-textconv', '--name-only'], ['diff', '--output-indicator-new=>'], ['diff', '--exit-code'], ['cat-file', '--batch-check'], ['log', '--format=%H']]) {
      assert.doesNotThrow(() => checkReadArgs(a), a.join(' '));
    }
    assert.equal((await safeGit(r.dir, ['cat-file', '-p', 'HEAD:f.txt'])).stdout, 'one\n');
    assert.deepEqual(await r.fired(), []);
  });

  it('defence in depth: the overrides alone empty every diff driver textconv — a raw cat-file --textconv with them runs nothing', async () => {
    clearSafeGitCache();
    const r = await textconvRepo('tcoverride');
    const overrides = await safeGitConfig(r.dir);
    assert.ok(overrides.includes('diff.tc.textconv='));
    assert.ok(overrides.includes('diff.tc.command='));
    sh(r.dir, [...overrides, 'cat-file', '--textconv', 'HEAD:f.txt'], safeGitEnv(CLEAN_ENV));
    sh(r.dir, [...overrides, 'cat-file', '--filters', 'HEAD:f.txt'], safeGitEnv(CLEAN_ENV));
    assert.deepEqual(await r.fired(), [], 'no textconv or smudge with the overrides');
    sh(r.dir, ['cat-file', '--textconv', 'HEAD:f.txt']);
    assert.ok((await r.fired()).includes('textconv'), 'control: textconv fires without the overrides');
  });

  it('parses diff=/merge= drivers from attributes and diff./merge. subsections from config', () => {
    assert.deepEqual([...driversFromAttributes('* diff=a merge=b filter=c -diff !merge diff\n')].sort(), ['a', 'b', 'c']);
    assert.deepEqual([...driversFromConfig('diff.x.y.textconv\nz\0merge.m.driver\nq\0diff.external\nw\0merge.renormalize\ntrue\0')].sort(), ['m', 'x.y']);
  });

  it('refuses (exit 2) a diff= or merge= driver name it cannot switch off safely', async () => {
    clearSafeGitCache();
    const r = await plainRepo('weirddiff');
    await fs.writeFile(path.join(r.dir, '.gitattributes'), '* diff=a=b\n');
    await assert.rejects(() => safeGitConfig(r.dir), e => e instanceof KitExit && e.code === 2 && /a=b/.test(e.message));
    clearSafeGitCache();
    const r2 = await plainRepo('weirdmerge');
    sh(r2.dir, ['config', 'merge.has space.driver', 'x']);
    await assert.rejects(() => safeGitConfig(r2.dir), e => e instanceof KitExit && e.code === 2 && /has space/.test(e.message));
  });
});

describe('safe-git — shadow git dir: the repository config is never read (review round 2 regressions and the whole class)', () => {
  let root;
  before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-git-r2-')); });
  after(async () => { await fs.rm(root, { recursive: true, force: true }); });

  const script = (file, marker, rc = 0) => fs.writeFile(file, `#!/bin/sh\ntouch '${marker}'\nexit ${rc}\n`, { mode: 0o755 });

  async function plainRepo(name, initArgs = []) {
    const dir = path.join(root, name);
    const markers = path.join(root, `${name}-markers`);
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(markers, { recursive: true });
    const init = sh(dir, ['init', '-q', ...initArgs, '.']);
    assert.equal(init.status, 0, init.stderr);
    await fs.writeFile(path.join(dir, 'f.txt'), 'one\n');
    sh(dir, ['add', 'f.txt']);
    sh(dir, ['commit', '-q', '-m', 'init']);
    return { dir, markers, mk: (n) => path.join(markers, n), fired: async () => (await fs.readdir(markers)).sort() };
  }

  /** Strips every -c override, --no-ext-diff/--no-textconv and GIT_NO_LAZY_FETCH: what is left is the shadow alone. */
  const stripC = (a) => { const out = []; for (let i = 0; i < a.length; i++) { if (a[i] === '-c') { i++; continue; } out.push(a[i]); } return out; };
  const shadowOnly = (rewrite = (a) => a) => (a, o) => {
    const env = { ...o.env };
    delete env.GIT_NO_LAZY_FETCH;
    return defaultGitRunner(rewrite(stripC(a).filter(x => x !== '--no-ext-diff' && x !== '--no-textconv')), { ...o, env });
  };

  /** format.pretty=%G? + gpg.program + pretty.<alias> + a commit carrying a gpgsig header. */
  async function gpgRepo(name) {
    const r = await plainRepo(name);
    const tree = sh(r.dir, ['rev-parse', 'HEAD^{tree}']).stdout.trim();
    const body = `tree ${tree}\nauthor t <t@t> 1 +0000\ncommitter t <t@t> 1 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEz\n -----END PGP SIGNATURE-----\n\nsigned\n`;
    const sha = spawnSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: r.dir, input: body, encoding: 'utf-8', env: CLEAN_ENV }).stdout.trim();
    sh(r.dir, ['update-ref', 'refs/heads/signed', sha]);
    sh(r.dir, ['checkout', '-q', 'signed']);
    const gpg = path.join(root, `${name}-gpg.sh`);
    await script(gpg, r.mk('gpg'), 1);
    for (const k of ['gpg.program', 'gpg.ssh.program', 'gpg.x509.program']) sh(r.dir, ['config', k, gpg]);
    sh(r.dir, ['config', 'format.pretty', 'format:%H %G?']);
    sh(r.dir, ['config', 'pretty.sneaky', 'format:%G? %GS']);
    sh(r.dir, ['config', 'log.showSignature', 'true']);
    return { ...r, sha };
  }

  it('control: plain git log -1 with the repo format.pretty=%G? runs the repo gpg.program', async () => {
    const r = await gpgRepo('gpg-control');
    sh(r.dir, ['log', '-1']);
    assert.ok((await r.fired()).includes('gpg'), 'control: gpg.program fires under plain git');
  });

  it('format.pretty + gpg.program + pretty.<alias> + log.showSignature: log -1, show -s, log --format=<alias> through safeGit run nothing', async () => {
    const r = await gpgRepo('gpg');
    const log = await safeGit(r.dir, ['log', '-1']);
    assert.equal(log.code, 0, log.stderr);
    assert.match(log.stdout, new RegExp(`^commit ${r.sha}`), 'the repo format.pretty is not applied (default medium)');
    assert.equal((await safeGit(r.dir, ['show', '-s', 'HEAD'])).code, 0);
    for (const a of [['log', '-1', '--format=sneaky'], ['log', '-1', '--pretty=sneaky'], ['show', '-s', '--format=sneaky']]) {
      const out = await safeGit(r.dir, a);
      assert.notEqual(out.code, 0, `${a.join(' ')}: the alias from the repo config does not exist for git`);
    }
    for (const a of [['log', '-1'], ['show', '-s', 'HEAD']]) assert.equal((await safeGit(r.dir, a, { git: shadowOnly() })).code, 0);
    assert.deepEqual(await r.fired(), [], 'gpg.program never ran');
  });

  it('refuses %G and %(signature) in any format argument (=value, separate value, for-each-ref, alias forms)', async () => {
    const r = await gpgRepo('gpg-args');
    const bad = [['for-each-ref', '--format=%(signature)'], ['for-each-ref', '--format', '%(signature:signer)'], ['for-each-ref', '--format=%( Signature)'],
      ['log', '--pretty=format:%G?'], ['log', '--format', '%GS'], ['show', '--pretty=tformat:%GK'], ['log', '--forma=%G?']];
    for (const a of bad) await assert.rejects(() => safeGit(r.dir, a), e => e instanceof KitExit && e.code === 2, a.join(' '));
    assert.equal((await safeGit(r.dir, ['for-each-ref', '--format=%(refname)'])).code, 0);
    assert.deepEqual(await r.fired(), []);
  });

  /** Outer repo with a populated gitlink `sub` whose OWN config + info/attributes name a clean filter, sub/f stat-dirty. */
  async function submoduleRepo(name) {
    const r = await plainRepo(name);
    const sub = path.join(r.dir, 'sub');
    await fs.mkdir(sub);
    sh(sub, ['init', '-q', '.']);
    await fs.writeFile(path.join(sub, 'f'), 'hello\n');
    sh(sub, ['add', 'f']);
    sh(sub, ['commit', '-q', '-m', 's']);
    sh(r.dir, ['add', 'sub']);
    sh(r.dir, ['commit', '-q', '-m', 'gitlink']);
    sh(sub, ['config', 'filter.zz.clean', `sh -c 'touch ${r.mk('subclean')}; cat'`]);
    await fs.writeFile(path.join(sub, '.git', 'info', 'attributes'), '* filter=zz\n');
    await fs.writeFile(path.join(sub, 'f'), 'HELLO\n');
    const future = new Date(Date.now() + 3600e3);
    await fs.utimes(path.join(sub, 'f'), future, future);
    return r;
  }

  it('control: plain git status in the outer repo runs the clean filter of a checked-out submodule', async () => {
    const r = await submoduleRepo('sub-control');
    sh(r.dir, ['status', '--porcelain']);
    assert.ok((await r.fired()).includes('subclean'), `control: submodule filter fires under plain git: ${await r.fired()}`);
  });

  it('submodule-local filters: status, diff, diff-files, diff-index, describe --dirty through safeGit run nothing', async () => {
    const r = await submoduleRepo('sub');
    for (const a of [['status', '--porcelain'], ['diff'], ['diff-files'], ['diff-index', 'HEAD'], ['describe', '--always', '--dirty'],
      ['describe', '--always', '--broken'], ['describe', '--always', '--di=-X'], ['ls-files', '-m'], ['log', '-p', '-1']]) {
      const out = await safeGit(r.dir, a);
      assert.equal(out.code, 0, `${a.join(' ')}: ${out.stderr}`);
    }
    assert.deepEqual(await r.fired(), [], 'the submodule filter never ran');
    const head = sh(r.dir, ['rev-parse', '--short', 'HEAD']).stdout.trim();
    assert.equal((await safeGit(r.dir, ['describe', '--always', '--dirty'])).stdout, `${head}\n`, 'submodule changes are ignored');
    await fs.writeFile(path.join(r.dir, 'f.txt'), 'changed\n');
    assert.equal((await safeGit(r.dir, ['describe', '--always', '--dirty'])).stdout, `${head}-dirty\n`);
    assert.equal((await safeGit(r.dir, ['describe', '--always', '--dirty=.mod'])).stdout, `${head}.mod\n`);
    assert.equal((await safeGit(r.dir, ['describe', '--always', '--dirty', '--no-dirty'])).stdout, `${head}\n`);
    await assert.rejects(() => safeGit(r.dir, ['describe', '--dirty', 'HEAD']), e => e instanceof KitExit && e.code === 1 && /commit-ishes/.test(e.message));
    assert.deepEqual(await r.fired(), []);
  });

  it('refuses options that reach into submodules: --recurse-submodules, --ignore-submodules=<x>, --submodule=<x> and their prefixes', async () => {
    const r = await submoduleRepo('sub-args');
    for (const a of [['ls-files', '--recurse-submodules'], ['ls-files', '--recurse'], ['status', '--ignore-submodules=none'], ['diff', '--ignore-sub=none'],
      ['diff', '--submodule=diff'], ['log', '-p', '--submod=log'], ['diff-index', '--ignore-submodules', 'HEAD']]) {
      await assert.rejects(() => safeGit(r.dir, a), e => e instanceof KitExit && e.code === 2, a.join(' '));
    }
    for (const a of [['diff', '--ignore-space-change'], ['status', '--ignored'], ['diff', '--stat'], ['log', '--reverse']]) assert.doesNotThrow(() => checkReadArgs(a), a.join(' '));
    assert.deepEqual(await r.fired(), []);
  });

  /** extensions.partialClone + a promisor remote whose ext:: url runs a command + protocol.ext.allow=always. */
  async function promisorRepo(name) {
    const r = await plainRepo(name);
    sh(r.dir, ['config', 'core.repositoryformatversion', '1']);
    sh(r.dir, ['config', 'extensions.partialClone', 'origin']);
    sh(r.dir, ['config', 'remote.origin.promisor', 'true']);
    sh(r.dir, ['config', 'remote.origin.url', `ext::sh -c touch% ${r.mk('ext')}`]);
    sh(r.dir, ['config', 'protocol.ext.allow', 'always']);
    sh(r.dir, ['config', 'protocol.allow', 'always']);
    return r;
  }
  const MISSING = '1234567890123456789012345678901234567890';

  it('control: plain git cat-file of a missing object in a partial clone runs the promisor ext:: remote (without GIT_NO_LAZY_FETCH)', async () => {
    const r = await promisorRepo('promisor-control');
    sh(r.dir, ['cat-file', '-t', MISSING]);
    assert.ok((await r.fired()).includes('ext'), 'control: ext:: transport fires under plain git');
  });

  it('partial clone + protocol.ext.allow: no promisor remote exists in the shadow, even with GIT_NO_LAZY_FETCH and every -c removed', async () => {
    const r = await promisorRepo('promisor');
    const out = await safeGit(r.dir, ['cat-file', '-t', MISSING]);
    assert.notEqual(out.code, 0);
    const bare = await safeGit(r.dir, ['cat-file', '-t', MISSING], { git: shadowOnly() });
    assert.notEqual(bare.code, 0);
    assert.equal((await safeGit(r.dir, ['log', '--oneline'], { git: shadowOnly() })).code, 0, 'the repo still reads (partialclone dropped)');
    assert.deepEqual(await r.fired(), [], 'the ext:: command never ran');
  });

  it('the shadow alone stops every exploit: with all -c overrides, --no-ext-diff/--no-textconv and GIT_NO_LAZY_FETCH removed, nothing runs', async () => {
    const r = await evilRepo(root, 'shadow-only');
    // a deny-list that "forgot" --textconv / --filters: the runner rewrites the argv after the policy check
    const rewrite = (a) => a.map(x => (x === '--batch-check' ? '--textconv' : x === '--batch-all-objects' ? '--filters' : x));
    const git = shadowOnly(rewrite);
    for (const c of [['status', '--porcelain'], ['diff'], ['diff', '--cached'], ['log', '-p'], ['show', 'HEAD'], ['diff-files'], ['ls-files', '-m'],
      ['describe', '--always', '--dirty'], ['cat-file', '-p', 'HEAD']]) {
      const out = await safeGit(r.dir, c, { git });
      assert.equal(out.code, 0, `${c.join(' ')}: ${out.stderr}`);
    }
    await safeGit(r.dir, ['cat-file', '--batch-check', 'HEAD:a.txt'], { git }); // becomes cat-file --textconv
    await safeGit(r.dir, ['cat-file', '--batch-all-objects', 'HEAD:a.txt'], { git }); // becomes cat-file --filters
    assert.match((await safeGit(r.dir, ['diff'], { git })).stdout, /\+two/);
    assert.deepEqual(await r.fired(), [], 'no hook, filter, fsmonitor, external diff or textconv ran');
    const wt = await plainRepo('shadow-only-wt');
    sh(wt.dir, ['config', 'extensions.worktreeConfig', 'true']);
    await fs.writeFile(path.join(wt.dir, '.git', 'evilattrs'), '* filter=wtevil\n');
    sh(wt.dir, ['config', '--worktree', 'filter.wtevil.clean', `sh -c 'touch ${wt.mk('clean')}; cat'`]);
    sh(wt.dir, ['config', '--worktree', 'core.attributesFile', '.git/evilattrs']);
    await fs.writeFile(path.join(wt.dir, 'f.txt'), 'two\n');
    for (const c of [['diff'], ['status', '--porcelain']]) assert.equal((await safeGit(wt.dir, c, { git })).code, 0);
    assert.deepEqual(await wt.fired(), [], 'config.worktree filter never ran');
  });

  it('the shadow config holds only allow-listed, validated keys; the shadow dir is private (0700), uses the real objects, and is removed after the call', async () => {
    const r = await evilRepo(root, 'shadow-shape');
    sh(r.dir, ['config', 'core.quotepath', 'false']);
    sh(r.dir, ['config', 'core.ignorecase', 'sneaky;value']);
    let seen = null;
    const git = (a, o) => {
      if (o.env?.GIT_DIR && !seen) {
        const gd = o.env.GIT_DIR;
        seen = {
          gd, env: o.env,
          config: fsSync.readFileSync(path.join(gd, 'config'), 'utf-8'),
          mode: fsSync.statSync(path.dirname(gd)).mode & 0o777,
          hooks: fsSync.existsSync(path.join(gd, 'hooks')),
          index: fsSync.existsSync(path.join(gd, 'index'))
        };
      }
      return defaultGitRunner(a, o);
    };
    const realIndex = await fs.readFile(path.join(r.dir, '.git', 'index'));
    assert.equal((await safeGit(r.dir, ['status', '--porcelain'], { git })).code, 0);
    assert.ok(seen, 'git ran with a GIT_DIR');
    assert.ok(!seen.gd.startsWith(r.dir), 'GIT_DIR is not inside the repository');
    assert.equal(seen.mode, 0o700);
    assert.equal(seen.hooks, false, 'no hooks dir');
    assert.equal(seen.index, true, 'the index is copied');
    assert.equal(seen.env.GIT_OBJECT_DIRECTORY, path.join(await fs.realpath(r.dir), '.git', 'objects'));
    assert.equal(seen.env.GIT_WORK_TREE, await fs.realpath(r.dir));
    assert.equal(seen.env.GIT_CONFIG_NOSYSTEM, '1');
    const keys = seen.config.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('[')).map(l => l.split(' = ')[0]);
    const ALLOWED = ['repositoryformatversion', 'bare', 'objectformat', 'ignorecase', 'precomposeunicode', 'quotepath', 'filemode', 'symlinks', 'autocrlf', 'eol'];
    for (const k of keys) assert.ok(ALLOWED.includes(k), `only allow-listed keys in the shadow config, got ${k}`);
    for (const k of ['repositoryformatversion', 'bare', 'quotepath']) assert.ok(keys.includes(k), k);
    assert.ok(!keys.includes('ignorecase'), 'an invalid boolean is dropped, not copied');
    assert.match(seen.config, /quotepath = false/);
    assert.doesNotMatch(seen.config, /hooks|fsmonitor|filter|diff|sneaky|recurse/i);
    assert.equal(fsSync.existsSync(path.dirname(seen.gd)), false, 'the shadow is removed after the call');
    // describe --dirty refreshes and writes an index: only the shadow copy
    await safeGit(r.dir, ['describe', '--always', '--dirty']);
    assert.deepEqual(await fs.readFile(path.join(r.dir, '.git', 'index')), realIndex, 'the real index is untouched');
    assert.deepEqual(await r.fired(), []);
  });

  it('a filter added later through an included config file never runs (the include is not read; nothing is cached)', async () => {
    const r = await plainRepo('include-late');
    sh(r.dir, ['config', 'include.path', 'extra.cfg']);
    await fs.writeFile(path.join(r.dir, '.git', 'extra.cfg'), '');
    assert.ok(!(await safeGitConfig(r.dir)).includes('filter.late.clean='));
    // both the driver and the attributes file naming it (outside the repo) are reachable only through the include
    const attrs = path.join(root, 'include-late-attrs');
    await fs.writeFile(attrs, '*.txt filter=late\n');
    await fs.writeFile(path.join(r.dir, '.git', 'extra.cfg'), `[filter "late"]\n\tclean = "sh -c 'touch ${r.mk('late')}; cat'"\n[core]\n\tattributesFile = ${attrs}\n`);
    await fs.writeFile(path.join(r.dir, 'f.txt'), 'two, a different size\n');
    sh(r.dir, ['diff']);
    assert.ok((await r.fired()).includes('late'), 'control: the included filter fires under plain git');
    await fs.rm(r.mk('late'));
    // review round 4: includes are read with --no-includes, so the included driver is not listed; it still never runs
    assert.ok(!(await safeGitConfig(r.dir)).includes('filter.late.clean='), 'the include is not opened');
    assert.match((await safeGit(r.dir, ['diff'])).stdout, /\+two, a different size/);
    assert.equal((await safeGit(r.dir, ['status', '--porcelain'], { git: shadowOnly() })).code, 0);
    assert.deepEqual(await r.fired(), []);
  });

  it('refs, packed refs and the index are read at call time: a commit, a new branch, pack-refs, a deleted branch and a staged file are seen by the next call', async () => {
    const r = await plainRepo('refs-live');
    const h1 = sh(r.dir, ['rev-parse', 'HEAD']).stdout.trim();
    assert.equal((await safeGit(r.dir, ['rev-parse', 'HEAD'])).stdout.trim(), h1);
    sh(r.dir, ['commit', '--allow-empty', '-q', '-m', 'second']);
    const h2 = sh(r.dir, ['rev-parse', 'HEAD']).stdout.trim();
    assert.notEqual(h1, h2);
    assert.equal((await safeGit(r.dir, ['rev-parse', 'HEAD'])).stdout.trim(), h2);
    sh(r.dir, ['branch', 'feature', h1]);
    assert.match((await safeGit(r.dir, ['for-each-ref', '--format=%(refname) %(objectname)'])).stdout, new RegExp(`refs/heads/feature ${h1}`));
    sh(r.dir, ['pack-refs', '--all']);
    assert.equal(await exists(path.join(r.dir, '.git', 'refs', 'heads', 'feature')), false, 'setup: the ref is now only packed');
    assert.equal((await safeGit(r.dir, ['rev-parse', 'feature'])).stdout.trim(), h1);
    sh(r.dir, ['branch', '-D', 'feature']);
    assert.notEqual((await safeGit(r.dir, ['rev-parse', '--verify', '-q', 'feature'])).code, 0);
    await fs.writeFile(path.join(r.dir, 'new.txt'), 'n\n');
    sh(r.dir, ['add', 'new.txt']);
    assert.match((await safeGit(r.dir, ['status', '--porcelain'])).stdout, /^A {2}new\.txt$/m);
    sh(r.dir, ['tag', 'v1']);
    assert.equal((await safeGit(r.dir, ['describe', '--tags'])).stdout.trim(), 'v1');
  });

  it('a sha256 repository works', async (t) => {
    const probe = spawnSync('git', ['init', '-q', '--object-format=sha256', path.join(root, 'sha256-probe')], { encoding: 'utf-8', env: CLEAN_ENV });
    if (probe.status !== 0) { t.skip(`this git cannot create sha256 repositories: ${probe.stderr.trim()}`); return; }
    const r = await plainRepo('sha256', ['--object-format=sha256']);
    const head = sh(r.dir, ['rev-parse', 'HEAD']).stdout.trim();
    assert.match(head, /^[0-9a-f]{64}$/);
    assert.equal((await safeGit(r.dir, ['rev-parse', 'HEAD'])).stdout.trim(), head);
    await fs.writeFile(path.join(r.dir, 'f.txt'), 'two\n');
    assert.match((await safeGit(r.dir, ['diff'])).stdout, /\+two/);
    assert.equal((await safeGit(r.dir, ['log', '--oneline'])).code, 0);
    assert.equal((await safeGit(r.dir, ['cat-file', '-t', head])).stdout.trim(), 'commit');
  });

  it('a linked worktree reads its own HEAD, index and work tree; --show-toplevel is the real work tree', async () => {
    const main = await plainRepo('lw-main');
    const wt = path.join(root, 'lw-wt');
    assert.equal(sh(main.dir, ['worktree', 'add', '-q', '-b', 'side', wt]).status, 0);
    sh(wt, ['commit', '--allow-empty', '-q', '-m', 'on side']);
    const wtHead = sh(wt, ['rev-parse', 'HEAD']).stdout.trim();
    const mainHead = sh(main.dir, ['rev-parse', 'HEAD']).stdout.trim();
    assert.notEqual(wtHead, mainHead);
    assert.equal((await safeGit(wt, ['rev-parse', 'HEAD'])).stdout.trim(), wtHead);
    assert.equal((await safeGit(main.dir, ['rev-parse', 'HEAD'])).stdout.trim(), mainHead);
    assert.equal((await safeGit(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim(), 'side');
    assert.equal((await safeGit(wt, ['rev-parse', '--show-toplevel'])).stdout.trim(), await fs.realpath(wt));
    await fs.writeFile(path.join(wt, 'f.txt'), 'wt\n');
    assert.match((await safeGit(wt, ['status', '--porcelain'])).stdout, /^ M f\.txt$/m);
    assert.equal((await safeGit(main.dir, ['status', '--porcelain'])).stdout, '');
    await fs.mkdir(path.join(wt, 'deep'));
    // review round 5: git never runs inside the repository, so every command runs as from the top of the work tree;
    // a --dir in a subfolder is refused (exit 1) instead of silently re-rooting pathspecs to the top
    for (const a of [['rev-parse', '--show-prefix'], ['rev-parse', '--show-toplevel'], ['status', '--porcelain']]) {
      await assert.rejects(() => safeGit(path.join(wt, 'deep'), a),
        e => e instanceof KitExit && e.code === 1 && /pass the repository top; paths are relative to it/.test(e.message), a.join(' '));
    }
    assert.equal((await safeGit(wt, ['rev-parse', '--show-prefix'])).stdout, '\n');
    // the linked worktree's own git dir is a valid --dir too (a git dir, no work tree)
    const wtGitDir = path.resolve(wt, sh(wt, ['rev-parse', '--git-dir']).stdout.trim());
    assert.equal((await safeGit(wtGitDir, ['rev-parse', 'HEAD'])).stdout.trim(), wtHead);
  });

  it('a bare repository (and a path inside .git) reads without a work tree', async () => {
    const src = await plainRepo('bare-src');
    const bareDir = path.join(root, 'bare.git');
    assert.equal(sh(root, ['clone', '-q', '--bare', src.dir, bareDir]).status, 0);
    const head = sh(src.dir, ['rev-parse', 'HEAD']).stdout.trim();
    assert.equal((await safeGit(bareDir, ['rev-parse', 'HEAD'])).stdout.trim(), head);
    assert.equal((await safeGit(bareDir, ['rev-parse', '--is-bare-repository'])).stdout.trim(), 'true');
    assert.match((await safeGit(bareDir, ['ls-tree', 'HEAD'])).stdout, /\tf\.txt$/m);
    assert.equal((await safeGit(bareDir, ['log', '--oneline'])).code, 0);
    assert.notEqual((await safeGit(bareDir, ['status'])).code, 0, 'status needs a work tree');
    assert.equal((await safeGit(path.join(src.dir, '.git'), ['rev-parse', 'HEAD'])).stdout.trim(), head);
    assert.equal((await safeGit(path.join(src.dir, '.git'), ['rev-parse', '--is-inside-work-tree'])).stdout.trim(), 'false');
    await assert.rejects(() => safeGit(path.join(src.dir, '.git', 'refs'), ['rev-parse', '--is-inside-work-tree']),
      e => e instanceof KitExit && e.code === 1 && /pass the repository top/.test(e.message), 'a folder inside the git dir is not the git dir');
  });

  it('a shallow clone reads (the shallow file is copied)', async () => {
    const src = await plainRepo('shallow-src');
    sh(src.dir, ['commit', '--allow-empty', '-q', '-m', 'two']);
    const dest = path.join(root, 'shallow');
    assert.equal(sh(root, ['clone', '-q', '--depth', '1', `file://${src.dir}`, dest]).status, 0);
    const out = await safeGit(dest, ['log', '--format=%s']);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.stdout, 'two\n');
  });

  it('refuses (exit 2) a reftable repository, an unknown extension and a format version above 1, and runs nothing', async () => {
    for (const [name, keys] of [['reftable', [['extensions.refStorage', 'reftable']]], ['unknown-ext', [['extensions.somethingNew', 'true']]],
      ['compat', [['extensions.compatObjectFormat', 'sha256']]], ['badformat', [['extensions.objectFormat', 'md5']]]]) {
      const r = await plainRepo(name);
      sh(r.dir, ['config', 'core.repositoryformatversion', '1']);
      for (const [k, v] of keys) sh(r.dir, ['config', k, v]);
      const calls = [];
      const git = (a, o) => { calls.push(a); return defaultGitRunner(a, o); };
      await assert.rejects(() => safeGit(r.dir, ['rev-parse', 'HEAD'], { git }), e => e instanceof KitExit && e.code === 2, name);
      assert.ok(!calls.some(c => c.includes('rev-parse')), `${name}: git rev-parse never ran`);
    }
    const v2 = await plainRepo('format-v2');
    await fs.appendFile(path.join(v2.dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 2\n');
    await assert.rejects(() => safeGit(v2.dir, ['rev-parse', 'HEAD']), e => e instanceof KitExit && e.code === 2 && /repositoryformatversion/.test(e.message));
    const ok = await plainRepo('refstorage-files');
    sh(ok.dir, ['config', 'core.repositoryformatversion', '1']);
    sh(ok.dir, ['config', 'extensions.refStorage', 'files']);
    sh(ok.dir, ['config', 'extensions.preciousObjects', 'true']);
    assert.equal((await safeGit(ok.dir, ['rev-parse', 'HEAD'])).code, 0, 'refstorage=files and preciousObjects are fine');
  });

  it('refuses rev-parse options that would print the private shadow dir', async () => {
    const r = await plainRepo('revparse-shadow');
    for (const o of ['--git-dir', '--absolute-git-dir', '--git-common-dir', '--shared-index-path']) {
      await assert.rejects(() => safeGit(r.dir, ['rev-parse', o]), e => e instanceof KitExit && e.code === 2, o);
    }
    await assert.rejects(() => safeGit(r.dir, ['rev-parse', '--git-path', 'hooks']), e => e instanceof KitExit && e.code === 2);
    assert.equal((await safeGit(r.dir, ['rev-parse', '--show-toplevel'])).stdout.trim(), await fs.realpath(r.dir));
  });

  it('a gitfile pointing nowhere is an error (exit 1), not a silent read of something else', async () => {
    const dir = path.join(root, 'badgitfile');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, '.git'), 'gitdir: /nonexistent/x\n');
    await assert.rejects(() => safeGit(dir, ['status']), e => e instanceof KitExit && e.code === 1 && /invalid gitfile/.test(e.message));
  });

  it('parses config -z lists and validates the allow-listed core values', () => {
    assert.deepEqual(parseConfigList('core.bare\nfalse\0core.quotepath\0a.b\nx\ny\0'), [['core.bare', 'false'], ['core.quotepath', null], ['a.b', 'x\ny']]);
    assert.deepEqual(allowedCore([['core.bare', 'no'], ['core.quotepath', null], ['core.ignorecase', 'maybe'], ['core.autocrlf', 'on'], ['core.eol', 'evil'], ['core.pager', 'x']]),
      { bare: false, quotepath: true, autocrlf: 'true' });
    assert.deepEqual(repoFormat([['core.repositoryformatversion', '1'], ['extensions.objectformat', 'sha256'], ['extensions.worktreeconfig', 'true'], ['extensions.partialclone', 'origin']]),
      { version: '1', objectFormat: 'sha256', worktreeConfig: true });
  });

  it('describeDirtyPlan: finds --dirty/--broken (abbreviated, =mark, --no-), keeps --match values, refuses commit-ishes', () => {
    assert.equal(describeDirtyPlan(['describe', '--tags']), null);
    assert.equal(describeDirtyPlan(['log', '--dirty']), null);
    assert.deepEqual(describeDirtyPlan(['describe', '--di', '--match', 'v*']), { argv: ['describe', '--match', 'v*'], dirty: '-dirty', broken: null });
    assert.deepEqual(describeDirtyPlan(['describe', '--b=-B']), { argv: ['describe'], dirty: '-dirty', broken: '-B' });
    assert.equal(describeDirtyPlan(['describe', '--dirty', '--no-dirty']), null);
    assert.throws(() => describeDirtyPlan(['describe', '--dirty', 'HEAD']), e => e instanceof KitExit && e.code === 1);
    assert.throws(() => describeDirtyPlan(['describe', '--dirty', '--', 'HEAD']), e => e instanceof KitExit && e.code === 1);
  });
});

describe('safe-git — review round 3 regressions (copy limits, symlinked refs, ignored trees, HOME, fsmonitor)', () => {
  let root;
  before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-git-r3-')); });
  after(async () => { await fs.rm(root, { recursive: true, force: true }); });

  async function plainRepo(name) {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    sh(dir, ['init', '-q', '.']);
    await fs.writeFile(path.join(dir, 'f.txt'), 'one\n');
    sh(dir, ['add', 'f.txt']);
    sh(dir, ['commit', '-q', '-m', 'init']);
    return { dir, real: await fs.realpath(dir) };
  }
  /** What buildShadow needs, built by hand so the test owns (and can measure) the scratch folder. */
  const infoFor = (real, gitDir = path.join(real, '.git'), commonDir = gitDir) =>
    ({ loc: { real, gitDir, commonDir, top: real }, fmt: { version: '0', objectFormat: null }, core: {}, top: real });
  /** Bytes actually allocated on disk under a folder (sparse-aware). */
  async function diskUsage(d) {
    let n = 0;
    for (const e of await fs.readdir(d, { withFileTypes: true, recursive: true })) {
      const st = await fs.lstat(path.join(e.parentPath ?? e.path, e.name));
      n += st.blocks * 512;
    }
    return n;
  }
  const GiB = 1024 ** 3;

  it('a sparse 2 GiB index and a sparse 2 GiB packed-refs are refused (exit 2) quickly, naming the file, with nothing large written', async () => {
    for (const [name, file] of [['sparse-index', 'index'], ['sparse-packed', 'packed-refs']]) {
      const r = await plainRepo(name);
      const target = path.join(r.real, '.git', file);
      await fs.appendFile(target, '');
      await fs.truncate(target, 2 * GiB);
      assert.ok((await fs.stat(target)).blocks * 512 < 64 * 1024 * 1024, 'setup: the file is sparse');
      const scratch = await fs.mkdtemp(path.join(root, `${name}-scratch-`));
      const t0 = Date.now();
      await assert.rejects(() => buildShadow(scratch, infoFor(r.real)), e => e instanceof KitExit && e.code === 2 && e.message.includes(target), file);
      assert.ok(Date.now() - t0 < 5000, `${file}: refused quickly (${Date.now() - t0} ms)`);
      assert.ok(await diskUsage(scratch) < 1024 * 1024, `${file}: under 1 MiB written into the shadow, got ${await diskUsage(scratch)}`);
      assert.equal(await exists(path.join(scratch, 'git', file)), false, `${file}: no partial copy`);
      // end to end: refused before any git runs against a shadow
      const withDir = [];
      const git = (a, o) => { if (o.env?.GIT_DIR) withDir.push(a); return defaultGitRunner(a, o); };
      const t1 = Date.now();
      await assert.rejects(() => safeGit(r.dir, ['rev-parse', 'HEAD'], { git }), e => e instanceof KitExit && e.code === 2 && new RegExp(file).test(e.message));
      assert.ok(Date.now() - t1 < 5000, `${file}: safeGit refused quickly`);
      assert.deepEqual(withDir, [], `${file}: no git ran against the shadow`);
    }
  });

  it('per-file and total copy limits are enforced on real (non-sparse) files and can be raised through limits', async () => {
    const r = await plainRepo('limits');
    sh(r.dir, ['pack-refs', '--all']);
    const packed = path.join(r.real, '.git', 'packed-refs');
    await fs.appendFile(packed, `# ${'x'.repeat(2 * 1024 * 1024)}\n`);
    assert.deepEqual(DEFAULT_LIMITS, { index: 256 * 1024 * 1024, packedRefs: 64 * 1024 * 1024, file: 64 * 1024 * 1024, total: 512 * 1024 * 1024, entries: 100000 });
    await assert.rejects(() => safeGit(r.dir, ['rev-parse', 'HEAD'], { limits: { packedRefs: 1024 * 1024 } }),
      e => e instanceof KitExit && e.code === 2 && e.message.includes(packed) && /limit/.test(e.message));
    await assert.rejects(() => safeGit(r.dir, ['rev-parse', 'HEAD'], { limits: { total: 1024 * 1024 } }),
      e => e instanceof KitExit && e.code === 2 && /total copy limit/.test(e.message));
    const head = sh(r.dir, ['rev-parse', 'HEAD']).stdout.trim();
    assert.equal((await safeGit(r.dir, ['rev-parse', 'HEAD'])).stdout.trim(), head, 'within the default limits it reads');
  });

  it('control: plain git follows a symlinked refs/ to an outside folder and lists a ref that lives there', async () => {
    const r = await plainRepo('refs-link-control');
    const outside = path.join(root, 'refs-link-control-outside');
    await fs.rename(path.join(r.real, '.git', 'refs'), outside);
    await fs.symlink(outside, path.join(r.real, '.git', 'refs'));
    const head = sh(r.dir, ['rev-parse', 'HEAD']).stdout.trim();
    await fs.writeFile(path.join(outside, 'heads', 'SECRET_from_outside'), `${head}\n`);
    assert.match(sh(r.dir, ['for-each-ref']).stdout, /SECRET_from_outside/);
  });

  it('a refs/ symlinked to an outside folder is refused (exit 2) and nothing from it reaches the shadow; a symlink below refs/ is skipped', async () => {
    const r = await plainRepo('refs-link');
    const head = sh(r.dir, ['rev-parse', 'HEAD']).stdout.trim();
    const outside = path.join(root, 'refs-link-outside');
    await fs.rename(path.join(r.real, '.git', 'refs'), outside);
    await fs.symlink(outside, path.join(r.real, '.git', 'refs'));
    await fs.writeFile(path.join(outside, 'heads', 'SECRET_from_outside'), `${head}\n`);
    const scratch = await fs.mkdtemp(path.join(root, 'refs-link-scratch-'));
    await assert.rejects(() => buildShadow(scratch, infoFor(r.real)), e => e instanceof KitExit && e.code === 2 && /symlink/.test(e.message));
    const copied = (await fs.readdir(scratch, { recursive: true })).map(String);
    assert.ok(!copied.some(f => f.includes('SECRET_from_outside')), `the outside file never appears in the shadow: ${copied}`);
    const withDir = [];
    const git = (a, o) => { if (o.env?.GIT_DIR) withDir.push(a); return defaultGitRunner(a, o); };
    await assert.rejects(() => safeGit(r.dir, ['for-each-ref'], { git }), e => e instanceof KitExit && e.code === 2 && /refs/.test(e.message) && /symlink/.test(e.message));
    assert.deepEqual(withDir, []);

    // a symlinked folder BELOW refs/ is skipped (not followed), the rest reads
    const r2 = await plainRepo('refs-sublink');
    const out2 = path.join(root, 'refs-sublink-outside');
    await fs.mkdir(out2);
    await fs.writeFile(path.join(out2, 'SECRET_from_outside'), `${head}\n`);
    await fs.symlink(out2, path.join(r2.real, '.git', 'refs', 'heads', 'linked'));
    const list = await safeGit(r2.dir, ['for-each-ref', '--format=%(refname)']);
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /refs\/heads\/(main|master)/);
    assert.doesNotMatch(list.stdout, /SECRET_from_outside/);
  });

  it("a linked worktree whose own refs/ is a symlink is refused (exit 2)", async () => {
    const main = await plainRepo('wt-refs-link');
    const wt = path.join(root, 'wt-refs-link-wt');
    assert.equal(sh(main.dir, ['worktree', 'add', '-q', '-b', 'side', wt]).status, 0);
    const wtGit = path.join(main.real, '.git', 'worktrees', path.basename(wt));
    const outside = path.join(root, 'wt-refs-link-outside');
    await fs.mkdir(path.join(outside, 'bisect'), { recursive: true });
    await fs.writeFile(path.join(outside, 'bisect', 'SECRET_from_outside'), `${sh(main.dir, ['rev-parse', 'HEAD']).stdout.trim()}\n`);
    await fs.rm(path.join(wtGit, 'refs'), { recursive: true, force: true });
    await fs.symlink(outside, path.join(wtGit, 'refs'));
    await assert.rejects(() => safeGit(wt, ['rev-parse', 'HEAD']), e => e instanceof KitExit && e.code === 2 && /worktree's refs/.test(e.message));
  });

  it('the number of entries walked under refs/ is capped (exit 2 past limits.entries)', async () => {
    const r = await plainRepo('refs-many');
    for (let i = 0; i < 12; i++) sh(r.dir, ['branch', `b${i}`]);
    await assert.rejects(() => safeGit(r.dir, ['rev-parse', 'HEAD'], { limits: { entries: 8 } }),
      e => e instanceof KitExit && e.code === 2 && /more than 8 entries/.test(e.message));
    assert.equal((await safeGit(r.dir, ['rev-parse', 'b11'])).code, 0, 'the default limit reads them');
  });

  it('a checkout with >20000 folders in a git-ignored node_modules reads fine; .gitattributes in it are not read, tracked/untracked ones elsewhere are', async () => {
    const r = await plainRepo('node-modules');
    await fs.writeFile(path.join(r.real, '.gitignore'), 'node_modules/\n');
    await fs.mkdir(path.join(r.real, 'src'));
    await fs.writeFile(path.join(r.real, 'src', '.gitattributes'), '*.js filter=tracked\n');
    sh(r.dir, ['add', '.gitignore', 'src/.gitattributes']);
    sh(r.dir, ['commit', '-q', '-m', 'ignore']);
    await fs.mkdir(path.join(r.real, 'lib'));
    await fs.writeFile(path.join(r.real, 'lib', '.gitattributes'), '*.c filter=untracked\n');
    const nm = path.join(r.real, 'node_modules');
    for (let i = 0; i < 210; i++) {
      await Promise.all(Array.from({ length: 101 }, (_, j) => fs.mkdir(path.join(nm, `p${i}`, `d${j}`), { recursive: true })));
    }
    // a name safe-git would refuse if it read this file: it must not be read (git never reads it for an ignored tree)
    await fs.writeFile(path.join(nm, 'p0', '.gitattributes'), '* filter=bad;name\n');
    const head = sh(r.dir, ['rev-parse', 'HEAD']).stdout.trim();
    const t0 = Date.now();
    const out = await safeGit(r.dir, ['rev-parse', 'HEAD']);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.stdout.trim(), head);
    assert.equal((await safeGit(r.dir, ['status', '--porcelain'])).stdout, '?? lib/\n');
    const args = await safeGitConfig(r.dir);
    assert.ok(args.includes('filter.tracked.clean='), 'a tracked nested .gitattributes is still read');
    assert.ok(args.includes('filter.untracked.clean='), 'an untracked, not ignored .gitattributes is still read');
    assert.ok(!args.some(a => a.includes('bad;name')));
    assert.ok(Date.now() - t0 < 30000, `three calls in ${Date.now() - t0} ms`);
  });

  it('a tracked .gitattributes deleted from the work tree is read from the index (as git does)', async () => {
    const r = await plainRepo('attr-index');
    await fs.writeFile(path.join(r.real, '.gitattributes'), '* filter=fromindex\n');
    sh(r.dir, ['add', '.gitattributes']);
    sh(r.dir, ['commit', '-q', '-m', 'attrs']);
    await fs.rm(path.join(r.real, '.gitattributes'));
    assert.ok((await safeGitConfig(r.dir)).includes('filter.fromindex.clean='));
  });

  it('every git child runs with HOME and XDG_CONFIG_HOME at an empty private folder, GIT_CONFIG_GLOBAL kept', async () => {
    const r = await plainRepo('home-env');
    const seen = [];
    const git = (a, o) => {
      seen.push({ a, home: o.env.HOME, xdg: o.env.XDG_CONFIG_HOME, global: o.env.GIT_CONFIG_GLOBAL,
        homeIsDir: fsSync.statSync(o.env.HOME).isDirectory(), homeEntries: fsSync.readdirSync(o.env.HOME),
        homeMode: fsSync.statSync(o.env.HOME).mode & 0o777 });
      return defaultGitRunner(a, o);
    };
    const realHome = path.join(root, 'home-env-realhome');
    await fs.mkdir(realHome);
    await fs.writeFile(path.join(r.real, 'new.txt'), 'n\n');
    const out = await safeGit(r.dir, ['status', '--porcelain'], { git, env: { ...CLEAN_ENV, HOME: realHome, XDG_CONFIG_HOME: path.join(realHome, '.config') } });
    assert.equal(out.code, 0, out.stderr);
    assert.ok(seen.length >= 3, 'config read, ls-files and status all went through the runner');
    for (const s of seen) {
      assert.notEqual(s.home, realHome, s.a.join(' '));
      assert.equal(s.xdg, s.home, s.a.join(' '));
      assert.equal(s.global, '/dev/null');
      assert.ok(s.homeIsDir);
      assert.deepEqual(s.homeEntries, [], `${s.a.join(' ')}: HOME is empty`);
      assert.equal(s.homeMode, 0o700);
    }
    assert.equal(await exists(seen[0].home), false, 'the private HOME is removed with the shadow');
    const env = safeGitEnv({ HOME: '/h', XDG_CONFIG_HOME: '/x' }, { home: '/empty' });
    assert.equal(env.HOME, '/empty');
    assert.equal(env.XDG_CONFIG_HOME, '/empty');
    assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  });

  it('the caller\'s $XDG_CONFIG_HOME/git/ignore is not read (what git < 2.32 would read through HOME despite GIT_CONFIG_GLOBAL)', async () => {
    const r = await plainRepo('home-ignore');
    const home = path.join(root, 'home-ignore-home');
    await fs.mkdir(path.join(home, '.config', 'git'), { recursive: true });
    await fs.writeFile(path.join(home, '.config', 'git', 'ignore'), '*.txt\n');
    await fs.writeFile(path.join(r.real, 'new.txt'), 'n\n');
    const env = { ...CLEAN_ENV, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
    assert.equal(sh(r.dir, ['status', '--porcelain'], env).stdout, '', 'control: plain git with that HOME hides new.txt');
    assert.equal((await safeGit(r.dir, ['status', '--porcelain'], { env })).stdout, '?? new.txt\n');
  });

  it('core.fsmonitor override is empty (not "false", a program name on git 2.16-2.35) and git accepts it', async () => {
    const r = await plainRepo('fsmonitor-empty');
    const args = await safeGitConfig(r.dir);
    const fsm = args.filter((a, i) => args[i - 1] === '-c' && /^core\.fsmonitor=/i.test(a));
    assert.deepEqual(fsm, ['core.fsmonitor=']);
    await fs.writeFile(path.join(r.real, 'f.txt'), 'two\n');
    const st = await safeGit(r.dir, ['status', '--porcelain']);
    assert.equal(st.code, 0, st.stderr);
    assert.equal(st.stdout, ' M f.txt\n');
  });
});

describe('safe-git — review round 4 regressions (git found by absolute path, unsafe index paths, no config includes)', () => {
  let root;
  before(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'safe-git-r4-'))); });
  after(async () => { await fs.rm(root, { recursive: true, force: true }); });

  async function plainRepo(name) {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    assert.equal(sh(dir, ['init', '-q', '.']).status, 0);
    await fs.writeFile(path.join(dir, 'f.txt'), 'one\n');
    sh(dir, ['add', 'f.txt']);
    sh(dir, ['commit', '-q', '-m', 'init']);
    return { dir, head: sh(dir, ['rev-parse', 'HEAD']).stdout.trim() };
  }

  /** A repo with an executable git at its root, in ./rel/ and ./bin/ that leaves a marker and then runs the real git. */
  async function plantedGitRepo(name) {
    const r = await plainRepo(name);
    const realGit = resolveGit(CLEAN_ENV);
    const marker = path.join(root, `${name}-PWN`);
    const fake = `#!/bin/sh\ntouch '${marker}'\nexec '${realGit}' "$@"\n`;
    await fs.writeFile(path.join(r.dir, 'git'), fake, { mode: 0o755 });
    for (const d of ['rel', 'bin']) {
      await fs.mkdir(path.join(r.dir, d));
      await fs.writeFile(path.join(r.dir, d, 'git'), fake, { mode: 0o755 });
    }
    return { ...r, marker };
  }

  it('control (POSIX): with an empty PATH entry, a bare "git" spawned in the repository runs the repository\'s ./git', async (t) => {
    if (process.platform === 'win32') return t.skip('POSIX PATH semantics');
    const r = await plantedGitRepo('control-path');
    const out = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: r.dir, encoding: 'utf-8', env: { ...CLEAN_ENV, PATH: `:${CLEAN_ENV.PATH}` } });
    assert.equal(out.stdout.trim(), r.head);
    assert.equal(await exists(r.marker), true, 'control: the planted git ran');
  });

  it('PATH with an empty, "." and relative entry + an executable ./git in the repo: safeGit, run() and bbs headOf never run it', async (t) => {
    if (process.platform === 'win32') return t.skip('POSIX PATH semantics');
    const r = await plantedGitRepo('planted');
    await fs.writeFile(path.join(r.dir, 'f.txt'), 'two\n');
    for (const PATH of [`:${CLEAN_ENV.PATH}`, `.:${CLEAN_ENV.PATH}`, `rel:bin:${CLEAN_ENV.PATH}`, `${CLEAN_ENV.PATH}:`]) {
      const env = { ...CLEAN_ENV, PATH };
      assert.equal((await safeGit(r.dir, ['rev-parse', 'HEAD'], { env })).stdout.trim(), r.head, PATH);
      assert.match((await safeGit(r.dir, ['diff'], { env })).stdout, /\+two/);
      assert.match((await safeGit(r.dir, ['status', '--porcelain'], { env })).stdout, /^ M f\.txt$/m);
      assert.equal((await safeGit(r.dir, ['describe', '--always', '--dirty'], { env })).stdout.trim(), `${r.head.slice(0, 7)}-dirty`);
      assert.equal((await run(['--dir', r.dir, '--', 'rev-parse', 'HEAD'], { cwd: r.dir, env })).stdout.trim(), r.head);
      await safeGitConfig(r.dir, { env });
    }
    const { headOf } = await import('../src/lib/bbs/fetch.js');
    assert.equal(await headOf(r.dir, { ...CLEAN_ENV, PATH: `:${CLEAN_ENV.PATH}` }, { hardened: true }), r.head);
    assert.equal(await exists(r.marker), false, 'the repository\'s git never ran');
  });

  it('every git child runs with cwd = the private scratch folder (never the repository) and an absolute git; PATH keeps absolute entries only', async () => {
    const r = await plainRepo('cwd');
    const seen = [];
    const git = (a, o) => { seen.push(o); return defaultGitRunner(a, o); };
    await safeGit(r.dir, ['status', '--porcelain'], { git, env: { ...CLEAN_ENV, PATH: `:.:rel:${CLEAN_ENV.PATH}` } });
    assert.ok(seen.length >= 3);
    for (const o of seen) {
      assert.ok(!(o.cwd === r.dir || o.cwd.startsWith(r.dir + path.sep)), `cwd ${o.cwd} is outside the repository`);
      assert.match(path.basename(o.cwd), /^safe-git-shadow-/);
      assert.equal(o.env.PATH, CLEAN_ENV.PATH, 'empty and relative PATH entries are removed for git\'s own children');
    }
    assert.ok(path.isAbsolute(resolveGit(CLEAN_ENV)));
    assert.deepEqual(absolutePathEntries(':.:rel:/usr/bin::/bin:', { delimiter: ':', isAbsolute: path.posix.isAbsolute }), ['/usr/bin', '/bin']);
    assert.throws(() => resolveGit({ PATH: `:.:rel` }), e => e instanceof KitExit && e.code === 1 && /cannot run git/.test(e.message));
  });

  it('rev-parse position queries answer as from the top of the work tree; mixed with other arguments they are refused', async () => {
    const r = await plainRepo('position');
    await fs.mkdir(path.join(r.dir, 'deep'));
    assert.equal((await safeGit(r.dir, ['rev-parse', '--is-inside-work-tree', '--is-inside-git-dir', '--show-prefix', '--show-cdup'])).stdout, 'true\nfalse\n\n\n');
    await assert.rejects(() => safeGit(path.join(r.dir, 'deep'), ['rev-parse', '--is-inside-work-tree']),
      e => e instanceof KitExit && e.code === 1 && /pass the repository top/.test(e.message), 'a subfolder --dir is refused (review round 5)');
    assert.equal((await safeGit(path.join(r.dir, '.git'), ['rev-parse', '--is-inside-git-dir', '--is-inside-work-tree'])).stdout, 'true\nfalse\n');
    await assert.rejects(() => safeGit(r.dir, ['rev-parse', '--show-prefix', 'HEAD']), e => e instanceof KitExit && e.code === 2);
  });

  /** Rename one index entry in place (same length) and rewrite the SHA-1 trailer. */
  async function patchIndexEntry(dir, from, to) {
    assert.equal(Buffer.byteLength(from), Buffer.byteLength(to));
    const file = path.join(dir, '.git', 'index');
    const buf = await fs.readFile(file);
    const at = buf.indexOf(Buffer.from(`${from}\0`));
    assert.ok(at > 0, `entry ${from} found in the index`);
    Buffer.from(to).copy(buf, at);
    const body = buf.subarray(0, buf.length - 20);
    crypto.createHash('sha1').update(body).digest().copy(buf, buf.length - 20);
    await fs.writeFile(file, buf);
  }

  it('control: plain git diff/status follow an index entry patched to ../outside/sec and print the secret', async () => {
    const r = await plainRepo('dotdot-control');
    await fs.mkdir(path.join(r.dir, 'zzzzzzzzzz'));
    await fs.writeFile(path.join(r.dir, 'zzzzzzzzzz', 'sec'), 'x\n');
    sh(r.dir, ['add', 'zzzzzzzzzz/sec']);
    await fs.mkdir(path.join(root, 'outside'), { recursive: true });
    await fs.writeFile(path.join(root, 'outside', 'sec'), 'TOP SECRET KEY\n');
    await patchIndexEntry(r.dir, 'zzzzzzzzzz/sec', '../outside/sec');
    assert.match(sh(r.dir, ['diff']).stdout, /TOP SECRET KEY/, 'control: plain git prints the outside file');
  });

  it('an index entry patched to ../outside/sec is refused (exit 2) before any command runs; the secret is never printed', async () => {
    const r = await plainRepo('dotdot');
    await fs.mkdir(path.join(r.dir, 'zzzzzzzzzz'));
    await fs.writeFile(path.join(r.dir, 'zzzzzzzzzz', 'sec'), 'x\n');
    sh(r.dir, ['add', 'zzzzzzzzzz/sec']);
    await fs.mkdir(path.join(root, 'outside'), { recursive: true });
    await fs.writeFile(path.join(root, 'outside', 'sec'), 'TOP SECRET KEY\n');
    await patchIndexEntry(r.dir, 'zzzzzzzzzz/sec', '../outside/sec');
    const calls = [];
    const git = (a, o) => { calls.push(a); return defaultGitRunner(a, o); };
    for (const c of [['diff'], ['status', '--porcelain'], ['diff-files', '-p'], ['ls-files'], ['rev-parse', 'HEAD']]) {
      await assert.rejects(() => safeGit(r.dir, c, { git }), e => e instanceof KitExit && e.code === 2 && /\.\.\/outside\/sec/.test(e.message) && !/TOP SECRET/.test(e.message), c.join(' '));
    }
    await assert.rejects(() => run(['--dir', r.dir, '--', 'diff'], { cwd: root, env: CLEAN_ENV }), e => e instanceof KitExit && e.code === 2);
    const userCommands = calls.filter(a => a.some(x => ['diff', 'status', 'diff-files', 'rev-parse'].includes(x)) || (a.includes('ls-files') && !a.includes('--stage') && !a.includes('--others')));
    assert.deepEqual(userCommands, [], 'only the index listing ran; no work-tree command');
  });

  it('unsafeIndexPath refuses absolute paths, ., .., empty and git-dir alias components (any case, trailing dots/spaces, NTFS/HFS forms); keeps ordinary names', () => {
    const bad = ['../x', 'a/../x', 'a/..', '/etc/passwd', '\\x', 'C:/x', 'c:x', 'a//b', './x', 'a/./b', 'a/', '.git/config', 'sub/.GIT/config',
      '.Git', '.git./x', '.git /x', '.git . /x', 'GIT~1/config', 'a/git~2', '.g\u200cit/config', '.git\ufeff/x', '.git::$INDEX_ALLOCATION/x',
      'a\\..\\b', 'a\\.git\\config', ''];
    for (const p of bad) assert.ok(unsafeIndexPath(p), JSON.stringify(p));
    const good = ['f.txt', 'a/b/c', '.gitignore', '.gitattributes', '.gitmodules', 'x.git', '..a', 'a..', '.github/workflows/ci.yml', 'git~x', 'gitx'];
    for (const p of good) assert.equal(unsafeIndexPath(p), null, JSON.stringify(p));
    assert.equal(unsafeIndexPath('dir/', { dir: true }), null, 'a sparse-index directory entry');
  });

  it('include.path naming a FIFO: the call returns promptly and the FIFO is never opened (its writer stays blocked)', async (t) => {
    if (process.platform === 'win32') return t.skip('needs mkfifo');
    const r = await plainRepo('fifo');
    const fifo = path.join(root, 'fifo-pipe');
    const mk = spawnSync('mkfifo', [fifo]);
    if (mk.status !== 0) return t.skip('mkfifo unavailable');
    const opened = path.join(root, 'fifo-OPENED');
    // the writer blocks in open() until something opens the FIFO for reading, then leaves a marker
    const writer = spawn('sh', ['-c', `echo '[filter "x"]' > '${fifo}'; touch '${opened}'`], { stdio: 'ignore' });
    try {
      await fs.appendFile(path.join(r.dir, '.git', 'config'), `[include]\n\tpath = ${fifo}\n[includeIf "gitdir:/"]\n\tpath = ${fifo}\n`);
      const t0 = Date.now();
      const out = await safeGit(r.dir, ['rev-parse', 'HEAD'], { timeout: 5000 });
      assert.equal(out.stdout.trim(), r.head);
      await safeGitConfig(r.dir, { timeout: 5000 });
      assert.ok(Date.now() - t0 < 5000, `returned promptly (${Date.now() - t0} ms)`);
      await new Promise(res => setTimeout(res, 200));
      assert.equal(await exists(opened), false, 'the FIFO was never opened');
      assert.equal(writer.exitCode, null, 'the writer is still blocked');
    } finally {
      writer.kill('SIGKILL');
      await new Promise(res => (writer.exitCode !== null || writer.signalCode ? res() : writer.once('exit', res)));
    }
  });
});

describe('safe-git — review round 5 regressions (bbs fallback outside the clone, subfolder --dir, CLI messages and exit, implicit no-index)', () => {
  let root;
  before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-git-r5-')); });
  after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'lib', 'kit', 'cli.js');
  const cli = (args) => spawnSync(process.execPath, [CLI, 'safe-git', ...args], { cwd: root, encoding: 'utf-8', env: CLEAN_ENV });

  async function repo(name) {
    const dir = path.join(root, name);
    await fs.mkdir(path.join(dir, 'sub'), { recursive: true });
    sh(dir, ['init', '-q', '.']);
    await fs.writeFile(path.join(dir, 'sub', 'f'), 'one\n');
    await fs.writeFile(path.join(dir, 'a.txt'), 'a\n');
    sh(dir, ['add', '.']);
    sh(dir, ['commit', '-q', '-m', 'init']);
    return { dir, head: sh(dir, ['rev-parse', 'HEAD']).stdout.trim() };
  }

  it('bbs headOf, with and without the kit: a committed executable ./git in the clone and an empty PATH entry never run it', async (t) => {
    if (process.platform === 'win32') return t.skip('POSIX PATH semantics');
    const dir = path.join(root, 'clone-with-git');
    await fs.mkdir(dir);
    sh(dir, ['init', '-q', '.']);
    const marker = path.join(root, 'repo-git-ran');
    await fs.writeFile(path.join(dir, 'git'), `#!/bin/sh\ntouch '${marker}'\nexec '${resolveGit(CLEAN_ENV)}' "$@"\n`, { mode: 0o755 });
    sh(dir, ['add', 'git']);
    sh(dir, ['commit', '-q', '-m', 'ship a git']);
    assert.equal(sh(dir, ['ls-files', '-s', 'git']).stdout.slice(0, 6), '100755', 'the planted git is committed executable');
    const head = sh(dir, ['rev-parse', 'HEAD']).stdout.trim();
    const PATH = `:${CLEAN_ENV.PATH}`;
    // control: a bare git spawned with cwd in the clone runs the planted one
    spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8', env: { ...CLEAN_ENV, PATH } });
    assert.equal(await exists(marker), true, 'control: the planted git ran');
    await fs.rm(marker);
    const { headOf } = await import('../src/lib/bbs/fetch.js');
    const env = { ...CLEAN_ENV, PATH, GIT_CONFIG_NOSYSTEM: '1' };
    assert.equal(await headOf(dir, env, { load: async () => null }), head, 'kit missing');
    assert.equal(await exists(marker), false, 'kit missing: the clone\'s git never ran');
    assert.equal(await headOf(dir, env, {}), head, 'kit present');
    assert.equal(await exists(marker), false, 'kit present: the clone\'s git never ran');
  });

  it('bbs resolveGitPath searches absolute PATH entries only and runGit spawns that absolute path with an absolute-only PATH', async () => {
    const { resolveGitPath, runGit, absolutePathEntries: abs } = await import('../src/lib/bbs/fetch.js');
    assert.ok(path.isAbsolute(resolveGitPath(CLEAN_ENV)));
    assert.throws(() => resolveGitPath({ PATH: ':.:rel' }), /cannot run git/);
    assert.deepEqual(abs(':.:rel:/usr/bin::/bin:', { delimiter: ':', isAbsolute: path.posix.isAbsolute }), ['/usr/bin', '/bin']);
    const seen = [];
    runGit(['--version'], root, { ...CLEAN_ENV, PATH: `:.:${CLEAN_ENV.PATH}` }, { exec: (cmd, a, o) => { seen.push({ cmd, o }); return ''; } });
    assert.ok(path.isAbsolute(seen[0].cmd));
    assert.equal(seen[0].o.env.PATH, CLEAN_ENV.PATH);
  });

  it('a subfolder --dir is refused (exit 1) with "pass the repository top"; from the top, top-relative pathspecs find the history', async () => {
    const r = await repo('sub-dir');
    await assert.rejects(() => run(['--dir', path.join(r.dir, 'sub'), '--', 'log', '--oneline', '--', 'f'], { cwd: root, env: CLEAN_ENV }),
      e => e instanceof KitExit && e.code === 1 && /pass the repository top; paths are relative to it/.test(e.message));
    const out = await run(['--dir', r.dir, '--', 'log', '--format=%H', '--', 'sub/f'], { cwd: root, env: CLEAN_ENV });
    assert.equal(out.stdout.trim(), r.head);
    assert.match(usage, /--dir must be the top of the work tree or the git dir/);
    const c = cli(['--dir', path.join(r.dir, 'sub'), '--', 'ls-files']);
    assert.equal(c.status, 1);
    assert.match(c.stderr, /pass the repository top; paths are relative to it/);
  });

  it('CLI: a missing "--" says so, --help prints the usage with exit 0, refusals say "refused" once', async () => {
    const r = await repo('cli-msg');
    await assert.rejects(() => run(['--dir', r.dir, 'log'], { cwd: root, env: CLEAN_ENV }),
      e => e instanceof KitExit && e.code === 1 && /expected `--` before the git arguments/.test(e.message) && !/unknown flag/.test(e.message));
    assert.deepEqual(await run(['--help'], { cwd: root, env: CLEAN_ENV }), { usage });
    assert.deepEqual(await run(['-h'], { cwd: root, env: CLEAN_ENV }), { usage });
    const h = cli(['--help']);
    assert.equal(h.status, 0);
    assert.equal(JSON.parse(h.stdout).usage, usage);
    for (const a of [['log', '--ext-diff'], ['rev-parse', '--git-dir'], ['rev-parse', '--show-prefix', 'HEAD']]) {
      const c = cli(['--dir', r.dir, '--', ...a]);
      assert.equal(c.status, 2, a.join(' '));
      assert.match(c.stderr, /^kit: refused: /, a.join(' '));
      assert.equal(c.stderr.match(/refused/g).length, 1, `${a.join(' ')}: ${c.stderr}`);
    }
  });

  it('CLI exit status: 0 when git succeeds, 3 when git ran and failed (JSON still printed with git\'s code), 1 bad input, 2 refusal', async () => {
    const r = await repo('cli-exit');
    const ok = await run(['--dir', r.dir, '--', 'rev-parse', 'HEAD'], { cwd: root, env: CLEAN_ENV });
    assert.equal(ok.exit, 0);
    const bad = await run(['--dir', r.dir, '--', 'log', 'nosuchref'], { cwd: root, env: CLEAN_ENV });
    assert.equal(bad.code, 128);
    assert.equal(bad.exit, 3);
    const c = cli(['--dir', r.dir, '--', 'log', 'nosuchref']);
    assert.equal(c.status, 3);
    assert.equal(JSON.parse(c.stdout).code, 128);
    assert.match(JSON.parse(c.stdout).stderr, /nosuchref/);
    assert.equal(cli(['--dir', r.dir, '--', 'rev-parse', 'HEAD']).status, 0);
    assert.equal(cli(['--bogus', '--', 'status']).status, 1);
    assert.equal(cli(['--dir', r.dir, '--', 'fetch']).status, 2);
  });

  it('diffing commands refuse absolute and ..-escaping paths (git diff would go --no-index on its own); inside paths and revision ranges still work', async () => {
    const r = await repo('no-index');
    const o1 = path.join(root, 'outside-1');
    const o2 = path.join(root, 'outside-2');
    await fs.writeFile(o1, 'secret one\n');
    await fs.writeFile(o2, 'secret two\n');
    // control: plain git really does diff two outside files from inside the repository
    assert.match(sh(r.dir, ['diff', o1, o2]).stdout, /secret/);
    const rel1 = path.relative(r.dir, o1);
    for (const a of [['diff', o1, o2], ['diff', rel1, path.relative(r.dir, o2)], ['diff', '--', o1, o2], ['diff', 'HEAD', '--', '../x'],
      ['diff', '--stat', 'sub/../../x'], ['log', '-p', '--', '/etc/passwd'], ['show', 'HEAD', '--', '..'], ['diff-files', '--', 'C:/x'], ['diff', '\\\\host\\share\\x']]) {
      await assert.rejects(() => safeGit(r.dir, a), e => e instanceof KitExit && e.code === 2 && /absolute or leaves the work tree/.test(e.message), a.join(' '));
      assert.throws(() => checkReadArgs(a), e => e instanceof KitExit && e.code === 2, a.join(' '));
    }
    await fs.writeFile(path.join(r.dir, 'a.txt'), 'changed\n');
    assert.match((await safeGit(r.dir, ['diff', '--', 'sub/../a.txt'])).stdout, /\+changed/, 'a .. that stays inside is allowed');
    assert.match((await safeGit(r.dir, ['diff', '--', 'a.txt'])).stdout, /\+changed/);
    assert.equal((await safeGit(r.dir, ['diff', 'HEAD..HEAD'])).code, 0);
    assert.equal((await safeGit(r.dir, ['log', '--oneline', 'HEAD~0', '--', 'sub/f'])).code, 0);
    assert.equal(escapingPath('a/../b'), false);
    assert.equal(escapingPath('a/../../b'), true);
    assert.equal(escapingPath('HEAD...main'), false);
    assert.match(fsSync.readFileSync(new URL('../src/lib/kit/safe-git.js', import.meta.url), 'utf-8'), /switches to no-index ON ITS OWN/);
  });
});
