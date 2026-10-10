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
