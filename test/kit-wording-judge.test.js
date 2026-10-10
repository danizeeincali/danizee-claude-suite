import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseVerdicts, plan, judge, sealedArgs, buildPrompt, itemsFor } from '../src/lib/kit/wording-judge.js';
import { scoreFolders } from '../src/lib/kit/review-score.js';
import { run as scoreRun } from '../src/lib/kit/review-score.js';

const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'wording-stub.js');
const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'kit', 'review-fixtures');

describe('wording-judge', () => {
  let tmp; let n = 0;
  before(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wj-')); });
  after(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
  const fresh = async () => { const d = path.join(tmp, `o${n++}`); await fs.mkdir(d, { recursive: true }); return d; };
  const withEnv = async (env, fn) => {
    const old = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; process.env[k] = env[k]; }
    try { return await fn(); } finally { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
  };
  const score = async (out) => scoreFolders({ specs: path.join(FX, 'specs'), reviews: path.join(FX, 'reviews-sample'), out });

  it('parseVerdicts drops unknown ids, accepts yes/no and fences, and never invents a result', () => {
    const r = parseVerdicts('```json\n{"verdicts":[{"id":"a","plain":"yes","correct":"no"},{"id":"zzz","plain":true,"correct":true},{"id":"a","plain":false,"correct":false}]}\n```', ['a', 'b']);
    assert.deepEqual(r.verdicts, [{ id: 'a', plain: true, correct: false }]);
    assert.deepEqual(r.dropped, ['zzz']);
    assert.deepEqual(r.unparsed_ids, ['b']);
    assert.deepEqual(parseVerdicts('no json here', ['a']).unparsed_ids, ['a']);
    assert.deepEqual(parseVerdicts('[{"id":"a","plain":1,"correct":true}]', ['a']).verdicts, []);
  });

  it('sealed flags name no tools, settings, MCP servers or session, and the prompt carries only sentence and truth', async () => {
    const a = sealedArgs().join(' ');
    assert.match(a, /--tools\s+--strict-mcp-config/);
    assert.match(a, /--setting-sources\s+--no-session-persistence/);
    const out = await fresh(); const scored = await score(out);
    const specs = JSON.parse(await fs.readFile(path.join(out, 'specs', (await fs.readdir(path.join(out, 'specs'))).find(f => f.startsWith('cache')) ), 'utf-8'));
    const items = itemsFor(scored.cases.find(c => c.case === specs.case), specs);
    assert.ok(items.length);
    assert.deepEqual(Object.keys(items[0]).sort(), ['id', 'sentence', 'truth']);
    assert.ok(buildPrompt(items).includes(items[0].id));
  });

  it('plan counts one call per case with hits; cap and resume change it', async () => {
    const out = await fresh(); const scored = await score(out);
    assert.equal(plan(scored, { specs: await specsOf(out) }).calls, 2);
    assert.equal(plan(scored, { specs: await specsOf(out), cap: 1 }).calls, 1);
    assert.equal(plan(scored, { specs: await specsOf(out), cap: 1 }).over_cap, 1);
  });
  const specsOf = async (out) => { const o = {}; for (const f of await fs.readdir(path.join(out, 'specs'))) { const s = JSON.parse(await fs.readFile(path.join(out, 'specs', f), 'utf-8')); o[s.case] = s; } return o; };

  it('judges, honours the cap, and resumes without repeating a judged case', async () => {
    const out = await fresh(); const scored = await score(out); const log = path.join(out, 'calls.log');
    await withEnv({ STUB_LOG: log, STUB_MODE: 'ok' }, async () => {
      const r1 = await judge(scored, { runner: STUB, outDir: out, cap: 1 });
      assert.equal(r1.calls, 1);
      assert.equal(Object.keys(r1.cases).length, 1);
      const r2 = await judge(scored, { runner: STUB, outDir: out, resume: true });
      assert.equal(r2.calls, 1);
      assert.equal(Object.keys(r2.cases).length, 2);
      assert.equal(r2.plan.skipped_resume, 1);
      const w = JSON.parse(await fs.readFile(path.join(out, 'wording.json'), 'utf-8'));
      assert.ok(Object.values(w.cases).every(c => c.status === 'judged' && c.verdicts.every(v => v.plain === true)));
    });
    const lines = (await fs.readFile(log, 'utf-8')).trim().split('\n').map(JSON.parse);
    assert.equal(lines.filter(l => !l.probe).length, 2);
    assert.ok(lines[0].probe);
  });

  it('records unparsed answers and drops ids it did not ask about', async () => {
    const out = await fresh(); const scored = await score(out);
    await withEnv({ STUB_MODE: 'garbage' }, async () => {
      const r = await judge(scored, { runner: STUB, outDir: out, specs: await specsOf(out) });
      assert.ok(Object.values(r.cases).length && Object.values(r.cases).every(c => c.status === 'unparsed' && c.verdicts.length === 0 && c.unparsed_ids.length));
    });
    const out2 = await fresh(); const specs = await specsOf(out);
    await withEnv({ STUB_MODE: 'extra' }, async () => {
      const r = await judge(scored, { runner: STUB, outDir: out2, specs });
      for (const c of Object.values(r.cases)) { assert.deepEqual(c.dropped, ['ghost#1']); assert.equal(c.verdicts[0].plain, true); assert.equal(c.verdicts[0].correct, false); }
    });
  });

  it('a probe that hits a usage limit, a login wall or a crash stops the batch at once', async () => {
    const so = await fresh(); const scored = await score(so); const specs = await specsOf(so);
    for (const mode of ['limit', 'login', 'crash']) {
      const out = await fresh(); const log = path.join(out, 'calls.log');
      await withEnv({ STUB_MODE: mode, STUB_LOG: log }, async () => {
        const r = await judge(scored, { runner: STUB, outDir: out, specs });
        assert.match(r.stopped, /probe/);
        assert.equal(r.calls, 0);
        assert.equal((await fs.readFile(log, 'utf-8')).trim().split('\n').length, 1);
      });
    }
  });

  it('a runner that is missing is reported as stopped, not thrown', async () => {
    const out = await fresh(); const scored = await score(out);
    const r = await judge(scored, { runner: path.join(out, 'nope'), outDir: out, specs: await specsOf(out) });
    assert.match(r.stopped, /probe failed/);
  });

  it('review-score output is identical with and without --wording, and scores.json is untouched', async () => {
    const a = await fresh(); const b = await fresh();
    const base = (o) => ['--specs', path.join(FX, 'specs'), '--reviews', path.join(FX, 'reviews-sample'), '--out', o];
    const plainRun = await scoreRun(base(a), { cwd: tmp });
    const wordRun = await withEnv({ STUB_MODE: 'ok' }, () => scoreRun([...base(b), '--wording', '--wording-runner', STUB], { cwd: tmp }));
    const { wording, ...rest } = wordRun;
    assert.ok(wording.calls >= 1);
    const strip = (x) => JSON.stringify({ ...x, specs_snapshot: null });
    assert.equal(strip(rest), strip(plainRun));
    assert.equal(await fs.readFile(path.join(a, 'scores.json'), 'utf-8'), (await fs.readFile(path.join(b, 'scores.json'), 'utf-8')).replaceAll(b, a));
  });
});
