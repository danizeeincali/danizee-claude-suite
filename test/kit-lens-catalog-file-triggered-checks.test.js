import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import {
  verb, run, parseFrontmatter, parseLens, loadLenses, parseDiff, globToRegExp, globMatch, selectLenses
} from '../src/lib/kit/lenses.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN = path.join(HERE, '..', 'src', 'lib', 'kit', 'lenses');
const temps = [];
const tmp = async () => { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'lenses-')); temps.push(d); return d; };
after(async () => { for (const d of temps) await fs.rm(d, { recursive: true, force: true }); });

const lensText = (over = {}) => {
  const f = { name: 'demo', globs: '[src/**/*.js]', match: 'TODO', ...over };
  const head = Object.entries(f).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${head}\n---\nLook at the TODO.\n`;
};
const throwsKit = (fn, code, re) => assert.throws(fn, e => e instanceof KitExit && e.code === code && re.test(e.message), `${re}`);

describe('lenses — frontmatter', () => {
  it('parses scalars, quoted scalars, inline lists, dash lists and comments', () => {
    const fm = parseFrontmatter([
      '# a comment', 'name: demo', 'match: "a: b"', 'globs: [src/**/*.{js,ts}, "x y/*.md"]', 'covered_by:', '  - one', '  - two', ''
    ].join('\n'), 'f.md', 2);
    assert.deepEqual(fm, { name: 'demo', match: 'a: b', globs: ['src/**/*.{js,ts}', 'x y/*.md'], covered_by: ['one', 'two'] });
  });
  it('refuses unsupported syntax loudly, naming file and line', () => {
    throwsKit(() => parseFrontmatter('name: a\nnested:\n  k: v\n', 'f.md', 2), 1, /f\.md:3/);
    throwsKit(() => parseFrontmatter('name: a\nwhat is this\n', 'f.md', 2), 1, /f\.md:3/);
    throwsKit(() => parseFrontmatter('name: a\nname: b\n', 'f.md', 2), 1, /f\.md:3.*duplicate/);
    throwsKit(() => parseFrontmatter('globs: [a, b\n', 'f.md', 2), 1, /f\.md:2/);
    throwsKit(() => parseFrontmatter('name: &anchor x\n', 'f.md', 2), 1, /f\.md:2/);
    throwsKit(() => parseFrontmatter('globs: |\n', 'f.md', 2), 1, /f\.md:2/);
  });
  it('parseLens needs name, globs and a valid match; refuses unknown keys and an empty body', () => {
    const ok = parseLens(lensText({ covered_by: '[lint]' }), 'a.md');
    assert.equal(ok.name, 'demo');
    assert.deepEqual(ok.globs, ['src/**/*.js']);
    assert.deepEqual(ok.covered_by, ['lint']);
    assert.ok(ok.re.test('a todo here'), 'match is case-insensitive');
    assert.equal(ok.body, 'Look at the TODO.');
    throwsKit(() => parseLens(lensText({ name: null }), 'a.md'), 1, /a\.md.*name/);
    throwsKit(() => parseLens(lensText({ globs: null }), 'a.md'), 1, /a\.md.*globs/);
    throwsKit(() => parseLens(lensText({ match: null }), 'a.md'), 1, /a\.md.*match/);
    throwsKit(() => parseLens(lensText({ match: '(unclosed' }), 'a.md'), 1, /a\.md.*regex/);
    throwsKit(() => parseLens(lensText({ globs: '[]' }), 'a.md'), 1, /a\.md.*globs/);
    throwsKit(() => parseLens(lensText({ extra: 'x' }), 'a.md'), 1, /a\.md.*extra/);
    throwsKit(() => parseLens(lensText({ name: 'Bad Name' }), 'a.md'), 1, /a\.md.*name/);
    throwsKit(() => parseLens(lensText({ globs: '[src/{a,b]' }), 'a.md'), 1, /a\.md.*glob/);
    throwsKit(() => parseLens('no frontmatter\n', 'a.md'), 1, /a\.md.*---/);
    throwsKit(() => parseLens('---\nname: a\n', 'a.md'), 1, /a\.md.*closing/);
    throwsKit(() => parseLens(lensText() .replace('Look at the TODO.', ''), 'a.md'), 1, /a\.md.*body/);
  });
});

describe('lenses — loading', () => {
  it('sorts by name, ignores non-.md files, and lets a later dir win a duplicate name', async () => {
    const a = await tmp(); const b = await tmp();
    await fs.writeFile(path.join(a, 'z.md'), lensText({ name: 'zeta' }));
    await fs.writeFile(path.join(a, 'm.md'), lensText({ name: 'mid' }));
    await fs.writeFile(path.join(a, 'notes.txt'), 'not a lens');
    await fs.writeFile(path.join(b, 'whatever.md'), lensText({ name: 'mid', match: 'OVERRIDE' }));
    const lenses = await loadLenses([a, b]);
    assert.deepEqual(lenses.map(l => l.name), ['mid', 'zeta']);
    assert.equal(lenses[0].source, path.join(b, 'whatever.md'));
    assert.equal(lenses[0].re.source, 'OVERRIDE');
  });
  it('refuses two files with the same name in one dir, and a missing dir', async () => {
    const a = await tmp();
    await fs.writeFile(path.join(a, 'x.md'), lensText());
    await fs.writeFile(path.join(a, 'y.md'), lensText());
    await assert.rejects(loadLenses([a]), e => e instanceof KitExit && e.code === 1 && /duplicate.*demo/.test(e.message));
    await assert.rejects(loadLenses([path.join(a, 'nope')]), e => e instanceof KitExit && e.code === 1);
  });
  it('one bad file fails the whole load, naming the file', async () => {
    const a = await tmp();
    await fs.writeFile(path.join(a, 'good.md'), lensText({ name: 'good' }));
    await fs.writeFile(path.join(a, 'bad.md'), lensText({ name: 'bad', match: '[' }));
    await assert.rejects(loadLenses([a]), e => e instanceof KitExit && e.code === 1 && /bad\.md/.test(e.message));
  });
  it('the built-in lenses load, and there are 3 to 4 of them', async () => {
    const lenses = await loadLenses([BUILTIN]);
    assert.ok(lenses.length >= 3 && lenses.length <= 4, `got ${lenses.length}`);
    for (const l of lenses) assert.ok(l.body.length > 40, `${l.name} has a real body`);
  });
});

describe('lenses — globs', () => {
  const yes = (g, p) => assert.ok(globMatch(g, p), `${g} should match ${p}`);
  const no = (g, p) => assert.ok(!globMatch(g, p), `${g} should not match ${p}`);
  it('* stays inside one directory, ** crosses them, ? is one character', () => {
    yes('src/*.js', 'src/a.js'); no('src/*.js', 'src/x/a.js');
    yes('src/**/*.js', 'src/a.js'); yes('src/**/*.js', 'src/x/y/a.js'); no('src/**/*.js', 'lib/a.js');
    yes('**/a.js', 'a.js'); yes('**/a.js', 'x/y/a.js');
    yes('src/**', 'src/x/y.txt');
    yes('a?.js', 'ab.js'); no('a?.js', 'a.js'); no('a?.js', 'a/.js');
  });
  it('{a,b} alternation, nested and with globs inside', () => {
    yes('*.{js,ts}', 'a.js'); yes('*.{js,ts}', 'a.ts'); no('*.{js,ts}', 'a.py');
    yes('src/{a,b/*}.js', 'src/b/c.js'); yes('*.{test,spec}.{js,ts}', 'x.spec.ts');
    yes('{a,{b,c}}.md', 'c.md');
  });
  it('a pattern without a slash matches the base name at any depth; regex characters are literal', () => {
    yes('*.js', 'deep/er/a.js'); yes('Makefile', 'sub/Makefile');
    no('src/*.js', 'deep/src/a.js');
    yes('a+b(1).js', 'a+b(1).js'); no('a.js', 'axjs');
  });
  it('globToRegExp refuses an unbalanced brace', () => {
    throwsKit(() => globToRegExp('a{b'), 1, /brace/);
    throwsKit(() => globToRegExp('a}b'), 1, /brace/);
  });
});

const DIFF = [
  'diff --git a/src/a.js b/src/a.js',
  'index 111..222 100644',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -1,3 +1,3 @@',
  ' keep',
  '-old line',
  '+new line',
  '+++ not a header',
  '@@ -10,2 +10,2 @@',
  '--- also not a header',
  '+added',
  'diff --git a/docs/x.md b/docs/x.md',
  '--- a/docs/x.md',
  '+++ b/docs/x.md',
  '@@ -1 +1 @@',
  '-a',
  '+b',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-bye',
  'diff --git a/img.png b/img.png',
  'Binary files a/img.png and b/img.png differ',
  ''
].join('\n');

describe('lenses — parseDiff', () => {
  it('lists each file with its added and removed lines; hunk bodies that look like headers are content', () => {
    const files = parseDiff(DIFF);
    assert.deepEqual(files.map(f => f.path), ['src/a.js', 'docs/x.md', 'gone.txt', 'img.png']);
    assert.deepEqual(files[0].added, ['new line', '++ not a header', 'added']);
    assert.deepEqual(files[0].removed, ['old line', '-- also not a header']);
    assert.deepEqual(files[1], { path: 'docs/x.md', added: ['b'], removed: ['a'] });
    assert.deepEqual(files[2].removed, ['bye']);
    assert.deepEqual(files[3], { path: 'img.png', added: [], removed: [] });
  });
  it('handles a plain diff -u (no git header) and tab-suffixed names', () => {
    const files = parseDiff('--- a/x.js\t2026-01-01\n+++ b/x.js\t2026-01-02\n@@ -1 +1 @@\n-1\n+2\n--- a/y.js\n+++ b/y.js\n@@ -1 +1 @@\n-3\n+4\n');
    assert.deepEqual(files.map(f => [f.path, f.added, f.removed]), [['x.js', ['2'], ['1']], ['y.js', ['4'], ['3']]]);
  });
  it('an empty diff has no files; "\\ No newline" markers are not content', () => {
    assert.deepEqual(parseDiff(''), []);
    const f = parseDiff('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n\\ No newline at end of file\n+y\n\\ No newline at end of file\n');
    assert.deepEqual([f[0].added, f[0].removed], [['y'], ['x']]);
  });
});

const mk = (name, over = {}) => ({ name, globs: ['**/*.js'], re: /todo/i, covered_by: [], body: `body of ${name}`, source: `${name}.md`, ...over });
const diffOf = (...files) => files.map(([p, a = [], r = []]) => ({ path: p, added: a, removed: r }));

describe('lenses — selectLenses', () => {
  it('fires only when a changed file matches the globs AND the regex hits that file\'s changed lines', () => {
    const lenses = [mk('both'), mk('wrong-glob', { globs: ['**/*.py'] }), mk('wrong-text', { re: /zzz/i })];
    const r = selectLenses(lenses, diffOf(['a.js', ['// TODO fix']]));
    assert.deepEqual(r.fired.map(f => f.name), ['both']);
    assert.deepEqual(r.fired[0].files, ['a.js']);
    assert.equal(r.fired[0].body, 'body of both');
  });
  it('the regex does not borrow text from a file the globs do not match', () => {
    const r = selectLenses([mk('js-only')], diffOf(['a.js', ['clean']], ['b.py', ['TODO here']]));
    assert.deepEqual(r.fired, []);
  });
  it('removed lines count as changed text', () => {
    const r = selectLenses([mk('x')], diffOf(['a.js', [], ['TODO gone']]));
    assert.equal(r.fired.length, 1);
  });
  it('caps at 4 by default in name order, reporting the rest; --cap overrides', () => {
    const lenses = ['e', 'a', 'd', 'b', 'c', 'f'].map(n => mk(n));
    const d = diffOf(['a.js', ['TODO']]);
    const r = selectLenses(lenses, d);
    assert.deepEqual(r.fired.map(f => f.name), ['a', 'b', 'c', 'd']);
    assert.deepEqual(r.capped, ['e', 'f']);
    const two = selectLenses(lenses, d, { cap: 2 });
    assert.deepEqual([two.fired.length, two.capped.length], [2, 4]);
    assert.equal(selectLenses(lenses, d, { cap: 0 }).fired.length, 0);
  });
  it('a lens stands down when a named check covers it, and does not use up the cap', () => {
    const lenses = [mk('a', { covered_by: ['lint'] }), mk('b', { covered_by: ['other', 'lint'] }), mk('c'), mk('d')];
    const r = selectLenses(lenses, diffOf(['x.js', ['TODO']]), { cap: 2, covered: ['lint'] });
    assert.deepEqual(r.stood_down, ['a', 'b']);
    assert.deepEqual(r.fired.map(f => f.name), ['c', 'd']);
    assert.deepEqual(r.capped, []);
  });
  it('a covered lens that would not fire is not listed as stood down', () => {
    const r = selectLenses([mk('a', { covered_by: ['lint'] })], diffOf(['x.js', ['clean']]), { covered: ['lint'] });
    assert.deepEqual(r, { fired: [], capped: [], stood_down: [] });
  });
  it('rejects a bad cap', () => {
    throwsKit(() => selectLenses([], [], { cap: -1 }), 1, /cap/);
    throwsKit(() => selectLenses([], [], { cap: 1.5 }), 1, /cap/);
  });
});

describe('lenses — the built-in lenses fire on what they were written for', () => {
  const fires = async (diffFiles, covered = []) => {
    const lenses = await loadLenses([BUILTIN]);
    return selectLenses(lenses, diffFiles, { cap: 10, covered }).fired.map(f => f.name);
  };
  it('a secret written to a log', async () => {
    assert.ok((await fires(diffOf(['src/a.js', ['console.log("token", apiToken)']]))).includes('secret-in-log'));
    assert.ok(!(await fires(diffOf(['src/a.js', ['console.log("done")']]))).includes('secret-in-log'));
  });
  it('a shell command built by string concatenation', async () => {
    assert.ok((await fires(diffOf(['src/a.js', ['execSync("rm -rf " + dir)']]))).includes('shell-string-concat'));
    assert.ok((await fires(diffOf(['src/a.js', ['execSync(`git show ${ref}`)']]))).includes('shell-string-concat'));
  });
  it('a test that may assert nothing', async () => {
    assert.ok((await fires(diffOf(['test/a.test.js', ["it('works', () => {"]]))).includes('test-asserts-nothing'));
    assert.ok(!(await fires(diffOf(['src/a.js', ["it('works', () => {"]]))).includes('test-asserts-nothing'));
  });
  it('a promise-returning call without await', async () => {
    assert.ok((await fires(diffOf(['src/a.ts', ['fs.promises.writeFile(p, data);']]))).includes('missing-await'));
    assert.ok(!(await fires(diffOf(['README.md', ['fs.promises.writeFile(p, data);']]))).includes('missing-await'));
  });
});

describe('lenses — run', () => {
  const git = (top) => async () => ({ code: 0, stdout: top + '\n', stderr: '' });
  const io = (cwd, extra = {}) => ({ cwd, stdin: async () => '', env: {}, git: git(cwd), ...extra });
  it('reads a diff file, loads built-in then project lenses, and prints the fired ones with bodies', async () => {
    const proj = await tmp();
    await fs.mkdir(path.join(proj, '.claude', 'kit', 'lenses'), { recursive: true });
    await fs.writeFile(path.join(proj, '.claude', 'kit', 'lenses', 'mine.md'), lensText({ name: 'mine', match: 'frobnicate' }));
    await fs.writeFile(path.join(proj, 'd.diff'), 'diff --git a/src/q.js b/src/q.js\n--- a/src/q.js\n+++ b/src/q.js\n@@ -1 +1 @@\n-x\n+frobnicate()\n');
    const r = await run(['--diff', path.join(proj, 'd.diff')], io(proj));
    assert.equal(verb, 'lenses');
    assert.deepEqual(r.fired.map(f => f.name), ['mine']);
    assert.equal(r.fired[0].body, 'Look at the TODO.');
    assert.ok(r.loaded >= 4);
  });
  it('--diff - reads stdin; --cap, --covered and --dir work; later dirs win', async () => {
    const proj = await tmp(); const extra = await tmp();
    await fs.writeFile(path.join(extra, 'a.md'), lensText({ name: 'secret-in-log', match: 'zzzz' }));
    await fs.writeFile(path.join(extra, 'b.md'), lensText({ name: 'extra', match: 'wombat', covered_by: '[lint]' }));
    const diff = 'diff --git a/src/q.js b/src/q.js\n--- a/src/q.js\n+++ b/src/q.js\n@@ -1 +1 @@\n-x\n+console.log(token); wombat\n';
    const stdin = async () => diff;
    const r = await run(['--diff', '-', '--dir', extra, '--cap', '1', '--covered', 'lint,other'], io(proj, { stdin }));
    assert.deepEqual(r.stood_down, ['extra']);
    assert.ok(!r.fired.some(f => f.name === 'secret-in-log'), 'the --dir copy replaced the built-in');
    assert.equal(r.cap, 1);
  });
  it('refuses unknown flags, a missing --diff, a bad --cap and an unreadable diff', async () => {
    const proj = await tmp();
    await assert.rejects(run(['--diff', 'x', '--bogus'], io(proj)), e => e instanceof KitExit && e.code === 1 && /--bogus/.test(e.message));
    await assert.rejects(run([], io(proj)), e => e instanceof KitExit && e.code === 1 && /--diff/.test(e.message));
    await assert.rejects(run(['--diff', '-', '--cap', 'x'], io(proj)), e => e instanceof KitExit && e.code === 1 && /--cap/.test(e.message));
    await assert.rejects(run(['--diff', path.join(proj, 'nope.diff')], io(proj)), e => e instanceof KitExit && e.code === 1 && /nope\.diff/.test(e.message));
  });
  it('a failure of git itself is reported as that; "not a repository" just means no project lenses', async () => {
    const proj = await tmp();
    const broken = async () => { throw new KitExit('cannot run git: spawn git ENOENT', 1); };
    await assert.rejects(run(['--diff', '-'], io(proj, { git: broken, stdin: async () => '' })), e => e instanceof KitExit && /cannot run git/.test(e.message));
    const notRepo = async () => ({ code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git' });
    const r = await run(['--diff', '-'], io(proj, { git: notRepo, stdin: async () => '' }));
    assert.deepEqual(r.fired, []);
    const odd = async () => ({ code: 1, stdout: '', stderr: 'fatal: something else broke' });
    await assert.rejects(run(['--diff', '-'], io(proj, { git: odd, stdin: async () => '' })), e => e instanceof KitExit && /something else broke/.test(e.message));
  });
  it('a bad project lens fails the run loudly (exit 1) instead of being skipped', async () => {
    const proj = await tmp();
    await fs.mkdir(path.join(proj, '.claude', 'kit', 'lenses'), { recursive: true });
    await fs.writeFile(path.join(proj, '.claude', 'kit', 'lenses', 'bad.md'), lensText({ match: '(' }));
    await assert.rejects(run(['--diff', '-'], io(proj)), e => e instanceof KitExit && e.code === 1 && /bad\.md/.test(e.message));
  });
});
