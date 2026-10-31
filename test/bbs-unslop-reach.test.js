/**
 * Reach tests for the unslop powers of bbs run 2026-10-30-unslop (integration.md rows).
 *
 * Each test goes in through the surface a user reaches: it reads the installed workflow command file
 * (.claude/commands/.shortcuts/...), finds the step under the heading the row names, cuts out that step's own
 * paragraph and bash block, fills the block's NAME='<...>' placeholders with a small fixture and runs the block's real
 * lines with bash, then checks the power's effect. On that slice alone it also checks the step is gated on the work the
 * row names (UI, landing page, dashboard), carries the kit-missing fallback and says advisory or blocking as the row
 * does. Where one verb feeds another, the fixture is the real producer's output, made by running the producer's own
 * workflow step (slop-audit scan for slop-triage, design-brief assume for direction from-brief).
 *
 * The table ROWS holds one entry per integration.md row; PENDING lists the rows of the second pass (their verbs are
 * still in review). To wire one later, add its fixtures to `before`, move its entry from PENDING to ROWS with a `check`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stepSection } from '../.claude/helpers/bbs/wiring.js';
import { validateFinishLine, evaluateGate } from '../.claude/helpers/marathon/gate.js';
import { readAll } from '../.claude/helpers/marathon/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT = '.claude/helpers/kit/cli.js';
const WF = {
  plan: '.claude/commands/.shortcuts/w-plan-tdd-swarm.md',
  marathon: '.claude/commands/.shortcuts/w-marathon.md'
};
const H = {
  search: '⛔ CHECKPOINT 0: Search',
  interview: '⛔ CHECKPOINT 1: Interview (MANDATORY - NEVER SKIP)',
  plan: '⛔ CHECKPOINT 2: Plan',
  spec: '⛔ CHECKPOINT 3: Spec',
  build: '⛔ CHECKPOINT 5: Build',
  review: '⛔ CHECKPOINT 6: Review',
  mSearch: '⛔ CHECKPOINT 0: Search',
  mInterview: '⛔ CHECKPOINT 1: Interview (HIL — once)',
  mKickoff: '⛔ CHECKPOINT 2: Kickoff (HIL — the last question)',
  mLoop: '⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met',
  mChecklist: 'Completion Checklist'
};

let dir;
const fx = {};
const write = (name, body) => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };
const fresh = (name) => { const p = path.join(dir, name); fs.rmSync(p, { force: true }); return p; };

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unslop-reach-'));
  // a screen full of slop signs, and a clean one
  fx.slopScreen = write('slop.html', [
    '<section class="hero bg-gradient-to-r from-purple-500 to-pink-500">',
    '  <h1>Welcome to the future of invoicing! 🚀</h1>',
    '  <p>Unlock seamless, revolutionary workflows. Trusted by 10,000+ teams.</p>',
    '  <button class="rounded-full shadow-2xl">Get started ✨</button>',
    '</section>', ''].join('\n'));
  fx.cleanScreen = write('clean.html', [
    '<section class="hero">',
    '  <h1>Ledgerly sends the invoice reminder for you</h1>',
    '  <p>Mark a project done and the invoice goes out the same day.</p>',
    '  <a href="/signup">Start a ledger</a>',
    '</section>', ''].join('\n'));
  fx.SCREEN = fx.slopScreen;
  fx.AUDIT = path.join(dir, 'audit.json');
  fx.TRIAGE_STATE = path.join(dir, 'triage.json');
  fx.GRADE = 'heavy';
  fx.CHOICE = 'Go with this direction';
  fx.designBrief = write('design-brief.json', JSON.stringify({ kind: 'landing', answers: { offer: 'Invoice tool for freelancers' } }));
  fx.BRIEF = fx.designBrief;
  fx.DIRECTION = write('direction.md', [
    'Product: Ledgerly, an invoice tool for freelance designers who bill by the project.',
    'Character: patient, exact, a little dry',
    'World: a print shop ledger desk with ruled paper and stamped ink',
    'Moments: the paid stamp on a settled invoice',
    'Signature: a red rubber-stamp PAID mark that lands when a client pays', ''].join('\n'));
  fx.badDirection = write('direction-bad.md', fs.readFileSync(fx.DIRECTION, 'utf-8').replace('patient, exact, a little dry', 'clean and modern'));
  fx.VISUAL_CTX = write('visual-landing.json', JSON.stringify({ screen: 'landing', has_product_ui: true, works_without_visual: true, slot: 'hero' }));
  fx.dashboardCtx = write('visual-dashboard.json', JSON.stringify({ screen: 'dashboard', has_product_ui: true, works_without_visual: true, slot: 'section' }));
  fx.notWorkingCtx = write('visual-unbuilt.json', JSON.stringify({ screen: 'landing', has_product_ui: false, works_without_visual: false, slot: 'hero' }));
  fx.VISUAL_SENTENCE = write('sentence-bad.json', JSON.stringify({ sentence: 'A stunning futuristic glowing blob.' }));
  fx.goodSentence = write('sentence-good.json', JSON.stringify({ sentence: 'A paper ledger with a red PAID stamp on a walnut desk by a window in low evening sun.' }));
  fx.VISUAL_PROMPT = write('visual-prompt.json', JSON.stringify({ sentence: 'A paper ledger with a red PAID stamp on a walnut desk by a window in low evening sun.', style: 'photo', palette: ['#1b1a17', '#f2ead8'], aspect: '16:9' }));
  fx.TOKEN_KIND = 'landing';
  fx.HUE = '30';
  fx.CSS = write('stream.css', '.card{padding:13px;font-weight:700}\n');
  fx.PASSES = path.join(dir, 'passes.json');
  fx.PASS = 'spacing';
  fx.EFFECT = 'duotone';
  fx.PALETTE = '#1b1a17,#f2ead8';
  fx.SELECTOR = 'img.hero';
  fx.PROMPT_FILE = write('prompt.txt', 'A paper ledger with a red PAID stamp on a walnut desk by a window in low evening sun.\n');
  fx.IMG_STATE = path.join(dir, 'image-gate.json');
  fx.IMG_MODEL = 'image-model-a';
  fx.IMG_SIZE = '1600x900';
  fx.IMG_ASSET = 'assets/generated/hero.png';
  fx.SLOT_W = '1600';
  fx.SLOT_H = '900';
  fx.SLOT_RADIUS = '12';
  fx.STORY = write('story.html', '<!doctype html><html><head><meta name="story-duration-ms" content="1000"></head><body><p>Before, then after.</p></body></html>\n');
  fx.VIDEO_OUT = path.join(dir, 'story.mp4');
  const page = (extra, signup = true) => [
    '<section id="hero"><h1>Ledgerly keeps freelance invoices in order</h1>',
    `<p>Ledgerly sends the reminder for you.${extra}</p>${signup ? '<a href="/signup">Start a ledger</a>' : ''}</section>`,
    '<section id="pricing"><h2>Plans for a studio of one</h2><p>Ledgerly costs 9 dollars a month.</p><a href="/pricing">See plans</a></section>', ''].join('\n');
  fx.BEFORE = write('before.html', page(''));
  fx.goodAfter = write('after-good.html', page(' Ledgerly marks the invoice paid when the client pays.'));
  fx.badAfter = write('after-bad.html', page(' Trusted by 10,000 teams.', false));
  fx.AFTER = fx.goodAfter;
  fx.PRODUCT_NAME = 'Ledgerly';
  // a new screen with no before version, made only of sentences that would fit any product
  fx.genericPage = write('new-generic.html', '<h1>The best platform for your workflow</h1><p>Unlock seamless productivity for your team today.</p><p>Powerful tools that help you grow.</p>\n');
  fx.STREAM = 'ui';
  fx.SCREENS = `${fx.slopScreen}\n${fx.cleanScreen}`;
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** The step text under `heading` of the installed workflow file. */
function step(file, heading) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
  const s = stepSection(text, heading);
  assert.ok(s, `${file} has no heading "${heading}"`);
  return s;
}

const runsVerb = (line, verb, prefix) => new RegExp(`node \\.claude/helpers/kit/cli\\.js ${verb}${prefix ? ` ${prefix}` : ''}(?![\\w-])`).test(line);

/**
 * The step's own slice for `verb prefix` under `heading`: the paragraph that leads the bash block that runs it, the
 * block, and the paragraph after it. Returns { text, block (the bash lines), line (the line that runs the command) }.
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
  assert.fail(`${file} › ${heading} has no bash block that runs kit/cli.js ${verb} ${prefix}`);
}

/**
 * Run the step's real bash: the block's placeholder lines (each '<...>' filled with the fixture for its name, the
 * line's own placeholder check kept) and the block line that runs the command, as one bash script from the project
 * root. `over` replaces fixtures for this run.
 */
function run(s, over = {}) {
  const map = { ...fx, ...over };
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  const assigns = s.block.filter(l => /^[A-Za-z_][A-Za-z0-9_]*=(?:'<[^']*>'|\$\()/.test(l)).map(l => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*='<[^']*>'/.test(l)) return l;
    const name = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)[1];
    assert.ok(name in map, `no fixture for ${name} in: ${l}`);
    return l.replace(/^([A-Za-z_][A-Za-z0-9_]*)='<[^']*>'/, `$1=${q(map[name])}`);
  });
  const script = [...assigns, s.line].join('\n');
  assert.match(s.line, new RegExp(`node ${KIT.replace(/[.]/g, '\\.')} `), 'the step runs the installed kit CLI');
  const r = spawnSync('bash', ['-c', script], { cwd: ROOT, encoding: 'utf-8', timeout: 120000 });
  assert.doesNotMatch(r.stderr, /is still the placeholder/, `a filled placeholder did not reach the command: ${r.stderr}`);
  assert.doesNotMatch(r.stdout, /kit not installed/, 'the installed kit runs');
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

/**
 * Run the WHOLE bash block of a slice (every line, as the workflow runs it), each NAME='<...>' placeholder filled
 * from the fixtures except the names in `keep`, which stay unfilled. `cwd` defaults to the project root.
 */
function runBlock(s, over = {}, { cwd = ROOT, keep = [] } = {}) {
  const map = { ...fx, ...over };
  const script = s.block.map(l => l.replace(/^([A-Za-z_][A-Za-z0-9_]*)='<[^']*>'/, (m, name) => {
    if (keep.includes(name)) return m;
    assert.ok(name in map, `no fixture for ${name}`);
    return `${name}=${q(map[name])}`;
  })).join('\n');
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf-8', timeout: 120000 });
  if (!keep.length) assert.doesNotMatch(r.stderr, /is still the placeholder/, `a filled placeholder did not reach the command: ${r.stderr}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The first bash block after the line that contains `marker` in the step under `heading`, with its paragraphs. */
function blockAfter(file, heading, marker) {
  const lines = step(file, heading).split('\n');
  const at = lines.findIndex(l => l.includes(marker));
  assert.ok(at >= 0, `${file} › ${heading} has no "${marker}"`);
  let i = at;
  while (i < lines.length && !/^\s*```bash/.test(lines[i])) i++;
  let j = i + 1;
  while (j < lines.length && !/^\s*```/.test(lines[j])) j++;
  let k = j + 1;
  while (k < lines.length && lines[k].trim() === '') k++;
  let e = k;
  while (e < lines.length && lines[e].trim() !== '') e++;
  return { text: [...lines.slice(at, j + 1), ...lines.slice(k, e)].join('\n'), block: lines.slice(i + 1, j) };
}

/** A scratch project with the suite's helpers (kit and marathon) linked in and one marathon run made by `init`. */
function project({ kit = true } = {}) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'unslop-proj-'));
  fs.mkdirSync(path.join(p, '.claude'));
  if (!kit) return { dir: p, runDir: null };
  // copied, not linked: the CLIs run only when invoked by their real path
  for (const h of ['kit', 'marathon']) fs.cpSync(path.join(ROOT, '.claude/helpers', h), path.join(p, '.claude/helpers', h), { recursive: true });
  const r = spawnSync('node', ['.claude/helpers/marathon/cli.js', 'init', 'reach'], { cwd: p, encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  return { dir: p, runDir: path.join(p, JSON.parse(r.stdout).runDir) };
}

/** The loop's finish-line line for slop, with `<s>` filled. */
const slopLine = (stream) => {
  const t = slice(WF.marathon, H.mLoop, 'slop-audit', 'scan').text;
  const m = t.match(/\{"id": "slop_<s>"[^`]*\}/);
  assert.ok(m, 'the step gives the finish-line line');
  return { raw: m[0], line: JSON.parse(m[0].replace(/<s>/g, stream)) };
};

/** Whether `slop_<stream>` is met by the gate, read from the run's real measurement rows. */
async function slopMet(runDir, stream) {
  const finishLine = { lines: [slopLine(stream).line] };
  const green = Array.from({ length: 5 }, () => ({ kind: 'unit', status: 'green', stream }));
  const measurements = await readAll(runDir, 'measurements');
  return evaluateGate({ finishLine, runs: green, reviews: [], findings: [], helpers: [], measurements, stream })
    .lines.find(l => l.id === `slop_${stream}`).status === 'met';
}

/** Run `verb prefix` from its step under `heading` of `file`. */
const exec = (file, heading, verb, prefix, over) => run(slice(file, heading, verb, prefix), over);

/**
 * On the step's own slice: gated on the row's work (`gate`), carries the kit-missing fallback, and says blocking
 * (title and "Exit 2 stops") or advisory as the row does.
 */
function gated(text, verb, { gate, blocking }) {
  assert.match(text, new RegExp(`cli\\.js ${verb}(?![\\w-])`), `the slice is the ${verb} step`);
  assert.match(text, gate, 'the step is gated on the work the row names');
  assert.match(text, /kit not installed/, 'the block carries the kit-missing fallback');
  assert.match(text, /`\.claude\/helpers\/kit\/cli\.js` is missing, say so in one line/, 'the step says what to do without the kit');
  if (blocking) {
    assert.match(text, /^\*\*[^*]*\(BLOCKING /m, 'the title says BLOCKING');
    assert.match(text, /Exit 2 stops/);
  } else {
    assert.match(text, /^\*\*[^*]*\(advisory/m, 'the title says advisory');
    assert.doesNotMatch(text, /Exit 2 stops/);
  }
}

const UI = /When (?:the task|a stream|the stream) (?:is|builds|built|redesigns|builds or redesigns) (?:UI|a landing page)|When the task is UI, landing page or dashboard/;
const LANDING = /When (?:the task|the stream) (?:is|builds) a landing page/;

// ---------- the checks, one per power, shared by its rows ----------

function triage(file, heading) {
  const scan = slice(file, heading, 'slop-audit', 'scan');
  gated(scan.text, 'slop-triage', { gate: UI, blocking: false });
  assert.match(scan.text, /confirm/);
  assert.match(scan.text, /Only refine, keep the design/);
  // the producer: the step's own scan line writes the audit the grade reads
  const audit = fresh('audit.json');
  assert.equal(run(scan, { SCREEN: fx.slopScreen, AUDIT: audit }).status, 0);
  const heavy = run(slice(file, heading, 'slop-triage', 'grade'), { AUDIT: audit });
  assert.equal(heavy.status, 0);
  assert.equal(heavy.json.grade, 'heavy');
  assert.equal(heavy.json.confirm.required, true);
  assert.ok(heavy.json.confirm.options.includes('Only refine, keep the design'));
  const clean = fresh('audit-clean.json');
  assert.equal(run(scan, { SCREEN: fx.cleanScreen, AUDIT: clean }).status, 0);
  const refine = run(slice(file, heading, 'slop-triage', 'grade'), { AUDIT: clean });
  assert.equal(refine.json.grade, 'refine-only', 'a clean screen gets refinements, never a redesign');
  // the answer: confirm records it and the gate reads it back; "Change the direction" revokes it
  const state = fresh('triage.json');
  const conf = slice(file, heading, 'slop-triage', 'confirm');
  assert.equal(run(slice(file, heading, 'slop-triage', 'gate'), { TRIAGE_STATE: state }).status, 2, 'no answer yet: the gate is closed');
  const yes = run(conf, { TRIAGE_STATE: state, GRADE: 'heavy', CHOICE: 'Only refine, keep the design' });
  assert.equal(yes.status, 0);
  const open = run(slice(file, heading, 'slop-triage', 'gate'), { TRIAGE_STATE: state });
  assert.equal(open.status, 0);
  assert.equal(open.json.grade, 'refine-only', 'refine-only is what the build reads, so no redesign runs');
  assert.equal(run(conf, { TRIAGE_STATE: state, GRADE: 'heavy', CHOICE: 'Change the direction' }).status, 2);
  assert.equal(run(slice(file, heading, 'slop-triage', 'gate'), { TRIAGE_STATE: state }).status, 2, 'a changed direction revokes the yes');
}

function direction(file, heading) {
  const t = slice(file, heading, 'direction', 'template');
  gated(t.text, 'direction', { gate: UI, blocking: false });
  assert.match(t.text, /product[^.]*character[^.]*world[^.]*moments[^.]*signature/i, 'the five lines are named');
  const tpl = run(t);
  assert.equal(tpl.status, 0);
  assert.deepEqual(tpl.json.fields.map(f => f.id), ['product', 'character', 'world', 'moments', 'signature']);
  // the producer: design-brief assume, run from this workflow's own Interview step
  const briefAt = file === WF.plan ? H.interview : H.mInterview;
  const assumed = run(slice(file, briefAt, 'design-brief', 'assume'), { BRIEF: fx.designBrief });
  assert.equal(assumed.status, 0);
  const brief = write('assumed-brief.json', assumed.stdout);
  const pre = run(slice(file, heading, 'direction', 'from-brief'), { BRIEF: brief });
  assert.equal(pre.status, 0);
  assert.ok(pre.json.prefilled.includes('product'), 'product is prefilled from the brief');
  assert.ok(pre.json.fields.filter(f => f.id !== 'product').every(f => f.todo), 'the other four are asked');
  const c = slice(file, heading, 'direction', 'check');
  const good = run(c, { DIRECTION: fx.DIRECTION });
  assert.equal(good.status, 0);
  assert.equal(good.json.ok, true);
  const bad = run(c, { DIRECTION: fx.badDirection });
  assert.equal(bad.status, 0, 'advisory: a weak direction never stops the flow');
  assert.equal(bad.json.ok, false);
  assert.ok(bad.json.problems.some(p => p.field === 'character' && p.code === 'banned_word'));
}

function visual(file, heading) {
  const d = slice(file, heading, 'visual-direction', 'decide');
  gated(d.text, 'visual-direction', { gate: LANDING, blocking: false });
  assert.match(d.text, /dashboards?/, 'dashboards are named as advisory or skipped');
  const landing = run(d, { VISUAL_CTX: fx.VISUAL_CTX });
  assert.equal(landing.status, 0);
  assert.deepEqual([landing.json.needed, landing.json.kind], [true, 'product-shot']);
  assert.equal(run(d, { VISUAL_CTX: fx.dashboardCtx }).json.needed, false, 'a dashboard gets no visual');
  assert.equal(run(d, { VISUAL_CTX: fx.notWorkingCtx }).json.needed, false, 'a screen that does not work without it yet gets none');
  if (file === WF.plan) {
    // Plan: the visual is one plain sentence, written before any generation
    const s = slice(file, heading, 'visual-direction', 'sentence');
    assert.match(s.text, /one plain sentence/);
    assert.match(s.text, /No image is generated in the plan/);
    const bad = run(s, { VISUAL_SENTENCE: fx.VISUAL_SENTENCE });
    assert.equal(bad.status, 0);
    assert.equal(bad.json.ok, false);
    assert.ok(bad.json.problems.some(p => p.id === 'banned-words'));
    assert.equal(run(s, { VISUAL_SENTENCE: fx.goodSentence }).json.ok, true);
  } else {
    // Loop: the prompt recipe, only after the screen works without the visual
    assert.match(d.text, /only after the screen works without it/);
    const p = run(slice(file, heading, 'visual-direction', 'prompt'));
    assert.equal(p.status, 0);
    assert.match(p.json.prompt, /paper ledger/);
    assert.deepEqual(p.json.size, { w: 1600, h: 900 });
    assert.ok(p.json.negative.includes('text'));
  }
}

function tokens(file, heading) {
  const e = slice(file, heading, 'design-tokens', 'emit');
  gated(e.text, 'design-tokens', { gate: UI, blocking: false });
  assert.match(e.text, /no design system of its own/, 'the sheet is used only when the project has none');
  const r = run(e);
  assert.equal(r.status, 0);
  assert.equal(r.json.kind, 'landing');
  assert.equal(r.json.hue, 30);
  assert.match(r.json.css, /--space-1: 4px/);
  assert.ok(r.json.contrast.primary >= 4.5 && r.json.contrast.secondary >= 4.5);
  if (file === WF.marathon) {
    const c = run(slice(file, heading, 'design-tokens', 'check'));
    assert.equal(c.status, 0, 'advisory: issues never stop the loop');
    assert.equal(c.json.ok, false);
    assert.deepEqual(c.json.issues.map(i => i.code), ['OFF_GRID_SPACING', 'HEAVY_WEIGHT']);
  }
}

function redline(file, heading) {
  const n = slice(file, heading, 'redline-passes', 'next');
  gated(n.text, 'redline-passes', { gate: UI, blocking: false });
  const plan = run(slice(file, heading, 'redline-passes', 'plan'));
  assert.deepEqual(plan.json.passes.map(p => p.id), ['spacing', 'color', 'icons', 'copy', 'type', 'layout', 'details', 'visuals', 'motion']);
  const state = fresh('passes.json');
  assert.equal(run(n, { PASSES: state }).json.next.id, 'spacing', 'the first pass is spacing');
  const m = slice(file, heading, 'redline-passes', 'mark');
  const marked = run(m, { PASSES: state, PASS: 'spacing' });
  assert.equal(marked.status, 0);
  assert.equal(marked.json.next, 'color');
  assert.equal(run(n, { PASSES: state }).json.next.id, 'color', 'the order holds across runs');
  const skip = run(m, { PASSES: state, PASS: 'icons' });
  assert.equal(skip.status, 2, 'a pass out of order is refused');
  assert.deepEqual(JSON.parse(fs.readFileSync(state, 'utf-8')).done, ['spacing'], 'and the file is left as it was');
  if (file === WF.marathon) assert.match(n.text, /one ordered pass per loop iteration, from spacing to motion/);
  else assert.match(n.text, /finishing each one across the whole screen before the next starts/);
}

function effects(file, heading) {
  const e = slice(file, heading, 'image-effects', 'emit');
  gated(e.text, 'image-effects', { gate: LANDING, blocking: false });
  assert.match(e.text, /hero image/);
  assert.match(e.text, /main visual only/);
  assert.equal(run(slice(file, heading, 'image-effects', 'list')).status, 0);
  const c = run(slice(file, heading, 'image-effects', 'check'));
  assert.equal(c.status, 0);
  assert.equal(c.json.ok, true);
  assert.ok(c.json.contrast > 3);
  const r = run(e);
  assert.equal(r.status, 0);
  assert.equal(r.json.kind, 'duotone');
  assert.match(r.json.html, /<filter/);
  assert.match(r.json.css, /^img\.hero\{filter:url\(#/);
}

function imageGate(file, heading) {
  const req = slice(file, heading, 'image-gate', 'request');
  const check = slice(file, heading, 'image-gate', 'check');
  // the request slice says when and why; the check slice holds the stop
  gated(`${req.text}\n${check.text}`, 'image-gate', { gate: UI, blocking: true });
  assert.match(req.text, /No image service may be called until `image-gate check` exits 0/);
  assert.match(req.text, /call no image tool before a yes/, 'without the kit the yes is still asked');
  const all = step(file, heading);
  assert.match(all, file === WF.plan ? /Declined means an empty slot plus the prompt in the report/ : /Declined means an empty slot, not a stalled loop/);
  assert.match(check.text, /\*\*Exit 2 stops: do not call the image tool\.\*\*/);
  // without the kit, the check line still says no
  assert.match(check.line, /^if \[ ! -f \.claude\/helpers\/kit\/cli\.js \]; then echo "kit not installed[^"]*call no image tool before a yes"; \(exit 2\);/);
  const state = fresh('image-gate.json');
  const asked = run(req, { IMG_STATE: state });
  assert.equal(asked.status, 0);
  assert.equal(asked.json.status, 'pending');
  assert.match(asked.json.question, /Model: image-model-a\nSize: 1600x900/);
  const id = asked.json.id;
  assert.equal(run(check, { IMG_STATE: state }).status, 2, 'no yes yet: the image tool is not called');
  assert.match(check.text, /Without the kit the exit 2 means no recorded approval: ask the yes\/no in plain words[^.]*; on a yes the call may go ahead, on a no leave the slot empty\./, 'the no-kit exit 2 and the text agree');
  if (file === WF.marathon) {
    // no question mid-loop: the request is queued, the slot goes in, the loop goes on
    const gateText = all.slice(all.indexOf('**🛑 Image generation gate'), all.indexOf('Put each `report` row', all.indexOf('**🛑 Image generation gate')));
    assert.ok(gateText.length > 1000, 'the image gate part of the step');
    assert.doesNotMatch(gateText, /AskUserQuestion/);
    assert.doesNotMatch(gateText, /wait for the answer|and wait\b/);
    assert.match(req.text, /Never ask it in the middle of the loop and never wait for it/);
    assert.match(req.text, /`checklist\.md` as a human job/);
    assert.match(req.text, /collected only at the run's existing human-in-the-loop points: the once-only Interview[^.]* or the end-of-run report and handoff/);
    assert.match(req.text, /Only after the owner's yes is recorded with `approve` may a later loop pass run `check` and, after `check` exits 0, call the image service/);
    const pendingSlot = slice(file, heading, 'image-gate', 'slot');
    assert.match(pendingSlot.text, /While the request is pending/);
    assert.doesNotMatch(pendingSlot.block.join('\n'), /image-gate decline/, 'the pending slot is placed without a decline');
    const placed = run(pendingSlot);
    assert.equal(placed.status, 0);
    assert.equal(placed.json.html, '<div class="img-slot" aria-hidden="true"></div>');
    const queued = run(slice(file, heading, 'image-gate', 'report'), { IMG_STATE: state });
    assert.deepEqual(queued.json.requests.map(r => r.status), ['pending'], 'the pending request is in the end-of-run report');
    assert.match(check.text, /pending \(still queued: keep the slot and go on; never ask mid-loop\)/);
  }
  assert.equal(run(slice(file, heading, 'image-gate', 'approve'), { IMG_STATE: state, IMG_ID: id }).status, 0);
  assert.equal(run(check, { IMG_STATE: state, IMG_MODEL: 'image-model-b' }).status, 2, 'a changed model needs its own yes');
  const claimed = run(check, { IMG_STATE: state });
  assert.equal(claimed.status, 0);
  assert.deepEqual([claimed.json.show.prompt, claimed.json.show.model, claimed.json.show.size], [fs.readFileSync(fx.PROMPT_FILE, 'utf-8').trim(), 'image-model-a', '1600x900']);
  assert.equal(run(check, { IMG_STATE: state }).status, 2, 'one yes is one call');
  assert.equal(run(slice(file, heading, 'image-gate', 'release'), { IMG_STATE: state, IMG_ID: id }).status, 0, 'a failed call is released once');
  assert.equal(run(check, { IMG_STATE: state }).status, 0);
  assert.equal(run(slice(file, heading, 'image-gate', 'used'), { IMG_STATE: state, IMG_ID: id }).status, 0);
  // declined: an empty slot, and the prompt in the report
  const state2 = fresh('image-gate-2.json');
  const id2 = run(req, { IMG_STATE: state2 }).json.id;
  assert.equal(run(slice(file, heading, 'image-gate', 'decline'), { IMG_STATE: state2, IMG_ID: id2 }).status, 0);
  assert.equal(run(check, { IMG_STATE: state2 }).status, 2, 'declined: the image tool is never called');
  const slot = run(slice(file, heading, 'image-gate', 'slot'), { IMG_STATE: state2, IMG_ID: id2 });
  assert.equal(slot.status, 0);
  assert.equal(slot.json.html, '<div class="img-slot" aria-hidden="true"></div>');
  assert.match(slot.json.css, /width:1600px;height:900px;border-radius:12px/);
  const rep = run(slice(file, heading, 'image-gate', 'report'), { IMG_STATE: state2 });
  assert.equal(rep.status, 0);
  assert.equal(rep.json.requests[0].status, 'declined');
  assert.match(rep.json.requests[0].prompt, /paper ledger/);
}

function storyRender(file, heading) {
  const p = slice(file, heading, 'story-render', 'plan');
  gated(p.text, 'story-render', { gate: /When the user asks for a before-and-after video of a UI redesign/, blocking: false });
  assert.match(p.text, /advisory and optional/);
  const plan = run(p);
  assert.equal(plan.status, 0);
  assert.deepEqual([plan.json.frames, plan.json.size.w, plan.json.size.h], [30, 1080, 1080]);
  const out = fresh('story.mp4');
  const r = run(slice(file, heading, 'story-render', 'render'), { VIDEO_OUT: out });
  if (r.status === 4) {
    // ffmpeg or playwright missing: the step says so and the build goes on
    assert.equal(r.json.out, null);
    assert.match(r.json.reason, /ffmpeg|playwright/);
    assert.match(p.text, /Exit 4 means ffmpeg with libx264 or playwright is not installed/);
  } else {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.out, out);
    assert.ok(fs.statSync(out).size > 0, 'an MP4 was written');
  }
  const play = run(slice(file, heading, 'story-render', 'play'));
  assert.match(play.json.play_url, /^file:\/\/.*\?play=1$/);
}

async function slopAudit(file, heading) {
  const s = slice(file, heading, 'slop-audit', 'scan');
  gated(s.text, 'slop-audit', { gate: UI, blocking: true });
  if (file === WF.marathon) return slopPass(s);
  assert.match(s.line, /slop-audit scan --strict --file "\$SCREEN"; RC=\$\?; \(exit \$RC\); fi$/, 'the guard keeps the exit status, so the step really stops');
  assert.match(s.text, /manual/);
  const bad = run(s, { SCREEN: fx.slopScreen });
  assert.equal(bad.status, 2, 'unresolved signs stop');
  assert.ok(bad.json.total >= 4);
  assert.ok(bad.json.hits.every(h => h.fix && h.line), 'one line per sign with its fix');
  const good = run(s, { SCREEN: fx.cleanScreen });
  assert.equal(good.status, 0);
  assert.equal(good.json.total, 0);
  assert.equal(run(slice(file, heading, 'slop-audit', 'signs')).status, 0);
}

/**
 * /mt: one block scans every changed screen file and records ONE slop_<s> measure for the pass, false when any file
 * has unresolved signs, so a clean file scanned after a dirty one can never meet the gate.
 */
async function slopPass(s) {
  assert.match(s.text, /manual/);
  assert.match(s.text, /every changed screen file of the stream/);
  assert.match(s.text, /Never scan the files one by one with separate records/);
  assert.match(s.line, /while IFS= read -r SCREEN; do .*slop-audit scan --strict --file "\$SCREEN"; .*done <<< "\$SCREENS"/, 'every file in one run');
  assert.equal((s.block.join('\n').match(/record measure/g) || []).length, 1, 'one record per pass');
  const { dir, runDir } = project();
  try {
    const last = async () => (await readAll(runDir, 'measurements')).filter(m => m.key === 'slop_ui').at(-1);
    // a dirty file, then a clean one
    const mixed = runBlock(s, { SCREENS: `${fx.slopScreen}\n${fx.cleanScreen}` }, { cwd: dir });
    assert.equal(mixed.status, 2, 'one dirty file stops the pass');
    assert.match(mixed.stdout, /2 file\(s\) scanned, worst exit 2, recorded slop_ui=false/);
    assert.equal((await last()).value, false);
    assert.equal(await slopMet(runDir, 'ui'), false, 'a dirty file then a clean file leaves the gate unmet');
    // the other order
    assert.equal(runBlock(s, { SCREENS: `${fx.cleanScreen}\n${fx.slopScreen}` }, { cwd: dir }).status, 2);
    assert.equal(await slopMet(runDir, 'ui'), false);
    // every file clean: met
    const clean2 = write('clean2.html', fs.readFileSync(fx.cleanScreen, 'utf-8'));
    const ok = runBlock(s, { SCREENS: `${fx.cleanScreen}\n${clean2}\n` }, { cwd: dir });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal((await last()).value, true);
    assert.equal(await slopMet(runDir, 'ui'), true, 'a whole clean pass meets the gate');
    // a later pass with a dirty file takes it back
    assert.equal(runBlock(s, { SCREENS: `${fx.cleanScreen}\n${fx.slopScreen}` }, { cwd: dir }).status, 2);
    assert.equal(await slopMet(runDir, 'ui'), false);
    // wrong input records false, never a stale true
    runBlock(s, { SCREENS: fx.cleanScreen }, { cwd: dir });
    const empty = write('empty.html', '');
    assert.equal(runBlock(s, { SCREENS: `${fx.cleanScreen}\n${empty}` }, { cwd: dir }).status, 1);
    assert.equal(await slopMet(runDir, 'ui'), false, 'an unreadable file is never read as a pass');
    // an unfilled placeholder records nothing
    const before = (await readAll(runDir, 'measurements')).length;
    const unfilled = runBlock(s, {}, { cwd: dir, keep: ['STREAM'] });
    assert.equal(unfilled.status, 1);
    assert.match(unfilled.stderr, /slop audit refused/);
    assert.equal((await readAll(runDir, 'measurements')).length, before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function checklist(file, heading, { blocking }) {
  const c = slice(file, heading, 'redesign-checklist', 'check');
  gated(c.text, 'redesign-checklist', { gate: UI, blocking });
  assert.match(c.text, /do-not/);
  assert.match(c.text, /template test|template-fit test/);
  assert.match(c.text, /swap-the-product-name/);
  if (blocking) assert.match(c.line, /--strict"?; RC=\$\?; \(exit \$RC\); fi$/);
  else assert.doesNotMatch(c.line, /--strict/);
  const list = run(slice(file, heading, 'redesign-checklist', 'list'));
  assert.equal(list.status, 0);
  assert.ok(list.json.do_not.length && list.json.checklist.length && list.json.template_test.how);
  const good = run(c, { AFTER: fx.goodAfter });
  assert.equal(good.status, 0, good.stdout);
  assert.equal(good.json.pass, true);
  const bad = run(c, { AFTER: fx.badAfter });
  assert.equal(bad.status, blocking ? 2 : 0, blocking ? 'a failed check stops the review' : 'advisory: the run goes on');
  assert.equal(bad.json.pass, false);
  assert.deepEqual(bad.json.violations.map(v => v.rule).sort(), ['invented-data', 'link-removed']);
  if (file === WF.plan) {
    // a new screen with no before version: template-test has no --strict, so the block reads pass itself
    const t = slice(file, heading, 'redesign-checklist', 'template-test');
    assert.doesNotMatch(t.line, /--strict/);
    assert.match(t.text, /`pass: false` stops the review exactly like exit 2/);
    assert.match(t.text, /\*\*Exit 2 stops the review/);
    assert.match(c.text, /run the second block instead/);
    const generic = run(t, { AFTER: fx.genericPage });
    assert.equal(generic.json.pass, false);
    assert.equal(generic.status, 2, 'a failed template test on a new screen stops the review');
    const fine = run(t, { AFTER: fx.goodAfter });
    assert.equal(fine.json.pass, true);
    assert.equal(fine.status, 0);
  }
}

// ---------- the rows of integration.md wired in this pass ----------
const ROWS = [
  { power: 'unslop slop audit', file: WF.plan, heading: H.review, mode: 'blocking', check: slopAudit },
  { power: 'unslop slop audit', file: WF.marathon, heading: H.mLoop, mode: 'blocking', check: slopAudit },
  { power: 'unslop direction brief', file: WF.plan, heading: H.plan, mode: 'advisory', check: direction },
  { power: 'unslop direction brief', file: WF.marathon, heading: H.mInterview, mode: 'advisory', check: direction },
  { power: 'unslop triage and refine-only gate', file: WF.plan, heading: H.interview, mode: 'advisory', check: triage },
  { power: 'unslop triage and refine-only gate', file: WF.marathon, heading: H.mKickoff, mode: 'advisory', check: triage },
  { power: 'unslop ordered redline passes', file: WF.plan, heading: H.build, mode: 'advisory', check: redline },
  { power: 'unslop ordered redline passes', file: WF.marathon, heading: H.mLoop, mode: 'advisory', check: redline },
  { power: 'unslop design tokens', file: WF.plan, heading: H.spec, mode: 'advisory', check: tokens },
  { power: 'unslop design tokens', file: WF.marathon, heading: H.mLoop, mode: 'advisory', check: tokens },
  { power: 'unslop glyph and duotone effects', file: WF.plan, heading: H.build, mode: 'advisory', check: effects },
  { power: 'unslop glyph and duotone effects', file: WF.marathon, heading: H.mLoop, mode: 'advisory', check: effects },
  { power: 'unslop visual direction', file: WF.plan, heading: H.plan, mode: 'advisory', check: visual },
  { power: 'unslop visual direction', file: WF.marathon, heading: H.mLoop, mode: 'advisory', check: visual },
  { power: 'unslop image generation gate', file: WF.plan, heading: H.build, mode: 'blocking', check: imageGate },
  { power: 'unslop image generation gate', file: WF.marathon, heading: H.mLoop, mode: 'blocking', check: imageGate },
  { power: 'unslop story video renderer', file: WF.plan, heading: H.build, mode: 'advisory', check: storyRender },
  { power: 'unslop do-not list and final checklist', file: WF.plan, heading: H.review, mode: 'blocking', check: (f, h) => checklist(f, h, { blocking: true }) },
  { power: 'unslop do-not list and final checklist', file: WF.marathon, heading: H.mChecklist, mode: 'advisory', check: (f, h) => checklist(f, h, { blocking: false }) }
];

// ---------- second pass: verbs still in review (add fixtures and a check, then move the entry to ROWS) ----------
const PENDING = [
  { power: 'unslop live page snapshot', verb: 'page-snapshot', file: WF.plan, heading: H.search, mode: 'advisory' },
  { power: 'unslop live page snapshot', verb: 'page-snapshot', file: WF.marathon, heading: H.mSearch, mode: 'advisory' },
  { power: 'unslop story video authoring', verb: 'story-plan', file: WF.plan, heading: H.spec, mode: 'advisory' },
  { power: 'unslop story video authoring', verb: 'story-plan', file: WF.marathon, heading: H.mLoop, mode: 'advisory' }
];

const short = (f) => path.basename(f, '.md');
for (const power of [...new Set(ROWS.map(r => r.power))]) {
  describe(power, () => {
    for (const row of ROWS.filter(r => r.power === power)) {
      it(`${short(row.file)} › ${row.heading} (${row.mode})`, () => row.check(row.file, row.heading));
    }
  });
}
describe('second pass (not wired yet)', () => {
  for (const row of PENDING) it.todo(`${row.power}: ${short(row.file)} › ${row.heading} (${row.mode}) runs ${row.verb}`);
});

describe('slop audit gate in /w-marathon', () => {
  it('unresolved signs keep the scripted stream gate unmet however many green test runs follow', async () => {
    const t = slice(WF.marathon, H.mLoop, 'slop-audit', 'scan').text;
    assert.match(t, /record measure key=slop_<s> value=false/);
    assert.match(t, /record measure key=slop_<s> value=true/);
    const m = t.match(/\{"id": "slop_<s>"[^`]*\}/);
    assert.ok(m, 'the step gives the finish-line line');
    const line = JSON.parse(m[0].replace(/<s>/g, 'ui'));
    const finishLine = { lines: [line] };
    assert.deepEqual(validateFinishLine(finishLine), []);
    const green = Array.from({ length: 5 }, () => ({ kind: 'unit', status: 'green', stream: 'ui' }));
    const met = (measurements) => evaluateGate({ finishLine, runs: green, reviews: [], findings: [], helpers: [], measurements, stream: 'ui' })
      .lines.find(l => l.id === 'slop_ui').status === 'met';
    assert.equal(met([{ key: 'slop_ui', value: false }]), false);
    // a stream with a dirty file and a clean file, through the real block: the gate stays unmet
    const { dir, runDir } = project();
    try {
      const s = slice(WF.marathon, H.mLoop, 'slop-audit', 'scan');
      assert.equal(runBlock(s, { SCREENS: `${fx.slopScreen}\n${fx.cleanScreen}` }, { cwd: dir }).status, 2);
      assert.equal(await slopMet(runDir, 'ui'), false, 'a clean file scanned after a dirty one never meets the gate');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    const interview = step(WF.marathon, H.mInterview);
    assert.ok(interview.includes(m[0]), 'the Interview adds the same line for UI streams');
  });

  it('the Interview adds the slop_<s> line only when the kit is installed', () => {
    const b = blockAfter(WF.marathon, H.mInterview, '**🧹 Slop finish line');
    assert.match(b.text, /only when the kit is installed/);
    assert.match(b.block.join('\n'), /^if \[ ! -f \.claude\/helpers\/kit\/cli\.js \]; then echo "kit not installed/m);
    // with the kit: the printed line is the loop's line for this stream, and it is a valid finish-line line
    const withKit = runBlock(b, { STREAM: 'ui' });
    assert.equal(withKit.status, 0, withKit.stderr);
    const line = JSON.parse(withKit.stdout.trim());
    assert.deepEqual(line, slopLine('ui').line);
    assert.deepEqual(validateFinishLine({ lines: [line] }), []);
    // without the kit: no line, and it says so
    const { dir } = project({ kit: false });
    try {
      const noKit = runBlock(b, { STREAM: 'ui' }, { cwd: dir });
      assert.equal(noKit.status, 0);
      assert.match(noKit.stdout, /^kit not installed[^\n]*no slop_ui finish line added/);
      assert.doesNotMatch(noKit.stdout, /\{"id"/, 'no slop line is printed, so the gate never waits on a measure no step records');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    // an unfilled name is refused, never printed as slop_<...>
    const unfilled = runBlock(b, {}, { keep: ['STREAM'] });
    assert.equal(unfilled.status, 1);
    assert.doesNotMatch(unfilled.stdout, /slop_</);
  });
});

describe('triage scan with an unfilled AUDIT', () => {
  for (const [file, heading] of [[WF.plan, H.interview], [WF.marathon, H.mKickoff]]) {
    it(`${short(file)}: refuses to write a file named after the placeholder`, () => {
      const s = slice(file, heading, 'slop-audit', 'scan');
      const { dir } = project();
      try {
        const r = runBlock(s, { SCREEN: fx.slopScreen }, { cwd: dir, keep: ['AUDIT'] });
        assert.match(r.stderr, /scan refused: AUDIT is still the placeholder/);
        assert.match(r.stderr, /grade refused: AUDIT is still the placeholder/);
        assert.notEqual(r.status, 0);
        assert.deepEqual(fs.readdirSync(dir).filter(n => n.startsWith('<')), [], 'no stray file named after the placeholder');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

describe('without the kit', () => {
  const VERBS = ['slop-audit', 'direction', 'slop-triage', 'redline-passes', 'design-tokens', 'image-effects', 'visual-direction', 'image-gate', 'story-render', 'redesign-checklist'];
  const blocks = (file) => {
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf-8').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^```bash/.test(lines[i])) continue;
      let j = i + 1;
      while (j < lines.length && !/^```/.test(lines[j])) j++;
      const block = lines.slice(i + 1, j);
      if (block.some(l => VERBS.some(v => runsVerb(l, v)))) out.push(block);
      i = j;
    }
    return out;
  };
  for (const file of [WF.plan, WF.marathon]) {
    it(`${short(file)}: every unslop block runs whole in a project with no kit, says so, and only the image check says no`, () => {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'unslop-nokit-'));
      try {
        const all = blocks(file);
        assert.ok(all.length >= (file === WF.plan ? 20 : 19), `found ${all.length} blocks`);
        for (const block of all) {
          const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
          const script = block.map(l => l.replace(/^([A-Za-z_][A-Za-z0-9_]*)='<[^']*>'/, (m, name) => `${name}=${q(fx[name] ?? 'x')}`)).join('\n');
          const r = spawnSync('bash', ['-c', script], { cwd: empty, encoding: 'utf-8' });
          const kitLines = block.filter(l => /cli\.js/.test(l) && /^if /.test(l)).length;
          assert.equal((r.stdout.match(/^kit not installed/gm) || []).length, kitLines, `each kit line says the kit is missing:\n${script}`);
          const isCheck = block.some(l => runsVerb(l, 'image-gate', 'check'));
          assert.equal(r.status, isCheck ? 2 : 0, `exit ${r.status} for:\n${script}\n${r.stderr}`);
        }
      } finally { fs.rmSync(empty, { recursive: true, force: true }); }
    });
  }
});

describe('source and installed copies', () => {
  it('the installed command files are the plugin source, byte for byte', async () => {
    const { getCommands } = await import('../src/plugins/dot-shortcuts.js');
    const c = getCommands();
    for (const [name, file] of [['w-plan-tdd-swarm', WF.plan], ['w-marathon', WF.marathon]]) {
      assert.equal(fs.readFileSync(path.join(ROOT, file), 'utf-8'), c[name].content, `${file} drifted from src/plugins/dot-shortcuts.js`);
    }
  });
});
