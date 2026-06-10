/**
 * Tests for the 2026-06 dev-practices port: per-step Model Policy, Dynamic
 * Workflows, property-based testing guidance, and pt/bc mobile aliases.
 *
 * Asserts BOTH surfaces for every touched command: the plugin source template
 * (what installers ship) and this repo's own installed .claude/commands copy —
 * and locks them byte-identical so they can't drift again. Also locks a
 * cleanliness invariant: rendered content must not contain literal \`
 * sequences (the historic double-escaping bug).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const SHORTCUTS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts');

const commands = getCommands();
const TOUCHED = ['w-plan-tdd-swarm', 'w-background-compound', 'pt', 'bc'];

describe('Model Policy — w-plan-tdd-swarm', () => {
  const pt = () => commands['w-plan-tdd-swarm'].content;

  it('has a Model Policy section with the generic escalation ladder', () => {
    assert.ok(pt().includes('## Model Policy'), 'Model Policy section missing');
    assert.match(pt(), /sonnet\s*→\s*opus\s*→\s*(your\s+)?session model/i, 'generic ladder missing');
  });

  it('routes Search to haiku, Build to sonnet/opus, Review to opus', () => {
    const c = pt();
    const search = c.slice(c.indexOf('CHECKPOINT 0: Search'), c.indexOf('CHECKPOINT 0.5'));
    assert.match(search, /haiku/, 'Search phase missing haiku directive');
    const build = c.slice(c.indexOf('CHECKPOINT 5: Build'), c.indexOf('CHECKPOINT 6: Review'));
    assert.match(build, /model:\s*"?sonnet/i, 'Build phase missing sonnet routing');
    assert.match(build, /opus/, 'Build phase missing opus routing');
    assert.match(build, /escalat/i, 'Build phase missing escalation rule');
    const review = c.slice(c.indexOf('CHECKPOINT 6: Review'), c.indexOf('VERIFICATION CHECKPOINT'));
    assert.match(review, /opus/, 'Review phase missing opus directive');
  });

  it('never names a specific premium model as the ceiling (generic-tier invariant)', () => {
    assert.ok(!/fable/i.test(pt()), 'suite content must not reference fable');
    assert.ok(!/fable/i.test(commands['w-background-compound'].content));
  });
});

describe('Model Policy — w-background-compound', () => {
  it('dispatches the background agent on sonnet', () => {
    const c = commands['w-background-compound'].content;
    assert.ok(/## Model Policy|Model policy/.test(c), 'Model Policy blurb missing');
    assert.match(c, /model:\s*"?sonnet/i, 'sonnet dispatch missing');
  });
});

describe('Dynamic Workflows + PBT — w-plan-tdd-swarm', () => {
  const pt = () => commands['w-plan-tdd-swarm'].content;

  it('has the HIL-gated Dynamic Workflows section with opts.model guidance', () => {
    assert.ok(pt().includes('## Dynamic Workflows'), 'Dynamic Workflows section missing');
    assert.match(pt(), /HIL gate/i, 'HIL gate missing');
    assert.match(pt(), /opts\.model/, 'agent() opts.model rule missing');
  });

  it('has the Checkpoint 2.5 workflow assessment', () => {
    assert.match(pt(), /CHECKPOINT 2\.5/, 'Checkpoint 2.5 missing');
  });

  it('has property-based testing guidance in the Tests checkpoint', () => {
    const c = pt();
    const tests = c.slice(c.indexOf('CHECKPOINT 4: Tests'), c.indexOf('CHECKPOINT 5: Build'));
    assert.match(tests, /PROPERTY-BASED|property test/i, 'PBT block missing');
    assert.match(tests, /fast-check/, 'fast-check suggestion missing');
  });
});

describe('pt/bc mobile aliases', () => {
  it('registers pt aliasing w-plan-tdd-swarm', () => {
    assert.ok(commands.pt, 'pt command missing');
    assert.match(commands.pt.content, /w-plan-tdd-swarm/);
  });

  it('registers bc aliasing w-background-compound', () => {
    assert.ok(commands.bc, 'bc command missing');
    assert.match(commands.bc.content, /w-background-compound/);
  });
});

describe('Surface integrity for touched commands', () => {
  for (const name of TOUCHED) {
    it(`${name}: rendered content has no literal \\\` escaping artifacts`, () => {
      assert.ok(commands[name], `${name} missing from plugin`);
      assert.ok(!commands[name].content.includes('\\`'),
        `${name} renders literal backslash-backtick (double-escaping bug)`);
    });

    it(`${name}: installed .claude copy is byte-identical to the plugin template`, async () => {
      // pt/bc are top-level commands (not .shortcuts) if the installer puts
      // aliases there; accept either location.
      const candidates = [
        path.join(SHORTCUTS_DIR, `${name}.md`),
        path.join(PROJECT_ROOT, '.claude', 'commands', `${name}.md`),
      ];
      let installed = null;
      for (const p of candidates) {
        try { installed = await fs.readFile(p, 'utf-8'); break; } catch { /* try next */ }
      }
      assert.ok(installed !== null, `${name} has no installed copy in .claude/commands`);
      assert.equal(installed, commands[name].content, `${name} installed copy drifted from source`);
    });
  }
});

describe('Pi Brain read-only — BEHAVIORAL invariant (not just banned strings)', () => {
  // Commit 7e17b06 made the suite read-only/discovery. The historic guard
  // (pi-brain-read-only.test.js) bans specific strings; this locks the
  // BEHAVIOR for the commands this port touched: no instruction may tell the
  // model to vote/share automatically (e.g. conditioned on tests passing).
  for (const name of TOUCHED) {
    it(`${name}: contains no automatic vote/share instruction`, () => {
      const c = commands[name].content;
      assert.ok(!/cast a (directional )?vote/i.test(c),
        `${name} instructs casting a vote`);
      assert.ok(!/(if|when)[^\n]{0,100}(tests? pass|correctness|grade)[^\n]{0,160}\bvote\b/i.test(c),
        `${name} conditions a vote on test results (auto-vote semantics)`);
      assert.ok(!/curl -X POST[^\n]{0,120}\/vote/.test(c),
        `${name} contains an executable vote POST as a workflow step`);
    });
  }
});

describe('Release', () => {
  it('package.json is bumped to 4.2.0', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    assert.equal(pkg.version, '4.2.0');
  });
});
