# /w-agent-tdd-swarm

Fully Autonomous TDD Swarm — Zero user gates. Designed for terminal agents (tmux + worktree).

**Philosophy:** Same rigor as /w-tdd-swarm, but fully autonomous. No gates, no stops, auto-PR.

## Usage
```
/w-agent-tdd-swarm [feature description]
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
1. Search for past solutions
2. Plan architecture
3. Write spec/acceptance criteria
4. Write ALL tests (must fail)
5. Build implementation (tests pass)
6. Run full review
7. Commit, push, and create PR
8. Compound solution
9. Write completion report and notify parent

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ZERO user gates — this workflow runs fully autonomously
- NEVER proceed to Build before all tests exist and FAIL
- NEVER skip compound phase at the end
- ALWAYS create a PR at the end with `gh pr create --fill`
- ALWAYS commit with descriptive messages

---

## Execution Protocol

### PHASE 0: Context Gathering (AUTO-PROCEED)
**Run /w-start on yourself first** to load project context, memory, follow-ups, and session state.

**AUTO-PROCEED:** Continue to Search.

---

### PHASE 1: Search (AUTO-PROCEED)
Search for past solutions. Check memory keys, search codebase for similar implementations, note reusable patterns.

**AUTO-PROCEED:** Continue to Pi Brain Discovery.

---

### PHASE 1.5: Pi Brain — Knowledge Discovery (AUTO-PROCEED)
**Search the Pi Brain network for existing knowledge matching this feature:**

```bash
# npm client (preferred)
curl -s -H "Authorization: Bearer anonymous" "https://pi.ruv.io/v1/memories/search "[feature description]" --top-k=3

# HTTP fallback
curl -s "https://pi.ruv.io/v1/memories/search?q=[feature description]&top_k=3"
```

**If matching memories found:** Review steps for applicable patterns. Adapt proven approaches. Note memory IDs for voting later.
**If no matches:** Proceed normally.

**AUTO-PROCEED:** Continue to Plan.

---

### PHASE 2: Plan (AUTO-PROCEED)
**REQUIRED OUTPUT:**
- Architecture summary (3-5 bullets)
- Files to create/modify (list)
- Approach and rationale

**AUTO-PROCEED:** Continue to Spec.

---

### PHASE 3: Spec (AUTO-PROCEED)
**REQUIRED OUTPUT:**
- Acceptance criteria (numbered list)
- Test cases (numbered list)

**AUTO-PROCEED:** Continue to Tests.

---

### PHASE 4: Tests (BLOCKING GATE — TDD only)
**REQUIRED OUTPUT:**
- Test file paths: _____
- Test count: _____ tests written
- Test run result: "All _____ tests FAIL as expected"

**BLOCKING RULE:**
NEVER proceed to Build until:
- [ ] All tests written
- [ ] All tests RUN and FAIL
- [ ] Failure output captured

**AUTO-PROCEED:** Continue to Build after tests fail.

---

### PHASE 5: Build (AUTO-PROCEED)
**REQUIRED OUTPUT:**
- Implementation file paths: _____
- Test run result: "All _____ tests PASS"

**AUTO-PROCEED:** Continue to Review.

---

### PHASE 6: Review (AUTO-PROCEED)
Quick self-review. Fix any critical/high findings before proceeding.

| Category | Finding | Severity |
|----------|---------|----------|
| Security | _____ | _____ |
| Performance | _____ | _____ |
| Architecture | _____ | _____ |

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


---

### PHASE 7: Commit & PR (AUTO-PROCEED)
**REQUIRED ACTIONS:**
1. Stage all changes: `git add -A`
2. Commit with descriptive message
3. Push branch: `git push -u origin HEAD`
4. Create PR: `gh pr create --fill`

**REQUIRED OUTPUT:**
- Commit hash: _____
- PR URL: _____

**AUTO-PROCEED:** Continue to Compound.

---

### PHASE 8: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/full-tdd-swarm/_____
- Doc path: docs/solutions/full-tdd-swarm/_____.md
- Pattern stored: yes/no


NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

### PHASE 9: Report & Notify Parent (MANDATORY - NEVER SKIP)
**Write a completion report** to `.claude/agent-reports/{your-agent-id}.md` containing:
- Task summary (what was built)
- Files changed (list with brief descriptions)
- Test results (pass/fail counts)
- PR URL
- Any issues encountered or decisions made

Your agent-id was specified in the initial prompt. If unclear, use the branch name.

**If a parent agent was specified in your initial prompt**, use the `redirect_terminal_agent` MCP tool to send:
```
Agent {id} completed. PR: {url}. Report: .claude/agent-reports/{id}.md
```

**REQUIRED OUTPUT:**
- Report path: .claude/agent-reports/_____.md
- Parent notified: yes/no

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] All 9 phases completed (zero user gates)
- [ ] Tests written and pass
- [ ] PR created with `gh pr create --fill`
- [ ] Compound phase executed
- [ ] Completion report written to .claude/agent-reports/
- [ ] Parent agent notified (if applicable)
