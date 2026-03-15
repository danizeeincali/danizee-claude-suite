# /w-fix

Quick Fix - Fast investigation → targeted fix → verification.

## Usage
```
/w-fix [bug description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for similar bugs fixed before
2. Investigate root cause
3. Apply minimal targeted fix
4. Verify with tests
5. Compound bug pattern

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip compound phase at the end
- VIOLATION: Starting fix without search = restart workflow

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
- List of similar bugs (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] similar bugs. Proceed to Investigation or use existing fix?"
- Options: ["Proceed to Investigation", "Use existing fix", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Investigation
**REQUIRED OUTPUT:**
- Root cause identified: _____
- Files/lines involved: _____
- Evidence: _____

**USER GATE:** Use AskUserQuestion
- Question: "Root cause: [X]. Proceed to apply fix?"
- Options: ["Continue", "Investigate more", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Fix Applied

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to verify the implementation visually
2. `agent-browser open <url>` → `agent-browser snapshot -i` → verify elements
3. Compare against pre-change screenshots from Search phase

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Files modified: _____
- Changes summary: _____
- Test results: _____

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
- Memory key: project/bugs/_____
- Doc path: docs/solutions/bugs/_____.md
- Pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] Checkpoints 0-1 completed with user confirmation
- [ ] Checkpoints 2-3 completed (auto-proceed)
- [ ] Root cause identified
- [ ] Fix applied and tests pass
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/bugs/[bug-category]
Doc: docs/solutions/bugs/[bug-name].md
```

## Example
```
/w-fix users getting logged out after password reset
```
