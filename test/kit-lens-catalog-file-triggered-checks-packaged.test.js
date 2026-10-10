import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

let pkg;
before(async () => { pkg = await installPackaged(); });
after(async () => { await pkg.cleanup(); });

const DIFF = [
  'diff --git a/src/svc.js b/src/svc.js',
  '--- a/src/svc.js',
  '+++ b/src/svc.js',
  '@@ -1,2 +1,3 @@',
  ' const x = 1;',
  '+console.log("auth token", token);',
  '+fs.promises.writeFile(out, data);',
  'diff --git a/docs/readme.md b/docs/readme.md',
  '--- a/docs/readme.md',
  '+++ b/docs/readme.md',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  ''
].join('\n');

describe('lenses — packaged, end to end', () => {
  it('installs the built-in lens files next to the CLI', async () => {
    const dir = path.join(pkg.dir, '.claude', 'helpers', 'kit', 'lenses');
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.md'));
    assert.ok(files.length >= 3, files.join(','));
  });

  it('a review diff fires the matching built-in lenses with their bodies', async () => {
    await fs.writeFile(path.join(pkg.dir, 'review.diff'), DIFF);
    const r = pkg.kit(['lenses', '--diff', 'review.diff']);
    assert.equal(r.code, 0, r.err);
    const names = r.json.fired.map(f => f.name);
    assert.deepEqual(names, ['missing-await', 'secret-in-log']);
    for (const f of r.json.fired) { assert.deepEqual(f.files, ['src/svc.js']); assert.ok(f.body.length > 40); }
  });

  it('adding a rule is adding a file: a project lens fires, and overrides a built-in of the same name', async () => {
    const dir = path.join(pkg.dir, '.claude', 'kit', 'lenses');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'docs-rule.md'), '---\nname: docs-rule\nglobs: [docs/**/*.md]\nmatch: NEW\n---\nCheck the docs wording.\n');
    await fs.writeFile(path.join(dir, 'quiet.md'), '---\nname: secret-in-log\nglobs: [src/**]\nmatch: never-matches-anything-zz\n---\nProject copy of the rule.\n');
    const r = pkg.kit(['lenses', '--diff', '-'], DIFF);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.fired.map(f => f.name), ['docs-rule', 'missing-await']);
    assert.equal(r.json.fired[0].body, 'Check the docs wording.');
  });

  it('an empty or non-diff input exits 1 with a message instead of a clean "nothing fired"', async () => {
    const empty = pkg.kit(['lenses', '--diff', '-'], '');
    assert.equal(empty.code, 1);
    assert.match(empty.err, /no diff was given/);
    const junk = pkg.kit(['lenses', '--diff', '-'], 'not a diff\n');
    assert.equal(junk.code, 1);
    assert.match(junk.err, /not a unified diff/);
  });

  it('--covered stands a lens down and --cap limits what is handed over', async () => {
    await fs.rm(path.join(pkg.dir, '.claude', 'kit'), { recursive: true, force: true });
    const covered = pkg.kit(['lenses', '--diff', '-', '--covered', 'no-floating-promises'], DIFF);
    assert.equal(covered.code, 0, covered.err);
    assert.deepEqual(covered.json.stood_down, ['missing-await']);
    assert.deepEqual(covered.json.fired.map(f => f.name), ['secret-in-log']);
    const capped = pkg.kit(['lenses', '--diff', '-', '--cap', '1'], DIFF);
    assert.deepEqual([capped.json.fired.length, capped.json.capped.length], [1, 1]);
  });

  it('a broken project lens, an unknown flag and a missing diff all exit 1 with a message', async () => {
    const dir = path.join(pkg.dir, '.claude', 'kit', 'lenses');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'broken.md'), '---\nname: broken\nglobs: [a]\nmatch: (oops\n---\nbody text that is long enough\n');
    const bad = pkg.kit(['lenses', '--diff', '-'], DIFF);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /broken\.md/);
    await fs.rm(path.join(pkg.dir, '.claude', 'kit'), { recursive: true, force: true });
    assert.equal(pkg.kit(['lenses', '--diff', '-', '--nope'], DIFF).code, 1);
    assert.equal(pkg.kit(['lenses', '--diff', 'absent.diff']).code, 1);
  });

  it('runs from a subdirectory of the project and still finds the project lenses', async () => {
    const dir = path.join(pkg.dir, '.claude', 'kit', 'lenses');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'docs-rule.md'), '---\nname: docs-rule\nglobs: [docs/**/*.md]\nmatch: NEW\n---\nCheck the docs wording.\n');
    await fs.mkdir(path.join(pkg.dir, 'sub'), { recursive: true });
    const r = pkg.kit(['lenses', '--diff', '-'], DIFF, { cwd: path.join(pkg.dir, 'sub') });
    assert.equal(r.code, 0, r.err);
    assert.ok(r.json.fired.some(f => f.name === 'docs-rule'));
  });

  it('made no network connections', () => {
    assert.deepEqual(pkg.egress(), []);
  });
});
