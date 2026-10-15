import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { cluster, pass1, mergeBar, run, verb } from '../src/lib/kit/cluster.js';

const f = (id, rule, severity, files, extra = {}) => ({ id, rule, severity, files, title: `t-${id}`, ...extra });
const yes = { same: true, p: 0.9, confidence: 'high' };

describe('cluster — pass 1 (deterministic)', () => {
  it('buckets by rule + sorted de-duplicated file set, picks most severe, lists members and locations', () => {
    const r = pass1([
      f('a', 'r1', 'low', ['x.js', 'y.js']),
      f('b', 'r1', 'high', ['y.js', 'x.js', 'x.js']),
      f('c', 'r1', 'medium', ['./x.js', 'y.js'], { locations: [{ file: 'x.js', line: 4 }, 'y.js:9'] }),
      f('d', 'r2', 'critical', ['x.js', 'y.js'])
    ]);
    assert.equal(r.clusters.length, 2);
    const c = r.clusters.find(x => x.rule === 'r1');
    assert.equal(c.representative, 'b');
    assert.equal(c.severity, 'high');
    assert.deepEqual(c.members, ['a', 'b', 'c']);
    assert.deepEqual(c.files, ['x.js', 'y.js']);
    assert.ok(c.locations.some(l => l.file === 'x.js' && l.line === 4));
    assert.ok(c.locations.some(l => l.file === 'y.js' && l.line === 9));
    assert.equal(r.pending_pairs.length, 0);
  });
  it('breaks severity ties by smallest id, regardless of input order', () => {
    const list = [f('z', 'r', 'high', ['a']), f('m', 'r', 'high', ['a']), f('q', 'r', 'high', ['a'])];
    assert.equal(pass1(list).clusters[0].representative, 'm');
    assert.equal(pass1([...list].reverse()).clusters[0].representative, 'm');
  });
  it('pending pairs: same rule, file sets overlap but differ', () => {
    const r = pass1([f('a', 'r', 'low', ['x', 'y']), f('b', 'r', 'low', ['y', 'z']), f('c', 'r', 'low', ['q']), f('d', 'other', 'low', ['y', 'z'])]);
    assert.equal(r.pending_pairs.length, 1);
    assert.deepEqual([r.pending_pairs[0].a, r.pending_pairs[0].b], ['a', 'b']);
    assert.deepEqual(r.pending_pairs[0].shared_files, ['y']);
  });
  it('a subset file set also counts as overlap-but-different; disjoint and equal do not', () => {
    assert.equal(pass1([f('a', 'r', 'low', ['x']), f('b', 'r', 'low', ['x', 'y'])]).pending_pairs.length, 1);
    assert.equal(pass1([f('a', 'r', 'low', ['x']), f('b', 'r', 'low', ['y'])]).pending_pairs.length, 0);
  });
});

describe('cluster — pass 2 (judgments)', () => {
  const base = [f('a', 'r', 'low', ['x', 'y']), f('b', 'r', 'high', ['y', 'z'])];
  it('without answers nothing merges and pairs are listed', async () => {
    const r = await cluster(base);
    assert.equal(r.clusters.length, 2);
    assert.equal(r.pending_pairs.length, 1);
  });
  it('merges only when same AND p>=0.5 AND confidence high', async () => {
    const cases = [
      [{ ...yes }, true], [{ same: true, p: 0.5, confidence: 'high' }, true],
      [{ same: true, p: 0.49, confidence: 'high' }, false], [{ same: false, p: 0.9, confidence: 'high' }, false],
      [{ same: true, p: 0.9, confidence: 'medium' }, false], [{ same: true, p: 0.9, confidence: 'low' }, false]
    ];
    for (const [j, merged] of cases) {
      const r = await cluster(base, { answers: [{ a: 'a', b: 'b', ...j }] });
      assert.equal(r.clusters.length, merged ? 1 : 2, JSON.stringify(j));
      assert.equal(mergeBar({ a: 'a', b: 'b', ...j }), merged);
    }
  });
  it('merged cluster takes most severe representative and unions members, files, locations', async () => {
    const r = await cluster(base, { answers: [{ a: 'b', b: 'a', ...yes }] });
    const c = r.clusters[0];
    assert.equal(c.representative, 'b');
    assert.deepEqual(c.members, ['a', 'b']);
    assert.deepEqual(c.files, ['x', 'y', 'z']);
    assert.deepEqual(c.merged_from, ['a', 'b']);
    assert.equal(r.pending_pairs.length, 0);
  });
  it('ignores and reports answers for pairs that are not pending', async () => {
    const r = await cluster(base, { answers: [{ a: 'a', b: 'nope', ...yes }, { a: 'a', b: 'a', ...yes }] });
    assert.equal(r.clusters.length, 2);
    assert.equal(r.ignored_answers.length, 2);
  });
  it('an answer for same-rule disjoint clusters is ignored (never merges)', async () => {
    const r = await cluster([f('a', 'r', 'low', ['x']), f('b', 'r', 'low', ['y'])], { answers: [{ a: 'a', b: 'b', ...yes }] });
    assert.equal(r.clusters.length, 2);
    assert.equal(r.ignored_answers.length, 1);
  });
  it('transitive safety: a chain never merges across a pair that is unjudged or refused', async () => {
    // a-b, b-c, a-c all pending; a-b and b-c approved, a-c refused -> only the first (sorted) merge lands
    const list = [f('a', 'r', 'low', ['x', 'y']), f('b', 'r', 'low', ['y', 'z']), f('c', 'r', 'low', ['x', 'z'])];
    const r = await cluster(list, { answers: [
      { a: 'b', b: 'c', ...yes }, { a: 'a', b: 'b', ...yes }, { a: 'a', b: 'c', same: false, p: 0.1, confidence: 'high' }] });
    assert.equal(r.clusters.length, 2);
    assert.equal(r.blocked.length, 1);
    const again = await cluster(list, { answers: [
      { a: 'a', b: 'c', same: false, p: 0.1, confidence: 'high' }, { a: 'a', b: 'b', ...yes }, { a: 'b', b: 'c', ...yes }] });
    assert.deepEqual(again.clusters, r.clusters);
    // unjudged vetoing pair
    const r2 = await cluster(list, { answers: [{ a: 'a', b: 'b', ...yes }, { a: 'b', b: 'c', ...yes }] });
    assert.equal(r2.clusters.length, 2);
  });
  it('a full clique of approvals merges all', async () => {
    const list = [f('a', 'r', 'low', ['x', 'y']), f('b', 'r', 'low', ['y', 'z']), f('c', 'r', 'low', ['x', 'z'])];
    const r = await cluster(list, { answers: [['a', 'b'], ['b', 'c'], ['a', 'c']].map(([a, b]) => ({ a, b, ...yes })) });
    assert.equal(r.clusters.length, 1);
    assert.deepEqual(r.clusters[0].members, ['a', 'b', 'c']);
  });
  it('conflicting answers for one pair do not merge', async () => {
    const r = await cluster(base, { answers: [{ a: 'a', b: 'b', ...yes }, { a: 'b', b: 'a', same: false, p: 0.2, confidence: 'high' }] });
    assert.equal(r.clusters.length, 2);
    assert.equal(r.conflicting_answers.length, 1);
  });
  it('injected decide is called once per unanswered pending pair; answers win', async () => {
    const list = [f('a', 'r', 'low', ['x', 'y']), f('b', 'r', 'low', ['y', 'z']), f('c', 'q', 'low', ['x', 'y']), f('d', 'q', 'low', ['y'])];
    const seen = [];
    const r = await cluster(list, { answers: [{ a: 'a', b: 'b', same: false, p: 0, confidence: 'high' }], decide: async (p) => { seen.push(`${p.a}${p.b}`); return yes; } });
    assert.deepEqual(seen, ['cd']);
    assert.equal(r.clusters.length, 3);
  });
  it('rejects a malformed decide result or answer', async () => {
    await assert.rejects(cluster(base, { decide: () => ({ same: 'yes' }) }), /decide/);
    await assert.rejects(cluster(base, { answers: [{ a: 'a', b: 'b', same: true, p: 2, confidence: 'high' }] }), /p/);
    await assert.rejects(cluster(base, { answers: [{ a: 'a', b: 'b', same: true, p: 1, confidence: 'sure' }] }), /confidence/);
  });
});

describe('cluster — bad input exits 1', () => {
  const bad = [
    [null, /list/], [[{ rule: 'r', severity: 'low', files: ['a'] }], /id/],
    [[f('a', 'r', 'low', ['x']), f('a', 'r', 'low', ['y'])], /duplicate/],
    [[f('a', '', 'low', ['x'])], /rule/], [[f('a', 'r', 'nope', ['x'])], /severity/],
    [[f('a', 'r', 'low', [])], /file/], [[f('a', 'r', 'low', [''])], /file/]
  ];
  for (const [input, re] of bad) {
    it(`rejects ${JSON.stringify(input)?.slice(0, 50)}`, async () => {
      await assert.rejects(cluster(input), (e) => e.code === 1 && re.test(e.message));
    });
  }
});

describe('cluster — run (CLI surface)', () => {
  const io = (cwd, stdin = '') => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
  it('reads --file and --answers, resolves against cwd; verb name', async () => {
    assert.equal(verb, 'cluster');
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'cluster-'));
    try {
      await fs.writeFile(path.join(d, 'in.json'), JSON.stringify({ findings: [f('a', 'r', 'low', ['x', 'y']), f('b', 'r', 'high', ['y', 'z'])] }));
      const pending = await run(['--file', 'in.json'], io(d));
      assert.equal(pending.pending_pairs.length, 1);
      await fs.writeFile(path.join(d, 'ans.json'), JSON.stringify({ answers: [{ a: 'a', b: 'b', ...yes }] }));
      const done = await run(['--file', 'in.json', '--answers', 'ans.json'], io(d));
      assert.equal(done.clusters.length, 1);
      const viaStdin = await run([], io(d, JSON.stringify([f('a', 'r', 'low', ['x'])])));
      assert.equal(viaStdin.clusters.length, 1);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('exit 1 on bad json, missing file, unknown flag, empty stdin', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'cluster-'));
    try {
      await fs.writeFile(path.join(d, 'bad.json'), '{nope');
      for (const [args, stdin] of [[['--file', 'bad.json'], ''], [['--file', 'missing.json'], ''], [['--wat'], ''], [[], ''], [['--answers', 'bad.json'], '[]']]) {
        await assert.rejects(run(args, io(d, stdin)), (e) => e.code === 1, args.join(' '));
      }
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
});
