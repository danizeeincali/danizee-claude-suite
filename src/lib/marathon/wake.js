/**
 * Marathon wake-ups
 * Cron spec for the in-session wake loop plus OS-level fallback snippets.
 */

/**
 * Schedule and prompt for the recurring wake-up (default :17 and :47). The
 * prompt sends the session through the CLI for every state change, so a
 * wake-up never hand-edits status.md and never stalls between streams.
 */
export function cronSpec({ runId, runDirRel, schedule = '17,47 * * * *' }) {
  return {
    schedule,
    prompt: `Marathon wake-up for run ${runId}: run \`node .claude/helpers/marathon/cli.js status --run ${runId}\` and read ${runDirRel}/status.md. If a stream is active, take its next step. If none is active but a stream is queued, create its worktree (\`git worktree add ../<repo>-<name> -b marathon/${runId}/<name>\`), activate it with \`cli.js stream <name> state=active isolation=<path>\` and take its first step. Record every step with cli.js — never edit status.md by hand. If no stream is left, run \`cli.js gate\`: exit 0 → \`cli.js finish\`; exit 1 → reopen the stream that owns the failing line and continue. If the run is PAUSED or FINISHED, stop.`
  };
}

// Quote for a POSIX shell only when the value needs it.
function shq(value) {
  const s = String(value);
  return /^[A-Za-z0-9_\/.:@+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// cron and launchd start with a bare PATH that lacks node and claude.
const WAKE_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';

// Default idle guard: longer than the 30-minute cron period, so a live session
// that last wrote status.md one period ago is never mistaken for a dead one.
const IDLE_MINUTES = 45;

/**
 * Crontab entry and launchd plist that run `claude -p` every 30 minutes with
 * the resume line, for when the session itself is gone. Both set PATH, run node
 * by its absolute path, and only start claude when `resume --if-active
 * --idle-minutes <idleMinutes>` prints something (a run is active and nothing
 * has written status.md for that long), so a finished or stopped run, or one a
 * live session is still driving, costs nothing. When the claude binary cannot
 * be found, a line saying so goes to wake.log instead of a silent exit.
 */
export function fallbackSnippets({
  projectDir, runId, cliRel, runsRel = '.claude/marathon',
  nodePath = process.execPath, claudePath = null, idleMinutes = IDLE_MINUTES, permissionMode = 'acceptEdits'
}) {
  const idle = Number.isFinite(Number(idleMinutes)) && Number(idleMinutes) >= 0 ? Number(idleMinutes) : IDLE_MINUTES;
  const resume = (flags) => `${shq(nodePath)} ${shq(cliRel)} resume --plain ${flags}--run ${shq(runId)}`;
  const logDir = shq(`${projectDir}/${runsRel}/${runId}`);
  const log = shq(`${projectDir}/${runsRel}/${runId}/wake.log`);
  const note = 'runs: claude -p "<resume line>" every 30 minutes while the run is active and idle';
  const command = [
    `cd ${shq(projectDir)} && mkdir -p ${logDir} && ${resume(`--if-active --idle-minutes ${idle} `)} | grep -q . || exit 0`,
    `CLAUDE_BIN=${shq(claudePath ?? 'claude')}`,
    `command -v "$CLAUDE_BIN" >/dev/null 2>&1 || { echo "$(date -u +%FT%TZ) claude not found at $CLAUDE_BIN" >> ${log}; exit 0; }`,
    `"$CLAUDE_BIN" -p "$(${resume('')})" --permission-mode ${shq(permissionMode)} >> ${log} 2>&1`
  ].join('; ');

  // In a crontab a bare % ends the command, so it must be escaped.
  const crontab = `PATH=${WAKE_PATH}
# ${note}
*/30 * * * * ${command.replace(/%/g, '\\%')}`;

  const launchd = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${xmlEscape(note)} -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.danizee.marathon.${xmlEscape(runId)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(WAKE_PATH)}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
  </array>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(projectDir)}</string>
</dict>
</plist>
`;

  return { crontab, launchd };
}
