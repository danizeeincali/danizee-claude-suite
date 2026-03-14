# /w-security

Security Audit - OWASP top 10, auth/authz, data exposure analysis.

## Usage
```
/w-security [target description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past security findings
2. Run comprehensive security scan
3. Analyze and prioritize risks
4. Compound security patterns

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip any OWASP category
- NEVER skip compound phase at the end
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

### ⛔ CHECKPOINT 0: Search

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

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past security findings. Proceed to Scan?"
- Options: ["Continue", "Review past findings first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Scan Complete

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

### ⛔ CHECKPOINT 2: Analysis Done

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Final visual verification with agent-browser — focus on security-related UI
2. `agent-browser open <url>` → `agent-browser screenshot` → compare before/after
3. Verify auth flows, input sanitization display, error handling UX

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Risk assessment summary
- Prioritized remediation list (by severity)
- Recommended fixes

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/security/_____
- Doc path: docs/solutions/security/_____.md
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
- [ ] All OWASP categories scanned
- [ ] Risk assessment completed
- [ ] Compound phase executed
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
/w-security authentication module
```
