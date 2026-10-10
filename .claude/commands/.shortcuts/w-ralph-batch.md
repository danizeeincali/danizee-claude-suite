# /w-ralph-batch

Batch process multiple Ralph candidates sequentially, or generate an overnight script for unattended execution.
Supports Diagnostic→Fix flow for automated QA verification.

## Usage
```
/w-ralph-batch                    # Interactive mode - process one by one
/w-ralph-batch --script           # Generate overnight batch script
/w-ralph-batch --priority P1      # Only process P1 candidates
/w-ralph-batch --all              # Process all ready candidates sequentially
/w-ralph-batch --phased           # Execute by priority (P1 → P2 → P3)
/w-ralph-batch --diagnostics      # Run all diagnostics first, then fixes if needed
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load candidates from .claude/ralph-candidates.md
2. Filter by status (ready) and priority (if specified)
3. Select execution mode
4. Execute batch or generate script
5. Update candidate statuses
6. Generate summary report

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER execute without reviewing candidate list first
- NEVER skip status updates after completion
- ALWAYS generate summary report at end
- For diagnostics: ALWAYS run RC-D### before paired RC-F###

---

## Execution Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| Interactive | Process one by one with verification | Supervised execution |
| Script | Generate overnight-work.sh | Unattended overnight runs |
| Phased | Execute by priority order | Structured batch processing |
| All | Process all ready candidates | Quick batch run |
| Diagnostics | Run diagnostics first, fixes only if needed | QA verification |

---

## Candidate Types

| ID Format | Type | Purpose |
|-----------|------|---------|
| RC-### | General | Standard Ralph candidates |
| RC-D### | Diagnostic | Verify patterns/code exists |
| RC-F### | Fix | Restore code if diagnostic fails |

**Diagnostic→Fix Flow:**
1. Run RC-D### diagnostic command
2. If STATUS: PASS → log "VERIFIED" → skip paired RC-F###
3. If STATUS: FAIL → run RC-F### fix → re-run RC-D### to verify
4. Report final status

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Load & Filter Candidates
**REQUIRED OUTPUT:**
- Candidates file: .claude/ralph-candidates.md
- Total candidates: _____
- Ready candidates: _____
- Ready diagnostics (RC-D###): _____
- Ready fixes (RC-F###): _____
- Filtered candidates (if priority specified): _____

**General Candidates:**
| ID | Priority | Name | Completion Tests | Status |
|----|----------|------|------------------|--------|
| RC-___ | P_ | _____ | ___ tests | ready |

**Diagnostics & Fixes (if any):**
| Diagnostic | Verifies | Paired Fix | Status |
|------------|----------|------------|--------|
| RC-D___ | _____ | RC-F___ | ready |

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] ready candidates ([X] diagnostics, [Y] fixes, [Z] general). Select execution mode:"
- Options: ["Interactive (one by one)", "Generate script", "Phased (P1→P2→P3)", "Diagnostics first", "All at once"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Mode Configuration

**For Interactive Mode:**
- Processing order: by priority (P1 first) or by ID
- Pause between candidates: yes/no
- Auto-archive on success: yes/no

**For Script Mode:**
- Script path: ./overnight-ralph.sh
- Max iterations per candidate: 50 (default)
- Include status updates: yes/no
- Log output to file: yes/no

**For Phased Mode:**
- Phase 1 (P1 Critical): [list IDs]
- Phase 2 (P2 Important): [list IDs]
- Phase 3 (P3 Nice-to-have): [list IDs]
- Completion promises: <promise>P1_COMPLETE</promise>, etc.

**For Diagnostics Mode:**
- Diagnostic pairs to process: [list RC-D### → RC-F### pairs]
- Run fixes only on failure: yes (default)
- Re-verify after fix: yes (default)
- Processing order: by diagnostic ID

**USER GATE:** Use AskUserQuestion
- Question: "Configuration ready. Proceed with [mode]?"
- Options: ["Start execution", "Adjust config", "Change mode"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Execute/Generate

**Interactive Mode - Per Candidate:**
1. Load candidate spec
2. Verify completion tests
3. Execute Ralph loop (max 50 iterations)
4. Run completion tests
5. Update status (complete/in-progress/blocked)
6. Move to next candidate

**Script Mode - Generate overnight-work.sh:**
```bash
#!/bin/bash
# Ralph Batch - Generated [DATE]
# Candidates: [IDs]
# Total: [N] candidates

set -e  # Exit on error
LOG_FILE="ralph-batch-$(date +%Y%m%d-%H%M%S).log"
KIT=.claude/helpers/kit/cli.js
SECRETS=.claude/kit/secrets
GC=$(git rev-parse --git-common-dir 2>/dev/null || true)
MAIN_SECRETS=""
[ -z "$GC" ] || MAIN_SECRETS="$GC/../.claude/kit/secrets"

# Say once, before the first log line, whether log() redacts on this run.
if [ -f "$KIT" ] && { [ -e "$SECRETS" ] || [ -L "$SECRETS" ] || [ -e "$MAIN_SECRETS" ] || [ -L "$MAIN_SECRETS" ]; }; then
  printf '%s\n' "log redaction: on" | tee -a "$LOG_FILE"
else
  printf '%s\n' "log redaction: off (kit or secrets file not found from $PWD)" | tee -a "$LOG_FILE"
fi

# Every log line goes through the kit's redact (line numbers kept) when the kit and a
# secrets file exist, else it is a plain tee. A failed redact never drops the line.
log() {
  local line="[$(date '+%H:%M:%S')] $1" json text rc
  if [ -f "$KIT" ] && { [ -e "$SECRETS" ] || [ -L "$SECRETS" ] || [ -e "$MAIN_SECRETS" ] || [ -L "$MAIN_SECRETS" ]; }; then
    if json=$(printf '%s\n' "$line" | node "$KIT" redact --keep-lines) && text=$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>{s+=d}).on("end",()=>{process.stdout.write(JSON.parse(s).text)})'); then
      printf '%s\n' "$text" | tee -a "$LOG_FILE"
    else
      rc=$?
      printf '%s [redact failed exit %s]\n' "$line" "$rc" | tee -a "$LOG_FILE"
    fi
  else
    printf '%s\n' "$line" | tee -a "$LOG_FILE"
  fi
}

log "Starting Ralph Batch Processing..."
log "Start time: $(date)"

# RC-001: [Name]
log "Processing RC-001: [Name]..."
claude -p "/w-ralph-this '[spec]'
Output <promise>RC001_DONE</promise> when all tests pass.
Max iterations: 50" 2>&1 | while IFS= read -r out || [ -n "$out" ]; do log "$out"; done
log "RC-001 complete: $(date)"

# RC-002: [Name]
log "Processing RC-002: [Name]..."
claude -p "/w-ralph-this '[spec]'
Output <promise>RC002_DONE</promise> when all tests pass.
Max iterations: 50" 2>&1 | while IFS= read -r out || [ -n "$out" ]; do log "$out"; done
log "RC-002 complete: $(date)"

log "Ralph Batch Complete: $(date)"
echo "Results logged to: $LOG_FILE"
```

**Log redaction (inside the generated script):** the `log()` function above pipes each line (the script's own lines and, one by one, every line `claude -p` prints) through `node .claude/helpers/kit/cli.js redact --keep-lines` (stdin to JSON `{ text, replaced }`; the `text` is what is logged) only when, at run time, `.claude/helpers/kit/cli.js` exists and so does a secrets file (`.claude/kit/secrets` in the worktree top, or in the main checkout: `-e` or `-L`, so a dangling symlink or a directory there still goes to `redact` and fails loudly). Otherwise it is the plain `printf | tee -a "$LOG_FILE"`: with no kit the script behaves as it did before, and the test is the script's own `[ -f ... ]`, not a decision made when it was generated. `redact` exit 0 is the redacted line. Exit 1 is bad input or an unreadable secrets file, never "nothing to redact": the line is still written to the log, with the marker `[redact failed exit 1]` after it, and the script continues (a failed redact never drops a line and never stops an overnight run). Any other non-zero exit (for example 127, or a signal) is a failure of that step and gets the same marker with its exit status. A log line that carries the marker was not redacted: review the log before sharing it. Before the first log line the script writes one line saying which case it is in: `log redaction: on`, or `log redaction: off (kit or secrets file not found from $PWD)` with the directory it ran from (`KIT` and `SECRETS` are relative paths, so run the script from the repository top).

**Phased Mode - Sequential Priority Execution:**
```
# Phase 1: P1 Critical
Processing RC-001, RC-005...
Output <promise>P1_COMPLETE</promise>

# Phase 2: P2 Important
Processing RC-002, RC-003...
Output <promise>P2_COMPLETE</promise>

# Phase 3: P3 Nice-to-have
Processing RC-004...
Output <promise>P3_COMPLETE</promise>

Output <promise>ALL_PHASES_COMPLETE</promise>
```

**Diagnostics Mode - Verify & Fix Flow:**
For each RC-D### diagnostic:
```
┌─────────────────────────────────────────────────┐
│ DIAGNOSTIC: RC-D001 - getOrderBookDepth exists  │
├─────────────────────────────────────────────────┤
│ Running: grep -n "export function getOrder..."  │
│                                                 │
│ RESULT: PATTERN_FOUND: YES                      │
│         LOCATION: src/api/depth.ts:42           │
│         STATUS: PASS                            │
│                                                 │
│ → VERIFIED. Skipping RC-F001.                   │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ DIAGNOSTIC: RC-D002 - validateOrderParams       │
├─────────────────────────────────────────────────┤
│ Running: grep -n "export function validate..."  │
│                                                 │
│ RESULT: PATTERN_FOUND: NO                       │
│         LOCATION: NONE                          │
│         STATUS: FAIL                            │
│                                                 │
│ → Running paired fix: RC-F002                   │
│ → Fix applied.                                  │
│ → Re-running diagnostic...                      │
│ → STATUS: PASS                                  │
│ → RESTORED.                                     │
└─────────────────────────────────────────────────┘
```

**Diagnostic Output Format:**
```
DIAGNOSTIC: [NAME]
PATTERN_FOUND: YES|NO
LOCATION: [file:line] or NONE
STATUS: PASS|FAIL
ACTION: VERIFIED|RESTORED|FAILED
```

**AUTO-PROCEED:** Continue until all candidates processed or script generated.

---

### ⛔ CHECKPOINT 3: Summary Report
**REQUIRED OUTPUT:**

**Execution Summary:**
| Metric | Value |
|--------|-------|
| Total candidates | _____ |
| Processed | _____ |
| Successful | _____ |
| Failed/Blocked | _____ |
| Skipped | _____ |

**General Candidate Results:**
| ID | Name | Result | Iterations | Notes |
|----|------|--------|------------|-------|
| RC-___ | _____ | success/failed/blocked | ___ | _____ |

**Diagnostic Results (if applicable):**
| Diagnostic | Verifies | Status | Action | Fix Run |
|------------|----------|--------|--------|---------|
| RC-D___ | _____ | PASS/FAIL | VERIFIED/RESTORED/FAILED | RC-F___/skipped |

**Diagnostic Summary:**
| Metric | Count |
|--------|-------|
| Total diagnostics run | _____ |
| Verified (PASS, no fix needed) | _____ |
| Restored (FAIL → fix → PASS) | _____ |
| Failed (FAIL → fix → still FAIL) | _____ |

**Script Generated (if applicable):**
- Path: ./overnight-ralph.sh
- Chmod: +x applied
- Run command: `./overnight-ralph.sh`

**Status Updates:**
- Candidates marked complete: [IDs]
- Candidates still in-progress: [IDs]
- Candidates blocked: [IDs]
- Diagnostics verified: [RC-D### IDs]
- Diagnostics restored: [RC-D### IDs]
- Archived: [IDs]

**USER GATE:** Use AskUserQuestion
- Question: "Batch complete. [X/Y] successful. [Z] diagnostics verified. Next action?"
- Options: ["Done", "Retry failed", "View details", "Run generated script"]

STOP and wait for user response.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 6 phases
- [ ] Checkpoints 0-1 completed with user confirmation
- [ ] Checkpoint 2 completed (execution/generation)
- [ ] Checkpoint 3 completed with summary
- [ ] All candidate statuses updated in .claude/ralph-candidates.md
- [ ] Successful candidates archived
- [ ] Diagnostics verified/restored (if applicable)
- [ ] Summary report generated

⚠️ Workflow INCOMPLETE until all boxes checked

## Script Output Location
- Default: ./overnight-ralph.sh
- Log file: ./ralph-batch-YYYYMMDD-HHMMSS.log

## Best Practices

**For Overnight Runs:**
1. Generate script with `/w-ralph-batch --script`
2. Review generated script
3. Run `chmod +x overnight-ralph.sh`
4. Execute before bed: `./overnight-ralph.sh`
5. Check logs in morning

**For Phased Execution:**
1. Use `/w-ralph-batch --phased`
2. Monitor P1 completion first
3. Review results between phases
4. Continue or abort as needed

**For Diagnostic Verification:**
1. Use `/w-ralph-batch --diagnostics` after /w-compound
2. Verifies patterns built in previous session still exist
3. Auto-fixes any regressions detected
4. Run nightly to catch accidental deletions

## Example
```
/w-ralph-batch --script
# Generates overnight-ralph.sh with all ready candidates

/w-ralph-batch --priority P1
# Only processes P1 (critical) candidates

/w-ralph-batch --phased
# Executes P1 → P2 → P3 with completion promises

/w-ralph-batch --diagnostics
# Runs all RC-D### diagnostics, fixes only if needed
```
