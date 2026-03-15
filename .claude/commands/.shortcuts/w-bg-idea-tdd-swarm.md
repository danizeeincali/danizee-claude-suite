# /w-bg-idea-tdd-swarm

Background Idea → TDD Swarm - Interview to refine, then full auto-proceed build.

**Philosophy:** The ONLY gate is the interview itself. Once user confirms the refined spec, everything else auto-proceeds through build, test, review, compound, and commit.

## Usage
```
/w-bg-idea-tdd-swarm [description or file path]
/w-bg-idea-tdd-swarm user authentication system
/w-bg-idea-tdd-swarm .claude/plans/auth-idea.md
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past solutions
2. Interview to refine idea
3. Save refined spec
4. Plan architecture
5. Write spec/acceptance criteria
6. Write ALL tests (must fail)
7. Build implementation (tests pass)
8. Run full review
9. Compound solution
10. Git commit

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Interview is the ONLY user gate - after confirmation, all phases auto-proceed
- NEVER proceed to Build before all tests exist and FAIL
- NEVER skip compound phase at the end
- NEVER skip git commit phase at the end
- NEVER skip the interview phase - ideas MUST be refined first
- VIOLATION: Starting implementation without interview = restart workflow

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
- List of past solutions (0+ items with memory keys)
- Relevance assessment for each

**AUTO-PROCEED:** Continue to Interview phase.

---

### Phase 1: Interview (MANDATORY - ONLY USER GATE)
**Interview Categories:**

**Technical & Architecture**
- Implementation approach, tradeoffs, edge cases
- How this fits with existing systems
- What could break or need migration

**Human & Workflow**
- Who else is affected?
- What's the manual fallback if automation fails?
- How will you know it's working? What does success look like?

**Strategic**
- Why now? What's the cost of waiting?
- What's the simplest version that delivers value?
- What would make you regret building this?

**Interview Rules:**
- Ask ONE question at a time using AskUserQuestion
- Go deep on answers revealing uncertainty or assumptions
- Don't ask obvious questions - push on unthought things
- Capture quotable moments verbatim for the spec
- End with: "What did I forget to ask about?"

**REQUIRED OUTPUT:**
- Interview notes with user quotes
- Refined requirements list
- Spec file: .claude/plans/YYYY-MM-DD-[name].md

**USER GATE:** Use AskUserQuestion
- Question: "Interview complete. Here's the refined spec. Proceed to autonomous build?"
- Options: ["Continue", "Add more questions", "Revise spec"]

STOP and wait for user response.

**After user confirms: ALL remaining phases auto-proceed with no gates.**

---

### Phase 2: Plan
**REQUIRED OUTPUT:**
- Architecture summary (3-5 bullets)
- Files to create/modify (list)
- Approach and rationale

**AUTO-PROCEED:** Continue to Spec phase.

---

### Phase 3: Spec
**REQUIRED OUTPUT:**
- Acceptance criteria (numbered list)
- Test cases (numbered list)

**AUTO-PROCEED:** Continue to Tests phase.

---

### Phase 4: Tests (BLOCKING GATE)
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

### Phase 5: Build

**RuFlo Swarm Execution (optional — for complex builds):**
If the implementation is complex enough to benefit from parallel agents, initialize a ruflo swarm:
```bash
npx ruflo@latest swarm init --topology hierarchical --agents 3
npx ruflo@latest agent spawn --domain core --role coder --task "Implement core feature logic"
npx ruflo@latest agent spawn --domain support --role tester --task "Verify tests pass with implementation"
npx ruflo@latest agent spawn --domain support --role reviewer --task "Review implementation quality"
```
Alternatively, use the Agent tool to spawn parallel agents with `isolation: "worktree"`.
For simple builds, proceed with serial implementation.

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

### Phase 6: Review

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
- FAIL + max retries exceeded → log error and mark workflow as FAILED

---

### Phase 7: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/ideas/_____
- Doc path: docs/solutions/ideas/_____.md
- Spec path: .claude/plans/YYYY-MM-DD-[name].md
- Pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

**AUTO-PROCEED:** Continue to Git Commit phase.

---

### Phase 8: Git Commit (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Commit hash: _____
- Files committed: _____
- Branch: _____

Commit all changes with a descriptive message including:
- Feature description from refined spec
- Workflow: /w-bg-idea-tdd-swarm
- Files changed count and tests added count
- Co-author attribution

NEVER skip this phase. Workflow is INCOMPLETE without commit.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 10 phases
- [ ] Interview conducted with multiple questions
- [ ] User confirmed refined spec (only gate)
- [ ] All remaining phases auto-proceeded
- [ ] Refined spec saved to .claude/plans/
- [ ] All required outputs generated
- [ ] Tests failed before build, all pass after
- [ ] Compound phase executed
- [ ] Git commit executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/ideas/[idea-name]
Doc: docs/solutions/ideas/[idea-name].md
Spec: .claude/plans/YYYY-MM-DD-[name].md
```

## Example
```
/w-bg-idea-tdd-swarm I want some kind of notification system but I'm not sure exactly what
```
