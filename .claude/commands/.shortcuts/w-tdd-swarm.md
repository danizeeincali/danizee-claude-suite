# /w-tdd-swarm

Full TDD Swarm - Combines planning + test-first + parallel build + comprehensive review.

**Philosophy:** Plan like Full Cycle, test like TDD, build like Swarm.

## Usage
```
/w-tdd-swarm [feature description]
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

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to screenshot the current state before changes
2. `agent-browser open <url>` → `agent-browser screenshot`
3. Note current UI state for comparison after build

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- List of past solutions (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past solutions. Proceed to Plan or use existing?"
- Options: ["Proceed to Plan", "Use existing solution", "Show more detail"]

STOP and wait for user response.

---

### 🧠 CHECKPOINT 0.5: Pi Brain — Knowledge Discovery
**Search the Pi Brain network for existing knowledge matching this feature:**

```bash
# npm client (preferred)
curl -s -H "Authorization: Bearer anonymous" "https://pi.ruv.io/v1/memories/search "[feature description]" --top-k=3

# HTTP fallback
curl -s "https://pi.ruv.io/v1/memories/search?q=[feature description]&top_k=3"
```

**If matching memories found:** Review steps for applicable patterns. Adapt proven approaches. Note memory IDs for voting later.
**If no matches:** Proceed normally.

**REQUIRED OUTPUT:**
- Pi Brain memories found: _____ (0+ results)
- Applicable patterns: _____

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

**AUTO-PROCEED:** Continue to Tests phase.

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

**AUTO-PROCEED:** Continue to Build phase after tests fail.

---

### ⛔ CHECKPOINT 4: Build

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

**AUTO-PROCEED:** Continue to Review phase.

---

### ⛔ CHECKPOINT 5: Review

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
- FAIL + max retries exceeded → escalate to user with AskUserQuestion

---


---

### ⛔ CHECKPOINT 6: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/full-tdd-swarm/_____
- Doc path: docs/solutions/full-tdd-swarm/_____.md
- Pattern stored: yes/no

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
- [ ] TodoWrite used at start with all 7 phases
- [ ] Checkpoints 0-2 completed with user confirmation
- [ ] Checkpoints 3-6 completed (auto-proceed)
- [ ] All required outputs generated
- [ ] All tests pass
- [ ] Pi Brain discovery completed (CHECKPOINT 0.5)
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

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
