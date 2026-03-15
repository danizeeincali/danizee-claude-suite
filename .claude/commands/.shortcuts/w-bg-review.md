# /w-bg-review

Background Review - Full auto-proceed code review with no user gates.

**Philosophy:** Scan, analyze, document - all autonomous. No gates, full review coverage.

## Usage
```
/w-bg-review [PR number or description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past review patterns
2. Run code analysis
3. Run security scan
4. Run performance check
5. Run architecture review
6. Ralph candidates scan
7. Compound review findings
8. Git commit

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- All checkpoints auto-proceed - NO user gates
- NEVER skip any review category
- NEVER skip compound phase at the end
- NEVER skip git commit phase at the end
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

### Phase 0: Search

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

**AUTO-PROCEED:** Continue to Code Analysis phase.

---

### Phase 1: Code Analysis

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
| Style | _____ | _____ |
| Patterns | _____ | _____ |
| Quality | _____ | _____ |
| Simplicity | _____ | _____ |

**AUTO-PROCEED:** Continue to Security Scan phase.

---

### Phase 2: Security Scan
**REQUIRED OUTPUT:**
| Vulnerability | Risk | Location |
|---------------|------|----------|
| _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Performance Check phase.

---

### Phase 3: Performance Check
**REQUIRED OUTPUT:**
| Opportunity | Impact | Location |
|-------------|--------|----------|
| _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Ralph Candidates phase.

---

### Phase 4: Ralph Candidates
**Scan for dev patterns that could become future Ralph loops:**
- Repeating code patterns in this PR
- Bug fix patterns that recur
- Feature patterns worth templating

**If candidate identified:**
1. Generate unique ID: RC-NNN (check .claude/ralph-candidates.md for next available)
2. Assign priority: P1 (critical) / P2 (important) / P3 (nice-to-have)
3. Define AI-verifiable completion tests
4. Add entry to .claude/ralph-candidates.md
5. Set initial status: draft

**REQUIRED OUTPUT:**
- Candidates identified: 0/1/2+
- If any: ID(s) added, priority, completion tests defined

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

### Phase 5: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/reviews/_____
- Doc path: docs/solutions/reviews/_____.md
- All findings documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

**AUTO-PROCEED:** Continue to Git Commit phase.

---

### Phase 6: Git Commit (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Commit hash: _____
- Files committed: _____
- Branch: _____

Commit all changes with a descriptive message including:
- Review summary
- Workflow: /w-bg-review
- Co-author attribution

NEVER skip this phase. Workflow is INCOMPLETE without commit.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 8 phases
- [ ] All phases completed (auto-proceed, no user gates)
- [ ] Code analysis completed
- [ ] Security scan completed
- [ ] Performance check completed
- [ ] Ralph candidates scanned
- [ ] Compound phase executed
- [ ] Git commit executed
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
/w-bg-review PR 47
```
