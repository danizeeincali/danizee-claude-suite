# /w-idea-tdd-swarm

Turn a half-baked idea into a well-built feature through deep interviewing + Full TDD Swarm.

## Usage
```
/w-idea-tdd-swarm [description or file path]
/w-idea-tdd-swarm user authentication system
/w-idea-tdd-swarm .claude/plans/auth-idea.md
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

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER proceed to Build before all tests exist and FAIL
- NEVER skip compound phase at the end
- NEVER skip the interview phase - ideas MUST be refined first
- VIOLATION: Starting implementation without interview = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of past solutions (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past solutions. Proceed to Interview or use existing?"
- Options: ["Proceed to Interview", "Use existing solution", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Interview (MANDATORY - NEVER SKIP)
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
- Question: "Interview complete. Here's the refined spec. Proceed to Plan?"
- Options: ["Continue", "Add more questions", "Revise spec"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Plan
**REQUIRED OUTPUT:**
- Architecture summary (3-5 bullets)
- Files to create/modify (list)
- Approach and rationale

**USER GATE:** Use AskUserQuestion
- Question: "Plan complete. Proceed to Spec?"
- Options: ["Continue", "Revise plan", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Spec
**REQUIRED OUTPUT:**
- Acceptance criteria (numbered list)
- Test cases (numbered list)

**AUTO-PROCEED:** Continue to Tests phase.

---

### ⛔ CHECKPOINT 4: Tests (BLOCKING GATE)
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

### ⛔ CHECKPOINT 5: Build
**REQUIRED OUTPUT:**
- Implementation file paths: _____
- Test run result: "All _____ tests PASS"

**AUTO-PROCEED:** Continue to Review phase.

---

### ⛔ CHECKPOINT 6: Review
**REQUIRED OUTPUT:**
| Category | Finding | Severity |
|----------|---------|----------|
| Security | _____ | _____ |
| Performance | _____ | _____ |
| Architecture | _____ | _____ |

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 7: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/ideas/_____
- Doc path: docs/solutions/ideas/_____.md
- Spec path: .claude/plans/YYYY-MM-DD-[name].md
- Pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 9 phases
- [ ] Checkpoints 0-3 completed with user confirmation
- [ ] Checkpoints 4-7 completed (auto-proceed)
- [ ] Interview conducted with multiple questions
- [ ] Refined spec saved to .claude/plans/
- [ ] All required outputs generated
- [ ] All tests pass
- [ ] Compound phase executed
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
/w-idea-tdd-swarm I want some kind of notification system but I'm not sure exactly what
```
