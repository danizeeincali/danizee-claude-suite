import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as st from '../src/lib/kit/slop-triage.js';

const { run, grade, validateAudit, GROUPS } = st;
const io = (stdin, cwd) => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
const exit = async (p, code = 1, re) => assert.rejects(Promise.resolve().then(p), e => e instanceof KitExit && e.code === code && (!re || re.test(e.message)));

const audit = (perGroup = {}, extra = {}) => {
  const counts = Object.fromEntries(GROUPS.map(g => [g, perGroup[g] || 0]));
  const hits = GROUPS.flatMap(g => Array.from({ length: counts[g] }, (_, i) => ({ sign: `${g}-${i}`, group: g, line: i + 1, excerpt: 'x', fix: `fix ${g}` })));
  return { format: 'html', hits, counts, total: hits.length, manual: [], ...extra };
};
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'slop-triage-'));

describe('grade thresholds', () => {
  it('exports the thresholds', () => {
    assert.equal(st.REFINE_MAX_HITS, 2);
    assert.equal(st.HEAVY_MIN_GROUPS, 4);
    assert.equal(st.HEAVY_BIG_TOTAL, 8);
    assert.equal(st.HEAVY_DENSITY, 5);
    assert.equal(st.REFINE_MAX_EDITS, 3);
  });
  it('zero hits and 1-2 hits in one group are refine-only', () => {
    assert.equal(grade(audit()).grade, 'refine-only');
    assert.equal(grade(audit({ copy: 1 })).grade, 'refine-only');
    assert.equal(grade(audit({ surfaces: 2 })).grade, 'refine-only');
  });
  it('2 hits in 2 groups, or 3 in one, are light', () => {
    assert.equal(grade(audit({ copy: 1, type: 1 })).grade, 'light');
    assert.equal(grade(audit({ copy: 3 })).grade, 'light');
  });
  it('4 groups is heavy, 3 is not', () => {
    assert.equal(grade(audit({ copy: 1, type: 1, icons: 1, motion: 1 })).grade, 'heavy');
    assert.equal(grade(audit({ copy: 1, type: 1, icons: 1 })).grade, 'light');
  });
  it('surfaces or landing-hero with total >= 8 is heavy; other groups are not', () => {
    assert.equal(grade(audit({ surfaces: 1, copy: 7 })).grade, 'heavy');
    assert.equal(grade(audit({ 'landing-hero': 1, copy: 7 })).grade, 'heavy');
    assert.equal(grade(audit({ surfaces: 1, copy: 6 })).grade, 'light');
    assert.equal(grade(audit({ copy: 8 })).grade, 'light');
  });
  it('density per 100 lines >= 5 is heavy', () => {
    const a = audit({ copy: 3 });
    assert.equal(grade(a, 100).grade, 'light');
    assert.equal(grade(a, 60).grade, 'heavy'); // 5 per 100
    assert.equal(grade(a, 61).grade, 'light');
    assert.equal(grade(a, 60).hits_per_100_lines, 5);
  });
  it('refine-only wins over density for a tiny hit count', () => {
    assert.equal(grade(audit({ copy: 1 }), 5).grade, 'refine-only');
  });
});

describe('grade output', () => {
  it('carries why, top groups, budget hint and the confirm question', () => {
    const g = grade(audit({ copy: 3, type: 2, icons: 1, motion: 1 }));
    assert.equal(g.grade, 'heavy');
    assert.equal(g.total, 7);
    assert.equal(g.groups_hit, 4);
    assert.deepEqual(g.top_groups, [{ group: 'copy', count: 3 }, { group: 'type', count: 2 }, { group: 'icons', count: 1 }]);
    assert.match(g.budget_hint, /full pass set/);
    assert.equal(g.confirm.required, true);
    assert.equal(typeof g.confirm.question, 'string');
    assert.equal(g.confirm.question.split('?').length, 2);
    assert.deepEqual(g.confirm.options, ['Go with this direction', 'Change the direction', 'Only refine, keep the design']);
    assert.equal(g.plan.mode, 'full-redline');
    assert.deepEqual(g.plan.passes.map(p => p.pass), ['spacing', 'color', 'icons', 'copy', 'type', 'layout', 'motion']);
  });
  it('light plan lists fixes by group in pass order, only groups with hits', () => {
    const g = grade(audit({ motion: 1, copy: 1, spacing: 1 }));
    assert.equal(g.grade, 'light');
    assert.deepEqual(g.plan.passes.map(p => p.pass), ['spacing', 'copy', 'motion']);
    assert.equal(g.plan.passes[1].fixes[0].fix, 'fix copy');
    assert.match(g.budget_hint, /targeted/);
  });
  it('refine-only plan has at most 3 refinements', () => {
    const g = grade(audit({ copy: 2 }));
    assert.equal(g.plan.mode, 'refine-only');
    assert.ok(g.plan.refinements.length <= 3);
    assert.match(g.budget_hint, /a few edits/);
    assert.equal(grade(audit()).plan.refinements.length, 0);
  });
  it('layout pass folds components, landing-hero and template-look', () => {
    const g = grade(audit({ components: 1, 'landing-hero': 1, 'template-look': 1 }));
    assert.equal(g.plan.passes.length, 1);
    assert.equal(g.plan.passes[0].pass, 'layout');
    assert.equal(g.plan.passes[0].count, 3);
  });
});

describe('run grade', () => {
  it('reads stdin and --file, honours --lines', async () => {
    const dir = await tmp();
    const a = audit({ copy: 3 });
    await fs.writeFile(path.join(dir, 'a.json'), JSON.stringify(a));
    const viaFile = await run(['grade', '--file', 'a.json'], io('', dir));
    const viaStdin = await run(['grade'], io(JSON.stringify(a), dir));
    assert.deepEqual(viaFile, viaStdin);
    assert.equal((await run(['grade', '--lines', '60'], io(JSON.stringify(a), dir))).grade, 'heavy');
  });
  it('rejects bad input with exit 1', async () => {
    const dir = await tmp();
    await exit(() => run(['grade'], io('', dir)), 1, /no input/);
    await exit(() => run(['grade'], io('  \n', dir)));
    await exit(() => run(['grade'], io('{nope', dir)), 1, /JSON/);
    await exit(() => run(['grade'], io('a\0b', dir)), 1, /binary/);
    await exit(() => run(['grade'], io('x'.repeat(8 * 1024 * 1024 + 2), dir)), 1, /8 MiB/);
    await exit(() => run(['grade', '--file', 'missing.json'], io('', dir)));
    await exit(() => run(['grade', '--file', '.'], io('', dir)));
    await exit(() => run(['grade', '--file', '/dev/null'], io('', dir)));
    await exit(() => run(['grade', '--bogus', 'x'], io('{}', dir)));
    await exit(() => run(['grade', '--file', 'a', '--file', 'b'], io('{}', dir)), 1, /more than once/);
    await exit(() => run(['grade', '--file'], io('{}', dir)), 1, /needs a value/);
    for (const l of ['0', '-1', 'x', '1.5', '']) await exit(() => run(['grade', '--lines', l], io(JSON.stringify(audit()), dir)));
    await exit(() => run([], io('')));
    await exit(() => run(['nope'], io('')));
  });
  it('accepts a BOM', async () => {
    assert.equal((await run(['grade'], io('﻿' + JSON.stringify(audit())))).grade, 'refine-only');
  });
});

describe('validateAudit names the wrong field', () => {
  const ok = () => audit({ copy: 1 });
  const cases = [
    [null, /audit:/], [[], /audit:/],
    [{ ...ok(), format: 'pdf' }, /audit\.format/],
    [{ ...ok(), hits: {} }, /audit\.hits/],
    [{ ...ok(), hits: [null] }, /audit\.hits\[0\]/],
    [{ ...ok(), hits: [{ ...ok().hits[0], sign: '' }] }, /hits\[0\]\.sign/],
    [{ ...ok(), hits: [{ ...ok().hits[0], group: 'x' }] }, /hits\[0\]\.group/],
    [{ ...ok(), hits: [{ ...ok().hits[0], line: 'a' }] }, /hits\[0\]\.line/],
    [{ ...ok(), hits: [{ ...ok().hits[0], excerpt: 1 }] }, /hits\[0\]\.excerpt/],
    [{ ...ok(), hits: [{ ...ok().hits[0], fix: null }] }, /hits\[0\]\.fix/],
    [{ ...ok(), counts: null }, /audit\.counts/],
    [{ ...ok(), counts: { ...ok().counts, motion: -1 } }, /counts\.motion/],
    [{ ...ok(), counts: { ...ok().counts, 'template-look': undefined } }, /counts\.template-look/],
    [{ ...ok(), total: '1' }, /audit\.total/],
    [{ ...ok(), manual: [1] }, /audit\.manual/],
    [{ ...ok(), manual: 'a' }, /audit\.manual/],
  ];
  for (const [input, re] of cases) {
    it(String(re), async () => {
      assert.throws(() => validateAudit(input), e => e instanceof KitExit && e.code === 1 && re.test(e.message));
      await exit(() => run(['grade'], io(JSON.stringify(input))), 1, re);
    });
  }
});

describe('gate and confirm', () => {
  it('gate exits 2 with no file, no confirmation or an incomplete one', async () => {
    const dir = await tmp();
    const s = path.join(dir, 's.json');
    let r = await run(['gate', '--state', s], io('', dir));
    assert.equal(r.confirmed, false); assert.equal(r.exit, 2); assert.equal(typeof r.why, 'string');
    for (const body of [{ confirmed: false, grade: 'heavy', at: new Date().toISOString() }, { confirmed: 'true', grade: 'heavy', at: new Date().toISOString() }, { confirmed: true, grade: 'wild', at: new Date().toISOString() }, { confirmed: true, grade: 'heavy', at: 'yesterday' }, { confirmed: true, grade: 'heavy' }, {}]) {
      await fs.writeFile(s, JSON.stringify(body));
      r = await run(['gate', '--state', s], io('', dir));
      assert.equal(r.confirmed, false, JSON.stringify(body)); assert.equal(r.exit, 2);
    }
  });
  it('gate exits 1 on broken state or bad flags', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 's.json'), '{bad');
    await exit(() => run(['gate', '--state', 's.json'], io('', dir)), 1, /JSON/);
    await fs.writeFile(path.join(dir, 's.json'), '[]');
    await exit(() => run(['gate', '--state', 's.json'], io('', dir)));
    await exit(() => run(['gate'], io('', dir)), 1, /--state/);
    await exit(() => run(['gate', '--state', 'a', '--state', 'b'], io('', dir)));
    await exit(() => run(['gate', '--state', dir], io('', dir)));
    await exit(() => run(['gate', '--x', 'a'], io('', dir)));
  });
  it('confirm writes the record atomically and gate then passes', async () => {
    const dir = await tmp();
    const rec = await run(['confirm', '--state', 's.json', '--grade', 'heavy'], io('', dir));
    assert.equal(rec.confirmed, true); assert.equal(rec.grade, 'heavy'); assert.equal(rec.choice, 'Go with this direction');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 's.json'), 'utf-8')), rec);
    assert.deepEqual((await fs.readdir(dir)).filter(f => f.endsWith('.tmp')), []);
    const g = await run(['gate', '--state', 's.json'], io('', dir));
    assert.equal(g.confirmed, true); assert.equal(g.grade, 'heavy'); assert.equal(g.exit, undefined);
  });
  it('refine-only with "Go with this direction" is allowed and the choice is recorded', async () => {
    const dir = await tmp();
    const rec = await run(['confirm', '--state', 's.json', '--grade', 'refine-only', '--choice', 'Go with this direction'], io('', dir));
    assert.equal(rec.grade, 'refine-only'); assert.equal(rec.choice, 'Go with this direction');
    const r2 = await run(['confirm', '--state', 's.json', '--grade', 'light', '--choice', 'Only refine, keep the design'], io('', dir));
    assert.equal(r2.choice, 'Only refine, keep the design');
    assert.equal((await run(['gate', '--state', 's.json'], io('', dir))).choice, 'Only refine, keep the design');
  });
  it('confirm refuses "Change the direction" (exit 2) and writes nothing', async () => {
    const dir = await tmp();
    await exit(() => run(['confirm', '--state', 's.json', '--grade', 'heavy', '--choice', 'Change the direction'], io('', dir)), 2);
    await assert.rejects(fs.access(path.join(dir, 's.json')));
  });
  it('confirm rejects bad grade, choice, flags and unwritable paths', async () => {
    const dir = await tmp();
    await exit(() => run(['confirm', '--state', 's.json', '--grade', 'meh'], io('', dir)), 1, /--grade/);
    await exit(() => run(['confirm', '--state', 's.json'], io('', dir)), 1, /--grade/);
    await exit(() => run(['confirm', '--grade', 'heavy'], io('', dir)), 1, /--state/);
    await exit(() => run(['confirm', '--state', 's.json', '--grade', 'heavy', '--choice', 'maybe'], io('', dir)), 1, /--choice/);
    await exit(() => run(['confirm', '--state', 's.json', '--grade', 'heavy', '--grade', 'light'], io('', dir)));
    await exit(() => run(['confirm', '--state', 'no/such/dir/s.json', '--grade', 'heavy'], io('', dir)), 1, /cannot write/);
    await exit(() => run(['confirm', '--state', 's.json', '--grade', 'heavy', '--zzz', '1'], io('', dir)));
  });
});
