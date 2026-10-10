/**
 * Test helper: what /w-bbs records before the verdict (CHECKPOINTS 3a and 3b): the owner's workflows (usage.json)
 * and, for every power, where it lands (targets.json). A rebuild or use is refused without them, so every test
 * that decides one seeds them here.
 */
import path from 'path';
import { readJson, writeJson } from '../../src/lib/bbs/store.js';

export const OWNER_WORKFLOWS = [{ name: 'w-review', count: 3, sessions: 2, last_used: '2026-10-09T10:00:00.000Z', file: '.claude/commands/.shortcuts/w-review.md', via: { 'w-review': 3 } }];
export const TARGET = { workflow: 'w-review', step: 'w-review', how: 'runs the power at the review step', mode: 'advisory', by: 'proposed' };

export async function landed(dir, runId, { targets = true } = {}) {
  const rd = path.join(dir, '.claude', 'bbs', 'runs', runId);
  await writeJson(path.join(rd, 'usage.json'), { run: runId, ts: '2026-10-10T00:00:00.000Z', evidence: 'transcripts', window_days: 90, files_read: 1, lines_skipped: 0, workflows: OWNER_WORKFLOWS, other_invocations: 0, installed: 1 });
  await writeJson(path.join(rd, 'surfaces.json'), { run: runId, ts: '2026-10-10T00:00:00.000Z', scanned: 0, kinds: {}, surfaces: [], owner: [] });
  if (!targets) return;
  const powers = (await readJson(path.join(rd, 'powers.json')))?.powers || [];
  await writeJson(path.join(rd, 'targets.json'), { run: runId, ts: '2026-10-10T00:00:00.000Z', usage_evidence: 'transcripts', targets: Object.fromEntries(powers.map(p => [p.name, [TARGET]])) });
}
