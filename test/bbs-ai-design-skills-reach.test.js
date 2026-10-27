/**
 * Reach tests for the 12 design powers of bbs run 2026-10-26-ai-design-skills.
 *
 * Each test goes in through the surface a user reaches: it reads the installed workflow command file
 * (.claude/commands/...), finds the step under the approved heading, cuts out that step's own paragraph and bash
 * block, fills the block's NAME='<...>' placeholders with a small fixture and runs the block's real lines with bash
 * (so a shell-level bug, such as assigning to a bash special variable, fails the test), then checks the power's
 * effect. On that slice alone it also checks the step is gated on UI / landing / animation work, carries the
 * kit-missing fallback and says whether it is advisory or blocking.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stepSection } from '../.claude/helpers/bbs/wiring.js';
import { encodePng } from '../.claude/helpers/kit/fidelity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT = '.claude/helpers/kit/cli.js';
const WF = {
  plan: '.claude/commands/.shortcuts/w-plan-tdd-swarm.md',
  marathon: '.claude/commands/.shortcuts/w-marathon.md',
  perf: '.claude/commands/.shortcuts/w-perf.md',
  design: '.claude/commands/analysis/design.md',
  layout: '.claude/commands/analysis/layout.md'
};
const H = {
  interview: '⛔ CHECKPOINT 1: Interview (MANDATORY - NEVER SKIP)',
  plan: '⛔ CHECKPOINT 2: Plan',
  spec: '⛔ CHECKPOINT 3: Spec',
  tests: '⛔ CHECKPOINT 4: Tests (BLOCKING GATE)',
  build: '⛔ CHECKPOINT 5: Build',
  review: '⛔ CHECKPOINT 6: Review',
  mInterview: '⛔ CHECKPOINT 1: Interview (HIL — once)',
  mLoop: '⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met',
  profiling: '⛔ CHECKPOINT 1: Profiling Done',
  usage: 'Usage',
  creates: 'What It Creates',
  layoutTypes: 'Layout Types'
};

let dir;
const fx = {};
const write = (name, body) => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-reach-'));
  fx.BRIEF = write('brief.json', JSON.stringify({ kind: 'landing', answers: { offer: 'Invoice tool for freelancers' } }));
  fx.MOTION = write('motion.json', JSON.stringify({ request: 'animate this design', has_site_codebase: false, sections: [{ id: 'hero', kind: 'hero' }, { id: 'features', kind: 'cards' }] }));
  // opens with an inline tag, as many markdown specs do: the Spec step must still read it as markdown
  fx.SPEC = write('spec.md', '<a id="top"></a>\n\n# Hero\n\nGet paid on time.\n\n# Pricing\n');
  fx.BG = write('bg.json', JSON.stringify({ selector: '.hero', container: { w: 1200, h: 600 }, image: { w: 2400, h: 1600 }, scale_mode: 'FILL' }));
  fx.CSS = write('styles.css', '.lead{font-size:15px}\n.hero{background-image:url(a.jpg)}\n.hero:hover{background-image:url(b.jpg);transition:background 1s}\n');
  fx.BG_SELECTOR = '.hero';
  fx.TAGLINE = write('tagline.txt', 'Invoices that pay themselves');
  fx.PAGE = write('page.html', '<h1>Lorem ipsum dolor</h1><p>John Doe at Acme Inc</p>\n');
  fx.LAYERS = write('layers.json', JSON.stringify({ frame: { x: 0, y: 0 }, layers: [{ id: 'card', z: 1, bounds: { x: 10, y: 20, w: 100, h: 50 }, render_bounds: { x: 6, y: 16, w: 108, h: 58 }, effects_even: true }] }));
  fx.ENTRANCE_GROUPS = write('groups.json', JSON.stringify({ groups: [{ id: 'title', kind: 'text', order: 1, items: 1 }, { id: 'cards', kind: 'card', order: 2, covered: true, items: 2 }, { id: 'shot', kind: 'photo', order: 3, items: 1 }] }));
  fx.STORIES = write('stories.json', JSON.stringify({ loop_ms: 1000, stories: [{ id: 's1', card: 'c1', pattern: 'stack-landing', sentence: 'A card drops in.', tracks: { y: [{ t: 0, v: 0 }, { t: 1000, v: 5 }] } }] }));
  fx.URL = `file://${path.join(dir, 'page.html')}`;
  fx.FRAMES = path.join(dir, 'frames');
  // reference and actual stills: a 32x32 grey frame with a dark 16x16 card; "bad" has the card moved off its place
  const still = (cx) => { const px = Buffer.alloc(32 * 32 * 3, 200); for (let y = 8; y < 24; y++) for (let x = cx; x < cx + 16; x++) px.fill(30, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3); return encodePng(32, 32, px, 3); };
  fx.REF = write('ref.png', still(8));
  fx.good = write('good.png', still(8));
  fx.bad = write('bad.png', still(16));
  fx.ACTUAL = fx.good;
  fx.REGIONS = write('regions.json', JSON.stringify([{ id: 'card', x: 8, y: 8, w: 16, h: 16 }]));
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** The step text under `heading` of the installed workflow file. */
function step(file, heading) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
  const s = stepSection(text, heading);
  assert.ok(s, `${file} has no heading "${heading}"`);
  return s;
}

/** The exact kit commands a piece of step text tells the agent to run for `verb` (guarded bash lines or inline code). */
function commands(text, verb) {
  const re = new RegExp(`node \\.claude/helpers/kit/cli\\.js ${verb}(?![\\w-])[^;\`\\n]*`, 'g');
  return [...text.matchAll(re)].map(m => m[0].trim());
}

const runsVerb = (line, verb, prefix) => new RegExp(`node \\.claude/helpers/kit/cli\\.js ${verb}${prefix ? ` ${prefix}` : ''}(?![\\w-])`).test(line);

/**
 * The step's own slice for `verb` under `heading`: the paragraph that leads its bash block, the block, and the
 * paragraph after it; or, for an inline-only step, the one paragraph that names the command.
 * Returns { text, block (the bash lines or null), line (the line that runs the command) }.
 */
function slice(file, heading, verb, prefix = '') {
  const lines = step(file, heading).split('\n');
  const para = (from, dir) => { const out = []; let i = from; while (i >= 0 && i < lines.length && lines[i].trim() === '') i += dir; while (i >= 0 && i < lines.length && lines[i].trim() !== '' && !/^\s*```/.test(lines[i])) { out.push(lines[i]); i += dir; } return dir < 0 ? out.reverse() : out; };
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```bash/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !/^\s*```/.test(lines[j])) j++;
    const block = lines.slice(i + 1, j);
    const line = block.find(l => runsVerb(l, verb, prefix));
    if (!line) continue;
    return { text: [...para(i - 1, -1), ...lines.slice(i, j + 1), ...para(j + 1, 1)].join('\n'), block, line };
  }
  const k = lines.findIndex(l => runsVerb(l, verb, prefix));
  assert.ok(k >= 0, `${file} › ${heading} never runs kit/cli.js ${verb} ${prefix}`);
  const text = [...para(k - 1, -1).filter(() => !/^\s*[-*] /.test(lines[k])), lines[k], ...(/^\s*[-*] /.test(lines[k]) ? [] : para(k + 1, 1))].join('\n');
  return { text, block: null, line: commands(lines[k], verb).find(c => runsVerb(c, verb, prefix)) };
}

/**
 * Run the step's real bash: the block's placeholder assignments (each '<...>' filled with the fixture for its name)
 * and the block line that runs the command, as one bash script from the project root. An inline-only step runs its
 * inline command with bash. `over` replaces fixtures for this run.
 */
function run(s, over = {}) {
  const map = { ...fx, ...over };
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  let script;
  if (s.block) {
    const assigns = s.block.filter(l => /^[A-Za-z_][A-Za-z0-9_]*='<[^']*>'/.test(l)).map(l => {
      const name = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)[1];
      assert.ok(name in map, `no fixture for ${name} in: ${l}`);
      return l.replace(/^([A-Za-z_][A-Za-z0-9_]*)='<[^']*>'/, `$1=${q(map[name])}`);
    });
    script = [...assigns, s.line].join('\n');
  } else {
    assert.ok(!/"\$[A-Z_]+"/.test(s.line), `an inline-only step has no placeholders to fill: ${s.line}`);
    script = s.line;
  }
  assert.match(script, new RegExp(`node ${KIT.replace(/[.]/g, '\\.')} `), 'the step runs the installed kit CLI');
  const r = spawnSync('bash', ['-c', script], { cwd: ROOT, encoding: 'utf-8' });
  assert.doesNotMatch(r.stderr, /is still the placeholder or does not exist/, `a filled placeholder did not reach the command: ${r.stderr}`);
  assert.doesNotMatch(r.stdout, /kit not installed/, 'the installed kit runs');
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

/** The step's slice text for `verb` (`section`) and the runnable step (`command`, passed to run()). */
function cmd(file, heading, verb, prefix = '') {
  const s = slice(file, heading, verb, prefix);
  return { section: s.text, command: s };
}

/** On the step's own slice: gated on design work, carries the kit-missing fallback, advisory unless `blocking`. */
function gated(text, verb, { blocking = false } = {}) {
  assert.match(text, new RegExp(`cli\\.js ${verb}(?![\\w-])`), `the slice is the ${verb} step`);
  assert.match(text, /When the (?:task|change|stream) (?:is|builds) (?:UI|a landing page|animating|animation)|For a landing page|Before designing|Landing page in the fixed/);
  assert.match(text, /kit not installed|cli\.js` is missing/);
  if (blocking) assert.match(text, /Exit 2 stops/);
  else assert.match(text, /advisory/);
}

describe('Intake batch before design (design-brief)', () => {
  for (const [file, heading] of [[WF.plan, H.interview], [WF.marathon, H.mInterview], [WF.design, H.usage]]) {
    it(`${file} › ${heading}: one question batch, then stated assumptions`, () => {
      const q = cmd(file, heading, 'design-brief', 'questions');
      gated(q.section, 'design-brief');
      const asked = run(q.command);
      assert.equal(asked.status, 0);
      const fields = asked.json.batch.map(b => b.field);
      assert.ok(fields.includes('audience') && fields.includes('brand') && fields.includes('references'), 'every missing brief item is asked in one batch');
      assert.ok(!fields.includes('offer'), 'a known item is not asked again');
      const a = run(cmd(file, heading, 'design-brief', 'assume').command);
      assert.equal(a.status, 0);
      assert.equal(a.json.brief.offer, 'Invoice tool for freelancers');
      assert.ok(a.json.brief.audience && a.json.brief.brand, 'gaps are filled with stated assumptions');
    });
  }
});

describe('Landing page section order (landing-sections)', () => {
  for (const [file, heading] of [[WF.plan, H.spec], [WF.layout, H.layoutTypes], [WF.design, H.creates]]) {
    it(`${file} › ${heading}: the fixed numbered section sequence`, () => {
      const { section, command } = cmd(file, heading, 'landing-sections', 'plan');
      gated(section, 'landing-sections');
      const r = run(command);
      assert.equal(r.status, 0);
      const ids = r.json.sections.map(s => s.id);
      assert.equal(ids[0], 'hero');
      assert.equal(ids.at(-1), 'final-cta');
    });
  }
  it('w-plan-tdd-swarm › Spec: check lists the sections a spec is missing', () => {
    const r = run(cmd(WF.plan, H.spec, 'landing-sections', 'check').command);
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.found, ['hero']);
    assert.ok(r.json.missing.includes('final-cta'));
  });
});

describe('Type scale snapping to Tailwind steps (type-scale)', () => {
  for (const [file, heading] of [[WF.plan, H.build], [WF.design, H.creates]]) {
    it(`${file} › ${heading}: off-scale sizes snap to the smaller step with its line height`, () => {
      const { section, command } = cmd(file, heading, 'type-scale', 'audit');
      gated(section, 'type-scale');
      const r = run(command);
      assert.equal(r.status, 0);
      assert.deepEqual(r.json.changes.map(c => [c.from, c.to_step, c.size_px, c.line_height_px]), [['15px', 'sm', 14, 20]]);
    });
  }
});

describe('Tagline word reveal on scroll (word-reveal)', () => {
  for (const [file, heading] of [[WF.plan, H.build], [WF.marathon, H.mLoop]]) {
    it(`${file} › ${heading}: the statement is split into reveal words`, () => {
      const { section, command } = cmd(file, heading, 'word-reveal', 'emit');
      gated(section, 'word-reveal');
      const r = run(command);
      assert.equal(r.status, 0);
      assert.equal((r.stdout.match(/class="wr-w"/g) || []).length, 4);
      assert.match(r.stdout, /data-word-reveal/);
    });
  }
});

describe('Realistic sample content rules (sample-content)', () => {
  for (const [file, heading] of [[WF.plan, H.review], [WF.design, H.creates], [WF.marathon, H.mLoop]]) {
    it(`${file} › ${heading}: filler copy and placeholder names are flagged`, () => {
      const { section, command } = cmd(file, heading, 'sample-content', 'lint');
      gated(section, 'sample-content');
      const r = run(command);
      assert.equal(r.status, 0, 'advisory: findings never stop the flow');
      const rules = r.json.findings.map(f => f.rule);
      assert.ok(rules.includes('lorem') && rules.includes('placeholder-person'));
    });
  }
});

describe('Context split showcase or website (motion-plan)', () => {
  for (const [file, heading] of [[WF.plan, H.plan], [WF.marathon, H.mInterview]]) {
    it(`${file} › ${heading}: showcase or website, and a motion per section`, () => {
      const { section, command } = cmd(file, heading, 'motion-plan');
      gated(section, 'motion-plan');
      const r = run(command);
      assert.equal(r.status, 0);
      assert.equal(r.json.mode, 'website');
      assert.equal(r.json.assumed, true);
      assert.deepEqual(r.json.sections.map(s => s.id), ['hero', 'features']);
      assert.ok(r.json.sections.every(s => s.motion.length));
    });
  }
});

describe('Reference frame fidelity check (fidelity)', () => {
  // [file, approved heading, blocking, the heading whose block runs the score (the approved one unless it differs)]
  for (const [file, heading, blocking, runAt] of [[WF.plan, H.tests, true, H.build], [WF.marathon, H.mLoop, true], [WF.perf, H.profiling, false]]) {
    it(`${file} › ${heading}: a matching still passes, a misplaced card exits 2 (${blocking ? 'blocking' : 'advisory'})`, () => {
      if (runAt) {
        // at Tests no UI exists yet: the step records REF and REGIONS and the expectation, and points at the Build score
        const t = slice(file, heading, 'fidelity');
        gated(t.text, 'fidelity', { blocking });
        assert.equal(t.block, null, 'Tests runs no score before the UI exists');
        assert.match(t.text, /"\$REF"/);
        assert.match(t.text, /"\$REGIONS"/);
        assert.match(t.text, /expectation/);
        assert.match(t.text, /end of CHECKPOINT 5 Build, once the still is rendered and before motion is added/);
        const b = slice(file, runAt, 'fidelity');
        assert.match(b.text, /CHECKPOINT 4: Tests/, 'the Build score uses what Tests recorded');
        assert.match(b.text, /before motion is added/);
        assert.match(b.text, /Exit 2 stops the flow/);
      }
      const { section, command } = cmd(file, runAt || heading, 'fidelity');
      gated(section, 'fidelity', { blocking });
      const ok = run(command, { ACTUAL: fx.good });
      assert.equal(ok.status, 0);
      assert.equal(ok.json.pass, true);
      const bad = run(command, { ACTUAL: fx.bad });
      assert.equal(bad.status, 2);
      assert.equal(bad.json.pass, false);
      assert.equal(bad.json.regions[0].id, 'card');
      assert.equal(bad.json.regions[0].pass, false);
      // the guard keeps the exit status, so a blocking step really stops
      assert.match(section, /cli\.js fidelity [^\n]*; RC=\$\?; \(exit \$RC\); fi/);
    });
  }
});

describe('Layer export placement math (layer-place)', () => {
  for (const [file, heading] of [[WF.plan, H.build], [WF.marathon, H.mLoop]]) {
    it(`${file} › ${heading}: an effect overhang shifts the layer image`, () => {
      const { section, command } = cmd(file, heading, 'layer-place');
      gated(section, 'layer-place');
      const r = run(command);
      assert.equal(r.status, 0);
      const p = r.json.placements[0];
      assert.deepEqual([p.rule, p.left, p.top, p.width, p.height], ['overhang-offset', 6, 16, 108, 58]);
    });
  }
});

describe('Sacred background preservation (bg-fill)', () => {
  it('w-plan-tdd-swarm › Spec: the background CSS reproduces the original fill', () => {
    const { section, command } = cmd(WF.plan, H.spec, 'bg-fill', 'css');
    gated(section, 'bg-fill');
    const r = run(command);
    assert.equal(r.status, 0);
    assert.equal(r.json.css['background-size'], 'cover');
    assert.match(r.json.raw_css, /^\.hero \{/);
    // raw_css holds sizing only, so the spec keeps the exported background-image and adds these rules to it
    assert.doesNotMatch(r.json.raw_css, /background-image/);
    assert.match(section, /to the element's original `background-image` declaration/);
    assert.match(section, /stays exactly as it was exported/);
    assert.doesNotMatch(section, /as the only background CSS/);
  });
  it('w-plan-tdd-swarm › Review: an animated or swapped background is reported (advisory)', () => {
    const { section, command } = cmd(WF.plan, H.review, 'bg-fill', 'guard');
    gated(section, 'bg-fill');
    assert.match(section, /advisory here: the review goes on/);
    const r = run(command);
    assert.equal(r.status, 2);
    assert.equal(r.json.pass, false);
    assert.deepEqual(r.json.violations.map(v => v.property).sort(), ['background-image', 'transition']);
  });
});

describe('Entrance choreography kinds (entrance)', () => {
  for (const [file, heading] of [[WF.plan, H.build], [WF.marathon, H.mLoop]]) {
    it(`${file} › ${heading}: named entrances with stagger, covered layers last`, () => {
      const { section, command } = cmd(file, heading, 'entrance');
      gated(section, 'entrance');
      const r = run(command);
      assert.equal(r.status, 0);
      const ids = r.json.timeline.map(t => t.id);
      assert.equal(ids.at(-1), 'cards', 'the covered group arrives last');
      const delays = r.json.timeline.map(t => t.delay_ms);
      assert.deepEqual(delays, [...delays].sort((a, b) => a - b));
      assert.ok(r.json.timeline.every(t => t.easing && t.from && t.to));
    });
  }
});

describe('Keyframe track story engine (keyframes)', () => {
  for (const [file, heading] of [[WF.plan, H.build], [WF.marathon, H.mLoop]]) {
    it(`${file} › ${heading}: a story that jumps at the loop seam is caught`, () => {
      const { section, command } = cmd(file, heading, 'keyframes', 'check');
      gated(section, 'keyframes');
      const r = run(command);
      assert.equal(r.status, 0);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.findings[0].rule, 'end-differs-from-start');
    });
  }
  it('w-plan-tdd-swarm › Build: emit prints the shared-clock engine', () => {
    const r = run(cmd(WF.plan, H.build, 'keyframes', 'emit').command);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /one shared loop clock/);
    assert.match(r.stdout, /createLoop/);
  });
});

describe('Deterministic frame capture (frame-capture)', () => {
  for (const [file, heading] of [[WF.plan, H.tests], [WF.perf, H.profiling]]) {
    it(`${file} › ${heading}: frames are stepped on a fake clock, the same every run`, () => {
      const { section, command } = cmd(file, heading, 'frame-capture', 'plan');
      gated(section, 'frame-capture');
      // the capture itself runs where the page exists: in /w-perf the same step, in /w-plan-tdd-swarm at the end of Build
      const where = file === WF.plan ? cmd(WF.plan, H.build, 'frame-capture', 'capture').section : section;
      assert.ok(commands(where, 'frame-capture').some(c => c.includes(' capture --url ')), 'the workflow also says how to capture');
      const a = run(command);
      const b = run(command);
      assert.equal(a.status, 0);
      assert.equal(a.json.frames.length, 60);
      assert.equal(a.json.frames[1].t_ms, 33);
      assert.deepEqual(a.json, b.json, 'the capture plan is repeatable');
    });
  }
});
