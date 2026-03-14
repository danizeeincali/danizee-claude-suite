# /w-bg-tdd-swarm

Background TDD Swarm - Full auto-proceed with no user gates. All phases run autonomously.

**Philosophy:** Plan, test, build, review, compound - all autonomous. Only blocking rule: tests must fail before build.

## Usage
```
/w-bg-tdd-swarm [feature description]
```

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
8. Git commit

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- All checkpoints auto-proceed - NO user gates
- NEVER proceed to Build before all tests exist and FAIL
- NEVER skip compound phase at the end
- NEVER skip git commit phase at the end
- VIOLATION: Starting implementation without search = restart workflow

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

**AUTO-PROCEED:** Continue to Plan phase.

---

### Phase 1: Plan
**REQUIRED OUTPUT:**
- Architecture summary (3-5 bullets)
- Files to create/modify (list)
- Approach and rationale

**AUTO-PROCEED:** Continue to Spec phase.

---

### Phase 2: Spec
**REQUIRED OUTPUT:**
- Acceptance criteria (numbered list)
- Test cases (numbered list)

**AUTO-PROCEED:** Continue to Tests phase.

---

### Phase 3: Tests (BLOCKING GATE)
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

### Phase 4: Build

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

### Phase 5: Review

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

**AUTO-PROCEED:** Continue to Compound phase.

---

### Phase 6: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/full-tdd-swarm/_____
- Doc path: docs/solutions/full-tdd-swarm/_____.md
- Pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

**AUTO-PROCEED:** Continue to Git Commit phase.

---

### Phase 7: Git Commit (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Commit hash: _____
- Files committed: _____
- Branch: _____

Commit all changes with a descriptive message including:
- Feature/fix description
- Workflow: /w-bg-tdd-swarm
- Files changed count and tests added count
- Co-author attribution

NEVER skip this phase. Workflow is INCOMPLETE without commit.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 8 phases
- [ ] All phases completed (auto-proceed, no user gates)
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
Memory: project/full-tdd-swarm/[feature-name]
Doc: docs/solutions/full-tdd-swarm/[feature-name].md
```

## Example
```
/w-bg-tdd-swarm user authentication with JWT tokens
```
