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
  STOP_WORDS, KINDS, STATUSES, tokenize, idf, vectorize, cosine, buildIndex, matchPower, buildMap, mapBrief, recordJudgments
} from '../src/lib/bbs/harness-map.js';
import { intake } from '../src/lib/bbs/intake.js';
import { writeInventory } from '../src/lib/bbs/inventory.js';
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
    await recordJudgments(dir, { run: r.runId, input: JSON.stringify({ 'drift-monitor': 'partial' }), now });
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
    assert.match(brief, /only (these|the) (five|5) candidates/i);
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
