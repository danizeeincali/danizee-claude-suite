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
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { classifySource, slugFor, sourceIdentity, runIdFor, intake, redactRef, gitDirInside } from '../src/lib/bbs/intake.js';
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

  it('an empty paste names which input was empty', async () => {
    await assert.rejects(() => intake(dir, '-', { stdin: '  \n', now }), (e) => e.message === 'paste is empty (stdin)');
    const pf = path.join(dir, 'blank.txt');
    await fs.writeFile(pf, '   ');
    await assert.rejects(() => intake(dir, '-', { pasteFile: pf, now }), (e) => e.message === `paste is empty (--paste-file ${pf})`);
  });

  it('a second intake moves ACTIVE to the new run', async () => {
    const r = await intake(dir, '-', { stdin: 'second', now, slug: 'second' });
    assert.equal(await activeRunId(dir), r.runId);
  });
});

describe('intake — review r1 regressions', () => {
  let dir;
  const now = () => new Date('2026-10-07T12:00:00Z');
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r1-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('an existing local path containing whitespace is local, not paste', () => {
    const exists = (p) => p === '/Users/x/My Tool' || p === path.resolve('My Tool');
    assert.equal(classifySource('/Users/x/My Tool', { exists }), 'local');
    assert.equal(classifySource('My Tool', { exists }), 'local');
    assert.equal(classifySource('a short idea with spaces', { exists }), 'paste');
    assert.equal(classifySource('line one\nline two', { exists: () => true }), 'paste', 'multi-line text is never a path');
  });

  it('intake of a real directory whose name has a space is a local run', async () => {
    await fs.mkdir(path.join(dir, 'My Tool'), { recursive: true });
    await fs.writeFile(path.join(dir, 'My Tool', 'a.txt'), 'abc');
    const r = await intake(dir, path.join(dir, 'My Tool'), { now, isGitRepo: () => false });
    assert.equal(r.type, 'local');
    assert.equal(r.identity, sha('a.txt\t3\n'));
    assert.equal(r.runId, '2026-10-07-my-tool');
  });

  it('a non-existent path-like token is refused with a hint, not taken as paste', () => {
    for (const ref of ['./missing/dir', '/abs/missing', 'rel/missing', '~/nope', '.hidden', 'a\\b']) {
      assert.throws(() => classifySource(ref, { exists: existsNone }), (err) => /does not exist/.test(err.message) && /use --as paste or a full URL/.test(err.message), ref);
    }
  });

  it('a schemeless URL is refused with a hint, not taken as paste', () => {
    for (const ref of ['github.com/foo/bar', 'example.com', 'docs.example.com/a']) {
      assert.throws(() => classifySource(ref, { exists: existsNone }), (err) => /no scheme/.test(err.message) && /use --as paste or a full URL/.test(err.message), ref);
    }
    assert.equal(classifySource('whatever', { exists: existsNone }), 'paste', 'a plain word is still paste');
    assert.equal(classifySource('github.com/foo/bar', { exists: existsNone, as: 'paste' }), 'paste', '--as paste overrides');
  });

  it('intake of a non-existent path creates no run and leaves ACTIVE alone', async () => {
    const before = await activeRunId(dir);
    await assert.rejects(() => intake(dir, './missing/dir', { now }), /does not exist/);
    await assert.rejects(() => intake(dir, 'github.com/foo/bar', { now }), /no scheme/);
    await assert.rejects(() => fs.stat(path.join(dir, '.claude', 'bbs', 'runs', '2026-10-07-paste')));
    assert.equal(await activeRunId(dir), before);
  });

  it('manifest includes symlinks as path\\t->target, so a symlink-only dir differs from an empty one', async () => {
    const linked = path.join(dir, 'linked');
    await fs.mkdir(linked, { recursive: true });
    await fs.symlink('../elsewhere/target.txt', path.join(linked, 'link'));
    const id = await sourceIdentity({ type: 'local', ref: linked, isGitRepo: () => false });
    assert.equal(id, sha('link\t->../elsewhere/target.txt\n'));
    assert.notEqual(id, sha('\n'));
  });

  it('an empty local directory has no identity: it is refused as empty', async () => {
    const empty = path.join(dir, 'emptydir');
    await fs.mkdir(path.join(empty, 'only-a-subdir'), { recursive: true });
    await assert.rejects(() => sourceIdentity({ type: 'local', ref: empty, isGitRepo: () => false }), /empty/i);
  });

  it('--paste-file is hashed and stored as raw bytes, not decoded UTF-8', async () => {
    const bytes = Buffer.from([0x66, 0x6f, 0xff, 0xfe, 0x0a]);
    await fs.writeFile(path.join(dir, 'bin.txt'), bytes);
    const r = await intake(dir, 'ignored', { pasteFile: path.join(dir, 'bin.txt'), now, slug: 'raw' });
    assert.equal(r.identity, 'sha256:' + createHash('sha256').update(bytes).digest('hex'));
    const stored = await fs.readFile(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'fetched', 'paste.txt'));
    assert.ok(stored.equals(bytes), 'paste.txt holds the exact bytes');
  });

  it('runIdFor uses the local date of now(), not the UTC date', async () => {
    const prev = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const evening = new Date('2026-10-08T03:30:00Z'); // 2026-10-07 20:30 in Los Angeles
      assert.equal(await runIdFor(dir, 'late', { now: () => evening }), '2026-10-07-late');
    } finally {
      if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
    }
  });

  it('paste and local intake record the zero-egress row; url intake records none', async () => {
    const expectRow = async (runId, type) => {
      const rows = (await fs.readFile(path.join(dir, '.claude', 'bbs', 'runs', runId, 'egress.jsonl'), 'utf-8')).trim().split('\n').map(l => JSON.parse(l));
      assert.equal(rows.length, 1);
      const { ts, ...row } = rows[0];
      assert.ok(ts);
      assert.deepEqual(row, { kind: 'none', method: null, url: null, host: null, status: null, bytes_in: 0, bytes_out: 0, note: `nothing to fetch: ${type} source` });
    };
    const p = await intake(dir, '-', { stdin: 'zero egress', now, slug: 'zero' });
    await expectRow(p.runId, 'paste');
    await fs.mkdir(path.join(dir, 'loc'), { recursive: true });
    await fs.writeFile(path.join(dir, 'loc', 'f'), 'x');
    const l = await intake(dir, path.join(dir, 'loc'), { now, isGitRepo: () => false });
    await expectRow(l.runId, 'local');
    const u = await intake(dir, 'https://example.com/zero', { now });
    await assert.rejects(() => fs.stat(path.join(dir, '.claude', 'bbs', 'runs', u.runId, 'egress.jsonl')));
    const status = await fs.readFile(path.join(dir, '.claude', 'bbs', 'runs', p.runId, 'status.md'), 'utf-8');
    assert.match(status, /- Egress: requests=0 bytes_in=0 bodies_sent=0 hosts=none\n/);
    assert.match(status, /\| fetch \| done \|/);
  });
});

describe('intake — review r2 regressions', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r2-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'bbs', 'cli.js');

  it('6 parallel intakes with the same slug get 6 distinct run ids, each with its own matching source.json', async () => {
    const proj = await fs.mkdtemp(path.join(dir, 'par-'));
    const runOne = (i) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, 'intake', '-', '--slug', 'same', '--project', proj], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => code === 0 ? resolve({ json: JSON.parse(out), text: `paste-${i}` }) : reject(new Error(err)));
      child.stdin.end(`paste-${i}`);
    });
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map(runOne));
    const ids = results.map(r => r.json.runId);
    assert.equal(new Set(ids).size, 6, ids.join(','));
    for (const r of results) {
      const src = await readJson(path.join(proj, '.claude', 'bbs', 'runs', r.json.runId, 'source.json'));
      assert.equal(src.run, r.json.runId);
      assert.equal(src.identity, r.json.identity);
      assert.equal(src.identity, sha(r.text));
    }
  });

  it('a failure after the claim removes the run dir and leaves ACTIVE unchanged', async () => {
    const proj = await fs.mkdtemp(path.join(dir, 'fail-'));
    const first = await intake(proj, '-', { stdin: 'one', slug: 'keep' });
    await assert.rejects(() => intake(proj, '-', {
      stdin: 'two', slug: 'boom', onBeforeSource: () => { throw new Error('injected'); }
    }), /injected/);
    assert.equal(await activeRunId(proj), first.runId);
    const entries = await fs.readdir(path.join(proj, '.claude', 'bbs', 'runs'));
    assert.deepEqual(entries, [first.runId]);
  });

  it('source.json is written last: when it fails, paste.txt and egress.jsonl were already complete and the run is removed', async () => {
    const proj = await fs.mkdtemp(path.join(dir, 'order-'));
    let seen;
    await assert.rejects(() => intake(proj, '-', {
      stdin: 'ordered', slug: 'ord',
      onBeforeSource: async (runDir) => {
        seen = {
          paste: await fs.readFile(path.join(runDir, 'fetched', 'paste.txt'), 'utf-8'),
          egress: (await fs.readFile(path.join(runDir, 'egress.jsonl'), 'utf-8')).trim().split('\n').length,
          source: await fs.stat(path.join(runDir, 'source.json')).then(() => true, () => false)
        };
        throw new Error('stop');
      }
    }), /stop/);
    assert.deepEqual(seen, { paste: 'ordered', egress: 1, source: false });
  });

  it('a git failure (no commits / no git) falls back to the manifest identity with a note', async () => {
    const proj = await fs.mkdtemp(path.join(dir, 'git-'));
    const src = path.join(proj, 'src-dir');
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, 'a.txt'), 'hello');
    const git = () => { throw new Error('fatal: ambiguous argument HEAD'); };
    const r = await intake(proj, src, { git, isGitRepo: () => true, slug: 'nogit' });
    assert.match(r.identity, /^sha256:/);
    assert.match(r.note, /^git HEAD unavailable \(.+\); identity is a file manifest$/);
    const sj = await readJson(path.join(proj, '.claude', 'bbs', 'runs', r.runId, 'source.json'));
    assert.equal(sj.identity_note, r.note);
    const ok = await intake(proj, src, { git: () => 'abc123\n', isGitRepo: () => true, slug: 'withgit' });
    assert.equal(ok.identity, 'git:abc123');
    assert.equal(ok.note, undefined);
  });
});

describe('intake — review r4 regressions', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r4-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  const runFiles = async (proj, runId) => {
    const runDir = path.join(proj, '.claude', 'bbs', 'runs', runId);
    return {
      source: await fs.readFile(path.join(runDir, 'source.json'), 'utf-8'),
      status: await fs.readFile(path.join(runDir, 'status.md'), 'utf-8')
    };
  };

  it('redactRef strips http userinfo, masks token-like query values and strips ssh passwords', () => {
    assert.equal(redactRef('https://user:pw@h/p'), 'https://h/p');
    assert.equal(redactRef('https://alice:ghp_SECRET@host/x?token=abc'), 'https://host/x?token=<redacted>');
    assert.equal(redactRef('https://h/p?token=abc&x=1'), 'https://h/p?token=<redacted>&x=1');
    assert.equal(redactRef('https://h/p?API_KEY=k&Signature=s&q=v&access_token=t&pwd=p'),
      'https://h/p?API_KEY=<redacted>&Signature=<redacted>&q=v&access_token=<redacted>&pwd=<redacted>');
    assert.equal(redactRef('https://github.com/a/b'), 'https://github.com/a/b');
    assert.equal(redactRef('http://example.com'), 'http://example.com');
    assert.equal(redactRef('git@github.com:a/b.git'), 'git@github.com:a/b.git');
    assert.equal(redactRef('git:hunter2@github.com:a/b.git'), 'git@github.com:a/b.git');
    assert.equal(redactRef('ssh://git:hunter2@gitlab.com/a/b'), 'ssh://git@gitlab.com/a/b');
    assert.equal(redactRef('ssh://git@gitlab.com/a/b'), 'ssh://git@gitlab.com/a/b');
    assert.equal(redactRef('/some/local/path'), '/some/local/path');
  });

  it('an http ref with userinfo is refused at intake and no run is created', async () => {
    const proj = await fs.mkdtemp(path.join(dir, 'userinfo-'));
    for (const ref of ['https://alice:ghp_SECRET@github.com/a/b', 'https://alice@example.com/post']) {
      await assert.rejects(() => intake(proj, ref, { slug: 'cred' }),
        (err) => err.message === 'refs with embedded credentials are not accepted — pass the URL without userinfo', ref);
    }
    const runs = await fs.readdir(path.join(proj, '.claude', 'bbs', 'runs')).catch(() => []);
    assert.deepEqual(runs, []);
    assert.equal(await activeRunId(proj), null);
  });

  it('query tokens are masked in source.json, the result and status.md; the raw value is never persisted', async () => {
    const proj = await fs.mkdtemp(path.join(dir, 'query-'));
    const r = await intake(proj, 'https://example.com/post?token=abc&x=1', {});
    assert.equal(r.ref, 'https://example.com/post?token=<redacted>&x=1');
    const { source, status } = await runFiles(proj, r.runId);
    assert.equal(JSON.parse(source).ref, 'https://example.com/post?token=<redacted>&x=1');
    for (const text of [source, status, JSON.stringify(r)]) {
      assert.ok(text.includes('token=<redacted>'), text);
      assert.ok(text.includes('x=1'), text);
      assert.ok(!text.includes('abc'), text);
    }
  });

  it('an ssh ref with a password is stored without it', async () => {
    const proj = await fs.mkdtemp(path.join(dir, 'ssh-'));
    const r = await intake(proj, 'ssh://git:hunter2@gitlab.com/a/b', {});
    assert.equal(r.ref, 'ssh://git@gitlab.com/a/b');
    const { source, status } = await runFiles(proj, r.runId);
    assert.ok(!source.includes('hunter2') && !status.includes('hunter2'));
  });

  async function gitRepo(root, name, file) {
    const repo = path.join(root, name);
    await fs.mkdir(repo, { recursive: true });
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^GIT_/.test(k)) delete env[k];
    const run = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8', env });
    run('init', '-q');
    run('config', 'user.email', 'bbs@test.invalid');
    run('config', 'user.name', 'bbs test');
    run('config', 'commit.gpgsign', 'false');
    await fs.writeFile(path.join(repo, file), file);
    run('add', file);
    run('commit', '-q', '-m', name);
    return { repo, head: run('rev-parse', 'HEAD').trim() };
  }

  it('the default git runner ignores an inherited GIT_DIR: identity comes from the named repo', async () => {
    const root = await fs.mkdtemp(path.join(dir, 'gitdir-env-'));
    const a = await gitRepo(root, 'a', 'a.txt');
    const b = await gitRepo(root, 'b', 'b.txt');
    assert.notEqual(a.head, b.head);
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = path.join(a.repo, '.git');
    process.env.GIT_WORK_TREE = a.repo;
    try {
      assert.equal(await sourceIdentity({ type: 'local', ref: b.repo }), 'git:' + b.head);
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it('a normal .git directory still gives the git identity with the default runner', async () => {
    const root = await fs.mkdtemp(path.join(dir, 'gitdir-normal-'));
    const b = await gitRepo(root, 'b', 'b.txt');
    assert.equal(gitDirInside(b.repo), true);
    assert.equal(await sourceIdentity({ type: 'local', ref: b.repo }), 'git:' + b.head);
  });

  it('a .git symlink or a gitdir file pointing outside the source falls back to the manifest with a note', async () => {
    const root = await fs.mkdtemp(path.join(dir, 'gitdir-out-'));
    const a = await gitRepo(root, 'a', 'a.txt');
    const linked = path.join(root, 'linked');
    await fs.mkdir(linked);
    await fs.writeFile(path.join(linked, 'f.txt'), 'x');
    await fs.symlink(path.join(a.repo, '.git'), path.join(linked, '.git'));
    const filed = path.join(root, 'filed');
    await fs.mkdir(filed);
    await fs.writeFile(path.join(filed, 'f.txt'), 'x');
    await fs.writeFile(path.join(filed, '.git'), `gitdir: ${path.relative(filed, path.join(a.repo, '.git'))}\n`);
    for (const src of [linked, filed]) {
      const proj = await fs.mkdtemp(path.join(dir, 'gitdir-proj-'));
      const r = await intake(proj, src, { slug: 'outside' });
      assert.match(r.identity, /^sha256:/, src);
      assert.notEqual(r.identity, 'git:' + a.head);
      assert.match(r.note, /^git dir points outside the source \(.+\); identity is a file manifest$/, src);
      const sj = await readJson(path.join(proj, '.claude', 'bbs', 'runs', r.runId, 'source.json'));
      assert.equal(sj.identity_note, r.note);
    }
  });

  it('a .git dir whose commondir points outside the source falls back to the manifest with a note', async () => {
    const root = await fs.mkdtemp(path.join(dir, 'commondir-'));
    const a = await gitRepo(root, 'a', 'a.txt');
    const b = await gitRepo(root, 'b', 'b.txt');
    await fs.writeFile(path.join(b.repo, '.git', 'commondir'), path.join(a.repo, '.git') + '\n');
    assert.deepEqual(gitDirInside(b.repo), { outside: 'commondir resolves outside the source' });
    const proj = await fs.mkdtemp(path.join(dir, 'commondir-proj-'));
    const r = await intake(proj, b.repo, { slug: 'common' });
    assert.match(r.identity, /^sha256:/);
    assert.equal(r.note, 'git dir points outside the source (commondir resolves outside the source); identity is a file manifest');
  });

  it('a gitdir file that resolves inside the source is accepted', async () => {
    const root = await fs.mkdtemp(path.join(dir, 'gitdir-in-'));
    const b = await gitRepo(root, 'b', 'b.txt');
    await fs.rename(path.join(b.repo, '.git'), path.join(b.repo, '.realgit'));
    await fs.writeFile(path.join(b.repo, '.git'), 'gitdir: .realgit\n');
    assert.equal(gitDirInside(b.repo), true);
    assert.equal(await sourceIdentity({ type: 'local', ref: b.repo }), 'git:' + b.head);
  });
});
