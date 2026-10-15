import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { verb, run, normalizeElement, normalizeScope, fingerprintOf, LINE_BUCKET } from '../src/lib/kit/triage.js';

async function withDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'triage-'));
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
const v = (scope, rule, element, extra = {}) => ({ scope, rule, element, source: 'auto', detail: 'd', ...extra });
const visit = (dir, session, body, more = []) => run(['visit', '--session', session, '--state', 'st.json', ...more], { cwd: dir, stdin: async () => JSON.stringify(body) });
const body = (violations, scopes = [], enabled = ['r1', 'r2']) => ({ violations, scopes, enabled });
const code = async (p) => { try { await p; return 0; } catch (e) { return e.code; } };

describe('triage normalisation', () => {
  it('verb name', () => assert.equal(verb, 'triage'));
  it('elements: case, whitespace, indexes and long numbers do not change identity', () => {
    assert.equal(normalizeElement({ element: 'DIV.Card  > a:nth-child(3)' }), normalizeElement({ element: 'div.card > a:nth-child(7)' }));
    assert.equal(normalizeElement({ element: 'li[4]' }), normalizeElement({ element: 'li[9]' }));
    assert.equal(normalizeElement({ element: '#row-123456' }), normalizeElement({ element: '#row-987654' }));
    assert.notEqual(normalizeElement({ element: 'button.save' }), normalizeElement({ element: 'button.cancel' }));
  });
  it('locations: line shifts inside a bucket keep identity, across a bucket change it', () => {
    const at = (l) => normalizeElement({ location: `src/a.js:${l}:3` });
    assert.equal(at(1), at(LINE_BUCKET));
    assert.notEqual(at(LINE_BUCKET), at(LINE_BUCKET + 1));
    assert.equal(normalizeElement({ location: { file: './src\\a.js', line: 5 } }), at(5));
  });
  it('fingerprint ignores element order and duplicates, differs by scope and rule', () => {
    const a = fingerprintOf('s', 'r', ['x', 'y']);
    assert.equal(a, fingerprintOf('s', 'r', ['y', 'x', 'x']));
    assert.notEqual(a, fingerprintOf('s2', 'r', ['x', 'y']));
    assert.notEqual(a, fingerprintOf('s', 'r2', ['x', 'y']));
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.equal(normalizeScope('./a\\b.js'), 'a/b.js');
  });
});

describe('triage visit', () => {
  it('merges violations of one rule on one scope into one candidate', () => withDir(async (dir) => {
    const r = await visit(dir, 's1', body([v('p', 'r1', 'a.x'), v('p', 'r1', 'b.y'), v('p', 'r1', 'c.z'), v('p', 'r2', 'q'), v('o', 'r1', 'a.x')]));
    assert.equal(r.raise.length, 3);
    const c = r.raise.find((x) => x.scope === 'p' && x.rule === 'r1');
    assert.equal(c.count, 3);
    assert.deepEqual(c.elements, ['a.x', 'b.y', 'c.z']);
    assert.equal(c.status, 'new');
  }));

  it('does not raise a dismissed or accepted fingerprint again', () => withDir(async (dir) => {
    const r = await visit(dir, 's1', body([v('p', 'r1', 'a'), v('p', 'r2', 'b')]));
    const [f1, f2] = [r.raise.find((x) => x.rule === 'r1').fingerprint, r.raise.find((x) => x.rule === 'r2').fingerprint];
    await run(['decide', f1, '--as', 'dismissed', '--state', 'st.json'], { cwd: dir });
    await run(['decide', f2, '--as', 'accepted', '--state', 'st.json'], { cwd: dir });
    const r2 = await visit(dir, 's2', body([v('p', 'r1', 'a'), v('p', 'r2', 'b')]));
    assert.deepEqual(r2.raise, []);
    assert.equal(r2.skipped.length, 2);
    assert.match(r2.skipped[0].reason, /dismissed|accepted/);
  }));

  it('a filed issue gets one occurrence per session id at most', () => withDir(async (dir) => {
    const r = await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    const fp = r.raise[0].fingerprint;
    const d = await run(['decide', fp, '--as', 'filed', '--issue', 'GH-7', '--state', 'st.json'], { cwd: dir });
    assert.equal(d.issue, 'GH-7');
    const r2 = await visit(dir, 's2', body([v('p', 'r1', 'a')]));
    assert.equal(r2.raise.length, 0);
    assert.equal(r2.recurred[0].issue, 'GH-7');
    assert.equal(r2.recurred[0].occurrences, 2);
    assert.equal(r2.recurred[0].counted, true);
    const again = await visit(dir, 's2', body([v('p', 'r1', 'a')]));
    assert.equal(again.recurred[0].occurrences, 2);
    assert.equal(again.recurred[0].counted, false);
    const r3 = await visit(dir, 's3', body([v('p', 'r1', 'a')]));
    assert.equal(r3.recurred[0].occurrences, 3);
  }));

  it('an undecided candidate is raised again until decided, counted once per session', () => withDir(async (dir) => {
    const a = await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    const b = await visit(dir, 's2', body([v('p', 'r1', 'a')]));
    assert.equal(b.raise[0].fingerprint, a.raise[0].fingerprint);
    assert.equal(b.raise[0].status, 'pending');
  }));

  it('identity survives a changed element set that still overlaps', () => withDir(async (dir) => {
    const a = await visit(dir, 's1', body([v('p', 'r1', 'a'), v('p', 'r1', 'b')]));
    const b = await visit(dir, 's2', body([v('p', 'r1', 'b'), v('p', 'r1', 'c')]));
    assert.equal(b.raise[0].fingerprint, a.raise[0].fingerprint);
  }));

  it('absence closes an auto issue after 3 consecutive clean visits; a sighting resets', () => withDir(async (dir) => {
    const r = await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    const fp = r.raise[0].fingerprint;
    await run(['decide', fp, '--as', 'filed', '--issue', 'GH-1', '--state', 'st.json'], { cwd: dir });
    const clean = (s) => visit(dir, s, body([], ['p']));
    assert.deepEqual((await clean('s2')).closed, []);
    assert.deepEqual((await clean('s3')).closed, []);
    await visit(dir, 's4', body([v('p', 'r1', 'a')])); // reset
    assert.deepEqual((await clean('s5')).closed, []);
    assert.deepEqual((await clean('s6')).closed, []);
    const last = await clean('s7');
    assert.equal(last.closed.length, 1);
    assert.equal(last.closed[0].issue, 'GH-1');
    assert.equal(last.closed[0].fingerprint, fp);
    const list = await run(['list', '--state', 'st.json'], { cwd: dir });
    assert.equal(list.records[0].status, 'fixed');
    assert.deepEqual((await clean('s8')).closed, []);
    // it comes back: reopened
    const back = await visit(dir, 's9', body([v('p', 'r1', 'a')]));
    assert.equal(back.raise[0].status, 'reopened');
    assert.equal(back.raise[0].issue, 'GH-1');
  }));

  it('a visit to another scope is no evidence', () => withDir(async (dir) => {
    await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    for (const s of ['s2', 's3', 's4', 's5']) assert.deepEqual((await visit(dir, s, body([], ['other']))).closed, []);
    const list = await run(['list', '--state', 'st.json'], { cwd: dir });
    assert.equal(list.records[0].absent_visits, 0);
  }));

  it('a check that was not enabled gives no evidence: count does not move, issue is skipped', () => withDir(async (dir) => {
    await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    for (const s of ['s2', 's3', 's4', 's5']) {
      const r = await visit(dir, s, body([], ['p'], ['r2']));
      assert.deepEqual(r.closed, []);
      assert.equal(r.skipped[0].reason, 'check_not_enabled');
    }
    assert.equal((await run(['list', '--state', 'st.json'], { cwd: dir })).records[0].absent_visits, 0);
  }));

  it('agent-sourced issues never auto-close, even mixed with auto sightings', () => withDir(async (dir) => {
    await visit(dir, 's1', body([v('p', 'r1', 'a', { source: 'agent' })]));
    await visit(dir, 's2', body([v('q', 'r1', 'a'), v('q', 'r1', 'b', { source: 'agent' })]));
    for (const s of ['s3', 's4', 's5', 's6']) {
      const r = await visit(dir, s, body([], ['p', 'q']));
      assert.deepEqual(r.closed, []);
      assert.ok(r.skipped.every((x) => x.reason === 'agent_sourced'));
    }
  }));

  it('replaying a session id for a scope does not advance the absence count twice', () => withDir(async (dir) => {
    await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    for (let i = 0; i < 5; i++) await visit(dir, 's2', body([], ['p']));
    assert.equal((await run(['list', '--state', 'st.json'], { cwd: dir })).records[0].absent_visits, 1);
  }));

  it('decided records are never closed by absence', () => withDir(async (dir) => {
    const r = await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    await run(['decide', r.raise[0].fingerprint, '--as', 'accepted', '--state', 'st.json'], { cwd: dir });
    for (const s of ['s2', 's3', 's4', 's5']) assert.deepEqual((await visit(dir, s, body([], ['p']))).closed, []);
    assert.equal((await run(['list', '--state', 'st.json'], { cwd: dir })).records[0].status, 'accepted');
  }));

  it('writes state atomically and leaves no temp file', () => withDir(async (dir) => {
    await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    assert.deepEqual((await fs.readdir(dir)).sort(), ['st.json']);
    JSON.parse(await fs.readFile(path.join(dir, 'st.json'), 'utf-8'));
  }));

  it('default state path is .claude/kit/triage.json', () => withDir(async (dir) => {
    await run(['visit', '--session', 's'], { cwd: dir, stdin: async () => JSON.stringify(body([v('p', 'r1', 'a')])) });
    await fs.access(path.join(dir, '.claude/kit/triage.json'));
  }));

  it('reads --in file', () => withDir(async (dir) => {
    await fs.writeFile(path.join(dir, 'in.json'), JSON.stringify(body([v('p', 'r1', 'a')])));
    const r = await run(['visit', '--session', 's', '--in', 'in.json', '--state', 'st.json'], { cwd: dir });
    assert.equal(r.raise.length, 1);
  }));
});

describe('triage invalid input exits 1 and leaves state untouched', () => {
  const bad = [
    ['missing enabled', { violations: [] , scopes: ['p'] }],
    ['no violations and no scopes', { enabled: [] }],
    ['bad source', body([v('p', 'r1', 'a', { source: 'robot' })])],
    ['missing rule', body([{ scope: 'p', source: 'auto' }])],
    ['missing scope', body([{ rule: 'r1', source: 'auto' }])],
    ['not an object', []],
    ['bad location', body([v('p', 'r1', undefined, { location: 5 })])]
  ];
  for (const [name, b] of bad) {
    it(name, () => withDir(async (dir) => {
      assert.equal(await code(visit(dir, 's1', b)), 1);
      await assert.rejects(fs.access(path.join(dir, 'st.json')));
    }));
  }
  it('missing session, bad json, unknown flag, unknown subcommand', () => withDir(async (dir) => {
    assert.equal(await code(run(['visit'], { cwd: dir, stdin: async () => '{}' })), 1);
    assert.equal(await code(run(['visit', '--session', 's'], { cwd: dir, stdin: async () => '{nope' })), 1);
    assert.equal(await code(run(['visit', '--session', 's', '--zz'], { cwd: dir, stdin: async () => '{}' })), 1);
    assert.equal(await code(run(['nope'], { cwd: dir })), 1);
    assert.equal(await code(run([], { cwd: dir })), 1);
  }));
  it('corrupt state', () => withDir(async (dir) => {
    for (const text of ['{broken', '[]', '{"version":9,"records":{}}', '{"version":1,"records":{"x":{"status":"weird"}}}']) {
      await fs.writeFile(path.join(dir, 'st.json'), text);
      assert.equal(await code(visit(dir, 's1', body([v('p', 'r1', 'a')]))), 1, text);
      assert.equal(await fs.readFile(path.join(dir, 'st.json'), 'utf-8'), text);
    }
  }));
  it('decide: unknown fingerprint, bad --as, --issue on non-filed', () => withDir(async (dir) => {
    const r = await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    const fp = r.raise[0].fingerprint;
    assert.equal(await code(run(['decide', 'ffffffffffffffff', '--as', 'filed', '--state', 'st.json'], { cwd: dir })), 1);
    assert.equal(await code(run(['decide', fp, '--as', 'fixed', '--state', 'st.json'], { cwd: dir })), 1);
    assert.equal(await code(run(['decide', fp, '--as', 'dismissed', '--issue', 'x', '--state', 'st.json'], { cwd: dir })), 1);
    assert.equal(await code(run(['decide', fp, '--state', 'st.json'], { cwd: dir })), 1);
    const pre = await run(['decide', fp.slice(0, 8), '--as', 'filed', '--issue', 'I', '--state', 'st.json'], { cwd: dir });
    assert.equal(pre.fingerprint, fp);
  }));
});

describe('triage review round 1 fixes', () => {
  it('a record whose element still fires is not closed when a candidate overlaps two live records', () => withDir(async (dir) => {
    await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    await visit(dir, 's2', body([v('p', 'r1', 'b')]));
    for (const s of ['s3', 's4', 's5']) {
      const r = await visit(dir, s, body([v('p', 'r1', 'a'), v('p', 'r1', 'b')]));
      assert.deepEqual(r.closed, []);
    }
    const list = await run(['list', '--state', 'st.json'], { cwd: dir });
    assert.ok(list.records.every((x) => x.status !== 'fixed' && x.absent_visits === 0));
  }));

  it('a reopened filed issue stays filed: later sightings recur with the issue ref', () => withDir(async (dir) => {
    const r = await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    await run(['decide', r.raise[0].fingerprint, '--as', 'filed', '--issue', 'GH-1', '--state', 'st.json'], { cwd: dir });
    for (const s of ['s2', 's3', 's4']) await visit(dir, s, body([], ['p']));
    const back = await visit(dir, 's5', body([v('p', 'r1', 'a')]));
    assert.equal(back.raise[0].status, 'reopened');
    assert.equal(back.raise[0].issue, 'GH-1');
    const next = await visit(dir, 's6', body([v('p', 'r1', 'a')]));
    assert.deepEqual(next.raise, []);
    assert.equal(next.recurred[0].issue, 'GH-1');
    assert.equal(next.recurred[0].counted, true);
  }));

  it('a UTF-8 BOM on --in, stdin and the state file is accepted', () => withDir(async (dir) => {
    const bom = '\uFEFF';
    await fs.writeFile(path.join(dir, 'in.json'), bom + JSON.stringify(body([v('p', 'r1', 'a')])));
    assert.equal((await run(['visit', '--session', 's', '--in', 'in.json', '--state', 'st.json'], { cwd: dir })).raise.length, 1);
    const r = await run(['visit', '--session', 't', '--state', 'st.json'], { cwd: dir, stdin: async () => bom + JSON.stringify(body([v('p', 'r1', 'a')])) });
    assert.equal(r.raise.length, 1);
    await fs.writeFile(path.join(dir, 'st.json'), bom + await fs.readFile(path.join(dir, 'st.json'), 'utf-8'));
    assert.equal((await run(['list', '--state', 'st.json'], { cwd: dir })).records.length, 1);
  }));

  it('list reads a read-only state without taking a lock', () => withDir(async (dir) => {
    await visit(dir, 's1', body([v('p', 'r1', 'a')]));
    await fs.chmod(dir, 0o555);
    try { assert.equal((await run(['list', '--state', 'st.json'], { cwd: dir })).records.length, 1); } finally { await fs.chmod(dir, 0o755); }
  }));

  it('parallel writer processes keep every write, with a pre-aged stale lock, repeated 10 times', { timeout: 280000 }, async () => {
    const mod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/kit/triage.js');
    const child = `import { run } from ${JSON.stringify('file://' + mod)};
const [dir, id] = process.argv.slice(1);
await run(['visit', '--session', 's' + id, '--state', 'st.json'], { cwd: dir, stdin: async () => JSON.stringify({ enabled: ['r1'], violations: [{ scope: 'p' + id, rule: 'r1', source: 'auto', element: 'e' }] }) });`;
    for (let round = 0; round < 10; round++) {
      await withDir(async (dir) => {
        const lock = path.join(dir, 'st.json.lock');
        await fs.writeFile(lock, 'dead-token');
        const old = new Date(Date.now() - 3600 * 1000);
        await fs.utimes(lock, old, old);
        const N = 6;
        await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve, reject) => {
          const c = spawn(process.execPath, ['--input-type=module', '-e', child, dir, String(i)], { stdio: ['ignore', 'ignore', 'pipe'] });
          let err = '';
          c.stderr.on('data', (d) => { err += d; });
          c.on('exit', (k) => (k === 0 ? resolve() : reject(new Error(`writer ${i} exit ${k}: ${err}`))));
        })));
        const st = JSON.parse(await fs.readFile(path.join(dir, 'st.json'), 'utf-8'));
        assert.equal(Object.keys(st.records).length, N);
        assert.deepEqual((await fs.readdir(dir)).sort(), ['st.json']);
      });
    }
  });
});
