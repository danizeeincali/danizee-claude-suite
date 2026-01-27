#!/bin/bash
# Pure Ralph Loop - Fresh context each iteration
#
# Usage:
#   ./loop.sh                    # Build mode (default)
#   ./loop.sh plan               # Planning mode
#   ./loop.sh build 50           # Build mode, max 50 iterations
#   ./loop.sh build 999 --verbose # Verbose output
#
# Key Principle: Each iteration starts FRESH. State passes through files only.

set -e

MODE="${1:-build}"
MAX_ITERATIONS="${2:-999}"
VERBOSE="${3:-}"

RALPH_DIR="$(dirname "$0")"
PROMPT_FILE="${RALPH_DIR}/PROMPT_${MODE}.md"
AGENTS_FILE="${RALPH_DIR}/AGENTS.md"
PLAN_FILE="${RALPH_DIR}/IMPLEMENTATION_PLAN.md"
SPECS_DIR="${RALPH_DIR}/../specs"
LOG_FILE="${RALPH_DIR}/ralph-$(date +%Y%m%d-%H%M%S).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
  echo -e "$1" | tee -a "$LOG_FILE"
}

# Validate required files
if [[ ! -f "$PROMPT_FILE" ]]; then
  log "${RED}Error: Prompt file not found: $PROMPT_FILE${NC}"
  log "Available modes: plan, build"
  exit 1
fi

if [[ ! -f "$PLAN_FILE" ]]; then
  log "${YELLOW}Warning: No IMPLEMENTATION_PLAN.md found. Creating empty one.${NC}"
  cat > "$PLAN_FILE" << 'EOF'
# Implementation Plan

## Status
- Total tasks: 0
- Completed: 0
- In Progress: 0
- Remaining: 0

## Tasks

<!-- Add tasks in priority order -->
<!-- Format: - [ ] Task description -->
<!-- Mark complete: - [x] Task description -->

## Discoveries

<!-- Add learnings, blockers, notes here -->
EOF
fi

log "${BLUE}╔════════════════════════════════════════════════╗${NC}"
log "${BLUE}║          Pure Ralph Loop Starting              ║${NC}"
log "${BLUE}╠════════════════════════════════════════════════╣${NC}"
log "${BLUE}║ Mode:          ${GREEN}${MODE}${BLUE}                              ║${NC}"
log "${BLUE}║ Max Iterations: ${GREEN}${MAX_ITERATIONS}${BLUE}                            ║${NC}"
log "${BLUE}║ Prompt:        ${GREEN}PROMPT_${MODE}.md${BLUE}                    ║${NC}"
log "${BLUE}║ Log:           ${GREEN}${LOG_FILE}${BLUE}${NC}"
log "${BLUE}╚════════════════════════════════════════════════╝${NC}"
log ""

count=0
while [ $count -lt $MAX_ITERATIONS ]; do
  ((count++))

  log "${YELLOW}═══════════════════════════════════════════════════${NC}"
  log "${YELLOW}   Ralph Iteration $count of $MAX_ITERATIONS${NC}"
  log "${YELLOW}   $(date '+%Y-%m-%d %H:%M:%S')${NC}"
  log "${YELLOW}═══════════════════════════════════════════════════${NC}"

  # Build the combined prompt from files - FRESH CONTEXT EACH TIME
  COMBINED_PROMPT=""

  # Add main prompt
  COMBINED_PROMPT+="$(cat "$PROMPT_FILE")"
  COMBINED_PROMPT+=$'\n\n'

  # Add AGENTS.md if exists
  if [[ -f "$AGENTS_FILE" ]]; then
    COMBINED_PROMPT+="---"$'\n'
    COMBINED_PROMPT+="$(cat "$AGENTS_FILE")"
    COMBINED_PROMPT+=$'\n\n'
  fi

  # Add IMPLEMENTATION_PLAN.md (the shared state!)
  COMBINED_PROMPT+="---"$'\n'
  COMBINED_PROMPT+="$(cat "$PLAN_FILE")"
  COMBINED_PROMPT+=$'\n\n'

  # Add any spec files
  if [[ -d "$SPECS_DIR" ]]; then
    for spec in "$SPECS_DIR"/*.md; do
      if [[ -f "$spec" ]]; then
        COMBINED_PROMPT+="---"$'\n'
        COMBINED_PROMPT+="# Spec: $(basename "$spec")"$'\n'
        COMBINED_PROMPT+="$(cat "$spec")"
        COMBINED_PROMPT+=$'\n\n'
      fi
    done
  fi

  # Execute with fresh context
  if [[ "$VERBOSE" == "--verbose" ]]; then
    echo "$COMBINED_PROMPT" | claude -p --dangerously-skip-permissions --verbose 2>&1 | tee -a "$LOG_FILE"
  else
    echo "$COMBINED_PROMPT" | claude -p --dangerously-skip-permissions 2>&1 | tee -a "$LOG_FILE"
  fi

  log ""
  log "${GREEN}Iteration $count complete.${NC}"

  # Check if all tasks are done
  if ! grep -q "^\- \[ \]" "$PLAN_FILE" 2>/dev/null; then
    log ""
    log "${GREEN}╔════════════════════════════════════════════════╗${NC}"
    log "${GREEN}║          Ralph Complete!                        ║${NC}"
    log "${GREEN}║          All tasks marked done.                 ║${NC}"
    log "${GREEN}║          Iterations: $count                          ║${NC}"
    log "${GREEN}╚════════════════════════════════════════════════╝${NC}"
    break
  fi

  # Brief pause to allow git commits to settle
  sleep 1
done

if [ $count -ge $MAX_ITERATIONS ]; then
  log ""
  log "${YELLOW}╔════════════════════════════════════════════════╗${NC}"
  log "${YELLOW}║   Max iterations reached ($MAX_ITERATIONS)              ║${NC}"
  log "${YELLOW}║   Some tasks may still be incomplete.          ║${NC}"
  log "${YELLOW}╚════════════════════════════════════════════════╝${NC}"
fi

log ""
log "Log saved to: $LOG_FILE"
