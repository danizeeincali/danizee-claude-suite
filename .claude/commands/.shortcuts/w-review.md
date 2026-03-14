# /w-review

Full Review - 12+ specialized agents analyze code, security, performance, architecture.

## Usage
```
/w-review [PR number or description]
```

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

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 5: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/reviews/_____
- Doc path: docs/solutions/reviews/_____.md
- All findings documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

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
