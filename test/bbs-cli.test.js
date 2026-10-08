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

function run(cwd, args, input) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input });
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
    assert.match(r.err, /usage: cli\.js intake <source>/);
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
