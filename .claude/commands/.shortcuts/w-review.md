# /w-review

Full Review - 12+ specialized agents analyze code, security, performance, architecture.

## Usage
```
/w-review [PR number or description]
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
1. Search for past review patterns
2. Run code analysis
3. Run security scan
4. Run performance check
5. Run architecture review
6. Compound review findings

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip any review category
- NEVER skip compound phase at the end
- VIOLATION: Completing review without all categories = incomplete

---

## Agents Deployed
- code-simplicity-reviewer
- security-sentinel
- performance-oracle
- architecture-strategist
- pattern-recognition-specialist

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
- List of past reviews (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past reviews for this area. Proceed to Code Analysis?"
- Options: ["Continue", "Review past findings first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Code Analysis

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to verify the implementation visually
2. `agent-browser open <url>` → `agent-browser snapshot -i` → verify elements
3. Compare against pre-change screenshots from Search phase

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
| Category | Finding | Severity |
|----------|---------|----------|
| Style | _____ | _____ |
| Patterns | _____ | _____ |
| Quality | _____ | _____ |
| Simplicity | _____ | _____ |

**AUTO-PROCEED:** Continue to Security Scan phase.

---

### ⛔ CHECKPOINT 2: Security Scan
**REQUIRED OUTPUT:**
| Vulnerability | Risk | Location |
|---------------|------|----------|
| _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Performance Check phase.

---

### ⛔ CHECKPOINT 3: Performance Check
**REQUIRED OUTPUT:**
| Opportunity | Impact | Location |
|-------------|--------|----------|
| _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Ralph Candidates phase.

---

### ⛔ CHECKPOINT 4: Ralph Candidates (AUTO-PROCEED)
**Scan for dev patterns that could become future Ralph loops:**
- Repeating code patterns in this PR
- Bug fix patterns that recur
- Feature patterns worth templating

**If candidate identified:**
1. Generate unique ID: RC-NNN (check .claude/ralph-candidates.md for next available)
2. Assign priority: P1 (critical) / P2 (important) / P3 (nice-to-have)
3. Define AI-verifiable completion tests:
   - File exists: `path/to/expected/file`
   - Pattern match: `"regex"` in `file`
   - Test passes: `npm test -- --grep "name"`
   - Lint clean: `npm run lint`
4. Add entry to .claude/ralph-candidates.md
5. Set initial status: draft

**REQUIRED OUTPUT:**
- Candidates identified: 0/1/2+
- If any:
  - ID(s) added: RC-___
  - Priority: P_
  - Completion tests defined: yes/no

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

### ⛔ CHECKPOINT 5: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/reviews/_____
- Doc path: docs/solutions/reviews/_____.md
- All findings documented: yes/no

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
- [ ] TodoWrite used at start with all 6 phases
- [ ] Checkpoint 0 completed with user confirmation
- [ ] Checkpoints 1-5 completed (auto-proceed)
- [ ] Code analysis completed
- [ ] Security scan completed
- [ ] Performance check completed
- [ ] Ralph candidates scanned
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Review doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/reviews/[pr-topic]
Doc: docs/solutions/reviews/[pr-number].md
```

## Example
```
/w-review PR 47
```
