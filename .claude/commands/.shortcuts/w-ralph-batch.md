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

## Model Policy (fable/sonnet)

Route EVERY subagent this workflow spawns by work type — never let a spawn silently inherit the session model:

- **Thinking** (planning, architecture, root-cause analysis, adversarial review/verification, final judgment): `model: fable` (claude-fable-5).
- **Execution** (everything else — scoped builds, discovery sweeps, doc/compound writing, mechanical work): `model: sonnet` (Sonnet 5).
- **Opus fallback:** if fable is unavailable (access removed, usage exhausted, or the model errors), fall back to `model: opus` (claude-opus-4-8) for that step.
- **Escalation on detectable failure:** sonnet → fable (substitute opus when fable is unavailable). Never retry the same tier twice.

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

log() {
  echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"
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
