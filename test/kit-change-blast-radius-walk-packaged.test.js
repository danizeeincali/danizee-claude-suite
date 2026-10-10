import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { installPackaged } from './helpers/packaged.js';

describe('impact — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('review flow: a changed callee, a removed function still called, honest limits', async () => {
    const git = (...a) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: pkg.dir, encoding: 'utf-8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    const put = async (rel, text) => { await fs.mkdir(path.dirname(path.join(pkg.dir, rel)), { recursive: true }); await fs.writeFile(path.join(pkg.dir, rel), text); };
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('impact'));
    await put('src/util.js', 'export function helper() {\n  return 1;\n}\nexport function legacy() {\n  return 0;\n}\n');
    await put('src/main.js', "import { helper, legacy } from './util.js';\nexport function main() {\n  return helper() + legacy();\n}\n");
    await put('src/app.js', "import { main } from './main.js';\nexport function app() {\n  return main();\n}\n");
    await put('tool/run.py', 'print(1)\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');

    // the change: helper is edited, legacy is removed while main still calls it
    await put('src/util.js', 'export function helper() {\n  return 2;\n}\n');
    git('add', '-A');
    // the same diff and base the /w-review step builds
    const diff = git('diff', '--no-color', '--no-ext-diff', '--no-prefix', 'HEAD');

    const r = pkg.kit(['impact', '--diff', '-', '--base', 'HEAD'], diff);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.touched.map(t => t.qualified), ['helper']);
    assert.deepEqual(r.json.impacted.map(i => [i.qualified, i.hop]), [['main', 1], ['app', 2]]);
    assert.deepEqual(r.json.removed_with_live_callers.map(x => x.symbol.qualified), ['legacy']);
    assert.equal(r.json.risk.level, 'high');
    assert.equal(r.json.partial, true, 'a python file is in the repository');
    assert.ok(r.json.not_read.some(x => x.file === 'tool/run.py' && x.reason === 'unsupported'));
    assert.equal(r.json.risk.lower_bound, true);

    // one hop only; the limit is a parameter, not a cut
    const one = pkg.kit(['impact', '--diff', '-', '--hops', '1'], diff);
    assert.deepEqual(one.json.impacted.map(i => i.qualified), ['main']);
    assert.ok(one.json.notes.some(n => /no --base/.test(n)));

    // wrong input is refused with a short message that points at --help
    for (const args of [['impact'], ['impact', '--diff', '-', '--hops', '9'], ['impact', '--diff', '-', '--base', 'no-such-ref']]) {
      const bad = pkg.kit(args, diff);
      assert.equal(bad.code, 1, args.join(' '));
      assert.match(bad.err, /--help|not a commit/);
      assert.ok(bad.err.length < 200);
    }
    assert.equal(pkg.kit(['impact', '--diff', '-'], 'not a diff').code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
