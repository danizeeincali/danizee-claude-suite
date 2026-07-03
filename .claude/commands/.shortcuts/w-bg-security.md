# /w-bg-security

Background Security Audit - Full auto-proceed OWASP scan with no user gates.

**Philosophy:** Scan, analyze, document - all autonomous. Complete coverage, no gates.

## Usage
```
/w-bg-security [target description]
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
1. Search for past security findings
2. Run comprehensive security scan
3. Analyze and prioritize risks
4. Compound security patterns
5. Git commit

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- All checkpoints auto-proceed - NO user gates
- NEVER skip any OWASP category
- NEVER skip compound phase at the end
- NEVER skip git commit phase at the end
- VIOLATION: Incomplete scan = incomplete audit

---

## Checks Performed
- SQL injection
- XSS (Cross-Site Scripting)
- CSRF (Cross-Site Request Forgery)
- Authentication bypass
- Secrets exposure
- Input validation
- Authorization flaws

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
- List of past security findings (0+ items with memory keys)
- Relevance assessment for each

**AUTO-PROCEED:** Continue to Scan phase.

---

### Phase 1: Scan Complete

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to verify the implementation visually
2. `agent-browser open <url>` → `agent-browser snapshot -i` → verify elements
3. Compare against pre-change screenshots from Search phase

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
| Category | Finding | Severity | Location |
|----------|---------|----------|----------|
| SQL Injection | _____ | _____ | _____ |
| XSS | _____ | _____ | _____ |
| CSRF | _____ | _____ | _____ |
| Auth bypass | _____ | _____ | _____ |
| Secrets | _____ | _____ | _____ |
| Input validation | _____ | _____ | _____ |
| Authz flaws | _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Analysis phase.

---

### Phase 2: Analysis Done

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Final visual verification with agent-browser
2. `agent-browser open <url>` → `agent-browser screenshot` → compare before/after
3. Verify responsive layout, dark mode, accessibility

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Risk assessment summary
- Prioritized remediation list (by severity)
- Recommended fixes

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

### Phase 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/security/_____
- Doc path: docs/solutions/security/_____.md
- All findings documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

**AUTO-PROCEED:** Continue to Git Commit phase.

---

### Phase 4: Git Commit (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Commit hash: _____
- Files committed: _____
- Branch: _____

Commit all changes with a descriptive message including:
- Security audit summary
- Workflow: /w-bg-security
- Co-author attribution

NEVER skip this phase. Workflow is INCOMPLETE without commit.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] All phases completed (auto-proceed, no user gates)
- [ ] All OWASP categories scanned
- [ ] Risk assessment completed
- [ ] Compound phase executed
- [ ] Git commit executed
- [ ] Memory key stored: _____
- [ ] Security doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/security/[target-area]
Doc: docs/solutions/security/[audit-name].md
```

## Example
```
/w-bg-security authentication module
```
