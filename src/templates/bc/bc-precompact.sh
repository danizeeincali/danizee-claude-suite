#!/usr/bin/env bash
# /bc PreCompact hook (matcher: manual and auto)
# Claude Code pipes the hook event JSON on stdin ({session_id, transcript_path, trigger, ...}).
# Stamps the status file named in .claude/bc.json with time, branch, commit, uncommitted files and
# running tasks, and records the compaction in the results file, so automatic compaction loses
# nothing that /bc would have kept. While a marathon run is active the run's own hook does this.
# Installed per project (.claude/hooks/) or once per user (~/.claude/hooks/); when both exist the
# project copy runs and the user copy steps aside. This hook never blocks a compaction: it always exits 0.

PROJECT="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$PROJECT" 2>/dev/null || exit 0
SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)"
OWN_DIR="$(cd .claude/hooks 2>/dev/null && pwd -P)"
if [ -n "$OWN_DIR" ] && [ "$SELF_DIR" != "$OWN_DIR" ] && [ -f .claude/hooks/bc-precompact.sh ]; then
  exit 0
fi

CLI=".claude/helpers/bc/cli.js"
[ -f "$CLI" ] || CLI="$HOME/.claude/helpers/bc/cli.js"

if [ -f "$CLI" ] && command -v node >/dev/null 2>&1; then
  node "$CLI" handoff --from-hook >/dev/null 2>&1
fi

exit 0
