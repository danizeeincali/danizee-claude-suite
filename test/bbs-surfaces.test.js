/**
 * Contract for src/lib/bbs/surfaces.js, the `cli.js surfaces` verb and the surface half of targets.js:
 * the places in the owner's project where a user meets a feature are found in the code, and a power lands on one.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { detect, fileRoute, manifestSurfaces, scanSurfaces, ownerSurface, recordSurfaces } from '../src/lib/bbs/surfaces.js';
import { recordTargets, setOwnerTargets, standingTargets, noLandingWhy, targetLabel, landsIn, OWNER_HOW, OWNER_REACH } from '../src/lib/bbs/targets.js';
import { writeJson, readJson } from '../src/lib/bbs/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const APP = path.join(ROOT, 'test', 'fixtures', 'bbs-app');
const CLI = path.join(ROOT, 'src', 'lib', 'bbs', 'cli.js');
const now = () => new Date('2026-10-10T12:00:00.000Z');
const RUN = '2026-10-10-surf';

const only = (file, text) => detect(file, text);
const kinds = (file, text) => detect(file, text).map(s => s.kind);

/** A temp copy of the sample app, a git repo (nothing committed), with a run folder for RUN. */
async function appCopy(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.cp(APP, dir, { recursive: true });
  spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  return dir;
}

describe('surfaces — detect', () => {
  it('Next app and pages routes are ui pages with the route as the anchor; route handlers and pages/api are api', () => {
    assert.deepEqual(only('app/settings/page.tsx', 'x'), [{ kind: 'ui', anchors: ['/settings'], evidence: 'file-system page' }]);
    assert.deepEqual(only('pages/about.js', 'x'), [{ kind: 'ui', anchors: ['/about'], evidence: 'file-system page' }]);
    assert.deepEqual(only('app/api/scan/route.ts', 'x'), [{ kind: 'api', anchors: ['/api/scan'], evidence: 'file-system route handler' }]);
    assert.deepEqual(only('pages/api/users.js', 'x'), [{ kind: 'api', anchors: ['/api/users'], evidence: 'file-system route handler' }]);
  });

  it('SvelteKit +page is ui and +server is api', () => {
    assert.deepEqual(only('src/routes/dash/+page.svelte', 'x'), [{ kind: 'ui', anchors: ['/dash'], evidence: 'file-system page' }]);
    assert.deepEqual(only('src/routes/api/x/+server.js', 'x'), [{ kind: 'api', anchors: ['/api/x'], evidence: 'file-system route handler' }]);
  });

  it('<Route path> elements are client-router ui anchors', () => {
    assert.deepEqual(only('src/App.jsx', '<Route path="/home" element={<A/>} />\n<Route path=\'/about\' />'), [{ kind: 'ui', anchors: ['/home', '/about'], evidence: 'client router' }]);
  });

  it('express, fastify and router calls are api endpoints', () => {
    assert.deepEqual(only('server.js', "app.get('/a', h); fastify.post('/b', h); router.delete(`/c`, h)"), [{ kind: 'api', anchors: ['/a', '/b', '/c'], evidence: 'HTTP router' }]);
  });

  it('FastAPI and Flask decorators are api endpoints', () => {
    assert.deepEqual(only('main.py', "@app.get('/items')\n@bp.route('/x')\n@router.post('/y')"), [{ kind: 'api', anchors: ['/items', '/y', '/x'], evidence: 'HTTP router' }]);
  });

  it('Django urls.py path() and re_path() are api endpoints, with a leading slash', () => {
    assert.deepEqual(only('shop/urls.py', "urlpatterns = [path('cart/', v), re_path(r'^old/$', v)]"), [{ kind: 'api', anchors: ['/cart/', '/old/$'], evidence: 'Django urls' }]);
    assert.deepEqual(kinds('shop/views.py', "urlpatterns = [path('cart/', v)]"), [], 'only urls.py is read as Django urls');
  });

  it('cron schedules, queue workers and celery tasks are jobs', () => {
    assert.deepEqual(only('jobs/a.js', "cron.schedule('* * * * *', f); new Worker('emails', fn); q.process('resize', f)"), [{ kind: 'job', anchors: ['* * * * *', 'emails', 'resize'], evidence: 'scheduler or queue worker' }]);
    assert.deepEqual(only('tasks.py', '@shared_task\ndef send_mail():\n  pass\n@app.task(bind=True)\nasync def other():\n pass'), [{ kind: 'job', anchors: ['send_mail', 'other'], evidence: 'scheduler or queue worker' }]);
  });

  it('LLM calls are model surfaces, anchored by the names of the functions in the file', () => {
    assert.deepEqual(only('lib/llm.ts', 'export async function ask(){ await client.messages.create({}) }\nexport function other(){}'), [{ kind: 'model', anchors: ['ask', 'other'], evidence: 'model or LLM call' }]);
    assert.deepEqual(only('lib/p.py', 'def run():\n  model.fit(x)'), [{ kind: 'model', anchors: ['run'], evidence: 'model or LLM call' }]);
  });

  it('files under prompts/ are model surfaces named by the file', () => {
    assert.deepEqual(only('prompts/triage.md', 'be kind'), [{ kind: 'model', anchors: ['triage.md'], evidence: 'prompt or pipeline file' }]);
  });

  it('commander, argparse and click commands are cli surfaces', () => {
    assert.deepEqual(only('cli.js', "program.command('init').command(\"build:all\"); parser.add_parser('serve')"), [{ kind: 'cli', anchors: ['init', 'build:all', 'serve'], evidence: 'subcommand parser' }]);
    assert.deepEqual(only('cli.py', "@click.command('sync')\ndef s(): pass"), [{ kind: 'cli', anchors: ['sync'], evidence: 'subcommand parser' }]);
  });

  it('isEnabled / useFlag calls and a flags registry are feature surfaces', () => {
    assert.deepEqual(only('a.js', "if (isEnabled('new-ui')) {}; useFlag('dark')"), [{ kind: 'feature', anchors: ['new-ui', 'dark'], evidence: 'feature flag check' }]);
    assert.deepEqual(only('config/flags.json', '{"a":1,"b":2}'), [{ kind: 'feature', anchors: ['a', 'b'], evidence: 'flag registry' }]);
    assert.deepEqual(only('flags.yaml', 'a: true\nb: false'), [{ kind: 'feature', anchors: ['a', 'b'], evidence: 'flag registry' }]);
  });

  it('.github/workflows files are jobs, anchored by their job ids and the file name', () => {
    assert.deepEqual(only('.github/workflows/ci.yml', 'name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu\n  test:\n    runs-on: x\n'), [{ kind: 'job', anchors: ['build', 'test', 'ci.yml'], evidence: 'CI workflow' }]);
  });

  it('test files, specs, fixtures and test folders are never surfaces', () => {
    const text = "app.get('/a', h); cron.schedule('* * * * *', f); isEnabled('x')";
    for (const f of ['app/api/x/route.test.js', 'test/a.js', 'tests/a.js', 'src/a.spec.ts', '__tests__/a.js', 'e2e/a.js', 'fixtures/b.js', 'tests/test_x.py', 'x_test.py']) {
      assert.deepEqual(detect(f, text), [], f);
    }
    assert.deepEqual(detect('app/settings/page.test.tsx', 'x'), []);
  });
});

describe('surfaces — fileRoute', () => {
  it('maps a file to the route the file-system router serves', () => {
    assert.equal(fileRoute('app/page.tsx'), '/');
    assert.equal(fileRoute('app/cart/page.tsx'), '/cart');
    assert.equal(fileRoute('src/app/api/x/route.ts'), '/api/x');
    assert.equal(fileRoute('app/users/[id]/page.js'), '/users/[id]');
    assert.equal(fileRoute('pages/index.js'), '/');
    assert.equal(fileRoute('pages/blog/index.tsx'), '/blog');
    assert.equal(fileRoute('pages/about.js'), '/about');
    assert.equal(fileRoute('src/routes/dash/+page.svelte'), '/dash');
  });

  it('drops route groups (x), keeps the rest of the path', () => {
    assert.equal(fileRoute('app/(shop)/cart/page.tsx'), '/cart');
    assert.equal(fileRoute('app/(marketing)/(eu)/page.tsx'), '/');
  });

  it('excludes _app, _document and _error, and files that are not routes', () => {
    assert.equal(fileRoute('pages/_app.js'), null);
    assert.equal(fileRoute('pages/_document.tsx'), null);
    assert.equal(fileRoute('pages/_error.js'), null);
    assert.equal(fileRoute('lib/a.js'), null);
    assert.equal(fileRoute('app/layout.tsx'), null);
  });
});

describe('surfaces — manifestSurfaces', () => {
  it('package.json bin entries are cli anchors; main and exports are the lib', () => {
    assert.deepEqual(manifestSurfaces('package.json', JSON.stringify({ name: 'p', bin: { a: 'x.js', b: 'y.js' }, main: 'index.js', exports: { '.': './i.js', './sub': './s.js' } })), [
      { kind: 'cli', anchors: ['a', 'b'], evidence: 'package.json bin' },
      { kind: 'lib', anchors: ['index.js', '.', './sub'], evidence: 'package.json main/exports' }
    ]);
    assert.deepEqual(manifestSurfaces('package.json', JSON.stringify({ name: 'p', bin: 'x.js' })), [{ kind: 'cli', anchors: ['p'], evidence: 'package.json bin' }], 'a string bin is named by the package');
  });

  it('a private package has no lib surface (its bin still counts); bad JSON and node_modules give nothing', () => {
    assert.deepEqual(manifestSurfaces('package.json', JSON.stringify({ name: 'p', private: true, main: 'index.js', bin: { a: 'x' } })), [{ kind: 'cli', anchors: ['a'], evidence: 'package.json bin' }]);
    assert.deepEqual(manifestSurfaces('package.json', JSON.stringify({ name: 'p', private: true, main: 'index.js' })), []);
    assert.deepEqual(manifestSurfaces('package.json', '{bad'), []);
    assert.deepEqual(manifestSurfaces('node_modules/p/package.json', JSON.stringify({ main: 'a' })), []);
  });

  it('pyproject [project.scripts] are cli anchors', () => {
    assert.deepEqual(manifestSurfaces('pyproject.toml', '[project]\nname="x"\n[project.scripts]\nfoo = "x:main"\nbar-baz = "x:y"\n[tool.x]\na=1'), [{ kind: 'cli', anchors: ['foo', 'bar-baz'], evidence: 'pyproject scripts' }]);
    assert.deepEqual(manifestSurfaces('pyproject.toml', '[project]\nname="x"'), []);
  });
});

describe('surfaces — scanSurfaces on the sample app', () => {
  let dir;
  before(async () => { dir = await appCopy('bbs-surf-scan-'); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('finds the page, the route handler, the router, the job, the model step and the flag file, and nothing from test/', async () => {
    const scan = await scanSurfaces(dir, { now });
    const by = Object.fromEntries(scan.surfaces.map(s => [s.id, s.anchors]));
    assert.deepEqual(by, {
      'ui:app/settings/security/page.js': ['/settings/security'],
      'api:app/api/scan/route.js': ['/api/scan'],
      'api:server/routes.js': ['/api/upload', '/api/health'],
      'job:jobs/nightly.js': ['0 3 * * *'],
      'model:lib/summarize.js': ['summarizeTicket'],
      'feature:config/flags.json': ['newScanner', 'betaInbox']
    });
    assert.ok(!scan.surfaces.some(s => s.file.startsWith('test/')), 'the fixture\'s own test folder is not a surface');
    assert.deepEqual(scan.surfaces.map(s => s.kind), ['ui', 'api', 'api', 'job', 'model', 'feature'], 'ordered by kind');
    assert.equal(scan.via, 'git');
    assert.ok(scan.scanned >= 6);
    const page = scan.surfaces[0];
    assert.equal(page.label, 'ui /settings/security');
    assert.deepEqual(page.evidence, ['file-system page']);
  });

  it('installed Claude Code commands are workflow surfaces carrying their step headings', async () => {
    const d = await appCopy('bbs-surf-wf-');
    try {
      await fs.mkdir(path.join(d, '.claude', 'commands', '.shortcuts'), { recursive: true });
      await fs.writeFile(path.join(d, '.claude', 'commands', '.shortcuts', 'w-review.md'), '# /w-review\n\n## Step 1: Gather\n\n## Step 2: Analyze\n');
      const scan = await scanSurfaces(d, { now });
      const wf = scan.surfaces.find(s => s.kind === 'workflow');
      assert.equal(wf.id, 'workflow:.claude/commands/.shortcuts/w-review.md');
      assert.equal(wf.label, '/w-review');
      assert.deepEqual(wf.anchors, ['Step 1: Gather', 'Step 2: Analyze']);
      assert.equal(scan.surfaces.at(-1), wf, 'workflows sort last');
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
});

describe('surfaces — ownerSurface', () => {
  let dir;
  before(async () => { dir = await appCopy('bbs-surf-own-'); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('a good spec names a file that exists, with an optional anchor', async () => {
    assert.deepEqual(await ownerSurface(dir, 'api:server/routes.js#/api/upload'), {
      id: 'api:server/routes.js', kind: 'api', file: 'server/routes.js', anchors: ['/api/upload'], label: 'api /api/upload',
      evidence: ['named by the owner'], activity: null, by: 'owner'
    });
    const bare = await ownerSurface(dir, 'job:./jobs/nightly.js');
    assert.equal(bare.id, 'job:jobs/nightly.js', './ is dropped');
    assert.deepEqual(bare.anchors, []);
    assert.equal(bare.label, 'job jobs/nightly.js');
  });

  it('a bad kind, a bad shape, a missing file and a path outside the project are refused', async () => {
    await assert.rejects(ownerSurface(dir, 'widget:server/routes.js'), /a surface is <kind>:<file>\[#<anchor>\] with kind one of ui\|api\|job\|model\|cli\|feature\|lib\|workflow, got "widget:server\/routes\.js"/);
    await assert.rejects(ownerSurface(dir, 'server/routes.js'), /a surface is <kind>:<file>/);
    await assert.rejects(ownerSurface(dir, 'api:server/nope.js'), /"server\/nope\.js" is not a file in the project/);
    await assert.rejects(ownerSurface(dir, 'api:server'), /"server" is not a file in the project/, 'a directory is not a file');
    await assert.rejects(ownerSurface(dir, 'api:../outside.js'), /"\.\.\/outside\.js" is outside the project/);
    await assert.rejects(ownerSurface(dir, 'api:/etc/passwd'), /is outside the project/);
  });
});

describe('surfaces — recordSurfaces', () => {
  let dir, file;
  before(async () => {
    dir = await appCopy('bbs-surf-rec-');
    file = path.join(dir, '.claude', 'bbs', 'runs', RUN, 'surfaces.json');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('--add needs a prior scan', async () => {
    await assert.rejects(recordSurfaces(dir, { run: RUN, add: ['api:server/routes.js'], now }), /no surfaces\.json yet — run cli\.js surfaces first, then --add the owner's own/);
  });

  it('a scan writes surfaces.json and summarizes the kinds', async () => {
    const r = await recordSurfaces(dir, { run: RUN, now });
    assert.deepEqual(r, { run: RUN, scanned: r.scanned, kinds: { ui: 1, api: 2, job: 1, model: 1, feature: 1 }, owner: 0, note: undefined });
    const doc = await readJson(file);
    assert.equal(doc.run, RUN);
    assert.equal(doc.ts, '2026-10-10T12:00:00.000Z');
    assert.equal(doc.surfaces.length, 6);
    assert.deepEqual(doc.owner, []);
    assert.equal(doc.kinds.workflow, 0);
  });

  it('a second scan is refused without --force, naming it', async () => {
    await assert.rejects(recordSurfaces(dir, { run: RUN, now }), new RegExp(`surfaces\\.json already exists for run ${RUN}; pass --force to rescan \\(the owner's own surfaces are kept\\)`));
  });

  it('--add records the owner\'s own surface and merges anchors on the same file', async () => {
    const r = await recordSurfaces(dir, { run: RUN, add: ['cli:jobs/nightly.js#nightly'], now });
    assert.equal(r.owner, 1);
    assert.equal(r.kinds.cli, 1);
    await recordSurfaces(dir, { run: RUN, add: ['cli:jobs/nightly.js#cleanup', 'cli:jobs/nightly.js#nightly'], now });
    const doc = await readJson(file);
    assert.equal(doc.owner.length, 1);
    assert.deepEqual(doc.owner[0].anchors, ['nightly', 'cleanup']);
    assert.equal(doc.owner[0].by, 'owner');
    await assert.rejects(recordSurfaces(dir, { run: RUN, add: ['cli:jobs/missing.js'], now }), /"jobs\/missing\.js" is not a file in the project/);
  });

  it('--force rescans and keeps the owner\'s surfaces', async () => {
    const r = await recordSurfaces(dir, { run: RUN, force: true, now });
    assert.equal(r.owner, 1);
    const doc = await readJson(file);
    assert.equal(doc.surfaces.length, 6);
    assert.deepEqual(doc.owner.map(o => o.id), ['cli:jobs/nightly.js']);
  });

  it('a corrupt surfaces.json names the --force repair; --force replaces it', async () => {
    await fs.writeFile(file, '{bad');
    await assert.rejects(recordSurfaces(dir, { run: RUN, now }), /corrupt JSON.*— run cli\.js surfaces --force to rescan and replace it/);
    await assert.rejects(recordSurfaces(dir, { run: RUN, add: ['api:server/routes.js'], now }), /run cli\.js surfaces --force to rescan and replace it/);
    const r = await recordSurfaces(dir, { run: RUN, force: true, now });
    assert.equal(r.owner, 0, 'the corrupt file had no owner surfaces to keep');
    assert.equal((await readJson(file)).surfaces.length, 6);
  });

  it('a project with only workflows (or nothing) gets a note asking the owner where the powers belong', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-surf-empty-'));
    try {
      spawnSync('git', ['init', '-q', '.'], { cwd: d });
      await fs.mkdir(path.join(d, '.claude', 'commands'), { recursive: true });
      await fs.writeFile(path.join(d, '.claude', 'commands', 'w-fix.md'), '# /w-fix\n\n## Step 1\n');
      const r = await recordSurfaces(d, { run: RUN, now });
      assert.deepEqual(r.kinds, { workflow: 1 });
      assert.equal(r.note, 'no UI, API, job, model, CLI, flag or library surface found: the verdict question must ask the owner where these powers belong (<power>@<kind>:<file>[#<anchor>])');
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
});

describe('surfaces — cli verb', () => {
  let dir;
  const cli = (args, input = '') => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8', input, env: { ...process.env, BBS_SANDBOX: 'absent' } });
    let json = null; try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  };
  before(async () => {
    dir = await appCopy('bbs-surf-cli-');
    assert.equal(cli(['intake', '-', '--slug', 's1'], 'a tool').code, 0);
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('scans, writes <run>/surfaces.json, prints the kinds and the next step, and status.md has a surfaces row', async () => {
    const r = cli(['surfaces']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.kinds, { ui: 1, api: 2, job: 1, model: 1, feature: 1 });
    assert.equal(r.json.owner, 0);
    assert.equal(typeof r.json.next, 'string');
    const doc = await readJson(path.join(dir, '.claude', 'bbs', 'runs', r.json.run, 'surfaces.json'));
    assert.equal(doc.surfaces.length, 6);
    const status = await fs.readFile(path.join(dir, '.claude', 'bbs', 'runs', r.json.run, 'status.md'), 'utf-8');
    assert.match(status, /\| surfaces \| pending \|  \|\n/, 'the run is still at inventory, so the surfaces row has a place but is not done');
  });

  it('a second scan without --force exits 1 naming --force; --add adds the owner\'s; --add with --force is refused', () => {
    const again = cli(['surfaces']);
    assert.equal(again.code, 1);
    assert.match(again.err, /--force to rescan/);
    const add = cli(['surfaces', '--add', 'api:server/routes.js#/api/upload']);
    assert.equal(add.code, 0, add.err);
    assert.equal(add.json.owner, 1);
    const both = cli(['surfaces', '--add', 'api:server/routes.js', '--force']);
    assert.equal(both.code, 1);
    assert.match(both.err, /--add adds the owner's own surfaces; --force rescans \(the owner's are kept\): use one/);
    const bad = cli(['surfaces', '--add', 'nope:server/routes.js']);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /a surface is <kind>:<file>\[#<anchor>\]/);
    const re = cli(['surfaces', '--force']);
    assert.equal(re.code, 0, re.err);
    assert.equal(re.json.owner, 1, 'the owner\'s surface survives a rescan');
  });

  it('takes no positionals', () => {
    const r = cli(['surfaces', 'extra']);
    assert.equal(r.code, 1);
    assert.match(r.err, /unexpected argument "extra"/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Targets on a surface

const UI = 'ui:app/settings/security/page.js';
const API = 'api:server/routes.js';

async function targetRun(dir, { evidence = 'transcripts', withSurfaces = true } = {}) {
  const rd = path.join(dir, '.claude', 'bbs', 'runs', RUN);
  await writeJson(path.join(rd, 'powers.json'), { powers: [{ name: 'redact', what: 'masks secrets' }, { name: 'gate', what: 'blocks a push' }] });
  await writeJson(path.join(rd, 'usage.json'), { evidence, workflows: [] });
  if (withSurfaces) await recordSurfaces(dir, { run: RUN, force: true, now });
  return rd;
}

const srow = (o = {}) => ({ surface: UI, at: '/settings/security', reach: 'Settings › Security', how: 'masks the session notes before they are shown', mode: 'advisory', ...o });

describe('targets — surface rows', () => {
  let dir, rd;
  before(async () => { dir = await appCopy('bbs-surf-tgt-'); rd = await targetRun(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const rec = (obj, o = {}) => recordTargets(dir, { run: RUN, input: JSON.stringify(obj), now, ...o });

  it('targets require surfaces.json', async () => {
    const d = await appCopy('bbs-surf-tgt-no-');
    try {
      await targetRun(d, { withSurfaces: false });
      await assert.rejects(recordTargets(d, { run: RUN, input: JSON.stringify({ redact: [] }), now }), /no surfaces\.json yet — run cli\.js surfaces first: a power lands where a user meets it, found in the code/);
      await fs.mkdir(path.join(d, '.claude', 'bbs', 'runs', RUN), { recursive: true });
      await fs.writeFile(path.join(d, '.claude', 'bbs', 'runs', RUN, 'surfaces.json'), '{bad');
      await assert.rejects(recordTargets(d, { run: RUN, input: JSON.stringify({ redact: [] }), now }), /corrupt JSON.*run cli\.js surfaces --force to rescan and replace it/);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });

  it('a valid surface row is stored with its kind, file, anchor, reach and how', async () => {
    const r = await rec({ redact: [srow(), srow({ surface: API, at: '/api/upload', reach: 'POST /api/upload', how: 'masks uploaded text', mode: 'blocking' })], gate: [] });
    assert.deepEqual(r.targets.redact, [`${UI} · /settings/security · advisory`, `${API} · /api/upload · blocking`]);
    assert.deepEqual(r.no_target, ['gate']);
    const saved = await readJson(path.join(rd, 'targets.json'));
    assert.deepEqual(saved.targets.redact[0], { kind: 'ui', surface: UI, file: 'app/settings/security/page.js', at: '/settings/security', reach: 'Settings › Security', how: 'masks the session notes before they are shown', mode: 'advisory', by: 'proposed' });
    assert.equal(saved.targets.redact[1].mode, 'blocking');
  });

  it('the anchor is matched case-insensitively and stored as the surface spells it', async () => {
    await rec({ redact: [srow({ surface: 'model:lib/summarize.js', at: 'SUMMARIZETICKET', reach: 'the ticket summary' })] });
    const saved = await readJson(path.join(rd, 'targets.json'));
    assert.equal(saved.targets.redact[0].at, 'summarizeTicket');
  });

  it('refuses an unknown surface, an at that is not an anchor, a missing at or reach, and the shared bad fields', async () => {
    await assert.rejects(rec({ redact: [srow({ surface: 'ui:app/nope/page.js' })] }), /redact: "ui:app\/nope\/page\.js" is not a surface of this project/);
    await assert.rejects(rec({ redact: [srow({ at: '/settings/billing' })] }), new RegExp(`redact: "/settings/billing" is not an anchor of ${UI} \\(its anchors: "/settings/security"\\)`));
    await assert.rejects(rec({ redact: [srow({ at: '' })] }), new RegExp(`redact: ${UI} needs "at" — one of "/settings/security"`));
    await assert.rejects(rec({ redact: [{ surface: UI, how: 'x', mode: 'advisory', at: '/settings/security' }] }), new RegExp(`redact: ${UI} needs "reach" — one line on how a user gets there`));
    await assert.rejects(rec({ redact: [srow({ reach: 'x'.repeat(300) })] }), /redact: "reach" must be one line \(at most 240 characters\)/);
    await assert.rejects(rec({ redact: [srow({ how: '' })] }), new RegExp(`redact: ${UI} needs "how"`));
    await assert.rejects(rec({ redact: [srow({ mode: 'maybe' })] }), /redact: "mode" must be advisory or blocking/);
    await assert.rejects(rec({ redact: [srow(), srow({ at: '/SETTINGS/security' })] }), new RegExp(`redact: ${UI} · /settings/security is named twice`));
  });

  it('a workflow surface id is the same as a workflow row, and a code row on an unlisted workflow file is refused', async () => {
    await assert.rejects(rec({ redact: [{ surface: 'workflow:.claude/commands/.shortcuts/w-ghost.md', at: 'x', how: 'x', mode: 'advisory' }] }), /redact: "workflow:\.claude\/commands\/\.shortcuts\/w-ghost\.md" is not an installed workflow/);
  });
});

describe('targets — the owner names a surface', () => {
  let dir, rd;
  before(async () => { dir = await appCopy('bbs-surf-set-'); rd = await targetRun(dir); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('<power>@<kind>:<file>#<anchor> records an owner target with the owner placeholders; the anchor is kept as typed', async () => {
    const r = await setOwnerTargets(dir, { run: RUN, set: 'redact@api:server/routes.js#/api/upload', now });
    assert.deepEqual(r.targets.redact, ['api:server/routes.js · /api/upload · advisory']);
    const saved = (await readJson(path.join(rd, 'targets.json'))).targets.redact;
    assert.deepEqual(saved, [{ kind: 'api', surface: API, file: 'server/routes.js', at: '/api/upload', reach: OWNER_REACH, how: OWNER_HOW, mode: 'advisory', by: 'owner' }]);
  });

  it('no anchor leaves the place to pick; a repeat keeps the row the power already had, now by the owner', async () => {
    const r = await setOwnerTargets(dir, { run: RUN, set: 'gate@job:jobs/nightly.js', now });
    assert.deepEqual(r.targets.gate, ['job:jobs/nightly.js · (place to pick) · advisory']);
    assert.equal((await readJson(path.join(rd, 'targets.json'))).targets.gate[0].at, null);
    await recordTargets(dir, { run: RUN, input: JSON.stringify({ redact: [srow({ how: 'a proposed how' })] }), now });
    await setOwnerTargets(dir, { run: RUN, set: 'redact@ui:app/settings/security/page.js#/settings/security', now });
    const kept = (await readJson(path.join(rd, 'targets.json'))).targets.redact[0];
    assert.equal(kept.how, 'a proposed how');
    assert.equal(kept.by, 'owner');
  });

  it('a file that does not exist, a bad kind, and several places in one --set', async () => {
    await assert.rejects(setOwnerTargets(dir, { run: RUN, set: 'redact@api:server/missing.js#/x', now }), /redact: "server\/missing\.js" is not a file in the project/);
    await assert.rejects(setOwnerTargets(dir, { run: RUN, set: 'redact@api:../x.js', now }), /redact: "\.\.\/x\.js" is outside the project/);
    await assert.rejects(setOwnerTargets(dir, { run: RUN, set: 'redact@widget:server/routes.js', now }), /redact: "widget:server\/routes\.js" is not an installed workflow, nor a <kind>:<file> surface \(kinds: ui\|api\|job\|model\|cli\|feature\|lib\)/);
    const r = await setOwnerTargets(dir, { run: RUN, set: 'redact@api:server/routes.js#/api/health,model:lib/summarize.js#summarizeTicket', force: true, now });
    assert.deepEqual(r.targets.redact, ['api:server/routes.js · /api/health · advisory', 'model:lib/summarize.js · summarizeTicket · advisory']);
  });
});

describe('targets — code targets stand, and read as a label', () => {
  const code = (o = {}) => ({ kind: 'api', surface: API, file: 'server/routes.js', at: '/api/upload', reach: 'POST /api/upload', how: 'h', mode: 'advisory', by: 'proposed', ...o });
  const wf = (o = {}) => ({ kind: 'workflow', surface: 'workflow:.claude/commands/w.md', file: '.claude/commands/w.md', at: 's', reach: '/w › s', workflow: 'w', step: 's', how: 'h', mode: 'advisory', by: 'proposed', ...o });
  const none = { evidence: 'none', workflows: [] };

  it('a code target stands whatever the usage evidence says; a proposed workflow target does not under evidence none', () => {
    assert.deepEqual(standingTargets([code(), wf()], none), [code()]);
    assert.deepEqual(standingTargets([code()], undefined), [code()]);
    assert.deepEqual(standingTargets([wf(), wf({ workflow: 'x', by: 'owner' })], none).map(t => t.workflow), ['x']);
    assert.deepEqual(standingTargets([wf()], { evidence: 'transcripts', workflows: [{ name: 'w' }] }).map(t => t.workflow), ['w']);
  });

  it('noLandingWhy is null when anything stands, and otherwise says why', () => {
    assert.equal(noLandingWhy([code()], none), null);
    assert.equal(noLandingWhy([wf(), code()], none), null);
    assert.equal(noLandingWhy(undefined, none), 'no targets proposed');
    assert.equal(noLandingWhy([], none), 'its targets are empty: it lands nowhere');
    assert.equal(noLandingWhy([wf()], none), 'its workflow targets are unverified: the owner has not named the workflows they use (workflows=a,b)');
    assert.equal(noLandingWhy([wf()], { evidence: 'owner', workflows: [{ name: 'other' }] }), 'none of its targets is a workflow the owner runs');
  });

  it('targetLabel and landsIn name a code target by its surface id; unverified rows say so', () => {
    assert.equal(targetLabel(code()), `${API} · /api/upload · advisory`);
    assert.equal(targetLabel(code({ at: null })), `${API} · place to pick · advisory`);
    assert.equal(targetLabel(wf()), 'w · s · advisory');
    assert.equal(targetLabel(wf({ step: null })), 'w · step to pick · advisory');
    assert.equal(targetLabel(wf({ unverified: true, mode: 'blocking' })), 'w · s · blocking (unverified)');
    assert.equal(landsIn([code(), wf({ unverified: true })]), `${API} · /api/upload · advisory; w · s · advisory (unverified)`);
    assert.equal(landsIn([]), 'nowhere');
    assert.equal(landsIn(undefined), 'not proposed');
  });
});

describe('surfaces — an owner surface through a symlink out of the project', () => {
  it('is refused', async () => {
    const { ownerSurface } = await import('../src/lib/bbs/surfaces.js');
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-out-'));
    const proj = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-in-'));
    try {
      await fs.writeFile(path.join(outside, 'secret.js'), 'export const x = 1;\n');
      await fs.symlink(path.join(outside, 'secret.js'), path.join(proj, 'link.js'));
      await assert.rejects(ownerSurface(proj, 'api:link.js'), /"link\.js" is not a file in the project/);
      await fs.writeFile(path.join(proj, 'ok.js'), '');
      assert.equal((await ownerSurface(proj, 'api:ok.js')).id, 'api:ok.js');
    } finally { await fs.rm(outside, { recursive: true, force: true }); await fs.rm(proj, { recursive: true, force: true }); }
  });
});

describe('surfaces — integration-gate review r1 regressions', () => {
  it('routers under any name, Go and gin handlers are api endpoints', () => {
    assert.deepEqual(only('server/users.js', "userRouter.get('/users', h); adminApp.post('/admin', h)").map(s => s.anchors), [['/users', '/admin']]);
    assert.deepEqual(only('main.go', 'http.HandleFunc("/health", h)\nr.GET("/items", h)\nmux.Handle("/static", fs)').map(s => s.anchors), [['/health', '/items', '/static']]);
  });

  it('a NestJS controller joins its base path with each method route', () => {
    const text = "@Controller('scan')\nexport class ScanController {\n  @Get()\n  list() {}\n  @Post('run')\n  run() {}\n}\n";
    assert.deepEqual(only('src/scan.controller.ts', text), [{ kind: 'api', anchors: ['/scan', '/scan/run'], evidence: 'HTTP router' }]);
  });

  it('Rails config/routes.rb verbs and resources are api endpoints', () => {
    const text = "Rails.application.routes.draw do\n  get '/health', to: 'h#show'\n  post 'scan', to: 's#run'\n  resources :tickets\nend\n";
    assert.deepEqual(only('config/routes.rb', text).map(s => s.anchors), [['/health', '/scan', '/tickets']]);
  });

  it('a route folder named build or test is a page; a test file never is', () => {
    assert.deepEqual(only('app/build/page.js', 'x'), [{ kind: 'ui', anchors: ['/build'], evidence: 'file-system page' }]);
    assert.deepEqual(only('app/test/page.js', 'x'), [{ kind: 'ui', anchors: ['/test'], evidence: 'file-system page' }]);
    assert.deepEqual(only('app/settings/page.test.js', 'x'), []);
    assert.deepEqual(only('test/app/settings/page.js', 'x'), [], 'a page under a test folder is a fixture');
  });

  it('build output is skipped at the root and at a package root, not inside a route', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-surf-build-'));
    try {
      for (const f of ['build/app/x/page.js', 'packages/web/dist/app/y/page.js', 'app/build/page.js']) {
        await fs.mkdir(path.dirname(path.join(d, f)), { recursive: true });
        await fs.writeFile(path.join(d, f), 'export default 1;\n');
      }
      const scan = await scanSurfaces(d, { now });
      assert.deepEqual(scan.surfaces.map(s => s.id), ['ui:app/build/page.js']);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });

  it('activity counts commits when the project is a folder inside a repository', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-surf-sub-'));
    try {
      const sub = path.join(repo, 'web');
      await fs.mkdir(path.join(sub, 'app', 'home'), { recursive: true });
      await fs.writeFile(path.join(sub, 'app', 'home', 'page.js'), 'export default 1;\n');
      const git = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: repo });
      git('init', '-q', '.');
      git('add', '-A');
      git('commit', '-q', '-m', 'x');
      const scan = await scanSurfaces(sub, { now: () => new Date() });
      assert.deepEqual(scan.surfaces.map(s => [s.id, s.activity]), [['ui:app/home/page.js', 1]]);
    } finally { await fs.rm(repo, { recursive: true, force: true }); }
  });
});

describe('surfaces — integration-gate review r3 regressions', () => {
  it('activity counts a file whose path is not ASCII (git log must not quote it)', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-surf-utf-'));
    try {
      await fs.mkdir(path.join(repo, 'app', 'caf\u00e9'), { recursive: true });
      await fs.writeFile(path.join(repo, 'app', 'caf\u00e9', 'page.js'), 'export default 1;\n');
      const git = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: repo });
      git('init', '-q', '.');
      git('add', '-A');
      git('commit', '-q', '-m', 'x');
      const scan = await scanSurfaces(repo, { now: () => new Date() });
      assert.deepEqual(scan.surfaces.map(s => [s.id, s.activity]), [['ui:app/caf\u00e9/page.js', 1]]);
    } finally { await fs.rm(repo, { recursive: true, force: true }); }
  });
});

describe('surfaces — integration-gate review r4 regressions', () => {
  it('a tracked symlink is never followed, even to a file the scan would read', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-surf-link-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-surf-out-'));
    try {
      await fs.writeFile(path.join(outside, 'secrets.json'), JSON.stringify({ stripeKey: 'x', dbPassword: 'y' }));
      await fs.mkdir(path.join(repo, 'config'), { recursive: true });
      await fs.symlink(path.join(outside, 'secrets.json'), path.join(repo, 'config', 'flags.json'));
      spawnSync('git', ['init', '-q', '.'], { cwd: repo });
      spawnSync('git', ['add', '-A'], { cwd: repo });
      const scan = await scanSurfaces(repo, { now });
      assert.equal(scan.via, 'git');
      assert.deepEqual(scan.surfaces, [], 'the link target is never read');
      assert.equal(scan.skipped, 1);
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
