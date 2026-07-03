# /w-ralph-this

Convert a task description into a Pure Ralph loop. Creates IMPLEMENTATION_PLAN.md and outputs the command to run.

## What is Pure Ralph?

Pure Ralph uses a bash loop for fresh context each iteration:
- Each iteration reads IMPLEMENTATION_PLAN.md
- Picks ONE task, completes it, marks done
- Commits changes, exits
- Bash loop restarts with fresh context

**Key difference from plugin-style:** Context doesn't accumulate. State passes through files only.

## Usage
```
/w-ralph-this [task description]
/w-ralph-this Build a REST API with CRUD endpoints and tests
/w-ralph-this .claude/plans/feature-spec.md
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
1. Parse task/spec into atomic tasks
2. Create/update IMPLEMENTATION_PLAN.md
3. Customize AGENTS.md if needed
4. Output run command
5. (Optional) Execute loop

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER run the loop internally - output the bash command
- ALWAYS break tasks into atomic, one-iteration steps
- ALWAYS include verification for each task
- NEVER skip IMPLEMENTATION_PLAN.md creation

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Parse Task
**Read input (inline or file) and analyze:**

**REQUIRED OUTPUT:**
- Input type: inline/file
- Task summary: _____
- Complexity estimate: simple/medium/complex
- Estimated tasks: N atomic tasks

**USER GATE:** Use AskUserQuestion
- Question: "Task: [summary]. ~[N] atomic tasks. Proceed to plan?"
- Options: ["Create plan", "Refine scope", "Show task breakdown"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Create Implementation Plan
**Break into atomic tasks (one per iteration):**

**Write to .claude/ralph/IMPLEMENTATION_PLAN.md:**
```markdown
# Implementation Plan

## Status
- Total tasks: N
- Completed: 0
- In Progress: 0
- Remaining: N

## Tasks

### Phase 1: Foundation
- [ ] Task 1 description
  - Verify: [command or check]
- [ ] Task 2 description
  - Verify: [command or check]

### Phase 2: Core Implementation
- [ ] Task 3 description
...

## Discoveries

<!-- Learnings will be captured here during execution -->
```

**REQUIRED OUTPUT:**
- Plan file: .claude/ralph/IMPLEMENTATION_PLAN.md
- Total tasks: N
- Phases: _____

**AUTO-PROCEED:** Continue to AGENTS.md check.

---

### ⛔ CHECKPOINT 2: Verify AGENTS.md
**Check AGENTS.md has correct validation commands:**

**REQUIRED OUTPUT:**
- AGENTS.md exists: yes/no
- Build command: _____
- Test command: _____
- Lint command: _____

**If commands need updating:**
**USER GATE:** Use AskUserQuestion
- Question: "Update AGENTS.md validation commands?"
- Options: ["Auto-detect", "Manual edit", "Keep current"]

STOP and wait for user response if changes needed.

---

### ⛔ CHECKPOINT 3: Output Run Command

**REQUIRED OUTPUT:**
```
╔════════════════════════════════════════════════════╗
║  Pure Ralph Ready!                                 ║
╠════════════════════════════════════════════════════╣
║  Plan: .claude/ralph/IMPLEMENTATION_PLAN.md        ║
║  Tasks: N tasks in M phases                        ║
╠════════════════════════════════════════════════════╣
║  To start the loop:                                ║
║                                                    ║
║    ./.claude/ralph/loop.sh                         ║
║                                                    ║
║  Options:                                          ║
║    ./.claude/ralph/loop.sh build 50   # Max 50    ║
║    ./.claude/ralph/loop.sh plan       # Plan mode ║
╚════════════════════════════════════════════════════╝
```

**USER GATE:** Use AskUserQuestion
- Question: "Plan created. Start loop now or run manually later?"
- Options: ["Run now (will exit session)", "Run manually later", "Show plan"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 4: Execute (if requested)
**If user chose "Run now":**

Inform user:
```
Starting Pure Ralph loop...
This session will end. The bash loop will orchestrate fresh Claude instances.
Run this command in your terminal:

  ./.claude/ralph/loop.sh

Or for verbose output:
  ./.claude/ralph/loop.sh build 999 --verbose
```

**Do NOT attempt to run loop internally.**

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Task parsed and understood
- [ ] IMPLEMENTATION_PLAN.md created with atomic tasks
- [ ] AGENTS.md verified/updated
- [ ] Run command provided to user
- [ ] User informed of execution options

⚠️ Workflow INCOMPLETE until all boxes checked

## Example
```
/w-ralph-this Build authentication with JWT tokens

# Creates plan with tasks like:
# - [ ] Create auth types in src/types/auth.ts
# - [ ] Implement JWT utilities in src/lib/jwt.ts
# - [ ] Add login endpoint
# - [ ] Add refresh endpoint
# - [ ] Add auth middleware
# - [ ] Write tests for auth flow

# Then user runs:
./.claude/ralph/loop.sh
```
