# /w-end

Gracefully end a session by compounding knowledge and committing work.

## Usage
```
/w-end
/w-end [category]
```

Categories: feature, bug, security, performance, architecture, debug

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete all steps. NEVER skip compound or commit.

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Summary
**REQUIRED OUTPUT:**
- Work accomplished: _____
- Files modified: _____
- Tests added/changed: _____
- Key decisions: _____

**USER GATE:** Use AskUserQuestion
- Question: "Session summary ready. Proceed to Compound?"
- Options: ["Continue", "Add more details"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/[category]/_____
- Doc path: docs/solutions/[category]/_____.md
- Patterns captured: _____

**USER GATE:** Use AskUserQuestion
- Question: "Knowledge compounded. Proceed to Commit?"
- Options: ["Continue", "Revise compound"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Commit (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Commit message: _____
- Files staged: _____
- Commit hash: _____

**USER GATE:** Use AskUserQuestion
- Question: "Commit complete. Session ended. Run /w-start to resume later."
- Options: ["Done", "Push to remote"]

STOP and wait for user response.

---

## What Gets Captured
- Problems solved and approaches used
- Key decisions made
- Patterns discovered
- Files modified
- Tests added/changed

## Completion Checklist

- [ ] Session summary created
- [ ] Compound phase completed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Changes committed

⚠️ Session NOT properly ended until all steps complete

## Example
```
/w-end
/w-end feature
/w-end bug
```

## Next Session
Run \`/w-start\` to load this session's context and continue where you left off.
