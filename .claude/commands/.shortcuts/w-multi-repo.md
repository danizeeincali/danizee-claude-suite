# /w-multi-repo

Multi-Repository - Coordinates changes across repos with dependency awareness.

## Usage
```
/w-multi-repo [task description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past multi-repo patterns
2. Analyze dependencies between repos
3. Plan change coordination order
4. Execute changes across repos
5. Compound coordination pattern

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip dependency analysis - order matters
- NEVER skip compound phase at the end
- VIOLATION: Executing changes without dependency map = risk

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of past multi-repo patterns (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past coordination patterns. Proceed to Analyze?"
- Options: ["Continue", "Review past patterns first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Repos Analyzed
**REQUIRED OUTPUT:**
- Dependency map:
| Repo | Depends On | Depended By |
|------|------------|-------------|
| _____ | _____ | _____ |

- Change order (critical): _____
- Risk assessment: _____

**USER GATE:** Use AskUserQuestion
- Question: "Dependency map ready. Change order: [X → Y → Z]. Proceed to Plan?"
- Options: ["Continue", "Revise order", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Changes Prepared
**REQUIRED OUTPUT:**
- Per-repo changes:
| Repo | Files | Changes |
|------|-------|---------|
| _____ | _____ | _____ |

- Rollback plan: _____

**USER GATE:** Use AskUserQuestion
- Question: "Changes prepared for [N] repos. Proceed to Execute?"
- Options: ["Continue", "Revise changes", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Sync Complete
**REQUIRED OUTPUT:**
- Repos updated: _____
- Verification status per repo: _____
- Any failures: _____

**USER GATE:** Use AskUserQuestion
- Question: "All [N] repos synced. Proceed to Compound?"
- Options: ["Continue", "Address failures", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 4: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/multi-repo/_____
- Doc path: docs/solutions/multi-repo/_____.md
- Pattern documented: yes/no

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] All 5 checkpoints completed with user confirmation
- [ ] Dependency map created
- [ ] Changes applied in correct order
- [ ] All repos verified
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Coordination doc created: _____

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/multi-repo/[task-name]
Doc: docs/solutions/multi-repo/[task-name].md
```

## Example
```
/w-multi-repo updating shared auth library across all repos
```
