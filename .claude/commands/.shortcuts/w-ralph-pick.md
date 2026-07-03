# /w-ralph-pick

Select and execute a Ralph candidate from .claude/ralph-candidates.md.

## Usage
```
/w-ralph-pick
/w-ralph-pick RC-001
/w-ralph-pick --priority P1
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
1. Load candidates from .claude/ralph-candidates.md
2. Select candidate (user choice or by ID/priority)
3. Verify completion tests are valid
4. Execute Ralph loop
5. Verify completion
6. Update candidate status

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER execute without valid completion tests
- NEVER mark complete without passing all completion tests
- ALWAYS update candidate status in .claude/ralph-candidates.md

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Load Candidates
**REQUIRED OUTPUT:**
- Candidates file: .claude/ralph-candidates.md
- Total candidates: _____
- Ready candidates: _____
- By priority:
  | Priority | Count | IDs |
  |----------|-------|-----|
  | P1 | _____ | _____ |
  | P2 | _____ | _____ |
  | P3 | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] ready candidates. Which to execute?"
- Options: [List candidate IDs with names, e.g., "RC-001: API endpoint tests"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Candidate Selected
**REQUIRED OUTPUT:**
- Selected ID: RC-___
- Name: _____
- Priority: P_
- Source workflow: _____
- Pattern description: _____

**Completion Tests:**
| # | Type | Test | Current Status |
|---|------|------|----------------|
| 1 | _____ | _____ | pending |
| 2 | _____ | _____ | pending |

**USER GATE:** Use AskUserQuestion
- Question: "RC-[N]: [Name]. [X] completion tests. Verify tests are valid?"
- Options: ["Verify tests", "Edit tests", "Choose different candidate"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Tests Verified
**Run each completion test to establish baseline:**

| # | Test | Initial Result | Expected After |
|---|------|----------------|----------------|
| 1 | _____ | FAIL/PASS | PASS |
| 2 | _____ | FAIL/PASS | PASS |

**BLOCKING RULE:**
For TDD-style candidates, tests SHOULD fail initially.
For existing code candidates, some tests may already pass.

**USER GATE:** Use AskUserQuestion
- Question: "Baseline established. [X/Y] tests currently fail. Start Ralph loop?"
- Options: ["Start loop", "Revise tests", "Cancel"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Ralph Loop Execution
**Update candidate status to: in-progress**

Execute the Ralph loop with the candidate spec:
- Max iterations: 50 (or candidate-specified)
- Completion: All tests pass

**Per-iteration tracking:**
- Iteration #: _____
- Tests passing: X/Y
- Progress: _____

**AUTO-PROCEED:** Continue iterations until all tests pass or max reached.

---

### ⛔ CHECKPOINT 4: Completion Verification
**Run ALL completion tests:**

| # | Test | Result |
|---|------|--------|
| 1 | _____ | PASS/FAIL |
| 2 | _____ | PASS/FAIL |

**REQUIRED OUTPUT:**
- All tests pass: yes/no
- Total iterations: _____
- If failed: which tests still failing

**If ALL tests PASS:**
- Update candidate status to: complete
- Add completion date
- Move to Archived section in .claude/ralph-candidates.md

**If ANY test FAILS:**
- Keep status: in-progress
- Log progress for next attempt

**USER GATE:** Use AskUserQuestion
- Question: "[All pass: Complete! / Some fail: Partial progress]. Update candidate status?"
- Options: ["Mark complete", "Keep in-progress", "Mark as blocked"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 5: Candidate Updated
**REQUIRED OUTPUT:**
- Candidate ID: RC-___
- Final status: complete/in-progress/blocked
- Updated in .claude/ralph-candidates.md: yes/no
- If complete: moved to Archived section: yes/no

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 6 phases
- [ ] Checkpoints 0-2 completed with user confirmation
- [ ] Checkpoints 3-5 completed
- [ ] Candidate selected and verified
- [ ] Ralph loop executed
- [ ] All completion tests evaluated
- [ ] Candidate status updated in .claude/ralph-candidates.md
- [ ] If complete: candidate archived

⚠️ Workflow INCOMPLETE until all boxes checked

## Candidate Statuses
- **draft**: Needs refinement before execution
- **ready**: Can be executed
- **in-progress**: Currently being worked on
- **complete**: All tests pass, archived
- **blocked**: Cannot proceed, needs intervention

## Example
```
/w-ralph-pick
/w-ralph-pick RC-003
/w-ralph-pick --priority P1
```
