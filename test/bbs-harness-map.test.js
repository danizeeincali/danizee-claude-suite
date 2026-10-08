/**
 * Contract for src/lib/bbs/harness-map.js and the `map` verb — stream `harness-map` of marathon 2026-10-07-bbs.
 * Index what the harness has; find the 5 nearest tools per power by IDF-weighted cosine (name ×3);
 * a helper judges only those 5: have | partial | missing. No LLM in `map`; the judgment is `map --from`.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  STOP_WORDS, KINDS, STATUSES, tokenize, idf, vectorize, cosine, buildIndex, matchPower, buildMap, mapBrief, recordJudgments, withMapLock, withMapLockDetailed, LOCK_STALE_MS, LOCK_REFRESH_MS
} from '../src/lib/bbs/harness-map.js';
import { intake } from '../src/lib/bbs/intake.js';
import { writeInventory, parseJsonOnly } from '../src/lib/bbs/inventory.js';
import { moveAsideStale } from '../src/lib/bbs/store.js';
import { readJson } from '../src/lib/bbs/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(path.dirname(__dirname), 'src', 'lib', 'bbs', 'cli.js');
const now = () => new Date('2026-10-07T12:00:00Z');

const power = (over = {}) => ({
  name: 'drift-monitor', what: 'Detects config drift between runs', evidence: 'src/drift.js:12', dependencies: [],
  data_needed: 'none', network: 'none', size: 'small', licence: 'MIT', idea: 'Hash the effective config each run and diff against the last hash.', ...over
});

/** A fake harness: commands, a skill, helpers, a hook, modules, scripts. */
async function makeHarness(dir) {
  const w = async (rel, text) => { const p = path.join(dir, rel); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, text); };
  await w('.claude/commands/.shortcuts/w-review.md', '# /w-review\n\nFull Review - 12+ specialized agents analyze code for defects and drift.\n');
  await w('.claude/commands/workflows/plan.md', '# plan\n\nTransform feature ideas into implementation plans.\n');
  await w('.claude/skills/autoresearch/SKILL.md', '---\nname: autoresearch\n---\nAutonomous experiment loop for measurable optimization.\n');
  await w('.claude/helpers/marathon/gate.js', '// gate: evaluate finish-line lines, streaks and tolerance\nexport function evaluateGate() {}\n');
  await w('.claude/helpers/marathon/budget.js', '// budget guard: ceiling and run token budget\nexport function canFanOut() {}\n');
  await w('.claude/hooks/marathon-precompact.sh', '#!/bin/bash\n# stamp status.md before compaction\n');
  await w('src/lib/bbs/fetch.js', '// GET-only fetch with host policy and egress log\nexport function fetchUrl() {}\n');
  await w('src/plugins/marathon.js', '// installs marathon helpers and hooks\n');
  await w('scripts/check-drift.sh', '#!/bin/bash\n# compare config hash with the last run\n');
  await w('package.json', JSON.stringify({ name: 'x', scripts: { test: 'node --test test/*.test.js', lint: 'eslint .' } }));
  await w('node_modules/skip/me.js', 'should never be indexed');
  await w('.git/HEAD', 'ref: refs/heads/main');
  await w('src/lib/bbs/' + 'x'.repeat(10) + '.js', Array.from({ length: 200 }, (_, i) => `// line ${i} filler text about nothing`).join('\n'));
}

describe('harness-map — tokenize / idf / cosine', () => {
  it('tokenize lower-cases, splits on non-alphanumerics, drops stop words and 1-char tokens, keeps repeats', () => {
    assert.deepEqual(tokenize('The Drift-Monitor detects config drift, a drift!'), ['drift', 'monitor', 'detects', 'config', 'drift', 'drift']);
    assert.ok(STOP_WORDS.has('the') && STOP_WORDS.has('a') && STOP_WORDS.has('and'));
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize('x y zz'), ['zz']);
    assert.deepEqual(tokenize(null), []);
  });

  it('idf = ln((N+1)/(df+1)) + 1 over the documents; unseen tokens get the max (df 0)', () => {
    const docs = [['a', 'b'], ['a', 'c'], ['a']];
    const m = idf(docs);
    assert.equal(m.get('a').toFixed(4), (Math.log(4 / 4) + 1).toFixed(4));
    assert.equal(m.get('b').toFixed(4), (Math.log(4 / 2) + 1).toFixed(4));
    assert.equal(m.unseen.toFixed(4), (Math.log(4 / 1) + 1).toFixed(4));
  });

  it('vectorize weights tf × idf with an optional per-token boost; cosine is 1 for identical, 0 for disjoint, symmetric', () => {
    const m = idf([['a', 'b'], ['c']]);
    const v1 = vectorize(['a', 'a', 'b'], m);
    assert.equal(v1.get('a'), 2 * m.get('a'));
    const boosted = vectorize(['a'], m, { boost: new Map([['a', 3]]) });
    assert.equal(boosted.get('a'), 3 * m.get('a'));
    assert.equal(cosine(v1, v1).toFixed(6), '1.000000');
    assert.equal(cosine(v1, vectorize(['c'], m)), 0);
    assert.equal(cosine(vectorize([], m), v1), 0, 'empty vector → 0, never NaN');
    const v2 = vectorize(['b', 'c'], m);
    assert.equal(cosine(v1, v2).toFixed(6), cosine(v2, v1).toFixed(6));
  });
});

describe('harness-map — buildIndex', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hidx-')); await makeHarness(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('indexes commands, skills, helpers, hooks, modules and scripts (files + package.json scripts); skips node_modules and .git; sorted by id', async () => {
    const idx = await buildIndex(dir);
    assert.deepEqual(KINDS, ['command', 'skill', 'helper', 'hook', 'module', 'script']);
    const ids = idx.rows.map(r => r.id);
    assert.deepEqual(ids, [...ids].sort());
    const byKind = {};
    for (const r of idx.rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    assert.deepEqual(byKind, { command: 2, skill: 1, helper: 2, hook: 1, module: 3, script: 3 });
    assert.ok(!ids.some(i => /node_modules|\.git\//.test(i)));
    const cmd = idx.rows.find(r => r.path === '.claude/commands/.shortcuts/w-review.md');
    assert.equal(cmd.kind, 'command');
    assert.equal(cmd.name, 'w-review');
    assert.equal(cmd.id, 'command:.claude/commands/.shortcuts/w-review.md');
    const skill = idx.rows.find(r => r.kind === 'skill');
    assert.equal(skill.name, 'autoresearch');
    const npm = idx.rows.find(r => r.id === 'script:package.json#lint');
    assert.equal(npm.name, 'lint');
    assert.match(npm.text, /eslint/);
    assert.deepEqual(idx.byKind, byKind);
    assert.equal(idx.rows.length, 12);
  });

  it('text is the name plus the first 80 lines, lower-cased; tokens are precomputed; a file longer than 80 lines is cut', async () => {
    const idx = await buildIndex(dir);
    const big = idx.rows.find(r => r.path.includes('xxxxxxxxxx'));
    assert.ok(!big.text.includes('line 150'), 'only the first 80 lines');
    assert.ok(big.text.includes('line 79'));
    assert.equal(big.text, big.text.toLowerCase());
    assert.ok(Array.isArray(big.tokens) && big.tokens.length > 0);
    const cmd = idx.rows.find(r => r.name === 'w-review');
    assert.ok(cmd.tokens.includes('review') && cmd.tokens.includes('drift'));
  });

  it('an empty harness is an error, not an empty index; a missing optional dir is fine', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hempty-'));
    try {
      await assert.rejects(() => buildIndex(empty), /harness index is empty/);
      await fs.mkdir(path.join(empty, '.claude', 'commands'), { recursive: true });
      await fs.writeFile(path.join(empty, '.claude', 'commands', 'one.md'), '# one\n');
      const idx = await buildIndex(empty);
      assert.equal(idx.rows.length, 1);
    } finally { await fs.rm(empty, { recursive: true, force: true }); }
  });

  it('a file that cannot be read is reported in index.errors and skipped, never a silent hole', async () => {
    const p = path.join(dir, '.claude', 'commands', 'secret.md');
    await fs.writeFile(p, '# s');
    await fs.chmod(p, 0o000);
    try {
      if (process.getuid && process.getuid() === 0) return;
      const idx = await buildIndex(dir);
      assert.ok(idx.errors.some(e => e.path.endsWith('secret.md') && e.code === 'EACCES'));
    } finally { await fs.chmod(p, 0o644); await fs.unlink(p); }
  });
});

describe('harness-map — matchPower', () => {
  let dir, idx;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hmatch-')); await makeHarness(dir); idx = await buildIndex(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('returns at most k candidates with id/kind/name/path/score, sorted by score desc then name, scores rounded to 3 decimals, zero scores excluded', () => {
    const c = matchPower(power(), idx);
    assert.ok(c.length <= 5 && c.length > 0);
    for (const x of c) {
      assert.deepEqual(Object.keys(x).sort(), ['id', 'kind', 'name', 'path', 'score']);
      assert.equal(x.score, Number(x.score.toFixed(3)));
      assert.ok(x.score > 0);
    }
    for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].score > c[i].score || (c[i - 1].score === c[i].score && c[i - 1].name <= c[i].name));
    assert.equal(matchPower(power(), idx, { k: 2 }).length, 2);
  });

  it('the power name counts three times: a tool sharing only the name tokens outranks one sharing only a body word', () => {
    const c = matchPower(power({ name: 'drift check', what: 'x', idea: 'y' }), idx);
    assert.equal(c[0].path, 'scripts/check-drift.sh');
    const byName = matchPower(power({ name: 'autoresearch', what: 'loop', idea: 'experiments' }), idx);
    assert.equal(byName[0].kind, 'skill');
  });

  it('a power sharing no token with the harness returns []', () => {
    assert.deepEqual(matchPower(power({ name: 'zzqq', what: 'qqzz', idea: 'zzzz qqqq' }), idx), []);
  });

  it('refuses a malformed power or k', () => {
    assert.throws(() => matchPower({ what: 'x' }, idx), /name/);
    assert.throws(() => matchPower(power(), idx, { k: 0 }), /k/);
  });
});

describe('harness-map — buildMap, mapBrief, recordJudgments', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hmap-')); await makeHarness(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  async function runWithPowers(slug, powers) {
    const r = await intake(dir, '-', { stdin: 'a tool', now, slug });
    await writeInventory(dir, { run: r.runId, input: JSON.stringify(powers), now });
    return r;
  }

  it('buildMap writes harness-index.json and map.json with 5 candidates per power and empty judgments; next is map', async () => {
    const r = await runWithPowers('m1', [power(), power({ name: 'budget guard', what: 'stops spawning past a token budget', idea: 'ceiling check before fan-out' })]);
    const out = await buildMap(dir, { run: r.runId, now });
    assert.equal(out.indexed, 12);
    assert.equal(out.powers, 2);
    assert.equal(out.next, 'map');
    assert.deepEqual(out.byKind, { command: 2, skill: 1, helper: 2, hook: 1, module: 3, script: 3 });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    const index = await readJson(path.join(runDir, 'harness-index.json'));
    assert.equal(index.rows.length, 12);
    assert.ok(!('text' in index.rows[0]), 'the stored index carries no file text');
    assert.ok(index.rows[0].tokens === undefined || Array.isArray(index.rows[0].tokens));
    assert.equal(index.project, dir);
    const map = await readJson(path.join(runDir, 'map.json'));
    assert.deepEqual(Object.keys(map.candidates).sort(), ['budget guard', 'drift-monitor']);
    assert.ok(map.candidates['budget guard'].some(c => c.path === '.claude/helpers/marathon/budget.js'));
    assert.deepEqual(map.judgments, {});
    assert.equal(map.source_identity, r.identity);
    assert.equal(map.run, r.runId);
    assert.ok(map.ts);
    const status = await fs.readFile(path.join(runDir, 'status.md'), 'utf-8');
    assert.match(status, /- Next: `cli\.js map`/);
  });

  it('buildMap refuses without powers.json, refuses to overwrite judgments without force, and keeps judgments when re-run with force only for unchanged candidates', async () => {
    const r0 = await intake(dir, '-', { stdin: 'x', now, slug: 'm2' });
    await assert.rejects(() => buildMap(dir, { run: r0.runId, now }), /inventory/);
    const r = await runWithPowers('m3', [power()]);
    await buildMap(dir, { run: r.runId, now });
    const toolId = (await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'map.json'))).candidates['drift-monitor'][0].id;
    await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': { status: 'partial', tool: toolId, why: 'compares hashes, no alerting' } }), now });
    await assert.rejects(() => buildMap(dir, { run: r.runId, now }), /map\.json.*judg.*--force/);
    const out = await buildMap(dir, { run: r.runId, now, force: true });
    assert.equal(out.judgments_dropped, 1);
    const map = await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'map.json'));
    assert.deepEqual(map.judgments, {});
  });

  it('mapBrief lists each power with its idea and its candidates (path, kind, score), the three statuses, and the JSON shape to return', async () => {
    const r = await runWithPowers('m4', [power()]);
    await buildMap(dir, { run: r.runId, now });
    const brief = await mapBrief(dir, { run: r.runId });
    assert.match(brief, /drift-monitor/);
    assert.match(brief, /Hash the effective config/);
    assert.match(brief, /scripts\/check-drift\.sh/);
    assert.match(brief, /\bscript\b/);
    assert.match(brief, /have\|partial\|missing|have, partial or missing/);
    // the real candidate count from map.json, never a hard-coded five
    const mapJson = await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'map.json'));
    const n = mapJson.candidates['drift-monitor'].length;
    assert.ok(n > 0 && n <= 5);
    assert.match(brief, new RegExp(`Only these ${n} candidates`));
    assert.ok(!/Only these 5 candidates/.test(brief) || n === 5);
    assert.match(brief, /JSON only/);
    assert.match(brief, /cli\.js map --from/);
    assert.match(brief, /"tool":/);
    assert.ok(!/undefined|\[object Object\]/.test(brief));
    assert.deepEqual(STATUSES, ['have', 'partial', 'missing']);
  });

  it('recordJudgments accepts {power: status} or {power: {status, tool, why}}; a tool outside the candidate list, an unknown power or a bad status is refused; partial sets report remaining', async () => {
    const r = await runWithPowers('m5', [power(), power({ name: 'other', what: 'unrelated thing', idea: 'nothing shared' })]);
    await buildMap(dir, { run: r.runId, now });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    const map0 = await readJson(path.join(runDir, 'map.json'));
    const tool = map0.candidates['drift-monitor'][0].id;
    const half = await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': { status: 'partial', tool, why: 'the script compares hashes but has no alerting' } }), now });
    assert.equal(half.judged, 1);
    assert.deepEqual(half.remaining, ['other']);
    assert.equal(half.next, 'map');
    await assert.rejects(() => recordJudgments(dir, { run: r.runId, input: JSON.stringify({ other: 'sometimes' }), now }), /other.*have\|partial\|missing/);
    await assert.rejects(() => recordJudgments(dir, { run: r.runId, input: JSON.stringify({ nope: 'have' }), now }), /unknown power "nope"/);
    await assert.rejects(() => recordJudgments(dir, { run: r.runId, input: JSON.stringify({ other: { status: 'have', tool: 'module:src/plugins/marathon.js' } }), now }), /not (in|among) .*candidates/);
    await assert.rejects(() => recordJudgments(dir, { run: r.runId, input: 'prose about it', now }), /JSON only/);
    await assert.rejects(() => recordJudgments(dir, { run: r.runId, input: JSON.stringify({ other: { status: 'have' } }), now }), /tool/, 'have and partial need the tool that has it');
    const done = await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ judgments: { other: 'missing' } }), now });
    assert.equal(done.judged, 2);
    assert.deepEqual(done.remaining, []);
    assert.equal(done.next, 'verdict');
    const map = await readJson(path.join(runDir, 'map.json'));
    assert.equal(map.judgments['drift-monitor'].status, 'partial');
    assert.equal(map.judgments['drift-monitor'].tool, tool);
    assert.equal(map.judgments.other.status, 'missing');
    assert.equal(map.judgments.other.tool, null);
    const status = await fs.readFile(path.join(runDir, 'status.md'), 'utf-8');
    assert.match(status, /- Next: `cli\.js verdict`/);
  });

  it('recordJudgments refuses before buildMap and refuses to overwrite a judgment without force', async () => {
    const r = await runWithPowers('m6', [power()]);
    await assert.rejects(() => recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now }), /map\.json.*cli\.js map/);
    await buildMap(dir, { run: r.runId, now });
    await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now });
    await assert.rejects(() => recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now }), /already judged.*--force/);
    const out = await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now, force: true });
    assert.equal(out.judged, 1);
  });
});

describe('harness-map — cli verb', () => {
  let dir;
  function run(cwd, args, input) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hcli-'));
    await makeHarness(dir);
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('usage lists map with [--brief | --from <file|->] [--force]; map before inventory fails naming inventory', () => {
    const u = run(dir, ['nope']);
    assert.match(u.err, /cli\.js map \[--brief \| --from <file\|->\] \[--force\] \[--run <id>\] \[--project <dir>\]/);
    assert.match(u.err, /usage: cli\.js <intake\|fetch\|inventory\|map\|status\|report> \.\.\./);
    run(dir, ['intake', '-', '--slug', 'c1'], 'a tool');
    const early = run(dir, ['map']);
    assert.equal(early.code, 1);
    assert.match(early.err, /inventory/);
  });

  it('map builds the index and candidates; --brief prints text; --from records judgments; status --next moves to verdict', async () => {
    const inv = run(dir, ['inventory', '--from', '-'], JSON.stringify([power()]));
    assert.equal(inv.code, 0, inv.err);
    const m = run(dir, ['map']);
    assert.equal(m.code, 0, m.err);
    assert.equal(m.json.powers, 1);
    assert.ok(m.json.indexed > 0);
    assert.equal(m.json.next, 'map');
    const b = run(dir, ['map', '--brief']);
    assert.equal(b.code, 0, b.err);
    assert.equal(b.json, null);
    assert.match(b.out, /drift-monitor/);
    const bad = run(dir, ['map', '--from', '-'], JSON.stringify({ 'drift-monitor': 'kinda' }));
    assert.equal(bad.code, 1);
    assert.match(bad.err, /have\|partial\|missing/);
    const j = run(dir, ['map', '--from', '-'], JSON.stringify({ 'drift-monitor': 'missing' }));
    assert.equal(j.code, 0, j.err);
    assert.equal(j.json.judged, 1);
    assert.equal(j.json.next, 'verdict');
    assert.equal(run(dir, ['status', '--next']).out.trim(), 'verdict');
    const again = run(dir, ['map']);
    assert.equal(again.code, 1);
    assert.match(again.err, /--force/);
    const pos = run(dir, ['map', 'extra']);
    assert.equal(pos.code, 1);
    assert.match(pos.err, /unexpected argument "extra"/);
    const both = run(dir, ['map', '--brief', '--from', 'x']);
    assert.equal(both.code, 1);
  });
});

// ---- review r1 regression tests ----------------------------------------------------------------

const synthIndex = (rows) => ({ rows: rows.map(r => ({ kind: 'script', path: r.name, id: `script:${r.name}`, text: '', ...r })), byKind: {}, errors: [], project: '/x' });

describe('harness-map r1 — name weight is exactly 3x a body token (single copy, boost 3)', () => {
  it('a name-only candidate scores 3/sqrt(10) and a body-only candidate 1/sqrt(10), pinned to 3 decimals', () => {
    const idx = synthIndex([{ name: 'a-row', tokens: ['zorbit'] }, { name: 'b-row', tokens: ['quasar'] }]);
    const c = matchPower({ name: 'zorbit', what: '', idea: 'quasar' }, idx);
    const nameOnly = c.find(x => x.name === 'a-row');
    const bodyOnly = c.find(x => x.name === 'b-row');
    assert.equal(nameOnly.score.toFixed(3), '0.949');
    assert.equal(bodyOnly.score.toFixed(3), '0.316');
  });
  it('a name token that also occurs in the body is not tripled again: name 3 + body 1 = 4', () => {
    const idx = synthIndex([{ name: 'a-row', tokens: ['zorbit'] }, { name: 'b-row', tokens: ['quasar'] }]);
    const c = matchPower({ name: 'zorbit', what: 'zorbit', idea: 'quasar' }, idx);
    // vector: zorbit 4*w, quasar 1*w -> cosine with a-row = 4/sqrt(17)
    assert.equal(c.find(x => x.name === 'a-row').score.toFixed(3), (4 / Math.sqrt(17)).toFixed(3));
  });
});

describe('harness-map r1 — shared fence-tolerant JSON parser', () => {
  it('parseJsonOnly accepts a fence with a trailing newline, CRLF and ```JSON, and names the input in errors', () => {
    assert.deepEqual(parseJsonOnly('```json\n{"a":1}\n```\n'), { a: 1 });
    assert.deepEqual(parseJsonOnly('```json\r\n{"a":1}\r\n```\r\n'), { a: 1 });
    assert.deepEqual(parseJsonOnly('  ```JSON\n{"a":1}\n```  \n'), { a: 1 });
    assert.throws(() => parseJsonOnly('hello\nworld', { label: '--from x.json' }), (e) => /JSON only — --from x\.json is not JSON; got: "hello\\nworld"/.test(e.message) && !/\n/.test(e.message));
    assert.throws(() => parseJsonOnly('  ', { label: '--from - (stdin)' }), /JSON only — --from - \(stdin\) is empty/);
  });
  it('recordJudgments uses it: fenced + CRLF input is recorded; a bad one names the label', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hfence-'));
    try {
      await makeHarness(dir);
      const r = await intake(dir, '-', { stdin: 'a tool', now, slug: 'f1' });
      await writeInventory(dir, { run: r.runId, input: JSON.stringify([power()]), now });
      await buildMap(dir, { run: r.runId, now });
      await assert.rejects(() => recordJudgments(dir, { run: r.runId, input: 'prose\r\nmore', now, label: '--from j.json' }), /JSON only — --from j\.json is not JSON; got: "prose\\r\\nmore"/);
      const out = await recordJudgments(dir, { run: r.runId, input: '```JSON\r\n{"drift-monitor":"missing"}\r\n```\r\n', now });
      assert.equal(out.judged, 1);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('harness-map r1 — judgments, stale files, brief', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hr1-')); await makeHarness(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  async function mk(slug, powers = [power()]) {
    const r = await intake(dir, '-', { stdin: 'a tool', now, slug });
    await writeInventory(dir, { run: r.runId, input: JSON.stringify(powers), now });
    await buildMap(dir, { run: r.runId, now });
    return { r, runDir: path.join(dir, '.claude', 'bbs', 'runs', r.runId) };
  }

  it('a bare "have" or "partial" is refused naming {status, tool, why}; a bare "missing" is accepted', async () => {
    const { r } = await mk('r1a');
    for (const s of ['have', 'partial']) {
      await assert.rejects(() => recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': s }), now }),
        new RegExp(`drift-monitor: status "${s}" needs \\{status, tool, why\\} naming one of the candidates`));
    }
    const ok = await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now });
    assert.equal(ok.judged, 1);
  });

  it('map --force and record --force move verdicts.json and handoff.json aside and report stale_moved', async () => {
    const { r, runDir } = await mk('r1b');
    await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now });
    await fs.writeFile(path.join(runDir, 'verdicts.json'), JSON.stringify({ decisions: { 'drift-monitor': 'skip' } }));
    await fs.writeFile(path.join(runDir, 'handoff.json'), JSON.stringify({ marathonRun: 'x' }));
    const rebuilt = await buildMap(dir, { run: r.runId, now, force: true });
    assert.deepEqual(rebuilt.stale_moved, ['verdicts.json', 'handoff.json']);
    let files = await fs.readdir(runDir);
    assert.ok(files.some(f => /^verdicts\.json\.stale-/.test(f)) && files.some(f => /^handoff\.json\.stale-/.test(f)));
    assert.ok(!files.includes('verdicts.json') && !files.includes('handoff.json'));
    const j = await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now });
    assert.deepEqual(j.stale_moved, []);
    assert.equal(j.next, 'verdict');
    // record --force also moves them
    await fs.writeFile(path.join(runDir, 'verdicts.json'), JSON.stringify({ decisions: { 'drift-monitor': 'skip' } }));
    const f = await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now, force: true });
    assert.deepEqual(f.stale_moved, ['verdicts.json']);
    files = await fs.readdir(runDir);
    assert.ok(!files.includes('verdicts.json'));
    assert.equal(f.next, 'verdict');
  });

  it('moveAsideStale claims distinct stale names, returns the moved names and restores on a partial failure', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hstale-'));
    try {
      await fs.writeFile(path.join(d, 'a.json'), '1');
      await fs.writeFile(path.join(d, 'b.json'), '2');
      let calls = 0;
      const rename = async (from, to) => { if (++calls === 2) throw Object.assign(new Error('disk says no'), { code: 'EIO' }); return fs.rename(from, to); };
      await assert.rejects(() => moveAsideStale(d, ['a.json', 'b.json', 'c.json'], now, { rename }), /disk says no.*stale_moved so far: \[a\.json\].*restored: \[a\.json\]/);
      assert.equal(await fs.readFile(path.join(d, 'a.json'), 'utf-8'), '1');
      const moved = await moveAsideStale(d, ['a.json', 'b.json', 'c.json'], now);
      assert.deepEqual([...moved], ['a.json', 'b.json']);
      assert.ok((await fs.readdir(d)).filter(f => f.includes('.stale-')).length >= 2);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });

  it('the brief states the real candidate count; zero candidates says answer missing', async () => {
    const { r } = await mk('r1c', [power(), power({ name: 'zzqq', what: 'qqzz', idea: 'zzzz qqqq' })]);
    const brief = await mapBrief(dir, { run: r.runId });
    const map = await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.runId, 'map.json'));
    const n = map.candidates['drift-monitor'].length;
    assert.match(brief, new RegExp(`Only these ${n} candidates`));
    assert.match(brief, /no candidates — answer missing \(tool null\)/);
    assert.ok(!/Only these 5 candidates[\s\S]*zzqq/.test(brief.split('## zzqq')[1] ?? ''));
  });
});

describe('harness-map r1 — index scope, loud skips, bounded walk', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hscope-')); await makeHarness(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const w = async (rel, text) => { const p = path.join(dir, rel); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, text); };

  it('skills are exactly .claude/skills/*/SKILL.md; hooks exactly .claude/hooks/*.sh; plugins exactly src/plugins/*.js; vendor dirs are skipped', async () => {
    await w('.claude/skills/x/references/SKILL.md', '# nested');
    await w('.claude/skills/x/MYSKILL.md', '# my');
    await w('.claude/hooks/lib/inner.sh', '# inner');
    await w('src/plugins/deep/inner.js', '// inner');
    await w('scripts/vendor/lib.sh', '# vendored');
    await w('scripts/deep/ok.sh', '# kept');
    const paths = (await buildIndex(dir)).rows.map(r => r.path);
    for (const bad of ['.claude/skills/x/references/SKILL.md', '.claude/skills/x/MYSKILL.md', '.claude/hooks/lib/inner.sh', 'src/plugins/deep/inner.js', 'scripts/vendor/lib.sh']) {
      assert.ok(!paths.includes(bad), `${bad} must not be indexed`);
    }
    assert.ok(paths.includes('scripts/deep/ok.sh'), 'scripts stay recursive');
    assert.ok(paths.includes('.claude/hooks/marathon-precompact.sh'));
    assert.ok(paths.includes('src/plugins/marathon.js'));
  });

  it('an unparseable package.json is reported as EJSON', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hpkg-'));
    try {
      await fs.mkdir(path.join(d, '.claude', 'commands'), { recursive: true });
      await fs.writeFile(path.join(d, '.claude', 'commands', 'one.md'), '# one');
      await fs.writeFile(path.join(d, 'package.json'), '{ not json');
      const idx = await buildIndex(d);
      assert.ok(idx.errors.some(e => e.path === 'package.json' && e.code === 'EJSON'));
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });

  it('symlinks under index roots are skipped and reported as SYMLINK (file and directory)', async () => {
    await w('real/target.md', '# target');
    await fs.symlink(path.join(dir, 'real', 'target.md'), path.join(dir, '.claude', 'commands', 'linked.md'));
    await fs.symlink(path.join(dir, 'real'), path.join(dir, '.claude', 'commands', 'linkdir'));
    const idx = await buildIndex(dir);
    assert.ok(!idx.rows.some(r => r.path.includes('linked.md') || r.path.includes('linkdir')));
    assert.ok(idx.errors.some(e => e.path === '.claude/commands/linked.md' && e.code === 'SYMLINK'));
    assert.ok(idx.errors.some(e => e.path === '.claude/commands/linkdir' && e.code === 'SYMLINK'));
  });

  it('only a bounded prefix of each file is read: a 500 KiB first line yields text under 70 KiB; the cap per kind is recorded', async () => {
    await w('scripts/huge.sh', 'word '.repeat(100000) + '\nsecond line\n');
    const idx = await buildIndex(dir);
    const huge = idx.rows.find(r => r.path === 'scripts/huge.sh');
    assert.ok(huge.text.length < 70 * 1024, `text was ${huge.text.length}`);
    const capped = await buildIndex(dir, { maxPerKind: 1 });
    assert.equal(capped.rows.filter(r => r.kind === 'command').length, 1);
    assert.equal(capped.capped.command, 1);
    assert.deepEqual(Object.keys(idx.capped), []);
  });
});

describe('harness-map r1 — cli: --from <file>, fenced file, map --force', () => {
  let dir;
  function run(cwd, args, input) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hcli2-'));
    await makeHarness(dir);
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('--from <file> reads a fenced file with a trailing newline; a bad file names the path; a bare have is refused; map --force after verdicts returns to verdict', async () => {
    run(dir, ['intake', '-', '--slug', 'c2'], 'a tool');
    assert.equal(run(dir, ['inventory', '--from', '-'], JSON.stringify([power()])).code, 0);
    assert.equal(run(dir, ['map']).code, 0);
    const bad = path.join(dir, 'bad.txt');
    await fs.writeFile(bad, 'nope\r\n');
    const b = run(dir, ['map', '--from', bad]);
    assert.equal(b.code, 1);
    assert.ok(b.err.includes(`--from ${bad} is not JSON; got: "nope"`), b.err);
    const stdinBad = run(dir, ['map', '--from', '-'], 'prose');
    assert.match(stdinBad.err, /--from - \(stdin\) is not JSON/);
    const bare = run(dir, ['map', '--from', '-'], JSON.stringify({ 'drift-monitor': 'have' }));
    assert.equal(bare.code, 1);
    assert.match(bare.err, /needs \{status, tool, why\}/);
    const good = path.join(dir, 'good.json');
    await fs.writeFile(good, '```json\n{"drift-monitor":"missing"}\n```\n');
    const j = run(dir, ['map', '--from', good]);
    assert.equal(j.code, 0, j.err);
    assert.equal(j.json.next, 'verdict');
    const runId = (await fs.readdir(path.join(dir, '.claude', 'bbs', 'runs')))[0];
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', runId);
    await fs.writeFile(path.join(runDir, 'verdicts.json'), JSON.stringify({ decisions: { 'drift-monitor': 'skip' } }));
    assert.equal(run(dir, ['status', '--next']).out.trim(), 'handoff');
    const f = run(dir, ['map', '--force']);
    assert.equal(f.code, 0, f.err);
    assert.deepEqual(f.json.stale_moved, ['verdicts.json']);
    assert.equal(run(dir, ['map', '--from', good]).code, 0);
    assert.equal(run(dir, ['status', '--next']).out.trim(), 'verdict');
    assert.ok((await fs.readdir(runDir)).some(n => n.startsWith('verdicts.json.stale-')));
  });

  it('a symlinked command file is reported in harness-index errors path via map output', async () => {
    await fs.symlink(path.join(dir, 'package.json'), path.join(dir, '.claude', 'commands', 'pk.md'));
    const runId = (await fs.readdir(path.join(dir, '.claude', 'bbs', 'runs')))[0];
    const m = run(dir, ['map', '--force']);
    assert.equal(m.code, 0, m.err);
    const idx = await readJson(path.join(dir, '.claude', 'bbs', 'runs', runId, 'harness-index.json'));
    assert.ok(idx.errors.some(e => e.path === '.claude/commands/pk.md' && e.code === 'SYMLINK'));
  });
});

describe('harness-map r2 — commit-then-fail, corrupt map, lock, cap accounting, wrapper', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hr2-')); await makeHarness(dir); spawnSync('git', ['init', '-q', '.'], { cwd: dir }); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const runDirOf = (r) => path.join(dir, '.claude', 'bbs', 'runs', r.runId);
  async function runWithPowers(slug, powers) {
    const r = await intake(dir, '-', { stdin: 'a tool', now, slug });
    await writeInventory(dir, { run: r.runId, input: JSON.stringify(powers), now });
    return r;
  }
  function cli(args, input) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8', input });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }

  it('buildMap with a corrupt verdicts.json still succeeds: map.json is written, next is null, the warning names the unreadable file', async () => {
    const r = await runWithPowers('r2a', [power()]);
    await fs.writeFile(path.join(runDirOf(r), 'verdicts.json'), '{broken');
    const out = await buildMap(dir, { run: r.runId, now });
    assert.equal(out.next, null);
    assert.match(out.warning, /map\.json written but .*verdicts\.json.* could not be read/);
    assert.ok((await readJson(path.join(runDirOf(r), 'map.json'))).candidates);
  });

  it('recordJudgments with a corrupt verdicts.json records the judgment and warns instead of failing', async () => {
    const r = await runWithPowers('r2b', [power()]);
    await buildMap(dir, { run: r.runId, now });
    await fs.writeFile(path.join(runDirOf(r), 'verdicts.json'), '{broken');
    const out = await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now });
    assert.equal(out.judged, 1);
    assert.equal(out.next, null);
    assert.match(out.warning, /map\.json written but .*verdicts\.json.* could not be read/);
    assert.equal((await readJson(path.join(runDirOf(r), 'map.json'))).judgments['drift-monitor'].status, 'missing');
  });

  it('cli map with a corrupt verdicts.json exits 0, prints the JSON and exactly one warning on stderr', async () => {
    const r = cli(['intake', '-', '--slug', 'r2c'], 'a tool');
    assert.equal(r.code, 0, r.err);
    assert.equal(cli(['inventory', '--from', '-'], JSON.stringify([power()])).code, 0);
    const id = (await fs.readdir(path.join(dir, '.claude', 'bbs', 'runs'))).find(n => n.includes('r2c'));
    await fs.writeFile(path.join(dir, '.claude', 'bbs', 'runs', id, 'verdicts.json'), '{broken');
    const m = cli(['map']);
    assert.equal(m.code, 0, m.err);
    assert.equal(m.json.next, null);
    assert.match(m.json.warning, /verdicts\.json/);
    assert.equal(m.err.split('bbs: warning:').length - 1, 1, m.err);
    assert.match(m.err, /bbs: warning: map\.json written but/);
    const j = cli(['map', '--from', '-'], JSON.stringify({ 'drift-monitor': 'missing' }));
    assert.equal(j.code, 0, j.err);
    assert.equal(j.err.split('bbs: warning:').length - 1, 1, j.err);
  });

  it('a truncated map.json: without --force the error says --force rebuilds it; with --force it is moved aside and rebuilt', async () => {
    const r = await runWithPowers('r2d', [power()]);
    await buildMap(dir, { run: r.runId, now });
    const mapPath = path.join(runDirOf(r), 'map.json');
    await fs.writeFile(mapPath, '{"candidates": {');
    await assert.rejects(() => buildMap(dir, { run: r.runId, now }), /corrupt JSON.*map\.json.*pass --force to rebuild it/);
    const out = await buildMap(dir, { run: r.runId, now, force: true });
    assert.equal(out.judgments_dropped, 0);
    assert.ok(out.stale_moved.includes('map.json'), JSON.stringify(out.stale_moved));
    assert.ok((await readJson(mapPath)).candidates);
    const files = await fs.readdir(runDirOf(r));
    assert.ok(files.some(f => /^map\.json\.stale-.*\.json$/.test(f)), files.join(','));
  });

  it('withMapLock: a held lock refuses with the lock message, a stale (>60 s) lock is released, the lock is removed afterwards', async () => {
    const rd = await fs.mkdtemp(path.join(dir, 'lock-'));
    const lock = path.join(rd, 'map.lock');
    await fs.writeFile(lock, 'held');
    await assert.rejects(() => withMapLock(rd, async () => 'x'), /map\.json is locked by another bbs command \(map\.lock\); remove it if none is running/);
    const old = new Date(Date.now() - 120000);
    await fs.utimes(lock, old, old);
    assert.equal(await withMapLock(rd, async () => 'ran'), 'ran');
    await assert.rejects(() => fs.stat(lock), { code: 'ENOENT' });
    await assert.rejects(() => withMapLock(rd, async () => { throw new Error('inner'); }), /inner/);
    await assert.rejects(() => fs.stat(lock), { code: 'ENOENT' }, 'released even when fn throws');
  });

  it('buildMap and recordJudgments refuse while map.lock is held and leave map.json untouched', async () => {
    const r = await runWithPowers('r2e', [power()]);
    await buildMap(dir, { run: r.runId, now });
    const mapPath = path.join(runDirOf(r), 'map.json');
    const before = await fs.readFile(mapPath, 'utf-8');
    await fs.writeFile(path.join(runDirOf(r), 'map.lock'), 'held');
    await assert.rejects(() => buildMap(dir, { run: r.runId, now, force: true }), /locked by another bbs command/);
    await assert.rejects(() => recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now }), /locked by another bbs command/);
    assert.equal(await fs.readFile(mapPath, 'utf-8'), before);
  });

  it('cap accounting: with cap 2 and 5 files, the first two in sorted order are kept and the total is recorded', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-cap-'));
    try {
      for (const n of ['e', 'b', 'a', 'd', 'c']) {
        await fs.mkdir(path.join(d, '.claude', 'commands'), { recursive: true });
        await fs.writeFile(path.join(d, '.claude', 'commands', `${n}.md`), `# ${n}\n`);
      }
      const idx = await buildIndex(d, { capPerKind: 2 });
      assert.deepEqual(idx.rows.filter(r => r.kind === 'command').map(r => r.name), ['a', 'b']);
      assert.equal(idx.capped.command, 2);
      assert.deepEqual(idx.capped_totals.command, { kept: 2, total: 5 });
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });

  it('a power named "judgments" can be judged as a bare missing; a real wrapper still unwraps', async () => {
    const r = await runWithPowers('r2f', [power({ name: 'judgments', what: 'records judgments', idea: 'store them' })]);
    await buildMap(dir, { run: r.runId, now });
    const out = await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ judgments: 'missing' }), now });
    assert.equal(out.judged, 1);
    const map = await readJson(path.join(runDirOf(r), 'map.json'));
    assert.equal(map.judgments.judgments.status, 'missing');
    const r2 = await runWithPowers('r2g', [power({ name: 'judgments', what: 'records judgments', idea: 'store them' })]);
    await buildMap(dir, { run: r2.runId, now });
    const o2 = await recordJudgments(dir, { run: r2.runId, input: JSON.stringify({ judgments: { status: 'missing' } }), now });
    assert.equal(o2.judged, 1, 'a power named judgments judged as an object is the judgment, not a wrapper');
  });
});

describe('harness-map r3 — lock ownership, release failure, unicode tokens, package.json bounds', () => {
  let tmp;
  before(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-hr3-')); });
  after(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
  const mkRd = () => fs.mkdtemp(path.join(tmp, 'rd-'));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  it('lock constants: stale 60 s, refresh 20 s', () => {
    assert.equal(LOCK_STALE_MS, 60000);
    assert.equal(LOCK_REFRESH_MS, 20000);
  });

  it('a holder whose fn outlasts the stale window keeps its token (mtime refreshed); a second acquirer sees it fresh and fails', async () => {
    const rd = await mkRd();
    const lock = path.join(rd, 'map.lock');
    let clock = Date.now();
    const opts = { now: () => clock, staleMs: 100, refreshMs: 10 };
    let tokenBefore;
    const holder = withMapLock(rd, async () => {
      tokenBefore = await fs.readFile(lock, 'utf-8');
      assert.match(tokenBefore, /^\d+ [0-9a-f]+\n$/);
      clock += 10000; // far past the stale window
      await sleep(80); // the refresh fires and stamps the fake "now"
      await assert.rejects(() => withMapLock(rd, async () => 'second', opts), /locked by another bbs command/);
      assert.equal(await fs.readFile(lock, 'utf-8'), tokenBefore, 'the holder still owns the lock');
      return 'held-ok';
    }, opts);
    assert.equal(await holder, 'held-ok');
    await assert.rejects(() => fs.stat(lock), { code: 'ENOENT' });
  });

  it('a genuinely stale foreign lock is renamed aside (not deleted), ours is created and released, the foreign file survives', async () => {
    const rd = await mkRd();
    const lock = path.join(rd, 'map.lock');
    await fs.writeFile(lock, '4242 foreigntoken\n');
    const old = new Date(Date.now() - 120000);
    await fs.utimes(lock, old, old);
    const out = await withMapLockDetailed(rd, async () => {
      assert.match(await fs.readFile(lock, 'utf-8'), /^\d+ (?!foreigntoken)[0-9a-f]+\n$/);
      return 'ran';
    });
    assert.equal(out.result, 'ran');
    assert.equal(out.warning, null);
    await assert.rejects(() => fs.stat(lock), { code: 'ENOENT' });
    const asides = (await fs.readdir(rd)).filter(f => f.startsWith('map.lock.stale-'));
    assert.equal(asides.length, 1);
    assert.equal(await fs.readFile(path.join(rd, asides[0]), 'utf-8'), '4242 foreigntoken\n');
  });

  it('release leaves a lock another process took over and returns a warning', async () => {
    const rd = await mkRd();
    const lock = path.join(rd, 'map.lock');
    const out = await withMapLockDetailed(rd, async () => { await fs.writeFile(lock, '1 othertoken\n'); return 'r'; });
    assert.equal(out.result, 'r');
    assert.equal(out.warning, 'map.lock was taken over by another process; left in place');
    assert.equal(await fs.readFile(lock, 'utf-8'), '1 othertoken\n');
  });

  it('a release failure after fn resolved becomes a warning, not a thrown error; buildMap merges it', async () => {
    const rd = await mkRd();
    const rm = async () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; };
    const out = await withMapLockDetailed(rd, async () => 'done', { rm });
    assert.equal(out.result, 'done');
    assert.equal(out.warning, 'could not release map.lock (EACCES)');
    await assert.rejects(() => withMapLockDetailed(rd, async () => { throw new Error('inner'); }, { rm }), /inner|locked/);
  });

  it('buildMap and recordJudgments surface the lock warning on their result', async () => {
    const d = await fs.mkdtemp(path.join(tmp, 'proj-'));
    await makeHarness(d);
    const r = await intake(d, '-', { stdin: 'a tool', now, slug: 'r3w' });
    await writeInventory(d, { run: r.runId, input: JSON.stringify([power()]), now });
    const rm = async () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; };
    const out = await buildMap(d, { run: r.runId, now, lockOpts: { rm } });
    assert.match(out.warning, /could not release map\.lock \(EACCES\)/);
    await fs.rm(path.join(d, '.claude', 'bbs', 'runs', r.runId, 'map.lock'), { force: true });
    const j = await recordJudgments(d, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'missing' }), now, lockOpts: { rm } });
    assert.match(j.warning, /could not release map\.lock \(EACCES\)/);
  });

  it('buildMap builds the index before taking the lock (the lock is held only for read map.json -> write map.json)', async () => {
    const d = await fs.mkdtemp(path.join(tmp, 'proj-'));
    await makeHarness(d);
    const r = await intake(d, '-', { stdin: 'a tool', now, slug: 'r3x' });
    await writeInventory(d, { run: r.runId, input: JSON.stringify([power()]), now });
    // An empty harness fails on the index before any lock is created: no map.lock and no aside files are left behind.
    const empty = await fs.mkdtemp(path.join(tmp, 'empty-'));
    const r2 = await intake(empty, '-', { stdin: 'a tool', now, slug: 'r3y' });
    await writeInventory(empty, { run: r2.runId, input: JSON.stringify([power()]), now });
    const rd2 = path.join(empty, '.claude', 'bbs', 'runs', r2.runId);
    // A pre-existing FRESH lock must not matter for an index failure: the index error comes first.
    await fs.writeFile(path.join(rd2, 'map.lock'), '1 held\n');
    await assert.rejects(() => buildMap(empty, { run: r2.runId, now }), /harness index is empty/);
  });

  it('tokenize keeps combining marks (Devanagari) and normalizes NFD to NFC', () => {
    assert.deepEqual(tokenize('हिंदी अनुवाद translation'), ['हिंदी', 'अनुवाद', 'translation']);
    assert.deepEqual(tokenize('cafe\u0301'), ['caf\u00e9']);
  });

  it('an NFD row matches an NFC power with score > 0', () => {
    const nfd = 'cafe\u0301 menu';
    const index = { rows: [{ id: 'command:a.md', kind: 'command', name: 'a', path: 'a.md', tokens: tokenize(nfd) }, { id: 'command:b.md', kind: 'command', name: 'b', path: 'b.md', tokens: tokenize('other words') }] };
    const c = matchPower({ name: 'caf\u00e9', what: '', idea: '' }, index);
    assert.ok(c.length > 0 && c[0].id === 'command:a.md' && c[0].score > 0, JSON.stringify(c));
  });

  it('a BOM-prefixed package.json yields its scripts', async () => {
    const d = await fs.mkdtemp(path.join(tmp, 'bom-'));
    await fs.mkdir(path.join(d, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(d, 'scripts', 'a.sh'), '#!/bin/sh\n');
    await fs.writeFile(path.join(d, 'package.json'), '\uFEFF' + JSON.stringify({ scripts: { build: 'tsc' } }));
    const idx = await buildIndex(d);
    assert.ok(idx.rows.some(r => r.id === 'script:package.json#build'));
    assert.ok(!idx.errors.some(e => e.path === 'package.json'));
  });

  it('a 2 MiB package.json is refused with ETOOBIG, skipped, and adds no script rows', async () => {
    const d = await fs.mkdtemp(path.join(tmp, 'big-'));
    await fs.mkdir(path.join(d, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(d, 'scripts', 'a.sh'), '#!/bin/sh\n');
    await fs.writeFile(path.join(d, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' }, pad: 'x'.repeat(2 * 1024 * 1024) }));
    const idx = await buildIndex(d);
    assert.ok(idx.errors.some(e => e.path === 'package.json' && e.code === 'ETOOBIG'), JSON.stringify(idx.errors));
    assert.ok(!idx.rows.some(r => r.path === 'package.json'));
  });

  it('package.json scripts count toward the script cap accounting', async () => {
    const d = await fs.mkdtemp(path.join(tmp, 'cap-'));
    await fs.mkdir(path.join(d, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(d, 'scripts', 'a.sh'), '#!/bin/sh\n');
    await fs.writeFile(path.join(d, 'package.json'), JSON.stringify({ scripts: { b1: 'x1', b2: 'x2', b3: 'x3', b4: 'x4' } }));
    const idx = await buildIndex(d, { capPerKind: 3 });
    assert.equal(idx.rows.filter(r => r.kind === 'script').length, 3);
    assert.equal(idx.capped.script, 3);
    assert.deepEqual(idx.capped_totals.script, { kept: 3, total: 5 });
  });
});
