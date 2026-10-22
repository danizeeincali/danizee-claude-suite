/**
 * Tests for timed runs: src/lib/marathon/deadline.js (time specs, wrap-up, phases) and the
 * `deadline` verb, `init --mode timed`, the `reviews.count` source, and the resume line, status
 * and wake-up of a timed run — what /w-marathon-times and /w-bug-hunt depend on.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { parseTimeSpec, parseDuration, parseClock, parseZone, wrapUpMinutes, deadlineState, deadlineLine, formatMinutes } from '../src/lib/marathon/deadline.js';
import { resolveSource, validateFinishLine } from '../src/lib/marathon/gate.js';
import { cronSpec } from '../src/lib/marathon/wake.js';
import { resumeLine } from '../src/lib/marathon/resume.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const CLI = path.join(ROOT, 'src', 'lib', 'marathon', 'cli.js');

// Thu 22 Oct 2026 16:32 UTC = 09:32 PDT
const NOW = Date.parse('2026-10-22T16:32:00Z');

describe('deadline — durations', () => {
  it('reads h, m, d and combinations', () => {
    assert.equal(parseDuration('5h'), 300);
    assert.equal(parseDuration('90m'), 90);
    assert.equal(parseDuration('1h30m'), 90);
    assert.equal(parseDuration('1h 30m'), 90);
    assert.equal(parseDuration('2.5 hours'), 150);
    assert.equal(parseDuration('45 min'), 45);
    assert.equal(parseDuration('1 day'), 1440);
    assert.equal(parseDuration('for 2h'), 120);
  });

  it('refuses bare numbers and clock times', () => {
    assert.equal(parseDuration('5'), null);
    assert.equal(parseDuration('12pm'), null);
    assert.equal(parseDuration('5 parsecs'), null);
    assert.equal(parseDuration(''), null);
  });

  it('a duration counts from now', () => {
    const r = parseTimeSpec('5h', { now: NOW });
    assert.equal(r.kind, 'duration');
    assert.equal(r.deadline, '2026-10-22T21:32:00.000Z');
    assert.equal(r.minutes, 300);
  });

  it('refuses over seven days and under a minute', () => {
    assert.throws(() => parseTimeSpec('8d', { now: NOW }), /over 7 days/);
    assert.throws(() => parseTimeSpec('0m', { now: NOW }), /under 1 minute/);
  });
});

describe('deadline — clock times', () => {
  it('12pm PST means noon Pacific wall-clock time, PDT in October', () => {
    for (const spec of ['12pm PST', '12pm PT', '12pm PDT', 'noon PST', '12:00 America/Los_Angeles', 'until 12pm PST']) {
      const r = parseTimeSpec(spec, { now: NOW });
      assert.equal(r.kind, 'clock', spec);
      assert.equal(r.deadline, '2026-10-22T19:00:00.000Z', spec);
      assert.equal(r.rolled, false, spec);
      assert.equal(r.zone_assumed, false, spec);
    }
    assert.match(parseTimeSpec('12pm PST', { now: NOW }).deadline_local, /12:00 PM PDT/);
  });

  it('PST in January is UTC-8', () => {
    const r = parseTimeSpec('12pm PST', { now: Date.parse('2026-01-15T16:00:00Z') });
    assert.equal(r.deadline, '2026-01-15T20:00:00.000Z');
  });

  it('a time already past today rolls to tomorrow and says so', () => {
    const r = parseTimeSpec('9am PST', { now: NOW });
    assert.equal(r.deadline, '2026-10-23T16:00:00.000Z');
    assert.equal(r.rolled, true);
  });

  it('"today" in the past is an error, "tomorrow" is the next day', () => {
    assert.throws(() => parseTimeSpec('today 8am PST', { now: NOW }), /already past/);
    assert.equal(parseTimeSpec('tomorrow 9am ET', { now: NOW }).deadline, '2026-10-23T13:00:00.000Z');
  });

  it('reads 24-hour times, IANA zones, offsets and dates', () => {
    assert.equal(parseTimeSpec('18:00 Europe/London', { now: NOW }).deadline, '2026-10-22T17:00:00.000Z');
    assert.equal(parseTimeSpec('2026-10-23 08:00 UTC', { now: NOW }).deadline, '2026-10-23T08:00:00.000Z');
    assert.equal(parseTimeSpec('11pm UTC+2', { now: NOW }).deadline, '2026-10-22T21:00:00.000Z');
    assert.equal(parseTimeSpec('23:00 +02:00', { now: NOW }).deadline, '2026-10-22T21:00:00.000Z');
  });

  it('a time with no zone uses the default zone and reports it as assumed', () => {
    const r = parseTimeSpec('1pm', { now: NOW, defaultZone: 'America/New_York' });
    assert.equal(r.deadline, '2026-10-22T17:00:00.000Z');
    assert.equal(r.zone_assumed, true);
    assert.equal(r.zone, 'America/New_York');
  });

  it('refuses what it cannot read', () => {
    for (const bad of ['', 'soon', '13pm PST', '25:00 UTC', '12pm Mars/Base', '2026-02-30 10:00 UTC']) {
      assert.throws(() => parseTimeSpec(bad, { now: NOW }), Error, bad);
    }
  });

  it('parses clock and zone tokens', () => {
    assert.deepEqual(parseClock('12:30pm'), { h: 12, mi: 30 });
    assert.deepEqual(parseClock('12am'), { h: 0, mi: 0 });
    assert.deepEqual(parseClock('midnight'), { h: 0, mi: 0 });
    assert.equal(parseClock('0pm'), null);
    assert.equal(parseZone('pst').zone, 'America/Los_Angeles');
    assert.equal(parseZone('UTC-5').offsetMin, -300);
    assert.equal(parseZone('5'), null);
  });
});

describe('deadline — wrap-up and phases', () => {
  it('the wrap-up reserve is 10% clamped to 10..60 minutes and never over half the run', () => {
    assert.equal(wrapUpMinutes(300), 30);
    assert.equal(wrapUpMinutes(60), 10);
    assert.equal(wrapUpMinutes(1440), 60);
    assert.equal(wrapUpMinutes(12), 6);
    assert.equal(wrapUpMinutes(300, { wrap_up_pct: 20, wrap_up_min_minutes: 5, wrap_up_max_minutes: 45 }), 45);
  });

  it('phases go work → wrap_up → over', () => {
    const d = { start: new Date(NOW).toISOString(), deadline: new Date(NOW + 300 * 60_000).toISOString(), wrap_up_minutes: 30, deadline_local: 'x' };
    assert.equal(deadlineState(d, NOW + 60 * 60_000).phase, 'work');
    assert.equal(deadlineState(d, NOW + 60 * 60_000).work_minutes_left, 210);
    assert.equal(deadlineState(d, NOW + 280 * 60_000).phase, 'wrap_up');
    assert.equal(deadlineState(d, NOW + 300 * 60_000).phase, 'over');
    assert.equal(deadlineState(d, NOW + 400 * 60_000).remaining_minutes, 0);
    assert.match(deadlineLine(d, NOW + 280 * 60_000), /wrap up, start nothing new/);
    assert.equal(formatMinutes(125), '2h 05m');
  });
});

describe('gate — reviews.count source', () => {
  it('counts reviews and validates as a known source', () => {
    assert.deepEqual(resolveSource('reviews.count', { reviews: [{}, {}] }), { found: true, value: 2 });
    assert.deepEqual(resolveSource('reviews.count', {}), { found: true, value: 0 });
    const errors = validateFinishLine({ tolerance: { high: 0, medium: 2, low: 5, passes_in_a_row: 1 },
      lines: [{ id: 'reviewed', label: 'Reviews held', type: 'number', op: 'at_least', value: 1, owner: 'build', source: 'reviews.count' }] });
    assert.deepEqual(errors, []);
  });
});

describe('wake and resume name the run command', () => {
  it('a timed cron prompt checks the deadline first', () => {
    const p = cronSpec({ runId: 'r1', runDirRel: '.claude/marathon/r1', command: 'w-bug-hunt', timed: true }).prompt;
    assert.match(p, /\/w-bug-hunt/);
    assert.match(p, /cli\.js deadline --run r1/);
    assert.match(p, /exit 2/);
  });

  it('a plain marathon prompt is unchanged in substance', () => {
    const p = cronSpec({ runId: 'r1', runDirRel: 'x' }).prompt;
    assert.doesNotMatch(p, /deadline/);
    assert.match(p, /cli\.js gate/);
  });

  it('resumeLine uses the command it is given', () => {
    const out = resumeLine({ runId: 'r1', runDirRel: 'x', activeStream: { name: 'api', next: 'n' }, plain: true, command: 'w-marathon-times' });
    assert.match(out, /^Run \/w-marathon-times --resume r1/);
    assert.match(resumeLine({ runId: 'r1', runDirRel: 'x', activeStream: { name: 'api' }, plain: true }), /^Run \/w-marathon --resume r1/);
  });
});

function run(cwd, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

describe('cli — a timed run', () => {
  let dir;
  let runDir;
  before(async () => {
    dir = path.join(os.tmpdir(), `marathon-deadline-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  });
  after(async () => { try { await fs.rm(dir, { recursive: true }); } catch {} });

  it('deadline parse needs no run', () => {
    const r = run(dir, ['deadline', 'parse', '90m']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.minutes, 90);
    assert.equal(r.json.wrap_up_minutes, 10);
    assert.equal(run(dir, ['deadline', 'parse', 'whenever']).code, 1);
  });

  it('init --mode timed writes the timed finish line and records the command', async () => {
    assert.equal(run(dir, ['init', 'hunt', '--mode', 'bogus']).code, 1);
    assert.equal(run(dir, ['init', 'hunt', '--mode', 'timed', '--command', 'w-nope']).code, 1);
    const r = run(dir, ['init', 'hunt', '--mode', 'timed', '--command', 'w-bug-hunt', '--isolation', 'folder']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.mode, 'timed');
    assert.equal(r.json.command, 'w-bug-hunt');
    runDir = path.join(dir, r.json.runDir);
    const fl = JSON.parse(await fs.readFile(path.join(runDir, 'finish-line.json'), 'utf-8'));
    assert.deepEqual(fl.lines.map(l => l.source), ['runs.streak:unit', 'reviews.count', 'findings.open:high']);
    assert.equal(fl.tolerance.passes_in_a_row, 1);
    assert.match(await fs.readFile(path.join(runDir, 'kickoff.md'), 'utf-8'), /## Time/);
    const st = run(dir, ['status']);
    assert.match(st.out, /Deadline: not set/);
    assert.match(st.out, /\/w-bug-hunt --resume/);
  });

  it('check without a deadline exits 1; set once, --replace keeps the start', () => {
    assert.equal(run(dir, ['deadline']).code, 1);
    const a = run(dir, ['deadline', 'set', '5h']);
    assert.equal(a.code, 0, a.err);
    assert.equal(a.json.phase, 'work');
    assert.equal(a.json.wrap_up_minutes, 30);
    const again = run(dir, ['deadline', 'set', '2h']);
    assert.equal(again.code, 1);
    assert.match(again.err, /--replace/);
    const b = run(dir, ['deadline', 'set', '2h', '--replace', '--wrap-up', '5']);
    assert.equal(b.code, 0, b.err);
    assert.equal(b.json.start, a.json.start);
    assert.equal(b.json.wrap_up_minutes, 5);
    assert.equal(run(dir, ['deadline', 'set', '2h', '--replace', '--wrap-up', '500']).code, 1);
    const c = run(dir, ['deadline']);
    assert.equal(c.code, 0, c.err);
    assert.equal(c.json.phase, 'work');
    assert.match(run(dir, ['status']).out, /- Deadline: .* left \(work\)/);
    assert.match(run(dir, ['resume', '--plain']).out, /run `cli\.js deadline` before every step/);
  });

  it('past the deadline: check exits 2, status, resume and the next line say wrap up', async () => {
    const f = path.join(runDir, 'deadline.json');
    const d = JSON.parse(await fs.readFile(f, 'utf-8'));
    d.deadline = new Date(Date.now() - 60_000).toISOString();
    await fs.writeFile(f, JSON.stringify(d));
    const c = run(dir, ['deadline']);
    assert.equal(c.code, 2);
    assert.equal(c.json.phase, 'over');
    const st = run(dir, ['status']).out;
    assert.match(st, /State: TIME UP/);
    assert.match(st, /Next for you: Time is up/);
    const rs = run(dir, ['resume', '--plain']).out;
    assert.match(rs, /^Run \/w-bug-hunt --resume .* wrap-up checkpoint: time is up/);
    assert.doesNotMatch(rs, /take its first step/);
  });

  it('a broken deadline.json fails closed', async () => {
    await fs.writeFile(path.join(runDir, 'deadline.json'), '{not json');
    assert.equal(run(dir, ['deadline']).code, 1);
  });

  it('wake --cron for the timed run checks the deadline', async () => {
    await fs.writeFile(path.join(runDir, 'deadline.json'), JSON.stringify({ start: new Date().toISOString(), deadline: new Date(Date.now() + 3600_000).toISOString(), wrap_up_minutes: 10, deadline_local: 'soon' }));
    const r = run(dir, ['wake', '--cron']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.json.prompt, /\/w-bug-hunt/);
    assert.match(r.json.prompt, /cli\.js deadline --run/);
  });

  it('a finished timed run points at a new run with a time', () => {
    assert.equal(run(dir, ['finish']).code, 0);
    const r = run(dir, ['status', '--run', path.basename(runDir)]);
    assert.match(r.out, /Start a new one with \/w-bug-hunt <time>/);
  });
});
