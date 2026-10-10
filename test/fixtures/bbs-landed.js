/**
 * Test helper: the owner's workflows for a run, as /w-bbs records them before the verdict (CHECKPOINT 3a).
 * A rebuild or use is refused without them, so every test that decides one seeds them here.
 */
import path from 'path';
import { writeJson } from '../../src/lib/bbs/store.js';

export const OWNER_WORKFLOWS = [{ name: 'w-marathon', count: 3, sessions: 2, last_used: '2026-10-09T10:00:00.000Z', file: '.claude/commands/.shortcuts/w-marathon.md', via: { mt: 3 } }];

export async function landed(dir, runId) {
  const rd = path.join(dir, '.claude', 'bbs', 'runs', runId);
  await writeJson(path.join(rd, 'usage.json'), { run: runId, ts: '2026-10-10T00:00:00.000Z', evidence: 'transcripts', window_days: 90, files_read: 1, lines_skipped: 0, workflows: OWNER_WORKFLOWS, other: {}, installed: 1 });
}
