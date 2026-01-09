# /w-debug

Deep Debug → TDD Swarm - Thorough investigation then fix with regression tests.

## Usage
```
/w-debug [issue description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for related debugging sessions
2. Analyze and form hypotheses
3. Investigate with multiple tools
4. Diagnose and confirm root cause
5. Plan fix architecture
6. Write regression tests (must fail)
7. Build fix (tests pass)
8. Run review
9. Compound solution

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER proceed to Build before regression tests exist and FAIL
- NEVER skip compound phase at the end
- NEVER skip the diagnosis phase - root cause MUST be confirmed
- VIOLATION: Starting fix without confirmed diagnosis = restart workflow

---

## Execution Protocol

### Phase 1: Debug Investigation

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of related debugging sessions (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] related sessions. Proceed to Analysis or use existing solution?"
- Options: ["Proceed to Analysis", "Use existing solution", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Analysis
**REQUIRED OUTPUT:**
- Initial findings summary
- Hypotheses list (numbered, prioritized)
- Evidence supporting each hypothesis

**USER GATE:** Use AskUserQuestion
- Question: "Analysis complete. Top hypothesis: [X]. Proceed to Investigation?"
- Options: ["Continue", "Revise hypotheses", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Diagnosis (BLOCKING GATE)
**REQUIRED OUTPUT:**
- Confirmed root cause: _____
- Evidence supporting diagnosis: _____
- Files/lines involved: _____

**BLOCKING RULE:**
NEVER proceed to Plan until:
- [ ] Root cause identified with high confidence
- [ ] Evidence documented
- [ ] User confirms diagnosis

**USER GATE:** Use AskUserQuestion
- Question: "Root cause confirmed: [X]. Proceed to Plan fix?"
- Options: ["Continue", "Investigate more", "Revise diagnosis"]

STOP and wait for user response.

---

### Phase 2: TDD-Swarm Fix

### ⛔ CHECKPOINT 3: Plan
**REQUIRED OUTPUT:**
- Fix architecture summary (3-5 bullets)
- Files to modify (list)
- Approach and rationale

**USER GATE:** Use AskUserQuestion
- Question: "Fix plan ready. Proceed to write regression tests?"
- Options: ["Continue", "Revise plan", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 4: Tests (BLOCKING GATE)
**REQUIRED OUTPUT:**
- Test file paths: _____
- Test count: _____ regression tests written
- Test run result: "All _____ tests FAIL (bug still exists)"

**BLOCKING RULE:**
NEVER proceed to Build until:
- [ ] All regression tests written
- [ ] All tests RUN and FAIL
- [ ] Failure output shows the bug being reproduced

**AUTO-PROCEED:** Continue to Build phase after tests fail.

---

### ⛔ CHECKPOINT 5: Build
**REQUIRED OUTPUT:**
- Implementation file paths: _____
- Test run result: "All _____ tests PASS"
- Bug confirmed fixed: yes/no

**AUTO-PROCEED:** Continue to Review phase.

---

### ⛔ CHECKPOINT 6: Review
**REQUIRED OUTPUT:**
| Category | Finding | Severity |
|----------|---------|----------|
| Security | _____ | _____ |
| Performance | _____ | _____ |
| Regressions | _____ | _____ |

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 7: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/debugging/_____
- Doc path: docs/solutions/debugging/_____.md
- Root cause documented: yes/no
- Fix pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 9 phases
- [ ] Checkpoints 0-3 completed with user confirmation
- [ ] Checkpoints 4-7 completed (auto-proceed)
- [ ] Root cause confirmed before fix
- [ ] Regression tests written and initially failed
- [ ] All tests now pass
- [ ] No regressions introduced
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/debugging/[issue-category]
Doc: docs/solutions/debugging/[issue-name].md
Pattern: root cause + regression tests + fix approach
```

## Example
```
/w-debug intermittent API timeouts in production
```
