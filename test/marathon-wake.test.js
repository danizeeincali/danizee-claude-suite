/**
 * Tests for src/lib/marathon/wake.js — AC 24.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cronSpec, fallbackSnippets } from '../src/lib/marathon/wake.js';

describe('wake — cronSpec', () => {
  it('defaults to :17 and :47 and tells Claude to read status.md, take the next step, stop if idle', () => {
    const spec = cronSpec({ runId: '2026-10-07-bbs', runDirRel: '.claude/marathon/2026-10-07-bbs' });
    assert.equal(spec.schedule, '17,47 * * * *');
    assert.match(spec.prompt, /status\.md/);
    assert.match(spec.prompt, /next step/i);
    assert.match(spec.prompt, /stop/i);
    assert.match(spec.prompt, /2026-10-07-bbs/);
  });

  it('accepts a custom schedule', () => {
    assert.equal(cronSpec({ runId: 'x', runDirRel: 'y', schedule: '*/30 * * * *' }).schedule, '*/30 * * * *');
  });
});

describe('wake — fallbackSnippets', () => {
  const snippets = fallbackSnippets({ projectDir: '/Users/demi/code/repo', runId: '2026-10-07-bbs', cliRel: '.claude/helpers/marathon/cli.js', runsRel: 'ops/marathon' });

  it('crontab line runs claude -p with the resume line from the project dir', () => {
    assert.match(snippets.crontab, /claude -p/);
    assert.match(snippets.crontab, /\/Users\/demi\/code\/repo/);
    assert.match(snippets.crontab, /cli\.js resume/);
    assert.match(snippets.crontab, /wake\.log/);
  });

  it('m6: the fallback can run unattended — PATH set, guarded by --if-active, log path from config', () => {
    assert.match(snippets.crontab, /^PATH=/m, 'cron PATH lacks node/claude by default');
    assert.match(snippets.crontab, /--if-active/);
    assert.match(snippets.crontab, /--idle-minutes \d+/, 'g10: stay quiet while a live session is writing status.md');
    assert.match(snippets.crontab, /\|\|\s*exit 0/);
    assert.match(snippets.crontab, /ops\/marathon\/2026-10-07-bbs\/wake\.log/);
    assert.ok(!snippets.crontab.includes('.claude/marathon/2026-10-07-bbs/wake.log'), 'runs dir not hard-coded');
    assert.match(snippets.crontab, /--permission-mode/);
    assert.match(snippets.launchd, /--if-active/);
    assert.match(snippets.launchd, /<key>EnvironmentVariables<\/key>|PATH/);
  });

  it('launchd snippet is a plist with the same command', () => {
    assert.match(snippets.launchd, /<plist/);
    assert.match(snippets.launchd, /claude/);
    assert.match(snippets.launchd, /2026-10-07-bbs/);
    assert.match(snippets.launchd, /StartCalendarInterval|StartInterval/);
  });
});
