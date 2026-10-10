import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { installPackaged } from './helpers/packaged.js';

describe('push-gate — packaged end to end', () => {
  let pkg, store;
  before(async () => { pkg = await installPackaged(); store = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-store-')); });
  after(async () => { await pkg.cleanup(); await fs.rm(store, { recursive: true, force: true }); });
  const kit = (args) => pkg.kit(args, '', { extraEnv: { KIT_RECEIPTS_DIR: store } });

  it('review, record, push check, edit, push check again', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('push-gate'));
    const ask = kit(['push-gate', 'check']);
    assert.equal(ask.code, 0);
    assert.equal(ask.json.decision, 'ask');
    const deny = kit(['push-gate', 'check', '--threshold', 'high']);
    assert.equal(deny.code, 2);

    const rec = kit(['push-gate', 'receipt', '--verdict', 'pass', '--high', '0', '--medium', '1', '--low', '2']);
    assert.equal(rec.code, 0);
    assert.equal(rec.json.receipt.verdict, 'pass');
    const ok = kit(['push-gate', 'check']);
    assert.equal(ok.json.decision, 'abstain');

    await fs.writeFile(path.join(pkg.dir, 'new.txt'), 'x');
    const git = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: pkg.dir, encoding: 'utf-8' });
    git('add', 'new.txt');
    git('commit', '-qm', 'after the review');
    const after1 = kit(['push-gate', 'check']);
    assert.equal(after1.json.decision, 'ask');
    assert.match(after1.json.reason, /earlier/i);
    // review uncommitted work, commit it unchanged, then push-check
    await fs.writeFile(path.join(pkg.dir, 'new.txt'), 'x\ny');
    const rec2 = kit(['push-gate', 'receipt', '--verdict', 'pass', '--threshold', 'high']);
    assert.equal(rec2.code, 0);
    assert.equal(kit(['push-gate', 'check', '--threshold', 'high']).json.decision, 'deny');
    git('commit', '-qam', 'reviewed fix');
    assert.equal(kit(['push-gate', 'check', '--threshold', 'high']).json.decision, 'abstain');
    assert.equal(kit(['push-gate', 'check', '--treshold', 'high']).code, 1);
    assert.ok(!(await fs.readdir(pkg.dir)).includes('.claude-receipts'));
    spawnSync('git', ['status'], { cwd: pkg.dir });
    assert.deepEqual(pkg.egress(), []);
  });
});
