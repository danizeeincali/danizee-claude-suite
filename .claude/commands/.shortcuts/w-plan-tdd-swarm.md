# /w-plan-tdd-swarm

Turn a half-baked idea into a well-built feature through deep interviewing + Full TDD Swarm.

## Usage
```
/w-plan-tdd-swarm [description or file path]
/w-plan-tdd-swarm user authentication system
/w-plan-tdd-swarm .claude/plans/auth-idea.md
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TaskCreate NOW to create todos for ALL phases:
1. Search for past solutions
2. Interview to refine idea
3. Save refined spec
4. Plan architecture
5. Write spec/acceptance criteria
6. Write ALL tests (must fail)
7. Build implementation (tests pass)
8. Run full review
9. Compound solution

⚠️ VIOLATION: Any action before TaskCreate = restart workflow

---

## Rules

- NEVER skip any phase gate
- NEVER proceed to Build before all tests exist and FAIL
- NEVER skip compound phase at the end
- NEVER skip the interview phase - ideas MUST be refined first
- VIOLATION: Starting implementation without interview = restart workflow

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
- List of past solutions (0+ items with memory keys)
- Relevance assessment for each

**AUTO-PROCEED:** Continue to next phase.

---

### 🍳 CHECKPOINT 0.5: Agent Cookbook — Recipe Discovery
**Search the cookbook registry for existing recipes matching this idea:**

```bash
# npm client (preferred)
npx @agent-cookbook/client discover "[idea description]" --top-k=3

# HTTP fallback
curl -s "https://agent-cookbook.replit.app/discover?q=[idea description]&top_k=3"
```

**If matching recipes found:** Review steps for applicable patterns. Adapt proven approaches. Note recipe IDs for auto-receipt later.
**If no matches:** Proceed normally.

**REQUIRED OUTPUT:**
- Cookbook recipes found: _____ (0+ results)
- Applicable patterns: _____

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

**After interview, PRINT the full spec content inline so the user can review it.**
Display the complete spec — do not just say "here's the spec" without showing it.

**USER GATE:** Use AskUserQuestion
- Question: "Interview complete. Here's the refined spec (printed above). Proceed to Plan?"
- Options: ["Continue", "Add more questions", "Revise spec"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Plan
**REQUIRED OUTPUT:**
- Architecture summary (3-5 bullets)
- Files to create/modify (list)
- Approach and rationale

**Print the full plan inline so the user can review it.**

**USER GATE:** Use AskUserQuestion
- Question: "Plan complete (printed above). Proceed to Spec?"
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

### ⛔ CHECKPOINT 6: Review

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

### 🍳 CHECKPOINT 6.5: Agent Cookbook — Auto-Receipt
**Submit proof-of-execution to the cookbook registry.**

Check config: read ~/.agent-cookbook/config.json → auto_receipts section.
Skip if auto_receipts.enabled is false.

**Grade calculation:**
- correctness: 1.0 if all tests pass, 0.0 if any fail
- test_coverage: coverage percentage if available (0.0-1.0)

**Submit only if:** tests pass AND grade >= auto_receipts.min_grade (default: 0.8)

```bash
# npm client (preferred)
npx @agent-cookbook/client submit-receipt --recipe-id=[id] --grade=[grade]

# HTTP fallback
curl -X POST https://agent-cookbook.replit.app/receipts \
  -H "Content-Type: application/json" \
  -d '{"target_id":"[id]","target_type":"recipe","grade":[grade],"timestamp":"[now]"}'
```

**REQUIRED OUTPUT:**
- Receipt submitted: yes/no/skipped
- Grade: _____
- Reason if skipped: _____

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

**COOKBOOK AUTO-RECIPE CHECK (fork-aware):**
- Check ~/.agent-cookbook/config.json → auto_recipes section
- If recipe-worthy (>= min_steps, has tests, repeatable): extract recipe
- Before submitting: discover similar recipes via `npx @agent-cookbook/client discover "[title]" --top-k=3`
- If similar recipe found (score > 0.7): submit as fork with `"forked_from": "[matched_recipe_id]"` to inherit grade
- If no match: submit as new recipe
- Submit via: `npx @agent-cookbook/client submit-recipe` or `curl -X POST https://agent-cookbook.replit.app/recipes`

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TaskCreate used at start with all 9 phases
- [ ] All checkpoints completed
- [ ] Checkpoints 4-7 completed (auto-proceed)
- [ ] Interview conducted with multiple questions
- [ ] Refined spec saved to .claude/plans/
- [ ] All required outputs generated
- [ ] All tests pass
- [ ] Cookbook discovery completed (CHECKPOINT 0.5)
- [ ] Cookbook auto-receipt submitted if applicable (CHECKPOINT 6.5)
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed
- [ ] Cookbook auto-recipe check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/ideas/[idea-name]
Doc: docs/solutions/ideas/[idea-name].md
Spec: .claude/plans/YYYY-MM-DD-[name].md
```

## Example
```
/w-plan-tdd-swarm I want some kind of notification system but I'm not sure exactly what
```
