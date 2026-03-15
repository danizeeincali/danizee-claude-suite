# /w-perf

Performance Audit - Bottlenecks, N+1 queries, memory issues, optimization opportunities.

## Usage
```
/w-perf [target description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past performance optimizations
2. Profile and identify bottlenecks
3. Analyze and prioritize recommendations
4. Compound performance patterns

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip any performance category
- NEVER skip compound phase at the end
- VIOLATION: Incomplete profiling = incomplete audit

---

## Checks Performed
- N+1 query detection
- Memory leak analysis
- CPU bottlenecks
- I/O optimization
- Caching opportunities
- Bundle size analysis

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
- List of past optimizations (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past performance patterns. Proceed to Profiling?"
- Options: ["Continue", "Review past optimizations first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Profiling Done

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to verify the implementation visually
2. `agent-browser open <url>` → `agent-browser snapshot -i` → verify elements
3. Compare against pre-change screenshots from Search phase

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
| Category | Finding | Impact | Location |
|----------|---------|--------|----------|
| N+1 queries | _____ | _____ | _____ |
| Memory | _____ | _____ | _____ |
| CPU | _____ | _____ | _____ |
| I/O | _____ | _____ | _____ |
| Caching | _____ | _____ | _____ |
| Bundle size | _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Analysis phase.

---

### ⛔ CHECKPOINT 2: Analysis Complete

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Final visual verification with agent-browser — focus on performance impact
2. `agent-browser open <url>` → `agent-browser screenshot` → compare before/after
3. Verify load times, rendering performance, layout stability

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Prioritized recommendations (by impact)
- Estimated improvement metrics
- Implementation suggestions

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

### ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/performance/_____
- Doc path: docs/solutions/performance/_____.md
- All findings documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 4 phases
- [ ] Checkpoint 0 completed with user confirmation
- [ ] Checkpoints 1-3 completed (auto-proceed)
- [ ] All performance categories checked
- [ ] Recommendations prioritized
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Performance doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/performance/[target-area]
Doc: docs/solutions/performance/[audit-name].md
```

## Example
```
/w-perf dashboard loading
```
