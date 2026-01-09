# /w-hotfix

Critical Hotfix - Isolated branch → minimal fix → security-focused review → expedited PR.

## Usage
```
/w-hotfix [issue description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for similar incidents
2. Create isolated hotfix branch
3. Apply minimal targeted fix
4. Run security review
5. Compound incident documentation

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip security review - hotfixes MUST be security-reviewed
- NEVER skip compound phase at the end
- VIOLATION: Applying fix without isolated branch = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of similar incidents (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] similar incidents. Proceed to create hotfix branch?"
- Options: ["Proceed to Isolate", "Review existing incidents", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Branch Created
**REQUIRED OUTPUT:**
- Hotfix branch name: hotfix/_____
- Base branch: _____
- Branch creation confirmed: yes/no

**USER GATE:** Use AskUserQuestion
- Question: "Hotfix branch created: [branch]. Proceed to apply fix?"
- Options: ["Continue", "Revise branch", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Fix Applied
**REQUIRED OUTPUT:**
- Files modified: _____
- Changes summary (minimal): _____
- Test results: _____

**AUTO-PROCEED:** Continue to Security Review phase.

---

### ⛔ CHECKPOINT 3: Security Review (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
| Check | Status | Notes |
|-------|--------|-------|
| Input validation | _____ | _____ |
| Auth/authz | _____ | _____ |
| Data exposure | _____ | _____ |
| Injection risks | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Security review complete. Proceed to Compound?"
- Options: ["Continue", "Address security concerns", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 4: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/incidents/_____
- Doc path: docs/solutions/incidents/_____.md
- Incident documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] Checkpoints 0-1 completed with user confirmation
- [ ] Checkpoint 2 completed (auto-proceed)
- [ ] Checkpoints 3-4 completed with user confirmation
- [ ] Hotfix branch created and isolated
- [ ] Minimal fix applied
- [ ] Security review completed
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Incident doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/incidents/[incident-type]
Doc: docs/solutions/incidents/[incident-name].md
```

## Example
```
/w-hotfix SQL injection vulnerability in search endpoint
```
