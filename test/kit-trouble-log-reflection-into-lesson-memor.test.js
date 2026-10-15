import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { run, troubleLog, overlap, checkLessonText, saveLesson, withLock } from '../src/lib/kit/reflect.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/kit/cli.js');
const jl = (arr) => arr.map((o) => JSON.stringify(o)).join('\n');
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
  it('a stale lock is broken', async () => {
    const d = await tmp();
    try {
      await fs.mkdir(path.join(d, '.claude/kit'), { recursive: true });
      const lock = path.join(d, '.claude/kit/lessons.json.lock');
      await fs.writeFile(lock, 'old-token');
      const old = new Date(Date.now() - 60000);
      await fs.utimes(lock, old, old);
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
      await fs.writeFile(lock, 'holder-token');
      const beat = setInterval(() => { const n = new Date(); fs.utimes(lock, n, n).catch(() => {}); }, 20);
      let ran = false;
      try {
        await assert.rejects(withLock(store, async () => { ran = true; }, { staleMs: 200, waitMs: 400 }), (e) => e.code === 1 && /locked/.test(e.message));
      } finally { clearInterval(beat); }
      assert.equal(ran, false);
      assert.equal(await fs.readFile(lock, 'utf-8'), 'holder-token');
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
  it('the total wait is longer than the stale age, so a waiter reaches the break path', async () => {
    const d = await tmp();
    try {
      const store = path.join(d, 'k/lessons.json');
      await fs.mkdir(path.dirname(store), { recursive: true });
      await fs.writeFile(store + '.lock', 'dead');
      let ran = false;
      await withLock(store, async () => { ran = true; }, { staleMs: 300, waitMs: 10 });
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
      const old = new Date(Date.now() - 5000);
      await fs.utimes(lock, old, old); await fs.utimes(lock + '.break', old, old);
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
        await fs.writeFile(lock, 'dead-token');
        const old = new Date(Date.now() - 60000);
        await fs.utimes(lock, old, old);
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
});
