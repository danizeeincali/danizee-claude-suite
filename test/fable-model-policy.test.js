/**
 * Tests for the 2026-07 fable/sonnet model-policy port (v4.3.0).
 *
 * Policy: fable (claude-fable-5) wherever thinking is required; sonnet
 * (Sonnet 5) for all execution; every fable mention carries an inline opus
 * fallback for when fable access is removed or usage is exhausted. The haiku
 * tier is retired. Applies suite-wide: every w- command in the dot-shortcuts
 * plugin (aliases excepted) plus the standalone w-bg-* installed workflows.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const COMMANDS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands');
const SHORTCUTS_DIR = path.join(COMMANDS_DIR, '.shortcuts');

const commands = getCommands();
const ALIASES = ['pt', 'bc'];
const WORKFLOWS = Object.keys(commands).filter(
  (n) => n.startsWith('w-') && !ALIASES.includes(n)
);
const BG_STANDALONE = [
  'w-bg-debug',
  'w-bg-perf',
  'w-bg-review',
  'w-bg-security',
  'w-bg-tdd-swarm',
  'w-bg-idea-tdd-swarm',
];

const FALLBACK_RE = /fall back to\s*`?(model:\s*"?)?opus/i;
const UNAVAILABLE_RE = /(unavailable|access removed|usage (is )?exhausted|run[s]? out of usage)/i;

function assertPolicy(name, content) {
  assert.match(content, /## Model Policy|Model Policy/, `${name}: Model Policy section missing`);
  assert.match(content, /fable/i, `${name}: fable routing missing`);
  assert.match(content, /sonnet/i, `${name}: sonnet routing missing`);
  assert.match(content, FALLBACK_RE, `${name}: opus fallback clause missing`);
  assert.match(content, UNAVAILABLE_RE, `${name}: fallback trigger conditions missing`);
  assert.ok(!/haiku/i.test(content), `${name}: haiku tier must be retired`);
}

describe('Fable policy — every plugin w- workflow routes fable/sonnet with opus fallback', () => {
  for (const name of WORKFLOWS) {
    it(`${name}: has fable/sonnet policy with opus fallback, no haiku`, () => {
      assertPolicy(name, commands[name].content);
    });
  }
});

describe('Fable policy — w-plan-tdd-swarm per-checkpoint routing', () => {
  const pt = () => commands['w-plan-tdd-swarm'].content;

  it('escalation ladder is sonnet → fable (opus substituted when fable unavailable)', () => {
    assert.match(pt(), /sonnet\s*→\s*fable/i, 'ladder must escalate sonnet → fable');
    assert.ok(!/sonnet\s*→\s*opus\s*→/i.test(pt()), 'old sonnet → opus ladder must be gone');
  });

  it('routes Search sweeps to sonnet (haiku retired)', () => {
    const c = pt();
    const search = c.slice(c.indexOf('CHECKPOINT 0: Search'), c.indexOf('CHECKPOINT 0.5'));
    assert.match(search, /model:\s*"?sonnet/i, 'Search phase must route sonnet');
    assert.ok(!/haiku/i.test(search), 'Search phase must not route haiku');
  });

  it('routes hard Builds to fable with escalation', () => {
    const c = pt();
    const build = c.slice(c.indexOf('CHECKPOINT 5: Build'), c.indexOf('CHECKPOINT 6: Review'));
    assert.match(build, /model:\s*"?sonnet/i, 'Build phase missing sonnet routing');
    assert.match(build, /fable/i, 'Build phase missing fable routing for hard builds');
    assert.match(build, /escalat/i, 'Build phase missing escalation rule');
  });

  it('routes adversarial Review to fable with opus fallback', () => {
    const c = pt();
    const review = c.slice(c.indexOf('CHECKPOINT 6: Review'), c.indexOf('VERIFICATION CHECKPOINT'));
    assert.match(review, /fable/i, 'Review phase missing fable directive');
    assert.match(review, /opus/i, 'Review phase missing opus fallback');
  });

  it('Dynamic Workflows opts.model guidance uses fable/sonnet, not haiku', () => {
    const c = pt();
    const dyn = c.slice(c.indexOf('## Dynamic Workflows'), c.indexOf('## Execution Protocol'));
    assert.match(dyn, /model:\s*"?fable/i, 'opts.model guidance missing fable');
    assert.match(dyn, /model:\s*"?sonnet/i, 'opts.model guidance missing sonnet');
    assert.ok(!/haiku/i.test(dyn), 'opts.model guidance must not suggest haiku');
  });
});

describe('Fable policy — w-background-compound dispatch', () => {
  it('dispatches on sonnet with sonnet utility probes (no haiku)', () => {
    const c = commands['w-background-compound'].content;
    assert.match(c, /model:\s*"?sonnet/i, 'sonnet dispatch missing');
    assert.ok(!/haiku/i.test(c), 'haiku must be retired from utility probes');
    assert.match(c, FALLBACK_RE, 'opus fallback clause missing');
  });
});

describe('Fable policy — standalone w-bg-* installed workflows', () => {
  for (const name of BG_STANDALONE) {
    it(`${name}.md: has fable/sonnet policy with opus fallback`, async () => {
      const content = await fs.readFile(
        path.join(SHORTCUTS_DIR, `${name}.md`), 'utf-8'
      );
      assertPolicy(name, content);
    });
  }
});

describe('Surface integrity — no escaping artifacts anywhere', () => {
  for (const name of Object.keys(commands)) {
    it(`${name}: rendered content has no literal \\\` sequences`, () => {
      assert.ok(!commands[name].content.includes('\\`'),
        `${name} renders literal backslash-backtick (double-escaping bug)`);
    });
  }
});

describe('Surface integrity — installed copies match plugin templates', () => {
  for (const name of Object.keys(commands)) {
    it(`${name}: any installed .claude copy is byte-identical to the template`, async () => {
      const candidates = [
        path.join(SHORTCUTS_DIR, `${name}.md`),
        path.join(COMMANDS_DIR, `${name}.md`),
      ];
      let installed = null;
      for (const p of candidates) {
        try { installed = await fs.readFile(p, 'utf-8'); break; } catch { /* try next */ }
      }
      if (installed === null) return; // no installed copy — installer generates on init
      assert.equal(installed, commands[name].content, `${name} installed copy drifted from source`);
    });
  }
});

describe('Release', () => {
  it('package.json is bumped to 4.3.0', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    assert.equal(pkg.version, '4.3.0');
  });
});
