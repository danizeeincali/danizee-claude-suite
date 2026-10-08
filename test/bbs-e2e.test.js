/**
 * The packaged check — stream `command-docs` of marathon 2026-10-07-bbs.
 * Installs the suite into a temp project and drives the INSTALLED bbs CLI through every step on a
 * local fixture source: intake → fetch → inventory → map → verdict → handoff --marathon → report.
 * No network, no execution of the fixture, nothing written outside the temp project.
 * One green run of this file is one `cli.js record run kind=e2e status=green`.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { DaniZeeSuiteInstaller } from '../src/installer.js';
import { validateFinishLine } from '../src/lib/marathon/gate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'bbs');

describe('bbs e2e — the packaged check', () => {
  let dir, cli, runId, marathonRun;
  const cwdFiles = async () => (await fs.readdir(ROOT)).sort();
  let rootBefore;

  function run(args, input, env = {}) {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf-8', input, env: { ...process.env, BBS_SANDBOX: 'absent', BBS_NO_NETWORK: '1', ...env } });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }

  before(async () => {
    rootBefore = await cwdFiles();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-e2e-'));
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
    const installer = new DaniZeeSuiteInstaller({ path: dir, force: true, withoutCookbook: true });
    const result = await installer.install();
    assert.ok(result.success, 'suite installed into the temp project');
    cli = path.join(dir, '.claude', 'helpers', 'bbs', 'cli.js');
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    assert.deepEqual(await cwdFiles(), rootBefore, 'nothing was written into the suite repo');
  });

  it('1 intake: the fixture directory is taken in with a manifest identity', () => {
    const r = run(['intake', path.join(FIXTURES, 'sample-source'), '--slug', 'sample']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.type, 'local');
    assert.match(r.json.identity, /^sha256:/);
    assert.equal(r.json.known, false);
    runId = r.json.runId;
    assert.match(runId, /-sample$/);
  });

  it('2 fetch: nothing to fetch for a local source; the egress line says requests=0', () => {
    const r = run(['fetch']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.nothing_to_fetch, true);
    assert.equal(r.json.egress_line, 'requests=0 bytes_in=0 bodies_sent=0 hosts=none');
  });

  it('3 inventory: the brief names the fixture files; the fixture inventory JSON is accepted (3 powers)', async () => {
    const b = run(['inventory', '--brief']);
    assert.equal(b.code, 0, b.err);
    assert.match(b.out, /LICENSE/);
    assert.match(b.out, /src\/a\.js/);
    assert.match(b.out, /JSON only/);
    const r = run(['inventory', '--from', path.join(FIXTURES, 'inventory.json')]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.found, 3);
    assert.deepEqual(r.json.not_inventoried, []);
    assert.equal(r.json.next, 'map');
  });

  it('4 map: the installed harness is indexed and each power gets candidates; the fixture judgments are recorded', () => {
    const m = run(['map']);
    assert.equal(m.code, 0, m.err);
    assert.ok(m.json.indexed > 0, 'the installed commands/helpers/hooks are indexed');
    assert.equal(m.json.powers, 3);
    const b = run(['map', '--brief']);
    assert.equal(b.code, 0, b.err);
    assert.match(b.out, /have\|partial\|missing|have, partial or missing/);
    const j = run(['map', '--from', path.join(FIXTURES, 'judgments.json')]);
    assert.equal(j.code, 0, j.err);
    assert.equal(j.json.judged, 3);
    assert.deepEqual(j.json.remaining, []);
    assert.equal(j.json.next, 'verdict');
  });

  it('5 verdict: no sandbox → use removed with a reason; the table shows every power; the fixture decisions are legal and the registry row lands', async () => {
    const v = run(['verdict']);
    assert.equal(v.code, 0, v.err);
    assert.equal(v.json.sandbox.present, false);
    assert.match(v.err, /BBS_SANDBOX=absent/, 'the override is announced on stderr');
    for (const name of Object.keys(v.json.rows)) {
      assert.ok(!v.json.rows[name].legal.includes('use'), `${name}: use is not legal without a sandbox`);
    }
    const t = run(['verdict', '--table']);
    assert.equal(t.code, 0, t.err);
    assert.match(t.out, /\| Power \| Harness \| Licence \| Legal \| Default \| Decision \| Why \|/);
    const bad = run(['verdict', '--decide', 'drift-monitor=use']);
    assert.equal(bad.code, 2);
    assert.match(bad.err, /^bbs: refused: /);
    const d = run(['verdict', '--from', path.join(FIXTURES, 'decisions.json')]);
    assert.equal(d.code, 0, d.err);
    assert.equal(d.json.decided, 3);
    assert.equal(d.json.registry_written, true);
    assert.equal(d.json.next, 'handoff');
    const registry = (await fs.readFile(path.join(dir, '.claude', 'bbs', 'registry.jsonl'), 'utf-8')).trim().split('\n').map(l => JSON.parse(l));
    assert.equal(registry.length, 1);
    assert.equal(registry[0].run, runId);
    assert.equal(registry[0].complete, true);
  });

  it('6 handoff --marathon: a marathon run is created with a typed finish line, one queued stream per approved power, briefs that resolve, and a buy memo', async () => {
    const h = run(['handoff', '--marathon']);
    assert.equal(h.code, 0, h.err);
    marathonRun = h.json.marathonRun;
    assert.match(marathonRun, /-bbs-sample$/);
    assert.equal(h.json.resume_line, `/w-marathon --resume ${marathonRun}`);
    assert.deepEqual(h.json.powers.map(p => p.verdict).sort(), ['rebuild', 'rebuild']);
    assert.equal(h.json.memos.length, 1);
    assert.deepEqual(h.json.skipped, []);
    const mDir = path.join(dir, '.claude', 'marathon', marathonRun);
    const fl = JSON.parse(await fs.readFile(path.join(mDir, 'finish-line.json'), 'utf-8'));
    assert.deepEqual(validateFinishLine(fl), [], 'the marathon gate accepts the finish line');
    assert.equal(fl.lines.filter(l => l.id.startsWith('tests_green_')).length, 2);
    const streams = JSON.parse(await fs.readFile(path.join(mDir, 'streams.json'), 'utf-8'));
    const rows = (streams.streams || streams).filter(s => s.name !== '_meta');
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.state, 'queued');
      await fs.stat(path.join(dir, row.plan));
      const brief = await fs.readFile(path.join(dir, row.plan), 'utf-8');
      assert.ok(!brief.includes('```'), 'no code block in a brief');
      assert.ok(!brief.includes('export const'), 'no fixture source code in a brief');
    }
    const kickoff = await fs.readFile(path.join(mDir, 'kickoff.md'), 'utf-8');
    assert.match(kickoff, /Never execute fetched foreign code/);
    assert.match(kickoff, /## Budget/);
    const status = spawnSync(process.execPath, [path.join(dir, '.claude', 'helpers', 'marathon', 'cli.js'), 'status', '--run', marathonRun], { cwd: dir, encoding: 'utf-8' });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /queued/);
  });

  it('7 report and status: done, pointing at the marathon run; egress shows nothing left the machine', async () => {
    assert.equal(run(['status', '--next']).out.trim(), 'done');
    assert.equal(run(['report']).out.trim(), `found=3 approved=3 skipped=0 buy=1 marathon=${marathonRun}`);
    const status = await fs.readFile(path.join(dir, '.claude', 'bbs', 'runs', runId, 'status.md'), 'utf-8');
    assert.match(status, /- Egress: requests=0 bytes_in=0 bodies_sent=0 hosts=none/);
    assert.match(status, new RegExp(`- Next: done — /w-marathon --resume ${marathonRun}`));
    const egress = (await fs.readFile(path.join(dir, '.claude', 'bbs', 'runs', runId, 'egress.jsonl'), 'utf-8')).trim().split('\n').map(l => JSON.parse(l));
    assert.ok(egress.every(e => e.kind === 'none' || e.bytes_out === 0));
    assert.ok(!egress.some(e => e.kind === 'http' || e.kind === 'git'), 'no request was ever sent');
  });

  it('8 a second intake of the same fixture is known and reuses this run', () => {
    const again = run(['intake', path.join(FIXTURES, 'sample-source'), '--slug', 'sample-again']);
    assert.equal(again.code, 0, again.err);
    assert.equal(again.json.known, true);
    assert.equal(again.json.reuse_from, runId);
  });
});
