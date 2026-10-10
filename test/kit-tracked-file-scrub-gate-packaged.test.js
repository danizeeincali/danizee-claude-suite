import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { installPackaged } from './helpers/packaged.js';

describe('scrub — packaged end to end', () => {
  let pkg, store;
  before(async () => { pkg = await installPackaged(); store = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub-pkg-store-')); });
  after(async () => { await pkg.cleanup(); await fs.rm(store, { recursive: true, force: true }); });
  const git = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: pkg.dir, encoding: 'utf-8' });

  it('configure, scrub, push-gate refuses on a hit, passes once fixed', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('scrub'));
    const none = pkg.kit(['scrub']);
    assert.equal(none.code, 0);
    assert.equal(none.json.configured, false);

    // the kit install git-ignores the private file
    assert.ok((await fs.readFile(path.join(pkg.dir, '.gitignore'), 'utf-8')).split('\n').includes('.claude/kit/scrub-patterns.local'));
    await fs.mkdir(path.join(pkg.dir, '.claude/kit'), { recursive: true });
    await fs.writeFile(path.join(pkg.dir, '.claude/kit/scrub-patterns.local'), 'zebra-secret-name\n');
    await fs.writeFile(path.join(pkg.dir, 'notes.txt'), 'see zebra-secret-name\n');
    await fs.writeFile(path.join(pkg.dir, 'utf16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('zebra-secret-name\n', 'utf16le')]));
    git('add', '-A');
    assert.ok(!git('ls-files').stdout.includes('scrub-patterns.local'), 'the private file is ignored');
    git('commit', '-qm', 'leaky');
    const leaky = git('rev-parse', 'HEAD').stdout.trim();

    const bad = pkg.kit(['scrub']);
    assert.equal(bad.code, 2);
    assert.deepEqual(bad.json.hits.map(h => `${h.file}:${h.line}`).sort(), ['notes.txt:1', 'utf16.txt:1']);
    assert.ok(!bad.out.includes('zebra'), 'stdout never carries the private pattern or match');
    assert.ok(!bad.err.includes('zebra'));

    const rec = pkg.kit(['push-gate', 'receipt', '--verdict', 'pass'], '', { extraEnv: { KIT_RECEIPTS_DIR: store } });
    assert.equal(rec.code, 0);
    const denied = pkg.kit(['push-gate', 'check'], '', { extraEnv: { KIT_RECEIPTS_DIR: store } });
    assert.equal(denied.code, 2);
    assert.equal(denied.json.decision, 'deny');
    assert.ok(!denied.out.includes('zebra'));

    await fs.writeFile(path.join(pkg.dir, 'notes.txt'), 'fixed\n');
    await fs.rm(path.join(pkg.dir, 'utf16.txt'));
    git('add', '-A'); git('commit', '-qm', 'fixed');
    assert.equal(pkg.kit(['scrub']).code, 0);
    // the leak is still in the pushed history unless the base is past it
    pkg.kit(['push-gate', 'receipt', '--verdict', 'pass'], '', { extraEnv: { KIT_RECEIPTS_DIR: store } });
    const stillInHistory = pkg.kit(['push-gate', 'check'], '', { extraEnv: { KIT_RECEIPTS_DIR: store } });
    assert.equal(stillInHistory.code, 2);
    assert.equal(stillInHistory.json.decision, 'deny');
    pkg.kit(['push-gate', 'receipt', '--verdict', 'pass', '--base', leaky], '', { extraEnv: { KIT_RECEIPTS_DIR: store } });
    const ok = pkg.kit(['push-gate', 'check', '--base', leaky], '', { extraEnv: { KIT_RECEIPTS_DIR: store } });
    assert.equal(ok.code, 0);
    assert.equal(ok.json.decision, 'abstain');

    await fs.writeFile(path.join(pkg.dir, '.claude/kit/scrub-patterns.local'), 'broken-[\n');
    assert.equal(pkg.kit(['scrub']).code, 1);
    const closed = pkg.kit(['push-gate', 'check'], '', { extraEnv: { KIT_RECEIPTS_DIR: store } });
    assert.equal(closed.code, 2);
    assert.match(closed.json.reason, /could not run/);
    assert.deepEqual(pkg.egress(), []);
  });
});
