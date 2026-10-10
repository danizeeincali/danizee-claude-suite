# /w-ralph-batch

Generate overnight bash scripts that run Pure Ralph loops on multiple projects or candidates.

## What This Does

Uses the **Pure Ralph bash loop approach** for batch processing:
- Each candidate/project gets its own Ralph loop
- Scripts use `.claude/ralph/loop.sh` for execution
- Fresh context for every iteration
- State persisted through IMPLEMENTATION_PLAN.md files

## Usage
```
/w-ralph-batch                    # Interactive mode
/w-ralph-batch --script           # Generate overnight-ralph.sh
/w-ralph-batch --multi-project    # Multiple project directories
/w-ralph-batch --diagnostics      # Run diagnostics from ralph-candidates.md
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Scan for candidates/projects
2. Configure batch parameters
3. Generate overnight script
4. Output execution instructions

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Batch Modes

| Mode | Description | Output |
|------|-------------|--------|
| Script | Generate overnight bash script | overnight-ralph.sh |
| Multi-project | Batch multiple project dirs | overnight-multi.sh |
| Diagnostics | Process ralph-candidates.md | overnight-diagnostics.sh |
| Interactive | Select and configure interactively | User choice |

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Scan Candidates
**Check for Ralph candidates and projects:**

```bash
# Check for candidates file
cat .claude/ralph-candidates.md

# Check for Ralph setup in current project
ls -la .claude/ralph/

# Check for multi-project config
ls ../*/.claude/ralph/ 2>/dev/null
```

**REQUIRED OUTPUT:**
- Candidates file exists: yes/no
- Ready candidates: N (RC-### IDs)
- Ready diagnostics: N (RC-D### IDs)
- Ralph setup in current project: yes/no
- Other projects with Ralph: [list paths]

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] candidates, [M] diagnostics, [P] projects. Select mode:"
- Options: ["Generate overnight script", "Multi-project batch", "Diagnostics only", "Interactive"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Configure Batch

**For Overnight Script:**
```
Max iterations per candidate: 50 (default)
Stop on first failure: no (default)
Log to file: yes (default)
Notification on complete: no (default)
```

**For Multi-Project:**
```
Projects to include: [list]
Order: sequential/parallel
Shared log file: yes/no
```

**For Diagnostics:**
```
Run fixes on failure: yes (default)
Re-verify after fix: yes (default)
```

**USER GATE:** Use AskUserQuestion
- Question: "Configuration ready. Generate script?"
- Options: ["Generate", "Adjust settings", "Add more projects"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Generate Script

**Generate overnight-ralph.sh:**
```bash
#!/bin/bash
# Pure Ralph Batch - Generated [DATE]
#
# This script runs Pure Ralph loops on multiple candidates/projects.
# Each loop gets FRESH CONTEXT - no accumulation.

set -e
LOG_FILE="ralph-batch-$(date +%Y%m%d-%H%M%S).log"
KIT=.claude/helpers/kit/cli.js
SECRETS=.claude/kit/secrets
GC=$(git rev-parse --git-common-dir 2>/dev/null || true)
MAIN_SECRETS=""
[ -z "$GC" ] || MAIN_SECRETS="$GC/../.claude/kit/secrets"

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

log "╔════════════════════════════════════════════════╗"
log "║  Pure Ralph Batch Starting                      ║"
log "║  Candidates: [N]                                ║"
log "║  Log: $LOG_FILE                                 ║"
log "╚════════════════════════════════════════════════╝"

#───────────────────────────────────────────────────────
# Candidate: RC-001 - [Name]
#───────────────────────────────────────────────────────
log ""
log "Processing RC-001: [Name]..."

# Create/update IMPLEMENTATION_PLAN.md for this candidate
cat > .claude/ralph/IMPLEMENTATION_PLAN.md << 'PLAN_EOF'
# Implementation Plan: RC-001

## Status
- Total tasks: N
- Completed: 0
- Remaining: N

## Tasks
- [ ] Task 1
- [ ] Task 2
...

## Discoveries
PLAN_EOF

# Run the Pure Ralph loop
./.claude/ralph/loop.sh build 50

log "RC-001 complete: $(date)"

#───────────────────────────────────────────────────────
# Candidate: RC-002 - [Name]
#───────────────────────────────────────────────────────
log ""
log "Processing RC-002: [Name]..."

# [Similar pattern for each candidate]

log ""
log "╔════════════════════════════════════════════════╗"
log "║  Pure Ralph Batch Complete!                     ║"
log "║  End time: $(date)                              ║"
log "║  Log: $LOG_FILE                                 ║"
log "╚════════════════════════════════════════════════╝"
```

**Log redaction (inside the generated script):** the `log()` function above pipes each line through `node .claude/helpers/kit/cli.js redact --keep-lines` (stdin to JSON `{ text, replaced }`; the `text` is what is logged) only when, at run time, `.claude/helpers/kit/cli.js` exists and so does a secrets file (`.claude/kit/secrets` in the worktree top, or in the main checkout: `-e` or `-L`, so a dangling symlink or a directory there still goes to `redact` and fails loudly). Otherwise it is the plain `printf | tee -a "$LOG_FILE"`: with no kit the script behaves as it did before, and the test is the script's own `[ -f ... ]`, not a decision made when it was generated. `redact` exit 0 is the redacted line. Exit 1 is bad input or an unreadable secrets file, never "nothing to redact": the line is still written to the log, with the marker `[redact failed exit 1]` after it, and the script continues (a failed redact never drops a line and never stops an overnight run). Any other non-zero exit (for example 127, or a signal) is a failure of that step and gets the same marker with its exit status. A log line that carries the marker was not redacted: review the log before sharing it.

**For Multi-Project Script:**
```bash
#!/bin/bash
# Pure Ralph Multi-Project Batch

PROJECTS=(
  "/path/to/project1"
  "/path/to/project2"
)

for project in "${PROJECTS[@]}"; do
  echo "═══ Processing: $project ═══"
  cd "$project"

  if [[ -f ".claude/ralph/loop.sh" ]]; then
    ./.claude/ralph/loop.sh build 50
  else
    echo "Warning: No Ralph setup in $project"
  fi
done
```

**For Diagnostics Script:**
```bash
#!/bin/bash
# Pure Ralph Diagnostics

run_diagnostic() {
  local id="$1"
  local cmd="$2"
  local fix_id="$3"

  echo "DIAGNOSTIC: $id"
  if eval "$cmd"; then
    echo "STATUS: PASS"
    echo "ACTION: VERIFIED"
  else
    echo "STATUS: FAIL"
    if [[ -n "$fix_id" ]]; then
      echo "Running fix: $fix_id"
      # Run fix via Ralph loop
      ./.claude/ralph/loop.sh build 10
      # Re-verify
      if eval "$cmd"; then
        echo "ACTION: RESTORED"
      else
        echo "ACTION: FAILED"
      fi
    fi
  fi
}

# RC-D001: [Name] Exists
run_diagnostic "RC-D001" "grep -q 'pattern' file.ts" "RC-F001"
```

**Make executable:**
```bash
chmod +x overnight-ralph.sh
```

**REQUIRED OUTPUT:**
- Script path: ./overnight-ralph.sh
- Candidates included: [list]
- Executable: yes

---

### ⛔ CHECKPOINT 3: Output Instructions

**REQUIRED OUTPUT:**
```
╔════════════════════════════════════════════════════════════╗
║  Overnight Script Generated!                                ║
╠════════════════════════════════════════════════════════════╣
║  Script: ./overnight-ralph.sh                               ║
║  Candidates: [N]                                            ║
║  Max iterations per candidate: 50                           ║
╠════════════════════════════════════════════════════════════╣
║  To run overnight:                                          ║
║                                                             ║
║    nohup ./overnight-ralph.sh > overnight.log 2>&1 &        ║
║                                                             ║
║  Or with screen:                                            ║
║    screen -S ralph ./overnight-ralph.sh                     ║
║                                                             ║
║  Check progress:                                            ║
║    tail -f ralph-batch-*.log                                ║
╚════════════════════════════════════════════════════════════╝
```

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Candidates/projects scanned
- [ ] Batch parameters configured
- [ ] overnight-ralph.sh generated
- [ ] Script made executable
- [ ] Run instructions provided

⚠️ Workflow INCOMPLETE until all boxes checked

## Best Practices

**For Overnight Runs:**
1. Generate script: `/w-ralph-batch --script`
2. Review the generated script
3. Run with nohup or screen:
   ```bash
   nohup ./overnight-ralph.sh > overnight.log 2>&1 &
   ```
4. Check logs in morning: `tail -f ralph-batch-*.log`

**Key Principle:** The script runs `loop.sh` which gives each iteration fresh context. Bad work gets rejected by tests. Good work accumulates in git.

## Example
```
/w-ralph-batch --script
# Generates overnight-ralph.sh for all ready candidates

./overnight-ralph.sh
# Runs all Ralph loops sequentially
# Each iteration: fresh context, one task, commit, exit
```
