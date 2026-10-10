# /w-ralph-pick

Select and execute a Ralph candidate from .claude/ralph-candidates.md.

## Usage
```
/w-ralph-pick
/w-ralph-pick RC-001
/w-ralph-pick --priority P1
```

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
- Lens findings: _____

**🔎 Code Analysis (lenses over the change under review):** Run this over the range printed by `diff-range` (everything since the merge base with the upstream branch, plus uncommitted edits and untracked files; the whole history when there is no upstream: then `removed_with_live_callers` cannot find removals, so say the removal check did not run). If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before. Each block starts with a guard for that: with no kit it prints "kit not installed" and ends with status 0, without closing your shell.

1. Lenses: which review rules apply to the changed files.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else D=$(mktemp 2>/dev/null) && [ -n "$D" ] || { echo "mktemp failed: no temp file for the range" >&2; D=; RC=1; }
if [ -n "$D" ]; then node .claude/helpers/kit/cli.js diff-range > "$D"; RC=$?
case $RC in 0) node .claude/helpers/kit/cli.js lenses --diff "$D"; RC=$?;; 3) echo "no change to review"; RC=0;; *) echo "diff-range failed (exit $RC): the change range was not read" >&2;; esac; fi; [ -z "$D" ] || rm -f "$D"; (exit $RC); fi
```

How to read the results: each entry in `fired` (lenses) has a `name`, the `files` it matched and a `body` to apply as an extra check on those files: add its findings to the review findings above, and mention a non-empty `capped` list.
Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure and never "no lens applies"; the block sets its own status to 0 in that case. Exit 1 is wrong input or a broken state: report it, never skip the step. Exit 2 is a refusal (the repository, a range over 32 MiB, or the verb itself): report it as printed and stop that step, never retry it. Exit 0 from `diff-range` can still leave files out: it writes a note to stderr for an untracked file over the size cap (`too_large`, named) and for untracked files over the count cap (`max_untracked`, a count only); name each skipped file in the findings, say it was not analysed, and treat every result as a floor. If `diff-range` itself fails the step prints "diff-range failed" and the verb does not run; if the temp file cannot be made it prints "mktemp failed": report that the change was not analysed, never "nothing found". Any other non-zero exit (for example 127, or a signal) is a failure of that step: report it, never read it as nothing found.


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
