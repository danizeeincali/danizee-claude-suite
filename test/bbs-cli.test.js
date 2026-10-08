/**
 * Integration contract for src/lib/bbs/cli.js — stream `intake` of marathon 2026-10-07-bbs.
 * Verbs in this stream: intake · status [--next] · report. Later streams add fetch, inventory, map, verdict, handoff.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const CLI = path.join(ROOT, 'src', 'lib', 'bbs', 'cli.js');
const sha = (s) => 'sha256:' + createHash('sha256').update(s).digest('hex');

function run(cwd, args, input, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input, ...(env ? { env } : {}) });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

describe('bbs cli — dispatch and project resolution', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-cli-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('unknown verb → usage on stderr, exit 1, nothing on stdout', () => {
    const r = run(dir, ['frobnicate']);
    assert.equal(r.code, 1);
    assert.match(r.err, /usage: cli\.js </);
    assert.match(r.err, /intake/);
    assert.equal(r.out, '');
  });

  it('status with no run → exit 1 with a hint to run intake', () => {
    const r = run(dir, ['status']);
    assert.equal(r.code, 1);
    assert.match(r.err, /no active run/i);
    assert.match(r.err, /intake/);
  });

  it('--project points at another directory; the run lands there, not in cwd', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-other-'));
    try {
      const r = run(dir, ['intake', '-', '--project', other, '--slug', 'proj'], 'pasted');
      assert.equal(r.code, 0, r.err);
      assert.ok(await fs.stat(path.join(other, '.claude', 'bbs', 'runs', r.json.runId, 'source.json')));
      await assert.rejects(() => fs.stat(path.join(dir, '.claude', 'bbs')));
    } finally { await fs.rm(other, { recursive: true, force: true }); }
  });

  it('resolves the project root from a subdirectory of a git checkout', async () => {
    const proj = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-git-'));
    try {
      spawnSync('git', ['init', '-q', '.'], { cwd: proj });
      await fs.mkdir(path.join(proj, 'deep', 'er'), { recursive: true });
      const r = run(path.join(proj, 'deep', 'er'), ['intake', '-', '--slug', 'deep'], 'pasted');
      assert.equal(r.code, 0, r.err);
      assert.ok(await fs.stat(path.join(proj, '.claude', 'bbs', 'runs', r.json.runId, 'source.json')));
    } finally { await fs.rm(proj, { recursive: true, force: true }); }
  });
});

describe('bbs cli — intake, status, report', () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-cli2-'));
    await fs.mkdir(path.join(dir, 'tool'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tool', 'README.md'), '# a tool\n');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('intake with no source → exit 1 and usage', () => {
    const r = run(dir, ['intake']);
    assert.equal(r.code, 1);
    assert.match(r.err, /usage: cli\.js intake <source\|->/);
  });

  it('intake of pasted stdin → JSON result, run dir, ACTIVE, status.md', async () => {
    const r = run(dir, ['intake', '-'], 'an idea\n');
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.type, 'paste');
    assert.equal(r.json.identity, sha('an idea\n'));
    assert.equal(r.json.known, false);
    assert.match(r.json.runId, /^\d{4}-\d{2}-\d{2}-paste$/);
    assert.equal(r.json.next, 'inventory', 'a paste has nothing to fetch');
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.json.runId);
    assert.equal(r.json.runDir, path.relative(dir, runDir));
    const status = await fs.readFile(path.join(runDir, 'status.md'), 'utf-8');
    assert.match(status, /- Next: `cli\.js inventory`/);
    assert.equal((await fs.readFile(path.join(dir, '.claude', 'bbs', 'ACTIVE'), 'utf-8')).trim(), r.json.runId);
  });

  it('intake of a local directory → identity computed, next is inventory', () => {
    const r = run(dir, ['intake', path.join(dir, 'tool')]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.type, 'local');
    assert.match(r.json.runId, /-tool$/);
    assert.match(r.json.identity, /^sha256:/);
    assert.equal(r.json.next, 'inventory');
  });

  it('intake of a URL → identity pending, next is fetch; --as forces the type', () => {
    const r = run(dir, ['intake', 'https://example.com/article']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.type, 'url');
    assert.equal(r.json.identity, 'pending');
    assert.equal(r.json.next, 'fetch');
    const r2 = run(dir, ['intake', 'https://github.com/a/b', '--as', 'url', '--slug', 'forced']);
    assert.equal(r2.code, 0, r2.err);
    assert.equal(r2.json.type, 'url');
    assert.equal(r2.json.runId.endsWith('-forced'), true);
  });

  it('intake refuses an unsupported scheme with exit 1 and leaves no run', () => {
    const r = run(dir, ['intake', 'ftp://host/thing']);
    assert.equal(r.code, 1);
    assert.match(r.err, /scheme/i);
  });

  it('status prints status.md for the ACTIVE run; --run picks another; --next prints only the verb', () => {
    const paste = run(dir, ['intake', '-', '--slug', 'st'], 'x');
    assert.equal(paste.code, 0, paste.err);
    const s = run(dir, ['status']);
    assert.equal(s.code, 0, s.err);
    assert.match(s.out, new RegExp(`^# bbs ${paste.json.runId}\\n`));
    const url = run(dir, ['intake', 'https://example.com/other', '--slug', 'other']);
    assert.equal(url.code, 0, url.err);
    const s2 = run(dir, ['status', '--run', paste.json.runId]);
    assert.match(s2.out, new RegExp(`^# bbs ${paste.json.runId}\\n`));
    const n = run(dir, ['status', '--next']);
    assert.equal(n.out.trim(), 'fetch', 'the active run is the url one now');
    const n2 = run(dir, ['status', '--next', '--run', paste.json.runId]);
    assert.equal(n2.out.trim(), 'inventory');
  });

  it('status --run with an unknown id → exit 1', () => {
    const r = run(dir, ['status', '--run', 'nope-nope']);
    assert.equal(r.code, 1);
    assert.match(r.err, /nope-nope/);
  });

  it('report prints the one summary line', () => {
    const r = run(dir, ['report']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.trim(), 'found=0 approved=0 skipped=0 buy=0 marathon=none');
  });

  it('every verb re-renders status.md (status.md mtime moves after report)', async () => {
    const active = (await fs.readFile(path.join(dir, '.claude', 'bbs', 'ACTIVE'), 'utf-8')).trim();
    const file = path.join(dir, '.claude', 'bbs', 'runs', active, 'status.md');
    await fs.utimes(file, new Date(0), new Date(0));
    run(dir, ['report']);
    const st = await fs.stat(file);
    assert.ok(st.mtimeMs > 1000, 'status.md was re-rendered');
  });
});

describe('bbs cli — review r1 regressions', () => {
  let dir;
  let runId;
  const runs = () => path.join(dir, '.claude', 'bbs', 'runs');
  const exists = async (p) => { try { await fs.stat(p); return true; } catch { return false; } };
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-cli-r1-'));
    const r = run(dir, ['intake', '-', '--slug', 'r1'], 'seed');
    assert.equal(r.code, 0, r.err);
    runId = r.json.runId;
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('status --run with a traversal id is refused and writes nothing outside the runs dir', async () => {
    await fs.mkdir(path.join(dir, '.claude', 'bbs', 'x'), { recursive: true });
    for (const id of ['../x', '../../..', '..', '.', 'a/b']) {
      const r = run(dir, ['status', '--run', id]);
      assert.equal(r.code, 1, id);
      assert.equal(r.err, `bbs: invalid run id "${id}" (letters, digits and -, up to 81 chars, starting with a letter or digit)\n`, id);
      assert.equal(r.out, '', id);
    }
    assert.equal(await exists(path.join(dir, '.claude', 'bbs', 'x', 'status.md')), false);
    assert.equal(await exists(path.join(dir, 'status.md')), false);
    assert.equal(await exists(path.join(dir, '.claude', 'bbs', 'status.md')), false);
    assert.equal(await exists(path.join(runs(), 'status.md')), false);
  });

  it("status --run '' is refused (it must not render the runs dir)", async () => {
    const r = run(dir, ['status', '--run', '']);
    assert.equal(r.code, 1);
    assert.equal(r.err, 'bbs: invalid run id "" (letters, digits and -, up to 81 chars, starting with a letter or digit)\n');
    assert.equal(await exists(path.join(runs(), 'status.md')), false);
  });

  it('a tampered ACTIVE renders nothing for status or report', async () => {
    const active = path.join(dir, '.claude', 'bbs', 'ACTIVE');
    try {
      for (const bad of ['../../..', '..', '../x']) {
        await fs.writeFile(active, bad + '\n');
        for (const verb of ['status', 'report']) {
          const r = run(dir, [verb]);
          assert.equal(r.code, 1, `${verb} ${bad}`);
          assert.equal(r.err, `bbs: invalid run id "${bad}" (letters, digits and -, up to 81 chars, starting with a letter or digit)\n`, `${verb} ${bad}`);
          assert.equal(r.out, '');
        }
      }
      assert.equal(await exists(path.join(dir, 'status.md')), false);
      assert.equal(await exists(path.join(dir, '.claude', 'bbs', 'x', 'status.md')), false);
      assert.equal(await exists(path.join(dir, '.claude', 'status.md')), false);
    } finally { await fs.writeFile(active, runId + '\n'); }
  });

  it('a value flag with no value is a usage error, exit 1', async () => {
    const before = (await fs.readdir(runs())).sort();
    for (const args of [
      ['status', '--run'], ['report', '--run'], ['status', '--run', '--next'],
      ['intake', 'https://example.com/a', '--run'], ['intake', '-', '--as'], ['intake', '-', '--slug'],
      ['intake', '-', '--project'], ['status', '--project'], ['intake', '--paste-file']
    ]) {
      const r = run(dir, args, 'stdin text');
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.err, /^usage: cli\.js /, args.join(' '));
      assert.equal(r.out, '', args.join(' '));
    }
    assert.deepEqual((await fs.readdir(runs())).sort(), before, 'no run was created');
  });

  it('an unknown flag is a usage error, exit 1', () => {
    for (const args of [['status', '--frob'], ['report', '--next'], ['intake', '-', '--next'], ['intake', '-', '--frob', 'x']]) {
      const r = run(dir, args, 'stdin text');
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.err, /^usage: cli\.js /, args.join(' '));
      assert.match(r.err, /--(frob|next)/, args.join(' '));
    }
  });

  it('--project still works for every verb', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r1-proj-'));
    try {
      const i = run(dir, ['intake', '-', '--project', other, '--slug', 'pp'], 'x');
      assert.equal(i.code, 0, i.err);
      assert.equal(run(dir, ['status', '--project', other]).code, 0);
      assert.equal(run(dir, ['status', '--next', '--project', other]).out.trim(), 'inventory');
      assert.equal(run(dir, ['report', '--project', other]).code, 0);
    } finally { await fs.rm(other, { recursive: true, force: true }); }
  });

  it('--paste-file combined with a positional other than "-" is a usage error; with "-" it is accepted', async () => {
    const pf = path.join(dir, 'pf.txt');
    await fs.writeFile(pf, 'from the file');
    const before = (await fs.readdir(runs())).sort();
    const r = run(dir, ['intake', 'https://example.com/x', '--paste-file', pf]);
    assert.equal(r.code, 1);
    assert.match(r.err, /^usage: cli\.js intake/);
    assert.deepEqual((await fs.readdir(runs())).sort(), before);
    const ok = run(dir, ['intake', '-', '--paste-file', pf, '--slug', 'pfok']);
    assert.equal(ok.code, 0, ok.err);
    assert.equal(ok.json.identity, sha('from the file'));
    const alone = run(dir, ['intake', '--paste-file', pf, '--slug', 'pfalone']);
    assert.equal(alone.code, 0, alone.err);
  });
});

describe('bbs cli — review r2 regressions', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-cli-r2-')); });
  after(async () => { await fs.chmod(dir, 0o755).catch(() => {}); await fs.rm(dir, { recursive: true, force: true }); });

  it('status on a read-only run dir still prints the markdown, warns on stderr, exits 0', async () => {
    const proj = await fs.mkdtemp(path.join(dir, 'ro-'));
    const r1 = run(proj, ['intake', '-', '--slug', 'ro', '--project', proj], 'text');
    assert.equal(r1.code, 0, r1.err);
    const runPath = path.join(proj, '.claude', 'bbs', 'runs', r1.json.runId);
    await fs.chmod(runPath, 0o555);
    try {
      if (process.getuid && process.getuid() === 0) return; // root ignores modes
      const r = run(proj, ['status', '--project', proj]);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^# bbs /);
      assert.match(r.err, new RegExp(`bbs: warning: could not write ${r1.json.runId}/status\\.md \\(EACCES\\)`));
    } finally { await fs.chmod(runPath, 0o755); }
  });

  it('without git, the project root is the nearest ancestor with .claude, silently', async () => {
    const root = await fs.mkdtemp(path.join(dir, 'marker-'));
    await fs.mkdir(path.join(root, '.claude'));
    const sub = path.join(root, 'a', 'b');
    await fs.mkdir(sub, { recursive: true });
    const real = await fs.realpath(root);
    const r = run(sub, ['intake', '-', '--slug', 'walk'], 'text', { ...process.env, PATH: '/nonexistent' });
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /no git checkout found/);
    await fs.stat(path.join(real, '.claude', 'bbs', 'runs', r.json.runId, 'source.json'));
    await assert.rejects(() => fs.stat(path.join(sub, '.claude')));
  });

  it('without git and without any marker, falls back to cwd and warns on stderr', async () => {
    const lone = await fs.mkdtemp(path.join(dir, 'lone-'));
    const real = await fs.realpath(lone);
    const r = run(lone, ['intake', '-', '--slug', 'lone'], 'text', { ...process.env, PATH: '/nonexistent' });
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /bbs: warning: no git checkout found, using .+ as the project root \(pass --project to override\)/);
    await fs.stat(path.join(real, '.claude', 'bbs', 'runs', r.json.runId, 'source.json'));
  });
});

describe('bbs cli — review r3 regressions', () => {
  it('stdin and --paste-file with non-UTF-8 bytes give equal identities and byte-identical paste.txt', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r3-bytes-'));
    try {
      const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
      const file = path.join(dir, 'in.bin');
      await fs.writeFile(file, bytes);
      const a = spawnSync(process.execPath, [CLI, 'intake', '-', '--project', dir, '--run', 'a'], { input: bytes });
      const b = spawnSync(process.execPath, [CLI, 'intake', '--paste-file', file, '--project', dir, '--run', 'b']);
      assert.equal(a.status, 0, a.stderr.toString());
      assert.equal(b.status, 0, b.stderr.toString());
      const ja = JSON.parse(a.stdout.toString());
      const jb = JSON.parse(b.stdout.toString());
      assert.equal(ja.identity, jb.identity);
      assert.equal(ja.identity, 'sha256:' + createHash('sha256').update(bytes).digest('hex'));
      for (const id of ['a', 'b']) {
        const p = await fs.readFile(path.join(dir, '.claude', 'bbs', 'runs', id, 'fetched', 'paste.txt'));
        assert.ok(p.equals(bytes));
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('a .claude directory at $HOME is not a project marker; falls back to cwd with a warning', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r3-home-'));
    try {
      await fs.mkdir(path.join(home, '.claude'));
      const cwd = path.join(home, 'work', 'nested');
      await fs.mkdir(cwd, { recursive: true });
      const env = { ...process.env, HOME: home, PATH: '/nonexistent' };
      const r = run(cwd, ['intake', '-', '--slug', 'h'], 'pasted', env);
      assert.equal(r.code, 0, r.err);
      assert.match(r.err, /warning/i);
      const real = await fs.realpath(cwd);
      assert.ok(await fs.stat(path.join(real, '.claude', 'bbs', 'runs')));
      await assert.rejects(() => fs.stat(path.join(home, '.claude', 'bbs')));
    } finally { await fs.rm(home, { recursive: true, force: true }); }
  });

  it('running cli.js through a symlinked directory still dispatches', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r3-link-'));
    try {
      const link = path.join(dir, 'link');
      await fs.symlink(path.dirname(CLI), link);
      const r = spawnSync(process.execPath, [path.join(link, 'cli.js'), 'frobnicate'], { cwd: dir, encoding: 'utf-8' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /usage: cli\.js </);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('explicit --run ids are lower-cased', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r3-case-'));
    try {
      const r = run(dir, ['intake', '-', '--project', dir, '--run', 'Foo-Bar'], 'x');
      assert.equal(r.code, 0, r.err);
      assert.equal(r.json.runId, 'foo-bar');
      assert.ok(await fs.stat(path.join(dir, '.claude', 'bbs', 'runs', 'foo-bar')));
      assert.equal((await fs.readFile(path.join(dir, '.claude', 'bbs', 'ACTIVE'), 'utf-8')).trim(), 'foo-bar');
      const s = run(dir, ['status', '--project', dir, '--run', 'FOO-BAR']);
      assert.equal(s.code, 0, s.err);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('bbs cli — review r4 regressions', () => {
  it('intake of an http ref with userinfo exits 1 with the credentials message, prints nothing secret and creates no run', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r4-cred-'));
    try {
      const r = run(dir, ['intake', 'https://alice:ghp_SECRET@github.com/a/b', '--project', dir]);
      assert.equal(r.code, 1);
      assert.equal(r.err, 'bbs: refs with embedded credentials are not accepted — pass the URL without userinfo\n');
      assert.ok(!r.out.includes('ghp_SECRET'));
      const runs = await fs.readdir(path.join(dir, '.claude', 'bbs', 'runs')).catch(() => []);
      assert.deepEqual(runs, []);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('intake masks query tokens in stdout and status.md', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r4-q-'));
    try {
      const r = run(dir, ['intake', 'https://example.com/post?token=abc&x=1', '--project', dir]);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.json.ref, 'https://example.com/post?token=<redacted>&x=1');
      assert.ok(!r.out.includes('abc'));
      const md = await fs.readFile(path.join(dir, '.claude', 'bbs', 'runs', r.json.runId, 'status.md'), 'utf-8');
      assert.ok(md.includes('token=<redacted>&x=1') && !md.includes('abc'), md);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('a .claude/bbs.json with paths.runs outside .claude/bbs fails loudly and writes nothing outside', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-r4-cfg-'));
    try {
      const proj = path.join(dir, 'proj');
      await fs.mkdir(path.join(proj, '.claude'), { recursive: true });
      await fs.writeFile(path.join(proj, '.claude', 'bbs.json'), JSON.stringify({ paths: { runs: '../escaped' } }));
      const r = run(proj, ['intake', '-', '--project', proj], 'x');
      assert.equal(r.code, 1);
      assert.match(r.err, /paths\.runs "\.\.\/escaped" must stay under \.claude\/bbs/);
      await assert.rejects(() => fs.stat(path.join(dir, 'escaped')));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('bbs cli — review r5 regressions', () => {
  let dir;
  let runId;
  const runs = () => path.join(dir, '.claude', 'bbs', 'runs');
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-cli-r5-'));
    const r = run(dir, ['intake', '-', '--slug', 'r5'], 'seed');
    assert.equal(r.code, 0, r.err);
    runId = r.json.runId;
  });
  after(async () => { await fs.chmod(dir, 0o755).catch(() => {}); await fs.rm(dir, { recursive: true, force: true }); });

  it('stray positionals are refused: status first / report x / intake a.txt extra', async () => {
    const r2 = run(dir, ['intake', '-', '--slug', 'other'], 'second');
    assert.equal(r2.code, 0, r2.err);
    const before = (await fs.readdir(runs())).sort();
    const s = run(dir, ['status', runId]);
    assert.equal(s.code, 1);
    assert.equal(s.out, '');
    assert.doesNotMatch(s.out, /# bbs/);
    assert.equal(s.err, 'usage: cli.js status [--run <id>] [--next] [--project <dir>]\n  unexpected argument "' + runId + '" (use --run <id>)\n');
    const rep = run(dir, ['report', 'x']);
    assert.equal(rep.code, 1);
    assert.equal(rep.out, '');
    assert.equal(rep.err, 'usage: cli.js report [--run <id>] [--project <dir>]\n  unexpected argument "x" (use --run <id>)\n');
    const i = run(dir, ['intake', 'a.txt', 'extra'], '');
    assert.equal(i.code, 1);
    assert.equal(i.out, '');
    assert.match(i.err, /^usage: cli\.js intake <source\|->/);
    assert.match(i.err, /\n {2}unexpected argument "extra"\n$/);
    assert.deepEqual((await fs.readdir(runs())).sort(), before, 'no run was created');
  });

  it('run-id errors name the rule and the next step', async () => {
    const bad = run(dir, ['status', '--run', 'a/b']);
    assert.equal(bad.code, 1);
    assert.equal(bad.err, 'bbs: invalid run id "a/b" (letters, digits and -, up to 81 chars, starting with a letter or digit)\n');
    const unk = run(dir, ['status', '--run', 'nope']);
    assert.equal(unk.code, 1);
    assert.equal(unk.err, 'bbs: unknown run "nope" — no directory under .claude/bbs/runs/; omit --run to use the active run\n');
    const dup = run(dir, ['intake', '-', '--run', runId], 'again');
    assert.equal(dup.code, 1);
    assert.equal(dup.err, `bbs: run "${runId}" already exists — pick another --run or omit it\n`);
  });

  it('top-level usage lists every verb with its flags and the - stdin source', () => {
    const r = run(dir, ['frobnicate']);
    assert.equal(r.code, 1);
    const lines = r.err.split('\n');
    assert.equal(lines[0], 'usage: cli.js <intake|status|report> ...');
    assert.ok(r.err.includes('  cli.js intake <source|-> [--paste-file <p>] [--as repo|url|local|paste] [--slug <s>] [--run <id>] [--project <dir>]\n'), r.err);
    assert.ok(r.err.includes('  cli.js status [--run <id>] [--next] [--project <dir>]\n'), r.err);
    assert.ok(r.err.includes('  cli.js report [--run <id>] [--project <dir>]\n'), r.err);
    assert.ok(r.err.endsWith('  <source> may be - to read a paste from stdin\n'), r.err);
    const i = run(dir, ['intake']);
    assert.match(i.err, /^usage: cli\.js intake <source\|-> /);
  });

  it('an empty paste names its input', async () => {
    const a = run(dir, ['intake', '-'], '   \n');
    assert.equal(a.code, 1);
    assert.equal(a.err, 'bbs: paste is empty (stdin)\n');
    const pf = path.join(dir, 'empty-paste.txt');
    await fs.writeFile(pf, '  ');
    const b = run(dir, ['intake', '--paste-file', pf]);
    assert.equal(b.code, 1);
    assert.equal(b.err, `bbs: paste is empty (--paste-file ${pf})\n`);
  });

  it('report on a read-only run dir prints the line, warns naming <run>/status.md, exits 0', async () => {
    if (process.getuid && process.getuid() === 0) return; // root ignores modes
    const proj = await fs.mkdtemp(path.join(dir, 'ro-'));
    const r1 = run(proj, ['intake', '-', '--slug', 'ro', '--project', proj], 'text');
    assert.equal(r1.code, 0, r1.err);
    const runPath = path.join(proj, '.claude', 'bbs', 'runs', r1.json.runId);
    await fs.chmod(runPath, 0o555);
    try {
      const r = run(proj, ['report', '--project', proj]);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^found=\d+ approved=\d+ skipped=\d+ buy=\d+ marathon=/);
      assert.equal(r.err, `bbs: warning: could not write ${r1.json.runId}/status.md (EACCES)\n`);
      const s = run(proj, ['status', '--project', proj]);
      assert.equal(s.err, `bbs: warning: could not write ${r1.json.runId}/status.md (EACCES)\n`);
    } finally { await fs.chmod(runPath, 0o755); }
  });
});
