# /w-tdd-swarm

Full TDD Swarm - Combines planning + test-first + parallel build + comprehensive review.

**Philosophy:** Plan like Full Cycle, test like TDD, build like Swarm.

## Usage
```
/w-tdd-swarm [feature description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past solutions
2. Plan architecture
3. Write spec/acceptance criteria
4. Write ALL tests (must fail)
5. Build implementation (tests pass)
6. Run full review
7. Compound solution

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER proceed to Build before all tests exist and FAIL
- NEVER skip compound phase at the end
- VIOLATION: Starting implementation without search = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of past solutions (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past solutions. Proceed to Plan or use existing?"
- Options: ["Proceed to Plan", "Use existing solution", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Plan
**REQUIRED OUTPUT:**
- Architecture summary (3-5 bullets)
- Files to create/modify (list)
- Approach and rationale

**USER GATE:** Use AskUserQuestion
- Question: "Plan complete. Proceed to Spec?"
- Options: ["Continue", "Revise plan", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Spec
**REQUIRED OUTPUT:**
- Acceptance criteria (numbered list)
- Test cases (numbered list)

**USER GATE:** Use AskUserQuestion
- Question: "Spec ready. Proceed to Tests?"
- Options: ["Continue", "Revise spec"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Tests (BLOCKING GATE)
**REQUIRED OUTPUT:**
- Test file paths: _____
- Test count: _____ tests written
- Test run result: "All _____ tests FAIL as expected"

**BLOCKING RULE:**
NEVER proceed to Build until:
- [ ] All tests written
- [ ] All tests RUN and FAIL
- [ ] Failure output captured

**USER GATE:** Use AskUserQuestion
- Question: "All [N] tests written and failing. Proceed to Build?"
- Options: ["Continue", "Add more tests", "Revise tests"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 4: Build
**REQUIRED OUTPUT:**
- Implementation file paths: _____
- Test run result: "All _____ tests PASS"

**USER GATE:** Use AskUserQuestion
- Question: "Implementation complete. All tests pass. Proceed to Review?"
- Options: ["Continue", "Revise implementation"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 5: Review
**REQUIRED OUTPUT:**
| Category | Finding | Severity |
|----------|---------|----------|
| Security | _____ | _____ |
| Performance | _____ | _____ |
| Architecture | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Review complete. Proceed to Compound?"
- Options: ["Continue", "Address findings first"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 6: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/full-tdd-swarm/_____
- Doc path: docs/solutions/full-tdd-swarm/_____.md
- Pattern stored: yes/no

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 7 phases
- [ ] All 7 checkpoints completed with user confirmation
- [ ] All required outputs generated
- [ ] All tests pass
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/full-tdd-swarm/[feature-name]
Doc: docs/solutions/full-tdd-swarm/[feature-name].md
```

## Example
```
/w-tdd-swarm user authentication with JWT tokens
```
