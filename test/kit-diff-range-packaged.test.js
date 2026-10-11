/**
 * Packaged check for the diff-range verb: the INSTALLED `.claude/helpers/kit/cli.js diff-range` prints the review
 * range as raw diff text, pipes into the installed lenses/graph/impact verbs, and makes no egress.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { installPackaged } from './helpers/packaged.js';

let pkg;
before(async () => { pkg = await installPackaged(); });
after(async () => { await pkg.cleanup(); });

const git = (cwd, ...a) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

describe('diff-range — packaged, end to end', () => {
  it('prints the diff of committed, uncommitted and untracked changes since the base, raw, and pipes into lenses, graph and impact', async () => {
    await fs.mkdir(path.join(pkg.dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(pkg.dir, 'src', 'svc.js'), 'export function f() { return 1; }\n');
    git(pkg.dir, 'add', '-A'); git(pkg.dir, 'commit', '-q', '-m', 'svc');
    const base = git(pkg.dir, 'rev-parse', 'HEAD');
    await fs.writeFile(path.join(pkg.dir, 'src', 'svc.js'), 'export function f() { console.log("auth token", t); return 1; }\n');
    await fs.writeFile(path.join(pkg.dir, 'src', 'caller.js'), "import { f } from './svc.js';\nexport const g = () => f();\n");

    const d = pkg.kit(['diff-range', '--base', base]);
    assert.equal(d.code, 0, d.err);
    assert.equal(d.json, null, 'raw diff text, not JSON');
    assert.ok(d.out.startsWith('diff --git '));
    assert.ok(/^\+\+\+ src\/svc\.js$/m.test(d.out) && /^\+\+\+ src\/caller\.js$/m.test(d.out), d.out);

    const b = pkg.kit(['diff-range', '--base', base, '--base-only']);
    assert.equal(b.out, `${base}\n`);

    const l = pkg.kit(['lenses', '--diff', '-'], d.out);
    assert.equal(l.code, 0, l.err);
    assert.ok(l.json.fired.some(f => f.name === 'secret-in-log'));
    const g = pkg.kit(['graph', '--diff', '-'], d.out);
    assert.equal(g.code, 0, g.err);
    const i = pkg.kit(['impact', '--diff', '-', '--base', base], d.out);
    assert.equal(i.code, 0, i.err);
    assert.ok(i.json.touched.some(t => /svc\.js/.test(t.file || t.path || JSON.stringify(t))), JSON.stringify(i.json.touched));
  });

  it('an empty range is exit 3 with nothing on stdout', () => {
    git(pkg.dir, 'add', '-A'); git(pkg.dir, 'commit', '-q', '-m', 'all');
    const r = pkg.kit(['diff-range', '--base', 'HEAD', '--no-untracked']);
    assert.equal(r.code, 3, r.err);
    assert.equal(r.out, '');
  });

  it('made no egress', () => {
    assert.deepEqual(pkg.egress(), []);
  });
});
