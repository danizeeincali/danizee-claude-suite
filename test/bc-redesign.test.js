/**
 * Tests for the /bc redesign, /bcp alias, docs and version — AC 36–39.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';
import { generateWorkflowShortcuts } from '../src/utils/shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const commands = getCommands();

describe('/w-background-compound redesign', () => {
  const c = () => commands['w-background-compound'].content;

  it('keeps the Model Policy and the sonnet dispatch', () => {
    assert.match(c(), /## Model Policy|Model policy/);
    assert.match(c(), /model:\s*"?sonnet/i);
    assert.ok(!/fable/i.test(c()));
  });

  it('AC36: write-up commits and never pushes unless --push', () => {
    assert.match(c(), /never push/i);
    assert.match(c(), /--push/);
    const pushIdx = c().search(/Push\/Merge|Push and merge|Git Push/i);
    assert.ok(pushIdx > -1, 'push phase present');
    const pushSection = c().slice(pushIdx, pushIdx + 600);
    assert.match(pushSection, /--push/, 'push phase must be conditional on --push');
    assert.ok(!/Auto-push\s*\|\s*Yes/i.test(c()), 'comparison table must not promise auto-push');
  });

  it('AC36: lead writes the handoff, measures context, decides, records', () => {
    assert.match(c(), /handoff/i);
    assert.match(c(), /status rows|status\.md/);
    assert.match(c(), /standing rules|rules\.md/);
    assert.match(c(), /cli\.js context/);
    assert.match(c(), /cli\.js keeplist/);
    assert.match(c(), /cli\.js resume/);
    assert.match(c(), /cli\.js record compaction/);
    assert.match(c(), /prune_below_pct|50%/);
    assert.match(c(), /clear_above_pct|80%/);
    assert.match(c(), /\/compact/);
    assert.match(c(), /\/clear/);
    assert.match(c(), /cannot (run|compact)|only (the person|you) can run/i);
  });

  it('AC36: works without an active marathon run', () => {
    assert.match(c(), /no (active )?marathon run|without a marathon run|not active/i);
  });

  it('m11: the lead commits the handoff before the background agent is dispatched', () => {
    const handoff = c().indexOf('Handoff');
    const dispatch = c().indexOf('Background Dispatch');
    assert.ok(handoff > -1 && dispatch > -1);
    assert.ok(handoff < dispatch, 'handoff checkpoint must come before background dispatch');
    assert.match(c(), /only its own paths|only the paths it wrote/i);
  });

  it('has no literal backtick escaping artifacts', () => {
    assert.ok(!c().includes('\\`'));
  });
});

describe('/bc and /bcp aliases', () => {
  it('AC37: bc aliases without --push', () => {
    assert.match(commands.bc.content, /w-background-compound/);
    assert.ok(!commands.bc.content.includes('--push'));
    assert.match(commands.bc.content, /never push|no push|does not push/i);
  });

  it('AC37: bcp aliases with --push', () => {
    assert.ok(commands.bcp, 'bcp alias missing');
    assert.match(commands.bcp.content, /w-background-compound/);
    assert.match(commands.bcp.content, /--push/);
    assert.match(commands.bcp.content, /# \/bcp/);
    assert.match(commands.bcp.description, /push/i);
  });
});

describe('docs and version', () => {
  it('AC38: WORKFLOW-SHORTCUTS gains a Marathon section and /bc vs /bcp', () => {
    const md = generateWorkflowShortcuts();
    assert.match(md, /### .*Marathon/);
    assert.match(md, /\/w-marathon/);
    assert.match(md, /\/mt\b/);
    assert.match(md, /\/bcp\b/);
    assert.match(md, /finish line/i);
  });

  it('AC38: README documents the command, run dir, config, hooks, /bcp and shadowing', async () => {
    const readme = await fs.readFile(path.join(PROJECT_ROOT, 'README.md'), 'utf-8');
    assert.match(readme, /\/w-marathon/);
    assert.match(readme, /\/mt\b/);
    assert.match(readme, /\/bcp\b/);
    assert.match(readme, /marathon\.json/);
    assert.match(readme, /finish-line\.json/);
    assert.match(readme, /PreCompact/);
    assert.match(readme, /SessionStart/);
    assert.match(readme, /shadow/i);
    assert.match(readme, /\.claude\/marathon\//);
  });

  it('AC39: package.json is at least 4.3.0 with fast-check as a devDependency', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    assert.ok(pkg.version.split('.').map(Number).reduce((d, n, i) => d || n - [4, 3, 0][i], 0) >= 0, `version ${pkg.version} is below 4.3.0`);
    assert.ok(pkg.devDependencies && pkg.devDependencies['fast-check']);
  });
});
