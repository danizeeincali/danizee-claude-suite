/**
 * Contract for src/lib/bbs/usage.js and `cli.js usage` — stream `usage` of marathon 2026-10-10-bbs-integration.
 * The owner's real workflows come from local session transcripts or the owner's own list, never from a guess.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { installedWorkflows, resolveName, invocations, scanUsage, ownerUsage, recordUsage, usageLines } from '../src/lib/bbs/usage.js';
import { nextStep, STEPS } from '../src/lib/bbs/status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(path.dirname(__dirname), 'src', 'lib', 'bbs', 'cli.js');
const NOW = new Date('2026-10-10T12:00:00.000Z');

const typed = (name, ts, args = '') => JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>` } });
const skill = (name, ts, args = '') => JSON.stringify({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Skill', input: { skill: name, args } }] } });
const chat = (text, ts) => JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: text } });

async function project(root) {
  const sc = path.join(root, '.claude', 'commands', '.shortcuts');
  await fs.mkdir(sc, { recursive: true });
  await fs.mkdir(path.join(root, '.claude', 'commands', 'workflows'), { recursive: true });
  await fs.writeFile(path.join(sc, 'w-marathon.md'), '# /w-marathon\n\nbody\n');
  await fs.writeFile(path.join(sc, 'mt.md'), '# /mt — alias for /w-marathon\n\nalias\n');
  await fs.writeFile(path.join(sc, 'w-background-compound.md'), '# /w-background-compound\n');
  await fs.writeFile(path.join(sc, 'bc.md'), '# /bc — alias for /w-background-compound\n');
  await fs.writeFile(path.join(sc, 'bcp.md'), '# /bcp — alias for /w-background-compound --push\n');
  await fs.writeFile(path.join(sc, 'w-review.md'), '# /w-review\n');
  await fs.writeFile(path.join(sc, 'w-debug.md'), '# /w-debug\n');
  await fs.writeFile(path.join(root, '.claude', 'commands', 'workflows', 'plan.md'), '# Plan Workflow\n');
}

describe('usage — installed workflows and names', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-usage-')); await project(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('lists every command file, maps namespaces and reads alias headers', async () => {
    const w = await installedWorkflows(dir);
    assert.equal(w.get('w-marathon').file, '.claude/commands/.shortcuts/w-marathon.md');
    assert.equal(w.get('mt').aliasOf, 'w-marathon');
    assert.equal(w.get('bc').aliasOf, 'w-background-compound');
    assert.equal(w.get('bcp').aliasOf, 'w-background-compound', 'an alias with appended flags still points at its workflow');
    assert.equal(w.get('w-marathon').aliasOf, null);
    assert.ok(w.has('workflows:plan'));
  });

  it('resolves typed, Skill and alias names to the workflow and keeps the name used', async () => {
    const w = await installedWorkflows(dir);
    assert.deepEqual(resolveName('/mt', w), { workflow: 'w-marathon', via: 'mt' });
    assert.deepEqual(resolveName('.shortcuts:w-marathon', w), { workflow: 'w-marathon', via: 'w-marathon' });
    assert.deepEqual(resolveName('workflows:plan', w), { workflow: 'workflows:plan', via: 'workflows:plan' });
    assert.deepEqual(resolveName('/not-installed', w), { workflow: null, via: 'not-installed' });
    assert.deepEqual(resolveName('../../etc', w), { workflow: null, via: null });
  });

  it('reads typed commands only from user turns and Skill calls only from assistant turns', () => {
    assert.deepEqual(invocations(JSON.parse(typed('bc', 'x'))), [{ name: 'bc', kind: 'typed' }]);
    assert.deepEqual(invocations(JSON.parse(skill('.shortcuts:w-review', 'x'))), [{ name: '.shortcuts:w-review', kind: 'skill' }]);
    assert.deepEqual(invocations(JSON.parse(chat('I ran <command-name>/bc</command-name> yesterday? no: mid-text', 'x'))).length, 0, 'a marker that does not open the turn is chat');
    const echoed = { type: 'assistant', message: { content: [{ type: 'text', text: '<command-name>/bc</command-name>' }] } };
    assert.deepEqual(invocations(echoed), [], 'assistant text never counts as a typed command');
    assert.deepEqual(invocations({ type: 'user', message: { content: [{ type: 'tool_result', content: '<command-name>/bc</command-name>' }] } }), []);
  });
});

describe('usage — scanning transcripts', () => {
  let dir, hist;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-usage-'));
    await project(dir);
    hist = path.join(dir, 'history');
    await fs.mkdir(path.join(hist, 'proj-a'), { recursive: true });
    await fs.mkdir(path.join(hist, 'proj-b'), { recursive: true });
    // session 1: /mt typed, its Skill hop to w-marathon, then /bc typed + its Skill hop: one use each
    await fs.writeFile(path.join(hist, 'proj-a', 's1.jsonl'), [
      typed('mt', '2026-10-09T10:00:00.000Z', 'secret plan text'),
      skill('.shortcuts:mt', '2026-10-09T10:00:01.000Z'),
      skill('.shortcuts:w-marathon', '2026-10-09T10:00:02.000Z'),
      chat('hello', '2026-10-09T10:01:00.000Z'),
      typed('bc', '2026-10-09T11:00:00.000Z'),
      skill('.shortcuts:w-background-compound', '2026-10-09T11:00:01.000Z'),
      'not json {',
      typed('ghost-cmd', '2026-10-09T11:00:00.000Z')
    ].join('\n') + '\n');
    // session 2: /bcp twice, w-review called by Claude without a typed command
    await fs.writeFile(path.join(hist, 'proj-b', 's2.jsonl'), [
      typed('bcp', '2026-10-08T09:00:00.000Z'),
      typed('bcp', '2026-10-08T09:30:00.000Z'),
      skill('.shortcuts:w-review', '2026-10-08T10:00:00.000Z')
    ].join('\n') + '\n');
    // an old session outside the window: its file mtime and its rows are old
    const old = path.join(hist, 'proj-b', 'old.jsonl');
    await fs.writeFile(old, typed('w-debug', '2026-01-01T00:00:00.000Z') + '\n');
    await fs.utimes(old, new Date('2026-01-01'), new Date('2026-01-01'));
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('ranks real use, folds aliases and Skill hops into one use, and drops old sessions', async () => {
    const u = await scanUsage(dir, { roots: [hist], days: 90, now: () => NOW });
    assert.equal(u.evidence, 'transcripts');
    assert.equal(u.files_read, 2, 'the old transcript is outside the window');
    const by = Object.fromEntries(u.workflows.map(w => [w.name, w]));
    assert.deepEqual(Object.keys(by).sort(), ['w-background-compound', 'w-marathon', 'w-review']);
    assert.equal(by['w-marathon'].count, 1, 'typed /mt and its two Skill hops are one use');
    assert.deepEqual(by['w-marathon'].via, { mt: 1 });
    assert.equal(by['w-background-compound'].count, 3, '/bc once in s1, /bcp twice in s2');
    assert.equal(by['w-background-compound'].sessions, 2);
    assert.deepEqual(by['w-background-compound'].via, { bcp: 2, bc: 1 });
    assert.equal(by['w-background-compound'].last_used, '2026-10-09T11:00:01.000Z');
    assert.equal(by['w-review'].count, 1, 'a Skill call without a typed command still counts');
    assert.equal(u.workflows[0].name, 'w-background-compound', 'ranked by count');
    assert.deepEqual(u.other, { 'ghost-cmd': 1 }, 'a command that is not installed is counted by name only');
    assert.equal(u.lines_skipped, 0, 'a broken line without a marker is never parsed');
  });

  it('never stores message text or arguments', async () => {
    const u = await scanUsage(dir, { roots: [hist], days: 90, now: () => NOW });
    const text = JSON.stringify(u);
    assert.ok(!text.includes('secret plan text'));
    assert.ok(!text.includes('hello'));
    assert.ok(!text.includes(hist), 'no transcript paths');
  });

  it('a missing root is no evidence, not an error', async () => {
    const u = await scanUsage(dir, { roots: [path.join(dir, 'nope')], days: 90, now: () => NOW });
    assert.equal(u.evidence, 'none');
    assert.deepEqual(u.workflows, []);
    assert.deepEqual(usageLines(u), ['(no evidence of which workflows the owner uses: ask them)']);
  });

  it('the owner\'s own list resolves aliases and refuses names that are not installed', async () => {
    const u = await ownerUsage(dir, 'bc, mt,w-review');
    assert.equal(u.evidence, 'owner');
    assert.deepEqual(u.workflows.map(w => w.name), ['w-background-compound', 'w-marathon', 'w-review']);
    assert.match(usageLines(u)[0], /named by the owner/);
    await assert.rejects(ownerUsage(dir, 'bc,made-up'), /not an installed workflow: made-up/);
    await assert.rejects(ownerUsage(dir, ' , '), /at least one/);
  });
});

describe('usage — the run step and the CLI', () => {
  let dir, hist;
  const runId = '2026-10-10-src';
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-usage-cli-'));
    await project(dir);
    hist = path.join(dir, 'history', 'p');
    await fs.mkdir(hist, { recursive: true });
    await fs.writeFile(path.join(hist, 's.jsonl'), typed('mt', new Date().toISOString()) + '\n');
    const rd = path.join(dir, '.claude', 'bbs', 'runs', runId);
    await fs.mkdir(rd, { recursive: true });
    await fs.writeFile(path.join(dir, '.claude', 'bbs', 'ACTIVE'), runId + '\n');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  const cli = (args) => {
    const r = spawnSync(process.execPath, [CLI, ...args, '--project', dir], { cwd: dir, encoding: 'utf-8' });
    let json = null; try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  };

  it('usage sits between map and verdict in the step order', () => {
    assert.deepEqual(STEPS, ['intake', 'fetch', 'inventory', 'map', 'usage', 'verdict', 'handoff']);
    const s = { source: { identity: 'sha256:a', fetched: true }, powers: { powers: [{ name: 'p' }] }, map: { judgments: { p: 'missing' } } };
    assert.equal(nextStep(s), 'usage');
    assert.equal(nextStep({ ...s, usage: { evidence: 'none', workflows: [] } }), 'verdict');
    assert.equal(nextStep({ ...s, verdicts: { decisions: { p: 'rebuild' } } }), 'handoff', 'a run decided before the usage step is not sent back');
  });

  it('cli.js usage --root writes usage.json and refuses a second count without --force', () => {
    const r = cli(['usage', '--root', path.dirname(hist)]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.evidence, 'transcripts');
    assert.deepEqual(r.json.top, ['w-marathon=1']);
    const again = cli(['usage', '--root', path.dirname(hist)]);
    assert.equal(again.code, 1);
    assert.match(again.err, /already exists.*--force/);
    assert.equal(cli(['usage', '--force', '--workflows', 'bc,w-review']).json.evidence, 'owner');
  });

  it('--root may repeat; --workflows takes no --root or --days; --days must be a positive integer', () => {
    assert.equal(cli(['usage', '--force', '--root', path.dirname(hist), '--root', path.join(dir, 'none')]).code, 0);
    assert.match(cli(['usage', '--force', '--workflows', 'bc', '--days', '3']).err, /takes no --root or --days/);
    assert.match(cli(['usage', '--force', '--days', '0']).err, /positive integer/);
    assert.match(cli(['usage', '--force', '--workflows', 'nope']).err, /not an installed workflow/);
  });

  it('no evidence says so and tells the verdict step to ask', async () => {
    const r = cli(['usage', '--force', '--root', path.join(dir, 'empty')]);
    assert.equal(r.code, 0);
    assert.equal(r.json.evidence, 'none');
    assert.match(r.json.note, /ask the owner/);
    const saved = JSON.parse(await fs.readFile(path.join(dir, '.claude', 'bbs', 'runs', runId, 'usage.json'), 'utf-8'));
    assert.equal(saved.evidence, 'none');
  });

  it('recordUsage uses the configured roots when none are passed', async () => {
    const cfg = { paths: { runs: '.claude/bbs/runs', registry: '.claude/bbs/registry.jsonl' }, usage: { roots: [path.dirname(hist)], days: 30 } };
    const r = await recordUsage(dir, { run: runId, force: true, cfg });
    assert.equal(r.evidence, 'transcripts');
  });
});
