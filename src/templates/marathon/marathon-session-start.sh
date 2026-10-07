#!/usr/bin/env bash
# Marathon SessionStart hook (matcher: compact)
# Runs right after a compaction. Whatever it prints is put back into Claude's context,
# so it prints the resume line plus the active stream's status row — and nothing at all
# when no marathon run is active or the active run has no active stream.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
CLI=".claude/helpers/marathon/cli.js"

if [ -f "$CLI" ] && command -v node >/dev/null 2>&1; then
  node "$CLI" resume --if-active 2>/dev/null
fi

exit 0
