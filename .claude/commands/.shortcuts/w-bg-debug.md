# /w-bg-debug

Background Debug - Full auto-proceed investigation and fix with no user gates.

**Philosophy:** Investigate, diagnose, fix, test, compound - all autonomous. Only blocking rule: root cause must be confirmed before fix, tests must fail before build.

## Usage
```
/w-bg-debug [issue description]
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
10. Git commit

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- All checkpoints auto-proceed - NO user gates
- NEVER proceed to Build before regression tests exist and FAIL
- NEVER skip compound phase at the end
- NEVER skip git commit phase at the end
- NEVER skip the diagnosis phase - root cause MUST be confirmed
- VIOLATION: Starting fix without confirmed diagnosis = restart workflow

---

## Execution Protocol

### Phase 1: Debug Investigation

### Phase 0: Search
**REQUIRED OUTPUT:**
- List of related debugging sessions (0+ items with memory keys)
- Relevance assessment for each

**AUTO-PROCEED:** Continue to Analysis phase.

---

### Phase 1: Analysis

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to screenshot the current state before changes
2. `agent-browser open <url>` → `agent-browser screenshot`
3. Note current UI state for comparison after build

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Initial findings summary
- Hypotheses list (numbered, prioritized)
- Evidence supporting each hypothesis

**AUTO-PROCEED:** Continue to Diagnosis phase.

---

### Phase 2: Diagnosis (BLOCKING GATE)
**REQUIRED OUTPUT:**
- Confirmed root cause: _____
- Evidence supporting diagnosis: _____
- Files/lines involved: _____

**BLOCKING RULE:**
NEVER proceed to Plan until:
- [ ] Root cause identified with high confidence
- [ ] Evidence documented

**AUTO-PROCEED:** Continue to Plan phase after root cause confirmed.

---

### Phase 2: TDD-Swarm Fix

### Phase 3: Plan
**REQUIRED OUTPUT:**
- Fix architecture summary (3-5 bullets)
- Files to modify (list)
- Approach and rationale

**AUTO-PROCEED:** Continue to Tests phase.

---

### Phase 4: Tests (BLOCKING GATE)
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

### Phase 5: Build

**RuFlo Swarm Execution (optional — for complex fixes):**
If the fix spans multiple files or requires parallel investigation, initialize a ruflo swarm:
```bash
npx ruflo@latest swarm init --topology hierarchical --agents 3
npx ruflo@latest agent spawn --domain core --role coder --task "Implement the fix"
npx ruflo@latest agent spawn --domain support --role tester --task "Verify regression tests pass"
npx ruflo@latest agent spawn --domain security --role security-sentinel --task "Check fix doesn't introduce vulnerabilities"
```
Alternatively, use the Agent tool to spawn parallel agents with `isolation: "worktree"`.
For simple fixes, proceed with serial implementation.

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to verify the implementation visually
2. `agent-browser open <url>` → `agent-browser snapshot -i` → verify elements
3. Compare against pre-change screenshots from Search phase

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Implementation file paths: _____
- Test run result: "All _____ tests PASS"
- Bug confirmed fixed: yes/no

**AUTO-PROCEED:** Continue to Review phase.

---

### Phase 6: Review

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Final visual verification with agent-browser
2. `agent-browser open <url>` → `agent-browser screenshot` → compare before/after
3. Verify responsive layout, dark mode, accessibility

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
| Category | Finding | Severity |
|----------|---------|----------|
| Security | _____ | _____ |
| Performance | _____ | _____ |
| Regressions | _____ | _____ |

**AUTO-PROCEED:** Continue to Verification phase.

---

### ✅ VERIFICATION CHECKPOINT — Cross-Method Validation
**Independent verification of deliverables. Do NOT trust self-reported results.**

**Verification Checks:**
1. **Files Exist** — Verify all claimed implementation file paths actually exist on disk
2. **Tests Re-run** — Independent re-run of ALL tests (not trusting earlier output)
3. **Git Diff Matches Plan** — Compare `git diff --stat` against planned files-to-modify list
4. **Build Compiles** — Run build command if applicable, verify zero errors
5. **No Regressions** — Run full test suite to catch regressions beyond new tests

**REQUIRED OUTPUT:**
- Files verified: _____ / _____ exist
- Tests re-run: _____ pass / _____ total
- Git diff matches plan: yes/no
- Build status: pass/fail/n-a
- Regressions: none / [list]

**RETRY LOGIC (max 3 retries):**
- PASS → proceed to next phase
- FAIL + retries remaining → log failure reason, fix the issue, re-verify
- FAIL + max retries exceeded → log error and mark workflow as FAILED

---

### Phase 7: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/debugging/_____
- Doc path: docs/solutions/debugging/_____.md
- Root cause documented: yes/no
- Fix pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

**AUTO-PROCEED:** Continue to Git Commit phase.

---

### Phase 8: Git Commit (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Commit hash: _____
- Files committed: _____
- Branch: _____

Commit all changes with a descriptive message including:
- Bug fix description and root cause
- Workflow: /w-bg-debug
- Files changed count and tests added count
- Co-author attribution

NEVER skip this phase. Workflow is INCOMPLETE without commit.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 10 phases
- [ ] All phases completed (auto-proceed, no user gates)
- [ ] Root cause confirmed before fix
- [ ] Regression tests written and initially failed
- [ ] All tests now pass
- [ ] No regressions introduced
- [ ] Compound phase executed
- [ ] Git commit executed
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
/w-bg-debug intermittent API timeouts in production
```
