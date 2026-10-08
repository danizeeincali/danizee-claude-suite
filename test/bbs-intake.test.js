/**
 * Contract for src/lib/bbs/intake.js — stream `intake` of marathon 2026-10-07-bbs.
 * classifySource · slugFor · sourceIdentity · intake(projectDir, ref, opts)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { classifySource, slugFor, sourceIdentity, runIdFor, intake } from '../src/lib/bbs/intake.js';
import { readJson, activeRunId, appendRegistry } from '../src/lib/bbs/store.js';

const sha = (s) => 'sha256:' + createHash('sha256').update(s).digest('hex');
const existsNone = () => false;

describe('intake — classifySource', () => {
  it('repo: .git suffix, git@ / ssh:// / git:// schemes, and a two-segment path on a known forge', () => {
    for (const ref of [
      'https://github.com/openqodex/openqodex.git', 'git@github.com:openqodex/openqodex.git',
      'ssh://git@gitlab.com/a/b', 'git://host/a/b.git',
      'https://github.com/openqodex/openqodex', 'https://gitlab.com/a/b', 'https://codeberg.org/a/b/', 'https://bitbucket.org/a/b'
    ]) assert.equal(classifySource(ref, { exists: existsNone }), 'repo', ref);
  });

  it('url: any other http(s) reference, including forge pages that are not a repo root', () => {
    for (const ref of [
      'https://example.com/post', 'http://example.com', 'https://github.com/openqodex/openqodex/blob/main/README.md',
      'https://github.com/openqodex', 'https://docs.example.com/a/b/c?x=1'
    ]) assert.equal(classifySource(ref, { exists: existsNone }), 'url', ref);
  });

  it('local: a path that exists on disk (file or directory), relative or absolute', () => {
    const exists = (p) => p === '/tmp/x' || p === path.resolve('./some/dir');
    assert.equal(classifySource('/tmp/x', { exists }), 'local');
    assert.equal(classifySource('./some/dir', { exists }), 'local');
  });

  it('paste: "-" (stdin), a paste file, or multi-line text; anything else that is not a path is paste too', () => {
    assert.equal(classifySource('-', { exists: existsNone }), 'paste');
    assert.equal(classifySource('whatever', { exists: existsNone, pasteFile: '/p.txt' }), 'paste');
    assert.equal(classifySource('line one\nline two', { exists: existsNone }), 'paste');
    assert.equal(classifySource('a short idea with spaces', { exists: existsNone }), 'paste');
  });

  it('--as overrides the heuristic but only to a known type', () => {
    assert.equal(classifySource('https://github.com/a/b', { exists: existsNone, as: 'url' }), 'url');
    assert.equal(classifySource('https://example.com/x.git-ish', { exists: existsNone, as: 'repo' }), 'repo');
    assert.throws(() => classifySource('x', { exists: existsNone, as: 'tarball' }), /as/);
  });

  it('refuses an empty reference and non-http(s)/git schemes', () => {
    assert.throws(() => classifySource('', { exists: existsNone }), /empty/i);
    assert.throws(() => classifySource('   ', { exists: existsNone }), /empty/i);
    assert.throws(() => classifySource('ftp://host/x', { exists: existsNone }), /scheme/i);
    assert.throws(() => classifySource('file:///etc/passwd', { exists: existsNone }), /scheme/i);
  });
});

describe('intake — slugFor and runIdFor', () => {
  it('slug: repo → last segment without .git; url → host + path words; local → basename; paste → paste', () => {
    assert.equal(slugFor('repo', 'https://github.com/openqodex/openqodex.git'), 'openqodex');
    assert.equal(slugFor('repo', 'git@github.com:Open/Qodex.git'), 'qodex');
    assert.equal(slugFor('url', 'https://docs.example.com/Guide/Intro?x=1#top'), 'docs-example-com-guide-intro');
    assert.equal(slugFor('local', '/Users/x/code/My Tool/'), 'my-tool');
    assert.equal(slugFor('paste', 'anything'), 'paste');
  });

  it('slug is lower-case [a-z0-9-], at most 40 chars, never empty, never leading/trailing dash', () => {
    const s = slugFor('url', 'https://a.b/' + 'x'.repeat(100) + '/--weird__chars!!');
    assert.match(s, /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/);
    assert.ok(s.length <= 40);
    assert.equal(slugFor('url', 'https://!!!/'), 'source');
  });

  it('runIdFor is <YYYY-MM-DD>-<slug> and gets -2, -3 … when the dir already exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-runid-'));
    try {
      const today = new Date('2026-10-07T12:00:00Z');
      assert.equal(await runIdFor(dir, 'openqodex', { now: () => today }), '2026-10-07-openqodex');
      await fs.mkdir(path.join(dir, '.claude', 'bbs', 'runs', '2026-10-07-openqodex'), { recursive: true });
      assert.equal(await runIdFor(dir, 'openqodex', { now: () => today }), '2026-10-07-openqodex-2');
      await fs.mkdir(path.join(dir, '.claude', 'bbs', 'runs', '2026-10-07-openqodex-2'), { recursive: true });
      assert.equal(await runIdFor(dir, 'openqodex', { now: () => today }), '2026-10-07-openqodex-3');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('intake — sourceIdentity', () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-ident-'));
    await fs.mkdir(path.join(dir, 'tree', 'sub'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tree', 'b.txt'), 'bb');
    await fs.writeFile(path.join(dir, 'tree', 'sub', 'a.txt'), 'a');
    await fs.writeFile(path.join(dir, 'one.txt'), 'hello');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('paste → sha256 of the content; identical content → identical identity', async () => {
    assert.equal(await sourceIdentity({ type: 'paste', content: 'abc' }), sha('abc'));
    assert.equal(await sourceIdentity({ type: 'paste', content: 'abc' }), await sourceIdentity({ type: 'paste', content: 'abc' }));
  });

  it('url and remote repo → pending (identity is known only after fetch)', async () => {
    assert.equal(await sourceIdentity({ type: 'url', ref: 'https://e.x/p' }), 'pending');
    assert.equal(await sourceIdentity({ type: 'repo', ref: 'https://github.com/a/b' }), 'pending');
  });

  it('local file → sha256 of its bytes', async () => {
    assert.equal(await sourceIdentity({ type: 'local', ref: path.join(dir, 'one.txt') }), sha('hello'));
  });

  it('local git repo → git:<HEAD sha> via the injected git runner; the runner is called in that directory', async () => {
    const calls = [];
    const git = (args, cwd) => { calls.push([args, cwd]); return 'abcdef1234567890abcdef1234567890abcdef12\n'; };
    const id = await sourceIdentity({ type: 'local', ref: path.join(dir, 'tree'), git, isGitRepo: () => true });
    assert.equal(id, 'git:abcdef1234567890abcdef1234567890abcdef12');
    assert.deepEqual(calls[0][0], ['rev-parse', 'HEAD']);
    assert.equal(calls[0][1], path.join(dir, 'tree'));
  });

  it('local non-git directory → sha256 of a sorted manifest of relative path + size, stable across runs and independent of mtime', async () => {
    const id1 = await sourceIdentity({ type: 'local', ref: path.join(dir, 'tree'), isGitRepo: () => false });
    const manifest = ['b.txt\t2', 'sub/a.txt\t1'].join('\n') + '\n';
    assert.equal(id1, sha(manifest));
    await fs.utimes(path.join(dir, 'tree', 'b.txt'), new Date(0), new Date(0));
    assert.equal(await sourceIdentity({ type: 'local', ref: path.join(dir, 'tree'), isGitRepo: () => false }), id1);
  });

  it('local manifest skips .git and node_modules', async () => {
    await fs.mkdir(path.join(dir, 'tree', 'node_modules', 'x'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tree', 'node_modules', 'x', 'i.js'), '1');
    await fs.mkdir(path.join(dir, 'tree', '.git'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tree', '.git', 'HEAD'), 'ref');
    const id = await sourceIdentity({ type: 'local', ref: path.join(dir, 'tree'), isGitRepo: () => false });
    assert.equal(id, sha(['b.txt\t2', 'sub/a.txt\t1'].join('\n') + '\n'));
  });

  it('unknown type is refused', async () => {
    await assert.rejects(() => sourceIdentity({ type: 'tarball', ref: 'x' }), /type/);
  });
});

describe('intake — intake()', () => {
  let dir;
  const now = () => new Date('2026-10-07T12:00:00Z');
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-intake-'));
    await fs.mkdir(path.join(dir, 'srcdir'), { recursive: true });
    await fs.writeFile(path.join(dir, 'srcdir', 'README.md'), '# tool');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('paste: creates the run dir, source.json and fetched/paste.txt, sets ACTIVE, identity known, not in registry', async () => {
    const r = await intake(dir, '-', { stdin: 'the pasted idea\nline 2', now });
    assert.equal(r.type, 'paste');
    assert.equal(r.runId, '2026-10-07-paste');
    assert.equal(r.identity, sha('the pasted idea\nline 2'));
    assert.equal(r.known, false);
    assert.equal(r.reuse_from, null);
    assert.equal(r.identity_pending, false);
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', '2026-10-07-paste');
    const source = await readJson(path.join(runDir, 'source.json'));
    assert.equal(source.type, 'paste');
    assert.equal(source.identity, r.identity);
    assert.equal(source.run, r.runId);
    assert.ok(source.ts);
    assert.equal(source.fetched, true, 'a paste has nothing left to fetch');
    assert.equal(await fs.readFile(path.join(runDir, 'fetched', 'paste.txt'), 'utf-8'), 'the pasted idea\nline 2');
    assert.equal(await activeRunId(dir), r.runId);
    assert.ok(await fs.stat(path.join(runDir, 'status.md')), 'status.md rendered');
  });

  it('paste file: --paste-file is read; an empty paste is refused and leaves no run dir', async () => {
    await fs.writeFile(path.join(dir, 'p.txt'), 'from a file');
    const r = await intake(dir, 'ignored', { pasteFile: path.join(dir, 'p.txt'), now, slug: 'pf' });
    assert.equal(r.type, 'paste');
    assert.equal(r.runId, '2026-10-07-pf');
    assert.equal(r.identity, sha('from a file'));
    await assert.rejects(() => intake(dir, '-', { stdin: '   \n', now, slug: 'empty' }), /empty/i);
    await assert.rejects(() => fs.stat(path.join(dir, '.claude', 'bbs', 'runs', '2026-10-07-empty')));
  });

  it('url: identity pending, fetched false, nothing under fetched/', async () => {
    const r = await intake(dir, 'https://example.com/post', { now });
    assert.equal(r.type, 'url');
    assert.equal(r.runId, '2026-10-07-example-com-post');
    assert.equal(r.identity, 'pending');
    assert.equal(r.identity_pending, true);
    assert.equal(r.known, false);
    const source = await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'source.json'));
    assert.equal(source.fetched, false);
    assert.equal(source.ref, 'https://example.com/post');
    await assert.rejects(() => fs.readdir(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'fetched')));
  });

  it('remote repo: identity pending, slug from the repo name', async () => {
    const r = await intake(dir, 'https://github.com/openqodex/openqodex', { now });
    assert.equal(r.type, 'repo');
    assert.equal(r.runId, '2026-10-07-openqodex');
    assert.equal(r.identity, 'pending');
  });

  it('local dir: identity is computed at intake and fetched is true', async () => {
    const r = await intake(dir, path.join(dir, 'srcdir'), { now, isGitRepo: () => false });
    assert.equal(r.type, 'local');
    assert.equal(r.runId, '2026-10-07-srcdir');
    assert.equal(r.identity, sha('README.md\t6\n'));
    assert.equal(r.identity_pending, false);
    const source = await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'source.json'));
    assert.equal(source.fetched, true);
    assert.equal(source.ref, path.join(dir, 'srcdir'), 'local refs are stored absolute');
  });

  it('a known identity is reported with reuse_from and the run is still created (it reuses, it does not re-audit)', async () => {
    await appendRegistry(dir, { identity: sha('known text'), type: 'paste', ref: 'paste', run: '2026-10-01-paste' });
    const r = await intake(dir, '-', { stdin: 'known text', now, slug: 'again' });
    assert.equal(r.known, true);
    assert.equal(r.reuse_from, '2026-10-01-paste');
    const source = await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'source.json'));
    assert.equal(source.reuse_from, '2026-10-01-paste');
  });

  it('--run names the run id explicitly and refuses an existing or malformed one', async () => {
    const r = await intake(dir, '-', { stdin: 'x', now, run: 'custom-run' });
    assert.equal(r.runId, 'custom-run');
    await assert.rejects(() => intake(dir, '-', { stdin: 'x', now, run: 'custom-run' }), /exists/i);
    await assert.rejects(() => intake(dir, '-', { stdin: 'x', now, run: 'bad/run' }), /run id/i);
  });

  it('a second intake moves ACTIVE to the new run', async () => {
    const r = await intake(dir, '-', { stdin: 'second', now, slug: 'second' });
    assert.equal(await activeRunId(dir), r.runId);
  });
});
