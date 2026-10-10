import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { verb, usage, run, decide, defaultGit, changeId, writeAtomic } from '../src/lib/kit/push-gate.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { oldGitSpawn } from './helpers/old-git.js';

const sh = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf-8' });
let root, repo, store;
const io = (extra = {}) => ({ cwd: repo, stdin: async () => '', env: { ...process.env, KIT_RECEIPTS_DIR: store }, ...extra });
const receiptArgs = (extra = []) => ['receipt', '--verdict', 'pass', '--high', '0', '--medium', '0', '--low', '1', ...extra];

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-'));
  repo = path.join(root, 'repo');
  store = path.join(root, 'store');
  await fs.mkdir(repo);
  sh(repo, 'init', '-q', '.');
  await fs.writeFile(path.join(repo, 'a.txt'), 'one\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'one');
});
after(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('push-gate — module shape', () => {
  it('exports verb, usage, run', () => {
    assert.equal(verb, 'push-gate');
    assert.match(usage, /receipt/);
    assert.match(usage, /check/);
    assert.equal(typeof run, 'function');
  });
  it('rejects bad input with KitExit 1', async () => {
    await assert.rejects(run([], io()), e => e instanceof KitExit && e.code === 1);
    await assert.rejects(run(['receipt', '--verdict', 'maybe'], io()), e => e instanceof KitExit && e.code === 1);
    await assert.rejects(run(receiptArgs(['--threshold', 'huge']), io()), e => e instanceof KitExit && e.code === 1);
    await assert.rejects(run(['receipt', '--verdict', 'pass', '--high', '-1'], io()), e => e instanceof KitExit && e.code === 1);
  });
});

describe('push-gate — change id', () => {
  it('is stable, changes with a new commit, and the reviewed working state differs when the tree is dirty', async () => {
    const git = defaultGit(repo);
    const a = await changeId(git, {});
    assert.equal(a.id, (await changeId(git, {})).id);
    assert.equal(a.dirty, false);
    await fs.writeFile(path.join(repo, 'a.txt'), 'one\ntwo\n');
    const dirty = await changeId(git, { working: true });
    assert.equal(dirty.dirty, true);
    assert.notEqual(dirty.id, a.id);
    await fs.writeFile(path.join(repo, 'a.txt'), 'one\nthree\n');
    assert.notEqual((await changeId(git, { working: true })).id, dirty.id);
    sh(repo, 'commit', '-qam', 'two');
    const b = await changeId(git, {});
    assert.equal(b.dirty, false);
    assert.notEqual(b.id, a.id);
  });
  it('the push-time id ignores uncommitted edits and untracked files', async () => {
    const git = defaultGit(repo);
    const clean = await changeId(git, {});
    await fs.writeFile(path.join(repo, 'a.txt'), 'edited\n');
    await fs.writeFile(path.join(repo, 'untracked.txt'), 'u\n');
    assert.equal((await changeId(git, {})).id, clean.id);
    assert.equal((await changeId(git, { working: true })).tree, (await changeId(git, { working: true })).tree);
    await fs.rm(path.join(repo, 'untracked.txt'));
    sh(repo, 'checkout', '--', 'a.txt');
  });
  it('the working-state id leaves the real index and working files alone', async () => {
    const git = defaultGit(repo);
    await fs.writeFile(path.join(repo, 'a.txt'), 'staged\n');
    sh(repo, 'add', 'a.txt');
    await fs.writeFile(path.join(repo, 'a.txt'), 'staged\nunstaged\n');
    const before = sh(repo, 'status', '--porcelain').stdout;
    const w = await changeId(git, { working: true });
    assert.equal(sh(repo, 'status', '--porcelain').stdout, before);
    assert.equal(sh(repo, 'diff', '--cached', '--name-only').stdout.trim(), 'a.txt');
    assert.equal(sh(repo, 'show', ':a.txt').stdout, 'staged\n');
    assert.equal(w.dirty, true);
    sh(repo, 'commit', '-qam', 'tmp');
    assert.equal(w.tree, sh(repo, 'rev-parse', 'HEAD^{tree}').stdout.trim());
    sh(repo, 'reset', '-q', '--hard', 'HEAD~1');
  });
  it('uses --base when given and falls back to no base (root) without an upstream', async () => {
    const git = defaultGit(repo);
    const root0 = await changeId(git, {});
    assert.equal(root0.base, null);
    const first = sh(repo, 'rev-list', '--max-parents=0', 'HEAD').stdout.trim();
    const withBase = await changeId(git, { base: first });
    assert.equal(withBase.base, first);
    assert.notEqual(withBase.id, root0.id);
    await assert.rejects(changeId(git, { base: 'no-such-ref' }), e => e instanceof KitExit && e.code === 1);
  });
  it('git runs with a scrubbed env and hooks off', async () => {
    const calls = [];
    const fake = async (args, opts) => { calls.push({ args, opts }); return { code: 0, stdout: args.includes('--porcelain') ? '' : 'abc\n', stderr: '' }; };
    const git = defaultGit(repo, { runner: fake });
    await git(['rev-parse', 'HEAD']);
    assert.ok(calls[0].args.join(' ').includes('core.hooksPath'));
    const spawned = [];
    const git2 = defaultGit(repo, { spawn: (cmd, args, opts) => { spawned.push(opts); return { status: 0, stdout: '', stderr: '' }; }, env: { PATH: '/bin', GIT_DIR: '/evil', GIT_INDEX_FILE: 'x', HOME: '/h' } });
    await git2(['status']);
    assert.equal(spawned[0].env.GIT_DIR, undefined);
    assert.equal(spawned[0].env.GIT_INDEX_FILE, undefined);
    assert.equal(spawned[0].env.PATH, '/bin');
  });
});

describe('push-gate — receipts and check', () => {
  it('check with no receipt asks (no threshold) and denies (threshold set), exit 2 on deny', async () => {
    const ask = await run(['check'], io());
    assert.equal(ask.decision, 'ask');
    assert.ok(ask.change_id);
    assert.ok(!ask.exit);
    const deny = await run(['check', '--threshold', 'high'], io());
    assert.equal(deny.decision, 'deny');
    assert.equal(deny.exit, 2);
  });
  it('a passing receipt for this change abstains; store is outside the repo and written atomically', async () => {
    const r = await run(receiptArgs(), io());
    assert.equal(r.receipt.verdict, 'pass');
    assert.deepEqual(r.receipt.counts, { high: 0, medium: 0, low: 1 });
    assert.equal(r.receipt.threshold, 'none');
    const files = await fs.readdir(store);
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9a-f]{64}\.json$/);
    const inRepo = sh(repo, 'status', '--porcelain').stdout;
    assert.equal(inRepo, '');
    const c = await run(['check'], io());
    assert.equal(c.decision, 'abstain');
    assert.equal(c.receipt.change_id, c.change_id);
  });
  it('a change after the review is reported as earlier and treated as missing', async () => {
    await fs.writeFile(path.join(repo, 'b.txt'), 'new\n');
    sh(repo, 'add', 'b.txt');
    sh(repo, 'commit', '-qm', 'b');
    const c = await run(['check'], io());
    assert.equal(c.decision, 'ask');
    assert.match(c.reason, /earlier/i);
    const d = await run(['check', '--threshold', 'none'], io());
    assert.equal(d.decision, 'ask');
    sh(repo, 'reset', '-q', '--hard', 'HEAD~1');
    assert.equal((await run(['check'], io())).decision, 'abstain');
  });
  it('a receipt judged under another threshold does not count', async () => {
    const c = await run(['check', '--threshold', 'medium'], io());
    assert.equal(c.decision, 'deny');
    assert.match(c.reason, /threshold/i);
  });
  it('fail verdict or findings at/above the threshold block; below the threshold passes', async () => {
    await run(['receipt', '--verdict', 'pass', '--high', '0', '--medium', '2', '--low', '0', '--threshold', 'medium'], io());
    assert.equal((await run(['check', '--threshold', 'medium'], io())).decision, 'deny');
    await run(['receipt', '--verdict', 'pass', '--high', '0', '--medium', '2', '--low', '0', '--threshold', 'high'], io());
    assert.equal((await run(['check', '--threshold', 'high'], io())).decision, 'abstain');
    await run(['receipt', '--verdict', 'fail', '--high', '0', '--medium', '0', '--low', '0', '--threshold', 'high'], io());
    assert.equal((await run(['check', '--threshold', 'high'], io())).decision, 'deny');
    await run(['receipt', '--verdict', 'fail', '--high', '0', '--medium', '0', '--low', '0'], io());
    assert.equal((await run(['check'], io())).decision, 'ask');
  });
  it('an incomplete review never blocks, even with a threshold', async () => {
    await run(receiptArgs(['--incomplete', '--threshold', 'high']), io());
    const c = await run(['check', '--threshold', 'high'], io());
    assert.equal(c.decision, 'abstain');
    assert.match(c.reason, /incomplete/i);
  });
  it('an incomplete review still blocks on a fail verdict or findings at the threshold', async () => {
    await run(['receipt', '--verdict', 'fail', '--high', '3', '--threshold', 'high', '--incomplete'], io());
    const c = await run(['check', '--threshold', 'high'], io());
    assert.equal(c.decision, 'deny');
    assert.equal(c.exit, 2);
    await run(['receipt', '--verdict', 'pass', '--high', '2', '--threshold', 'high', '--incomplete'], io());
    assert.equal((await run(['check', '--threshold', 'high'], io())).decision, 'deny');
    await run(['receipt', '--verdict', 'fail', '--incomplete'], io());
    assert.equal((await run(['check'], io())).decision, 'ask');
    assert.match((await run(['check'], io())).reason, /did not pass/);
    await run(receiptArgs(['--incomplete', '--threshold', 'high']), io());
    assert.equal((await run(['check', '--threshold', 'high'], io())).decision, 'abstain');
  });
  it('a receipt and a check on the same threshold, as the /w-review closing step records, pass cleanly', async () => {
    for (const th of ['high', 'medium', 'low']) {
      await run(['receipt', '--verdict', 'pass', '--high', '0', '--medium', '0', '--low', '0', '--threshold', th], io());
      assert.equal((await run(['check', '--threshold', th], io())).decision, 'abstain');
    }
  });
  it('unknown flags are KitExit 1 for each subcommand', async () => {
    for (const args of [['check', '--treshold', 'high'], ['check', '--verdict', 'pass'], ['receipt', '--verdict', 'pass', '--hgh', '1'], ['receipt', '--verdict', 'pass', '--bogus']]) {
      await assert.rejects(run(args, io()), e => e instanceof KitExit && e.code === 1 && /unknown flag/.test(e.message), args.join(' '));
    }
    assert.equal((await run(['check', '--base', 'HEAD'], io())).change_id.length, 64);
  });
  it('keeps the previous change ids: deduplicated, excluding the latest, capped at 50', async () => {
    const hist = path.join(root, 'hist');
    await fs.mkdir(hist);
    sh(hist, 'init', '-q', '.');
    await fs.writeFile(path.join(hist, 'f'), '0');
    sh(hist, 'add', '-A');
    sh(hist, 'commit', '-q', '-m', 'c0');
    const ids = [];
    const stateOf = async () => {
      const files = await fs.readdir(store);
      for (const name of files) {
        const st = JSON.parse(await fs.readFile(path.join(store, name), 'utf-8'));
        if (await fs.realpath(st.repo) === await fs.realpath(path.join(hist, '.git'))) return st;
      }
      throw new Error('no state');
    };
    const h = io({ cwd: hist });
    ids.push((await run(receiptArgs(), h)).change_id);
    await run(receiptArgs(), h);
    let st = await stateOf();
    assert.deepEqual(st.previous, []);
    await fs.writeFile(path.join(hist, 'f'), '1');
    sh(hist, 'commit', '-qam', 'c1');
    ids.push((await run(receiptArgs(), h)).change_id);
    st = await stateOf();
    assert.deepEqual(st.previous, [ids[0]]);
    assert.equal(st.latest.change_id, ids[1]);
    assert.ok(!st.previous.includes(st.latest.change_id));
    for (let i = 2; i < 60; i++) {
      await fs.writeFile(path.join(hist, 'f'), String(i));
      sh(hist, 'commit', '-qam', `c${i}`);
      ids.push((await run(receiptArgs(), h)).change_id);
    }
    st = await stateOf();
    assert.equal(st.previous.length, 50);
    assert.equal(st.previous.at(-1), ids[58]);
    assert.ok(!st.previous.includes(ids[0]));
    assert.ok(!st.previous.includes(ids[59]));
    assert.equal(new Set(st.previous).size, 50);
    const old = await run(['check'], io({ cwd: hist }));
    assert.equal(old.change_id, ids[59]);
    assert.equal(old.decision, 'abstain');
    await fs.rm(path.join(store, `${crypto.createHash('sha256').update(await fs.realpath(path.join(hist, '.git'))).digest('hex')}.json`));
    await fs.rm(hist, { recursive: true, force: true });
  });
  it('different repositories get different store files', async () => {
    const other = path.join(root, 'other');
    await fs.mkdir(other);
    sh(other, 'init', '-q', '.');
    sh(other, 'commit', '-q', '--allow-empty', '-m', 'x');
    await run(receiptArgs(), io({ cwd: other }));
    assert.equal((await fs.readdir(store)).length, 2);
  });
  it('a corrupt store file is a KitExit 1, not a silent allow', async () => {
    const other = path.join(root, 'other');
    for (const name of await fs.readdir(store)) await fs.writeFile(path.join(store, name), '{nope');
    await assert.rejects(run(['check'], io()), e => e instanceof KitExit && e.code === 1);
    await assert.rejects(run(['check'], io({ cwd: other })), e => e instanceof KitExit && e.code === 1);
  });
  it('outside a git repository is KitExit 1', async () => {
    await assert.rejects(run(['check'], io({ cwd: root })), e => e instanceof KitExit && e.code === 1);
  });
});

describe('push-gate — review r2 fixes', () => {
  it('check from a subdirectory finds the store recorded at the repo root', async () => {
    await fs.mkdir(path.join(repo, 'sub'), { recursive: true });
    for (const name of await fs.readdir(store)) await fs.rm(path.join(store, name), { force: true });
    await run(receiptArgs(), io());
    const r = await run(['check'], io({ cwd: path.join(repo, 'sub') }));
    assert.doesNotMatch(r.reason || '', /no review recorded/);
    assert.equal(r.change_id, (await run(['check'], io())).change_id);
    await run(receiptArgs(), io({ cwd: path.join(repo, 'sub') }));
  });
  it('git < 2.31 (echoes unknown flags on stdout, exits 0) finds the same index and store from a subdirectory (review r3)', async () => {
    const old = await oldGitSpawn(root);
    const sub = path.join(repo, 'sub');
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(repo, 'a.txt'), 'one\nold-git edit\n');
    try {
      const viaOld = await run(receiptArgs(), io({ cwd: sub, git: defaultGit(sub, { spawn: old }) }));
      const viaNew = await run(receiptArgs(), io({ cwd: sub }));
      assert.equal(viaOld.dirty, true);
      assert.equal(viaOld.change_id, viaNew.change_id);
      const files = await fs.readdir(store);
      assert.ok(!files.some(f => f.includes('path-format')), files.join(','));
      assert.ok(files.includes(`${crypto.createHash('sha256').update(await fs.realpath(path.join(repo, '.git'))).digest('hex')}.json`), files.join(','));
      const r = await run(['check'], io({ cwd: sub, git: defaultGit(sub, { spawn: old }) }));
      assert.doesNotMatch(r.reason || '', /no review recorded/);
    } finally {
      await fs.writeFile(path.join(repo, 'a.txt'), 'one\n');
    }
  });
  it('an unspawnable git is reported as that, not as "not a repository"', async () => {
    const spawn = () => ({ error: new Error('spawn git ENOENT'), status: null, stdout: null, stderr: null });
    await assert.rejects(
      run(['check'], io({ git: defaultGit(repo, { spawn }) })),
      e => e instanceof KitExit && e.code === 1 && /cannot run git: spawn git ENOENT/.test(e.message)
    );
  });
  it('a failed store write removes its temp file and is a KitExit 1', async () => {
    const dir = path.join(root, 'wa');
    const file = path.join(dir, 'x.json');
    await fs.mkdir(path.join(file, 'nonempty'), { recursive: true });
    await assert.rejects(writeAtomic(dir, file, { a: 1 }), e => e instanceof KitExit && e.code === 1);
    assert.deepEqual((await fs.readdir(dir)).filter(n => n.endsWith('.tmp')), []);
  });
  it('concurrent receipts from worktrees sharing one store lose no entry, and leave no lock', async () => {
    const wt = path.join(root, 'wt');
    sh(repo, 'worktree', 'add', '-q', '-b', 'other', wt);
    await fs.writeFile(path.join(wt, 'b.txt'), 'b\n');
    sh(wt, 'add', '-A');
    sh(wt, 'commit', '-q', '-m', 'wt');
    for (const name of await fs.readdir(store)) await fs.rm(path.join(store, name), { force: true });
    await run(receiptArgs(), io());
    const ids = [];
    for (let i = 0; i < 6; i++) {
      const cwd = i % 2 ? wt : repo;
      await fs.writeFile(path.join(cwd, 'c.txt'), `v${i}\n`);
      sh(cwd, 'add', '-A');
      sh(cwd, 'commit', '-q', '-m', `c${i}`);
    }
    const results = await Promise.all([repo, wt, repo, wt].map(cwd => run(receiptArgs(), io({ cwd }))));
    for (const r of results) ids.push(r.change_id);
    const files = await fs.readdir(store);
    assert.deepEqual(files.filter(n => n.endsWith('.lock') || n.endsWith('.tmp')), []);
    const st = JSON.parse(await fs.readFile(path.join(store, files.find(n => n.endsWith('.json'))), 'utf-8'));
    const seen = new Set([st.latest.change_id, ...st.previous]);
    for (const id of new Set(ids)) assert.ok(seen.has(id), 'every recorded change is kept');
  });
  it('a stale lock file is taken over; a fresh one blocks with a KitExit', async () => {
    const files = await fs.readdir(store);
    const lock = path.join(store, files.find(n => n.endsWith('.json')) + '.lock');
    await fs.writeFile(lock, '');
    const old = new Date(Date.now() - 120000);
    await fs.utimes(lock, old, old);
    await run(receiptArgs(), io());
    await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
    await fs.writeFile(lock, '');
    await assert.rejects(
      run(receiptArgs(), io({ env: { ...process.env, KIT_RECEIPTS_DIR: store, KIT_LOCK_STALE_MS: '600000', KIT_LOCK_WAIT_MS: '100' } })),
      e => e instanceof KitExit && e.code === 1 && /locked/.test(e.message),
      'waits then refuses'
    );
    await fs.rm(lock, { force: true });
  });
});

describe('push-gate — reviewing uncommitted work, then pushing', () => {
  it('review of uncommitted edits matches the same edits committed unchanged; a different commit does not', async () => {
    const r = path.join(root, 'rt');
    const st = path.join(root, 'rt-store');
    await fs.mkdir(r);
    sh(r, 'init', '-q', '.');
    await fs.writeFile(path.join(r, 'a.txt'), 'one\n');
    sh(r, 'add', '-A');
    sh(r, 'commit', '-qm', 'one');
    const e = io({ cwd: r, env: { ...process.env, KIT_RECEIPTS_DIR: st } });
    await fs.writeFile(path.join(r, 'a.txt'), 'one\nfix\n');
    await fs.writeFile(path.join(r, 'scratch.txt'), 'never tracked\n');
    // pushing the uncommitted state would send HEAD only: not reviewed
    const rec = await run(receiptArgs(), e);
    assert.equal(rec.dirty, true);
    assert.equal((await run(['check'], e)).decision, 'ask');
    // commit exactly the reviewed edits: the push matches
    sh(r, 'commit', '-qam', 'fix');
    const ok = await run(['check'], e);
    assert.equal(ok.decision, 'abstain');
    assert.equal(ok.change_id, rec.change_id);
    // a commit made after the review has a different tree and no longer matches
    await fs.writeFile(path.join(r, 'a.txt'), 'one\nfix\nextra\n');
    sh(r, 'commit', '-qam', 'extra');
    const later = await run(['check'], e);
    assert.equal(later.decision, 'ask');
    assert.match(later.reason, /earlier/i);
    // committing something different from what was reviewed does not match either
    await fs.writeFile(path.join(r, 'a.txt'), 'x\n');
    await run(receiptArgs(), e);
    await fs.writeFile(path.join(r, 'a.txt'), 'y\n');
    sh(r, 'commit', '-qam', 'other');
    assert.equal((await run(['check'], e)).decision, 'ask');
    await fs.rm(r, { recursive: true, force: true });
    await fs.rm(st, { recursive: true, force: true });
  });
});

describe('push-gate — decide() can never allow', () => {
  it('only abstain, ask or deny come out of every combination', () => {
    const results = new Set();
    for (const th of ['none', 'high', 'medium', 'low']) {
      for (const verdict of ['pass', 'fail']) for (const incomplete of [true, false]) for (const rth of ['none', 'high', 'medium', 'low']) for (const high of [0, 1]) for (const same of [true, false]) {
        const rec = { change_id: same ? 'x' : 'y', verdict, incomplete, threshold: rth, counts: { high, medium: 0, low: 0 } };
        for (const st of [{ latest: rec, previous: ['x'] }, { latest: null, previous: [] }, null]) results.add(decide(st, 'x', th).decision);
      }
    }
    assert.deepEqual([...results].sort(), ['abstain', 'ask', 'deny']);
    assert.ok(!results.has('allow'));
  });
});
