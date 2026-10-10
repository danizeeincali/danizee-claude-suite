/**
 * Contract for src/lib/bbs/targets.js and `cli.js targets` — stream `targets` of marathon 2026-10-10-bbs-integration.
 * Every approved power names where it lands in a workflow the owner runs before anything is built.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { normalizeStep, stepHeadings, matchStep, targetsBrief, recordTargets, setOwnerTargets, standingTargets, landsIn, OWNER_HOW } from '../src/lib/bbs/targets.js';
import { computeVerdicts, recordDecisions, PolicyRefused, verdictTable, landingDefault } from '../src/lib/bbs/verdict.js';
import { writeJson, readJson } from '../src/lib/bbs/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(path.dirname(__dirname), 'src', 'lib', 'bbs', 'cli.js');
const now = () => new Date('2026-10-10T12:00:00.000Z');
const noSandbox = { present: false, kind: null, reason: 'no sandbox' };
const RUN = '2026-10-10-tgt';

const REVIEW = '# /w-review\n\n## Usage\n\n### ⛔ CHECKPOINT 1: Code Analysis\n\n```\n## not a heading (fenced)\n```\n\n### ✅ VERIFICATION CHECKPOINT — Cross-Method Validation\n';
const BC = '# /w-background-compound\n\n## Phase 3: Push\n';

async function makeRun(dir, { evidence = 'transcripts', workflows = ['w-review'] } = {}) {
  const w = async (rel, text) => { const p = path.join(dir, rel); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, text); };
  await w('.claude/commands/.shortcuts/w-review.md', REVIEW);
  await w('.claude/commands/.shortcuts/w-background-compound.md', BC);
  await w('.claude/commands/.shortcuts/bc.md', '# /bc — alias for /w-background-compound\n');
  const rd = path.join(dir, '.claude', 'bbs', 'runs', RUN);
  await writeJson(path.join(rd, 'powers.json'), { powers: [{ name: 'redact', what: 'masks secrets' }, { name: 'gate', what: 'blocks a push' }] });
  await writeJson(path.join(rd, 'usage.json'), { evidence, workflows: evidence === 'none' ? [] : workflows.map(name => ({ name, count: 2, sessions: 1, last_used: null, file: `.claude/commands/.shortcuts/${name}.md`, via: {} })) });
  await fs.writeFile(path.join(dir, '.claude', 'bbs', 'ACTIVE'), RUN + '\n');
  return rd;
}

const row = (o = {}) => ({ workflow: 'w-review', step: 'CHECKPOINT 1: Code Analysis', how: 'redacts the diff before it is shown', mode: 'advisory', ...o });

describe('targets — steps', () => {
  it('normalizes headings and matches a step by its text or leading part', async () => {
    assert.equal(normalizeStep('### ⛔ CHECKPOINT 1: **Code** Analysis'), 'checkpoint 1: code analysis');
    const heads = ['Usage', '⛔ CHECKPOINT 1: Code Analysis', '✅ VERIFICATION CHECKPOINT — Cross-Method Validation'];
    assert.equal(matchStep('checkpoint 1', heads), '⛔ CHECKPOINT 1: Code Analysis');
    assert.equal(matchStep('VERIFICATION CHECKPOINT', heads), heads[2]);
    assert.equal(matchStep('Phase 9', heads), null);
    assert.equal(matchStep('  ', heads), null);
  });

  it('reads ## to #### headings outside fenced code', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-tgt-h-'));
    try {
      await fs.writeFile(path.join(dir, 'c.md'), REVIEW);
      assert.deepEqual(await stepHeadings(dir, 'c.md'), ['Usage', '⛔ CHECKPOINT 1: Code Analysis', '✅ VERIFICATION CHECKPOINT — Cross-Method Validation']);
      assert.deepEqual(await stepHeadings(dir, 'missing.md'), []);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('targets — recording proposals', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-tgt-')); await makeRun(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const rec = (obj, o = {}) => recordTargets(dir, { run: RUN, input: JSON.stringify(obj), now, ...o });

  it('the brief lists the powers, the owner\'s workflows with their steps, and the JSON shape', async () => {
    const b = await targetsBrief(dir, { run: RUN });
    assert.match(b, /- redact: masks secrets/);
    assert.match(b, /evidence: transcripts/);
    assert.match(b, /### w-review — steps\n- Usage\n- ⛔ CHECKPOINT 1: Code Analysis/);
    assert.ok(!b.includes('w-background-compound — steps'), 'only the workflows the owner runs');
    assert.match(b, /JSON only/);
  });

  it('records a valid target with the heading as written, and [] for a power that lands nowhere', async () => {
    const r = await rec({ redact: [row({ step: 'checkpoint 1' })], gate: [] });
    assert.deepEqual(r.remaining, []);
    assert.deepEqual(r.no_target, ['gate']);
    const saved = await readJson(path.join(dir, '.claude', 'bbs', 'runs', RUN, 'targets.json'));
    assert.deepEqual(saved.targets.redact, [{ workflow: 'w-review', step: '⛔ CHECKPOINT 1: Code Analysis', how: 'redacts the diff before it is shown', mode: 'advisory', by: 'proposed' }]);
    assert.equal(saved.usage_evidence, 'transcripts');
  });

  it('refuses what cannot land: unknown power, uninstalled or unused workflow, missing step, bad mode, long how, duplicates', async () => {
    await assert.rejects(rec({ nope: [] }), /unknown power "nope"/);
    await assert.rejects(rec({ redact: [row({ workflow: 'w-ghost' })] }), /not an installed workflow/);
    await assert.rejects(rec({ redact: [row({ workflow: 'bc', step: 'Phase 3' })] }), /has not used w-background-compound.*unused_reason/);
    await assert.rejects(rec({ redact: [row({ step: 'Phase 9' })] }), /"Phase 9" is not a step of w-review/);
    await assert.rejects(rec({ redact: [row({ step: '' })] }), /needs a "step"/);
    await assert.rejects(rec({ redact: [row({ mode: 'maybe' })] }), /"mode" must be advisory or blocking/);
    await assert.rejects(rec({ redact: [row({ how: 'x'.repeat(300) })] }), /one line/);
    await assert.rejects(rec({ redact: [row({ how: '' })] }), /needs "how"/);
    await assert.rejects(rec({ redact: [row(), row({ step: 'checkpoint 1: code analysis' })] }), /named twice/);
    await assert.rejects(rec({ redact: row() }), /expected a list/);
    await assert.rejects(rec([]), /JSON only/);
  });

  it('an unused workflow is accepted with a reason, which is kept', async () => {
    const r = await rec({ redact: [row({ workflow: 'bc', step: 'Phase 3', unused_reason: 'every push goes through it' })] });
    assert.deepEqual(r.targets.redact, ['w-background-compound · Phase 3: Push · advisory']);
    const saved = await readJson(path.join(dir, '.claude', 'bbs', 'runs', RUN, 'targets.json'));
    assert.equal(saved.targets.redact[0].unused_reason, 'every push goes through it');
    assert.deepEqual(saved.targets.gate, [], 'a power not named keeps its targets');
  });

  it('needs usage.json first', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-tgt-nou-'));
    try {
      await makeRun(d);
      await fs.rm(path.join(d, '.claude', 'bbs', 'runs', RUN, 'usage.json'));
      await assert.rejects(recordTargets(d, { run: RUN, input: JSON.stringify({ redact: [] }), now }), /run cli\.js usage first/);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
});

describe('targets — the owner\'s word and what a decision stands on', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-tgt-o-')); await makeRun(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('--set keeps a proposed step for a workflow already targeted and adds new ones with no step', async () => {
    await recordTargets(dir, { run: RUN, input: JSON.stringify({ redact: [row()], gate: [] }), now });
    const r = await setOwnerTargets(dir, { run: RUN, set: 'redact@w-review,bc', now });
    const saved = (await readJson(path.join(dir, '.claude', 'bbs', 'runs', RUN, 'targets.json'))).targets.redact;
    assert.deepEqual(saved.map(t => [t.workflow, t.step, t.by]), [['w-review', '⛔ CHECKPOINT 1: Code Analysis', 'owner'], ['w-background-compound', null, 'owner']]);
    assert.equal(saved[1].how, OWNER_HOW);
    assert.deepEqual(r.targets.redact, ['w-review · ⛔ CHECKPOINT 1: Code Analysis · advisory', 'w-background-compound · (step to pick) · advisory']);
    assert.deepEqual((await setOwnerTargets(dir, { run: RUN, set: 'gate@', now })).no_target, ['gate']);
    await assert.rejects(setOwnerTargets(dir, { run: RUN, set: 'redact', now }), /<power>@<workflow>/);
    await assert.rejects(setOwnerTargets(dir, { run: RUN, set: 'nope@w-review', now }), /unknown power/);
    await assert.rejects(setOwnerTargets(dir, { run: RUN, set: 'redact@w-ghost', now }), /not an installed workflow/);
  });

  it('standingTargets keeps owner rows, reasoned rows and rows in a used workflow; nothing stands on no evidence', () => {
    const usage = { evidence: 'owner', workflows: [{ name: 'w-review' }] };
    const list = [{ workflow: 'w-review', by: 'proposed' }, { workflow: 'w-x', by: 'proposed' }, { workflow: 'w-y', by: 'owner' }, { workflow: 'w-z', by: 'proposed', unused_reason: 'r' }];
    assert.deepEqual(standingTargets(list, usage).map(t => t.workflow), ['w-review', 'w-y', 'w-z']);
    assert.deepEqual(standingTargets(list, { evidence: 'none', workflows: [] }).map(t => t.workflow), ['w-y', 'w-z']);
    assert.deepEqual(standingTargets(undefined, usage), []);
  });

  it('the Lands-in cell names each target, nowhere, or not proposed', () => {
    assert.equal(landsIn([{ workflow: 'a', step: 's', mode: 'blocking' }, { workflow: 'b', step: null, mode: 'advisory' }]), 'a · s · blocking; b · step to pick · advisory');
    assert.equal(landsIn([]), 'nowhere');
    assert.equal(landsIn(undefined), 'not proposed');
    const t = verdictTable({ p: { legal: ['rebuild', 'skip'], default: 'rebuild' } }, { p: [] });
    assert.match(t, /\| Lands in \|/);
    assert.match(t, /\| skip \| nowhere \| — \| default rebuild → skip: it lands in no workflow you run \|/);
    assert.ok(!verdictTable({ p: { legal: [] } }).includes('Lands in'), 'no targets, no column');
  });
});

describe('targets — the decision gate', () => {
  let dir, run;
  const decide = (obj) => recordDecisions(dir, { run, input: JSON.stringify(obj), now });
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-tgt-d-'));
    await makeRun(dir, { evidence: 'none' });
    const { intake } = await import('../src/lib/bbs/intake.js');
    const { writeInventory } = await import('../src/lib/bbs/inventory.js');
    const { buildMap, recordJudgments } = await import('../src/lib/bbs/harness-map.js');
    run = (await intake(dir, '-', { stdin: 'decision gate', now, slug: 'gate' })).runId;
    const p = (name, what) => ({ name, what, idea: what, evidence: 'src/x.ts:1', dependencies: [], data_needed: 'none', network: 'none', size: 'small', licence: 'MIT' });
    await writeInventory(dir, { run, input: JSON.stringify([p('redact', 'masks secrets'), p('gate', 'blocks a push')]), now });
    await buildMap(dir, { run, now });
    await recordJudgments(dir, { run, input: JSON.stringify({ redact: 'missing', gate: 'missing' }), now });
    await writeJson(path.join(dir, '.claude', 'bbs', 'runs', run, 'usage.json'), { evidence: 'none', workflows: [] });
    await computeVerdicts(dir, { run, sandbox: noSandbox, now });
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('with no evidence of use, proposals are recorded unverified against every installed workflow, and a rebuild waits for the owner', async () => {
    const b = await targetsBrief(dir, { run });
    assert.match(b, /every installed workflow is listed/);
    assert.match(b, /### w-background-compound — steps/);
    assert.ok(!b.includes('### bc — steps'), 'aliases are not listed twice');
    await recordTargets(dir, { run, input: JSON.stringify({ redact: [row()], gate: [] }), now });
    const saved = await readJson(path.join(dir, '.claude', 'bbs', 'runs', run, 'targets.json'));
    assert.equal(saved.targets.redact[0].unverified, true);
    await assert.rejects(decide({ redact: 'rebuild' }), (e) => e instanceof PolicyRefused && /no evidence/.test(e.message));
  });

  it('once the owner names workflows, a target outside them does not stand; [] is refused; skip always passes', async () => {
    await writeJson(path.join(dir, '.claude', 'bbs', 'runs', run, 'usage.json'), { evidence: 'owner', workflows: [{ name: 'w-background-compound', count: null }] });
    await assert.rejects(decide({ redact: 'rebuild' }), (e) => e instanceof PolicyRefused && /none of its targets is a workflow the owner runs/.test(e.message));
    await assert.rejects(decide({ gate: 'rebuild' }), (e) => e instanceof PolicyRefused && /its targets are empty.*targets --set gate@/.test(e.message));
    assert.equal((await decide({ gate: 'skip' })).decided, 1);
    await setOwnerTargets(dir, { run, set: 'redact@bc', now });
    assert.equal((await decide({ redact: 'rebuild' })).decided, 2);
  });
});

describe('targets — cli', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-tgt-cli-')); await makeRun(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const cli = (args, input) => {
    const r = spawnSync(process.execPath, [CLI, ...args, '--project', dir], { cwd: dir, encoding: 'utf-8', input });
    let json = null; try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  };

  it('takes exactly one of --brief, --from or --set; --force only with --from or --set', () => {
    assert.match(cli(['targets']).err, /exactly one of --brief, --from/);
    assert.match(cli(['targets', '--brief', '--set', 'a@b']).err, /exactly one/);
    assert.match(cli(['targets', '--brief', '--force']).err, /--force goes with --from/);
    assert.match(cli(['targets', '--brief']).out, /Targets brief/);
  });

  it('--from - records from stdin and names the next step; --set records the owner\'s word', () => {
    const r = cli(['targets', '--from', '-'], JSON.stringify({ redact: [row()], gate: [] }));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.recorded, 2);
    const s = cli(['targets', '--set', 'gate@w-review']);
    assert.equal(s.code, 0, s.err);
    assert.deepEqual(s.json.no_target, []);
    assert.match(cli(['targets', '--from', 'nope.json']).err, /file not found: nope\.json/);
  });
});

describe('targets — usage review r4 regressions', () => {
  it('a corrupt usage.json or targets.json makes a decision name the --force repair', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-tgt-c-'));
    try {
      await makeRun(dir);
      const { intake } = await import('../src/lib/bbs/intake.js');
      const { writeInventory } = await import('../src/lib/bbs/inventory.js');
      const { buildMap, recordJudgments } = await import('../src/lib/bbs/harness-map.js');
      const run = (await intake(dir, '-', { stdin: 'corrupt', now, slug: 'corrupt' })).runId;
      const p = { name: 'redact', what: 'masks', idea: 'mask', evidence: 'x:1', dependencies: [], data_needed: 'none', network: 'none', size: 'small', licence: 'MIT' };
      await writeInventory(dir, { run, input: JSON.stringify([p]), now });
      await buildMap(dir, { run, now });
      await recordJudgments(dir, { run, input: JSON.stringify({ redact: 'missing' }), now });
      await computeVerdicts(dir, { run, sandbox: noSandbox, now });
      const rd = path.join(dir, '.claude', 'bbs', 'runs', run);
      await fs.writeFile(path.join(rd, 'usage.json'), '{bad');
      await assert.rejects(recordDecisions(dir, { run, input: JSON.stringify({ redact: 'rebuild' }), now }), /corrupt JSON.*cli\.js usage --force/);
      await writeJson(path.join(rd, 'usage.json'), { evidence: 'owner', workflows: [{ name: 'w-review' }] });
      await fs.writeFile(path.join(rd, 'targets.json'), '{bad');
      await assert.rejects(recordDecisions(dir, { run, input: JSON.stringify({ redact: 'rebuild' }), now }), /corrupt JSON.*cli\.js targets --force --from/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('targets — review r1 regressions', () => {
  let dir, run, rd;
  const decide = (obj, o = {}) => recordDecisions(dir, { run, input: JSON.stringify(obj), now, ...o });
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-tgt-r1-'));
    await makeRun(dir);
    const { intake } = await import('../src/lib/bbs/intake.js');
    const { writeInventory } = await import('../src/lib/bbs/inventory.js');
    const { buildMap, recordJudgments } = await import('../src/lib/bbs/harness-map.js');
    run = (await intake(dir, '-', { stdin: 'r1', now, slug: 'r1' })).runId;
    const p = (name, what, licence = 'MIT') => ({ name, what, idea: what, evidence: 'src/x.ts:1', dependencies: [], data_needed: 'none', network: 'none', size: 'small', licence });
    await writeInventory(dir, { run, input: JSON.stringify([p('redact', 'masks secrets'), p('gate', 'blocks a push'), p('meter', 'counts calls', 'Commercial')]), now });
    await buildMap(dir, { run, now });
    await recordJudgments(dir, { run, input: JSON.stringify({ redact: 'missing', gate: 'missing', meter: 'missing' }), now });
    rd = path.join(dir, '.claude', 'bbs', 'runs', run);
    await writeJson(path.join(rd, 'usage.json'), { evidence: 'transcripts', workflows: [{ name: 'w-review', count: 3 }] });
    await recordTargets(dir, { run, input: JSON.stringify({ redact: [row()], gate: [], meter: [] }), now });
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('a power that lands nowhere defaults to buy or skip, so approving the table as shown is accepted', async () => {
    const { table, rows } = await computeVerdicts(dir, { run, sandbox: noSandbox, now });
    const targets = (await readJson(path.join(rd, 'targets.json'))).targets;
    const usage = await readJson(path.join(rd, 'usage.json'));
    assert.equal(landingDefault('redact', rows.redact, targets, usage), 'rebuild', 'a power with a standing target keeps its default');
    assert.equal(landingDefault('gate', rows.gate, targets, usage), 'skip');
    assert.equal(landingDefault('gate', rows.gate, undefined, usage), rows.gate.default, 'no targets step, no change');
    // the owner's "Approve as shown": the Default column, as printed
    const shown = Object.fromEntries(table.split('\n').slice(2).map(l => l.split(' | ')).map(c => [c[0].replace(/^\| /, ''), c[4]]));
    assert.equal(shown.gate, 'skip');
    assert.ok(['buy', 'skip'].includes(shown.meter) && shown.meter === (rows.meter.legal.includes('buy') ? 'buy' : 'skip'));
    assert.equal((await decide(shown)).decided, 3);
  });

  it('where an approved power lands changes only with --force', async () => {
    await assert.rejects(setOwnerTargets(dir, { run, set: 'redact@bc', now }), /redact was approved to build.*--force/);
    await assert.rejects(recordTargets(dir, { run, input: JSON.stringify({ redact: [] }), now }), /redact was approved to build/);
    await setOwnerTargets(dir, { run, set: 'gate@w-review', now }); // gate was skipped: nothing approved to move
    const r = await setOwnerTargets(dir, { run, set: 'redact@w-review,bc', force: true, now });
    assert.equal(r.targets.redact.length, 2);
  });

  it('a step prefix names a heading only at a word end, and only when it leads one heading', () => {
    const heads = ['CHECKPOINT 3: Usage', 'CHECKPOINT 3b: Targets', 'Step 10'];
    assert.throws(() => matchStep('checkpoint', heads), /leads 2 headings.*CHECKPOINT 3: Usage.*CHECKPOINT 3b: Targets/);
    assert.equal(matchStep('checkpoint 3', heads), 'CHECKPOINT 3: Usage');
    assert.equal(matchStep('step 1', heads), null);
    assert.equal(matchStep('checkpoint 3b', heads), 'CHECKPOINT 3b: Targets');
  });

  it('an ambiguous step is refused when targets are recorded, naming the candidates', async () => {
    await fs.writeFile(path.join(dir, '.claude/commands/.shortcuts/w-review.md'), REVIEW + '\n### ⛔ CHECKPOINT 1b: Fixes\n');
    try {
      await assert.rejects(recordTargets(dir, { run, input: JSON.stringify({ gate: [row({ step: 'checkpoint' })] }), now }), /gate: w-review step "checkpoint" leads 2 headings/);
    } finally { await fs.writeFile(path.join(dir, '.claude/commands/.shortcuts/w-review.md'), REVIEW); }
  });

  it('a corrupt targets.json does not block a skip or buy', async () => {
    const good = await fs.readFile(path.join(rd, 'targets.json'), 'utf-8');
    await fs.writeFile(path.join(rd, 'targets.json'), '{bad');
    try {
      assert.equal((await decide({ gate: 'skip' }, { force: true })).decided, 3);
      await assert.rejects(decide({ redact: 'rebuild' }, { force: true }), /corrupt JSON.*cli\.js targets --force --from/);
    } finally { await fs.writeFile(path.join(rd, 'targets.json'), good); }
  });
});
