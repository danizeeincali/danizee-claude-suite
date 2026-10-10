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
    const after1 = kit(['push-gate', 'check']);
    assert.equal(after1.json.decision, 'ask');
    assert.match(after1.json.reason, /earlier/i);
    assert.ok(!(await fs.readdir(pkg.dir)).includes('.claude-receipts'));
    spawnSync('git', ['status'], { cwd: pkg.dir });
    assert.deepEqual(pkg.egress(), []);
  });
});
