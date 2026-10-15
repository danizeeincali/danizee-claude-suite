import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as nl from '../src/lib/kit/noise-ledger.js';

const f = (id, severity, locs, extra = {}) => ({ id, severity, rule: 'r', locations: locs, ...extra });
const NOW = '2026-10-15';

async function tmp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noise-ledger-'));
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
const io = (cwd, stdin = '') => ({ cwd, stdin: async () => stdin, env: {} });
const code = async (p) => { try { await p; return null; } catch (e) { return e.code; } };

describe('noise-ledger: planning', () => {
  it('ranks by severity then by locations then id, files top N, folds the rest', () => {
    const r = nl.plan([
      f('d', 'low', ['a', 'b', 'c']), f('b', 'high', ['a']), f('a', 'high', ['a', 'b']),
      f('c', 'medium', ['a']), f('e', 'medium', ['a', 'b'])
    ], { cap: 3, now: NOW });
    assert.deepEqual(r.filed.map(x => x.id), ['a', 'b', 'e']);
    assert.deepEqual(r.summary.ids, ['c', 'd']);
    assert.equal(r.summary.count, 2);
    assert.deepEqual(r.summary.by_severity, { high: 0, medium: 1, low: 1 });
    assert.equal(r.blocking, true);
  });
  it('same input gives same output regardless of input order', () => {
    const list = [f('x', 'low', ['a']), f('y', 'low', ['a']), f('z', 'high', [])];
    assert.deepEqual(nl.plan(list, { now: NOW }), nl.plan([...list].reverse(), { now: NOW }));
  });
  it('first run reports everything but never blocks', () => {
    const r = nl.plan([f('a', 'high', ['s'])], { firstRun: true, now: NOW });
    assert.equal(r.blocking, false);
    assert.equal(r.filed.length, 1);
    assert.equal(r.first_run, true);
  });
  it('quarantines a finding that failed to reproduce on two retries; it never blocks and is flagged', () => {
    const r = nl.plan([f('q', 'high', ['s'], { failures: 3, reproductions: 0 })], { now: NOW });
    assert.deepEqual(r.quarantined.map(x => x.id), ['q']);
    assert.equal(r.filed.length, 0);
    assert.equal(r.blocking, false);
    assert.equal(r.needs_attention, true);
    assert.match(r.attention, /baseline|determinism/);
  });
  it('one non-reproduction is not enough', () => {
    const r = nl.plan([f('q', 'high', ['s'], { failures: 2, reproductions: 1 })], { now: NOW });
    assert.equal(r.quarantined.length, 0);
    assert.equal(r.filed.length, 1);
    assert.equal(r.needs_attention, false);
  });
  it('a finding that reproduced at least once is filed and blocks, never quarantined', () => {
    const r = nl.plan([f('z', 'high', ['s'], { failures: 5, reproductions: 3 }), f('y', 'high', ['s'], { failures: 3, reproductions: 1 })], { now: NOW });
    assert.equal(r.quarantined.length, 0);
    assert.deepEqual(r.filed.map(x => x.id), ['y', 'z']);
    assert.equal(r.blocking, true);
    assert.equal(r.needs_attention, false);
  });
  it('--now with a UTC offset uses the UTC day', () => {
    assert.equal(nl.plan([], { now: '2026-10-15T23:30:00-05:00' }).date, '2026-10-16');
    assert.equal(nl.plan([], { now: '2026-10-16T02:00:00+09:00' }).date, '2026-10-15');
    assert.equal(nl.plan([], { now: '2026-10-15T23:30:00' }).date, '2026-10-15');
    assert.equal(nl.plan([], { now: '2026-10-15' }).date, '2026-10-15');
    const ledger = { entries: [{ id: 'a', reason: 'x', expires: '2026-10-15' }] };
    assert.equal(nl.plan([f('a', 'low', [])], { ledger, now: '2026-10-15T23:30:00-05:00' }).accepted.length, 0);
  });
  it('quarantined findings do not use up the cap', () => {
    const r = nl.plan([f('q', 'high', [], { failures: 2, reproductions: 0 }), f('a', 'low', [])], { cap: 1, now: NOW });
    assert.deepEqual(r.filed.map(x => x.id), ['a']);
  });
  it('flake rate = (failures - reproductions) / failures, null with no failures', () => {
    assert.equal(nl.flakeRate([{ failures: 4, reproductions: 1 }, { failures: 4, reproductions: 3 }]), 0.5);
    assert.equal(nl.flakeRate([{ failures: 0, reproductions: 0 }]), null);
    assert.equal(nl.plan([f('a', 'low', [])], { now: NOW }).flake_rate, null);
  });
  it('cap 0 folds everything', () => {
    const r = nl.plan([f('a', 'low', [])], { cap: 0, now: NOW });
    assert.equal(r.filed.length, 0);
    assert.equal(r.summary.count, 1);
  });
  it('no findings: empty, not blocking', () => {
    const r = nl.plan([], { now: NOW });
    assert.equal(r.blocking, false);
    assert.equal(r.summary, null);
  });
});

describe('noise-ledger: ledger matching and dates', () => {
  const ledger = { version: 1, entries: [
    { id: 'old', reason: 'r', expires: '2026-10-14' },
    { id: 'today', reason: 'r', expires: '2026-10-15' },
    { id: 'forever', reason: 'r' }
  ] };
  it('accepted entries are reported not filed; expired never match', () => {
    const r = nl.plan([f('old', 'high', []), f('today', 'high', []), f('forever', 'low', []), f('n', 'low', [])], { ledger, now: NOW });
    assert.deepEqual(r.accepted.map(x => x.id), ['forever', 'today']);
    assert.deepEqual(r.filed.map(x => x.id), ['old', 'n']);
    assert.deepEqual(r.expired_ledger.map(x => x.id), ['old']);
  });
  it('validates dates strictly', () => {
    assert.equal(nl.parseDate('2026-02-30'), null);
    assert.equal(nl.parseDate('2026-2-3'), null);
    assert.equal(nl.parseDate('2026-10-15'), '2026-10-15');
    assert.equal(nl.parseDate('2026-10-15T23:59:00Z'), '2026-10-15');
    assert.equal(nl.parseDate('nope'), null);
    assert.equal(nl.parseDate(20261015), null);
  });
  it('bad input throws exit 1', () => {
    assert.throws(() => nl.plan([f('a', 'urgent', [])], { now: NOW }), { code: 1 });
    assert.throws(() => nl.plan([f('a', 'low', [], { failures: 1, reproductions: 2 })], { now: NOW }), { code: 1 });
    assert.throws(() => nl.plan([f('a', 'low', []), f('a', 'low', [])], { now: NOW }), { code: 1 });
    assert.throws(() => nl.plan([{ severity: 'low' }], { now: NOW }), { code: 1 });
    assert.throws(() => nl.plan([f('a', 'low', [], { failures: -1 })], { now: NOW }), { code: 1 });
    assert.throws(() => nl.plan([f('a', 'low', [])], { cap: -1, now: NOW }), { code: 1 });
    assert.throws(() => nl.plan([f('a', 'low', [])], { now: 'garbage' }), { code: 1 });
    assert.throws(() => nl.plan([f('a', 'low', [])], { ledger: { entries: [{ id: 'a', reason: 'x', expires: '2026-13-01' }] }, now: NOW }), { code: 1 });
  });
  it('fingerprint works as an id', () => {
    const r = nl.plan([{ fingerprint: 'fp1', severity: 'low' }], { now: NOW });
    assert.equal(r.filed[0].id, 'fp1');
  });
});

describe('noise-ledger: CLI', () => {
  it('apply reads stdin, default ledger path, advisory exit 0', () => tmp(async (dir) => {
    await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
    await fs.writeFile(path.join(dir, '.claude/kit/noise-ledger.json'), JSON.stringify({ version: 1, entries: [{ id: 'a', reason: 'known' }] }));
    const r = await nl.run(['apply', '--now', NOW], io(dir, JSON.stringify({ findings: [f('a', 'high', []), f('b', 'low', [])] })));
    assert.deepEqual(r.accepted.map(x => x.id), ['a']);
    assert.deepEqual(r.filed.map(x => x.id), ['b']);
    assert.ok(!r.exit);
  }));
  it('apply reads --in and missing default ledger is empty; missing explicit ledger is exit 1', () => tmp(async (dir) => {
    await fs.writeFile(path.join(dir, 'in.json'), JSON.stringify([f('b', 'low', [])]));
    const r = await nl.run(['apply', '--in', 'in.json', '--now', NOW, '--cap', '1', '--first-run'], io(dir));
    assert.equal(r.filed.length, 1);
    assert.equal(r.blocking, false);
    assert.equal(await code(nl.run(['apply', '--in', 'in.json', '--ledger', 'nope.json', '--now', NOW], io(dir))), 1);
  }));
  it('bad json, bad flags, bad cap, empty stdin: exit 1', () => tmp(async (dir) => {
    assert.equal(await code(nl.run(['apply', '--now', NOW], io(dir, '{nope'))), 1);
    assert.equal(await code(nl.run(['apply', '--now', NOW], io(dir, ''))), 1);
    assert.equal(await code(nl.run(['apply', '--cap', 'x', '--now', NOW], io(dir, '[]'))), 1);
    assert.equal(await code(nl.run(['apply', '--bogus'], io(dir, '[]'))), 1);
    assert.equal(await code(nl.run(['wat'], io(dir))), 1);
    assert.equal(await code(nl.run([], io(dir))), 1);
  }));
  it('accept adds, replaces, validates; prune drops expired and reports them', () => tmp(async (dir) => {
    const p = path.join(dir, 'l.json');
    await nl.run(['accept', '--ledger', p, '--id', 'b', '--reason', 'why', '--expires', '2026-12-01', '--now', NOW], io(dir));
    await nl.run(['accept', '--ledger', p, '--id', 'a', '--reason', 'forever', '--now', NOW], io(dir));
    let saved = JSON.parse(await fs.readFile(p, 'utf-8'));
    assert.deepEqual(saved.entries.map(e => e.id), ['a', 'b']);
    await nl.run(['accept', '--ledger', p, '--id', 'b', '--reason', 'again', '--expires', '2026-12-02', '--now', NOW], io(dir));
    saved = JSON.parse(await fs.readFile(p, 'utf-8'));
    assert.equal(saved.entries.length, 2);
    assert.equal(saved.entries[1].reason, 'again');
    assert.equal(await code(nl.run(['accept', '--ledger', p, '--id', 'c', '--reason', 'x', '--expires', '2026-02-30', '--now', NOW], io(dir))), 1);
    assert.equal(await code(nl.run(['accept', '--ledger', p, '--id', 'c', '--reason', 'x', '--expires', '2026-10-01', '--now', NOW], io(dir))), 1);
    assert.equal(await code(nl.run(['accept', '--ledger', p, '--id', 'c', '--now', NOW], io(dir))), 1);
    const pr = await nl.run(['prune', '--ledger', p, '--now', '2027-01-01'], io(dir));
    assert.deepEqual(pr.pruned.map(e => e.id), ['b']);
    assert.deepEqual(JSON.parse(await fs.readFile(p, 'utf-8')).entries.map(e => e.id), ['a']);
    const none = await nl.run(['prune', '--ledger', p, '--now', '2027-01-01'], io(dir));
    assert.deepEqual(none.pruned, []);
  }));
  it('prune on a missing ledger creates nothing; a broken ledger is exit 1', () => tmp(async (dir) => {
    const p = path.join(dir, 'x.json');
    const r = await nl.run(['prune', '--ledger', p, '--now', NOW], io(dir));
    assert.deepEqual(r.pruned, []);
    await assert.rejects(fs.stat(p));
    await fs.writeFile(p, '{"entries":"no"}');
    assert.equal(await code(nl.run(['prune', '--ledger', p, '--now', NOW], io(dir))), 1);
  }));
  it('accept and prune keep unknown entry and top-level fields', () => tmp(async (dir) => {
    const p = path.join(dir, 'l.json');
    await fs.writeFile(p, JSON.stringify({ version: 1, team: 'qa', entries: [{ id: 'a', reason: 'r', owner: 'me', ticket: 'T-1', expires: '2026-01-01' }, { id: 'b', reason: 'r', owner: 'you' }] }));
    await nl.run(['accept', '--ledger', p, '--id', 'c', '--reason', 'x', '--now', NOW], io(dir));
    let l = JSON.parse(await fs.readFile(p, 'utf-8'));
    assert.equal(l.team, 'qa');
    assert.equal(l.entries.find(e => e.id === 'a').ticket, 'T-1');
    assert.equal(l.entries.find(e => e.id === 'b').owner, 'you');
    await nl.run(['prune', '--ledger', p, '--now', NOW], io(dir));
    l = JSON.parse(await fs.readFile(p, 'utf-8'));
    assert.equal(l.team, 'qa');
    assert.deepEqual(l.entries.map(e => e.id), ['b', 'c']);
    assert.equal(l.entries[0].owner, 'you');
  }));
  it('a ledger with a newer version is refused (exit 1) and left untouched', () => tmp(async (dir) => {
    const p = path.join(dir, 'l.json');
    const text = JSON.stringify({ version: 2, entries: [{ id: 'a', reason: 'r', expires: '2026-01-01' }] });
    await fs.writeFile(p, text);
    assert.equal(await code(nl.run(['accept', '--ledger', p, '--id', 'c', '--reason', 'x', '--now', NOW], io(dir))), 1);
    assert.equal(await code(nl.run(['prune', '--ledger', p, '--now', NOW], io(dir))), 1);
    assert.equal(await code(nl.run(['apply', '--ledger', p, '--now', NOW], io(dir, '[]'))), 1);
    assert.equal(await fs.readFile(p, 'utf-8'), text);
  }));
  it('--in - reads findings from stdin', () => tmp(async (dir) => {
    const r = await nl.run(['apply', '--in', '-', '--now', NOW], io(dir, JSON.stringify([f('a', 'high', [])])));
    assert.deepEqual(r.filed.map(x => x.id), ['a']);
    assert.equal(await code(nl.run(['apply', '--in', '-', '--now', NOW], { cwd: dir, stdinIsTTY: true, env: {} })), 1);
  }));
});
