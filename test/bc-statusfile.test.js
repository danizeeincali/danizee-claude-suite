/**
 * Unit tests for src/lib/bc/statusfile.js and src/lib/bc/config.js — the status table, keep-list,
 * resume line and handoff stamp /bc builds without a marathon run.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { parseStatusTable, activeStream, buildKeepList, resumeLine, stampStatus } from '../src/lib/bc/statusfile.js';
import { loadBcConfig, validateBcConfig, DEFAULT_BC_CONFIG } from '../src/lib/bc/config.js';

const STATUS = `# Work streams

| Stream | Where (folder / branch) | Plan | State | Next | Phase | Skill | Tasks |
|---|---|---|---|---|---|---|---|
| XP bar | ~/code/app · feat/xp | plans/xp.md | active | owner plays | 3 | pt | bj5160aec |
| Checkout | ~/code/app-shop | plans/checkout.md | queued | fix round 3 | — | — | — |
| Intro | ~/code/app | plans/intro.md | done — merged | — | — | — | — |
| Replit \\| launch | — | — | blocked | waiting on Dani | — | — | — |
`;

describe('bc statusfile — parseStatusTable', () => {
  it('reads rows by header, with phase, skill and tasks', () => {
    const rows = parseStatusTable(STATUS);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map(r => r.name), ['XP bar', 'Checkout', 'Intro', 'Replit | launch']);
    assert.equal(rows[0].active, true);
    assert.equal(rows[0].phase, '3');
    assert.equal(rows[0].skill, 'pt');
    assert.deepEqual(rows[0].tasks, ['bj5160aec']);
    assert.deepEqual(rows[1].tasks, []);
    assert.equal(rows[2].finished, true);
    assert.equal(rows[3].finished, false);
  });

  it('takes phase and skill from text in a combined "State and next step" column', () => {
    const md = `| Stream | Where | Plan | State and next step |\n|---|---|---|---|\n| Checkout | x | y | Active: /pt phase 4 running. Next: merge. |\n`;
    const [row] = parseStatusTable(md);
    assert.equal(row.active, true);
    assert.equal(row.phase, '4');
    assert.equal(row.skill, 'pt');
    assert.equal(row.next, '', 'the combined column is the state, not a second copy as next');
  });

  it('does not read a path as a skill', () => {
    const md = `| Stream | State |\n|---|---|\n| A | active in .claude/plans/x.md and src/lib |\n`;
    assert.equal(parseStatusTable(md)[0].skill, '');
  });

  it('reads this repo\'s own STATUS.md layout (finished words, no active row)', async () => {
    const md = await fs.readFile(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.claude', 'plans', 'STATUS.md'), 'utf-8');
    const rows = parseStatusTable(md);
    assert.ok(rows.length >= 3);
    assert.ok(rows.some(r => r.finished), 'FINISHED / shipped / done rows are finished');
    assert.ok(rows.some(r => !r.finished));
  });

  it('a file without a table yields no rows and no active stream', () => {
    assert.deepEqual(parseStatusTable('# nothing here\n'), []);
    assert.equal(activeStream([]), null);
  });

  it('activeStream prefers the active row, else the first open one', () => {
    const rows = parseStatusTable(STATUS);
    assert.equal(activeStream(rows).name, 'XP bar');
    assert.equal(activeStream(rows.slice(1)).name, 'Checkout');
    assert.equal(activeStream(rows.filter(r => r.finished)), null);
  });
});

describe('bc statusfile — keep-list', () => {
  const rows = parseStatusTable(STATUS);
  const line = buildKeepList({ kickoff: 'docs/KICKOFF.md', status: '.claude/plans/STATUS.md', rules: '.claude/plans/RULES.md', rows, lastCommit: '0b66563' });

  it('is one ready-to-run /compact line', () => {
    assert.ok(line.startsWith('/compact Keep only: '));
    assert.ok(!line.includes('\n'));
  });

  it('names the kickoff, open streams, rules, last commit and running tasks', () => {
    for (const s of ['docs/KICKOFF.md', '.claude/plans/STATUS.md', 'XP bar', 'Checkout', 'Replit | launch', '.claude/plans/RULES.md', '0b66563', 'bj5160aec']) {
      assert.ok(line.includes(s), `missing ${s}: ${line}`);
    }
  });

  it('never names a finished stream', () => {
    assert.ok(!line.includes('Intro'), line);
  });

  it('says so when no stream is open', () => {
    const l = buildKeepList({ status: 'S.md', rows: rows.filter(r => r.finished) });
    assert.match(l, /no open streams/);
    assert.match(l, /running tasks: none/);
  });
});

describe('bc statusfile — resume line', () => {
  const rows = parseStatusTable(STATUS);

  it('names the files, the active stream, its skill and phase', () => {
    const l = resumeLine({ kickoff: 'K.md', status: 'S.md', rules: 'R.md', memory: 'docs/solutions', row: activeStream(rows), plain: true });
    assert.ok(!l.includes('\n'));
    assert.match(l, /^Read K\.md, S\.md, R\.md and the memory index \(docs\/solutions\/\)/);
    assert.match(l, /continue stream "XP bar" \(next: owner plays\)/);
    assert.match(l, /reload that skill and continue from that phase/);
    assert.match(l, /\/pt at phase 3/);
  });

  it('without --plain the stream row follows', () => {
    const l = resumeLine({ status: 'S.md', row: activeStream(rows) });
    const [, row] = l.split('\n');
    assert.equal(row, '| XP bar | active | 3 | owner plays |');
  });

  it('with no open stream it still points at the files', () => {
    assert.match(resumeLine({ status: 'S.md', row: null }), /no stream in it is open/);
  });
});

describe('bc statusfile — handoff stamp', () => {
  const info = { ts: '2026-10-10T00:00:00.000Z', trigger: 'auto', branch: 'main', commit: 'abc1234', uncommitted: 2, tasks: ['t1'], pct: 96.8 };

  it('appends once and replaces in place after that, leaving the table untouched', () => {
    const once = stampStatus(STATUS, info);
    assert.ok(once.startsWith(STATUS));
    assert.match(once, /trigger auto · branch main · commit abc1234 · 2 uncommitted files · context 96\.8% · running tasks: t1/);
    const twice = stampStatus(once, { ...info, trigger: 'manual', pct: null });
    assert.equal(twice.match(/<!-- bc:handoff -->/g).length, 1);
    assert.match(twice, /trigger manual/);
    assert.ok(!twice.includes('trigger auto'));
    assert.ok(!twice.includes('context '));
    assert.deepEqual(parseStatusTable(twice), parseStatusTable(STATUS));
  });
});

describe('bc config', () => {
  let dir;
  before(async () => {
    dir = path.join(os.tmpdir(), `bc-config-${process.pid}-${Date.now()}`);
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('defaults when bc.json is absent', async () => {
    const r = await loadBcConfig(dir);
    assert.equal(r.configured, false);
    assert.deepEqual(r.config, DEFAULT_BC_CONFIG);
  });

  it('thresholds resolve bc.json over marathon.json over defaults', async () => {
    await fs.writeFile(path.join(dir, '.claude', 'marathon.json'), JSON.stringify({ bc: { prune_below_pct: 40, context_window: 200000 } }));
    let r = await loadBcConfig(dir);
    assert.equal(r.config.prune_below_pct, 40);
    assert.equal(r.config.context_window, 200000);
    await fs.writeFile(path.join(dir, '.claude', 'bc.json'), JSON.stringify({ status: 'docs/STATUS.md', prune_below_pct: 60 }));
    r = await loadBcConfig(dir);
    assert.equal(r.configured, true);
    assert.equal(r.config.status, 'docs/STATUS.md');
    assert.equal(r.config.prune_below_pct, 60);
    assert.equal(r.config.context_window, 200000);
  });

  it('rejects bad JSON and paths outside the project', async () => {
    await fs.writeFile(path.join(dir, '.claude', 'bc.json'), '{ nope');
    await assert.rejects(loadBcConfig(dir), /invalid JSON/);
    assert.deepEqual(validateBcConfig({ status: '../x.md' }), ['status must be a path inside the project']);
    assert.deepEqual(validateBcConfig({ status: '/etc/x' }), ['status must be a path inside the project']);
    assert.deepEqual(validateBcConfig({ prune_below_pct: 90, clear_above_pct: 80 }), ['prune_below_pct must not exceed clear_above_pct']);
    assert.deepEqual(validateBcConfig({ context_window: 0 }), ['context_window must be a positive number']);
    assert.deepEqual(validateBcConfig({ kickoff: null }), []);
  });
});
