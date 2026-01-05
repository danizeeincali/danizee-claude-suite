# /w-fix

Quick Fix - Fast investigation → targeted fix → verification.

## Usage
```
/w-fix [bug description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for similar bugs fixed before
2. Investigate root cause
3. Apply minimal targeted fix
4. Verify with tests
5. Compound bug pattern

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip compound phase at the end
- VIOLATION: Starting fix without search = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of similar bugs (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] similar bugs. Proceed to Investigation or use existing fix?"
- Options: ["Proceed to Investigation", "Use existing fix", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Investigation
**REQUIRED OUTPUT:**
- Root cause identified: _____
- Files/lines involved: _____
- Evidence: _____

**USER GATE:** Use AskUserQuestion
- Question: "Root cause: [X]. Proceed to apply fix?"
- Options: ["Continue", "Investigate more", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Fix Applied
**REQUIRED OUTPUT:**
- Files modified: _____
- Changes summary: _____
- Test results: _____

**USER GATE:** Use AskUserQuestion
- Question: "Fix applied. Tests pass. Proceed to Compound?"
- Options: ["Continue", "Revise fix", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/bugs/_____
- Doc path: docs/solutions/bugs/_____.md
- Pattern stored: yes/no

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] All 4 checkpoints completed with user confirmation
- [ ] Root cause identified
- [ ] Fix applied and tests pass
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/bugs/[bug-category]
Doc: docs/solutions/bugs/[bug-name].md
```

## Example
```
/w-fix users getting logged out after password reset
```
