/**
 * Contract for src/lib/bbs/wiring.js and the integration modes of scripts/marathon-measure.js.
 * Integration is its own deliverable: a power counts as wired only when the installed command file of an approved
 * target runs `kit/cli.js <verb>` inside the approved step. Nothing else (prose, another step, another verb) counts.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { verbCall, stepSection, wiredTargets, approvedTargets, writeDelivered } from '../src/lib/bbs/wiring.js';
import { writeJson } from '../src/lib/bbs/store.js';
import { normalizeStep } from '../src/lib/bbs/targets.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mk = (p) => fs.mkdtemp(path.join(os.tmpdir(), p));
const put = async (dir, rel, text) => { const p = path.join(dir, rel); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, text); };
const cmd = (dir, name, text) => put(dir, `.claude/commands/.shortcuts/${name}.md`, text);

describe('verbCall', () => {
  it('matches the kit CLI run with the verb: bare, with flags, in inline code and in a fenced block', () => {
    const re = verbCall('redact');
    assert.ok(re.test('node .claude/helpers/kit/cli.js redact'));
    assert.ok(re.test('node .claude/helpers/kit/cli.js redact --x'));
    assert.ok(re.test('run `node .claude/helpers/kit/cli.js redact --in file`'));
    assert.ok(re.test('kit/cli.js redact --x'));
    assert.ok(re.test('```bash\nnode .claude/helpers/kit/cli.js redact\n```'));
    assert.ok(re.test("node '.claude/helpers/kit/cli.js redact'"));
  });

  it('does not match a longer verb, a cli without kit/, or prose that names the verb', () => {
    const re = verbCall('redact');
    assert.ok(!re.test('node .claude/helpers/kit/cli.js redact-all'));
    assert.ok(!re.test('node .claude/helpers/kit/cli.js redact_all'));
    assert.ok(!re.test('node cli.js redact'));
    assert.ok(!re.test('node .claude/helpers/bbs/cli.js redact'));
    assert.ok(!re.test('We redact secrets before sending; the redact step is manual.'));
    assert.ok(!re.test('node .claude/helpers/kit/cli.js unredact'));
    assert.ok(!re.test('node .claude/helpers/kit/cli.js redactor'));
  });

  it('escapes the verb and rejects an invalid one', () => {
    assert.ok(verbCall('a-b').test('kit/cli.js a-b'));
    assert.ok(!verbCall('a-b').test('kit/cli.js aXb'));
    for (const bad of ['', 'Redact', 'a b', '-x', 'a.b', 'a|b', '../x', 'x'.repeat(65)]) {
      assert.throws(() => verbCall(bad), /verb must be lower-case letters, digits and dashes/, String(bad));
    }
  });
});

describe('stepSection', () => {
  const doc = [
    '# /w-review', 'intro', '',
    '## Step 1: Gather', 'gather text', '',
    '### Detail A', 'detail text', '',
    '## ⚠️ **Step 2: Analyze**', 'analyze text', '',
    '```', '## Step 3: Not a heading', '```', 'still analyze', '',
    '## Step 4: Report', 'report text', ''
  ].join('\n');

  it('returns from the heading to the next heading of the same or a higher level, deeper subheadings included', () => {
    const s = stepSection(doc, 'Step 1: Gather');
    assert.ok(s.startsWith('## Step 1: Gather'));
    assert.ok(s.includes('gather text'));
    assert.ok(s.includes('### Detail A') && s.includes('detail text'), 'a deeper subheading stays inside');
    assert.ok(!s.includes('analyze text') && !s.includes('Step 2'));
    const sub = stepSection(doc, 'Detail A');
    assert.ok(sub.includes('detail text') && !sub.includes('gather text') && !sub.includes('Step 2'));
  });

  it('stops at a higher-level heading and runs to the end of the file for the last section', () => {
    const t = '## A\na\n### B\nb\n# Top\nt\n';
    assert.equal(stepSection(t, 'B'), '### B\nb');
    assert.equal(stepSection(t, 'A'), '## A\na\n### B\nb');
    assert.ok(stepSection(doc, 'Step 4: Report').endsWith('report text\n'));
  });

  it('ignores headings inside ``` fences, both as a target and as a boundary', () => {
    const s = stepSection(doc, 'Step 2: Analyze');
    assert.ok(s.includes('## Step 3: Not a heading'), 'a fenced heading does not end the section');
    assert.ok(s.includes('still analyze'));
    assert.ok(!s.includes('report text'));
    assert.equal(stepSection(doc, 'Step 3: Not a heading'), null, 'a fenced heading is not a step');
    assert.equal(stepSection('~~~\n## X\nx\n~~~\n', 'X'), null);
  });

  it('matches by normalized text (emoji and markdown stripped, as normalizeStep does) and returns null for a missing step', () => {
    assert.equal(normalizeStep('⚠️ **Step 2: Analyze**'), normalizeStep('Step 2: Analyze'));
    assert.equal(stepSection(doc, 'Step 2: Analyze'), stepSection(doc, '⚠️ **Step 2: Analyze**'));
    assert.ok(stepSection(doc, '`step 2: analyze`').includes('analyze text'));
    assert.equal(stepSection(doc, 'Step 9: Nope'), null);
    assert.equal(stepSection('', 'Step 1'), null);
  });
});

describe('wiredTargets', () => {
  let dir;
  before(async () => {
    dir = await mk('bbs-wired-');
    await cmd(dir, 'w-review', ['# /w-review', '', '## Step 1: Gather', 'git diff', '', '## Step 2: Analyze', 'Run `node .claude/helpers/kit/cli.js redact --in out.txt` first.', '', '## Step 3: Report', 'Summarise.', ''].join('\n'));
    await cmd(dir, 'w-fix', ['# /w-fix', '', '## Step 1: Diagnose', 'Look at the failure. Redact secrets by hand.', '', '## Step 2: Patch', '```bash', 'node .claude/helpers/kit/cli.js redact', '```', ''].join('\n'));
    await cmd(dir, 'w-any', ['# /w-any', '', '## Somewhere', 'node .claude/helpers/kit/cli.js redact', ''].join('\n'));
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  const T = (workflow, step, mode = 'advisory') => ({ workflow, step, mode });

  it('is wired when the step section runs the verb', async () => {
    const [r] = await wiredTargets(dir, { verb: 'redact', targets: [T('w-review', 'Step 2: Analyze')] });
    assert.deepEqual(r, { workflow: 'w-review', step: 'Step 2: Analyze', mode: 'advisory', file: '.claude/commands/.shortcuts/w-review.md', wired: true, why: null });
    const [f] = await wiredTargets(dir, { verb: 'redact', targets: [T('w-fix', 'Step 2: Patch', 'blocking')] });
    assert.equal(f.wired, true, 'a fenced block counts');
    assert.equal(f.mode, 'blocking');
  });

  it('is not wired, with a precise why, when the verb is only in another step', async () => {
    const [r] = await wiredTargets(dir, { verb: 'redact', targets: [T('w-review', 'Step 1: Gather')] });
    assert.equal(r.wired, false);
    assert.equal(r.why, '"Step 1: Gather" never runs kit/cli.js redact');
    const [p] = await wiredTargets(dir, { verb: 'redact', targets: [T('w-fix', 'Step 1: Diagnose')] });
    assert.equal(p.wired, false, 'prose naming the word is not a call');
    assert.equal(p.why, '"Step 1: Diagnose" never runs kit/cli.js redact');
  });

  it('is not wired when the verb differs (a longer verb or another one)', async () => {
    const [r] = await wiredTargets(dir, { verb: 'red', targets: [T('w-review', 'Step 2: Analyze')] });
    assert.equal(r.wired, false);
    assert.equal(r.why, '"Step 2: Analyze" never runs kit/cli.js red');
  });

  it('is not wired when the step heading is gone', async () => {
    const [r] = await wiredTargets(dir, { verb: 'redact', targets: [T('w-review', 'Step 7: Removed')] });
    assert.equal(r.wired, false);
    assert.equal(r.why, 'the step "Step 7: Removed" is no longer a heading of .claude/commands/.shortcuts/w-review.md');
  });

  it('is not wired when the workflow is not installed', async () => {
    const [r] = await wiredTargets(dir, { verb: 'redact', targets: [T('w-ghost', 'Step 1')] });
    assert.deepEqual(r, { workflow: 'w-ghost', step: 'Step 1', mode: 'advisory', file: null, wired: false, why: 'the workflow is not installed' });
  });

  it('a target with step null counts when the verb is run anywhere in the file, and not otherwise', async () => {
    const rows = await wiredTargets(dir, { verb: 'redact', targets: [T('w-any', undefined), T('w-review', null), T('w-fix', null)] });
    assert.deepEqual(rows.map(r => [r.workflow, r.step, r.wired]), [['w-any', null, true], ['w-review', null, true], ['w-fix', null, true]]);
    const [none] = await wiredTargets(dir, { verb: 'absent', targets: [T('w-any', null)] });
    assert.equal(none.wired, false);
    assert.equal(none.why, '.claude/commands/.shortcuts/w-any.md never runs kit/cli.js absent');
  });

  it('returns one row per target, in order, and [] for no targets', async () => {
    const rows = await wiredTargets(dir, { verb: 'redact', targets: [T('w-review', 'Step 1: Gather'), T('w-review', 'Step 2: Analyze')] });
    assert.deepEqual(rows.map(r => r.wired), [false, true]);
    assert.deepEqual(await wiredTargets(dir, { verb: 'redact', targets: [] }), []);
    assert.deepEqual(await wiredTargets(dir, { verb: 'redact', targets: null }), []);
  });

  it('rejects an invalid verb before reading anything', async () => {
    await assert.rejects(() => wiredTargets(dir, { verb: 'Bad Verb', targets: [] }), /verb must be/);
  });
});

/** A decided bbs run on disk: handoff.json, powers.json, targets.json, usage.json (what writeDelivered reads). */
async function seedRun(dir, run, { powers, targets }) {
  const rd = path.join(dir, '.claude', 'bbs', 'runs', run);
  await writeJson(path.join(rd, 'handoff.json'), { run, source: { ref: 'https://github.com/a/b' }, powers: powers.map(p => ({ name: p.name })) });
  await writeJson(path.join(rd, 'powers.json'), { powers: powers.map(p => ({ name: p.name, what: p.what })) });
  await writeJson(path.join(rd, 'targets.json'), { run, targets });
  await writeJson(path.join(rd, 'usage.json'), { run, evidence: 'transcripts', workflows: [{ name: 'w-review' }, { name: 'w-fix' }] });
  return rd;
}
const tgt = (workflow, step, over = {}) => ({ workflow, step, how: 'h', mode: 'advisory', by: 'proposed', ...over });

describe('approvedTargets', () => {
  let dir;
  before(async () => { dir = await mk('bbs-appr-'); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('keeps the standing targets only: owner-named, unused_reason, or a workflow the owner runs', async () => {
    await seedRun(dir, 'r1', { powers: [{ name: 'p' }], targets: { p: [tgt('w-review', 'S'), tgt('w-never', 'S'), tgt('w-never2', 'S', { by: 'owner' }), tgt('w-never3', 'S', { unused_reason: 'new flow' })] } });
    const t = await approvedTargets(dir, { run: 'r1', power: 'p' });
    assert.deepEqual(t.map(x => x.workflow), ['w-review', 'w-never2', 'w-never3']);
  });

  it('refuses a run decided before the targets step', async () => {
    await writeJson(path.join(dir, '.claude', 'bbs', 'runs', 'old', 'usage.json'), { evidence: 'none', workflows: [] });
    await assert.rejects(() => approvedTargets(dir, { run: 'old', power: 'p' }), /run old has no targets\.json/);
  });
});

describe('writeDelivered', () => {
  let dir;
  before(async () => {
    dir = await mk('bbs-deliv-');
    await cmd(dir, 'w-review', '# /w-review\n\n## Step 1: Gather\nnode .claude/helpers/kit/cli.js alpha --in x\n\n## Step 2: Analyze\nnothing here\n');
    await cmd(dir, 'w-fix', '# /w-fix\n\n## Step 1: Patch\nrun `node .claude/helpers/kit/cli.js beta`\n');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  const fixed = () => new Date('2026-10-10T12:00:00Z');

  it('lists each approved power with ✓/✗ per target, why, the by-hand command; all_wired true only when every target of every power is wired', async () => {
    const rd = await seedRun(dir, 'ok', {
      powers: [{ name: 'alpha', what: 'does  the\n alpha thing' }, { name: 'beta', what: 'does beta' }],
      targets: { alpha: [tgt('w-review', 'Step 1: Gather')], beta: [tgt('w-fix', 'Step 1: Patch', { mode: 'blocking' })] }
    });
    const res = await writeDelivered(dir, { run: 'ok', verbs: { alpha: 'alpha', beta: 'beta' }, now: fixed });
    assert.equal(res.file, '.claude/bbs/runs/ok/delivered.md');
    assert.equal(res.all_wired, true);
    assert.deepEqual(res.powers, [
      { name: 'alpha', verb: 'alpha', wired: true, targets: ['wired: w-review · Step 1: Gather'] },
      { name: 'beta', verb: 'beta', wired: true, targets: ['wired: w-fix · Step 1: Patch'] }
    ]);
    const md = await fs.readFile(path.join(rd, 'delivered.md'), 'utf-8');
    assert.match(md, /^# What you got — bbs run ok\n/);
    assert.ok(md.includes('Written 2026-10-10T12:00:00.000Z'));
    assert.ok(md.includes('## alpha\n'));
    assert.ok(md.includes('## beta\n'));
    assert.ok(md.includes('does the alpha thing'), 'what is whitespace-collapsed');
    assert.ok(md.includes('- ✓ `/w-review` · Step 1: Gather · advisory\n'));
    assert.ok(md.includes('- ✓ `/w-fix` · Step 1: Patch · blocking\n'));
    assert.ok(md.includes('Run it by hand: `node .claude/helpers/kit/cli.js alpha …`'));
    assert.ok(md.includes('Run it by hand: `node .claude/helpers/kit/cli.js beta …`'));
    assert.ok(!md.includes('NOT fully wired'));
    assert.ok(!md.includes('✗'));
  });

  it('marks a power with an unwired target NOT fully wired, shows the why, and all_wired is false', async () => {
    const rd = await seedRun(dir, 'partial', {
      powers: [{ name: 'alpha', what: 'a' }, { name: 'beta', what: 'b' }],
      targets: { alpha: [tgt('w-review', 'Step 1: Gather'), tgt('w-review', 'Step 2: Analyze')], beta: [tgt('w-fix', 'Step 1: Patch')] }
    });
    const res = await writeDelivered(dir, { run: 'partial', verbs: { alpha: 'alpha', beta: 'beta' }, now: fixed });
    assert.equal(res.all_wired, false);
    assert.deepEqual(res.powers.map(p => [p.name, p.wired]), [['alpha', false], ['beta', true]]);
    assert.deepEqual(res.powers[0].targets, ['wired: w-review · Step 1: Gather', 'NOT wired: w-review · Step 2: Analyze']);
    const md = await fs.readFile(path.join(rd, 'delivered.md'), 'utf-8');
    assert.ok(md.includes('## alpha — NOT fully wired\n'));
    assert.ok(md.includes('## beta\n'));
    assert.ok(md.includes('- ✓ `/w-review` · Step 1: Gather · advisory\n'));
    assert.ok(md.includes('- ✗ `/w-review` · Step 2: Analyze · advisory — "Step 2: Analyze" never runs kit/cli.js alpha\n'));
  });

  it('a power with no verb is not wired; its targets say so and the by-hand line says no verb recorded', async () => {
    const rd = await seedRun(dir, 'noverb', {
      powers: [{ name: 'alpha', what: 'a' }, { name: 'beta', what: 'b' }],
      targets: { alpha: [tgt('w-review', 'Step 1: Gather')], beta: [tgt('w-fix', 'Step 1: Patch')] }
    });
    const res = await writeDelivered(dir, { run: 'noverb', verbs: { alpha: 'alpha' }, now: fixed });
    assert.equal(res.all_wired, false);
    assert.deepEqual(res.powers[1], { name: 'beta', verb: null, wired: false, targets: ['NOT wired: w-fix · Step 1: Patch'] });
    const md = await fs.readFile(path.join(rd, 'delivered.md'), 'utf-8');
    assert.ok(md.includes('## beta — NOT fully wired\n'));
    assert.ok(md.includes('— no verb recorded for this power'));
    assert.ok(md.includes('Run it by hand: (no verb recorded)'));
  });

  it('a power with no approved target is not wired', async () => {
    const rd = await seedRun(dir, 'notarget', { powers: [{ name: 'alpha', what: 'a' }], targets: { alpha: [] } });
    const res = await writeDelivered(dir, { run: 'notarget', verbs: { alpha: 'alpha' }, now: fixed });
    assert.equal(res.all_wired, false);
    assert.deepEqual(res.powers, [{ name: 'alpha', verb: 'alpha', wired: false, targets: [] }]);
    assert.ok((await fs.readFile(path.join(rd, 'delivered.md'), 'utf-8')).includes('- (no approved target)'));
  });

  it('a target of an unused workflow that the owner did not name is not an approved target, so it cannot make the power wired', async () => {
    await seedRun(dir, 'unused', { powers: [{ name: 'alpha', what: 'a' }], targets: { alpha: [tgt('w-review', 'Step 1: Gather'), tgt('w-unused', 'Step 1')] } });
    const res = await writeDelivered(dir, { run: 'unused', verbs: { alpha: 'alpha' }, now: fixed });
    assert.deepEqual(res.powers[0].targets, ['wired: w-review · Step 1: Gather']);
    assert.equal(res.all_wired, true);
  });

  it('a verb for a power that is not in the hand-off throws and writes nothing', async () => {
    const rd = await seedRun(dir, 'stray', { powers: [{ name: 'alpha', what: 'a' }], targets: { alpha: [tgt('w-review', 'Step 1: Gather')] } });
    await assert.rejects(() => writeDelivered(dir, { run: 'stray', verbs: { alpha: 'alpha', gamma: 'gamma' } }), /"gamma" is not a power this hand-off approved/);
    await assert.rejects(() => fs.stat(path.join(rd, 'delivered.md')), { code: 'ENOENT' });
  });

  it('refuses a run without a hand-off', async () => {
    await assert.rejects(() => writeDelivered(dir, { run: 'nope', verbs: {} }), /run nope has no handoff\.json/);
  });

  it('a hand-off with no approved power is never all_wired', async () => {
    await seedRun(dir, 'empty', { powers: [], targets: {} });
    const res = await writeDelivered(dir, { run: 'empty', verbs: {}, now: fixed });
    assert.equal(res.all_wired, false);
    assert.deepEqual(res.powers, []);
  });
});

describe('scripts/marathon-measure.js — integration modes', () => {
  const SCRIPT = path.join(ROOT, 'scripts', 'marathon-measure.js');
  const run = (cwdRoot, args) => spawnSync(process.execPath, [path.join(cwdRoot, 'scripts', 'marathon-measure.js'), ...args], { cwd: cwdRoot, encoding: 'utf-8' });

  it('argument errors: --wired needs --bbs-run, --power and --verb; --delivered needs --bbs-run and at least one --verb', () => {
    const cases = [
      [['--wired', '--bbs-run', 'r', '--verb', 'v'], /--power is required/],
      [['--wired', '--bbs-run', 'r', '--power', 'p'], /--verb is required/],
      [['--wired', '--power', 'p', '--verb', 'v'], /--bbs-run is required/],
      [['--delivered', '--verb', 'p=v'], /--bbs-run is required/],
      [['--delivered', '--bbs-run', 'r'], /--delivered needs at least one --verb <power>=<verb>/],
      [['--wired', '--bbs-run', 'r', '--power'], /--power needs a value/],
      [['--wired', '--bbs-run', 'r', '--power', '--verb', 'v'], /--power needs a value/],
      [['stray'], /unexpected argument stray/]
    ];
    for (const [argv, re] of cases) {
      const r = spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: ROOT, encoding: 'utf-8' });
      assert.equal(r.status, 1, argv.join(' '));
      assert.match(r.stderr, /^marathon-measure: /);
      assert.match(r.stderr, re, argv.join(' '));
    }
  });

  it('--delivered rejects a --verb that is not <power>=<verb>; an unknown run is refused (nothing is recorded)', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--delivered', '--bbs-run', 'no-such-run-xyz', '--verb', 'novalue', '--dry'], { cwd: ROOT, encoding: 'utf-8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--verb needs <power>=<verb>, got "novalue"/);
    const w = spawnSync(process.execPath, [SCRIPT, '--wired', '--bbs-run', 'no-such-run-xyz', '--power', 'p', '--verb', 'v', '--dry'], { cwd: ROOT, encoding: 'utf-8' });
    assert.equal(w.status, 1);
    assert.match(w.stderr, /run no-such-run-xyz has no targets\.json/);
    const d = spawnSync(process.execPath, [SCRIPT, '--delivered', '--bbs-run', 'no-such-run-xyz', '--verb', 'p=v', '--dry'], { cwd: ROOT, encoding: 'utf-8' });
    assert.equal(d.status, 1);
    assert.match(d.stderr, /run no-such-run-xyz has no handoff\.json/);
  });

  describe('in a temp project with its own marathon run', () => {
    let proj;
    let mRun;
    const measures = async () => {
      const out = {};
      let text = '';
      try { text = await fs.readFile(path.join(proj, '.claude', 'marathon', mRun, 'store', 'measurements.jsonl'), 'utf-8'); } catch { /* none recorded yet */ }
      for (const line of text.split('\n').filter(Boolean)) { const r = JSON.parse(line); if (r.key !== 'usage_pct') out[r.key] = r.value; }
      return out;
    };

    before(async () => {
      proj = await mk('bbs-measure-');
      await fs.mkdir(path.join(proj, 'scripts'), { recursive: true });
      await fs.copyFile(SCRIPT, path.join(proj, 'scripts', 'marathon-measure.js'));
      await fs.symlink(path.join(ROOT, 'src'), path.join(proj, 'src'));
      await fs.cp(path.join(ROOT, 'src', 'lib', 'marathon'), path.join(proj, '.claude', 'helpers', 'marathon'), { recursive: true });
      await put(proj, '.claude/marathon/finish-line.example.json', JSON.stringify({ tolerance: { high: 0, medium: 1, low: 3, passes_in_a_row: 2 }, lines: [] }));
      await put(proj, '.claude/marathon/rules.md', '# Standing rules\n');
      await cmd(proj, 'w-review', '# /w-review\n\n## Step 1: Gather\nnode .claude/helpers/kit/cli.js alpha\n\n## Step 2: Analyze\nnothing\n');
      await seedRun(proj, 'b1', {
        powers: [{ name: 'Alpha Power', what: 'alpha' }],
        targets: { 'Alpha Power': [tgt('w-review', 'Step 1: Gather'), tgt('w-review', 'Step 2: Analyze')] }
      });
      const init = spawnSync(process.execPath, [path.join(proj, '.claude', 'helpers', 'marathon', 'cli.js'), 'init', 'wired-test'], { cwd: proj, encoding: 'utf-8' });
      assert.equal(init.status, 0, init.stderr + init.stdout);
      mRun = (await fs.readFile(path.join(proj, '.claude', 'marathon', 'ACTIVE'), 'utf-8')).trim();
    });
    after(async () => { await fs.rm(proj, { recursive: true, force: true }); });

    it('--wired --dry reports the count and the rows and records nothing', async () => {
      const r = run(proj, ['--wired', '--bbs-run', 'b1', '--power', 'Alpha Power', '--verb', 'alpha', '--dry']);
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.key, 'wired_alpha-power');
      assert.equal(out.wired, 1);
      assert.equal(out.of, 2);
      assert.deepEqual(out.rows.map(x => x.wired), [true, false]);
      assert.equal(out.recorded, undefined);
      assert.deepEqual(await measures(), {});
    });

    it('--wired records wired_<slug> = the number of wired targets on the marathon run', async () => {
      const r = run(proj, ['--wired', '--bbs-run', 'b1', '--power', 'Alpha Power', '--verb', 'alpha', '--run', mRun]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).recorded, true);
      assert.equal(String((await measures())['wired_alpha-power']), '1');
    });

    it('--delivered writes delivered.md and records delivered = false while a target is unwired, true once all are', async () => {
      const r = run(proj, ['--delivered', '--bbs-run', 'b1', '--verb', 'Alpha Power=alpha', '--run', mRun]);
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.all_wired, false);
      assert.equal(out.file, '.claude/bbs/runs/b1/delivered.md');
      assert.equal(out.recorded, true);
      assert.ok((await fs.readFile(path.join(proj, out.file), 'utf-8')).includes('## Alpha Power — NOT fully wired'));
      assert.equal(String((await measures()).delivered), 'false');

      await cmd(proj, 'w-review', '# /w-review\n\n## Step 1: Gather\nnode .claude/helpers/kit/cli.js alpha\n\n## Step 2: Analyze\n`node .claude/helpers/kit/cli.js alpha`\n');
      const r2 = run(proj, ['--delivered', '--bbs-run', 'b1', '--verb', 'Alpha Power=alpha', '--run', mRun]);
      assert.equal(r2.status, 0, r2.stderr);
      assert.equal(JSON.parse(r2.stdout).all_wired, true);
      assert.equal(String((await measures()).delivered), 'true');
    });

    it('--delivered with a verb for a power outside the hand-off fails and records nothing new', async () => {
      const before0 = JSON.stringify(await measures());
      const r = run(proj, ['--delivered', '--bbs-run', 'b1', '--verb', 'Ghost=ghost', '--run', mRun]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /"Ghost" is not a power this hand-off approved/);
      assert.equal(JSON.stringify(await measures()), before0);
    });
  });
});

describe('wiring — build review notes', () => {
  it('verbCall refuses a missing or non-string verb with its own message', async () => {
    const { verbCall } = await import('../src/lib/bbs/wiring.js');
    for (const v of [undefined, null, 5, ['redact']]) assert.throws(() => verbCall(v), /verb must be lower-case letters, digits and dashes/);
  });
  it('a heading with any emoji names the same step as its words', async () => {
    const { normalizeStep, matchStep } = await import('../src/lib/bbs/steps.js');
    assert.equal(normalizeStep('## 🔍 Step 2'), 'step 2');
    assert.equal(normalizeStep('### 👩‍💻 Review'), 'review');
    assert.equal(matchStep('Step 2', ['🔍 Step 2', 'Step 20']), '🔍 Step 2');
  });
});
