import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { installPackaged } from './helpers/packaged.js';

describe('callers — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('review flow: callers of a symbol, the floor from an unread file, and the same floor inside impact', async () => {
    const git = (...a) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: pkg.dir, encoding: 'utf-8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    const put = async (rel, text) => { await fs.mkdir(path.dirname(path.join(pkg.dir, rel)), { recursive: true }); await fs.writeFile(path.join(pkg.dir, rel), text); };
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('callers'));
    await put('src/util.js', 'export function helper() {\n  return 1;\n}\nexport function orphan() {\n  return 0;\n}\n');
    await put('src/main.js', "import { helper } from './util.js';\nexport function main() {\n  return helper();\n}\n");
    await put('tool/run.py', 'print(1)\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');

    const r = pkg.kit(['callers', '--symbol', 'src/util.js:helper', 'src/util.js:orphan', 'src/util.js:missing']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.partial, true, 'a python file is in the repository');
    const [helper, orphan] = r.json.entries;
    assert.equal(helper.callers_total, 1);
    assert.equal(helper.floor, true);
    assert.ok(helper.reasons.some(x => x.code === 'unread_files'));
    assert.equal(orphan.callers_total, 0);
    assert.equal(orphan.sentences.at(-1), 'Zero callers found, but this is a floor: check call sites by hand.');
    assert.deepEqual(r.json.missing.map(m => m.name), ['missing']);

    // the same floor inside impact: a removed symbol with no callers is still not "safe to remove"
    await put('src/util.js', 'export function helper() {\n  return 2;\n}\n');
    git('add', '-A');
    const diff = git('diff', '--no-color', '--no-ext-diff', '--no-prefix', 'HEAD');
    const imp = pkg.kit(['impact', '--diff', '-', '--base', 'HEAD'], diff);
    assert.equal(imp.code, 0, imp.err);
    const gone = imp.json.removed.find(x => x.name === 'orphan');
    assert.equal(gone.floor, true);
    assert.equal(gone.sentences.at(-1), 'Zero callers found, but this is a floor: check call sites by hand.');
    assert.ok(imp.json.impacted.every(i => typeof i.floor === 'boolean'));

    const viaDiff = pkg.kit(['callers', '--diff', '-'], diff);
    assert.deepEqual(viaDiff.json.entries.map(e => e.qualified), ['helper']);

    // wrong input is refused with a short message that points at --help
    for (const args of [['callers'], ['callers', '--nope'], ['callers', '--symbol', 'nocolon']]) {
      const bad = pkg.kit(args, '');
      assert.equal(bad.code, 1, args.join(' '));
      assert.match(bad.err, /--help|file:name/);
      assert.ok(bad.err.length < 200);
    }
    assert.deepEqual(pkg.egress(), []);
  });
});
