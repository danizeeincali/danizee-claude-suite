import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as impact from '../src/lib/kit/impact.js';
import { loadVerbs } from '../src/lib/kit/cli.js';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const { parseDiffLines, touchedSymbols, walk, risk, removedWithLiveCallers, run } = impact;

async function tmp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-impact-'));
  try { return await fn(await fs.realpath(dir)); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
const put = async (dir, files) => {
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) { await fs.rm(path.join(dir, rel), { force: true }); continue; }
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), text);
  }
};
const git = (dir, ...a) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
/** A repo with `before` committed, then `after` applied to the work tree. Returns the diff (new files included) and the base. */
async function change(dir, before, after) {
  git(dir, 'init', '-q', '.');
  await put(dir, before);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  await put(dir, after);
  git(dir, 'add', '-A');
  return { base: 'HEAD', diff: git(dir, 'diff', '--no-color', '--no-ext-diff', '--no-prefix', '--cached', 'HEAD') };
}
const impactOf = (dir, diff, extra = []) => run(['--dir', dir, '--diff', '-', ...extra], { cwd: dir, stdin: async () => diff, env: process.env });
const ids = (rows) => rows.map(r => r.qualified);

describe('impact — parseDiffLines', () => {
  const body = ['@@ -1,3 +1,4 @@', ' keep', '-gone1', '-gone2', '+new1', '+new2', ' keep2', '@@ -10 +11,0 @@', '-last', ''];
  it('gives new-side added ranges and old-side removed ranges, with every prefix style', () => {
    for (const [a, b] of [['a/', 'b/'], ['', ''], ['c/', 'w/'], ['i/', 'w/']]) {
      const d = [`diff --git ${a}x.js ${b}x.js`, `--- ${a}x.js`, `+++ ${b}x.js`, ...body].join('\n');
      assert.deepEqual(parseDiffLines(d), [{ path: 'x.js', oldPath: 'x.js', deleted: false, added: [[2, 3]], removed: [[2, 3], [10, 10]] }], `${a}|${b}`);
    }
  });
  it('a new file, a deleted file and a rename', () => {
    const d = [
      'diff --git a/n.js b/n.js', 'new file mode 100644', '--- /dev/null', '+++ b/n.js', '@@ -0,0 +1,2 @@', '+a', '+b',
      'diff --git a/d.js b/d.js', 'deleted file mode 100644', '--- a/d.js', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-a', '-b',
      'diff --git a/o.js b/p.js', 'similarity index 90%', 'rename from o.js', 'rename to p.js', '--- a/o.js', '+++ b/p.js', '@@ -4 +4 @@', '-x', '+y', ''].join('\n');
    const r = parseDiffLines(d);
    assert.deepEqual(r.map(f => [f.path, f.oldPath, f.deleted, f.added, f.removed]), [
      ['n.js', '/dev/null', false, [[1, 2]], []],
      ['d.js', 'd.js', true, [], [[1, 2]]],
      ['p.js', 'o.js', false, [[4, 4]], [[4, 4]]]
    ]);
  });
  it('a quoted non-ASCII name and a name with a space', () => {
    const d = ['diff --git "a/caf\\303\\251.js" "b/caf\\303\\251.js"', '--- "a/caf\\303\\251.js"', '+++ "b/caf\\303\\251.js"', '@@ -1 +1 @@', '-1', '+2', ''].join('\n');
    assert.equal(parseDiffLines(d)[0].path, 'café.js');
  });
});

describe('impact — a call chain', () => {
  const files = {
    'src/leaf.js': 'export function leaf() {\n  return 1;\n}\nexport function other() {\n  return 2;\n}\n',
    'src/mid.js': "import { leaf } from './leaf.js';\nexport function mid() {\n  return leaf();\n}\n",
    'src/top.js': "import { mid } from './mid.js';\nexport function top() {\n  return mid();\n}\n",
    'src/far.js': "import { top } from './top.js';\nexport function far() {\n  return top();\n}\n"
  };
  const edited = { ...files, 'src/leaf.js': 'export function leaf() {\n  return 99;\n}\nexport function other() {\n  return 2;\n}\n' };

  it('maps the changed line to the innermost definition and follows callers two hops, not three', () => tmp(async (dir) => {
    const { diff } = await change(dir, files, edited);
    const r = await impactOf(dir, diff);
    assert.deepEqual(ids(r.touched), ['leaf']);
    assert.deepEqual(r.impacted.map(i => [i.qualified, i.hop, i.confidence, i.via]), [['mid', 1, 'certain', ['call']], ['top', 2, 'certain', ['call', 'call']]]);
    assert.deepEqual(r.impacted[1].path.map(p => p.split('::')[1].split('@')[0]), ['leaf', 'mid', 'top']);
    assert.equal(r.partial, false);
    assert.deepEqual(r.cuts, []);
    assert.equal(r.risk.level, 'low');
    assert.equal(r.risk.lower_bound, false);
    const three = await impactOf(dir, diff, ['--hops', '3']);
    assert.deepEqual(ids(three.impacted), ['mid', 'top', 'far']);
  }));

  it('a one-line change inside a method touches the method, not the class', () => tmp(async (dir) => {
    const cls = (n) => `export class Box {\n  size() {\n    return ${n};\n  }\n  fill() {\n    return 0;\n  }\n}\n`;
    const { diff } = await change(dir, { 'box.js': cls(1), 'use.js': "import { Box } from './box.js';\nexport function use() {\n  return new Box().size();\n}\n" }, { 'box.js': cls(2), 'use.js': "import { Box } from './box.js';\nexport function use() {\n  return new Box().size();\n}\n" });
    const r = await impactOf(dir, diff);
    assert.deepEqual(ids(r.touched), ['Box.size']);
    assert.deepEqual(r.module_level, []);
  }));

  it('a change outside every definition is a module-level change, listed and not followed', () => tmp(async (dir) => {
    const { diff } = await change(dir, { 'a.js': "const X = 1;\nexport function f() {\n  return X;\n}\n" }, { 'a.js': "const X = 2;\nexport function f() {\n  return X;\n}\n" });
    const r = await impactOf(dir, diff);
    assert.deepEqual(r.touched, []);
    assert.deepEqual(r.module_level, ['a.js']);
    assert.ok(r.notes.some(n => /module level/.test(n)));
  }));

  it('odd but legal file names (space, non-ASCII, quotes) run', () => tmp(async (dir) => {
    const name = 'src/my file "q" é.js';
    const { diff } = await change(dir, { [name]: 'export function f() {\n  return 1;\n}\n' }, { [name]: 'export function f() {\n  return 2;\n}\n' });
    const r = await impactOf(dir, diff);
    assert.deepEqual(r.touched.map(t => t.file), [name]);
  }));
});

describe('impact — ranking', () => {
  it('certain before possible, production before tests, nearer folders before distant ones', () => tmp(async (dir) => {
    const files = {
      'lib/core/target.js': 'export function target() {\n  return 1;\n}\n',
      'lib/core/near.js': "import { target } from './target.js';\nexport function near() {\n  return target();\n}\n",
      'lib/deep/er/far.js': "import { target } from '../../core/target.js';\nexport function far() {\n  return target();\n}\n",
      'lib/core/target.test.js': "import { target } from './target.js';\nexport function checkTarget() {\n  return target();\n}\n",
      'test/other.js': "import { target } from '../lib/core/target.js';\nexport function viaTests() {\n  return target();\n}\n",
      'lib/vague.js': 'export function vague(o) {\n  return o.target();\n}\n'
    };
    const { diff } = await change(dir, files, { ...files, 'lib/core/target.js': 'export function target() {\n  return 2;\n}\n' });
    const r = await impactOf(dir, diff, ['--hops', '1']);
    assert.deepEqual(ids(r.impacted), ['near', 'far', 'checkTarget', 'viaTests']);
    assert.deepEqual(r.impacted.map(i => i.test), [false, false, true, true]);
    assert.ok(r.impacted.every(i => i.confidence === 'certain'));
  }));

  it('a possible edge ranks after a certain one even when it is a production file', () => {
    const g = fakeGraph(['t'], { c1: ['t', 'possible'], c2: ['t', 'certain'] });
    const w = walk(g, [g.defs[0]]);
    assert.deepEqual(w.impacted.map(i => [i.qualified, i.confidence]), [['c2', 'certain'], ['c1', 'possible']]);
  });

  it('a path is as strong as its weakest edge', () => {
    const g = fakeGraph(['t', 'a', 'b'], { a: ['t', 'certain'], b: ['a', 'possible'] });
    const w = walk(g, [g.defs[0]]);
    assert.deepEqual(w.impacted.map(i => [i.qualified, i.hop, i.confidence]), [['a', 1, 'certain'], ['b', 2, 'possible']]);
  });
});

/** A hand-made graph: defs by name (all in f.js unless the name has a dir), edges name → [target, confidence]. */
function fakeGraph(base, callers, { kind = 'call', files = {} } = {}) {
  const names = [...new Set([...base, ...Object.keys(callers)])];
  const defs = names.map((n, k) => ({ id: `${files[n] || 'f.js'}::${n}@${k + 1}`, file: files[n] || 'f.js', name: n, qualified: n, kind: 'function', start: k + 1, end: k + 1, exported: true }));
  const id = (n) => defs.find(d => d.name === n).id;
  const edges = Object.entries(callers).map(([from, [to, confidence]]) => ({ from: id(from), to: id(to), kind, confidence }));
  return { files: [{ path: 'f.js' }], defs, edges, unresolved: [], partial: false, not_read: [], stats: {} };
}

describe('impact — an interface implemented many times', () => {
  const impls = (n) => Object.fromEntries(Array.from({ length: n }, (_, k) => [`impl${k}.ts`, `import { Shape } from './shape.js';\nexport class Impl${k} implements Shape {\n  area() {\n    return ${k};\n  }\n}\n`]));
  const shape = (extra) => `export interface Shape {\n  area(): number;${extra}\n}\n`;

  it('stays medium at most, however many implement it', () => tmp(async (dir) => {
    const { diff } = await change(dir, { 'shape.ts': shape(''), ...impls(30) }, { 'shape.ts': shape('\n  name(): string;'), ...impls(30) });
    const r = await impactOf(dir, diff, ['--json']);
    assert.deepEqual(ids(r.touched), ['Shape']);
    assert.equal(r.impacted.length, 30);
    assert.ok(r.impacted.every(i => i.via[0] === 'implements'));
    assert.equal(r.risk.level, 'medium');
    assert.ok(r.risk.score <= 1 + 8);
    assert.match(r.risk.reasons.join(' '), /counted up to 8/);
  }));

  it('past the hub limit it is not expanded and the cut says how many were left out', () => {
    const callers = Object.fromEntries(Array.from({ length: 60 }, (_, k) => [`i${k}`, ['t', 'certain']]));
    const g = fakeGraph(['t'], callers, { kind: 'implements' });
    const w = walk(g, [g.defs[0]], { maxHubFanIn: 50 });
    assert.deepEqual(w.impacted, []);
    assert.deepEqual(w.cuts, [{ at: g.defs[0].id, kind: 'hub_fan_in', omitted: 60 }]);
    assert.deepEqual(w.hubs, [{ id: g.defs[0].id, fan_in: 60 }]);
    const rk = risk({ touched: [g.defs[0]], impacted: w.impacted, hubs: w.hubs, cuts: w.cuts, partial: false });
    assert.equal(rk.level, 'medium');
    assert.equal(rk.lower_bound, true);
    assert.match(rk.reasons.join(' '), /lower bound/);
  });
});

describe('impact — hard limits are recorded with counts', () => {
  it('per-hop cap keeps the best-ranked and records the rest', () => {
    const callers = Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`c${k}`, ['t', k < 3 ? 'certain' : 'possible']]));
    const g = fakeGraph(['t'], callers);
    const w = walk(g, [g.defs[0]], { maxPerHop: 4 });
    assert.equal(w.impacted.length, 4);
    assert.deepEqual(w.impacted.slice(0, 3).map(i => i.confidence), ['certain', 'certain', 'certain']);
    assert.deepEqual(w.cuts, [{ at: 'hop 1', kind: 'per_hop', omitted: 6 }]);
  });
  it('the total cap stops the walk across hops', () => {
    const callers = { a: ['t', 'certain'], b: ['t', 'certain'], c: ['a', 'certain'], d: ['a', 'certain'], e: ['b', 'certain'] };
    const g = fakeGraph(['t'], callers);
    const w = walk(g, [g.defs[0]], { maxSymbols: 3 });
    assert.equal(w.impacted.length, 3);
    assert.deepEqual(w.cuts, [{ at: 'hop 2', kind: 'max_symbols', omitted: 2 }]);
  });
  it('refuses nonsense limits and hop counts', () => {
    const g = fakeGraph(['t'], {});
    assert.throws(() => walk(g, [g.defs[0]], { maxPerHop: 0 }), KitExit);
    assert.throws(() => walk(g, [g.defs[0]], { hops: 4 }), KitExit);
  });
  it('the text summary lists 25 and records the list cut; --json lists what the walk kept', () => tmp(async (dir) => {
    const before = { 'hub.js': 'export function hub() {\n  return 1;\n}\n' };
    const after = { 'hub.js': 'export function hub() {\n  return 2;\n}\n' };
    for (let k = 0; k < 30; k++) {
      const u = `import { hub } from './hub.js';\nexport function u${k}() {\n  return hub();\n}\n`;
      before[`u${k}.js`] = u; after[`u${k}.js`] = u;
    }
    const { diff } = await change(dir, before, after);
    const text = await impactOf(dir, diff);
    assert.equal(text.impacted.length, 25);
    assert.equal(text.impacted_total, 30);
    assert.deepEqual(text.cuts, [{ at: 'summary', kind: 'list_limit', omitted: 5 }]);
    const full = await impactOf(dir, diff, ['--json']);
    assert.equal(full.impacted.length, 30);
    assert.deepEqual(full.cuts, []);
  }));
});

describe('impact — removed definitions', () => {
  const util = (withOld) => `${withOld ? 'export function oldApi() {\n  return 1;\n}\n' : ''}export function keep() {\n  return 2;\n}\nexport function unusedOld() {\n  return 3;\n}\n`;
  const users = { 'main.js': "import { oldApi, keep } from './util.js';\nexport function main() {\n  return oldApi() + keep();\n}\n" };

  it('flags a removed function that something still calls; a removal nobody calls is not flagged', () => tmp(async (dir) => {
    const { diff, base } = await change(dir, { 'util.js': util(true), ...users }, { 'util.js': util(false).replace(/export function unusedOld\(\) \{\n {2}return 3;\n\}\n/, ''), ...users });
    const r = await impactOf(dir, diff, ['--base', base]);
    assert.deepEqual(r.removed.map(x => x.qualified).sort(), ['oldApi', 'unusedOld']);
    assert.deepEqual(r.removed_with_live_callers.map(x => x.symbol.qualified), ['oldApi']);
    assert.equal(r.removed_with_live_callers[0].callers[0].from.split('::')[0], 'main.js');
    assert.equal(r.risk.level, 'high');
    assert.match(r.risk.reasons.join(' '), /still called/);
    assert.ok(!r.notes.some(n => /no --base/.test(n)));
  }));

  it('a function that moved to another file is not a removal', () => tmp(async (dir) => {
    const { diff, base } = await change(dir, { 'util.js': util(true), ...users }, { 'util.js': util(false), 'moved.js': 'export function oldApi() {\n  return 1;\n}\n', 'main.js': "import { oldApi } from './moved.js';\nimport { keep } from './util.js';\nexport function main() {\n  return oldApi() + keep();\n}\n" });
    const r = await impactOf(dir, diff, ['--base', base]);
    assert.deepEqual(r.removed.map(x => x.qualified), ['oldApi'], 'it left util.js');
    assert.deepEqual(r.removed_with_live_callers, [], 'but nothing points at the old place any more');
  }));

  it('a deleted file removes its definitions; a live importer is flagged', () => tmp(async (dir) => {
    const { diff, base } = await change(dir, { 'util.js': util(true), ...users }, { 'util.js': null, ...users });
    const r = await impactOf(dir, diff, ['--base', base]);
    assert.ok(r.removed.every(x => x.file_deleted));
    assert.deepEqual(r.removed_with_live_callers.map(x => x.symbol.qualified).sort(), ['keep', 'oldApi']);
  }));

  it('without --base it says removals were not checked', () => tmp(async (dir) => {
    const { diff } = await change(dir, { 'util.js': util(true), ...users }, { 'util.js': util(false), ...users });
    const r = await impactOf(dir, diff);
    assert.deepEqual(r.removed, []);
    assert.ok(r.notes.some(n => /no --base/.test(n)));
  }));

  it('removedWithLiveCallers only counts calls that lost their target, and says when the search was cut short', () => {
    const removed = [{ file: 'a.js', name: 'gone', qualified: 'gone', kind: 'function' }];
    const g = { unresolved: [
      { from: 'b.js::x@1', call: 'gone', reason: 'unknown export' },
      { from: 'a.js::y@1', call: 'gone', reason: 'value call' },
      { from: 'c.js::z@1', call: 'gone', reason: 'value call' },
      { from: 'd.js::w@1', call: 'gone', reason: 'external module' }
    ], stats: { unresolved_total: 9000 } };
    const r = removedWithLiveCallers(g, removed);
    assert.deepEqual(r[0].callers.map(c => c.from), ['b.js::x@1', 'a.js::y@1']);
    assert.equal(r[0].search_partial, true);
  });
});

describe('impact — a partial graph is never reported as complete', () => {
  it('carries partial and not_read, lists unmapped changed files, and marks the risk as a lower bound', () => tmp(async (dir) => {
    const files = { 'a.js': 'export function a() {\n  return 1;\n}\n', 'tool.py': 'print(1)\n', 'broken.js': 'export function b() {\n  return 1;\n' };
    const { diff } = await change(dir, files, { ...files, 'broken.js': 'export function b() {\n  return 2;\n', 'a.js': 'export function a() {\n  return 2;\n}\n' });
    const r = await impactOf(dir, diff);
    assert.equal(r.partial, true);
    assert.deepEqual(r.not_read.map(x => [x.file, x.reason]).sort(), [['broken.js', 'parse_error'], ['tool.py', 'unsupported']]);
    assert.deepEqual(r.unmapped, [{ file: 'broken.js', reason: 'parse_error' }]);
    assert.equal(r.risk.lower_bound, true);
    assert.deepEqual(ids(r.touched), ['a']);
  }));

  it('an old-side file that cannot be scanned is listed and makes the answer partial', () => tmp(async (dir) => {
    const { diff, base } = await change(dir, { 'x.js': 'export function x() {\n  return `oops;\n}\n' }, { 'x.js': 'export function x() {\n  return 1;\n}\n' });
    const r = await impactOf(dir, diff, ['--base', base]);
    assert.deepEqual(r.old_not_read, [{ file: 'x.js', reason: 'parse_error' }]);
    assert.equal(r.partial, true);
  }));

  it('touchedSymbols reports a changed JS file the graph never read, and counts non-source files apart', () => {
    const g = { files: [], defs: [], not_read: [{ file: 'big.js', reason: 'too_large' }], edges: [], unresolved: [] };
    const t = touchedSymbols(g, [
      { path: 'big.js', oldPath: 'big.js', deleted: false, added: [[1, 1]], removed: [] },
      { path: 'README.md', oldPath: 'README.md', deleted: false, added: [[1, 1]], removed: [] }
    ]);
    assert.deepEqual(t.unmapped, [{ file: 'big.js', reason: 'too_large' }]);
    assert.deepEqual(t.not_source, ['README.md']);
  });
});

describe('impact — risk', () => {
  const sym = (n) => ({ id: `f::${n}` });
  const caller = (k, confidence = 'certain') => ({ hop: 1, confidence, id: `c${k}` });
  it('grows with touched symbols, direct callers and removed public names, with caps', () => {
    assert.equal(risk({ touched: [sym(1)], impacted: [caller(1)] }).level, 'low');
    assert.equal(risk({ touched: [sym(1)], impacted: [1, 2, 3, 4, 5].map(k => caller(k)) }).level, 'medium');
    const many = { touched: [1, 2, 3, 4, 5, 6, 7, 8].map(sym), impacted: Array.from({ length: 40 }, (_, k) => caller(k)), removed: [{ exported: true }, { exported: true }, { exported: true }] };
    const r = risk(many);
    assert.equal(r.level, 'high');
    assert.equal(r.score, 5 + 8 + 6, 'each input is capped');
  });
  it('possible edges count half', () => {
    assert.equal(risk({ touched: [sym(1)], impacted: [1, 2, 3, 4].map(k => caller(k, 'possible')) }).score, 1 + 2);
  });
});

describe('impact — the verb', () => {
  const diff = ['diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js', '@@ -1 +1 @@', '-1', '+2', ''].join('\n');
  it('is discovered by the kit CLI', async () => {
    const verbs = await loadVerbs();
    assert.equal(verbs.get('impact').file, 'impact.js');
    assert.equal(impact.verb, 'impact');
  });
  it('short errors that point at --help', async () => {
    const bad = async (args, io, re) => {
      await assert.rejects(run(args, { cwd: os.tmpdir(), stdin: async () => diff, ...io }), (e) => e instanceof KitExit && e.code === 1 && re.test(e.message) && e.message.length < 140 && /--help/.test(e.message));
    };
    await bad([], {}, /--diff/);
    await bad(['--diff'], {}, /needs a value/);
    await bad(['--bogus'], {}, /unknown flag/);
    await bad(['--diff', '-', '--hops', '0'], {}, /--hops/);
    await bad(['--diff', '-', '--hops', '4'], {}, /--hops/);
    await bad(['--diff', '-', '--hops', 'x'], {}, /--hops/);
    await bad(['--diff', '-', '--base', '--evil'], {}, /--base/);
    await bad(['--diff', '-', 'extra'], {}, /unexpected argument/);
  });
  it('--diff - refuses a terminal, an empty diff and text that is not a diff', async () => {
    await assert.rejects(run(['--diff', '-'], { stdinIsTTY: true, stdin: async () => diff }), /terminal/);
    await assert.rejects(run(['--diff', '-'], { stdin: async () => '' }), /names no files/);
    await assert.rejects(run(['--diff', '-'], { stdin: async () => 'hello' }), /not a unified diff/);
  });
  it('an unknown --base is refused, not guessed at', () => tmp(async (dir) => {
    const { diff: d } = await change(dir, { 'x.js': 'export function x() {\n  return 1;\n}\n' }, { 'x.js': 'export function x() {\n  return 2;\n}\n' });
    await assert.rejects(impactOf(dir, d, ['--base', 'no-such-ref']), (e) => e instanceof KitExit && e.code === 1 && /not a commit or tree/.test(e.message));
  }));
  it('--help returns the usage', async () => assert.match((await run(['--help'], {})).usage, /impact/));
});

describe('impact — the /w-review caller', () => {
  const step = () => {
    const c = getCommands()['w-review'].content;
    const a = c.indexOf('SYMBOL GRAPH');
    const b = c.indexOf('**REQUIRED OUTPUT:**', a);
    return c.slice(a, b);
  };
  it('has a blast-radius step that runs impact on the reviewed range with its base, copy-pasteable', () => {
    const s = step();
    assert.match(s, /BLAST RADIUS/);
    assert.match(s, /node \.claude\/helpers\/kit\/cli\.js impact --diff "\$D" --base "\$BASE"; RC=\$\?; rm -f "\$D"; \(exit \$RC\)/);
    const blocks = s.split('```').filter((_, k) => k % 2 === 1);
    assert.equal(blocks.length, 2, 'the graph block and the impact block');
    assert.ok(blocks.every(b => !/<[a-z-]+>|\w\|\w/.test(b)));
    assert.ok(!s.includes('\\`'));
    for (const word of ['`cuts`', '`partial`', '`not_read`', '`removed_with_live_callers`', 'risk.lower_bound']) assert.ok(s.includes(word), word);
  });
});
