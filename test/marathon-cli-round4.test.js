/**
 * Integration tests from review round 4 (dry run + trust boundary).
 * The review ledger can only be changed through the two sanctioned paths (record review, replaces=
 * of the latest round); every stream is isolated before it is active; no wake path leaves a finished
 * run hanging; the reviewer is told about excluded files.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const CLI = path.join(ROOT, 'src', 'lib', 'marathon', 'cli.js');
const TEMPLATES = path.join(ROOT, 'src', 'templates', 'marathon');

function run(cwd, args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', env: { ...process.env, ...env } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

async function makeProject(name) {
  const dir = path.join(os.tmpdir(), `marathon-r4-${name}-${Date.now()}`);
  await fs.mkdir(path.join(dir, '.claude', 'marathon', 'reviewer'), { recursive: true });
  spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  await fs.writeFile(path.join(dir, 'a.txt'), 'hi\n');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  for (const f of ['severity.md', 'angles.md']) {
    await fs.copyFile(path.join(TEMPLATES, 'reviewer', f), path.join(dir, '.claude', 'marathon', 'reviewer', f));
  }
  await fs.copyFile(path.join(TEMPLATES, 'rules.md'), path.join(dir, '.claude', 'marathon', 'rules.md'));
  await fs.copyFile(path.join(TEMPLATES, 'finish-line.example.json'), path.join(dir, '.claude', 'marathon', 'finish-line.example.json'));
  return dir;
}
const CLEAN = 'counts={"high":0,"medium":0,"low":0}';
const OVER = 'counts={"high":1,"medium":0,"low":0}';
const commit = async (wt, name) => {
  await fs.writeFile(path.join(wt, name), `// ${name}\n`);
  spawnSync('git', ['add', '.'], { cwd: wt }); spawnSync('git', ['commit', '-qm', name], { cwd: wt });
  return spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: wt, encoding: 'utf-8' }).stdout.trim();
};

describe('round 4 — the review ledger has exactly two write paths', () => {
  let dir;
  before(async () => { dir = await makeProject('ledger'); run(dir, ['init', 'l', '--isolation', 'folder']); run(dir, ['stream', 'a', 'state=active', 'next=x']); });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('k1: record review refuses id, void, voided_ts and replaced_by from the caller', () => {
    const r1 = run(dir, ['record', 'review', 'stream=a', CLEAN]).json;
    const r2 = run(dir, ['record', 'review', 'stream=a', OVER]).json;
    assert.equal(run(dir, ['gate']).code, 1);
    for (const bad of [[`id=${r2.id}`], [`id=${r2.id}`, 'void=true'], ['void=true'], ['voided_ts=2026-01-01T00:00:00Z'], [`replaced_by=${r1.id}`]]) {
      const r = run(dir, ['record', 'review', 'stream=a', CLEAN, ...bad]);
      assert.notEqual(r.code, 0, bad.join(' '));
    }
    const viaJson = run(dir, ['record', 'review', 'stream=a', '--json', JSON.stringify({ id: r2.id, counts: { high: 0, medium: 0, low: 0 } })]);
    assert.notEqual(viaJson.code, 0, '--json cannot smuggle an id either');
    const g = run(dir, ['gate']);
    assert.equal(g.code, 1, 'the over round is still over');
    assert.equal(g.json.score.passes, 0);
  });

  it('k2: replaces= only applies to the stream\'s latest live review', () => {
    const live = run(dir, ['gate']).json;
    assert.equal(live.score.passes, 0);
    const reviews = run(dir, ['model-stats']); // any verb → status refreshed; now record r3 clean
    const r3 = run(dir, ['record', 'review', 'stream=a', CLEAN]).json;
    const older = run(dir, ['record', 'review', 'stream=a', OVER]);           // r4 over → streak 0
    assert.equal(run(dir, ['gate']).json.score.passes, 0);
    const bad = run(dir, ['record', 'review', 'stream=a', CLEAN, `replaces=${r3.id}`]);
    assert.notEqual(bad.code, 0, 'r3 is not the latest review');
    assert.match(bad.err, /latest/i);
    assert.equal(run(dir, ['gate']).json.score.passes, 0, 'nothing moved');
    const ok = run(dir, ['record', 'review', 'stream=a', CLEAN, `replaces=${older.json.id}`]);
    assert.equal(ok.code, 0, ok.err);
    assert.equal(run(dir, ['gate']).json.score.passes, 2, 'r3 clean + replaced r4 clean');
    void reviews;
  });

  it('k4/k5: a replacement inherits the replaced review\'s commit and the void row is written first', async () => {
    const dir2 = await makeProject('inherit');
    const runId = run(dir2, ['init', 'i']).json.runId;
    const wt = path.join(dir2, 'wt-a');
    spawnSync('git', ['worktree', 'add', '-q', wt, '-b', 'marathon/i/a'], { cwd: dir2 });
    run(dir2, ['stream', 'a', 'state=active', `isolation=${wt}`]);
    await commit(wt, 'code.js');
    const r1 = run(dir2, ['record', 'review', 'stream=a', CLEAN]).json;
    const r2 = run(dir2, ['record', 'review', 'stream=a', CLEAN]).json;      // streak complete → certified at r2.commit
    await commit(wt, 'unreviewed.js');
    const rep = run(dir2, ['record', 'review', 'stream=a', CLEAN, `replaces=${r2.id}`]).json;
    assert.equal(rep.commit, r2.commit, 'the replacement certifies the code the brief was built from, not HEAD now');
    const brief = run(dir2, ['review-brief', '--stream', 'a']);
    assert.equal(brief.code, 0, brief.err);
    assert.match(brief.out, /unreviewed\.js/, 'code committed after the replaced review is still under review');
    const raw = (await fs.readFile(path.join(dir2, '.claude', 'marathon', runId, 'store', 'reviews.jsonl'), 'utf-8')).trim().split('\n').map(JSON.parse);
    const voidIdx = raw.findIndex(r => r.void && r.id === r2.id);
    const repIdx = raw.findIndex(r => r.id === rep.id);
    assert.ok(voidIdx > -1 && repIdx > voidIdx, 'void row precedes the replacement row');
    assert.equal(raw[voidIdx].replaced_by, rep.id);
    void r1;
    await fs.rm(dir2, { recursive: true });
  });

  it('k6: record review with commit= works when the worktree is gone', async () => {
    const dir3 = await makeProject('gone');
    run(dir3, ['init', 'g']);
    const wt = path.join(dir3, 'wt-a');
    spawnSync('git', ['worktree', 'add', '-q', wt, '-b', 'marathon/g/a'], { cwd: dir3 });
    run(dir3, ['stream', 'a', 'state=active', `isolation=${wt}`]);
    const sha = await commit(wt, 'x.js');
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: dir3 });
    const r = run(dir3, ['record', 'review', 'stream=a', CLEAN, `commit=${sha}`]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.commit, sha);
    await fs.rm(dir3, { recursive: true });
  });
});

describe('round 4 — isolation, wake paths, excluded files', () => {
  let dir, runId, wt;
  before(async () => {
    dir = await makeProject('iso');
    runId = run(dir, ['init', 'iso']).json.runId;
    wt = path.join(dir, 'wt-alpha');
    spawnSync('git', ['worktree', 'add', '-q', wt, '-b', 'marathon/iso/alpha'], { cwd: dir });
  });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('k3: a worktree-mode run refuses to activate a stream without isolation', () => {
    const bare = run(dir, ['stream', 'alpha', 'state=active']);
    assert.equal(bare.code, 1);
    assert.match(bare.err, /isolation|worktree/i);
    assert.match(bare.err, /git worktree add/);
    const folderOnly = run(dir, ['stream', 'alpha', 'state=active', '--no-isolation']);
    assert.equal(folderOnly.code, 0, folderOnly.err);
    run(dir, ['stream', 'alpha', 'state=queued']);
    const ok = run(dir, ['stream', 'alpha', 'state=active', `isolation=${wt}`]);
    assert.equal(ok.code, 0, ok.err);
  });

  it('k3/k11: every activation instruction includes the worktree step and names a distinctive stream', () => {
    run(dir, ['stream', 'beta-stream', 'state=queued', 'next=start beta']);
    run(dir, ['stream', 'alpha', 'state=done']);
    const plain = run(dir, ['resume', '--plain']).out;
    assert.match(plain, /"beta-stream"/);
    assert.match(plain, /git worktree add/);
    assert.match(plain, /isolation=/);
    const cron = run(dir, ['wake', '--cron']).json.prompt;
    assert.match(cron, /worktree/);
    assert.match(run(dir, ['status']).out, /Next for you:.*worktree/);
  });

  it('k8: with every stream done and the run not finished, the hook speaks and the cron prompt says how to close', () => {
    run(dir, ['stream', 'beta-stream', 'state=active', '--no-isolation']);
    run(dir, ['stream', 'beta-stream', 'state=done']);
    const hook = run(dir, ['resume', '--if-active']);
    assert.notEqual(hook.out.trim(), '', 'a done-but-unfinished run must reach CHECKPOINT 5');
    assert.match(hook.out, /cli\.js gate/);
    assert.match(hook.out, /cli\.js finish/);
    const cron = run(dir, ['wake', '--cron']).json.prompt;
    assert.match(cron, /cli\.js gate/);
    assert.match(cron, /finish/);
    assert.match(cron, /reopen/i);
    assert.equal(run(dir, ['finish']).code, 0);
    assert.equal(run(dir, ['resume', '--if-active', '--run', runId]).out.trim(), '', 'finished → silent');
  });

  it('k16: all streams blocked is reported as blocked, with what each needs', async () => {
    const d = await makeProject('blocked');
    run(d, ['init', 'bl', '--isolation', 'folder']);
    run(d, ['stream', 'one', 'state=blocked', 'next=needs the API key']);
    run(d, ['stream', 'two', 'state=blocked', 'next=needs the domain']);
    const out = run(d, ['resume', '--plain']).out;
    assert.match(out, /blocked/i);
    assert.match(out, /needs the API key/);
    assert.match(out, /needs the domain/);
    assert.ok(!/all streams are done/i.test(out));
    assert.match(run(d, ['status']).out, /Next for you:.*blocked/i);
    await fs.rm(d, { recursive: true });
  });

  it('k7: changed lock and snapshot files are listed in the brief even though their content is excluded', async () => {
    const d = await makeProject('excl');
    run(d, ['init', 'ex']);
    const w = path.join(d, 'wt-a');
    spawnSync('git', ['worktree', 'add', '-q', w, '-b', 'marathon/ex/a'], { cwd: d });
    run(d, ['stream', 'a', 'state=active', `isolation=${w}`]);
    await fs.writeFile(path.join(w, 'app.js'), 'export const a = 1;\n');
    await fs.writeFile(path.join(w, 'package-lock.json'), '{"left-pad":"https://evil.example/left-pad.tgz"}\n');
    await fs.writeFile(path.join(w, 'ui.test.js.snap'), 'exports[`x`] = `weaker`;\n');
    spawnSync('git', ['add', '.'], { cwd: w }); spawnSync('git', ['commit', '-qm', 'deps'], { cwd: w });
    const b = run(d, ['review-brief', '--stream', 'a']);
    assert.equal(b.code, 0, b.err);
    assert.match(b.out, /app\.js/);
    assert.match(b.out, /package-lock\.json/, 'excluded files are named');
    assert.match(b.out, /ui\.test\.js\.snap/);
    assert.ok(!/evil\.example/.test(b.out), 'but their content is not inlined');
    assert.match(b.out, /excluded from the inline diff/i);
    assert.match(b.out, /HEAD = [0-9a-f]{7,}/, 'k4: the brief names the sha it was built from');
    await fs.rm(d, { recursive: true });
  });
});
