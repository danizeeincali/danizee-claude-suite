# /w-architect

Hive-Mind Architecture - Multiple agents collaborate with collective intelligence for complex design.

## Usage
```
/w-architect [system description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for related architecture decisions
2. Initialize hive-mind collaboration
3. Generate design proposals
4. Reach consensus on design
5. Compound architecture decision record

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip consensus phase - all options must be evaluated
- NEVER skip compound phase at the end
- VIOLATION: Skipping proposals = incomplete architecture

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
- List of related ADRs (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] related architecture decisions. Proceed to Hive Init?"
- Options: ["Continue", "Review past decisions first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Hive Initialized
**REQUIRED OUTPUT:**
- Agent assignments:
| Agent | Role | Focus |
|-------|------|-------|
| _____ | system-architect | _____ |
| _____ | analyst | _____ |
| _____ | domain-expert | _____ |

- Hive topology: _____

**USER GATE:** Use AskUserQuestion
- Question: "Hive initialized with [N] agents. Proceed to Design Proposals?"
- Options: ["Continue", "Revise agents", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Design Proposals
**REQUIRED OUTPUT:**
| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| Option A | _____ | _____ | _____ |
| Option B | _____ | _____ | _____ |
| Option C | _____ | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "[N] design options generated. Proceed to Consensus?"
- Options: ["Continue", "Explore more options", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Consensus Reached

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Final visual verification with agent-browser
2. `agent-browser open <url>` → `agent-browser screenshot` → compare before/after
3. Verify responsive layout, dark mode, accessibility

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Recommended design: _____
- Rationale: _____
- Trade-offs accepted: _____
- Implementation roadmap: _____

**USER GATE:** Use AskUserQuestion
- Question: "Consensus: [Option X]. Proceed to Compound?"
- Options: ["Continue", "Revisit options", "Show more detail"]

STOP and wait for user response.

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

### ⛔ CHECKPOINT 4: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/architecture/_____
- Doc path: docs/solutions/architecture/_____-adr.md
- ADR documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] All 5 checkpoints completed with user confirmation
- [ ] Multiple design options evaluated
- [ ] Consensus reached with rationale
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] ADR doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/architecture/[system-name]
Doc: docs/solutions/architecture/[system-name]-adr.md
```

## Example
```
/w-architect microservices migration
```
