/**
 * Tests for src/plugins/marathon.js, src/lib/marathon/shadow.js, settings hooks merge, installer wiring
 * AC 28–33.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as marathon from '../src/plugins/marathon.js';
import { checkShadowing } from '../src/lib/marathon/shadow.js';
import { mergeHooks, unmergeHooks, readSettings, writeSettings } from '../src/utils/settings.js';
import { DaniZeeSuiteInstaller } from '../src/installer.js';

const LIB_MODULES = ['store', 'config', 'gate', 'streak', 'budget', 'status', 'findings', 'reviewer',
  'context', 'keeplist', 'resume', 'wake', 'page', 'shadow', 'routing', 'cli'];

describe('shadow — checkShadowing', () => {
  let dir;
  before(async () => {
    dir = path.join(os.tmpdir(), `marathon-shadow-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'bc.md'), '# old bc', 'utf-8');
    await fs.writeFile(path.join(dir, 'unrelated.md'), '# x', 'utf-8');
  });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('AC28: returns colliding names in input order; missing dir → []', async () => {
    assert.deepEqual(await checkShadowing(dir, ['pt', 'bc', 'w-marathon']), ['bc']);
    assert.deepEqual(await checkShadowing(path.join(dir, 'nope'), ['bc']), []);
  });
});

describe('settings — mergeHooks', () => {
  it('appends a hook entry only when its command is absent', () => {
    const entries = marathon.getHookEntries();
    assert.ok(entries.PreCompact && entries.SessionStart);
    const once = mergeHooks({}, entries);
    const twice = mergeHooks(once, entries);
    assert.equal(twice.PreCompact.length, 1);
    assert.equal(twice.SessionStart.length, 1);
    assert.equal(twice.SessionStart[0].matcher, 'compact');
    assert.match(twice.PreCompact[0].hooks[0].command, /marathon-precompact\.sh/);
    assert.match(twice.SessionStart[0].hooks[0].command, /marathon-session-start\.sh/);
  });

  it('keeps unrelated existing hooks', () => {
    const existing = { PreCompact: [{ hooks: [{ type: 'command', command: 'echo other' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] };
    const merged = mergeHooks(existing, marathon.getHookEntries());
    assert.equal(merged.PreCompact.length, 2);
    assert.equal(merged.Stop.length, 1);
  });

  it('m7: unmergeHooks removes exactly the given entries and leaves the rest', () => {
    const existing = { PreCompact: [{ hooks: [{ type: 'command', command: 'echo other' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] };
    const merged = mergeHooks(existing, marathon.getHookEntries());
    const removed = unmergeHooks(merged, marathon.getHookEntries());
    assert.equal(removed.PreCompact.length, 1);
    assert.equal(removed.PreCompact[0].hooks[0].command, 'echo other');
    assert.equal(removed.SessionStart, undefined, 'an emptied event is dropped');
    assert.equal(removed.Stop.length, 1);
  });

  it('m8: hook commands resolve from $CLAUDE_PROJECT_DIR, not the cwd', () => {
    const entries = marathon.getHookEntries();
    assert.match(entries.PreCompact[0].hooks[0].command, /CLAUDE_PROJECT_DIR/);
    assert.match(entries.SessionStart[0].hooks[0].command, /CLAUDE_PROJECT_DIR/);
  });
});

describe('plugin — marathon.install', () => {
  let claudeDir;
  before(async () => {
    const root = path.join(os.tmpdir(), `marathon-plugin-${Date.now()}`);
    claudeDir = path.join(root, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'marathon.json'), JSON.stringify({ ceiling_pct: 55 }), 'utf-8');
    await marathon.install(claudeDir, { targetDir: root });
  });
  after(async () => { try { await fs.rm(path.dirname(claudeDir), { recursive: true }); } catch {} });

  it('AC29: copies every lib module into helpers/marathon', async () => {
    for (const m of LIB_MODULES) {
      await fs.access(path.join(claudeDir, 'helpers', 'marathon', `${m}.js`));
    }
  });

  it('AC29: writes executable hooks', async () => {
    for (const h of ['marathon-precompact.sh', 'marathon-session-start.sh']) {
      const st = await fs.stat(path.join(claudeDir, 'hooks', h));
      assert.ok(st.mode & 0o111, `${h} should be executable`);
      const body = await fs.readFile(path.join(claudeDir, 'hooks', h), 'utf-8');
      assert.match(body, /cli\.js/);
    }
    const pre = await fs.readFile(path.join(claudeDir, 'hooks', 'marathon-precompact.sh'), 'utf-8');
    assert.match(pre, /handoff/);
    assert.match(pre, /exit 0/);
    const start = await fs.readFile(path.join(claudeDir, 'hooks', 'marathon-session-start.sh'), 'utf-8');
    assert.match(start, /resume/);
  });

  it('AC29: writes reviewer kit, rules and .gitkeep; does not overwrite marathon.json', async () => {
    await fs.access(path.join(claudeDir, 'marathon', 'reviewer', 'severity.md'));
    await fs.access(path.join(claudeDir, 'marathon', 'reviewer', 'angles.md'));
    await fs.access(path.join(claudeDir, 'marathon', 'rules.md'));
    await fs.access(path.join(claudeDir, 'marathon', '.gitkeep'));
    const sev = await fs.readFile(path.join(claudeDir, 'marathon', 'reviewer', 'severity.md'), 'utf-8');
    assert.match(sev, /high/i); assert.match(sev, /medium/i); assert.match(sev, /low/i);
    assert.match(sev, /inflate/i);
    const rules = await fs.readFile(path.join(claudeDir, 'marathon', 'rules.md'), 'utf-8');
    assert.match(rules, /never weaken/i);
    const cfg = JSON.parse(await fs.readFile(path.join(claudeDir, 'marathon.json'), 'utf-8'));
    assert.equal(cfg.ceiling_pct, 55, 'existing marathon.json kept');
    assert.equal(await marathon.isInstalled(claudeDir), true);
  });

  it('writes a default marathon.json when absent', async () => {
    const root = path.join(os.tmpdir(), `marathon-plugin-cfg-${Date.now()}`);
    const cd = path.join(root, '.claude');
    await fs.mkdir(cd, { recursive: true });
    await marathon.install(cd, { targetDir: root });
    const cfg = JSON.parse(await fs.readFile(path.join(cd, 'marathon.json'), 'utf-8'));
    assert.equal(cfg.ceiling_pct, 70);
    assert.equal(cfg.bc.clear_above_pct, 80);
    await fs.rm(root, { recursive: true });
  });

  it('m8: the hook scripts cd to $CLAUDE_PROJECT_DIR before looking for the CLI', async () => {
    for (const h of ['marathon-precompact.sh', 'marathon-session-start.sh']) {
      const body = await fs.readFile(path.join(claudeDir, 'hooks', h), 'utf-8');
      assert.match(body, /CLAUDE_PROJECT_DIR/);
    }
  });

  it('l7: dryRun writes nothing and creates no directories', async () => {
    const root = path.join(os.tmpdir(), `marathon-plugin-dry-${Date.now()}`);
    const cd = path.join(root, '.claude');
    await fs.mkdir(cd, { recursive: true });
    const r = await marathon.install(cd, { targetDir: root, dryRun: true });
    assert.ok(r.files.length > 0, 'dry run still reports what it would write');
    assert.deepEqual(await fs.readdir(cd), [], 'nothing created');
    await fs.rm(root, { recursive: true });
  });

  it('AC32 + m7: uninstall removes helpers, hooks and the hook entries, but keeps run data', async () => {
    const runDir = path.join(claudeDir, 'marathon', '2026-10-07-x');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'status.md'), '# s', 'utf-8');
    await writeSettings(claudeDir, { hooks: mergeHooks({ Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] }, marathon.getHookEntries()) });
    await marathon.uninstall(claudeDir);
    await assert.rejects(fs.access(path.join(claudeDir, 'helpers', 'marathon')));
    await assert.rejects(fs.access(path.join(claudeDir, 'hooks', 'marathon-precompact.sh')));
    await fs.access(path.join(runDir, 'status.md'));
    assert.equal(await marathon.isInstalled(claudeDir), false);
    const settings = await readSettings(claudeDir);
    assert.equal(settings.hooks.PreCompact, undefined);
    assert.equal(settings.hooks.SessionStart, undefined);
    assert.equal(settings.hooks.Stop.length, 1, 'unrelated hooks untouched');
  });
});

describe('installer — marathon wiring', () => {
  let testDir, fakeHome;
  before(async () => {
    testDir = path.join(os.tmpdir(), `suite-test-marathon-${Date.now()}`);
    fakeHome = path.join(os.tmpdir(), `suite-test-home-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(fakeHome, '.claude', 'commands'), { recursive: true });
    await fs.writeFile(path.join(fakeHome, '.claude', 'commands', 'bc.md'), '# shadow', 'utf-8');
    await fs.writeFile(path.join(fakeHome, '.claude', 'commands', 'mine.md'), '# mine', 'utf-8');
  });
  after(async () => {
    try { await fs.rm(testDir, { recursive: true }); } catch {}
    try { await fs.rm(fakeHome, { recursive: true }); } catch {}
  });

  it('AC31: install() installs marathon by default and reports shadowing from homeDir', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true, homeDir: fakeHome });
    const result = await installer.install();
    assert.ok(result.success);
    assert.deepEqual(result.shadowing, ['bc']);
    await fs.access(path.join(testDir, '.claude', 'helpers', 'marathon', 'cli.js'));
    const files = await fs.readdir(path.join(testDir, '.claude', 'commands', '.shortcuts'));
    assert.ok(files.includes('w-marathon.md'));
    assert.ok(files.includes('mt.md'));
    assert.ok(files.includes('bcp.md'));
  });

  it('AC30: hooks registered exactly once after two installs', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true, homeDir: fakeHome });
    await installer.install();
    const settings = await readSettings(path.join(testDir, '.claude'));
    // One entry per hook script: marathon's pair and /bc's pair, none duplicated.
    const commands = (event) => settings.hooks[event].flatMap(e => e.hooks.map(h => h.command));
    for (const event of ['PreCompact', 'SessionStart']) {
      const cmds = commands(event);
      assert.equal(cmds.length, 2, `${event}: ${cmds.join(', ')}`);
      assert.equal(new Set(cmds).size, cmds.length);
    }
    assert.equal(commands('PreCompact').filter(c => /marathon-precompact\.sh/.test(c)).length, 1);
    assert.equal(commands('PreCompact').filter(c => /bc-precompact\.sh/.test(c)).length, 1);
    assert.ok(settings.hooks.SessionStart.every(e => e.matcher === 'compact'));
  });

  it('m10: the helper CLI is in permissions.allow so an unattended loop never stalls on a prompt', async () => {
    const settings = await readSettings(path.join(testDir, '.claude'));
    assert.ok(settings.permissions.allow.some(r => /marathon\/cli\.js/.test(r)), JSON.stringify(settings.permissions.allow));
  });

  it('g18: install keeps the user\'s own permissions.allow entries (union, not replace)', async () => {
    const claudeDir = path.join(testDir, '.claude');
    const settings = await readSettings(claudeDir);
    settings.permissions.allow.push('Bash(make test:*)');
    await writeSettings(claudeDir, settings);
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true, homeDir: fakeHome });
    await installer.install();
    const after = await readSettings(claudeDir);
    assert.ok(after.permissions.allow.includes('Bash(make test:*)'), 'user entry survived');
    assert.equal(new Set(after.permissions.allow).size, after.permissions.allow.length, 'no duplicates');
  });

  it('g9: install ignores the machine-local ACTIVE pointer in the project .gitignore', async () => {
    const gi = await fs.readFile(path.join(testDir, '.gitignore'), 'utf-8');
    assert.match(gi, /\.claude\/marathon\/ACTIVE/);
    const installer = new DaniZeeSuiteInstaller({ path: testDir, force: true, homeDir: fakeHome });
    await installer.install();
    const again = await fs.readFile(path.join(testDir, '.gitignore'), 'utf-8');
    assert.equal(again.split('.claude/marathon/ACTIVE').length, 2, 'added once');
  });

  it('AC31: check() reports plugins.marathon and shadowing', async () => {
    const installer = new DaniZeeSuiteInstaller({ path: testDir, homeDir: fakeHome });
    const status = await installer.check();
    assert.equal(status.plugins.marathon, true);
    assert.deepEqual(status.shadowing, ['bc']);
  });
});
