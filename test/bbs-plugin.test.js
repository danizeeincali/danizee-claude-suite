/**
 * Contract for src/plugins/bbs.js and the installer wiring — stream `command-docs` of marathon 2026-10-07-bbs.
 * The bbs library is copied verbatim into .claude/helpers/bbs/ so a target project needs no npm package.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as bbs from '../src/plugins/bbs.js';
import { DEFAULT_CONFIG } from '../src/lib/bbs/config.js';
import { DaniZeeSuiteInstaller } from '../src/installer.js';
import { getDefaultSettings } from '../src/utils/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const LIB = path.join(ROOT, 'src', 'lib', 'bbs');

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

describe('bbs plugin — install', () => {
  let dir, claudeDir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-plugin-'));
    claudeDir = path.join(dir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('namespace is bbs; dryRun reports the files and writes nothing', async () => {
    assert.equal(bbs.getNamespace(), 'bbs');
    const r = await bbs.install(claudeDir, { dryRun: true, targetDir: dir });
    assert.equal(r.plugin, 'bbs');
    assert.ok(r.files.includes('helpers/bbs/cli.js'));
    assert.ok(r.files.includes('bbs.json'));
    assert.equal(await exists(path.join(claudeDir, 'helpers', 'bbs')), false);
    assert.equal(await bbs.isInstalled(claudeDir), false);
  });

  it('copies every src/lib/bbs/*.js verbatim, writes bbs.json and .claude/bbs/.gitkeep once, and the gitignore rules for machine-local state', async () => {
    const r = await bbs.install(claudeDir, { targetDir: dir });
    const libFiles = (await fs.readdir(LIB)).filter(f => f.endsWith('.js')).sort();
    assert.ok(libFiles.length >= 10, 'the library has its modules');
    for (const f of libFiles) {
      const a = await fs.readFile(path.join(LIB, f), 'utf-8');
      const b = await fs.readFile(path.join(claudeDir, 'helpers', 'bbs', f), 'utf-8');
      assert.equal(b, a, `${f} copied verbatim`);
      assert.ok(r.files.includes(`helpers/bbs/${f}`));
    }
    const cfg = JSON.parse(await fs.readFile(path.join(claudeDir, 'bbs.json'), 'utf-8'));
    assert.deepEqual(cfg, DEFAULT_CONFIG);
    assert.ok(await exists(path.join(claudeDir, 'bbs', '.gitkeep')));
    const gi = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    for (const rule of ['.claude/bbs/ACTIVE', '.claude/bbs/runs/*/fetched/', '.claude/bbs/runs/*/map.lock', '.claude/bbs/runs/*/*.tmp']) {
      assert.ok(gi.split('\n').includes(rule), `gitignore has ${rule}`);
    }
    assert.match(gi, /foreign source/i, 'the gitignore comment says why fetched/ is never committed');
    assert.equal(await bbs.isInstalled(claudeDir), true);
  });

  it('a second install keeps the user\'s bbs.json and adds no duplicate gitignore rules', async () => {
    await fs.writeFile(path.join(claudeDir, 'bbs.json'), JSON.stringify({ limits: { max_urls: 3 } }));
    const before = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    await bbs.install(claudeDir, { targetDir: dir });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(claudeDir, 'bbs.json'), 'utf-8')), { limits: { max_urls: 3 } });
    assert.equal(await fs.readFile(path.join(dir, '.gitignore'), 'utf-8'), before);
  });

  it('the installed cli.js runs on its own (every sibling import resolves) — usage on an unknown verb, exit 1', () => {
    const r = spawnSync(process.execPath, [path.join(claudeDir, 'helpers', 'bbs', 'cli.js'), 'nope'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /usage: cli\.js <intake\|fetch\|inventory\|map\|verdict\|handoff\|status\|report>/);
    assert.equal(r.stdout, '');
  });

  it('the installed cli.js resolves the marathon helpers beside it for handoff --marathon (import path ../marathon/*.js)', async () => {
    const src = await fs.readFile(path.join(claudeDir, 'helpers', 'bbs', 'handoff.js'), 'utf-8');
    assert.match(src, /from '\.\.\/marathon\/(config|gate)\.js'/, 'handoff imports the marathon library by the sibling path the installer creates');
  });

  it('uninstall removes the helpers only; run data and bbs.json stay', async () => {
    await fs.mkdir(path.join(claudeDir, 'bbs', 'runs', 'r'), { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'bbs', 'runs', 'r', 'status.md'), '# bbs r');
    await bbs.uninstall(claudeDir);
    assert.equal(await exists(path.join(claudeDir, 'helpers', 'bbs')), false);
    assert.equal(await exists(path.join(claudeDir, 'bbs', 'runs', 'r', 'status.md')), true);
    assert.equal(await exists(path.join(claudeDir, 'bbs.json')), true);
    assert.equal(await bbs.isInstalled(claudeDir), false);
  });
});

describe('bbs plugin — installer wiring', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-installer-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('the default settings allow the bbs helper CLI like the marathon one', () => {
    assert.ok(getDefaultSettings().permissions.allow.includes('Bash(node .claude/helpers/bbs/cli.js:*)'));
    assert.ok(getDefaultSettings().permissions.allow.includes('Bash(node .claude/helpers/marathon/cli.js:*)'));
  });

  it('init installs the bbs plugin next to marathon; check reports plugins.bbs; the dry-run report lists bbs', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: dir, force: true, withoutCookbook: true });
    const result = await installer.install();
    assert.ok(result.success, JSON.stringify(result).slice(0, 300));
    assert.ok(await exists(path.join(dir, '.claude', 'helpers', 'bbs', 'cli.js')));
    assert.ok(await exists(path.join(dir, '.claude', 'helpers', 'marathon', 'cli.js')));
    assert.ok(await exists(path.join(dir, '.claude', 'commands', '.shortcuts', 'w-bbs.md')));
    assert.ok(await exists(path.join(dir, '.claude', 'commands', '.shortcuts', 'bbs.md')));
    const status = await installer.check();
    assert.equal(status.plugins.bbs, true);
    assert.equal(status.plugins.marathon, true);
    const dry = await new DaniZeeSuiteInstaller({ path: dir, dryRun: true }).dryRunReport();
    assert.ok(dry.plugins.includes('bbs'));
    assert.ok(dry.plugins.includes('marathon'));
    const settings = JSON.parse(await fs.readFile(path.join(dir, '.claude', 'settings.json'), 'utf-8'));
    assert.ok(settings.permissions.allow.includes('Bash(node .claude/helpers/bbs/cli.js:*)'));
  });

  it('uninstall removes the bbs helpers with the rest', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: dir, force: true, withoutCookbook: true });
    await installer.uninstall();
    assert.equal(await exists(path.join(dir, '.claude', 'helpers', 'bbs')), false);
  });
});

describe('bbs plugin — review r1 regressions', () => {
  const MLIB = path.join(ROOT, 'src', 'lib', 'marathon');
  let dir, claudeDir, marker;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-only-'));
    claudeDir = path.join(dir, '.claude');
    await fs.mkdir(path.join(claudeDir, 'helpers', 'marathon'), { recursive: true });
    marker = (await fs.readFile(path.join(MLIB, 'gate.js'), 'utf-8')) + '\n// MARKER user copy\n';
    await fs.writeFile(path.join(claudeDir, 'helpers', 'marathon', 'gate.js'), marker);
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('bbs-only install: a pre-seeded marathon/gate.js is untouched, no marathon/cli.js, marathon not installed, the installed cli runs and handoff --marathon says the marathon helpers are absent', async () => {
    const marathon = await import('../src/plugins/marathon.js');
    await bbs.install(claudeDir, { targetDir: dir });
    assert.equal(await fs.readFile(path.join(claudeDir, 'helpers', 'marathon', 'gate.js'), 'utf-8'), marker);
    assert.equal(await exists(path.join(claudeDir, 'helpers', 'marathon', 'cli.js')), false);
    assert.equal(await marathon.isInstalled(claudeDir), false);
    assert.ok(await exists(path.join(claudeDir, 'helpers', 'marathon', 'config.js')), 'the absent modules were copied');
    const cli = path.join(claudeDir, 'helpers', 'bbs', 'cli.js');
    const nope = spawnSync(process.execPath, [cli, 'nope'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(nope.status, 1);
    assert.match(nope.stderr, /usage: cli\.js/);
    const FX = path.join(ROOT, 'test', 'fixtures', 'bbs');
    const env = { ...process.env, BBS_NO_NETWORK: '1', BBS_SANDBOX: 'absent' };
    const step = (args) => { const r = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf-8', env }); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r; };
    step(['intake', path.join(FX, 'sample-source'), '--slug', 'x']);
    step(['fetch']);
    step(['inventory', '--from', path.join(FX, 'inventory.json')]);
    step(['map']);
    step(['map', '--from', path.join(FX, 'judgments.json')]);
    step(['verdict']);
    step(['verdict', '--from', path.join(FX, 'decisions.json')]);
    const h = spawnSync(process.execPath, [cli, 'handoff', '--marathon'], { cwd: dir, encoding: 'utf-8', env });
    assert.notEqual(h.status, 0);
    assert.match(h.stderr + h.stdout, /marathon helpers/i);
    assert.match(h.stderr + h.stdout, /absent|not installed|missing/i);
  });

  it('install records the marathon modules it copied in helpers/bbs/.marathon-files.json (and not the pre-existing one)', async () => {
    const m = JSON.parse(await fs.readFile(path.join(claudeDir, 'helpers', 'bbs', '.marathon-files.json'), 'utf-8'));
    const all = (await fs.readdir(MLIB)).filter(f => f.endsWith('.js') && f !== 'cli.js');
    assert.ok(Array.isArray(m) && m.length > 0);
    assert.ok(!m.includes('gate.js'), 'gate.js was the user\'s, bbs did not write it');
    assert.ok(!m.includes('cli.js'));
    assert.deepEqual([...m].sort(), all.filter(f => f !== 'gate.js').sort());
  });

  it('uninstall removes exactly the recorded marathon modules when marathon/cli.js is absent; the user\'s gate.js stays', async () => {
    await bbs.uninstall(claudeDir);
    assert.equal(await exists(path.join(claudeDir, 'helpers', 'bbs')), false);
    assert.equal(await fs.readFile(path.join(claudeDir, 'helpers', 'marathon', 'gate.js'), 'utf-8'), marker);
    assert.deepEqual(await fs.readdir(path.join(claudeDir, 'helpers', 'marathon')), ['gate.js']);
  });

  it('uninstall leaves the marathon modules alone when marathon/cli.js is present', async () => {
    const d2 = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-both-'));
    try {
      const c2 = path.join(d2, '.claude');
      await bbs.install(c2, { targetDir: d2 });
      await fs.writeFile(path.join(c2, 'helpers', 'marathon', 'cli.js'), '// marathon cli\n');
      const before = (await fs.readdir(path.join(c2, 'helpers', 'marathon'))).sort();
      assert.ok(before.length > 2);
      await bbs.uninstall(c2);
      assert.deepEqual((await fs.readdir(path.join(c2, 'helpers', 'marathon'))).sort(), before);
      assert.equal(await exists(path.join(c2, 'helpers', 'bbs')), false);
    } finally { await fs.rm(d2, { recursive: true, force: true }); }
  });

  it('settings.js no longer exports an eagerly evaluated DEFAULT_SETTINGS', async () => {
    const mod = await import('../src/utils/settings.js');
    assert.equal('DEFAULT_SETTINGS' in mod, false);
    assert.equal(typeof mod.getDefaultSettings, 'function');
  });

  it('check prints a BBS helpers line beside the Marathon one', async () => {
    const d3 = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-check-'));
    try {
      await new DaniZeeSuiteInstaller({ path: d3, force: true, withoutCookbook: true }).install();
      const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'check', '--path', d3], { encoding: 'utf-8' });
      assert.match(r.stdout, /✓ BBS helpers \(\/w-bbs, \/bbs\)/);
      assert.ok(r.stdout.indexOf('Marathon helpers') < r.stdout.indexOf('BBS helpers'));
    } finally { await fs.rm(d3, { recursive: true, force: true }); }
  });

  it('the repo\'s own committed .claude/helpers/bbs/*.js equal src/lib/bbs/*.js (dogfood, like marathon\'s), and .gitignore carries the bbs rules', async () => {
    const libFiles = (await fs.readdir(LIB)).filter(f => f.endsWith('.js'));
    assert.ok(libFiles.includes('cli.js'));
    for (const f of libFiles) {
      assert.equal(await fs.readFile(path.join(ROOT, '.claude', 'helpers', 'bbs', f), 'utf-8'), await fs.readFile(path.join(LIB, f), 'utf-8'), `${f} equals the library`);
    }
    const gi = (await fs.readFile(path.join(ROOT, '.gitignore'), 'utf-8')).split('\n');
    for (const rule of ['.claude/bbs/ACTIVE', '.claude/bbs/runs/*/fetched/', '.claude/bbs/runs/*/map.lock', '.claude/bbs/runs/*/*.tmp']) assert.ok(gi.includes(rule), rule);
  });
});
