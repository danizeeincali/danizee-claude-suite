import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { planTests, run, STRENGTH, changedFromDiff, normPath } from '../src/lib/kit/test-plan.js';

const base = () => ({
  targets: [
    { id: 'home', files: ['src/home.js', 'src/ui/button.js'], entry: true },
    { id: 'cart', files: ['src/cart.js', 'src/ui/button.js'] },
    { id: 'pay', files: ['src/pay.js', 'src/ui/button.js'] },
    { id: 'help', files: ['src/help.js'] },
    { id: 'about', files: ['src/about.js'] },
    { id: 'misc', files: [] }
  ],
  flows: [{ id: 'checkout', targets: ['cart', 'pay', 'help'], critical: true }],
  edges: [['home', 'cart'], ['cart', 'pay'], ['home', 'pay'], ['pay', 'help']],
  always: ['about']
});
const reasonOf = (r, id) => r.plan.find(i => i.id === id)?.reason;

describe('test-plan', () => {
  it('direct change, flow pull, always appended last, deterministic', () => {
    const r = planTests(base(), ['src/cart.js', 'src/home.js', 'src/readme.md']);
    assert.equal(reasonOf(r, 'cart'), 'direct-change');
    assert.equal(reasonOf(r, 'home'), 'direct-change');
    assert.equal(reasonOf(r, 'pay'), 'flow');
    assert.equal(reasonOf(r, 'help'), 'flow');
    assert.equal(r.plan.at(-1).id, 'about');
    assert.equal(r.plan.at(-1).reason, 'always');
    assert.deepEqual(r.flows, ['checkout']);
    assert.equal(r.plan.find(i => i.id === 'pay').critical, true);
    assert.equal(r.low_confidence, false);
    assert.deepEqual(r.plan.map(i => i.id), ['cart', 'home', 'help', 'pay', 'about']);
    assert.deepEqual(r, planTests(base(), ['src/readme.md', 'src/home.js', 'src/cart.js']));
  });

  it('a file reaching 30 percent of targets is shared-component; below it is direct', () => {
    const r = planTests(base(), ['src/ui/button.js']);
    assert.deepEqual(r.shared, ['src/ui/button.js']);
    assert.equal(reasonOf(r, 'home'), 'shared-component');
    assert.equal(reasonOf(r, 'help'), 'flow');
    assert.equal(reasonOf(r, 'misc'), undefined);
    const r2 = planTests(base(), ['src/ui/button.js'], { sharedPct: 60 });
    assert.deepEqual(r2.shared, []);
    assert.equal(reasonOf(r2, 'home'), 'direct-change');
  });

  it('exactly at the shared threshold counts; a single-target file is never shared', () => {
    const r = planTests(base(), ['src/ui/button.js'], { sharedPct: 50 });
    assert.deepEqual(r.shared, ['src/ui/button.js']); // 3 of 6 = 50
    const one = planTests({ targets: [{ id: 'a', files: ['x.js'] }] }, ['x.js']);
    assert.equal(one.plan[0].reason, 'direct-change');
    assert.deepEqual(one.shared, []);
  });

  it('direct beats shared when another changed file hits the target directly', () => {
    const r = planTests(base(), ['src/ui/button.js', 'src/cart.js']);
    assert.equal(reasonOf(r, 'cart'), 'direct-change');
    assert.deepEqual(r.plan.find(i => i.id === 'cart').reasons, ['direct-change', 'shared-component', 'flow']);
    assert.equal(reasonOf(r, 'pay'), 'shared-component');
  });

  it('strength order is direct > shared > flow > smoke > always', () => {
    assert.deepEqual([...STRENGTH], ['direct-change', 'shared-component', 'flow', 'smoke', 'always']);
    // 'about' is always AND direct: direct wins and it is not pushed to the end
    const r = planTests(base(), ['src/about.js']);
    assert.equal(reasonOf(r, 'about'), 'direct-change');
    assert.deepEqual(r.plan[0].reasons, ['direct-change', 'always']);
    assert.equal(r.plan.length, 1);
  });

  it('low mapped share adds smoke (entries + most connected) and flags low confidence', () => {
    const r = planTests(base(), ['src/cart.js', 'docs/a.md', 'docs/b.md'], { smoke: 2 });
    assert.equal(r.low_confidence, true);
    assert.match(r.low_confidence_reason, /1 of 3/);
    assert.equal(reasonOf(r, 'home'), 'smoke'); // entry
    assert.equal(reasonOf(r, 'pay'), 'flow');   // degree 3, but flow is stronger
    assert.equal(reasonOf(r, 'cart'), 'direct-change');
    assert.deepEqual(r.coverage.unmapped, ['docs/a.md', 'docs/b.md']);
    assert.equal(r.coverage.changed_unmapped, 2);
  });

  it('smoke ranks by edge degree then id, and respects --smoke', () => {
    const r = planTests({ targets: [{ id: 'a', files: [] }, { id: 'b', files: [] }, { id: 'c', files: [] }], edges: [['c', 'a'], ['c', 'b']] }, ['z.js'], { smoke: 2 });
    assert.deepEqual(r.plan.map(i => i.id), ['c']);
    const r0 = planTests({ targets: [{ id: 'a', files: [] }] }, ['z.js'], { smoke: 0 });
    assert.deepEqual(r0.plan, []);
    assert.equal(r0.low_confidence, true);
  });

  it('mapped share exactly at the minimum is not low confidence; no changes is not either', () => {
    const r = planTests(base(), ['src/cart.js', 'x.md'], { minMappedPct: 50 });
    assert.equal(r.low_confidence, false);
    const none = planTests(base(), []);
    assert.equal(none.low_confidence, false);
    assert.deepEqual(none.plan.map(i => i.id), ['about']);
    assert.equal(none.coverage.mapped_pct, 100);
  });

  it('coverage counts', () => {
    const r = planTests(base(), ['./src\\home.js', 'src/home.js', 'nope.js']);
    assert.deepEqual(r.coverage, { targets_planned: r.plan.length, targets_total: 6, changed_total: 2, changed_mapped: 1, changed_unmapped: 1, unmapped: ['nope.js'], mapped_pct: 50 });
    assert.equal(normPath('./a//b\\c/'), 'a/b/c');
  });

  it('diff paths include old path on rename and delete', () => {
    const d = 'diff --git a/old.js b/new.js\nsimilarity index 90%\nrename from old.js\nrename to new.js\n--- a/old.js\n+++ b/new.js\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/gone.js b/gone.js\ndeleted file mode 100644\n--- a/gone.js\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n';
    const p = changedFromDiff(d);
    for (const f of ['new.js', 'old.js', 'gone.js']) assert.ok(p.includes(f), f);
  });

  it('invalid input throws exit 1', async () => {
    const cases = [
      null, [], {}, { targets: [] }, { targets: [{ id: 'a' }, { id: 'a' }] }, { targets: [{ files: [] }] },
      { targets: [{ id: 'a', files: 'x' }] }, { targets: [{ id: 'a' }], flows: [{ id: 'f', targets: ['zz'] }] },
      { targets: [{ id: 'a' }], edges: [['a', 'q']] }, { targets: [{ id: 'a' }], always: ['q'] }, { targets: [{ id: 'a' }], changed: 'x' }
    ];
    for (const c of cases) assert.throws(() => planTests(c, []), (e) => e.code === 1, JSON.stringify(c));
    const io = (s) => ({ cwd: '/', stdin: async () => s, stdinIsTTY: false });
    await assert.rejects(run([], io('{bad')), (e) => e.code === 1);
    await assert.rejects(run(['--shared-pct', '101'], io('{}')), (e) => e.code === 1);
    await assert.rejects(run(['--bogus', '1'], io('{}')), (e) => e.code === 1);
    await assert.rejects(run(['--changed'], io('{}')), (e) => e.code === 1);
    await assert.rejects(run(['--in', '/nonexistent/x.json'], io('')), (e) => e.code === 1);
  });

  it('CLI reads --in, --changed (lines and JSON) and --diff, merged', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tp-'));
    try {
      await fs.writeFile(path.join(dir, 'in.json'), JSON.stringify({ ...base(), changed: ['src/help.js'] }));
      await fs.writeFile(path.join(dir, 'c.txt'), 'src/cart.js\n\n');
      await fs.writeFile(path.join(dir, 'd.diff'), '--- a/src/home.js\n+++ b/src/home.js\n@@ -1 +1 @@\n-a\n+b\n');
      const r = await run(['--in', 'in.json', '--changed', 'c.txt', '--diff', 'd.diff'], { cwd: dir });
      assert.equal(r.coverage.changed_total, 3);
      assert.equal(r.coverage.changed_unmapped, 0);
      await fs.writeFile(path.join(dir, 'c.json'), '["src/about.js"]');
      const r2 = await run(['--in', 'in.json', '--changed', 'c.json'], { cwd: dir });
      assert.equal(r2.coverage.changed_total, 2);
      await fs.writeFile(path.join(dir, 'bad.diff'), 'hello');
      await assert.rejects(run(['--in', 'in.json', '--diff', 'bad.diff'], { cwd: dir }), (e) => e.code === 1);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('low-confidence compares the raw share, not the rounded one (241 of 402 is 59.95, below 60)', () => {
    const targets = [{ id: 'a', files: Array.from({ length: 241 }, (_, i) => `m${i}.js`), entry: true }];
    const changed = [...targets[0].files, ...Array.from({ length: 161 }, (_, i) => `u${i}.js`)];
    const r = planTests({ targets }, changed);
    assert.equal(r.low_confidence, true);
    assert.ok(r.low_confidence_reason);
    assert.equal(r.plan[0].reason, 'direct-change');
    // exactly at the threshold is not low
    assert.equal(planTests({ targets: [{ id: 'a', files: ['x', 'y', 'z'] }] }, ['x', 'y', 'z', 'u', 'v']).low_confidence, false);
  });

  it('low_confidence_reason tells the truth about the smoke set', () => {
    const none = planTests({ targets: [{ id: 'a', files: [] }] }, ['z.js'], { smoke: 0 });
    assert.deepEqual(none.plan, []);
    assert.equal(none.low_confidence, true);
    assert.ok(!/smoke set was added/.test(none.low_confidence_reason));
    assert.match(none.low_confidence_reason, /no smoke targets/);
    const some = planTests({ targets: [{ id: 'a', files: [], entry: true }, { id: 'b', files: [] }] }, ['z.js'], { smoke: 2 });
    assert.equal(some.plan.length, 2);
    assert.match(some.low_confidence_reason, /smoke set: 2 targets/);
  });

  it('rejects unknown keys in the input object', async () => {
    assert.throws(() => planTests({ targets: [{ id: 'a' }], flow: [] }, []), (e) => e.code === 1 && /flow/.test(e.message));
    const io = (s) => ({ cwd: '/', stdin: async () => s, stdinIsTTY: false });
    await assert.rejects(run([], io('{"targets":[{"id":"a"}],"extra":1}')), (e) => e.code === 1);
  });

  it('strips a leading BOM from JSON input, --in and --changed', async () => {
    const io = (s) => ({ cwd: '/', stdin: async () => s, stdinIsTTY: false });
    const r = await run([], io('\uFEFF' + JSON.stringify({ targets: [{ id: 'a', files: ['x.js'] }], changed: ['x.js'] })));
    assert.equal(r.plan[0].id, 'a');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tp-'));
    try {
      await fs.writeFile(path.join(dir, 'in.json'), '\uFEFF' + JSON.stringify({ targets: [{ id: 'a', files: ['x.js'] }] }));
      await fs.writeFile(path.join(dir, 'c.json'), '\uFEFF["x.js"]');
      const r2 = await run(['--in', 'in.json', '--changed', 'c.json'], { cwd: dir });
      assert.equal(r2.plan[0].id, 'a');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
