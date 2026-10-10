/**
 * Tests for the /w-marathon and /mt command content — AC 34–35.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const SHORTCUTS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts');

const commands = getCommands();

describe('/w-marathon command content', () => {
  const c = () => commands['w-marathon'].content;

  it('is registered with the right header and description', () => {
    assert.ok(commands['w-marathon'], 'w-marathon missing from getCommands()');
    assert.ok(c().includes('# /w-marathon'));
    assert.match(commands['w-marathon'].description, /finish line|marathon/i);
  });

  it('uses TaskCreate first, never TodoWrite', () => {
    assert.match(c(), /TaskCreate/);
    assert.ok(!c().includes('TodoWrite'));
  });

  it('has the seven phases', () => {
    for (const phase of ['Search', 'Interview', 'Kickoff', 'Arm', 'Loop', 'Stop', 'Compound']) {
      assert.match(c(), new RegExp(`CHECKPOINT[^\\n]*${phase}`), `phase ${phase} missing`);
    }
  });

  it('interview asks the four kickoff lines and ends with "Nothing, go."', () => {
    assert.match(c(), /Done means/);
    assert.match(c(), /decide on your own|may decide alone/i);
    assert.match(c(), /Ask me before/);
    assert.match(c(), /Never:/);
    assert.match(c(), /Nothing, go/);
    assert.match(c(), /AskUserQuestion/);
  });

  it('names every cli.js verb it depends on', () => {
    for (const verb of ['budget', 'gate --stream', 'record', 'record finding-fixed', 'status', 'wake', 'resume', 'seen-twice', 'review-brief', 'review-writeup', 'promote', 'init', 'stream', 'route', 'model-stats', 'finish']) {
      assert.match(c(), new RegExp(`cli\\.js ${verb}`), `verb ${verb} missing`);
    }
    assert.match(c(), /\.claude\/helpers\/marathon\/cli\.js/);
  });

  it('enforces the budget stop rule and the waitingOnHuman rule', () => {
    assert.match(c(), /exit (code )?2/);
    assert.match(c(), /any non-zero exit/i, 'f9: a crash (exit 1) must also stop spawning');
    assert.match(c(), /cli\.js repair/, 'g4: the protocol names the repair verb for corrupt rows');
    assert.match(c(), /streak began|start of the streak|same code/i, 'g6: the diff rule for a streak');
    assert.match(c(), /never (spawn|start) (a|any) helper/i);
    assert.match(c(), /waitingOnHuman/);
    assert.match(c(), /never retr/i);
    assert.match(c(), /never weaken an assertion/i);
  });

  it('has resume and status modes and a worktree per stream', () => {
    assert.match(c(), /--resume/);
    assert.match(c(), /--status/);
    assert.match(c(), /worktree/i);
    assert.match(c(), /status\.md/);
    assert.match(c(), /finish-line\.json/);
    assert.match(c(), /checklist\.md/);
  });

  it('carries the model policy (sonnet builds, opus reviews, haiku routines) and no premium name', () => {
    assert.match(c(), /Model Policy/);
    assert.match(c(), /sonnet/);
    assert.match(c(), /opus/);
    assert.match(c(), /haiku/);
    assert.ok(!/fable/i.test(c()));
  });

  it('wires the review loop: diff since the last certified point, two clean reviews, promote seen-twice, /bc per stream', () => {
    assert.match(c(), /certified point/i, 'k10: a single clean round does not move the base');
    assert.match(c(), /two clean reviews|clean reviews in a row|passes_in_a_row/i);
    assert.match(c(), /seen twice|seen-twice/i);
    assert.match(c(), /\/bc\b/);
  });

  it('arms the wake-up and prints the fallback', () => {
    assert.match(c(), /CronCreate|cron/i);
    assert.match(c(), /launchd|crontab/i);
    assert.match(c(), /get_usage/);
  });

  it('has no literal backtick escaping artifacts', () => {
    assert.ok(!c().includes('\\`'), 'rendered content must not contain escaped backticks');
  });

  it('the integration stream from a bbs hand-off wires approved steps, records wired and delivered, and is reviewed on the command files', () => {
    assert.match(c(), /4\.3a Integration stream/);
    assert.match(c(), /reach test\*\* that goes in through that place/);
    assert.match(c(), /bbs\/cli\.js integrate --run <bbs run> --power <name>/);
    assert.match(c(), /cli\.js wired --run <bbs run> --power <name> --record/);
    assert.match(c(), /cli\.js delivered --run <bbs run> --record/);
    assert.match(c(), /reached in the normal flow \(a menu links the page, the router mounts the endpoint/);
  });
});

describe('/mt alias', () => {
  it('invokes .shortcuts:w-marathon with verbatim args', () => {
    assert.ok(commands.mt, 'mt alias missing');
    assert.match(commands.mt.content, /\.shortcuts:w-marathon/);
    assert.match(commands.mt.content, /verbatim/);
    assert.match(commands.mt.content, /TaskCreate/);
  });
});

describe('repo copy of the shortcuts is regenerated', () => {
  it('w-marathon.md, mt.md and bcp.md exist in .claude/commands/.shortcuts', async () => {
    for (const f of ['w-marathon.md', 'mt.md', 'bcp.md']) {
      const st = await fs.stat(path.join(SHORTCUTS_DIR, f));
      assert.ok(st.isFile(), `${f} missing`);
    }
    const md = await fs.readFile(path.join(SHORTCUTS_DIR, 'w-marathon.md'), 'utf-8');
    assert.equal(md, commands['w-marathon'].content);
  });
});
