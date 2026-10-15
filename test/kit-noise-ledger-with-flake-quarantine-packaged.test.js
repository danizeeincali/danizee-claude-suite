import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('noise-ledger — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('accept, apply (cap, quarantine, accepted, first run), expiry, prune', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('noise-ledger'));
    const fd = (id, severity, locations, extra = {}) => ({ id, severity, rule: 'r', locations, ...extra });
    const input = JSON.stringify({ findings: [
      fd('a', 'high', ['s1', 's2']), fd('b', 'high', ['s1']), fd('c', 'medium', ['s1']),
      fd('d', 'low', ['s1']), fd('flaky', 'high', ['s1'], { failures: 3, reproductions: 1 }), fd('known', 'high', ['s9'])
    ] });

    const acc = pkg.kit(['noise-ledger', 'accept', '--id', 'known', '--reason', 'tracked elsewhere', '--expires', '2026-12-31', '--now', '2026-10-15']);
    assert.equal(acc.code, 0, acc.err);
    const ledgerPath = path.join(pkg.dir, '.claude/kit/noise-ledger.json');
    assert.equal(JSON.parse(await fs.readFile(ledgerPath, 'utf-8')).entries[0].id, 'known');

    const r = pkg.kit(['noise-ledger', 'apply', '--cap', '2', '--now', '2026-10-15'], input);
    assert.equal(r.code, 0, 'advisory: findings never fail the verb');
    assert.deepEqual(r.json.filed.map(x => x.id), ['a', 'b']);
    assert.deepEqual(r.json.summary.ids, ['c', 'd']);
    assert.deepEqual(r.json.quarantined.map(x => x.id), ['flaky']);
    assert.deepEqual(r.json.accepted.map(x => x.id), ['known']);
    assert.equal(r.json.blocking, true);
    assert.equal(r.json.needs_attention, true);
    assert.equal(r.json.flake_rate, 2 / 3);
    assert.equal(pkg.kit(['noise-ledger', 'apply', '--cap', '2', '--now', '2026-10-15'], input).out, r.out, 'deterministic');

    const first = pkg.kit(['noise-ledger', 'apply', '--first-run', '--now', '2026-10-15'], input);
    assert.equal(first.code, 0);
    assert.equal(first.json.blocking, false);
    assert.equal(first.json.filed.length, 4);

    const lapsed = pkg.kit(['noise-ledger', 'apply', '--now', '2027-01-01'], input);
    assert.ok(lapsed.json.filed.some(x => x.id === 'known'), 'expired entry no longer matches');
    assert.deepEqual(lapsed.json.accepted, []);

    const pr = pkg.kit(['noise-ledger', 'prune', '--now', '2027-01-01']);
    assert.deepEqual(pr.json.pruned.map(e => e.id), ['known']);

    assert.equal(pkg.kit(['noise-ledger', 'apply', '--now', '2026-10-15'], '{broken').code, 1);
    assert.equal(pkg.kit(['noise-ledger', 'accept', '--id', 'x', '--reason', 'y', '--expires', '2026-02-30']).code, 1);
    assert.deepEqual(pkg.egress(), []);
  });
});
