/**
 * Subagent prompt cache TTL: init/update give subagents a one-hour cache unless the
 * project already chose a value.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getDefaultSettings, mergeSettings } from '../src/utils/settings.js';

async function tmpClaudeDir(settings) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'suite-cache-ttl-'));
  if (settings) await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify(settings));
  return dir;
}

describe('subagentPromptCacheTtl', () => {
  it('defaults to one hour', () => {
    assert.equal(getDefaultSettings().subagentPromptCacheTtl, '1h');
  });

  it('is written on a fresh install', async () => {
    const merged = await mergeSettings(await tmpClaudeDir());
    assert.equal(merged.subagentPromptCacheTtl, '1h');
  });

  it("keeps the owner's own value on update", async () => {
    const dir = await tmpClaudeDir({ subagentPromptCacheTtl: '5m', promptCacheTtl: '1h' });
    const merged = await mergeSettings(dir, { force: true });
    assert.equal(merged.subagentPromptCacheTtl, '5m');
    assert.equal(merged.promptCacheTtl, '1h');
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf-8'));
    assert.equal(onDisk.subagentPromptCacheTtl, '5m');
  });
});
