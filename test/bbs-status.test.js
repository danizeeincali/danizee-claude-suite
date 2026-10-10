/**
 * Contract for src/lib/bbs/status.js — stream `intake` of marathon 2026-10-07-bbs.
 * STEPS · nextStep(state) · renderStatus(state) · loadState(runDir) · summary(state)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as statusMod from '../src/lib/bbs/status.js';
import { STEPS, nextStep, renderStatus, loadState, summary } from '../src/lib/bbs/status.js';
import { writeJson, appendJsonl } from '../src/lib/bbs/store.js';

const base = {
  run: '2026-10-07-x',
  source: { type: 'url', ref: 'https://e.x/p', identity: 'pending', fetched: false, run: '2026-10-07-x', ts: '2026-10-07T12:00:00.000Z' },
  egress: [], powers: null, map: null, verdicts: null, handoff: null
};

describe('status — steps and nextStep', () => {
  it('STEPS are the nine verbs in order', () => {
    assert.deepEqual(STEPS, ['intake', 'fetch', 'inventory', 'map', 'usage', 'surfaces', 'targets', 'verdict', 'handoff']);
  });

  it('no source → intake; pending identity or unfetched → fetch', () => {
    assert.equal(nextStep({ ...base, source: null }), 'intake');
    assert.equal(nextStep(base), 'fetch');
    assert.equal(nextStep({ ...base, source: { ...base.source, identity: 'sha256:a', fetched: false } }), 'fetch');
    assert.equal(nextStep({ ...base, source: { ...base.source, fetched: true } }), 'fetch', 'fetched but identity pending is still fetch');
  });

  it('fetched → inventory; powers without judgments → map; undecided → verdict; decided → handoff; handoff → done', () => {
    const fetched = { ...base, source: { ...base.source, identity: 'sha256:a', fetched: true } };
    assert.equal(nextStep(fetched), 'inventory');
    const powers = { powers: [{ name: 'p1' }, { name: 'p2' }], not_inventoried: [] };
    assert.equal(nextStep({ ...fetched, powers }), 'map');
    const mapNoJudg = { candidates: { p1: [], p2: [] }, judgments: {} };
    assert.equal(nextStep({ ...fetched, powers, map: mapNoJudg }), 'map');
    const mapHalf = { candidates: { p1: [], p2: [] }, judgments: { p1: 'have' } };
    assert.equal(nextStep({ ...fetched, powers, map: mapHalf }), 'map', 'every power needs a judgment');
    const map = { candidates: { p1: [], p2: [] }, judgments: { p1: 'have', p2: 'missing' } };
    assert.equal(nextStep({ ...fetched, powers, map }), 'usage', 'which workflows the owner uses comes before the verdict');
    const usage = { evidence: 'none', workflows: [] };
    assert.equal(nextStep({ ...fetched, powers, map, usage }), 'surfaces', 'where a user meets a feature is found in the code before targets');
    const surfaces = { surfaces: [], owner: [] };
    assert.equal(nextStep({ ...fetched, powers, map, usage, surfaces }), 'targets', 'where each power lands comes before the verdict');
    assert.equal(nextStep({ ...fetched, powers, map, usage, surfaces, targets: { targets: { p1: [] } } }), 'targets', 'every power needs an entry');
    const targets = { targets: { p1: [], p2: [] } };
    assert.equal(nextStep({ ...fetched, powers, map, usage, surfaces, targets }), 'verdict');
    assert.equal(nextStep({ ...fetched, powers, map, usage, targets }), 'surfaces', 'targets without surfaces.json still send the run to surfaces');
    const halfDecided = { decisions: { p1: 'skip' } };
    assert.equal(nextStep({ ...fetched, powers, map, verdicts: halfDecided }), 'usage');
    assert.equal(nextStep({ ...fetched, powers, map, usage, targets, verdicts: halfDecided }), 'surfaces');
    assert.equal(nextStep({ ...fetched, powers, map, usage, surfaces, targets, verdicts: halfDecided }), 'verdict');
    const verdicts = { decisions: { p1: 'skip', p2: 'rebuild' } };
    assert.equal(nextStep({ ...fetched, powers, map, verdicts }), 'handoff');
    assert.equal(nextStep({ ...fetched, powers, map, verdicts, handoff: { marathonRun: null, powers: [] } }), 'done');
  });

  it('a known source (reuse_from) skips straight to handoff once reused inventory and verdicts are copied in', () => {
    const reused = { ...base, source: { ...base.source, identity: 'sha256:a', fetched: true, reuse_from: 'old' },
      powers: { powers: [{ name: 'p' }], not_inventoried: [] }, map: { candidates: { p: [] }, judgments: { p: 'missing' } }, verdicts: { decisions: { p: 'rebuild' } } };
    assert.equal(nextStep(reused), 'handoff');
  });
});

describe('status — the surfaces row', () => {
  const fetched = { ...base, source: { ...base.source, identity: 'sha256:a', fetched: true } };
  const powers = { powers: [{ name: 'p' }], not_inventoried: [] };
  const map = { candidates: { p: [] }, judgments: { p: 'missing' } };
  const usage = { evidence: 'none', workflows: [] };

  it('is next after usage, and done with a count by kind once surfaces.json exists', () => {
    let md = renderStatus({ ...fetched, powers, map, usage });
    assert.match(md, /- Next: `cli\.js surfaces`\n/);
    assert.match(md, /\| usage \| done \| none: 0 workflows \|\n\| surfaces \| next \|  \|\n\| targets \| pending \|  \|\n/);
    const surfaces = { kinds: { ui: 1, api: 2, job: 0 }, surfaces: [{ id: 'ui:a' }, { id: 'api:b' }, { id: 'api:c' }], owner: [{ id: 'api:c' }, { id: 'cli:d' }] };
    md = renderStatus({ ...fetched, powers, map, usage, surfaces });
    assert.match(md, /- Next: `cli\.js targets`\n/);
    assert.match(md, /\| surfaces \| done \| 4 surfaces \(ui 1, api 2\) \|\n/, 'an owner surface already scanned is counted once');
    md = renderStatus({ ...fetched, powers, map, usage, surfaces: { kinds: {}, surfaces: [], owner: [] } });
    assert.match(md, /\| surfaces \| done \| 0 surfaces \(none found\) \|\n/);
  });

  it('a run decided before the surfaces step shows it as skipped', () => {
    const md = renderStatus({ ...fetched, powers, map, usage, verdicts: { decisions: { p: 'skip' } }, handoff: { marathonRun: null, powers: [] } });
    assert.match(md, /\| surfaces \| done \| skipped \(decided before the surfaces step\) \|\n/);
  });
});

describe('status — summary and renderStatus', () => {
  it('summary counts powers by decision and names the marathon run', () => {
    const s = summary({ ...base, powers: { powers: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], not_inventoried: ['d'] },
      verdicts: { decisions: { a: 'rebuild', b: 'skip', c: 'buy' } }, handoff: { marathonRun: '2026-10-07-bbs-x', powers: [{ name: 'a' }] } });
    assert.deepEqual(s, { found: 3, not_inventoried: 1, approved: 2, rebuild: 1, use: 0, buy: 1, skip: 1, undecided: 0, marathon: '2026-10-07-bbs-x' });
    const empty = summary(base);
    assert.deepEqual(empty, { found: 0, not_inventoried: 0, approved: 0, rebuild: 0, use: 0, buy: 0, skip: 0, undecided: 0, marathon: null });
  });

  it('renderStatus: header, source line, egress line, next verb, one row per step, and the summary line', () => {
    const md = renderStatus({ ...base, egress: [{ kind: 'http', host: 'e.x', bytes_in: 1200, bytes_out: 0 }, { kind: 'http', host: 'e.x', bytes_in: 300, bytes_out: 0 }] });
    assert.match(md, /^# bbs 2026-10-07-x\n/);
    assert.match(md, /- Source: url https:\/\/e\.x\/p\n/);
    assert.match(md, /- Identity: pending\n/);
    assert.match(md, /- Egress: requests=2 bytes_in=1500 bodies_sent=0 hosts=e\.x\n/);
    assert.match(md, /- Next: `cli\.js fetch`\n/);
    assert.match(md, /\| Step \| State \| Detail \|/);
    assert.match(md, /\| intake \| done \|/);
    assert.match(md, /\| fetch \| next \|/);
    assert.match(md, /\| inventory \| pending \|/);
    assert.match(md, /\| handoff \| pending \|/);
    assert.match(md, /- Summary: found=0 approved=0 skipped=0 buy=0 marathon=none\n/);
    assert.ok(!md.includes('undefined'), 'no undefined in the rendering');
  });

  it('renderStatus escapes pipes in the source ref and shows reuse and not_inventoried', () => {
    const md = renderStatus({ ...base, source: { ...base.source, ref: 'a|b', identity: 'sha256:a', fetched: true, reuse_from: 'old-run' },
      powers: { powers: [{ name: 'p' }], not_inventoried: ['q', 'r'] } });
    assert.match(md, /a\\\|b/);
    assert.match(md, /reuses old-run/);
    assert.match(md, /\| inventory \| done \| 1 powers \(2 not inventoried\) \|/);
    assert.match(md, /- Next: `cli\.js map`\n/);
  });

  it('renderStatus says done when the hand-off exists', () => {
    const md = renderStatus({ ...base, source: { ...base.source, identity: 'sha256:a', fetched: true },
      powers: { powers: [{ name: 'p' }], not_inventoried: [] }, map: { candidates: { p: [] }, judgments: { p: 'missing' } },
      verdicts: { decisions: { p: 'rebuild' } }, handoff: { marathonRun: '2026-10-07-bbs-p', powers: [{ name: 'p' }] } });
    assert.match(md, /- Next: done — \/w-marathon --resume 2026-10-07-bbs-p\n/);
    assert.match(md, /\| handoff \| done \|/);
  });
});

describe('status — loadState', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-state-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('reads whatever files exist and leaves the rest null/empty', async () => {
    const runDir = path.join(dir, 'r1');
    await writeJson(path.join(runDir, 'source.json'), base.source);
    await appendJsonl(path.join(runDir, 'egress.jsonl'), { kind: 'http', host: 'e.x', bytes_in: 5, bytes_out: 0 });
    const s = await loadState(runDir);
    assert.equal(s.run, 'r1');
    assert.deepEqual(s.source, base.source);
    assert.equal(s.egress.length, 1);
    assert.equal(s.powers, null);
    assert.equal(s.map, null);
    assert.equal(s.verdicts, null);
    assert.equal(s.handoff, null);
  });

  it('a missing run dir gives an empty state with source null', async () => {
    const s = await loadState(path.join(dir, 'nope'));
    assert.equal(s.source, null);
    assert.deepEqual(s.egress, []);
    assert.equal(nextStep(s), 'intake');
  });

  it('a corrupt source.json is an error, not an empty state', async () => {
    const runDir = path.join(dir, 'r2');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'source.json'), '{ nope');
    await assert.rejects(() => loadState(runDir), /source\.json/);
  });
});

describe('status — review r1 regressions', () => {
  const fetched = { ...base, source: { ...base.source, identity: 'sha256:a', fetched: true } };
  const powers = { powers: [{ name: 'p1' }, { name: 'p2' }], not_inventoried: [] };
  const map = { candidates: { p1: [], p2: [] }, judgments: { p1: 'have', p2: 'missing' } };

  it('isDecision accepts only rebuild|use|buy|skip', () => {
    assert.equal(typeof statusMod.isDecision, 'function');
    for (const v of ['rebuild', 'use', 'buy', 'skip']) assert.equal(statusMod.isDecision(v), true, v);
    for (const v of [null, '', 'maybe', undefined, 'toString', 0, true]) assert.equal(statusMod.isDecision(v), false, String(v));
  });

  it('null, empty or unknown decisions are undecided for nextStep and summary alike', () => {
    for (const bad of [null, '', 'maybe', 'toString']) {
      const verdicts = { decisions: { p1: 'skip', p2: bad } };
      assert.equal(nextStep({ ...fetched, powers, map, usage: { evidence: 'none', workflows: [] }, surfaces: { surfaces: [], owner: [] }, targets: { targets: { p1: [], p2: [] } }, verdicts }), 'verdict', String(bad));
      assert.equal(summary({ ...fetched, powers, map, verdicts }).undecided, 1, String(bad));
    }
  });

  it('the egress line counts requests and hosts over http/git rows only; bytes_in sums all rows', () => {
    const zero = { kind: 'none', method: null, url: null, host: null, status: null, bytes_in: 0, bytes_out: 0, note: 'nothing to fetch: paste source' };
    assert.match(renderStatus({ ...fetched, egress: [zero] }), /- Egress: requests=0 bytes_in=0 bodies_sent=0 hosts=none\n/);
    const md = renderStatus({ ...fetched, egress: [zero, { kind: 'git', host: 'github.com', bytes_in: 10 }, { kind: 'http', host: 'e.x', bytes_in: 5 }, { kind: 'none', host: 'bogus', bytes_in: 1 }] });
    assert.match(md, /- Egress: requests=2 bytes_in=16 bodies_sent=0 hosts=github\.com,e\.x\n/);
  });
});

describe('status — review r2 regressions', () => {
  it('loadState reports egress_corrupt and skips a null egress row; renderStatus shows the count', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-st-null-'));
    try {
      await writeJson(path.join(d, 'source.json'), base.source);
      await fs.writeFile(path.join(d, 'egress.jsonl'), 'null\n{"kind":"http","host":"a.b","bytes_in":3}\nnot json\n');
      const state = await loadState(d);
      assert.equal(state.egress.length, 1);
      assert.equal(state.egress_corrupt, 2);
      const md = renderStatus(state);
      assert.match(md, /bytes_in=3 .*\(2 corrupt rows skipped\)\n/);
      assert.equal((await loadState(path.join(d, 'nowhere'))).egress_corrupt, 0);
      assert.doesNotMatch(renderStatus({ ...base, egress_corrupt: 0 }), /corrupt/);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });

  it('renderStatusFile writes atomically (no tmp left behind)', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-st-atomic-'));
    try {
      await writeJson(path.join(d, 'source.json'), base.source);
      await statusMod.renderStatusFile(d);
      assert.deepEqual((await fs.readdir(d)).sort(), ['source.json', 'status.md']);
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
});
