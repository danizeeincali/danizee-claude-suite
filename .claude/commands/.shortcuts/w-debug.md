# /w-debug

Deep Debug → TDD Swarm - Thorough investigation then fix with regression tests.

## Usage
```
/w-debug [issue description]
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

### 🧠 CHECKPOINT 0.5: Pi Brain — Knowledge Discovery
**Search the Pi Brain network for existing debug recipes matching this issue:**

```bash
# npm client (preferred)
curl -s -H "Authorization: Bearer anonymous" "https://pi.ruv.io/v1/memories/search "[bug/issue description]" --top-k=3

# HTTP fallback
curl -s "https://pi.ruv.io/v1/memories/search?q=[bug/issue description]&top_k=3"
```

**If matching memories found:** Review steps for applicable fix patterns. Adapt proven approaches. Note memory IDs for voting later.
**If no matches:** Proceed normally.

**REQUIRED OUTPUT:**
- Pi Brain memories found: _____ (0+ results)
- Applicable patterns: _____

---

### ⛔ CHECKPOINT 1: Analysis

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

**RuFlo Swarm Execution (optional — for complex fixes):**
If the fix spans multiple files or requires parallel investigation, initialize a ruflo swarm:
```bash
npx ruflo@latest swarm init --topology hierarchical --agents 3
npx ruflo@latest agent spawn --domain core --role coder --task "Implement the fix"
npx ruflo@latest agent spawn --domain support --role tester --task "Verify regression tests pass"
npx ruflo@latest agent spawn --domain security --role security-sentinel --task "Check fix doesn't introduce vulnerabilities"
```
Alternatively, use the Agent tool to spawn parallel agents with `isolation: "worktree"` — route
each per the Model Policy (`model: sonnet` for scoped fix work, `model: fable` for
root-cause-unknown reasoning, falling back to `model: opus` if fable is unavailable).
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

### ⛔ CHECKPOINT 6: Review

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
- FAIL + max retries exceeded → escalate to user with AskUserQuestion

---


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

**AUTORESEARCH CANDIDATE CHECK (RC-A):**
Scan the work just completed for measurable optimization targets:
1. **Static scan:** Analyze git diff for measurable patterns (function runtimes, test duration, bundle size, query counts, memory usage, coverage gaps)
2. **Agent reflection:** What about this work could be measured and autonomously optimized?
3. **Impact scoring:** Rate each candidate on 4 dimensions (weighted composite):
   - potential (0.35): estimated improvement magnitude (1-10)
   - blast_radius (0.15): files/systems affected, inverted (1-10)
   - risk (0.15): breaking change likelihood, inverted (1-10)
   - value (0.35): user/business value of improvement (1-10)
   - Composite = (potential * 0.35) + ((10 - blast_radius) * 0.15) + ((10 - risk) * 0.15) + (value * 0.35)
4. If candidates found, append RC-A entries to .claude/ralph-candidates.md:
```
## RC-A[NNN]: [Title]
**KPI:** [metric_name]
**Baseline:** [current value]
**Benchmark:** `[command to measure]`
**Impact Score:** [composite] (potential: N, blast_radius: N, risk: N, value: N)
**Files in scope:** [paths]
**Constraints:** [what must not break]
```
- RC-A candidates found: yes/no
- If yes, logged with impact scores to .claude/ralph-candidates.md


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
- [ ] Pi Brain discovery completed (CHECKPOINT 0.5)
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
