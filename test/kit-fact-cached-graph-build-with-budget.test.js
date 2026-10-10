import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as graph from '../src/lib/kit/graph.js';
import { loadVerbs } from '../src/lib/kit/cli.js';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const { extractFacts, buildGraph, EXTRACTOR_VERSION } = graph;

async function tmp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-graph-'));
  try { return await fn(await fs.realpath(dir)); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
async function put(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), text);
  }
}
const repo = async (dir, files) => {
  await put(dir, files);
  spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
};
/** A clock that advances `step` ms every time it is read. */
const ticking = (step) => { let t = 0; return () => { t += step; return t; }; };
const names = (rows) => rows.map(r => r.name);
const edge = (g, from, to) => g.edges.find(e => e.from.includes(from) && e.to.includes(to));

describe('graph — extractFacts: text that must not invent symbols', () => {
  it('strings, comments, template text and regex literals yield no defs and no calls', () => {
    const src = [
      "const a = 'function ghost() { fake(); }';",
      'const b = "class Phantom { run() {} }";',
      '// function lineComment() { nope(); }',
      '/* function blockComment() { nope(); } */',
      'const c = `function tpl() { nope(); } ${1 + 1} class T {}`;',
      'const d = /function re\\(\\) { nope\\(\\) }/g;',
      'const e = /[/]nope\\(\\)/;',
      'const f = 4 / 2 / 1;'
    ].join('\n');
    const f = extractFacts(src, { path: 'a.js' });
    assert.deepEqual(names(f.defs), []);
    assert.deepEqual(f.calls, []);
  });

  it('calls inside ${} of a template are found, including nested templates', () => {
    const f = extractFacts('const s = `a ${outer(`b ${inner(1)} c`)} d`;', { path: 'a.js' });
    assert.deepEqual(names(f.calls).sort(), ['inner', 'outer']);
    assert.deepEqual(f.defs, []);
  });

  it('a slash after a value is division, after an operator or return it is a regex', () => {
    const f = extractFacts('function g(a, b) { const x = a / b; const y = a(1) / b(2); return /x(y)/.test(x); }', { path: 'a.js' });
    assert.deepEqual(names(f.calls).sort(), ['a', 'b', 'test']);
  });

  it('text that cannot be scanned to its end is unread, never guessed at', () => {
    for (const src of ["const a = 'oops;\n", 'const a = `open ${1', '/* never closed', 'function f( {', 'function f() { ] }', 'if (x) { y(']) {
      const f = extractFacts(src, { path: 'a.js' });
      assert.equal(f.unread, 'parse_error', JSON.stringify(src));
      assert.ok(f.detail);
      assert.equal(f.defs, undefined);
    }
  });

  it('a file type it does not read is unsupported', () => {
    assert.equal(extractFacts('def f(): pass', { path: 'a.py' }).unread, 'unsupported');
    assert.equal(extractFacts('x', { path: 'Makefile' }).unread, 'unsupported');
  });

  it('a file that takes too long is cut by the per-file check', () => {
    const f = extractFacts('const a = 1;\n'.repeat(5000), { path: 'a.js', clock: ticking(10), maxMs: 50 });
    assert.equal(f.unread, 'budget');
  });
});

describe('graph — extractFacts: definitions', () => {
  const f = extractFacts([
    "import { base as b2 } from './base.js';",
    'export function top(a) {',
    '  function inner() { return 1; }',
    '  return inner();',
    '}',
    'export class Dog extends Animal implements Pet, Named {',
    '  static make() { return new Dog(); }',
    '  async bark(n) {',
    '    this.speak(n);',
    '  }',
    '  handler = (e) => this.bark(e);',
    '  get name() { return this._n; }',
    '}',
    'const arrow = async (x) => {',
    '  return x;',
    '};',
    'const expr = x => x + 1;',
    'const vf = function named() { return 2; };',
    'exports.legacy = function () { return 3; };',
    'module.exports.other = () => 4;'
  ].join('\n'), { path: 'a.js' });
  const get = (n) => f.defs.find(d => d.name === n);

  it('records kind, line span, parent and exported', () => {
    assert.deepEqual([get('top').kind, get('top').start, get('top').end, get('top').exported], ['function', 2, 5, true]);
    assert.deepEqual([get('inner').kind, get('inner').parent, get('inner').start, get('inner').end], ['function', 'top', 3, 3]);
    assert.deepEqual([get('Dog').kind, get('Dog').start, get('Dog').end, get('Dog').extends, get('Dog').implements], ['class', 6, 13, 'Animal', ['Pet', 'Named']]);
    assert.deepEqual([get('make').kind, get('make').parent], ['method', 'Dog']);
    assert.deepEqual([get('bark').kind, get('bark').start, get('bark').end], ['method', 8, 10]);
    assert.equal(get('handler').kind, 'method'); // a class property function
    assert.equal(get('name').kind, 'method');
    assert.deepEqual([get('arrow').kind, get('arrow').start, get('arrow').end, get('arrow').exported], ['arrow', 14, 16, false]);
    assert.deepEqual([get('expr').kind, get('expr').start, get('expr').end], ['arrow', 17, 17]);
    assert.equal(get('vf').kind, 'var-fn');
    assert.deepEqual([get('legacy').kind, get('legacy').exported], ['var-fn', true]);
    assert.deepEqual([get('other').kind, get('other').exported], ['arrow', true]);
  });

  it('records interfaces and ignores method signatures inside them and type aliases', () => {
    const t = extractFacts([
      'export interface Pet extends Named, Fed<string> {',
      '  feed(food: string): void;',
      '  nested: { poke(): void };',
      '}',
      'type Handler = {',
      '  call(x: number): string;',
      '};',
      'type Fn = (a: string) => void',
      'enum Color { Red = 1, Green }',
      'class Svc {',
      '  private cache: Map<string, number> = new Map();',
      '  constructor(private readonly dep: Dep) { dep.init(); }',
      '  async load<T>(id: string): Promise<{ a: T }> { return fetch(id); }',
      '  abstract run(): void;',
      '}',
      'const typed: (a: number) => string = (a) => String(a);',
      'export const gen = <T,>(x: T): T => x;'
    ].join('\n'), { path: 'a.ts' });
    const d = (n) => t.defs.find(x => x.name === n);
    assert.deepEqual([d('Pet').kind, d('Pet').extends, d('Pet').start, d('Pet').end], ['interface', ['Named', 'Fed'], 1, 4]);
    assert.deepEqual(names(t.defs).sort(), ['Pet', 'Svc', 'constructor', 'gen', 'load', 'typed'].sort());
    assert.ok(!names(t.calls).includes('feed') && !names(t.calls).includes('poke') && !names(t.calls).includes('call'));
    assert.deepEqual(names(t.calls).sort(), ['String', 'Map', 'init', 'fetch'].sort());
    assert.equal(d('typed').kind, 'arrow');
    assert.equal(d('gen').kind, 'arrow');
  });

  it('interface and type syntax is not treated as TypeScript in a .js file', () => {
    const j = extractFacts('const type = 1; function interface_(x) { return type(x); }', { path: 'a.js' });
    assert.deepEqual(names(j.defs), ['interface_']);
    assert.deepEqual(names(j.calls), ['type']);
  });
});

describe('graph — extractFacts: calls, imports and exports', () => {
  it('classifies direct, member, computed and value calls and skips control keywords and object methods', () => {
    const f = extractFacts([
      'if (ok) { run(); }',
      'while (x(1)) y.z();',
      'const o = { method(a) { return a; }, other: () => q() };',
      'obj[key](1);',
      'make()(2);',
      '(function () { iife(); })();',
      'cb?.(3);',
      'new Thing(4);',
      'a.b.c(5);',
      'this.me(6);',
      'if (a) (b);'
    ].join('\n'), { path: 'a.js' });
    const by = (name) => f.calls.filter(c => c.name === name);
    assert.deepEqual(by('run')[0], { name: 'run', receiver: null, kind: 'direct', line: 1, owner: -1 });
    assert.equal(by('z')[0].kind, 'member');
    assert.equal(by('z')[0].receiver, 'y');
    assert.equal(by('c')[0].receiver, null, 'a.b.c: the receiver is not a plain identifier');
    assert.equal(by('me')[0].receiver, 'this');
    assert.equal(by('Thing')[0].kind, 'direct');
    assert.ok(!by('method').length && by('q').length);
    assert.equal(f.calls.filter(c => c.kind === 'computed').length, 1);
    assert.equal(f.calls.find(c => c.kind === 'computed').receiver, 'obj');
    assert.ok(f.calls.filter(c => c.kind === 'value').length >= 3); // make()(2), (function(){})(), cb?.()
    assert.ok(!by('if').length && !by('while').length && !by('b').length);
  });

  it('records every import form', () => {
    const f = extractFacts([
      "import def, { a, b as c, type T } from './m.js';",
      "import * as ns from 'ext';",
      "import './side.js';",
      "import type { Only } from './types.ts';",
      "const fs = require('fs');",
      "const { x, y: z } = require('./cjs');",
      "const part = require('./p').part;",
      "require('./bare');",
      "const lazy = () => import('./lazy.js');",
      'const dyn = require(name);'
    ].join('\n'), { path: 'a.ts' });
    const bySrc = (s) => f.imports.filter(i => i.source === s);
    assert.deepEqual(bySrc('./m.js')[0].names, [{ imported: 'default', local: 'def' }, { imported: 'a', local: 'a' }, { imported: 'b', local: 'c' }, { imported: 'T', local: 'T' }]);
    assert.deepEqual(bySrc('ext')[0].names, [{ imported: '*', local: 'ns' }]);
    assert.deepEqual(bySrc('./side.js')[0].names, []);
    assert.deepEqual(bySrc('./types.ts')[0].names, [{ imported: 'Only', local: 'Only' }]);
    assert.deepEqual([bySrc('fs')[0].kind, bySrc('fs')[0].names], ['require', [{ imported: '*', local: 'fs' }]]);
    assert.deepEqual(bySrc('./cjs')[0].names, [{ imported: 'x', local: 'x' }, { imported: 'y', local: 'z' }]);
    assert.deepEqual(bySrc('./p')[0].names, [{ imported: 'part', local: 'part' }]);
    assert.equal(bySrc('./bare')[0].kind, 'require');
    assert.equal(bySrc('./lazy.js')[0].kind, 'dynamic');
    assert.ok(f.imports.some(i => i.source === null && i.kind === 'dynamic'), 'a non-literal require is recorded as dynamic with no source');
    assert.ok(!f.calls.some(c => c.name === 'require' || c.name === 'import'));
  });

  it('records every export form', () => {
    const f = extractFacts([
      'export function one() {}',
      'export const two = 2;',
      'export default class Three {}',
      'function four() {}',
      'export { four, four as five };',
      "export { six } from './s.js';",
      "export * from './all.js';",
      "export * as nsx from './n.js';",
      'module.exports = { four, seven: four, eight() {} };'
    ].join('\n'), { path: 'a.js' });
    const has = (name, local, source) => f.exports.some(e => e.name === name && e.local === local && e.source === source);
    assert.ok(has('one', 'one') && has('two', 'two') && has('default', 'Three') && has('four', 'four') && has('five', 'four'));
    assert.ok(has('six', 'six', './s.js') && has('*', null, './all.js') && has('nsx', '*', './n.js'));
    assert.ok(has('seven', 'four') && has('eight', null));
    assert.equal(f.defs.find(d => d.name === 'four').exported, true);
  });
});

describe('graph — buildGraph: cache', () => {
  const files = {
    'src/a.js': "import { b } from './b.js';\nexport function a() { return b(); }\n",
    'src/b.js': 'export function b() { return 1; }\n'
  };
  it('an unchanged file is never parsed again; a changed one is parsed once', () => tmp(async dir => {
    await put(dir, files);
    const parsed = [];
    const opts = { files: Object.keys(files), onParse: p => parsed.push(p) };
    const g1 = await buildGraph(dir, opts);
    assert.deepEqual(parsed.sort(), ['src/a.js', 'src/b.js']);
    assert.equal(g1.stats.parsed, 2);
    assert.equal(g1.stats.cache_writes, 2);
    parsed.length = 0;
    const g2 = await buildGraph(dir, opts);
    assert.deepEqual(parsed, [], 'second run parses nothing');
    assert.equal(g2.stats.cache_hits, 2);
    assert.deepEqual(g2.edges, g1.edges);
    assert.ok(g2.files.every(f => f.source === 'cache'));
    await fs.writeFile(path.join(dir, 'src/b.js'), 'export function b() { return 2; }\nexport function extra() {}\n');
    await buildGraph(dir, opts);
    assert.deepEqual(parsed, ['src/b.js']);
    const cached = await fs.readdir(path.join(dir, '.claude/kit/cache/graph'));
    assert.equal(cached.length, 3);
  }));

  it('the cache key includes the extractor version', () => tmp(async dir => {
    await put(dir, files);
    const bytes = Buffer.from(files['src/b.js']);
    const key = graph.cacheKey('.js', bytes);
    assert.notEqual(key, graph.cacheKey('.ts', bytes), 'language class is part of the key');
    await buildGraph(dir, { files: Object.keys(files) });
    const file = path.join(dir, '.claude/kit/cache/graph', `${key}.json`);
    const entry = JSON.parse(await fs.readFile(file, 'utf-8'));
    assert.equal(entry.v, EXTRACTOR_VERSION);
    // an entry written by another extractor version is not trusted: it is parsed again
    entry.v = 'graph-facts-0';
    entry.facts = { defs: [], calls: [], imports: [], exports: [] };
    await fs.writeFile(file, JSON.stringify(entry));
    const parsed = [];
    const g = await buildGraph(dir, { files: Object.keys(files), onParse: p => parsed.push(p) });
    assert.deepEqual(parsed, ['src/b.js']);
    assert.equal(g.defs.filter(d => d.file === 'src/b.js').length, 1);
  }));

  it('corrupt, truncated or wrong-shaped cache files are misses and are rewritten', () => tmp(async dir => {
    await put(dir, files);
    await buildGraph(dir, { files: Object.keys(files) });
    const cdir = path.join(dir, '.claude/kit/cache/graph');
    const [one, two] = await fs.readdir(cdir);
    await fs.writeFile(path.join(cdir, one), '{"v": "graph-facts-1", "key": "x", "facts": ');
    const entry = JSON.parse(await fs.readFile(path.join(cdir, two), 'utf-8'));
    entry.facts.defs = [{ name: 42 }];
    await fs.writeFile(path.join(cdir, two), JSON.stringify(entry));
    const parsed = [];
    const g = await buildGraph(dir, { files: Object.keys(files), onParse: p => parsed.push(p) });
    assert.equal(parsed.length, 2);
    assert.equal(g.defs.length, 2);
    for (const f of await fs.readdir(cdir)) JSON.parse(await fs.readFile(path.join(cdir, f), 'utf-8'));
    assert.deepEqual((await fs.readdir(cdir)).filter(f => f.endsWith('.tmp')), []);
  }));

  it('a cache folder that is a symlink is refused: the build goes on uncached and says so', () => tmp(async dir => {
    await put(dir, files);
    const elsewhere = path.join(dir, 'elsewhere');
    await fs.mkdir(elsewhere);
    await fs.mkdir(path.join(dir, '.claude/kit/cache'), { recursive: true });
    await fs.symlink(elsewhere, path.join(dir, '.claude/kit/cache/graph'));
    const g = await buildGraph(dir, { files: Object.keys(files) });
    assert.equal(g.defs.length, 2);
    assert.match(g.stats.cache_error, /link/);
    assert.equal(g.stats.cache_writes, 0);
    assert.deepEqual(await fs.readdir(elsewhere), [], 'nothing was written through the link');
  }));

  it('a parse failure is cached too, so a pathological file is not scanned again', () => tmp(async dir => {
    await put(dir, { 'bad.js': "const a = 'oops\n" });
    const parsed = [];
    const o = { files: ['bad.js'], onParse: p => parsed.push(p) };
    const g1 = await buildGraph(dir, o);
    const g2 = await buildGraph(dir, o);
    assert.deepEqual(parsed, ['bad.js']);
    assert.deepEqual(g2.not_read, g1.not_read);
    assert.equal(g2.not_read[0].reason, 'parse_error');
  }));
});

describe('graph — buildGraph: budget, caps and honesty', () => {
  const many = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.js`, `export function fn${i}() { return ${i}; }\n`]));

  it('a budget cut lists what was not read, keeps the changed files, and is partial', () => tmp(async dir => {
    await put(dir, many);
    // the clock moves 10 ms per reading; the build starts at its first reading, so ~3 files fit in 35 ms
    const g = await buildGraph(dir, { files: Object.keys(many), changed: ['f5.js', 'f4.js'], budgetMs: 35, clock: ticking(10), cache: false });
    const read = g.files.map(f => f.path);
    assert.deepEqual(read.slice(0, 2), ['f5.js', 'f4.js'], 'changed files come first');
    assert.ok(read.includes('f5.js') && read.includes('f4.js'));
    assert.equal(g.partial, true);
    const cut = g.not_read.filter(r => r.reason === 'budget').map(r => r.file);
    assert.ok(cut.length >= 1 && cut.length < 6);
    assert.equal(read.length + cut.length, 6);
    assert.ok(cut.every(f => !['f4.js', 'f5.js'].includes(f)));
    assert.equal(g.stats.not_read_total, cut.length);
  }));

  it('a parse cap stops scanning but still uses cached files, and says parse_cap', () => tmp(async dir => {
    await put(dir, many);
    await buildGraph(dir, { files: ['f0.js', 'f1.js'] });
    const g = await buildGraph(dir, { files: Object.keys(many), maxParses: 2 });
    assert.equal(g.stats.cache_hits, 2);
    assert.equal(g.stats.parsed, 2);
    assert.deepEqual(g.not_read.map(r => r.reason), ['parse_cap', 'parse_cap']);
    assert.equal(g.partial, true);
    assert.equal(g.files.length, 4);
  }));

  it('a complete JS-only build is not partial', () => tmp(async dir => {
    await put(dir, many);
    const g = await buildGraph(dir, { files: Object.keys(many) });
    assert.equal(g.partial, false);
    assert.deepEqual(g.not_read, []);
  }));

  it('too large, other-language, link and binary files are listed with a reason; a missing file is skipped', () => tmp(async dir => {
    await put(dir, { 'big.js': `const x = ${'1,'.repeat(300)}0;\n`, 'tool.py': 'print(1)\n', 'ok.js': 'export const ok = () => 1;\n', 'bin.js': 'a\0b', 'README.md': '# hi\n', 'real.js': 'export function real() {}\n' });
    await fs.symlink(path.join(dir, 'real.js'), path.join(dir, 'link.js'));
    const g = await buildGraph(dir, { files: ['big.js', 'tool.py', 'ok.js', 'bin.js', 'README.md', 'link.js', 'gone.js'], maxFileBytes: 200 });
    const why = Object.fromEntries(g.not_read.map(r => [r.file, r.reason]));
    assert.deepEqual(why, { 'big.js': 'too_large', 'tool.py': 'unsupported', 'bin.js': 'parse_error', 'link.js': 'unsupported' });
    assert.deepEqual(g.files.map(f => f.path), ['ok.js']);
    assert.equal(g.stats.missing, 1);
    assert.equal(g.stats.ignored, 1);
    assert.equal(g.partial, true);
  }));

  it('a pathological file is cut by the per-file time check, not the whole build', () => tmp(async dir => {
    await put(dir, { 'slow.js': 'const a = 1;\n'.repeat(4000), 'fast.js': 'export const f = () => 1;\n' });
    const g = await buildGraph(dir, { files: ['slow.js', 'fast.js'], maxFileMs: 20, clock: ticking(1), budgetMs: 1e9, cache: false });
    assert.deepEqual(g.not_read.map(r => [r.file, r.reason]), [['slow.js', 'budget']]);
    assert.deepEqual(g.files.map(f => f.path), ['fast.js']);
  }));

  it('refuses paths that leave the repository and bad numbers', () => tmp(async dir => {
    await assert.rejects(buildGraph(dir, { files: ['../x.js'] }), e => e instanceof KitExit && e.code === 1);
    await assert.rejects(buildGraph(dir, { files: ['a.js'], changed: ['/etc/x.js'] }), KitExit);
    await assert.rejects(buildGraph(dir, { files: [], budgetMs: 0 }), KitExit);
    await assert.rejects(buildGraph('relative/dir', { files: [] }), KitExit);
  }));

  it('lists the files from git (tracked and untracked, not ignored)', () => tmp(async dir => {
    await repo(dir, { 'a.js': 'export function a() {}\n', '.gitignore': 'skip.js\n' });
    await put(dir, { 'new.js': 'export function n() {}\n', 'skip.js': 'export function s() {}\n' });
    const g = await buildGraph(dir, { changed: ['new.js'] });
    assert.deepEqual(g.files.map(f => f.path).sort(), ['a.js', 'new.js']);
  }));
});

describe('graph — buildGraph: resolution', () => {
  const build = (dir, files, extra = {}) => put(dir, files).then(() => buildGraph(dir, { files: Object.keys(files), ...extra }));

  it('links same-file calls, relative imports with extension and index resolution, and re-exports', () => tmp(async dir => {
    const g = await build(dir, {
      'src/main.js': "import { util } from './lib/util';\nimport { deep } from './lib';\nimport run from './run.js';\nfunction local() {}\nexport function main() { local(); util(); deep(); run(); }\n",
      'src/lib/util.js': 'export function util() {}\n',
      'src/lib/index.js': "export { deep } from './deep.js';\n",
      'src/lib/deep.js': 'export function deep() {}\n',
      'src/run.ts': 'export default function run() {}\n'
    });
    for (const to of ['main.js::local', 'util.js::util', 'deep.js::deep', 'run.ts::run']) {
      assert.equal(edge(g, 'main.js::main', to)?.confidence, 'certain', to);
    }
    assert.deepEqual(g.unresolved, []);
  }));

  it('a name that fits several definitions is possible, never certain', () => tmp(async dir => {
    const g = await build(dir, {
      'a.js': 'function dup() {}\nfunction caller() { dup(); }\nfunction dup() {}\n',
      'b.js': 'export class P { save() {} }\n',
      'c.js': 'export class Q { save() {} }\n',
      'd.js': 'export function use(obj) { obj.save(); }\n'
    });
    const dups = g.edges.filter(e => e.from.includes('caller'));
    assert.equal(dups.length, 2);
    assert.ok(dups.every(e => e.confidence === 'possible'));
    const saves = g.edges.filter(e => e.from.includes('use@'));
    assert.equal(saves.length, 2);
    assert.ok(saves.every(e => e.confidence === 'possible'), 'a call on an object of unknown type');
    assert.ok(!g.edges.some(e => e.confidence === 'certain' && e.from.includes('use@')));
  }));

  it('this. calls, inheritance across files, super and static members', () => tmp(async dir => {
    const g = await build(dir, {
      'base.js': 'export class Base { hello() {} greet() { this.hello(); } static make() {} }\n',
      'child.js': "import { Base } from './base.js';\nexport class Child extends Base {\n  own() {}\n  go() { this.own(); this.hello(); super.greet(); Base.make(); Child.zap(); }\n}\n"
    });
    assert.equal(edge(g, 'base.js::Base.greet', 'Base.hello')?.confidence, 'certain');
    assert.equal(edge(g, 'child.js::Child.go', 'Child.own')?.confidence, 'certain');
    assert.equal(edge(g, 'child.js::Child.go', 'Base.hello')?.confidence, 'likely');
    assert.equal(edge(g, 'child.js::Child.go', 'Base.greet')?.confidence, 'likely');
    assert.equal(edge(g, 'child.js::Child.go', 'Base.make')?.confidence, 'certain');
    assert.equal(edge(g, 'child.js::Child@', 'base.js::Base@')?.kind, 'extends');
    assert.ok(g.unresolved.some(u => u.call === 'Child.zap' && u.reason === 'dynamic member'));
  }));

  it('namespace and require imports; implements and interface edges', () => tmp(async dir => {
    const g = await build(dir, {
      'lib.js': 'module.exports = { alpha, beta: alpha };\nfunction alpha() {}\n',
      'ts.ts': 'export interface Shape { area(): number }\nexport class Sq implements Shape { area() { return 1; } }\n',
      'use.ts': "import * as shapes from './ts';\nimport { Sq } from './ts';\nconst lib = require('./lib');\nexport function f() { lib.alpha(); shapes.Sq; new Sq(); }\n"
    });
    assert.equal(edge(g, 'use.ts::f', 'lib.js::alpha')?.confidence, 'certain');
    assert.equal(edge(g, 'use.ts::f', 'ts.ts::Sq@')?.confidence, 'certain');
    const impl = g.edges.find(e => e.kind === 'implements');
    assert.ok(impl.from.includes('Sq') && impl.to.includes('Shape') && impl.confidence === 'certain');
  }));

  it('records unresolved calls with a reason', () => tmp(async dir => {
    const g = await build(dir, {
      'a.js': "import ext from 'lodash';\nimport { gone } from './missing.js';\nimport { x } from './nope.py';\nimport { y } from './b.js';\nexport function a(cb, obj, key) {\n  ext();\n  gone();\n  y();\n  cb();\n  obj[key]();\n  cb()();\n  console.log(1);\n  obj.thing();\n}\n",
      'b.js': 'export const z = 1;\n'
    });
    const why = (call) => g.unresolved.find(u => u.call === call)?.reason;
    assert.equal(why('ext'), 'external module');
    assert.equal(why('gone'), 'unread target');
    assert.equal(why('y'), 'unknown export');
    assert.equal(why('cb'), 'value call');
    assert.equal(why('obj.[]') ?? g.unresolved.find(u => u.reason === 'computed')?.reason, 'computed');
    assert.ok(g.unresolved.some(u => u.reason === 'value call' && u.call === '()'));
    assert.equal(why('console.log'), 'external module');
    assert.equal(why('obj.thing'), 'dynamic member');
  }));

  it('an import of a file that was cut is unread target, not silently dropped', () => tmp(async dir => {
    const files = { 'a.js': "import { b } from './b.js';\nexport function a() { b(); }\n", 'b.js': 'export function b() {}\n' };
    await put(dir, files);
    const g = await buildGraph(dir, { files: ['a.js', 'b.js'], maxParses: 1, cache: false });
    assert.equal(g.partial, true);
    assert.deepEqual(g.unresolved.map(u => [u.call, u.reason]), [['b', 'unread target']]);
  }));

  it('nested definitions: the innermost visible one wins and methods are not callable by bare name', () => tmp(async dir => {
    const g = await build(dir, {
      'a.js': 'function helper() {}\nfunction outer() {\n  function helper() {}\n  helper();\n}\nclass K { helper() {} run() { helper(); } }\n'
    });
    const calls = g.edges.filter(e => e.kind === 'call');
    assert.equal(calls.find(e => e.from.includes('outer'))?.to.includes('outer.helper'), true);
    assert.equal(calls.find(e => e.from.includes('K.run'))?.to, 'a.js::helper@1');
    assert.ok(calls.every(e => e.confidence === 'certain'));
  }));
});

describe('graph — verb and CLI', () => {
  const io = (dir, extra = {}) => ({ cwd: dir, stdin: async () => '', stdinIsTTY: false, env: process.env, ...extra });

  it('is discovered as the graph verb', async () => {
    const verbs = await loadVerbs();
    assert.ok(verbs.has('graph'));
    assert.match(graph.usage, /--budget-ms/);
  });

  it('prints a summary, and the full graph with --json', () => tmp(async dir => {
    await repo(dir, { 'a.js': "import { b } from './b.js';\nexport function a() { b(); }\n", 'b.js': 'export function b() {}\n', 'x.go': 'package x\n' });
    const s = await graph.run(['--dir', dir], io(dir));
    assert.equal(s.partial, true);
    assert.deepEqual(s.counts, { files: 2, defs: 2, edges: 1, unresolved: 0, not_read: 1 });
    assert.deepEqual(s.edges_by_confidence, { certain: 1 });
    assert.deepEqual(s.not_read, [{ file: 'x.go', reason: 'unsupported', detail: '.go files are not read' }]);
    assert.equal(s.defs, undefined);
    const full = await graph.run(['--dir', dir, '--json'], io(dir));
    assert.equal(full.defs.length, 2);
    assert.equal(full.edges.length, 1);
  }));

  it('finds the repository from a subfolder, not from the cwd', () => tmp(async dir => {
    await repo(dir, { 'pkg/a.js': 'export function a() {}\n' });
    const s = await graph.run([], io(path.join(dir, 'pkg')));
    assert.equal(s.root, dir);
    assert.equal(s.counts.files, 1);
  }));

  it('--changed and --diff put those files first and report how many were read', () => tmp(async dir => {
    await repo(dir, { 'a.js': 'export function a() {}\n', 'b.js': 'export function b() {}\n', 'c.js': 'export function c() {}\n' });
    const diff = ['diff --git a/c.js b/c.js', '--- a/c.js', '+++ b/c.js', '@@ -1 +1 @@', '-x', '+y', 'diff --git a/gone.js b/gone.js', '--- a/gone.js', '+++ /dev/null', ''].join('\n');
    await fs.writeFile(path.join(dir, 'd.diff'), diff);
    const seen = [];
    const s = await graph.run(['--changed', 'b.js', '--diff', 'd.diff', '--max-parses', '2'], io(dir, { onParse: p => seen.push(p) }));
    assert.deepEqual(seen, ['b.js', 'c.js'], 'changed files are the ones scanned when the cap bites');
    assert.deepEqual(s.changed, { requested: 2, read: 2 });
    assert.deepEqual(s.not_read, [{ file: 'a.js', reason: 'parse_cap', detail: 'more than 2 files to scan' }]);
    const piped = await graph.run(['--diff', '-'], io(dir, { stdin: async () => diff.replace(/b\/c\.js/, 'c.js') }));
    assert.equal(piped.changed.requested, 1);
  }));

  it('a diff with b/ prefixes maps back to repository paths', () => tmp(async dir => {
    await repo(dir, { 'src/a.js': 'export function a() {}\n' });
    const s = await graph.run(['--diff', '-'], io(dir, { stdin: async () => '--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-1\n+2\n' }));
    assert.deepEqual(s.changed, { requested: 1, read: 1 });
  }));

  it('refuses a terminal on --diff -, unknown flags, bad numbers and a non-diff', () => tmp(async dir => {
    await repo(dir, { 'a.js': 'export function a() {}\n' });
    await assert.rejects(graph.run(['--diff', '-'], io(dir, { stdinIsTTY: true })), e => e instanceof KitExit && e.code === 1 && /terminal/.test(e.message));
    await assert.rejects(graph.run(['--bogus'], io(dir)), e => e instanceof KitExit && e.code === 1 && /unknown flag --bogus.*--help/.test(e.message) && !e.message.includes('cli.js graph'));
    await assert.rejects(graph.run(['stray'], io(dir)), /unexpected argument stray/);
    await assert.rejects(graph.run(['--budget-ms', '0'], io(dir)), /positive whole number/);
    await assert.rejects(graph.run(['--budget-ms'], io(dir)), /needs a value/);
    await assert.rejects(graph.run(['--changed'], io(dir)), /at least one file/);
    await assert.rejects(graph.run(['--diff', '-'], io(dir, { stdin: async () => 'hello world' })), /not a unified diff/);
    await assert.rejects(graph.run(['--diff', path.join(dir, 'nope.diff')], io(dir)), KitExit);
    assert.deepEqual(Object.keys(await graph.run(['--help'], io(dir))), ['usage']);
  }));

  it('reports git itself failing as that, and a folder that is not a repository as that', () => tmp(async dir => {
    await assert.rejects(graph.run([], io(dir)), e => e instanceof KitExit && /not a readable git repository/.test(e.message) && !/cannot run git/.test(e.message));
    await repo(dir, { 'a.js': 'export function a() {}\n' });
    await assert.rejects(graph.run([], io(dir, { git: () => { throw new KitExit('cannot run git: spawn git ENOENT', 1); } })), e => e instanceof KitExit && /cannot run git/.test(e.message) && !/not a (readable )?git repo/.test(e.message));
    const failing = () => ({ code: 128, stdout: '', stderr: 'fatal: boom\n' });
    await assert.rejects(graph.run([], io(dir, { git: failing })), KitExit);
  }));

  it('a repository path that escapes through the index is refused rather than skipped', () => tmp(async dir => {
    await assert.rejects(buildGraph(dir, { files: ['ok.js', 'a/../../evil.js'] }), e => e instanceof KitExit);
  }));
});

describe('graph — the /w-review caller', () => {
  const step = () => {
    const c = getCommands()['w-review'].content;
    const a = c.indexOf('SYMBOL GRAPH');
    const b = c.indexOf('**REQUIRED OUTPUT:**', a);
    assert.ok(a > c.indexOf('CHECKPOINT 1: Code Analysis') && b > a, 'the step sits in Code Analysis');
    return c.slice(a, b);
  };
  it('runs graph on the reviewed range, copy-pasteable, and tells the reviewer to report partial and not_read', () => {
    const s = step();
    assert.match(s, /node \.claude\/helpers\/kit\/cli\.js graph --diff "\$D" --budget-ms 20000 --max-parses 300; RC=\$\?; rm -f "\$D"; \(exit \$RC\)/);
    assert.match(s, /git diff --no-color --no-ext-diff --no-prefix "\$BASE"/);
    assert.ok(!s.includes('\\`') && !/<[a-z-]+>|\w\|\w/.test(s.split('```')[1]), 'no escaped backticks or placeholders in the command');
    assert.match(s, /`partial`/);
    assert.match(s, /`not_read`/);
    assert.match(s, /never write that "nothing else calls this"/);
  });
});

describe('graph — review round 1 regressions (diff input)', () => {
  it('an added line starting with "++ " is content, not a file header', () => {
    const d = ['diff --git a/notes.md b/notes.md', '--- a/notes.md', '+++ b/notes.md', '@@ -1 +1,2 @@', ' x', '+++ ../outside', ''].join('\n');
    assert.deepEqual(graph.diffPaths(d), ['notes.md']);
  });

  it('quoted (non-ASCII) paths are unquoted, not dropped', () => {
    const d = ['diff --git "a/src/caf\\303\\251.js" "b/src/caf\\303\\251.js"', '--- "a/src/caf\\303\\251.js"', '+++ "b/src/caf\\303\\251.js"', '@@ -1 +1 @@', '-1', '+2', ''].join('\n');
    assert.deepEqual(graph.diffPaths(d), ['src/café.js']);
  });

  it('git prefixes come from the header: a top-level b/ folder and mnemonic prefixes map to the right file', () => {
    const plain = ['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1 +1 @@', '-1', '+2', ''].join('\n');
    assert.deepEqual(graph.diffPaths(plain), ['a.js']);
    const mnemonic = ['diff --git i/src/a.js w/src/a.js', '--- i/src/a.js', '+++ w/src/a.js', '@@ -1 +1 @@', '-1', '+2', ''].join('\n');
    assert.deepEqual(graph.diffPaths(mnemonic), ['src/a.js']);
    const noPrefix = ['diff --git b/a.js b/a.js', '--- b/a.js', '+++ b/a.js', '@@ -1 +1 @@', '-1', '+2', ''].join('\n');
    assert.deepEqual(graph.diffPaths(noPrefix), ['b/a.js']);
  });

  it('the usage says --changed paths are relative to the repository top', () => {
    assert.match(graph.usage, /--changed paths.*relative to the repository top/);
  });
});
