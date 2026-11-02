import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import fsSync from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
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
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = path.join(ROOT, 'test', 'fixtures', 'slop-triage');
const fx = f => JSON.parse(fsSync.readFileSync(path.join(FX, f), 'utf-8'));
const ioBytes = (text, cwd) => ({ cwd, stdinBytes: async () => Buffer.from(text), stdin: async () => { throw new Error('stdin used'); }, stdinIsTTY: false, env: {} });
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
    assert.equal(g.plan.refinements.length, 2);
    assert.equal(g.plan.suggestions.length, 1);
    assert.match(g.budget_hint, /a few edits/);
    assert.equal(grade(audit()).plan.refinements.length, 0);
  });
  it('refine-only always offers 3 items in all: hits first, generic suggestions fill the rest (a clean screen included)', () => {
    for (const [a, hits, sugg] of [[audit(), 0, 3], [audit({ copy: 1 }), 1, 2], [audit({ copy: 2 }), 2, 1]]) {
      const p = grade(a).plan;
      assert.equal(p.refinements.length, hits); assert.equal(p.suggestions.length, sugg);
      assert.equal(p.refinements.length + p.suggestions.length, st.REFINE_MAX_EDITS);
      for (const x of p.suggestions) assert.match(x.fix, /\d/);
    }
    assert.match(grade(audit()).plan.steps[0], /3 small refinements/);
  });
  it('only refine-only carries suggestions', () => {
    assert.equal(grade(audit({ copy: 3 })).plan.suggestions, undefined);
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
    assert.equal((await run(['gate', '--state', 's.json'], io('', dir))).grade, 'refine-only');
  });
  it('confirm refuses "Change the direction" (exit 2) and, with no earlier record, leaves a not-confirmed record', async () => {
    const dir = await tmp();
    await exit(() => run(['confirm', '--state', 's.json', '--grade', 'heavy', '--choice', 'Change the direction'], io('', dir)), 2);
    const rec = JSON.parse(await fs.readFile(path.join(dir, 's.json'), 'utf-8'));
    assert.equal(rec.confirmed, false); assert.equal(rec.choice, 'Change the direction');
    assert.deepEqual((await fs.readdir(dir)).filter(f => f.endsWith('.tmp')), []);
    assert.equal((await run(['gate', '--state', 's.json'], io('', dir))).exit, 2);
  });
  it('confirm Go, then confirm Change the direction: the gate exits 2 afterwards', async () => {
    const dir = await tmp();
    await run(['confirm', '--state', 's.json', '--grade', 'heavy'], io('', dir));
    assert.equal((await run(['gate', '--state', 's.json'], io('', dir))).confirmed, true);
    await exit(() => run(['confirm', '--state', 's.json', '--grade', 'heavy', '--choice', 'Change the direction'], io('', dir)), 2, /revoked/);
    const g = await run(['gate', '--state', 's.json'], io('', dir));
    assert.equal(g.confirmed, false); assert.equal(g.exit, 2);
    await run(['confirm', '--state', 's.json', '--grade', 'heavy'], io('', dir));
    assert.equal((await run(['gate', '--state', 's.json'], io('', dir))).confirmed, true);
  });
  it('"Only refine, keep the design" is recorded as refine-only; the graded value is kept as graded_as', async () => {
    const dir = await tmp();
    for (const grd of ['heavy', 'light']) {
      const rec = await run(['confirm', '--state', 's.json', '--grade', grd, '--choice', 'Only refine, keep the design'], io('', dir));
      assert.equal(rec.grade, 'refine-only'); assert.equal(rec.graded_as, grd);
      const g = await run(['gate', '--state', 's.json'], io('', dir));
      assert.equal(g.confirmed, true); assert.equal(g.grade, 'refine-only'); assert.equal(g.graded_as, grd);
      assert.equal(g.choice, 'Only refine, keep the design');
    }
    const go = await run(['confirm', '--state', 's.json', '--grade', 'light'], io('', dir));
    assert.equal(go.grade, 'light'); assert.equal(go.graded_as, 'light');
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

describe('confirm write safety', () => {
  it('a failed revoke exits 1 and says the earlier confirmation may still be in force', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 'file'), 'x');
    await exit(() => run(['confirm', '--state', 'file/s.json', '--grade', 'heavy', '--choice', 'Change the direction'], io('', dir)), 1, /could not revoke.*may still be in force/);
    const r = spawnSync(process.execPath, [path.join(ROOT, '.claude', 'helpers', 'kit', 'cli.js'), 'slop-triage', 'confirm', '--state', 'file/s.json', '--grade', 'heavy', '--choice', 'Change the direction'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(r.status, 1); assert.match(r.stderr + r.stdout, /may still be in force/);
  });
  it('concurrent confirms in the same millisecond do not clobber each other temp file', async () => {
    const dir = await tmp();
    const realNow = Date.now; Date.now = () => 1700000000000;
    try {
      const rs = await Promise.all([1, 2, 3, 4].map(() => run(['confirm', '--state', 's.json', '--grade', 'heavy'], io('', dir))));
      assert.equal(rs.length, 4);
    } finally { Date.now = realNow; }
    const g = await run(['gate', '--state', 's.json'], io('', dir));
    assert.equal(g.confirmed, true);
    assert.deepEqual((await fs.readdir(dir)).filter(n => n.endsWith('.tmp')), []);
  });
});

describe('validateAudit rejects counts and total that contradict hits', () => {
  it('total, and each group count, must match the hits (real slop-audit output tampered with)', async () => {
    const real = fx('scan-sloppy.html.json');
    assert.ok(real.total >= 6);
    const zeroed = { ...real, counts: Object.fromEntries(GROUPS.map(g => [g, 0])), total: 0 };
    assert.throws(() => validateAudit(zeroed), e => e instanceof KitExit && e.code === 1 && /audit\.total/.test(e.message));
    await exit(() => run(['grade'], io(JSON.stringify(zeroed))), 1, /audit\.total/);
    const noTotal = { ...real, total: 0 };
    await exit(() => run(['grade'], io(JSON.stringify(noTotal))), 1, /audit\.total/);
    const emptied = { ...real, hits: [] };
    await exit(() => run(['grade'], io(JSON.stringify(emptied))), 1, /audit\.total/);
    const skewed = { ...real, counts: { ...real.counts, copy: real.counts.copy + 1, type: real.counts.type - 0 } };
    await exit(() => run(['grade'], io(JSON.stringify(skewed))), 1, /audit\.counts\.copy/);
    const moved = { ...real, counts: { ...real.counts, copy: real.counts.copy - 1, motion: 1 } };
    await exit(() => run(['grade'], io(JSON.stringify(moved))), 1, /audit\.counts\./);
  });
});

describe('real slop-audit output (fixtures from `slop-audit scan`, committed)', () => {
  const cases = [
    ['scan-sloppy.html.json', 'heavy'], ['scan-clean.html.json', 'refine-only'], ['scan-one.css.json', 'refine-only'],
    ['scan-sloppy.css.json', 'light'], ['scan-sloppy.jsx.json', 'light'], ['scan-sloppy.md.json', 'light'],
    ['scan-strict-sloppy.html.json', 'heavy'],
  ];
  for (const [f, want] of cases) {
    it(`${f} grades ${want}, in-process on stdin and stdinBytes and via --file`, async () => {
      const text = await fs.readFile(path.join(FX, f), 'utf-8');
      const a = JSON.parse(text);
      assert.equal(a.format, f.includes('.css.') ? 'css' : f.includes('.jsx.') ? 'jsx' : f.includes('.md.') ? 'md' : 'html');
      const viaStdin = await run(['grade'], io(text));
      assert.equal(viaStdin.grade, want);
      assert.deepEqual(await run(['grade'], ioBytes(text)), viaStdin);
      assert.deepEqual(await run(['grade', '--file', path.join(FX, f)], io('', FX)), viaStdin);
      assert.equal(viaStdin.total, a.total);
    });
  }
  it('the strict scan output carries an extra exit key that is ignored', async () => {
    const a = fx('scan-strict-sloppy.html.json');
    assert.equal(a.exit, 2);
    assert.equal((await run(['grade'], io(JSON.stringify(a)))).grade, 'heavy');
  });
  it('a clean real scan still gets 3 suggestions', async () => {
    const g = await run(['grade', '--file', path.join(FX, 'scan-clean.html.json')], io('', FX));
    assert.equal(g.plan.refinements.length, 0); assert.equal(g.plan.suggestions.length, 3);
  });
});

describe('input edges', () => {
  it('null, array, scalar and empty-object JSON exit 1', async () => {
    for (const t of ['null', '[]', '1', '"x"', 'true', '{}']) await exit(() => run(['grade'], io(t)), 1, /audit/);
  });
  it('duplicate JSON keys: the last one wins and is still validated', async () => {
    const real = JSON.stringify(fx('scan-clean.html.json'));
    const dup = real.slice(0, -1) + ',"format":"pdf"}';
    await exit(() => run(['grade'], io(dup)), 1, /audit\.format/);
    assert.equal((await run(['grade'], io(real.replace('{', '{"format":"pdf","format":"html",')))).grade, 'refine-only');
  });
  it('blank items in hits and manual exit 1 naming the field', async () => {
    const real = fx('scan-sloppy.html.json');
    await exit(() => run(['grade'], io(JSON.stringify({ ...real, hits: [...real.hits, null] }))), 1, /audit\.hits\[\d+\]/);
    await exit(() => run(['grade'], io(JSON.stringify({ ...real, hits: [...real.hits, {}] }))), 1, /\.sign/);
    await exit(() => run(['grade'], io(JSON.stringify({ ...real, manual: [''].concat(real.manual).map((m, i) => (i === 0 ? 5 : m)) }))), 1, /audit\.manual/);
  });
  it('inherited Object keys are not flags', async () => {
    for (const k of ['--constructor', '--__proto__', '--toString', 'constructor', '__proto__']) {
      await exit(() => run(['grade', k, 'x'], io('{}')), 1, /unexpected argument/);
      await exit(() => run(['gate', k, 'x'], io('')), 1, /unexpected argument/);
      await exit(() => run(['confirm', k, 'x'], io('')), 1, /unexpected argument/);
    }
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 's.json'), JSON.stringify({ constructor: 1, __proto__: { confirmed: true } }));
    assert.equal((await run(['gate', '--state', 's.json'], io('', dir))).confirmed, false);
  });
  it('the 8 MiB cap applies to stdinBytes, to --file, and to a file one byte over; a file at the cap is read', async () => {
    const dir = await tmp();
    const big = 'x'.repeat(8 * 1024 * 1024 + 1);
    await exit(() => run(['grade'], ioBytes(big, dir)), 1, /8 MiB/);
    await fs.writeFile(path.join(dir, 'big.json'), big);
    await exit(() => run(['grade', '--file', 'big.json'], io('', dir)), 1, /8 MiB/);
    const pad = JSON.stringify({ ...fx('scan-clean.html.json') }).slice(0, -1) + ',"pad":"';
    const exact = pad + 'y'.repeat(8 * 1024 * 1024 - pad.length - 2) + '"}';
    assert.equal(Buffer.byteLength(exact), 8 * 1024 * 1024);
    await fs.writeFile(path.join(dir, 'exact.json'), exact);
    assert.equal((await run(['grade', '--file', 'exact.json'], io('', dir))).grade, 'refine-only');
    assert.equal((await run(['grade'], ioBytes(exact, dir))).grade, 'refine-only');
  });
  it('a BOM is stripped on --file and on stdinBytes', async () => {
    const dir = await tmp();
    const text = '\uFEFF' + JSON.stringify(fx('scan-clean.html.json'));
    await fs.writeFile(path.join(dir, 'bom.json'), text);
    assert.equal((await run(['grade', '--file', 'bom.json'], io('', dir))).grade, 'refine-only');
    assert.equal((await run(['grade'], ioBytes(text))).grade, 'refine-only');
  });
  it('the 8 MiB limit also guards the state file read', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 's.json'), ' '.repeat(8 * 1024 * 1024 + 1));
    await exit(() => run(['gate', '--state', 's.json'], io('', dir)), 1, /8 MiB/);
  });
});

describe('the real CLI path (node .claude/helpers/kit/cli.js slop-triage)', () => {
  const cli = path.join(ROOT, '.claude', 'helpers', 'kit', 'cli.js');
  const kit = (args, input, cwd = FX) => {
    const r = spawnSync(process.execPath, [cli, 'slop-triage', ...args], { cwd, input, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    let json = null; try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  };
  it('--file and piped stdin agree on real scan output, strict output included', () => {
    for (const f of ['scan-sloppy.html.json', 'scan-strict-sloppy.html.json', 'scan-clean.html.json', 'scan-sloppy.md.json']) {
      const viaFile = kit(['grade', '--file', f]);
      const viaStdin = kit(['grade'], fsSync.readFileSync(path.join(FX, f)));
      assert.equal(viaFile.code, 0, viaFile.err);
      assert.deepEqual(viaFile.json, viaStdin.json);
    }
    assert.equal(kit(['grade', '--file', 'scan-sloppy.html.json']).json.grade, 'heavy');
  });
  it('size cap and BOM through --file, and over piped stdin', async () => {
    const dir = await tmp();
    fsSync.writeFileSync(path.join(dir, 'big.json'), 'x'.repeat(8 * 1024 * 1024 + 1));
    const over = kit(['grade', '--file', 'big.json'], undefined, dir);
    assert.equal(over.code, 1); assert.match(over.err, /8 MiB/); assert.equal(over.out, '');
    const overIn = kit(['grade'], 'x'.repeat(8 * 1024 * 1024 + 1), dir);
    assert.equal(overIn.code, 1); assert.match(overIn.err, /8 MiB/);
    fsSync.writeFileSync(path.join(dir, 'bom.json'), '\uFEFF' + fsSync.readFileSync(path.join(FX, 'scan-clean.html.json'), 'utf-8'));
    assert.equal(kit(['grade', '--file', 'bom.json'], undefined, dir).json.grade, 'refine-only');
    assert.equal(kit(['grade'], '\uFEFF' + fsSync.readFileSync(path.join(FX, 'scan-clean.html.json'), 'utf-8'), dir).json.grade, 'refine-only');
  });
  it('confirm Go, confirm Change, gate: exit 0, exit 2, exit 2', async () => {
    const dir = await tmp();
    assert.equal(kit(['confirm', '--state', 'st.json', '--grade', 'heavy'], undefined, dir).code, 0);
    assert.equal(kit(['gate', '--state', 'st.json'], undefined, dir).code, 0);
    const no = kit(['confirm', '--state', 'st.json', '--grade', 'heavy', '--choice', 'Change the direction'], undefined, dir);
    assert.equal(no.code, 2); assert.match(no.err, /revoked/);
    const g = kit(['gate', '--state', 'st.json'], undefined, dir);
    assert.equal(g.code, 2); assert.equal(g.json.confirmed, false);
  });
  it('only-refine is recorded as refine-only through the CLI', async () => {
    const dir = await tmp();
    const c = kit(['confirm', '--state', 'st.json', '--grade', 'heavy', '--choice', 'Only refine, keep the design'], undefined, dir);
    assert.equal(c.code, 0); assert.equal(c.json.grade, 'refine-only'); assert.equal(c.json.graded_as, 'heavy');
    const g = kit(['gate', '--state', 'st.json'], undefined, dir);
    assert.equal(g.code, 0); assert.equal(g.json.grade, 'refine-only');
  });
});

describe('the header contract is asserted', () => {
  const header = fsSync.readFileSync(path.join(ROOT, '.claude/helpers/kit/slop-triage.js'), 'utf-8').split('*/')[0];
  it('every output field the header names exists in the output', async () => {
    const g = grade(audit({ copy: 1, type: 1, icons: 1, motion: 1 }), 100);
    for (const k of ['grade', 'why', 'total', 'groups_hit', 'top_groups', 'plan', 'budget_hint', 'confirm', 'hits_per_100_lines']) { assert.ok(header.includes(k) || k === 'hits_per_100_lines', k); assert.ok(k in g, k); }
    assert.deepEqual(Object.keys(g.confirm).sort(), ['options', 'question', 'required']);
    const dir = await tmp();
    const rec = await run(['confirm', '--state', 's.json', '--grade', 'heavy'], io('', dir));
    for (const k of ['confirmed', 'grade', 'choice', 'at', 'graded_as']) { assert.ok(header.includes(k), k); assert.ok(k in rec, k); }
    const ok = await run(['gate', '--state', 's.json'], io('', dir));
    for (const k of ['confirmed', 'grade', 'at']) assert.ok(k in ok, k);
    const no = await run(['gate', '--state', 'none.json'], io('', dir));
    for (const k of ['confirmed', 'why', 'exit']) assert.ok(k in no, k);
  });
  it('every documented exit code is real: 0, 1 and 2', async () => {
    assert.match(header, /exit 2/); assert.match(header, /exits 1/);
    const dir = await tmp();
    await exit(() => run(['grade'], io('')), 1);
    await exit(() => run(['confirm', '--state', 's.json', '--grade', 'heavy', '--choice', 'Change the direction'], io('', dir)), 2);
    assert.equal((await run(['gate', '--state', 's.json'], io('', dir))).exit, 2);
    assert.equal((await run(['grade'], io(JSON.stringify(audit())))).grade, 'refine-only');
  });
  it('documents the revoke, the refine-only grade and the consistency check', () => {
    assert.match(header, /REVOKES/); assert.match(header, /recorded as grade "refine-only"/); assert.match(header, /total must equal hits\.length/);
  });
});

describe('confirm durability and stale temp cleanup', () => {
  it('fsyncs the temp file and the folder before confirm returns', async () => {
    const dir = await tmp();
    const probe = await fs.open(path.join(dir, 'probe'), 'w');
    const proto = Object.getPrototypeOf(probe);
    await probe.close();
    const real = proto.sync; let n = 0;
    proto.sync = function (...a) { n++; return real.apply(this, a); };
    try { await run(['confirm', '--state', 's.json', '--grade', 'heavy'], io('', dir)); } finally { proto.sync = real; }
    assert.ok(n >= 2, `expected file and folder fsync, saw ${n}`);
    n = 0; proto.sync = function (...a) { n++; return real.apply(this, a); };
    try { await exit(() => run(['confirm', '--state', 's.json', '--grade', 'heavy', '--choice', 'Change the direction'], io('', dir)), 2); } finally { proto.sync = real; }
    assert.ok(n >= 2, `revoke fsync, saw ${n}`);
  });
  it('removes stale <state>.*.tmp leftovers (older than a minute), keeps fresh and unrelated files', async () => {
    const dir = await tmp();
    const old = new Date(Date.now() - 5 * 60 * 1000);
    const stale = ['s.json.123.abc.tmp', '.s.json.123.deadbeef.tmp'];
    for (const n of [...stale, 's.json.456.fresh.tmp', 'other.json.1.x.tmp', 'keep.txt']) await fs.writeFile(path.join(dir, n), 'x');
    for (const n of [...stale, 'other.json.1.x.tmp']) await fs.utimes(path.join(dir, n), old, old);
    await run(['confirm', '--state', 's.json', '--grade', 'heavy'], io('', dir));
    const left = (await fs.readdir(dir)).sort();
    assert.deepEqual(left, ['keep.txt', 'other.json.1.x.tmp', 's.json', 's.json.456.fresh.tmp']);
  });
  it('the header documents the durable write and the cleanup', () => {
    const header = fsSync.readFileSync(path.join(ROOT, '.claude/helpers/kit/slop-triage.js'), 'utf-8').split('*/')[0];
    assert.match(header, /fsync/); assert.match(header, /older than a minute/);
  });
});
