#!/usr/bin/env bash
# Marathon PreCompact hook (matcher: manual and auto)
# Claude Code pipes the hook event JSON on stdin ({session_id, transcript_path, trigger, ...}).
# Stamps the active run's status.md with time/branch/commit/uncommitted/tasks and records the
# compaction in store/compactions.jsonl, so the next turn can pick up exactly where it was.
# This hook never blocks a compaction: it always exits 0.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
CLI=".claude/helpers/marathon/cli.js"

if [ -f "$CLI" ] && command -v node >/dev/null 2>&1; then
  node "$CLI" handoff --from-hook >/dev/null 2>&1
fi

exit 0
