import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run, classify, blocksMerge, TABLE, CLASSES, PRODUCT_JUDGES, verb } from '../src/lib/kit/exit-codes.js';

const bad = (args) => assert.rejects(run(args), (e) => e.code === 1);

describe('exit-codes', () => {
  it('verb name and frozen table', () => {
    assert.equal(verb, 'exit-codes');
    assert.ok(Object.isFrozen(TABLE) && Object.isFrozen(CLASSES) && Object.isFrozen(CLASSES.clean) && Object.isFrozen(TABLE.overrides['safe-git'][3]));
    assert.deepEqual(Object.keys(CLASSES), ['clean', 'usage', 'regression', 'precondition', 'infrastructure']);
    assert.equal(new Set(Object.values(CLASSES).map(c => c.code)).size, 5);
    for (const c of Object.values(CLASSES)) assert.ok(c.description.length > 10);
  });
  it('only regression blocks', async () => {
    assert.deepEqual(Object.entries(CLASSES).filter(([, c]) => c.blocks).map(([n]) => n), ['regression']);
    for (const c of [0, 1, 4, 5, 127, 130, 255]) assert.equal(blocksMerge(c), false, String(c));
    assert.equal(blocksMerge(2), false, 'a bare 2 cannot be told from a refusal');
    assert.equal(blocksMerge(2, 'push-gate'), true);
    assert.equal(blocksMerge(2, 'scrub'), true);
    assert.equal((await run(['table'])).codes[2], 'regression');
  });
  it('0/1/2 keep their meaning', () => {
    assert.equal(classify({ code: 0 }).class, 'clean');
    assert.equal(classify({ code: 1 }).class, 'usage');
    assert.equal(classify({ code: 2, verb: 'push-gate' }).class, 'regression');
    assert.equal(classify({ code: 2 }).class, 'precondition');
  });
  it('safe-git 3 is infrastructure, diff-range 3 is clean, bare 3 is unknown', async () => {
    assert.equal(classify({ code: 3, verb: 'safe-git' }).class, 'infrastructure');
    assert.equal(blocksMerge(3, 'safe-git'), false);
    assert.equal(classify({ code: 3, verb: 'diff-range' }).class, 'clean');
    const r = await run(['describe', '3']);
    assert.equal(r.class, 'unknown');
    assert.equal(r.known, false);
    assert.equal((await run(['describe', '3', '--verb', 'safe-git'])).class, 'infrastructure');
    assert.equal(classify({ code: 2, verb: 'safe-git' }).class, 'precondition');
    assert.equal(blocksMerge(2, 'safe-git'), false);
  });
  it('signals and codes >= 128 are infrastructure', async () => {
    assert.equal(classify({ code: 137 }).class, 'infrastructure');
    assert.equal(classify({ code: 128 }).class, 'infrastructure');
    assert.equal(classify({ code: 127 }).class, 'precondition');
    const s = await run(['classify', '--code', '2', '--signal', 'SIGKILL']);
    assert.equal(s.class, 'infrastructure');
    assert.equal(s.blocks, false);
    assert.equal((await run(['classify', '--signal', 'SIGTERM'])).class, 'infrastructure');
    assert.equal(blocksMerge(2, null, 'SIGSEGV'), false);
  });
  it('unknown is never clean and never blocks', async () => {
    for (const c of [6, 42, 99]) { const r = await run(['classify', '--code', String(c)]); assert.equal(r.class, 'unknown'); assert.equal(r.blocks, false); assert.notEqual(r.class, 'clean'); }
  });
  it('blocks subcommand', async () => {
    assert.equal((await run(['blocks', '2', '--verb', 'push-gate'])).blocks, true);
    assert.equal((await run(['blocks', '2'])).blocks, false);
    assert.equal((await run(['blocks', '5'])).blocks, false);
    assert.equal((await run(['blocks', '3', '--verb', 'safe-git'])).blocks, false);
  });
  it('unlisted verb falls back to defaults; __proto__ verb is safe', () => {
    assert.equal(classify({ code: 2, verb: 'nonesuch' }).class, 'precondition');
    assert.equal(classify({ code: 3, verb: 'constructor' }).class, 'unknown');
  });
  it('bad input is exit 1', async () => {
    await bad(['nope']);
    await bad(['describe']);
    await bad(['describe', 'x']);
    await bad(['describe', '256']);
    await bad(['describe', '-1']);
    await bad(['describe', '1.5']);
    await bad(['describe', '1', '2']);
    await bad(['describe', '1', '--verb']);
    await bad(['describe', '1', '--verb', 'Bad Verb']);
    await bad(['classify']);
    await bad(['classify', '--code', 'abc']);
    await bad(['classify', '--code', '1', '--signal', '../x']);
    await bad(['classify', '--code', '1', '--code', '2']);
    await bad(['classify', '--bogus', '1']);
    await bad(['table', 'extra']);
    assert.equal(blocksMerge('2x'), false);
    assert.equal(blocksMerge(undefined), false);
  });
  it('tool-limit refusals (exit 2) of safe-git and diff-range never block', async () => {
    for (const v of ['safe-git', 'diff-range']) {
      const r = await run(['blocks', '2', '--verb', v]);
      assert.equal(r.blocks, false, v);
      assert.equal(r.class, 'precondition', v);
      assert.equal(blocksMerge(2, v), false, v);
    }
    assert.equal(blocksMerge(2, 'push-gate'), true);
    assert.equal((await run(['describe', '2', '--verb', 'diff-range'])).class, 'precondition');
  });
  it('diff-range 1 and bare 1 admit that a tool failure can surface as 1', async () => {
    const d = await run(['describe', '1', '--verb', 'diff-range']);
    assert.equal(d.blocks, false);
    assert.match(d.description, /timeout|timed out/i);
    assert.match(d.description, /git/i);
    assert.match(classify({ code: 1 }).description, /tool failure|crash/i);
  });
  it('accepts --name=value like sibling verbs', async () => {
    assert.equal((await run(['describe', '2', '--verb=safe-git'])).class, 'precondition');
    assert.equal((await run(['blocks', '3', '--verb=safe-git'])).blocks, false);
    const c = await run(['classify', '--code=2', '--signal=SIGKILL']);
    assert.equal(c.class, 'infrastructure');
    await bad(['describe', '2', '--verb=']);
    await bad(['describe', '2', '--verb=safe-git', '--verb', 'x']);
    await bad(['describe', '2', '--bogus=1']);
  });
  it('exit 2 is a non-blocking refusal unless the verb is a listed product judge', async () => {
    assert.deepEqual([...PRODUCT_JUDGES].sort(), ['push-gate', 'scrub']);
    assert.ok(Object.isFrozen(PRODUCT_JUDGES));
    for (const v of ['graph', 'impact', 'callers', 'guarded-write', 'lenses', 'redact', 'review-score', 'wording-judge', 'safe-git', 'diff-range']) {
      const r = await run(['blocks', '2', '--verb', v]);
      assert.equal(r.blocks, false, v);
      assert.equal(r.class, 'precondition', v);
      assert.equal(blocksMerge(2, v), false, v);
    }
    for (const v of PRODUCT_JUDGES) assert.equal((await run(['blocks', '2', '--verb', v])).blocks, true, v);
    assert.deepEqual((await run(['table'])).product_judges, [...PRODUCT_JUDGES]);
  });
  it('--verb must be a registered kit verb', async () => {
    await bad(['blocks', '2', '--verb', 'safegit']);
    await bad(['describe', '2', '--verb', 'nonesuch']);
    await bad(['classify', '--code', '2', '--verb', 'safegit']);
    assert.equal((await run(['blocks', '2', '--verb', 'safe-git'])).blocks, false);
    assert.equal((await run(['blocks', '2', '--verb', 'exit-codes'])).blocks, false);
  });
  it('table --help prints usage', async () => {
    assert.ok((await run(['table', '--help'])).usage);
    assert.ok((await run(['blocks', '--help'])).usage);
  });
  it('shell statuses 126 and 127 are preconditions, not unknown', async () => {
    for (const c of [126, 127]) {
      const r = await run(['classify', '--code', String(c)]);
      assert.equal(r.class, 'precondition', String(c));
      assert.equal(r.known, true);
      assert.equal(r.blocks, false);
    }
    assert.match(classify({ code: 127 }).description, /not found/i);
    assert.match(classify({ code: 126 }).description, /not executable/i);
  });
  it('describe --help prints usage', async () => {
    assert.ok((await run(['describe', '--help'])).usage);
  });
  it('124 (timeout(1)) is infrastructure', async () => {
    const r = await run(['classify', '--code', '124']);
    assert.equal(r.class, 'infrastructure');
    assert.equal(r.known, true);
    assert.equal(r.blocks, false);
    assert.match(r.description, /timeout/i);
    assert.equal(blocksMerge(124, 'scrub'), false);
  });
  const partial = { configured: true, complete: false, clean: false, hit_count: 0, hits: [], not_scanned: [{ file: 'a.bin', reason: 'object not available locally (partial clone?)' }], exit: 2 };
  const pgTimeout = { decision: 'deny', reason: 'the scrub check is configured but could not run: git config took longer than 1 ms', scrub: { ran: false }, exit: 2 };
  it('without --result a judge exit 2 stays a regression and the description says to pass --result', async () => {
    for (const v of ['scrub', 'push-gate']) {
      const r = await run(['describe', '2', '--verb', v]);
      assert.equal(r.class, 'regression');
      assert.equal(r.blocks, true);
      assert.match(r.description, /--result/);
    }
  });
  it('scrub exit 2 with zero hits and an incomplete scan is infrastructure with --result', () => {
    for (const result of [partial, { hit_count: 0, complete: false, not_scanned: [] }, { hit_count: 0, not_scanned: ['x'] }]) {
      const r = classify({ code: 2, verb: 'scrub', result });
      assert.equal(r.class, 'infrastructure');
      assert.equal(r.blocks, false);
      assert.equal(r.judged, false);
      assert.equal(blocksMerge(2, 'scrub', null, result), false);
    }
  });
  it('a scrub result with hits stays a regression, also when the scan was incomplete', () => {
    assert.equal(classify({ code: 2, verb: 'scrub', result: { hit_count: 1, complete: true, not_scanned: [] } }).class, 'regression');
    assert.equal(classify({ code: 2, verb: 'scrub', result: { hit_count: 2, complete: false, not_scanned: ['x'] } }).blocks, true);
    assert.equal(classify({ code: 2, verb: 'scrub', result: { hit_count: 0, complete: true, not_scanned: [] } }).blocks, true, 'nothing shows it did not judge');
  });
  it('push-gate deny where the scrub check could not run is infrastructure with --result', () => {
    for (const result of [pgTimeout, { decision: 'deny', reason: 'the scrub check is configured but could not run: x' }, { decision: 'deny', reason: 'r', scrub: { ran: true, hit_count: 0, complete: false, not_scanned: ['a'] } }]) {
      const r = classify({ code: 2, verb: 'push-gate', result });
      assert.equal(r.class, 'infrastructure');
      assert.equal(r.blocks, false);
    }
  });
  it('push-gate review deny and scrub hits stay regressions with --result', () => {
    assert.equal(classify({ code: 2, verb: 'push-gate', result: { decision: 'deny', reason: 'the review of this change did not pass (verdict fail)' } }).blocks, true);
    assert.equal(classify({ code: 2, verb: 'push-gate', result: { decision: 'deny', reason: 'the scrub check refused this push: 1 hit(s)', scrub: { ran: true, hit_count: 1, complete: true, hits: [{}], not_scanned: [] } } }).blocks, true);
    assert.equal(classify({ code: 2, verb: 'push-gate', result: { decision: 'deny', reason: 'x', scrub: { ran: true, hit_count: 3, complete: false, not_scanned: ['a'] } } }).blocks, true);
  });
  it('result is ignored for other codes and non-judges', () => {
    assert.equal(classify({ code: 0, verb: 'scrub', result: partial }).class, 'clean');
    assert.equal(classify({ code: 2, verb: 'graph', result: partial }).class, 'precondition');
    assert.equal(classify({ code: 2, result: partial }).class, 'precondition');
    assert.throws(() => classify({ code: 2, verb: 'scrub', result: 'x' }), (e) => e.code === 1);
  });
  it('--result reads a file or piped stdin through the verb', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exitcodes-'));
    try {
      const f = path.join(d, 'r.json');
      fs.writeFileSync(f, JSON.stringify(pgTimeout));
      assert.equal((await run(['classify', '--code', '2', '--verb', 'push-gate', '--result', f])).class, 'infrastructure');
      assert.equal((await run(['blocks', '2', '--verb', 'push-gate', '--result', f])).blocks, false);
      assert.equal((await run(['describe', '2', '--verb', 'scrub', `--result=${f}`])).class, 'regression');
      const io = { stdin: async () => Buffer.from(JSON.stringify(partial)), stdinIsTTY: false };
      assert.equal((await run(['blocks', '2', '--verb', 'scrub', '--result', '-'], io)).blocks, false);
      assert.equal((await run(['blocks', '2', '--verb', 'scrub'], io)).blocks, true);
      await assert.rejects(run(['blocks', '2', '--verb', 'scrub', '--result', '-'], { stdin: async () => Buffer.from(''), stdinIsTTY: true }), (e) => e.code === 1);
      await assert.rejects(run(['blocks', '2', '--verb', 'scrub', '--result', '-'], { stdin: async () => Buffer.from('nope'), stdinIsTTY: false }), (e) => e.code === 1);
      await assert.rejects(run(['blocks', '2', '--verb', 'scrub', '--result', '-'], { stdin: async () => Buffer.from('[1]'), stdinIsTTY: false }), (e) => e.code === 1);
      await assert.rejects(run(['blocks', '2', '--result', path.join(d, 'missing.json')]), (e) => e.code === 1);
      await assert.rejects(run(['blocks', '2', '--result', d]), (e) => e.code === 1);
      await assert.rejects(run(['blocks', '2', '--result', f, '--result', f]), (e) => e.code === 1);
      fs.writeFileSync(f, ' '.repeat(1048577));
      await assert.rejects(run(['blocks', '2', '--result', f]), (e) => e.code === 1);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
});
