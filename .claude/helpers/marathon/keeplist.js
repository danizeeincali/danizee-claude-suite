/**
 * Marathon keep-list
 * Builds the single /compact line naming what must survive a compaction.
 */

const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Build one line starting with "/compact " (no newlines) listing the kickoff
 * and rules paths, every unfinished stream, open findings, the last commit and
 * running tasks. Finished streams and closed findings are never named.
 */
export function buildKeepList({
  runId,
  kickoffPath,
  rulesPath,
  streams = [],
  findings = [],
  lastCommit,
  runningTasks = []
}) {
  const openStreams = streams
    .filter(s => s.state !== 'done')
    .map(s => {
      const state = oneLine(s.state);
      const next = oneLine(s.next);
      const detail = [state, next ? `next: ${next}` : ''].filter(Boolean).join('; ');
      return detail ? `${oneLine(s.name)}(${detail})` : oneLine(s.name);
    });
  const openFindings = findings.filter(f => f.status === 'open').map(f => oneLine(f.id));
  const tasks = runningTasks.map(oneLine);

  const parts = [
    `Keep: run ${oneLine(runId)}`,
    `kickoff ${oneLine(kickoffPath)}`,
    `rules ${oneLine(rulesPath)}`,
    `streams: ${openStreams.join(', ') || 'none'}`,
    `open findings: ${openFindings.join(', ') || 'none'}`
  ];
  const commit = oneLine(lastCommit);
  if (commit) parts.push(`last commit ${commit}`);
  parts.push(`running tasks: ${tasks.join(', ') || 'none'}`);

  return `/compact ${parts.join('; ')}. Drop tool output, finished streams and file contents.`;
}
