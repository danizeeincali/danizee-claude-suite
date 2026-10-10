import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { buildGraph } from '../src/lib/kit/graph.js';
import * as impact from '../src/lib/kit/impact.js';
import * as cf from '../src/lib/kit/caller-floor.js';
import { loadVerbs } from '../src/lib/kit/cli.js';

const { callerIndex, renderFloor, run, parseArgs, parseSymbolArg, HAND_CHECK } = cf;

async function repo(files, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-callers-'));
  try {
    const root = await fs.realpath(dir);
    for (const [rel, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), text);
    }
    const g = (...a) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf-8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    g('init', '-q', '.'); g('add', '-A'); g('commit', '-q', '-m', 'base');
    return await fn(root, g);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
const entryOf = (idx, file, qualified) => [...idx.values()].find((e) => e.file === file && e.qualified === qualified);
const codes = (e) => e.reasons.map((r) => r.code);
const cli = (dir, args, extra = {}) => run(args, { cwd: dir, env: process.env, ...extra });

describe('callerIndex — each reason from a real temp repo', () => {
  it('ambiguous_name: a call that fits two same-named methods is tied to neither', async () => {
    await repo({
      'a.js': 'export class A { save() {} }\n', 'b.js': 'export class B { save() {} }\n',
      'use.js': 'export function use(x) { x.save(); }\n'
    }, async (root) => {
      const idx = callerIndex(await buildGraph(root));
      const a = entryOf(idx, 'a.js', 'A.save');
      assert.equal(a.floor, true);
      assert.deepEqual(a.reasons.filter((r) => r.code === 'ambiguous_name').map((r) => [r.count, r.sentence]), [[1, '1 call named `save` could not be tied to one definition.']]);
      assert.equal(a.callers.length, 1, 'the possible edge is still listed as a caller');
      assert.deepEqual(renderFloor(a).slice(0, 1), ['1 call named `save` could not be tied to one definition.']);
    });
  });

  it('dynamic_call: a call through a value that shares the symbol name, and a computed member call', async () => {
    await repo({
      'lib.js': 'export function target() {}\nexport class K { act() {} }\n',
      'use.js': 'export function go(target) { target(); }\nexport function pick(o, k) { o[k](); }\n'
    }, async (root) => {
      const idx = callerIndex(await buildGraph(root));
      const t = entryOf(idx, 'lib.js', 'target');
      assert.ok(codes(t).includes('dynamic_call'), JSON.stringify(t.reasons));
      assert.match(t.reasons.find((r) => r.code === 'dynamic_call').sentence, /through a value or computed member/);
      const act = entryOf(idx, 'lib.js', 'K.act');
      assert.ok(codes(act).includes('dynamic_call'), 'a computed call may reach any method');
      assert.ok(!codes(t).includes('ambiguous_name'));
    });
  });

  it('interface_dispatch: a method of a class that implements an interface, and the interface itself', async () => {
    await repo({
      'store.ts': 'export interface Store { save(): void }\nexport class Mem implements Store { save() {} }\n'
    }, async (root) => {
      const idx = callerIndex(await buildGraph(root));
      const m = entryOf(idx, 'store.ts', 'Mem.save');
      assert.deepEqual(m.reasons.filter((r) => r.code === 'interface_dispatch').map((r) => r.count), [1]);
      const i = entryOf(idx, 'store.ts', 'Store');
      assert.ok(codes(i).includes('interface_dispatch'));
      assert.match(i.reasons[0].sentence, /1 class implements or extends `Store`, so calls typed as the interface reach it without naming it\./);
    });
  });

  it('unread_files: a file in another language is a file a caller may sit in', async () => {
    await repo({ 'a.js': 'export function f() {}\n', 'tool.py': 'print(1)\n' }, async (root) => {
      const g = await buildGraph(root);
      const e = entryOf(callerIndex(g), 'a.js', 'f');
      assert.equal(e.floor, true);
      assert.deepEqual(e.reasons.map((r) => [r.code, r.count]), [['unread_files', 1]]);
      assert.match(e.reasons[0].sentence, /1 project file was not read \(unsupported: 1\); a caller may be in it\./);
      assert.equal(g.partial, true);
    });
  });

  it('budget_cut_importers: a parse cap leaves files unread, and they are counted apart from other unread files', async () => {
    await repo({ 'a.js': 'export function f() {}\n', 'b.js': 'export function g() {}\n', 'c.js': 'export function h() {}\n' }, async (root) => {
      const g = await buildGraph(root, { maxParses: 1, changed: ['a.js'] });
      assert.ok(g.not_read.some((r) => r.reason === 'parse_cap'));
      const e = entryOf(callerIndex(g), 'a.js', 'f');
      const b = e.reasons.find((r) => r.code === 'budget_cut_importers');
      assert.equal(b.count, g.not_read.filter((r) => r.reason === 'parse_cap').length);
      assert.match(b.sentence, /budget ran out, so importers of `f` may be unresolved\./);
      assert.ok(!codes(e).includes('unread_files'));
    });
  });

  it('budget_cut_importers: unresolved calls dropped at the row cap are counted, not forgotten', () => {
    const graph = { defs: [{ id: 'a.js::f@1', file: 'a.js', name: 'f', qualified: 'f', kind: 'function' }], edges: [], unresolved: [{ from: 'a.js::<module>', call: 'x', reason: 'value call' }], not_read: [], stats: { unresolved_total: 6 } };
    const e = callerIndex(graph).get('a.js::f@1');
    assert.deepEqual(e.reasons.map((r) => [r.code, r.count]), [['budget_cut_importers', 5]]);
    assert.match(e.reasons[0].sentence, /5 unresolved calls were dropped at the graph's row cap/);
  });

  it('a symbol whose callers were all resolved has no floor and a plain sentence', async () => {
    await repo({ 'lib.js': 'export function helper() {}\n', 'main.js': "import { helper } from './lib.js';\nexport function main() { helper(); }\n" }, async (root) => {
      const g = await buildGraph(root);
      assert.equal(g.partial, false);
      const e = entryOf(callerIndex(g), 'lib.js', 'helper');
      assert.equal(e.floor, false);
      assert.deepEqual(e.reasons, []);
      assert.deepEqual(e.callers.map((c) => [c.from.split('@')[0], c.confidence]), [['main.js::main', 'certain']]);
      assert.deepEqual(renderFloor(e), []);
      const none = entryOf(callerIndex(g), 'main.js', 'main');
      assert.deepEqual(renderFloor(none), ['Zero callers found in the files that were read.'], 'not "no use": only "in the files that were read"');
    });
  });

  it('zero callers with an unread file is a floor and says to check by hand', async () => {
    await repo({ 'a.js': 'export function lonely() {}\n', 'x.go': 'package x\n' }, async (root) => {
      const e = entryOf(callerIndex(await buildGraph(root)), 'a.js', 'lonely');
      assert.equal(e.callers.length, 0);
      assert.equal(e.floor, true);
      assert.equal(renderFloor(e).at(-1), 'Zero callers found, but this is a floor: check call sites by hand.');
      assert.equal(HAND_CHECK, renderFloor(e).at(-1));
    });
  });

  it('a floor with callers still tells the reviewer to check by hand', () => {
    const lines = renderFloor({ floor: true, callers: [{ from: 'x' }], reasons: [{ code: 'unread_files', count: 1, sentence: 's.' }] });
    assert.deepEqual(lines, ['s.', 'This is a floor: check call sites by hand.']);
  });
});

describe('impact carries the floor', () => {
  const before = { 'lib.js': 'export function helper() { return 1; }\nexport function gone() { return 2; }\n', 'main.js': "import { helper } from './lib.js';\nexport function main() { return helper(); }\n", 'tool.py': 'print(1)\n' };
  it('a removed symbol with zero callers but a floor is not safe to remove; impacted and touched rows carry reasons', async () => {
    await repo(before, async (root, g) => {
      await fs.writeFile(path.join(root, 'lib.js'), 'export function helper() { return 3; }\n');
      const diff = g('diff', '--no-color', '--no-ext-diff', '--no-prefix', 'HEAD');
      const r = await impact.run(['--dir', root, '--diff', '-', '--base', 'HEAD'], { cwd: root, stdin: async () => diff, env: process.env });
      const gone = r.removed.find((x) => x.name === 'gone');
      assert.ok(gone, 'gone was removed');
      assert.equal(gone.floor, true);
      assert.ok(gone.reasons.some((x) => x.code === 'unread_files'));
      assert.equal(gone.sentences.at(-1), HAND_CHECK);
      assert.deepEqual(r.removed_with_live_callers, []);
      const main = r.impacted.find((x) => x.qualified === 'main');
      assert.equal(main.floor, true);
      assert.ok(Array.isArray(main.sentences) && main.sentences.length);
      assert.ok(r.touched.every((t) => typeof t.floor === 'boolean' && Array.isArray(t.reasons)));
    });
  });
  it('without any unread file the same removal has no floor', async () => {
    const { 'tool.py': _py, ...clean } = before;
    await repo(clean, async (root, g) => {
      await fs.writeFile(path.join(root, 'lib.js'), 'export function helper() { return 3; }\n');
      const diff = g('diff', '--no-color', '--no-ext-diff', '--no-prefix', 'HEAD');
      const r = await impact.run(['--dir', root, '--diff', '-', '--base', 'HEAD'], { cwd: root, stdin: async () => diff, env: process.env });
      const gone = r.removed.find((x) => x.name === 'gone');
      assert.equal(gone.floor, false);
      assert.deepEqual(gone.sentences, ['Zero callers found in the files that were read.']);
    });
  });
  it('a removed symbol that is still called lists its live caller and keeps the floor honest', async () => {
    await repo({ 'lib.js': 'export function gone() {}\n', 'main.js': "import { gone } from './lib.js';\nexport function main() { gone(); }\n" }, async (root, g) => {
      await fs.writeFile(path.join(root, 'lib.js'), 'export function other() {}\n');
      const diff = g('diff', '--no-color', '--no-ext-diff', '--no-prefix', 'HEAD');
      const r = await impact.run(['--dir', root, '--diff', '-', '--base', 'HEAD'], { cwd: root, stdin: async () => diff, env: process.env });
      assert.equal(r.removed_with_live_callers.length, 1);
      const gone = r.removed.find((x) => x.name === 'gone');
      assert.ok(!gone.sentences.includes(HAND_CHECK), 'a live caller was found, so it does not read as zero callers');
    });
  });
});

describe('callers — CLI', () => {
  it('is discovered as a verb', async () => {
    const v = await loadVerbs();
    assert.ok(v.has('callers'));
  });
  it('parseArgs: unknown flags and missing values are refused, --symbol takes several', () => {
    assert.deepEqual(parseArgs(['--symbol', 'a.js:f', 'b.js:g']).symbols, ['a.js:f', 'b.js:g']);
    assert.throws(() => parseArgs(['--nope']), (e) => e instanceof KitExit && e.code === 1 && /unknown flag --nope \(see --help\)/.test(e.message));
    assert.throws(() => parseArgs(['--symbol']), /needs at least one file:name/);
    assert.throws(() => parseArgs(['--diff']), /needs a value/);
    assert.throws(() => parseArgs(['stray']), /unexpected argument/);
  });
  it('parseSymbolArg splits at the last colon so odd file names survive', () => {
    assert.deepEqual(parseSymbolArg('src/a b:c.js:Class.method'), { file: 'src/a b:c.js', name: 'Class.method' });
    assert.throws(() => parseSymbolArg('nocolon'), /is not file:name/);
    assert.throws(() => parseSymbolArg('a.js:'), /is not file:name/);
  });
  it('needs --symbol or --diff', async () => {
    await assert.rejects(cli(os.tmpdir(), []), (e) => e instanceof KitExit && e.code === 1 && /see --help/.test(e.message));
  });
  it('--symbol prints entries with sentences, lists what is missing, and carries partial and not_read', async () => {
    await repo({ 'src/odd name: x.js': 'export function f() {}\n', 'src/main.js': "import { f } from './odd name: x.js';\nexport function m() { f(); }\n", 'tool.py': 'print(1)\n' }, async (root) => {
      const r = await cli(root, ['--symbol', 'src/odd name: x.js:f', 'src/main.js:nothing', 'tool.py:main']);
      assert.equal(r.partial, true);
      assert.deepEqual(r.not_read.map((x) => x.file), ['tool.py']);
      assert.equal(r.entries.length, 1);
      assert.equal(r.entries[0].callers_total, 1);
      assert.equal(r.entries[0].floor, true);
      assert.match(r.entries[0].sentences.join(' '), /1 project file was not read/);
      assert.deepEqual(r.missing.map((x) => x.name), ['nothing', 'main']);
      assert.match(r.missing[1].reason, /file was not read \(unsupported\); this says nothing about its callers/);
      assert.ok(r.limits.length >= 1);
      assert.ok(r.notes.some((n) => /not proof that a symbol is unused/.test(n)));
    });
  });
  it('--diff prints the touched symbols; an empty diff is not an error; a terminal is refused', async () => {
    await repo({ 'a.js': 'export function f() {\n  return 1;\n}\n' }, async (root, g) => {
      await fs.writeFile(path.join(root, 'a.js'), 'export function f() {\n  return 2;\n}\n');
      const diff = g('diff', '--no-color', '--no-ext-diff', '--no-prefix', 'HEAD');
      const r = await cli(root, ['--diff', '-'], { stdin: async () => diff });
      assert.deepEqual(r.entries.map((e) => e.qualified), ['f']);
      assert.equal(r.entries[0].floor, false);
      assert.deepEqual(r.entries[0].sentences, ['Zero callers found in the files that were read.']);
      const empty = await cli(root, ['--diff', '-'], { stdin: async () => '' });
      assert.deepEqual(empty.entries, []);
      assert.ok(empty.notes.some((n) => /touched no definition/.test(n)));
      await assert.rejects(cli(root, ['--diff', '-'], { stdinIsTTY: true, stdin: async () => '' }), (e) => e instanceof KitExit && /not a terminal/.test(e.message));
    });
  });
  it('a long caller list is capped and says how many are left out', async () => {
    const files = { 'lib.js': 'export function hot() {}\n' };
    for (let i = 0; i < 55; i++) files[`c${i}.js`] = `import { hot } from './lib.js';\nexport function c${i}() { hot(); }\n`;
    await repo(files, async (root) => {
      const r = await cli(root, ['--symbol', 'lib.js:hot']);
      assert.equal(r.entries[0].callers_total, 55);
      assert.equal(r.entries[0].callers.length, cf.MAX_LISTED_CALLERS);
      assert.equal(r.entries[0].callers_omitted, 5);
    });
  });
});
