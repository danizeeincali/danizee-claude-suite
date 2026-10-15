import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { run, troubleLog, overlap, words, checkLessonText, saveLesson } from '../src/lib/kit/reflect.js';
import { withStateLock as withLock } from '../src/lib/kit/state-lock.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/kit/cli.js');
const jl = (arr) => arr.map((o) => JSON.stringify(o)).join('\n');
// A lock left by a process that no longer exists on this machine: the shared lock breaks it at once, but only when the
// lock names this host, this pid namespace and this boot id (as a lock written here by the shared lock does).
const PIDNS = (() => { try { return fsSync.readlinkSync('/proc/self/ns/pid'); } catch { return null; } })();
const BOOT = (() => { try { return fsSync.readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim() || null; } catch { return null; } })();
async function deadHolder() {
  const pid = await new Promise((res) => { const p = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' }); p.on('close', () => res(p.pid)); });
  return JSON.stringify({ token: 'dead-token', pid, host: os.hostname(), pidns: PIDNS, boot: BOOT, beat: 0 });
}
async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'reflect-')); }
async function call(args, cwd, stdin = '') {
  try { return { code: 0, out: await run(args, { cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} }) }; } catch (e) { return { code: e.code ?? 99, err: e.message }; }
}

describe('reflect trouble-log', () => {
  it('finds repeats, target edits, waits, failures and stop (generic schema)', () => {
    const ev = [];
    for (let i = 0; i < 3; i++) ev.push({ type: 'tool', name: 'Bash', input: { command: 'npm test' }, ok: true });
    for (let i = 0; i < 3; i++) ev.push({ type: 'tool', name: 'Edit', input: { file_path: 'a.js', old: String(i) }, ok: true });
    ev.push({ type: 'wait' }, { type: 'wait' }, { type: 'wait' }, { type: 'wait' });
    ev.push({ type: 'tool', name: 'Read', input: { file_path: 'x' }, ok: false, error: 'ENOENT' });
    ev.push({ type: 'stop', reason: 'max_turns' });
    const r = troubleLog(ev);
    assert.equal(r.lines[0], 'stop: max_turns');
    assert.ok(r.lines.some((l) => l.startsWith('failed: Read x - ENOENT')));
    assert.ok(r.lines.includes('waited 4 times in a row'));
    assert.ok(r.lines.some((l) => /repeated: Bash 3 times/.test(l)));
    assert.ok(r.lines.includes('same target edited 3 times: a.js'));
    assert.deepEqual(r.counts, { failed: 1, wait_runs: 1, repeated_calls: 1, repeated_targets: 1 });
  });
  it('two waits are not a run', () => {
    const r = troubleLog([{ type: 'wait' }, { type: 'wait' }, { type: 'tool', name: 'X', input: 1 }, { type: 'wait' }]);
    assert.equal(r.counts.wait_runs, 0);
  });
  it('reads a Claude Code transcript and pairs errors by id', () => {
    const t = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sleep 5' } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'sleep 5' } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'sleep 5' } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't4', name: 'Edit', input: { file_path: 'b.js' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't4', is_error: true, content: [{ type: 'text', text: 'old_string not found' }] }, { type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] } },
      { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } },
      { type: 'summary', summary: 'ignored' }
    ];
    const r = troubleLog(t);
    assert.equal(r.stop, 'end_turn');
    assert.ok(r.lines.includes('waited 3 times in a row'));
    assert.ok(r.lines.includes('failed: Edit b.js - old_string not found'));
    assert.equal(r.counts.failed, 1);
  });
  it('caps lines and line length, reporting omitted', () => {
    const ev = [];
    for (let i = 0; i < 10; i++) ev.push({ type: 'tool', name: 'T', input: {}, ok: false, error: 'e'.repeat(500) + i });
    const r = troubleLog(ev, { maxLines: 4, maxLineLength: 50 });
    assert.equal(r.lines.length, 4);
    assert.ok(r.lines.every((l) => [...l].length <= 50));
    assert.equal(r.omitted, 8); // stop + 10 failures + 1 repeat = 12 lines
  });
  it('never emits a planted secret, even when the cap would cut it', () => {
    const secret = 'sk-live-SUPERSECRET-123456';
    const ev = [{ type: 'tool', name: 'Bash', input: { command: 'curl ' + secret }, ok: false, error: 'x'.repeat(30) + secret }, { type: 'stop', reason: 'stopped ' + secret }];
    for (const len of [200, 60, 52, 45]) {
      const out = JSON.stringify(troubleLog(ev, { secrets: [secret], maxLineLength: len }));
      assert.ok(!out.includes('SUPERSECRET'), `len ${len}`);
      assert.ok(!out.includes('sk-live'), `len ${len}`);
    }
  });
  it('a secret with a quote or backslash never reaches the repeated line', () => {
    const secret = 'pa\\ss"w0rd-LONGSECRET';
    const ev = [1, 2].map(() => ({ type: 'tool', name: 'Bash', input: { command: 'login ' + secret }, ok: true }));
    const r = troubleLog(ev, { secrets: [secret] });
    const out = JSON.stringify(r);
    assert.ok(!out.includes('LONGSECRET'), out);
    assert.ok(!out.includes('w0rd'), out);
    assert.ok(r.lines.some((l) => /^repeated: Bash 2 times/.test(l) && l.includes('[REDACTED]')));
  });
  it('typing into the same field fires for MCP and computer-use typing tools', () => {
    const mcp = [1, 2, 3].map((i) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'm' + i, name: 'mcp__playwright__browser_type', input: { element: 'Email', ref: 'e12', text: 'try' + i } }] } }));
    const r = troubleLog(mcp);
    assert.ok(r.lines.includes('same target edited 3 times: Email'), r.lines.join('|'));
    const fill = [1, 2, 3].map((i) => ({ type: 'tool', name: 'mcp__playwright__browser_fill_form', input: { ref: 'e7', value: 'v' + i }, ok: true }));
    assert.equal(troubleLog(fill).counts.repeated_targets, 1);
    const comp = [1, 2, 3].map((i) => ({ type: 'tool', name: 'computer', input: { action: 'type', text: 'abc' + i }, ok: true }));
    assert.equal(troubleLog(comp).counts.repeated_targets, 1);
    const click = [1, 2, 3].map((i) => ({ type: 'tool', name: 'computer', input: { action: 'screenshot', n: i }, ok: true }));
    assert.equal(troubleLog(click).counts.repeated_targets, 0);
  });
  it('git unavailable or failing is exit 1 (pass --secrets-file), never unredacted output', async () => {
    const d = await tmp();
    const savedPath = process.env.PATH;
    try {
      await fs.writeFile(path.join(d, 'e.jsonl'), jl([{ type: 'tool', name: 'A', input: { k: 1 }, ok: false, error: 'bad SuperSecretToken123' }]));
      process.env.PATH = path.join(d, 'no-such-bin');
      const r = await call(['trouble-log', '--in', 'e.jsonl'], d);
      assert.equal(r.code, 1);
      assert.match(r.err, /--secrets-file/);
      assert.ok(!String(r.err).includes('SuperSecretToken123'));
      // an explicit secrets file still works without git
      await fs.writeFile(path.join(d, 's'), 'SuperSecretToken123\n');
      const ok = await call(['trouble-log', '--in', 'e.jsonl', '--secrets-file', 's'], d);
      assert.equal(ok.code, 0);
      assert.ok(!JSON.stringify(ok.out).includes('SuperSecretToken123'));
    } finally { process.env.PATH = savedPath; await fs.rm(d, { recursive: true, force: true }); }
  });
  it('CLI reads the secrets file and --in; bad JSON is exit 1', async () => {
    const d = await tmp();
    try {
      await fs.writeFile(path.join(d, 's'), 'hunter2hunter2\n');
      await fs.writeFile(path.join(d, 'e.jsonl'), jl([{ type: 'tool', name: 'A', input: { k: 'hunter2hunter2' }, ok: false, error: 'bad hunter2hunter2' }]));
      const r = await call(['trouble-log', '--in', 'e.jsonl', '--secrets-file', 's'], d);
      assert.equal(r.code, 0);
      assert.ok(!JSON.stringify(r.out).includes('hunter2'));
      assert.ok(JSON.stringify(r.out).includes('[REDACTED]'));
      assert.equal((await call(['trouble-log'], d, '{nope')).code, 1);
      assert.equal((await call(['trouble-log'], d, '[1]')).code, 1);
      assert.equal((await call(['trouble-log', '--in', 'missing'], d)).code, 1);
      assert.equal((await call(['trouble-log', '--max-lines', '0'], d, '')).code, 1);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('a secret with a quote or backslash inside an object error never reaches a failed line', () => {
    const secret = 'pa"ss\\-LONGSECRET';
    const ev = [{ type: 'tool', name: 'Login', input: {}, ok: false, error: { message: 'bad password ' + secret } }];
    const out = JSON.stringify(troubleLog(ev, { secrets: [secret] }));
    assert.ok(!out.includes('LONGSECRET'), out);
    assert.ok(troubleLog(ev, { secrets: [secret] }).lines.some((l) => l.startsWith('failed: Login')));
  });
  it('a secret with a tab or two spaces inside a string error never reaches a failed line', () => {
    for (const secret of ['my\tpass-LONGSECRET', 'my  pass-LONGSECRET']) {
      const ev = [{ type: 'tool', name: 'Login', input: {}, ok: false, error: 'bad ' + secret }];
      assert.ok(!JSON.stringify(troubleLog(ev, { secrets: [secret] })).includes('LONGSECRET'));
    }
  });
  it('a secret in a transcript tool_result error block never reaches a failed line', () => {
    const secret = 'tok"en\\-LONGSECRET';
    const ev = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'x' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'denied ' + secret }] }] } }
    ];
    const r = troubleLog(ev, { secrets: [secret] });
    assert.ok(!JSON.stringify(r).includes('LONGSECRET'));
    assert.ok(r.lines.some((l) => l.startsWith('failed: Bash')));
  });
  it('empty or unrecognised input is exit 1, never a clean log', async () => {
    for (const objs of [[], [{ type: 'message' }, { event: 'tool_call' }]]) {
      assert.throws(() => troubleLog(objs), (e) => e.code === 1);
    }
    const d = await tmp();
    try {
      assert.equal((await call(['trouble-log'], d, '')).code, 1);
      assert.equal((await call(['trouble-log'], d, '\n  \n')).code, 1);
      assert.equal((await call(['trouble-log'], d, jl([{ type: 'message' }, { event: 'tool_call' }]))).code, 1);
      await fs.writeFile(path.join(d, 'e.jsonl'), '');
      assert.equal((await call(['trouble-log', '--in', 'e.jsonl'], d)).code, 1);
      assert.equal((await call(['trouble-log'], d, jl([{ type: 'message' }, { type: 'stop', reason: 'end_turn' }]))).code, 0);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
});

describe('reflect lessons', () => {
  let n = 0;
  const save = (d, extra = []) => call(['lessons', 'save', ...(extra.includes('--session') ? [] : ['--session', 'sx' + (n++)]), ...extra], d);
  const SAVE_RAW = (d, extra = []) => call(['lessons', 'save', ...extra], d);
  it('text guards', () => {
    for (const bad of ['', 'short', 'The login form needs a wait.', 'Running tests twice wastes time here.', 'Do this. And also that thing.', 'Line one\nLine two here ok', 'x'.repeat(201), '123 start with digit']) {
      assert.throws(() => checkLessonText(bad), (e) => e.code === 1, bad);
    }
    for (const good of ['Bring the server up before running e2e tests.', 'Ping the health endpoint before deploying.', 'Use npm ci, e.g. in CI jobs.', 'Pin versions, i.e. no ranges, in the lockfile.']) {
      assert.equal(checkLessonText(good), good);
    }
    assert.throws(() => checkLessonText('Using npm ci keeps installs repeatable.'), (e) => e.code === 1);
    assert.equal(checkLessonText('  Wait for the spinner before clicking save.  '), 'Wait for the spinner before clicking save.');
  });
  it('overlap measure', () => {
    assert.equal(overlap('Wait for the spinner', 'wait for spinner!'), 1);
    assert.ok(overlap('Retry the login form', 'Clear cache before build') < 0.1);
  });
  it('save and retire refuse text, scope or reason holding a project secret; nothing is stored', async () => {
    const d = await tmp();
    try {
      await fs.mkdir(path.join(d, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(d, 's'), 'SuperSecretToken123\n');
      const sf = ['--secrets-file', 's'];
      const ok = await save(d, ['--role', 'fixer', '--text', 'Wait for the spinner to vanish before clicking save.', ...sf]);
      assert.equal(ok.code, 0);
      const t = await save(d, ['--role', 'fixer', '--text', 'Use token SuperSecretToken123 when calling the staging API.', ...sf]);
      assert.equal(t.code, 1);
      assert.ok(!String(t.err).includes('SuperSecretToken123'));
      const sc = await save(d, ['--role', 'fixer', '--text', 'Bring the staging server up before the e2e run.', '--scope', 'SuperSecretToken123', ...sf]);
      assert.equal(sc.code, 1);
      const r = await call(['lessons', 'retire', '--id', 'L1', '--reason', 'token SuperSecretToken123 rotated', ...sf], d);
      assert.equal(r.code, 1);
      assert.ok(!String(r.err).includes('SuperSecretToken123'));
      // default path: secrets file in the project, no flag
      await fs.writeFile(path.join(d, '.claude/kit/secrets'), 'SuperSecretToken123\n');
      await call(['lessons', 'save', '--role', 'fixer', '--session', 'sq', '--text', 'Use token SuperSecretToken123 when calling the staging API.'], d);
      const stored = await fs.readFile(path.join(d, '.claude/kit/lessons.json'), 'utf-8');
      assert.ok(!stored.includes('SuperSecretToken123'), stored);
      assert.equal((await call(['lessons', 'list', '--all'], d)).out.lessons.length, 1);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('save, list, keep, retire with reason; retired hidden but kept in file', async () => {
    const d = await tmp();
    try {
      const a = await save(d, ['--role', 'fixer', '--text', 'Wait for the spinner to vanish before clicking save.', '--scope', 'checkout']);
      assert.equal(a.code, 0);
      assert.equal(a.out.lesson.id, 'L1');
      assert.equal((await call(['lessons', 'keep', '--id', 'L1'], d)).out.lesson.kept, 1);
      assert.equal((await call(['lessons', 'keep', '--id', 'L9'], d)).code, 1);
      assert.equal((await call(['lessons', 'retire', '--id', 'L1'], d)).code, 1);
      assert.equal((await call(['lessons', 'retire', '--id', 'L1', '--reason', 'wrong selector'], d)).code, 0);
      assert.equal((await call(['lessons', 'list'], d)).out.lessons.length, 0);
      const all = (await call(['lessons', 'list', '--all'], d)).out.lessons;
      assert.equal(all[0].retire_reason, 'wrong selector');
      assert.equal((await call(['lessons', 'keep', '--id', 'L1'], d)).code, 1);
      assert.equal(JSON.parse(await fs.readFile(path.join(d, '.claude/kit/lessons.json'), 'utf-8')).lessons.length, 1);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('near match refused (exit 2 with id) unless --confirm or --distinct; other role is independent', async () => {
    const d = await tmp();
    try {
      await save(d, ['--role', 'fixer', '--text', 'Wait for the spinner to vanish before clicking save.']);
      const dup = await save(d, ['--role', 'fixer', '--text', 'Wait for spinner to vanish before clicking the save.']);
      assert.equal(dup.code, 2);
      assert.match(dup.err, /L1/);
      assert.equal((await save(d, ['--role', 'judge', '--text', 'Wait for spinner to vanish before clicking the save.'])).code, 0);
      const conf = await save(d, ['--role', 'fixer', '--text', 'Wait for spinner to vanish before clicking the save.', '--confirm', 'L1']);
      assert.equal(conf.code, 0);
      assert.equal(conf.out.lesson.kept, 1);
      assert.equal((await save(d, ['--role', 'fixer', '--text', 'Wait for spinner to vanish before clicking the save.', '--confirm', 'L2'])).code, 1, 'other role id');
      const dis = await save(d, ['--role', 'fixer', '--text', 'Wait for spinner to vanish before clicking the save.', '--distinct']);
      assert.equal(dis.code, 0);
      assert.equal((await save(d, ['--role', 'fixer', '--text', 'Wait for spinner to vanish before clicking the save.', '--distinct', '--confirm', 'L1'])).code, 1);
      assert.equal((await call(['lessons', 'list', '--role', 'judge'], d)).out.lessons.length, 1);
      // retired lessons no longer block
      await call(['lessons', 'retire', '--id', 'L1', '--reason', 'r'], d);
      await call(['lessons', 'retire', '--id', 'L3', '--reason', 'r'], d);
      assert.equal((await save(d, ['--role', 'fixer', '--text', 'Wait for the spinner to vanish before clicking save.'])).code, 0);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('per-session cap', async () => {
    const d = await tmp();
    try {
      const texts = ['Pin node to version twenty before running installs.', 'Check the lockfile diff before committing dependencies.', 'Seed the database with fixtures prior to integration runs.', 'Avoid editing generated bundles by hand anywhere.'];
      for (let i = 0; i < 3; i++) assert.equal((await save(d, ['--role', 'r', '--session', 's1', '--text', texts[i]])).code, 0);
      const r = await save(d, ['--role', 'r', '--session', 's1', '--text', texts[3]]);
      assert.equal(r.code, 2);
      assert.equal((await save(d, ['--role', 'r', '--session', 's2', '--text', texts[3]])).code, 0);
      assert.equal((await save(d, ['--role', 'r', '--session', 's1', '--max-new', '5', '--text', 'Prefer small commits when touching the installer module.'])).code, 0);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('save without --session is exit 1, so the per-session cap cannot be skipped', async () => {
    const d = await tmp();
    try {
      const r = await SAVE_RAW(d, ['--role', 'r', '--text', 'Pin node to version twenty before running installs.']);
      assert.equal(r.code, 1);
      assert.match(r.err, /--session/);
      assert.equal((await SAVE_RAW(d, ['--role', 'r', '--text', 'Pin node to version twenty before running installs.', '--session', ' '])).code, 1);
      assert.equal((await call(['lessons', 'list'], d)).out.lessons.length, 0);
      assert.throws(() => saveLesson({ version: 1, lessons: [] }, { role: 'r', text: 'Pin node to version twenty before running installs.' }), (e) => e.code === 1);
      for (let i = 0; i < 4; i++) await SAVE_RAW(d, ['--role', 'r', '--distinct', '--text', `Check item${i} item${i}x before shipping.`]);
      assert.equal((await call(['lessons', 'list'], d)).out.lessons.length, 0);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('invalid input is exit 1', async () => {
    const d = await tmp();
    try {
      for (const a of [['save', '--session', 's', '--text', 'Wait for the spinner to vanish.'], ['save', '--session', 's', '--role', 'r'], ['nope'], ['save', '--session', 's', '--role', 'r', '--text', 'Wait for the spinner.', '--threshold', '2'], ['save', '--session', 's', '--role', 'r', '--text', 'Wait for the spinner.', '--bogus', 'x']]) {
        assert.equal((await call(['lessons', ...a], d)).code, 1, a.join(' '));
      }
      await fs.mkdir(path.join(d, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(d, '.claude/kit/lessons.json'), '{broken');
      assert.equal((await call(['lessons', 'list'], d)).code, 1);
      assert.equal((await call(['bogus'], d)).code, 1);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('a leading BOM in the store is ignored', async () => {
    const d = await tmp();
    try {
      await fs.mkdir(path.join(d, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(d, '.claude/kit/lessons.json'), '﻿' + JSON.stringify({ version: 1, lessons: [{ id: 'L4', role: 'r', text: 'Do a thing well.', status: 'active' }] }));
      assert.equal((await call(['lessons', 'list'], d)).out.lessons.length, 1);
      assert.equal((await save(d, ['--role', 'r', '--text', 'Check logs before restarting the daemon.'])).out.lesson.id, 'L5');
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('parallel saves from separate processes are all kept; no temp or lock left', async () => {
    const d = await tmp();
    try {
      const topics = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
      const codes = await Promise.all(topics.map((t) => new Promise((res) => {
        const p = spawn(process.execPath, [CLI, 'reflect', 'lessons', 'save', '--role', 'r', '--session', `s-${t}`, '--distinct', '--text', `Verify ${t} ${t}x ${t}y config before deploy.`], { cwd: d, stdio: 'ignore' });
        p.on('close', res);
      })));
      assert.deepEqual(codes, topics.map(() => 0));
      const lessons = JSON.parse(await fs.readFile(path.join(d, '.claude/kit/lessons.json'), 'utf-8')).lessons;
      assert.equal(lessons.length, 10);
      assert.equal(new Set(lessons.map((l) => l.id)).size, 10);
      assert.deepEqual((await fs.readdir(path.join(d, '.claude/kit'))).sort(), ['lessons.json']);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('list reads without taking the lock, so a held lock does not block it', async () => {
    const d = await tmp();
    try {
      await fs.mkdir(path.join(d, '.claude/kit'), { recursive: true });
      await fs.writeFile(path.join(d, '.claude/kit/lessons.json'), JSON.stringify({ version: 1, lessons: [{ id: 'L1', role: 'r', text: 'Do a thing well.', status: 'active' }] }));
      await fs.writeFile(path.join(d, '.claude/kit/lessons.json.lock'), JSON.stringify({ token: 't', pid: process.pid, host: os.hostname(), beat: 0 }));
      assert.equal((await call(['lessons', 'list'], d)).out.lessons.length, 1);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('a stale lock is broken', async () => {
    const d = await tmp();
    try {
      await fs.mkdir(path.join(d, '.claude/kit'), { recursive: true });
      const lock = path.join(d, '.claude/kit/lessons.json.lock');
      await fs.writeFile(lock, await deadHolder());
      assert.equal((await save(d, ['--role', 'r', '--text', 'Check logs before restarting the daemon.'])).code, 0);
      assert.deepEqual((await fs.readdir(path.join(d, '.claude/kit'))).sort(), ['lessons.json']);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('a fresh lock times out as exit 1 and is left in place', async () => {
    const d = await tmp();
    try {
      const store = path.join(d, 'k/lessons.json');
      await fs.mkdir(path.dirname(store), { recursive: true });
      const lock = store + '.lock';
      const holder = (n) => JSON.stringify({ token: 'holder-token', pid: process.pid, host: os.hostname(), beat: n });
      await fs.writeFile(lock, holder(0));
      let n = 0;
      const beat = setInterval(() => { fs.writeFile(lock, holder(++n)).catch(() => {}); }, 20);
      let ran = false;
      try {
        await assert.rejects(withLock(store, async () => { ran = true; }, { staleMs: 200, waitMs: 400 }), (e) => e.code === 1 && /locked/.test(e.message));
      } finally { clearInterval(beat); }
      assert.equal(ran, false);
      assert.equal(JSON.parse(await fs.readFile(lock, 'utf-8')).token, 'holder-token');
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('the total wait is longer than the stale age, so a waiter reaches the break path', async () => {
    const d = await tmp();
    try {
      const store = path.join(d, 'k/lessons.json');
      await fs.mkdir(path.dirname(store), { recursive: true });
      await fs.writeFile(store + '.lock', 'dead');
      let ran = false;
      await withLock(store, async () => { ran = true; }, { staleMs: 300, waitMs: 1500 });
      assert.equal(ran, true);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('breaking a stale lock never removes a lock whose token changed; a lock is released only by its owner', async () => {
    const d = await tmp();
    try {
      const store = path.join(d, 'k/lessons.json');
      await fs.mkdir(path.dirname(store), { recursive: true });
      const lock = store + '.lock';
      await fs.writeFile(lock, 'other');
      await withLock(store, async () => { await fs.rm(lock); await fs.writeFile(lock, 'someone-else'); }, { staleMs: 100, waitMs: 1000 }).catch(() => {});
      // the stale 'other' lock was broken, our run took it; its token was replaced, so release must leave 'someone-else' alone
      assert.equal(await fs.readFile(lock, 'utf-8'), 'someone-else');
      // an old break lock (older than 2x stale) is itself removed
      await fs.rm(lock);
      await fs.writeFile(lock, 'dead');
      await fs.writeFile(lock + '.break', '');
      await withLock(store, async () => {}, { staleMs: 100, waitMs: 2000 });
      await assert.rejects(fs.stat(lock + '.break'));
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('a pre-aged lock and 8 parallel writer processes keep all 8 writes, 10 times over', { timeout: 120000 }, async () => {
    for (let round = 0; round < 10; round++) {
      const d = await tmp();
      try {
        await fs.mkdir(path.join(d, '.claude/kit'), { recursive: true });
        const lock = path.join(d, '.claude/kit/lessons.json.lock');
        await fs.writeFile(lock, await deadHolder());
        const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const codes = await Promise.all(names.map((t) => new Promise((res) => {
          const p = spawn(process.execPath, [CLI, 'reflect', 'lessons', 'save', '--role', 'r', '--session', 's' + t, '--distinct', '--text', `Verify ${t}${t}${t} ${t}${t}x ${t}${t}y config before deploy.`], { cwd: d, stdio: 'ignore' });
          p.on('close', res);
        })));
        assert.deepEqual(codes, names.map(() => 0), `round ${round}`);
        const lessons = JSON.parse(await fs.readFile(path.join(d, '.claude/kit/lessons.json'), 'utf-8')).lessons;
        assert.equal(lessons.length, 8, `round ${round}`);
        assert.equal(new Set(lessons.map((l) => l.id)).size, 8);
        assert.deepEqual((await fs.readdir(path.join(d, '.claude/kit'))).sort(), ['lessons.json'], `round ${round}`);
      } finally { await fs.rm(d, { recursive: true, force: true }); }
    }
  });
  it('library saveLesson does not mutate on refusal', () => {
    const data = { version: 1, lessons: [] };
    saveLesson(data, { role: 'r', session: 's', text: 'Check logs before restarting the daemon.' });
    assert.throws(() => saveLesson(data, { role: 'r', session: 's', text: 'Check logs before restarting daemon.' }), (e) => e.code === 2 && e.match.id === 'L1');
    assert.equal(data.lessons.length, 1);
  });
  it('accepts lessons in non-ASCII scripts and scores accented words whole', () => {
    for (const ok of ['Éteignez le cache avant les tests.', 'Überprüfe die Konfiguration vor dem Deploy.', 'Проверьте конфигурацию перед деплоем.', '設定を確認してからデプロイする。']) {
      assert.equal(checkLessonText(ok), ok);
    }
    assert.ok(overlap('Vérifiez la configuration avant le déploiement', 'Vérifiez la configuration avant le déploiement') === 1);
    assert.ok(overlap('Vérifiez le cache', 'Rifiez le cache') < 0.7);
  });
  it('text handling table: normalisation, combining marks, unspaced scripts, full-width ends, English-only imperative', () => {
    const fr = 'Vérifiez la configuration avant le déploiement';
    const rows = [
      { name: 'English duplicate', a: 'Check logs before restarting the daemon.', b: 'Check logs before restarting daemon.', min: 0.5 },
      { name: 'French NFD vs NFC is an exact match', a: fr.normalize('NFD'), b: fr.normalize('NFC'), eq: 1 },
      { name: 'Devanagari words stay whole', a: 'परीक्षण से पहले कैश जाँचें', b: 'परीक्षण से पहले कैश जाँचें', eq: 1, size: 5 },
      { name: 'Devanagari different words differ', a: 'परीक्षण से पहले कैश जाँचें', b: 'तैनाती से पहले लॉग देखें', max: 0.3 },
      { name: 'Japanese near-duplicates trip the guard', a: '設定を確認してからデプロイする。', b: '設定を確認してからデプロイしてください。', min: 0.5 },
      { name: 'Japanese unrelated stay apart', a: '設定を確認してからデプロイする。', b: 'ログを消さずに再起動してください。', max: 0.3 }
    ];
    for (const r of rows) {
      const o = overlap(r.a, r.b);
      if (r.eq !== undefined) assert.equal(o, r.eq, r.name);
      if (r.min !== undefined) assert.ok(o >= r.min, `${r.name}: ${o}`);
      if (r.max !== undefined) assert.ok(o <= r.max, `${r.name}: ${o}`);
      if (r.size !== undefined) assert.equal(words(r.a).size, r.size, r.name);
    }
    const refused = (t) => assert.throws(() => checkLessonText(t), (e) => e.code === 1, t);
    refused('設定を確認する。デプロイしてからログを見る。');
    refused('設定を確認する！デプロイしてからログを見る');
    refused('Проверьте конфиг! Потом деплой.');
    assert.equal(checkLessonText('設定を確認してからデプロイする。'), '設定を確認してからデプロイする。');
    // the imperative check is English-only (documented): a German statement passes, an English one is refused
    assert.equal(checkLessonText('Die Konfiguration ist kaputt.'), 'Die Konfiguration ist kaputt.');
    assert.throws(() => checkLessonText('The configuration is broken.'), (e) => e.code === 1 && /English/.test(e.message));
    // the near-match guard works end to end for a saved Japanese lesson
    const data = { version: 1, lessons: [] };
    saveLesson(data, { role: 'r', session: 's', text: '設定を確認してからデプロイする。' });
    assert.throws(() => saveLesson(data, { role: 'r', session: 's', text: '設定を確認してからデプロイしてください。' }), (e) => e.code === 2 && e.match.id === 'L1');
  });
});
