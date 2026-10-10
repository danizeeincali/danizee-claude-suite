#!/usr/bin/env bash
# /bc SessionStart hook (matcher: compact)
# Runs right after a compaction. Whatever it prints is put back into Claude's context, so it prints
# the resume line plus the active stream's status row, and nothing at all in a project that keeps
# no /bc handoff. While a marathon run is active the run's own hook speaks instead.
# Installed per project (.claude/hooks/) or once per user (~/.claude/hooks/); when both exist the
# project copy runs and the user copy steps aside.

PROJECT="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$PROJECT" 2>/dev/null || exit 0
SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)"
OWN_DIR="$(cd .claude/hooks 2>/dev/null && pwd -P)"
if [ -n "$OWN_DIR" ] && [ "$SELF_DIR" != "$OWN_DIR" ] && [ -f .claude/hooks/bc-session-start.sh ]; then
  exit 0
fi

CLI=".claude/helpers/bc/cli.js"
[ -f "$CLI" ] || CLI="$HOME/.claude/helpers/bc/cli.js"

if [ -f "$CLI" ] && command -v node >/dev/null 2>&1; then
  node "$CLI" resume --if-active 2>/dev/null
fi

exit 0
