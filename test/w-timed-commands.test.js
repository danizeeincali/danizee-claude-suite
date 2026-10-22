/**
 * Tests for the /w-marathon-times (/mtt) and /w-bug-hunt (/bh) command content.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const commands = getCommands();

for (const [name, alias] of [['w-marathon-times', 'mtt'], ['w-bug-hunt', 'bh']]) {
  describe(`/${name} and /${alias}`, () => {
    const c = () => commands[name].content;

    it('is registered with its header, and the alias hands over to it', () => {
      assert.ok(commands[name], `${name} missing from getCommands()`);
      assert.ok(c().startsWith(`# /${name}\n`));
      assert.ok(commands[alias].content.startsWith(`# /${alias} — alias for /${name}\n`), 'the bbs usage counter reads aliases from this header');
      assert.match(commands[alias].content, new RegExp(`\\.shortcuts:${name}`));
      assert.match(commands[alias].description, new RegExp(`alias for /${name}`));
    });

    it('uses TaskCreate first, never TodoWrite, and has no escaped backticks', () => {
      assert.match(c(), /MANDATORY FIRST ACTION[\s\S]*TaskCreate/);
      assert.ok(!c().includes('TodoWrite'));
      assert.ok(!c().includes('\\`'));
    });

    it('takes a duration or a clock time with a zone, read by the deadline script', () => {
      assert.match(c(), /5h/);
      assert.match(c(), /12pm PST/);
      assert.match(c(), /cli\.js deadline parse <time>/);
      assert.match(c(), /cli\.js deadline set <time>/);
      assert.match(c(), /--mode timed/);
    });

    it('stops on the clock: deadline before every step, nothing new after exit 2, then a wrap-up', () => {
      assert.match(c(), /`cli\.js deadline`/);
      assert.match(c(), /Exit 2 → (go to )?CHECKPOINT 5/);
      assert.match(c(), /Wrap-up/);
      assert.match(c(), /cli\.js finish/);
      assert.match(c(), /--replace/);
    });

    it('keeps the marathon guard rails', () => {
      assert.match(c(), /cli\.js budget/);
      assert.match(c(), /non-zero/);
      assert.match(c(), /NEVER weaken|never weaken|NEVER weaken, skip or delete/i);
      assert.match(c(), /NEVER push or merge without the owner's go/);
      assert.match(c(), /waitingOnHuman/);
      assert.match(c(), /\/bc\b/);
      assert.match(c(), /Nothing, go\./);
      assert.match(c(), /--resume/);
      assert.match(c(), /--status/);
      assert.match(c(), /\.claude\/commands\/\.shortcuts\/w-marathon\.md/, 'shared steps point at the installed /w-marathon file');
      assert.ok(!/fable/i.test(c()));
    });

    it('is installed as a shortcut file equal to the generator output', async () => {
      for (const n of [name, alias]) {
        const file = await fs.readFile(path.join(ROOT, '.claude', 'commands', '.shortcuts', `${n}.md`), 'utf-8');
        assert.equal(file, commands[n].content, `${n}.md is stale: regenerate from dot-shortcuts.js`);
      }
    });
  });
}

describe('/w-marathon-times specifics', () => {
  const c = () => commands['w-marathon-times'].content;
  it('has the timed finish line and the run-out rule', () => {
    assert.match(c(), /reviews\.count/);
    assert.match(c(), /If the backlog runs out/);
    assert.match(c(), /wrap-up\.md/);
  });
});

describe('/w-bug-hunt specifics', () => {
  const c = () => commands['w-bug-hunt'].content;
  it('hunts with a Workflow of read-only hunters and a separate verifier per claim', () => {
    assert.match(c(), /Workflow tool/);
    assert.match(c(), /export const meta = \{/);
    assert.match(c(), /pipeline\(/);
    assert.match(c(), /model: 'opus'/);
    assert.match(c(), /read-only/i);
    assert.match(c(), /The verifier is never the hunter/);
  });

  it('counts a bug only when a program proves it twice; the rest are leads', () => {
    assert.match(c(), /replay-gate --file/);
    assert.match(c(), /leads\.md/);
    assert.match(c(), /found_by=hunter/);
    assert.match(c(), /--init|init bh-<slug> --mode timed --command w-bug-hunt/);
  });

  it('uses the suite workflows and ends with a report', () => {
    assert.match(c(), /\/w-debug/);
    assert.match(c(), /\/w-fix/);
    assert.match(c(), /\/w-security/);
    assert.match(c(), /--report-only/);
    assert.match(c(), /bug-hunt-report\.md/);
    assert.match(c(), /reflect lessons save --role bh --text-file/);
  });
});
