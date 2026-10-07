/**
 * Marathon resume line
 * One instruction that gets a fresh session back into the active stream.
 */

const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const cell = (v) => oneLine(v).replace(/\|/g, '\\|');

/**
 * Build the resume instruction for a run. With an active stream it first
 * loads the protocol (/w-marathon --resume), names the run files and the
 * stream, and with plain: true is a single sentence (no newline, no table)
 * suitable for `claude -p "$(...)"`; otherwise a markdown table row for the
 * stream follows on the next line. With no active stream but a queued one
 * (nextQueued: { name, next }), it tells the session to activate that stream
 * through the CLI and take its first step. With neither (nothing queued, or
 * allDone: true) it says every stream is done and points at the gate.
 */
export function resumeLine({ runId, runDirRel, activeStream, nextQueued = null, blocked = [], allDone = false, isolation = 'worktree', plain = false }) {
  if (!activeStream) {
    if (nextQueued && !allDone) {
      const queued = oneLine(nextQueued.name);
      const first = oneLine(nextQueued.next) || 'see its plan';
      // Habit 7: a stream gets its worktree before it goes active, or its diff is the main checkout.
      const activate = isolation === 'worktree'
        ? `create its worktree (\`git worktree add ../<repo>-${queued} -b marathon/${runId}/${queued}\`) and activate it with \`cli.js stream ${queued} state=active isolation=<path>\``
        : `activate it with \`cli.js stream ${queued} state=active --no-isolation\``;
      const line = `Run /w-marathon --resume ${runId}: no stream is active; next is the queued stream "${queued}" — ${activate}, then take its first step (next: ${first}).`;
      return plain ? line.replace(/\|/g, '/') : line;
    }
    if (blocked.length) {
      const list = blocked.map(s => `${oneLine(s.name)} — ${oneLine(s.next) || 'see its row'}`).join('; ');
      return `No active stream in ${runId}; every remaining stream is blocked: ${list}. Unblock one and set it active, then /w-marathon --resume ${runId} (or /w-marathon --status to inspect).`;
    }
    return `No active stream in ${runId} and nothing queued — all streams are done. Run \`cli.js gate\`; if the build gate is met run \`cli.js finish\`, otherwise reopen the stream that owns the failing line (or /w-marathon --status to inspect).`;
  }

  const name = oneLine(activeStream.name);
  const next = oneLine(activeStream.next) || 'see status.md';
  const skill = oneLine(activeStream.skill);
  const phase = oneLine(activeStream.phase);

  let sentence = `Run /w-marathon --resume ${runId} to load the protocol, then read ${runDirRel}/kickoff.md, ${runDirRel}/status.md, ${runDirRel}/rules.md and the memory index (docs/solutions/), and continue stream "${name}" (next: ${next}).`;
  if (skill && phase) {
    sentence += ` It was mid-run in /${skill} at phase ${phase}: reload that skill and continue from that phase.`;
  } else if (skill) {
    sentence += ` It was mid-run in /${skill}: reload that skill and continue.`;
  } else if (phase) {
    sentence += ` It was at phase ${phase}: continue from that phase.`;
  }

  if (plain) return sentence.replace(/\|/g, '/');

  const row = `| ${cell(name)} | ${cell(activeStream.state)} | ${cell(phase)} | ${cell(next)} |`;
  return `${sentence}\n${row}`;
}
