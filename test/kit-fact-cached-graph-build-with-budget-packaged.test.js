import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { installPackaged } from './helpers/packaged.js';

describe('graph — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('review flow: build for a changed range, hit the cache, edit one file, stay honest about what was cut', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('graph'));
    const put = async (rel, text) => { await fs.mkdir(path.dirname(path.join(pkg.dir, rel)), { recursive: true }); await fs.writeFile(path.join(pkg.dir, rel), text); };
    await put('src/main.js', "import { helper } from './util.js';\nexport function main() { return helper(); }\n");
    await put('src/util.js', 'export function helper() { return 1; }\n');
    await put('src/other.js', 'export function other() {}\n');
    await put('tool/run.py', 'print(1)\n');
    spawnSync('git', ['add', '-A'], { cwd: pkg.dir });

    // the same range the /w-review step builds: a diff of the change, passed on stdin
    const diff = '--- a/src/main.js\n+++ b/src/main.js\n@@ -0,0 +1,2 @@\n+x\n';
    const first = pkg.kit(['graph', '--diff', '-', '--budget-ms', '20000', '--max-parses', '300'], diff);
    assert.equal(first.code, 0, first.err);
    assert.equal(first.json.partial, true, 'a python file is in the repository, so the answer is partial');
    assert.deepEqual(first.json.not_read.filter(r => r.file.startsWith('tool/')).map(r => [r.file, r.reason]), [['tool/run.py', 'unsupported']]);
    assert.ok(first.json.not_read.every(r => r.reason === 'unsupported'), 'the installed shell scripts are listed too, nothing else was cut');
    assert.deepEqual(first.json.changed, { requested: 1, read: 1 });
    assert.equal(first.json.stats.parsed, first.json.counts.files);
    assert.equal(first.json.stats.cache_writes, first.json.counts.files);

    const cacheDir = path.join(pkg.dir, '.claude/kit/cache/graph');
    assert.ok((await fs.readdir(cacheDir)).length >= 3);
    assert.ok((await fs.readFile(path.join(pkg.dir, '.gitignore'), 'utf-8')).split('\n').includes('.claude/kit/cache/'));
    assert.equal(spawnSync('git', ['status', '--porcelain', '--', '.claude/kit/cache'], { cwd: pkg.dir, encoding: 'utf-8' }).stdout, '', 'the cache never shows up as a change');

    const second = pkg.kit(['graph'], '');
    assert.equal(second.json.stats.parsed, 0);
    assert.equal(second.json.stats.cache_hits, first.json.counts.files);

    await put('src/util.js', 'export function helper() { return 2; }\nexport function more() {}\n');
    const third = pkg.kit(['graph', '--json', '--changed', 'src/util.js'], '');
    assert.equal(third.json.stats.parsed, 1);
    assert.equal(third.json.stats.cache_hits, first.json.counts.files - 1);
    assert.ok(third.json.edges.some(e => e.from.startsWith('src/main.js::main') && e.to.startsWith('src/util.js::helper') && e.confidence === 'certain'));
    assert.equal(third.json.defs.filter(d => d.file === 'src/util.js').length, 2);
    assert.equal(third.json.files[0].path, 'src/util.js', 'changed files come first');

    // a cap that bites cuts the unchanged file, never the one under review, and says so
    await put('src/new1.js', 'export function one() {}\n');
    await put('src/new2.js', 'export function two() {}\n');
    spawnSync('git', ['add', '-A'], { cwd: pkg.dir });
    const capped = pkg.kit(['graph', '--changed', 'src/new2.js', '--max-parses', '1'], '');
    assert.equal(capped.code, 0);
    assert.equal(capped.json.stats.parsed, 1);
    assert.deepEqual(capped.json.not_read.filter(r => r.reason === 'parse_cap').map(r => r.file), ['src/new1.js']);
    assert.deepEqual(capped.json.changed, { requested: 1, read: 1 });

    // wrong input is refused with a short message that points at --help
    const bad = pkg.kit(['graph', '--nope'], '');
    assert.equal(bad.code, 1);
    assert.match(bad.err, /unknown flag --nope.*--help/);
    assert.ok(bad.err.split('\n').length <= 2);

    // the step the command tells the reviewer to run exists in the installed command
    const cmd = await fs.readFile(path.join(pkg.dir, '.claude/commands/.shortcuts/w-review.md'), 'utf-8').catch(() => '');
    if (cmd) assert.match(cmd, /cli\.js graph --diff "\$D"/);
    assert.deepEqual(pkg.egress(), []);
  });
});
