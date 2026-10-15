import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
    for (const v of ['nonesuch', 'constructor', '__proto__']) assert.throws(() => classify({ code: 2, verb: v }), (e) => e.code === 1, v);
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
    assert.throws(() => blocksMerge('2x'), (e) => e.code === 1);
    assert.throws(() => blocksMerge(undefined), (e) => e.code === 1);
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
  it('scrub exit 2 with zero hits and a partial-clone scan blocks with --result (judges fail closed)', () => {
    for (const result of [partial, { hit_count: 0, complete: false, not_scanned: [{ file: 'a', reason: 'object not available locally (partial clone?)' }, { file: 'b', reason: 'object not available locally (partial clone?)' }] }]) {
      const r = classify({ code: 2, verb: 'scrub', result });
      assert.equal(r.class, 'regression');
      assert.equal(r.blocks, true);
      assert.equal(blocksMerge(2, 'scrub', null, result), true);
      assert.match(r.description, /full clone/);
      assert.match(r.description, /fetch the missing blobs/i);
      assert.doesNotMatch(r.description, /network/i);
    }
  });
  it('a scrub result with hits stays a regression, also when the scan was incomplete', () => {
    assert.equal(classify({ code: 2, verb: 'scrub', result: { hit_count: 1, complete: true, not_scanned: [] } }).class, 'regression');
    assert.equal(classify({ code: 2, verb: 'scrub', result: { hit_count: 2, complete: false, not_scanned: ['x'] } }).blocks, true);
    assert.equal(classify({ code: 2, verb: 'scrub', result: { hit_count: 0, complete: true, not_scanned: [] } }).blocks, true, 'nothing shows it did not judge');
  });
  it('scrub exit 2 where any skipped file has a product or unknown reason stays a regression with --result', () => {
    const env = { file: 'a', reason: 'object not available locally (partial clone?)' };
    for (const reason of ['larger than 100 bytes', 'total size limit reached', 'not a regular file on disk', 'tracked but missing on disk', 'cannot read: EACCES', 'something new', undefined]) {
      for (const ns of [[{ file: 'big', reason }], [env, { file: 'big', reason }]]) {
        const result = { hit_count: 0, complete: false, not_scanned: ns };
        assert.equal(classify({ code: 2, verb: 'scrub', result }).class, 'regression', String(reason));
        assert.equal(blocksMerge(2, 'scrub', null, result), true);
        const pg = { decision: 'deny', reason: 'the scrub check refused this push: x', scrub: { ran: true, hit_count: 0, complete: false, not_scanned: ns } };
        assert.equal(classify({ code: 2, verb: 'push-gate', result: pg }).blocks, true, String(reason));
      }
    }
    for (const ns of [[], ['x'], undefined]) assert.equal(blocksMerge(2, 'scrub', null, { hit_count: 0, complete: false, not_scanned: ns }), true);
  });
  it('push-gate deny where the scrub check could not run still blocks with --result (judges fail closed)', () => {
    for (const result of [pgTimeout, { decision: 'deny', reason: 'the scrub check is configured but could not run: git ls-files wrote more than 256 MiB of output; narrow the command' }, { decision: 'deny', reason: 'the scrub check is configured but could not run: cannot run git: spawn ENOENT', scrub: { ran: false } }, { decision: 'deny', reason: 'r', scrub: { ran: true, hit_count: 0, complete: false, not_scanned: [{ file: 'a', reason: 'object not available locally (partial clone?)' }] } }]) {
      const r = classify({ code: 2, verb: 'push-gate', result });
      assert.equal(r.class, 'regression');
      assert.equal(r.blocks, true);
    }
  });
  it('push-gate deny for a scrub refusal (not an environment cause) always blocks, even with scrub.ran false', () => {
    for (const msg of [
      '.claude/kit/scrub-patterns.local (the private pattern file) is tracked by git and would be published',
      'more than 200000 tracked files; refusing',
      'pattern file .claude/kit/scrub-patterns.local is invalid: bad regex',
      'x',
      'a note: git ls-files took longer than 5 ms and was stopped'
    ]) {
      const result = { decision: 'deny', reason: `the scrub check is configured but could not run: ${msg}`, scrub: { ran: false }, exit: 2 };
      const r = classify({ code: 2, verb: 'push-gate', result });
      assert.equal(r.blocks, true, msg);
      assert.equal(r.class, 'regression', msg);
      assert.equal(blocksMerge(2, 'push-gate', null, result), true, msg);
    }
    assert.equal(classify({ code: 2, verb: 'push-gate', result: { decision: 'deny', reason: 'r', scrub: { ran: false } } }).blocks, true);
  });
  it('fail-closed remedy follows the reason, and an empty --result names a refusal too', async () => {
    const d = (reason) => classify({ code: 2, verb: 'scrub', result: { hit_count: 0, complete: false, not_scanned: [{ file: 'a', reason }] } }).description;
    assert.doesNotMatch(d('tracked but missing on disk'), /Shrink|higher limit/);
    assert.doesNotMatch(d('not a regular file on disk'), /Shrink|higher limit/);
    assert.doesNotMatch(d('cannot read: EACCES'), /Shrink|higher limit/);
    assert.doesNotMatch(d('total size limit reached'), /higher limit/);
    assert.match(d('total size limit reached'), /smaller range/);
    assert.match(d('larger than 1048576 bytes'), /--max-file-bytes/);
    const empty = await run(['classify', '--code', '2', '--verb', 'scrub', '--result', '-'], { stdin: async () => Buffer.from(''), stdinIsTTY: false });
    assert.equal(empty.class, 'regression');
    assert.equal(empty.blocks, true);
    assert.match(empty.description, /printed nothing.*crashed or refused.*stderr/);
  });
  it('a push-gate not_scanned list always blocks, and at the cap (20) the description says it may be truncated', () => {
    const miss = (n) => Array.from({ length: n }, (_, i) => ({ file: `f${i}`, reason: 'object not available locally (partial clone?)' }));
    const pg = (n) => ({ decision: 'deny', reason: 'the scrub check refused this push: 0 hit(s)', scrub: { ran: true, hit_count: 0, complete: false, hits: [], not_scanned: miss(n) } });
    // 20 partial-clone entries may hide a 21st 'larger than' entry that push-gate sliced off: the deny keeps blocking.
    assert.equal(classify({ code: 2, verb: 'push-gate', result: pg(20) }).blocks, true);
    assert.equal(classify({ code: 2, verb: 'push-gate', result: pg(25) }).blocks, true);
    assert.equal(classify({ code: 2, verb: 'push-gate', result: pg(19) }).blocks, true);
    assert.equal(classify({ code: 2, verb: 'push-gate', result: pg(19) }).class, 'regression');
    assert.match(classify({ code: 2, verb: 'push-gate', result: pg(20) }).description, /at most 20 files/);
    assert.doesNotMatch(classify({ code: 2, verb: 'push-gate', result: pg(19) }).description, /at most 20 files/);
    assert.equal(classify({ code: 2, verb: 'scrub', result: { hit_count: 0, complete: false, not_scanned: miss(25) } }).blocks, true);
  });
  it('a zero-hit partial-clone scrub result over 1 MiB blocks on every path (text, file, stdin, library string and object)', async () => {
    const ns = Array.from({ length: 8000 }, (_, i) => ({ file: `src/generated/module-${i}/some/deeply/nested/path/file-${i}.js`, reason: 'object not available locally (partial clone?)' }));
    const obj = { exit: 2, ran: true, hit_count: 0, complete: false, hits: [], not_scanned: ns };
    const text = JSON.stringify(obj, null, 2);
    assert.ok(Buffer.byteLength(text) > 1048576, 'fixture is over 1 MiB');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-big-'));
    try {
      const f = path.join(dir, 'big.json');
      fs.writeFileSync(f, text);
      const cli = path.resolve('src/lib/kit/cli.js');
      const viaFile = spawnSync(process.execPath, [cli, 'exit-codes', 'classify', '--code', '2', '--verb', 'scrub', '--result', f], { encoding: 'utf-8' });
      assert.equal(JSON.parse(viaFile.stdout).class, 'regression');
      assert.equal(JSON.parse(viaFile.stdout).blocks, true);
      const viaStdin = spawnSync(process.execPath, [cli, 'exit-codes', 'classify', '--code', '2', '--verb', 'scrub', '--result', '-'], { input: text, encoding: 'utf-8' });
      assert.equal(JSON.parse(viaStdin.stdout).class, 'regression');
      assert.equal((await run(['blocks', '2', '--verb', 'scrub', '--result', f])).blocks, true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    assert.equal(blocksMerge(2, 'scrub', null, text), true, 'string');
    assert.equal(blocksMerge(2, 'scrub', null, obj), true, 'object');
    assert.equal(classify({ code: 2, verb: 'scrub', result: text }).class, 'regression');
    assert.equal(classify({ code: 2, verb: 'scrub', result: obj }).class, 'regression');
  });
  it('the string and object library paths apply the same size rule beyond the cap', () => {
    const cap = 64 * 1048576;
    const pad = 'x'.repeat(cap);
    const obj = { hit_count: 0, complete: false, pad, not_scanned: [{ file: 'a', reason: 'object not available locally (partial clone?)' }] };
    for (const r of [obj, JSON.stringify(obj)]) {
      const c = classify({ code: 2, verb: 'scrub', result: r });
      assert.equal(c.blocks, true);
      assert.match(c.description, /larger than 67108864 bytes/);
    }
  });
  it('--result - stops reading stdin once the cap is passed', async () => {
    let asked = null;
    const big = { stdin: async (o) => { asked = o; return Buffer.alloc(67108865, 32); }, stdinIsTTY: false };
    const tooBig = await run(['classify', '--code', '2', '--verb', 'scrub', '--result', '-'], big);
    assert.equal(tooBig.blocks, true, 'a judge 2 whose result cannot be read blocks');
    assert.match(tooBig.description, /larger than 67108864 bytes/);
    assert.equal(asked && asked.maxBytes, 67108865, 'the reader is given a bound');
    const ok = { stdin: async (o) => { asked = o; return Buffer.from(JSON.stringify({ hit_count: 1 })); }, stdinIsTTY: false };
    assert.equal((await run(['blocks', '2', '--verb', 'scrub', '--result', '-'], ok)).blocks, true);
  });
  it('cli.js --result - with oversized piped stdin blocks a judge 2 and names the size', () => {
    const cli = path.resolve('src/lib/kit/cli.js');
    const r = spawnSync(process.execPath, [cli, 'exit-codes', 'classify', '--code', '2', '--verb', 'scrub', '--result', '-'], { input: Buffer.alloc(65 * 1024 * 1024, 32), encoding: 'utf-8' });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).blocks, true);
    assert.match(r.stdout, /larger than 67108864 bytes/);
  });
  it('push-gate review deny and scrub hits stay regressions with --result', () => {
    assert.equal(classify({ code: 2, verb: 'push-gate', result: { decision: 'deny', reason: 'the review of this change did not pass (verdict fail)' } }).blocks, true);
    assert.equal(classify({ code: 2, verb: 'push-gate', result: { decision: 'deny', reason: 'the scrub check refused this push: 1 hit(s)', scrub: { ran: true, hit_count: 1, complete: true, hits: [{}], not_scanned: [] } } }).blocks, true);
    assert.equal(classify({ code: 2, verb: 'push-gate', result: { decision: 'deny', reason: 'x', scrub: { ran: true, hit_count: 3, complete: false, not_scanned: ['a'] } } }).blocks, true);
  });
  it('result is ignored for other codes and non-judges', () => {
    assert.throws(() => classify({ code: 0, verb: 'scrub', result: partial }), (e) => e.code === 1, 'a judge result saying exit 2 given with code 0 is a stale status');
    assert.equal(classify({ code: 0, verb: 'scrub', result: { ...partial, exit: 0 } }).class, 'clean');
    assert.equal(classify({ code: 0, verb: 'scrub', result: 'not json' }).class, 'clean');
    assert.equal(classify({ code: 0, verb: 'graph', result: partial }).class, 'clean');
    assert.equal(classify({ code: 2, verb: 'graph', result: partial }).class, 'precondition');
    assert.equal(classify({ code: 2, result: partial }).class, 'precondition');
    assert.equal(classify({ code: 2, verb: 'scrub', result: 'x' }).blocks, true, 'a judge 2 with an unusable result blocks, it does not throw');
  });
  it('--result reads a file or piped stdin through the verb', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exitcodes-'));
    try {
      const f = path.join(d, 'r.json');
      fs.writeFileSync(f, JSON.stringify(pgTimeout));
      assert.equal((await run(['classify', '--code', '2', '--verb', 'push-gate', '--result', f])).class, 'regression');
      assert.equal((await run(['blocks', '2', '--verb', 'push-gate', '--result', f])).blocks, true);
      assert.equal((await run(['describe', '2', '--verb', 'scrub', `--result=${f}`])).class, 'regression');
      const io = { stdin: async () => Buffer.from(JSON.stringify(partial)), stdinIsTTY: false };
      assert.equal((await run(['blocks', '2', '--verb', 'scrub', '--result', '-'], io)).blocks, true);
      assert.equal((await run(['blocks', '2', '--verb', 'scrub'], io)).blocks, true);
      await assert.rejects(run(['blocks', '2', '--verb', 'scrub', '--result', '-'], { stdin: async () => Buffer.from(''), stdinIsTTY: true }), (e) => e.code === 1);
      assert.equal((await run(['blocks', '2', '--verb', 'scrub', '--result', '-'], { stdin: async () => Buffer.from('nope'), stdinIsTTY: false })).blocks, true);
      assert.equal((await run(['blocks', '2', '--verb', 'scrub', '--result', '-'], { stdin: async () => Buffer.from('[1]'), stdinIsTTY: false })).blocks, true);
      await assert.rejects(run(['blocks', '2', '--verb', 'scrub', '--result', path.join(d, 'missing.json')]), (e) => e.code === 1);
      await assert.rejects(run(['blocks', '2', '--verb', 'scrub', '--result', d]), (e) => e.code === 1);
      await assert.rejects(run(['blocks', '2', '--result', f, '--result', f]), (e) => e.code === 1);
      fs.writeFileSync(f, ' '.repeat(1048577));
      assert.equal((await run(['blocks', '2', '--verb', 'scrub', '--result', f])).blocks, true);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it('a fail-closed incomplete scan with --result is described by its unscanned reason, not as a verdict', () => {
    const ns = [{ path: 'a', reason: 'larger than 100 bytes' }, { path: 'b', reason: 'not a regular file' }];
    const r = classify({ code: 2, verb: 'scrub', result: { hit_count: 0, not_scanned: ns } });
    assert.equal(r.blocks, true);
    assert.equal(r.class, 'regression');
    assert.match(r.description, /fail closed/i);
    assert.match(r.description, /larger than 100 bytes/);
    assert.match(r.description, /not a regular file/);
    assert.doesNotMatch(r.description, /ran and said no/);
    const pg = classify({ code: 2, verb: 'push-gate', result: { decision: 'deny', reason: 'x', scrub: { ran: true, hit_count: 0, not_scanned: ns } } });
    assert.equal(pg.blocks, true);
    assert.match(pg.description, /larger than 100 bytes/);
    // real hits keep the generic text
    assert.match(classify({ code: 2, verb: 'scrub', result: { hit_count: 1, not_scanned: ns } }).description, /ran and said no/);
  });
  it('the header and usage describe the fail-closed rule and no reclassification path is left', () => {
    const src = fs.readFileSync(new URL('../src/lib/kit/exit-codes.js', import.meta.url), 'utf-8');
    assert.match(src.split('*/')[0], /ALWAYS\s+\* blocks/);
    assert.match(src.split('*/')[0], /GIT_NO_LAZY_FETCH/);
    assert.doesNotMatch(src, /ENV_REASONS|ENV_COULD_NOT_RUN|unjudgedReason|NOT_JUDGED|incompleteNoHits|judged: false|every not_scanned reason/);
  });
  it('a sparse blobless clone (file://, no network): a secret outside the cone is unscanned and the gate blocks', () => {
    const cli = path.resolve('src/lib/kit/cli.js');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-sparse-'));
    try {
      const sh = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf-8' }); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r; };
      const src = path.join(d, 'src');
      fs.mkdirSync(path.join(src, '.claude', 'kit'), { recursive: true });
      fs.mkdirSync(path.join(src, 'other'), { recursive: true });
      fs.mkdirSync(path.join(src, 'keep'), { recursive: true });
      fs.writeFileSync(path.join(src, '.claude', 'kit', 'scrub-patterns'), 'AKIA[0-9A-Z]{16}\n');
      fs.writeFileSync(path.join(src, 'keep', 'ok.txt'), 'fine\n');
      fs.writeFileSync(path.join(src, 'other', 'leak.txt'), 'AKIAABCDEFGHIJKLMNOP\n');
      sh(src, 'init', '-q'); sh(src, 'config', 'user.email', 'a@b.c'); sh(src, 'config', 'user.name', 'a');
      sh(src, 'config', 'uploadpack.allowFilter', 'true'); sh(src, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
      sh(src, 'add', '-A'); sh(src, 'commit', '-qm', 'x');
      const clone = path.join(d, 'clone');
      sh(d, '-c', 'protocol.file.allow=always', 'clone', '-q', '--filter=blob:none', '--sparse', '--no-checkout', `file://${src}`, clone);
      sh(clone, 'sparse-checkout', 'set', '.claude', 'keep');
      sh(clone, 'checkout', '-q');
      const sc = spawnSync(process.execPath, [cli, 'scrub'], { cwd: clone, encoding: 'utf-8' });
      assert.equal(sc.status, 2, sc.stderr);
      const out = JSON.parse(sc.stdout);
      assert.equal(out.hit_count, 0);
      assert.ok(out.not_scanned.some((e) => e.reason === 'object not available locally (partial clone?)'), sc.stdout);
      const f = path.join(d, 'r.json');
      fs.writeFileSync(f, sc.stdout);
      const b = JSON.parse(spawnSync(process.execPath, [cli, 'exit-codes', 'blocks', '2', '--verb', 'scrub', '--result', f], { encoding: 'utf-8' }).stdout);
      assert.equal(b.blocks, true);
      assert.equal(b.class, 'regression');
      const c = JSON.parse(spawnSync(process.execPath, [cli, 'exit-codes', 'describe', '2', '--verb', 'scrub', '--result', f], { encoding: 'utf-8' }).stdout);
      assert.match(c.description, /full clone/);
      assert.equal(blocksMerge(2, 'scrub', null, sc.stdout), true);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  it('an empty piped --result says nothing was piped', async () => {
    const r = await run(['classify', '--code', '2', '--verb', 'scrub', '--result', '-'], { stdin: async () => Buffer.from('  \n'), stdinIsTTY: false });
    assert.equal(r.blocks, true);
    assert.match(r.description, /printed nothing/);
    assert.doesNotMatch(r.description, /not valid JSON/);
  });
  it('library entry fails closed like the CLI: bad verb, bad result and bad code are KitExit 1, never false', async () => {
    const { loadVerbs } = await import('../src/lib/kit/cli.js');
    for (const v of (await loadVerbs()).keys()) assert.doesNotThrow(() => classify({ code: 1, verb: v }), v);
    for (const v of ['Scrub', 'scrub ', 'pushgate', ' scrub', 'SCRUB', 'nonesuch', '', 5, {}]) {
      assert.throws(() => blocksMerge(2, v), (e) => e.code === 1, JSON.stringify(v));
      assert.throws(() => classify({ code: 2, verb: v }), (e) => e.code === 1, JSON.stringify(v));
    }
    assert.throws(() => blocksMerge(2, 'Scrub', 'SIGKILL'), (e) => e.code === 1);
    const hit = '{"hit_count":3,"not_scanned":[]}';
    assert.equal(blocksMerge(2, 'scrub', null, hit), true);
    assert.equal(blocksMerge(2, 'scrub', null, { hit_count: 3, not_scanned: [] }), true);
    const partial = { hit_count: 0, not_scanned: [{ file: 'a', reason: 'object not available locally (partial clone?)' }] };
    assert.equal(blocksMerge(2, 'scrub', null, JSON.stringify(partial)), true);
    for (const r of ['not json', '', '  \n', '[]', '3', 'null', '"x"', 'x'.repeat(1048577), [], 5]) {
      assert.equal(blocksMerge(2, 'scrub', null, r), true, String(r).slice(0, 20));
      assert.equal(classify({ code: 2, verb: 'scrub', result: r }).class, 'regression');
    }
    assert.throws(() => blocksMerge(300, 'scrub'), (e) => e.code === 1);
  });

  describe('whole input space: code x signal x verb x result', () => {
    // Rule: a judge's exit 2 ALWAYS blocks (regression), whatever the result says; the result is read only for a judge verb with no
    // signal, to describe the 2 and to reject an exit field that contradicts the code. Empty, truncated or unusable output blocks too. At ANY code, a result that parses as an object whose numeric exit field
    // differs from the code is KitExit 1. At a code other than 2, empty or unparseable content is ignored. Nothing else throws on result
    // content, so otherwise the class comes from code, signal and verb alone (a non-judge verb or a signal never reads the result).
    const CODES = [0, 1, 2, 124, 126, 127, 137, null];
    const SIGNALS = [null, 'SIGKILL'];
    const VERBS = ['scrub', 'push-gate', 'graph'];
    const JUDGES = ['scrub', 'push-gate'];
    const exitOf = (code) => (code === 2 ? 0 : 2);
    const results = (v, code) => ({
      none: null,
      empty: '',
      truncated: '{"hit_count":3,"not_scanned":[{"file":"a","rea',
      clean: v === 'push-gate' ? '{"decision":"allow"}' : '{"hit_count":0,"complete":true,"not_scanned":[]}',
      partial: v === 'push-gate' ? '{"decision":"deny","reason":"x","scrub":{"ran":true,"hit_count":0,"complete":false,"not_scanned":[{"file":"a","reason":"object not available locally (partial clone?)"}]}}' : '{"hit_count":0,"complete":false,"not_scanned":[{"file":"a","reason":"object not available locally (partial clone?)"}]}',
      unrun: v === 'push-gate' ? '{"decision":"deny","reason":"the scrub check is configured but could not run: git config took longer than 1 ms","scrub":{"ran":false}}' : '{"hit_count":0,"complete":false,"not_scanned":[]}',
      hits: v === 'push-gate' ? '{"decision":"deny","reason":"x","scrub":{"ran":true,"hit_count":3,"complete":true,"not_scanned":[]},"exit":2}' : '{"hit_count":3,"complete":true,"not_scanned":[],"exit":2}',
      mismatch: v === 'push-gate' ? `{"decision":"deny","reason":"x","exit":${exitOf(code)}}` : `{"hit_count":3,"complete":true,"not_scanned":[],"exit":${exitOf(code)}}`,
    });
    const BASE = { 0: 'clean', 1: 'usage', 124: 'infrastructure', 126: 'precondition', 127: 'precondition', 137: 'infrastructure' };
    // The oracle: { throws: true } or { cls, blocks }, from the rule alone.
    const expected = (code, signal, v, rname, text) => {
      if (signal) return { cls: 'infrastructure', blocks: false };
      if (code === null) return { throws: true };
      let exitField;
      try { exitField = JSON.parse(text).exit; } catch { /* empty, truncated or absent */ }
      if (JUDGES.includes(v) && typeof exitField === 'number' && exitField !== code) return { throws: true };
      if (code === 2 && JUDGES.includes(v)) return { cls: 'regression', blocks: true };
      if (code === 2) return { cls: 'precondition', blocks: false };
      return { cls: BASE[code], blocks: false };
    };
    const io = (text) => ({ stdin: async () => Buffer.from(text), stdinIsTTY: false });
    const label = (code, signal, v, rname) => `code=${code} signal=${signal} verb=${v} result=${rname}`;

    it('CLI classify and blocks, and blocksMerge/classify, agree with the rule on every combination', async () => {
      let n = 0;
      for (const code of CODES) for (const signal of SIGNALS) for (const v of VERBS) {
        const rs = results(v, code);
        for (const [rname, text] of Object.entries(rs)) {
          n++;
          const want = expected(code, signal, v, rname, text);
          const L = label(code, signal, v, rname);
          const cls = ['classify'];
          if (code !== null) cls.push('--code', String(code));
          if (signal) cls.push('--signal', signal);
          if (code === null && !signal) cls.push('--code', 'x'); // no code and no signal is not a call at all
          cls.push('--verb', v);
          if (text !== null) cls.push('--result', '-');
          const cli = run(cls, io(text ?? ''));
          const lib = () => classify({ code, signal, verb: v, result: text });
          const merge = () => blocksMerge(code, v, signal, text);
          if (want.throws) {
            await assert.rejects(cli, (e) => e.code === 1, `cli ${L}`);
            assert.throws(lib, (e) => e.code === 1, `lib ${L}`);
            assert.throws(merge, (e) => e.code === 1, `merge ${L}`);
          } else {
            const r = await cli;
            assert.equal(r.class, want.cls, `cli class ${L}`);
            assert.equal(r.blocks, want.blocks, `cli blocks ${L}`);
            assert.equal(lib().class, want.cls, `lib class ${L}`);
            assert.equal(merge(), want.blocks, `merge ${L}`);
            if (code !== null && !signal) {
              const b = ['blocks', String(code), '--verb', v];
              if (text !== null) b.push('--result', '-');
              assert.equal((await run(b, io(text ?? ''))).blocks, want.blocks, `cli blocks verb ${L}`);
              const d = ['describe', String(code), '--verb', v];
              if (text !== null) d.push('--result', '-');
              assert.equal((await run(d, io(text ?? ''))).class, want.cls, `cli describe ${L}`);
            }
          }
        }
      }
      assert.equal(n, 8 * 2 * 3 * 8);
    });

    it('a result is not even read unless the verb is a judge and there is no signal', async () => {
      for (const code of CODES.filter((c) => c !== null)) for (const signal of SIGNALS) for (const v of VERBS) {
        if (!signal && JUDGES.includes(v)) continue;
        let asked = 0;
        const args = ['classify', '--code', String(code), '--verb', v, '--result', '-'];
        if (signal) args.push('--signal', signal);
        await run(args, { stdin: async () => { asked++; return Buffer.from(''); }, stdinIsTTY: true });
        assert.equal(asked, 0, label(code, signal, v, 'stdin'));
      }
    });

    it('real cli.js: crashed, killed and timed-out judges with an empty or truncated result never exit 1', () => {
      const cli = path.resolve('src/lib/kit/cli.js');
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exitcodes-table-'));
      try {
        for (const [name, text] of [['empty', ''], ['truncated', '{"decision":"deny","rea']]) {
          const f = path.join(d, `${name}.json`);
          fs.writeFileSync(f, text);
          const go = (args) => spawnSync(process.execPath, [cli, 'exit-codes', ...args, '--result', f], { encoding: 'utf-8' });
          for (const [args, cls, blocks] of [
            [['classify', '--signal', 'SIGKILL', '--verb', 'scrub'], 'infrastructure', false],
            [['classify', '--code', '137', '--verb', 'scrub'], 'infrastructure', false],
            [['blocks', '124', '--verb', 'scrub'], 'infrastructure', false],
            [['blocks', '127', '--verb', 'push-gate'], 'precondition', false],
            [['blocks', '1', '--verb', 'push-gate'], 'usage', false],
            [['blocks', '2', '--verb', 'push-gate'], 'regression', true],
          ]) {
            const r = go(args);
            assert.equal(r.status, 0, `${name} ${args.join(' ')}: ${r.stderr}`);
            const j = JSON.parse(r.stdout);
            assert.equal(j.class, cls, `${name} ${args.join(' ')}`);
            assert.equal(j.blocks, blocks, `${name} ${args.join(' ')}`);
          }
        }
        const lie = spawnSync(process.execPath, [cli, 'exit-codes', 'blocks', '2', '--verb', 'scrub', '--result', '-'], { input: '{"hit_count":0,"exit":0}', encoding: 'utf-8' });
        assert.equal(lie.status, 1);
        for (const c of ['0', '1', '124']) {
          const stale = spawnSync(process.execPath, [cli, 'exit-codes', 'blocks', c, '--verb', 'scrub', '--result', '-'], { input: '{"hit_count":3,"exit":2}', encoding: 'utf-8' });
          assert.equal(stale.status, 1, `stale ${c}`);
        }
        const junk = spawnSync(process.execPath, [cli, 'exit-codes', 'blocks', '0', '--verb', 'scrub', '--result', '-'], { input: '{"hit_', encoding: 'utf-8' });
        assert.equal(junk.status, 0);
        assert.match(lie.stderr + lie.stdout, /exited 0 but the status given is 2/);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });
  });
});
