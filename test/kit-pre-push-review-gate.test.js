import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { verb, usage, run, decide, defaultGit, changeId } from '../src/lib/kit/push-gate.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';

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
  it('is stable, changes with a new commit, and differs when the tree is dirty', async () => {
    const git = defaultGit(repo);
    const a = await changeId(git, {});
    assert.equal(a.id, (await changeId(git, {})).id);
    assert.equal(a.dirty, false);
    await fs.writeFile(path.join(repo, 'a.txt'), 'one\ntwo\n');
    const dirty = await changeId(git, {});
    assert.equal(dirty.dirty, true);
    assert.notEqual(dirty.id, a.id);
    await fs.writeFile(path.join(repo, 'a.txt'), 'one\nthree\n');
    assert.notEqual((await changeId(git, {})).id, dirty.id);
    sh(repo, 'commit', '-qam', 'two');
    const b = await changeId(git, {});
    assert.equal(b.dirty, false);
    assert.notEqual(b.id, a.id);
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
    const c = await run(['check'], io());
    assert.equal(c.decision, 'ask');
    assert.match(c.reason, /earlier/i);
    const d = await run(['check', '--threshold', 'none'], io());
    assert.equal(d.decision, 'ask');
    await fs.rm(path.join(repo, 'b.txt'));
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
  it('keeps the previous change ids', async () => {
    const [f] = await fs.readdir(store);
    const state = JSON.parse(await fs.readFile(path.join(store, f), 'utf-8'));
    assert.ok(state.latest.change_id);
    assert.ok(Array.isArray(state.previous));
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
    const [f] = await fs.readdir(store);
    const other = path.join(root, 'other');
    for (const name of await fs.readdir(store)) await fs.writeFile(path.join(store, name), '{nope');
    await assert.rejects(run(['check'], io()), e => e instanceof KitExit && e.code === 1);
    await assert.rejects(run(['check'], io({ cwd: other })), e => e instanceof KitExit && e.code === 1);
    assert.ok(f);
  });
  it('outside a git repository is KitExit 1', async () => {
    await assert.rejects(run(['check'], io({ cwd: root })), e => e instanceof KitExit && e.code === 1);
  });
});

describe('push-gate — decide() can never allow', () => {
  it('only abstain, ask or deny come out of every combination', () => {
    const results = new Set();
    const receipts = [null, { change_id: 'x', verdict: 'pass', counts: { high: 0, medium: 0, low: 0 }, threshold: 'none' }];
    for (const th of ['none', 'high', 'medium', 'low']) {
      for (const verdict of ['pass', 'fail']) for (const incomplete of [true, false]) for (const rth of ['none', 'high', 'medium', 'low']) for (const high of [0, 1]) for (const same of [true, false]) {
        const rec = { change_id: same ? 'x' : 'y', verdict, incomplete, threshold: rth, counts: { high, medium: 0, low: 0 } };
        for (const st of [{ latest: rec, previous: ['x'] }, { latest: null, previous: [] }, null]) results.add(decide(st, 'x', th).decision);
      }
    }
    void receipts;
    assert.deepEqual([...results].sort(), ['abstain', 'ask', 'deny']);
    assert.ok(!results.has('allow'));
  });
});
