import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

const GROUPS = ['surfaces', 'type', 'icons', 'spacing', 'copy', 'components', 'landing-hero', 'motion', 'template-look'];
const audit = per => {
  const counts = Object.fromEntries(GROUPS.map(g => [g, per[g] || 0]));
  const hits = GROUPS.flatMap(g => Array.from({ length: counts[g] }, (_, i) => ({ sign: `${g}-${i}`, group: g, line: i + 1, excerpt: 'x', fix: `fix ${g}` })));
  return JSON.stringify({ format: 'css', hits, counts, total: hits.length, manual: [] });
};

describe('slop-triage — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('grades, gates, confirms, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('slop-triage'));

    const heavy = pkg.kit(['slop-triage', 'grade'], audit({ copy: 1, type: 1, icons: 1, motion: 1 }));
    assert.equal(heavy.code, 0);
    assert.equal(heavy.json.grade, 'heavy');
    assert.equal(heavy.json.confirm.required, true);
    assert.equal(pkg.kit(['slop-triage', 'grade'], audit({ copy: 2, type: 1 })).json.grade, 'light');
    assert.equal(pkg.kit(['slop-triage', 'grade'], audit({})).json.grade, 'refine-only');
    assert.equal(pkg.kit(['slop-triage', 'grade', '--lines', '60'], audit({ copy: 3 })).json.grade, 'heavy');

    fs.writeFileSync(path.join(pkg.dir, 'audit.json'), audit({ copy: 1 }));
    assert.equal(pkg.kit(['slop-triage', 'grade', '--file', 'audit.json']).json.grade, 'refine-only');

    const g0 = pkg.kit(['slop-triage', 'gate', '--state', 'st.json']);
    assert.equal(g0.code, 2);
    assert.equal(g0.json.confirmed, false);
    assert.equal(pkg.kit(['slop-triage', 'confirm', '--state', 'st.json', '--grade', 'heavy', '--choice', 'Change the direction']).code, 2);
    assert.equal(pkg.kit(['slop-triage', 'gate', '--state', 'st.json']).code, 2);
    const c = pkg.kit(['slop-triage', 'confirm', '--state', 'st.json', '--grade', 'refine-only']);
    assert.equal(c.code, 0);
    const g1 = pkg.kit(['slop-triage', 'gate', '--state', 'st.json']);
    assert.equal(g1.code, 0);
    assert.equal(g1.json.confirmed, true);
    assert.equal(g1.json.grade, 'refine-only');

    const wrong = pkg.kit(['slop-triage', 'grade'], '{"format":"html"}');
    assert.equal(wrong.code, 1);
    assert.match(wrong.err, /audit\.hits/);
    assert.equal(wrong.out, '');
    assert.equal(pkg.kit(['slop-triage', 'grade'], '').code, 1);
    assert.equal(pkg.kit(['slop-triage', 'grade', '--file', 'missing.json']).code, 1);
    assert.equal(pkg.kit(['slop-triage', 'nope']).code, 1);
    assert.equal(pkg.kit(['slop-triage', 'gate']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
