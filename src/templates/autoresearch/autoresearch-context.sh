#!/usr/bin/env bash
# Autoresearch context injection hook
# Runs on UserPromptSubmit — injects autoresearch context when active

if [ -f autoresearch.md ] && [ ! -f .autoresearch-off ]; then
  echo ""
  echo "[autoresearch mode active] Read autoresearch.md for your objective and rules. Use autoresearch.jsonl for state. NEVER STOP until interrupted. Run experiments, log results, keep winners, discard losers, loop forever. If autoresearch.ideas.md exists, use it for inspiration. The user's message is steering input — complete your current experiment first, then incorporate their feedback into your next iteration."
  echo ""
fi
