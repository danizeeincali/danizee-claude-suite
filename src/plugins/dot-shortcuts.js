/**
 * Workflow Shortcuts Plugin for Danizee Claude Suite
 * Provides quick `/w-` prefixed slash commands for all workflows
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Get all dot shortcut commands
 */
export function getCommands() {
  return {
    'w-swarm': {
      name: 'w-swarm',
      description: 'Swarm Build - Parallel agents for rapid implementation',
      content: `# /w-swarm

Swarm Build - Spawns parallel agents (coder, tester, reviewer) for rapid implementation.

## Usage
\`\`\`
/w-swarm [task description]
\`\`\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for related implementation patterns
2. Spawn agents with assignments
3. Execute parallel work
4. Integrate and verify results
5. Compound solution

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip compound phase at the end
- VIOLATION: Starting implementation without search = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of related patterns (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] related patterns. Proceed to Spawn agents or use existing?"
- Options: ["Proceed to Spawn", "Use existing solution", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Agent Spawn
**REQUIRED OUTPUT:**
- Agent assignments table:
| Agent | Task | Role |
|-------|------|------|
| _____ | _____ | coder |
| _____ | _____ | tester |
| _____ | _____ | reviewer |

- Swarm topology: _____
- Coordination strategy: _____

**USER GATE:** Use AskUserQuestion
- Question: "Agent assignments ready. Proceed to Execute?"
- Options: ["Continue", "Revise assignments", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Execution Complete
**REQUIRED OUTPUT:**
- Completed work summary per agent
- Files created/modified: _____
- Test results (if applicable): _____

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/implementations/_____
- Doc path: docs/solutions/implementations/_____.md
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
- [ ] All required outputs generated
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
\`\`\`
Memory: project/implementations/[task-name]
Doc: docs/solutions/implementations/[task-name].md
\`\`\`

## Example
\`\`\`
/w-swarm REST API for user management with CRUD and tests
\`\`\`
`
    },

    'w-tdd-swarm': {
      name: 'w-tdd-swarm',
      description: 'Full TDD Swarm - Plan + TDD + Swarm + Review combined',
      content: `# /w-tdd-swarm

Full TDD Swarm - Combines planning + test-first + parallel build + comprehensive review.

**Philosophy:** Plan like Full Cycle, test like TDD, build like Swarm.

## Usage
\`\`\`
/w-tdd-swarm [feature description]
\`\`\`

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

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER proceed to Build before all tests exist and FAIL
- NEVER skip compound phase at the end
- VIOLATION: Starting implementation without search = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of past solutions (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past solutions. Proceed to Plan or use existing?"
- Options: ["Proceed to Plan", "Use existing solution", "Show more detail"]

STOP and wait for user response.

---

### 🍳 CHECKPOINT 0.5: Agent Cookbook — Recipe Discovery
**Search the cookbook registry for existing recipes matching this feature:**

\\\`\\\`\\\`bash
# npm client (preferred)
npx @agent-cookbook/client discover "[feature description]" --top-k=3

# HTTP fallback
curl -s "https://agent-cookbook.replit.app/discover?q=[feature description]&top_k=3"
\\\`\\\`\\\`

**If matching recipes found:** Review steps for applicable patterns. Adapt proven approaches. Note recipe IDs for auto-receipt later.
**If no matches:** Proceed normally.

**REQUIRED OUTPUT:**
- Cookbook recipes found: _____ (0+ results)
- Applicable patterns: _____

---

### ⛔ CHECKPOINT 1: Plan
**REQUIRED OUTPUT:**
- Architecture summary (3-5 bullets)
- Files to create/modify (list)
- Approach and rationale

**USER GATE:** Use AskUserQuestion
- Question: "Plan complete. Proceed to Spec?"
- Options: ["Continue", "Revise plan", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Spec
**REQUIRED OUTPUT:**
- Acceptance criteria (numbered list)
- Test cases (numbered list)

**AUTO-PROCEED:** Continue to Tests phase.

---

### ⛔ CHECKPOINT 3: Tests (BLOCKING GATE)
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

### ⛔ CHECKPOINT 4: Build
**REQUIRED OUTPUT:**
- Implementation file paths: _____
- Test run result: "All _____ tests PASS"

**AUTO-PROCEED:** Continue to Review phase.

---

### ⛔ CHECKPOINT 5: Review
**REQUIRED OUTPUT:**
| Category | Finding | Severity |
|----------|---------|----------|
| Security | _____ | _____ |
| Performance | _____ | _____ |
| Architecture | _____ | _____ |

**AUTO-PROCEED:** Continue to Compound phase.

---

### 🍳 CHECKPOINT 5.5: Agent Cookbook — Auto-Receipt
**Submit proof-of-execution to the cookbook registry.**

Check config: read ~/.agent-cookbook/config.json → auto_receipts section.
Skip if auto_receipts.enabled is false.

**Grade calculation:**
- correctness: 1.0 if all tests pass, 0.0 if any fail
- test_coverage: coverage percentage if available (0.0-1.0)

**Submit only if:** tests pass AND grade >= auto_receipts.min_grade (default: 0.8)

\\\`\\\`\\\`bash
# npm client (preferred)
npx @agent-cookbook/client submit-receipt --recipe-id=[id] --grade=[grade]

# HTTP fallback
curl -X POST https://agent-cookbook.replit.app/receipts \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"target_id":"[id]","target_type":"recipe","grade":[grade],"timestamp":"[now]"}'
\\\`\\\`\\\`

**REQUIRED OUTPUT:**
- Receipt submitted: yes/no/skipped
- Grade: _____
- Reason if skipped: _____

---

### ⛔ CHECKPOINT 6: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/full-tdd-swarm/_____
- Doc path: docs/solutions/full-tdd-swarm/_____.md
- Pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 7 phases
- [ ] Checkpoints 0-2 completed with user confirmation
- [ ] Checkpoints 3-6 completed (auto-proceed)
- [ ] All required outputs generated
- [ ] All tests pass
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
\`\`\`
Memory: project/full-tdd-swarm/[feature-name]
Doc: docs/solutions/full-tdd-swarm/[feature-name].md
\`\`\`

## Example
\`\`\`
/w-tdd-swarm user authentication with JWT tokens
\`\`\`
`
    },

    'w-interview-tdd-swarm': {
      name: 'w-interview-tdd-swarm',
      description: 'Interview to TDD Swarm - Deep interview refines idea, then Full TDD Swarm builds it',
      content: `# /w-interview-tdd-swarm

Turn a half-baked idea into a well-built feature through deep interviewing + Full TDD Swarm.

## Usage
\`\`\`
/w-interview-tdd-swarm [description or file path]
/w-interview-tdd-swarm user authentication system
/w-interview-tdd-swarm .claude/plans/auth-idea.md
\`\`\`

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

### 🍳 CHECKPOINT 0.5: Agent Cookbook — Recipe Discovery
**Search the cookbook registry for existing recipes matching this idea:**

\\\`\\\`\\\`bash
# npm client (preferred)
npx @agent-cookbook/client discover "[idea description]" --top-k=3

# HTTP fallback
curl -s "https://agent-cookbook.replit.app/discover?q=[idea description]&top_k=3"
\\\`\\\`\\\`

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

### 🍳 CHECKPOINT 6.5: Agent Cookbook — Auto-Receipt
**Submit proof-of-execution to the cookbook registry.**

Check config: read ~/.agent-cookbook/config.json → auto_receipts section.
Skip if auto_receipts.enabled is false.

**Grade calculation:**
- correctness: 1.0 if all tests pass, 0.0 if any fail
- test_coverage: coverage percentage if available (0.0-1.0)

**Submit only if:** tests pass AND grade >= auto_receipts.min_grade (default: 0.8)

\\\`\\\`\\\`bash
# npm client (preferred)
npx @agent-cookbook/client submit-receipt --recipe-id=[id] --grade=[grade]

# HTTP fallback
curl -X POST https://agent-cookbook.replit.app/receipts \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"target_id":"[id]","target_type":"recipe","grade":[grade],"timestamp":"[now]"}'
\\\`\\\`\\\`

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
\`\`\`
Memory: project/ideas/[idea-name]
Doc: docs/solutions/ideas/[idea-name].md
Spec: .claude/plans/YYYY-MM-DD-[name].md
\`\`\`

## Example
\`\`\`
/w-interview-tdd-swarm I want some kind of notification system but I'm not sure exactly what
\`\`\`
`
    },

    'w-agent-tdd-swarm': {
      name: 'w-agent-tdd-swarm',
      description: 'Gateless TDD Swarm - Fully autonomous TDD cycle for terminal agents. Zero user gates, auto-PR.',
      content: `# /w-agent-tdd-swarm

Fully Autonomous TDD Swarm — Zero user gates. Designed for terminal agents (tmux + worktree).

**Philosophy:** Same rigor as /w-tdd-swarm, but fully autonomous. No gates, no stops, auto-PR.

## Usage
\\\`\\\`\\\`
/w-agent-tdd-swarm [feature description]
\\\`\\\`\\\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past solutions
2. Plan architecture
3. Write spec/acceptance criteria
4. Write ALL tests (must fail)
5. Build implementation (tests pass)
6. Run full review
7. Commit, push, and create PR
8. Compound solution

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ZERO user gates — this workflow runs fully autonomously
- NEVER proceed to Build before all tests exist and FAIL
- NEVER skip compound phase at the end
- ALWAYS create a PR at the end with \\\`gh pr create --fill\\\`
- ALWAYS commit with descriptive messages

---

## Execution Protocol

### PHASE 0: Context Gathering (AUTO-PROCEED)
**Run /w-start on yourself first** to load project context, memory, follow-ups, and session state.

**AUTO-PROCEED:** Continue to Search.

---

### PHASE 1: Search (AUTO-PROCEED)
Search for past solutions. Check memory keys, search codebase for similar implementations, note reusable patterns.

**AUTO-PROCEED:** Continue to Plan.

---

### PHASE 2: Plan (AUTO-PROCEED)
**REQUIRED OUTPUT:**
- Architecture summary (3-5 bullets)
- Files to create/modify (list)
- Approach and rationale

**AUTO-PROCEED:** Continue to Spec.

---

### PHASE 3: Spec (AUTO-PROCEED)
**REQUIRED OUTPUT:**
- Acceptance criteria (numbered list)
- Test cases (numbered list)

**AUTO-PROCEED:** Continue to Tests.

---

### PHASE 4: Tests (BLOCKING GATE — TDD only)
**REQUIRED OUTPUT:**
- Test file paths: _____
- Test count: _____ tests written
- Test run result: "All _____ tests FAIL as expected"

**BLOCKING RULE:**
NEVER proceed to Build until:
- [ ] All tests written
- [ ] All tests RUN and FAIL
- [ ] Failure output captured

**AUTO-PROCEED:** Continue to Build after tests fail.

---

### PHASE 5: Build (AUTO-PROCEED)
**REQUIRED OUTPUT:**
- Implementation file paths: _____
- Test run result: "All _____ tests PASS"

**AUTO-PROCEED:** Continue to Review.

---

### PHASE 6: Review (AUTO-PROCEED)
Quick self-review. Fix any critical/high findings before proceeding.

| Category | Finding | Severity |
|----------|---------|----------|
| Security | _____ | _____ |
| Performance | _____ | _____ |
| Architecture | _____ | _____ |

**AUTO-PROCEED:** Continue to PR.

---

### PHASE 7: Commit & PR (AUTO-PROCEED)
**REQUIRED ACTIONS:**
1. Stage all changes: \\\`git add -A\\\`
2. Commit with descriptive message
3. Push branch: \\\`git push -u origin HEAD\\\`
4. Create PR: \\\`gh pr create --fill\\\`

**REQUIRED OUTPUT:**
- Commit hash: _____
- PR URL: _____

**AUTO-PROCEED:** Continue to Compound.

---

### PHASE 8: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/full-tdd-swarm/_____
- Doc path: docs/solutions/full-tdd-swarm/_____.md
- Pattern stored: yes/no

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] All 8 phases completed (zero user gates)
- [ ] Tests written and pass
- [ ] PR created with \\\`gh pr create --fill\\\`
- [ ] Compound phase executed
`
    },

    'w-agent-interview-swarm': {
      name: 'w-agent-interview-swarm',
      description: 'Interview then Spawn Agent - Interactive interview, then spawns gateless terminal agent to build it.',
      content: `# /w-agent-interview-swarm

Interview then Spawn Autonomous Agent. Interactive interview refines the idea, then spawns a terminal agent (tmux + worktree) to build it with zero gates.

**Philosophy:** Humans are best at requirements. Agents are best at execution. Split the work.

## Usage
\\\`\\\`\\\`
/w-agent-interview-swarm [description or file path]
/w-agent-interview-swarm I want some kind of notification system
\\\`\\\`\\\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past solutions
2. Interview to refine idea
3. Save refined spec to .claude/plans/
4. Spawn terminal agent with spec

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Interview phase HAS user gates (needs human input)
- After interview completes, ALL remaining work is autonomous
- The spawned agent runs /w-agent-tdd-swarm (gateless)
- The spawned agent creates the PR automatically

---

## Execution Protocol

### PHASE 0: Context Gathering (AUTO-PROCEED)
**Run /w-start on yourself first** to load project context, memory, follow-ups, and session state.

**AUTO-PROCEED:** Continue to Search.

---

### PHASE 0.5: Search (AUTO-PROCEED)
Search for past solutions. Check memory keys, search codebase.

**AUTO-PROCEED:** Continue to Interview.

---

### ⛔ PHASE 1: Interview (USER GATES — MANDATORY)
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
- Don't ask obvious questions — push on unthought things
- Capture quotable moments verbatim for the spec
- End with: "What did I forget to ask about?"

**REQUIRED OUTPUT:**
- Interview notes with user quotes
- Refined requirements list

**USER GATE:** Use AskUserQuestion
- Question: "Interview complete. Here's the refined spec. Ready to spawn the agent?"
- Options: ["Spawn agent", "Add more questions", "Revise spec"]

STOP and wait for user response.

---

### PHASE 2: Save Spec (AUTO-PROCEED)
Save the refined spec to: \\\`.claude/plans/YYYY-MM-DD-[name].md\\\`

Include: requirements, acceptance criteria, key decisions, user quotes.

**AUTO-PROCEED:** Continue to Spawn.

---

### PHASE 3: Spawn Terminal Agent (AUTO-PROCEED)
**Use the spawn_terminal_agent MCP tool:**

- \\\`repo_path\\\`: Current repository path
- \\\`task\\\`: The complete refined spec from the interview
- \\\`workflow\\\`: "/w-agent-tdd-swarm"

**After spawning, report to the user:**
- Agent ID
- Branch name
- How to check status: \\\`check_terminal_agents\\\` MCP tool
- How to redirect: \\\`redirect_terminal_agent\\\` MCP tool
- The agent will create a PR with \\\`gh pr create --fill\\\` when done

**REQUIRED OUTPUT:**
- Agent ID: _____
- Branch: _____
- Spec file: .claude/plans/YYYY-MM-DD-[name].md

---

## Completion Checklist

- [ ] Interview conducted with multiple questions
- [ ] Spec saved to .claude/plans/
- [ ] Terminal agent spawned via spawn_terminal_agent
- [ ] Agent ID reported to user
`
    },

    'w-fix': {
      name: 'w-fix',
      description: 'Quick Fix - Fast bug investigation and targeted fix',
      content: `# /w-fix

Quick Fix - Fast investigation → targeted fix → verification.

## Usage
\`\`\`
/w-fix [bug description]
\`\`\`

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
**REQUIRED OUTPUT:**
- Files modified: _____
- Changes summary: _____
- Test results: _____

**AUTO-PROCEED:** Continue to Compound phase.

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
\`\`\`
Memory: project/bugs/[bug-category]
Doc: docs/solutions/bugs/[bug-name].md
\`\`\`

## Example
\`\`\`
/w-fix users getting logged out after password reset
\`\`\`
`
    },

    'w-debug': {
      name: 'w-debug',
      description: 'Deep Debug → TDD Swarm - Diagnose issue then fix with regression tests',
      content: `# /w-debug

Deep Debug → TDD Swarm - Thorough investigation then fix with regression tests.

## Usage
\`\`\`
/w-debug [issue description]
\`\`\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for related debugging sessions
2. Analyze and form hypotheses
3. Investigate with multiple tools
4. Diagnose and confirm root cause
5. Plan fix architecture
6. Write regression tests (must fail)
7. Build fix (tests pass)
8. Run review
9. Compound solution

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER proceed to Build before regression tests exist and FAIL
- NEVER skip compound phase at the end
- NEVER skip the diagnosis phase - root cause MUST be confirmed
- VIOLATION: Starting fix without confirmed diagnosis = restart workflow

---

## Execution Protocol

### Phase 1: Debug Investigation

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of related debugging sessions (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] related sessions. Proceed to Analysis or use existing solution?"
- Options: ["Proceed to Analysis", "Use existing solution", "Show more detail"]

STOP and wait for user response.

---

### 🍳 CHECKPOINT 0.5: Agent Cookbook — Recipe Discovery
**Search the cookbook registry for existing debug recipes matching this issue:**

\\\`\\\`\\\`bash
# npm client (preferred)
npx @agent-cookbook/client discover "[bug/issue description]" --top-k=3

# HTTP fallback
curl -s "https://agent-cookbook.replit.app/discover?q=[bug/issue description]&top_k=3"
\\\`\\\`\\\`

**If matching recipes found:** Review steps for applicable fix patterns. Adapt proven approaches. Note recipe IDs for auto-receipt later.
**If no matches:** Proceed normally.

**REQUIRED OUTPUT:**
- Cookbook recipes found: _____ (0+ results)
- Applicable patterns: _____

---

### ⛔ CHECKPOINT 1: Analysis
**REQUIRED OUTPUT:**
- Initial findings summary
- Hypotheses list (numbered, prioritized)
- Evidence supporting each hypothesis

**USER GATE:** Use AskUserQuestion
- Question: "Analysis complete. Top hypothesis: [X]. Proceed to Investigation?"
- Options: ["Continue", "Revise hypotheses", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Diagnosis (BLOCKING GATE)
**REQUIRED OUTPUT:**
- Confirmed root cause: _____
- Evidence supporting diagnosis: _____
- Files/lines involved: _____

**BLOCKING RULE:**
NEVER proceed to Plan until:
- [ ] Root cause identified with high confidence
- [ ] Evidence documented
- [ ] User confirms diagnosis

**USER GATE:** Use AskUserQuestion
- Question: "Root cause confirmed: [X]. Proceed to Plan fix?"
- Options: ["Continue", "Investigate more", "Revise diagnosis"]

STOP and wait for user response.

---

### Phase 2: TDD-Swarm Fix

### ⛔ CHECKPOINT 3: Plan
**REQUIRED OUTPUT:**
- Fix architecture summary (3-5 bullets)
- Files to modify (list)
- Approach and rationale

**USER GATE:** Use AskUserQuestion
- Question: "Fix plan ready. Proceed to write regression tests?"
- Options: ["Continue", "Revise plan", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 4: Tests (BLOCKING GATE)
**REQUIRED OUTPUT:**
- Test file paths: _____
- Test count: _____ regression tests written
- Test run result: "All _____ tests FAIL (bug still exists)"

**BLOCKING RULE:**
NEVER proceed to Build until:
- [ ] All regression tests written
- [ ] All tests RUN and FAIL
- [ ] Failure output shows the bug being reproduced

**AUTO-PROCEED:** Continue to Build phase after tests fail.

---

### ⛔ CHECKPOINT 5: Build
**REQUIRED OUTPUT:**
- Implementation file paths: _____
- Test run result: "All _____ tests PASS"
- Bug confirmed fixed: yes/no

**AUTO-PROCEED:** Continue to Review phase.

---

### ⛔ CHECKPOINT 6: Review
**REQUIRED OUTPUT:**
| Category | Finding | Severity |
|----------|---------|----------|
| Security | _____ | _____ |
| Performance | _____ | _____ |
| Regressions | _____ | _____ |

**AUTO-PROCEED:** Continue to Compound phase.

---

### 🍳 CHECKPOINT 6.5: Agent Cookbook — Auto-Receipt
**Submit proof-of-execution to the cookbook registry.**

Check config: read ~/.agent-cookbook/config.json → auto_receipts section.
Skip if auto_receipts.enabled is false.

**Grade calculation:**
- correctness: 1.0 if bug fix verified and tests pass, 0.0 if not
- test_coverage: coverage percentage if available (0.0-1.0)

**Submit only if:** fix verified AND grade >= auto_receipts.min_grade (default: 0.8)

\\\`\\\`\\\`bash
# npm client (preferred)
npx @agent-cookbook/client submit-receipt --recipe-id=[id] --grade=[grade]

# HTTP fallback
curl -X POST https://agent-cookbook.replit.app/receipts \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"target_id":"[id]","target_type":"recipe","grade":[grade],"timestamp":"[now]"}'
\\\`\\\`\\\`

**REQUIRED OUTPUT:**
- Receipt submitted: yes/no/skipped
- Grade: _____
- Reason if skipped: _____

---

### ⛔ CHECKPOINT 7: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/debugging/_____
- Doc path: docs/solutions/debugging/_____.md
- Root cause documented: yes/no
- Fix pattern stored: yes/no

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
- [ ] Root cause confirmed before fix
- [ ] Regression tests written and initially failed
- [ ] All tests now pass
- [ ] No regressions introduced
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
\`\`\`
Memory: project/debugging/[issue-category]
Doc: docs/solutions/debugging/[issue-name].md
Pattern: root cause + regression tests + fix approach
\`\`\`

## Example
\`\`\`
/w-debug intermittent API timeouts in production
\`\`\`
`
    },

    'w-hotfix': {
      name: 'w-hotfix',
      description: 'Critical Hotfix - Isolated branch, minimal fix, security review',
      content: `# /w-hotfix

Critical Hotfix - Isolated branch → minimal fix → security-focused review → expedited PR.

## Usage
\`\`\`
/w-hotfix [issue description]
\`\`\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for similar incidents
2. Create isolated hotfix branch
3. Apply minimal targeted fix
4. Run security review
5. Compound incident documentation

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip security review - hotfixes MUST be security-reviewed
- NEVER skip compound phase at the end
- VIOLATION: Applying fix without isolated branch = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of similar incidents (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] similar incidents. Proceed to create hotfix branch?"
- Options: ["Proceed to Isolate", "Review existing incidents", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Branch Created
**REQUIRED OUTPUT:**
- Hotfix branch name: hotfix/_____
- Base branch: _____
- Branch creation confirmed: yes/no

**USER GATE:** Use AskUserQuestion
- Question: "Hotfix branch created: [branch]. Proceed to apply fix?"
- Options: ["Continue", "Revise branch", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Fix Applied
**REQUIRED OUTPUT:**
- Files modified: _____
- Changes summary (minimal): _____
- Test results: _____

**AUTO-PROCEED:** Continue to Security Review phase.

---

### ⛔ CHECKPOINT 3: Security Review (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
| Check | Status | Notes |
|-------|--------|-------|
| Input validation | _____ | _____ |
| Auth/authz | _____ | _____ |
| Data exposure | _____ | _____ |
| Injection risks | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Security review complete. Proceed to Compound?"
- Options: ["Continue", "Address security concerns", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 4: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/incidents/_____
- Doc path: docs/solutions/incidents/_____.md
- Incident documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] Checkpoints 0-1 completed with user confirmation
- [ ] Checkpoint 2 completed (auto-proceed)
- [ ] Checkpoints 3-4 completed with user confirmation
- [ ] Hotfix branch created and isolated
- [ ] Minimal fix applied
- [ ] Security review completed
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Incident doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
\`\`\`
Memory: project/incidents/[incident-type]
Doc: docs/solutions/incidents/[incident-name].md
\`\`\`

## Example
\`\`\`
/w-hotfix SQL injection vulnerability in search endpoint
\`\`\`
`
    },

    'w-review': {
      name: 'w-review',
      description: 'Full Review - 12+ specialized agents analyze code',
      content: `# /w-review

Full Review - 12+ specialized agents analyze code, security, performance, architecture.

## Usage
\`\`\`
/w-review [PR number or description]
\`\`\`

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
**REQUIRED OUTPUT:**
- List of past reviews (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past reviews for this area. Proceed to Code Analysis?"
- Options: ["Continue", "Review past findings first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Code Analysis
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
   - File exists: \`path/to/expected/file\`
   - Pattern match: \`"regex"\` in \`file\`
   - Test passes: \`npm test -- --grep "name"\`
   - Lint clean: \`npm run lint\`
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
\`\`\`
Memory: project/reviews/[pr-topic]
Doc: docs/solutions/reviews/[pr-number].md
\`\`\`

## Example
\`\`\`
/w-review PR 47
\`\`\`
`
    },

    'w-security': {
      name: 'w-security',
      description: 'Security Audit - OWASP top 10, auth/authz, data exposure',
      content: `# /w-security

Security Audit - OWASP top 10, auth/authz, data exposure analysis.

## Usage
\`\`\`
/w-security [target description]
\`\`\`

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
**REQUIRED OUTPUT:**
- List of past security findings (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past security findings. Proceed to Scan?"
- Options: ["Continue", "Review past findings first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Scan Complete
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
\`\`\`
Memory: project/security/[target-area]
Doc: docs/solutions/security/[audit-name].md
\`\`\`

## Example
\`\`\`
/w-security authentication module
\`\`\`
`
    },

    'w-perf': {
      name: 'w-perf',
      description: 'Performance Audit - Bottlenecks, N+1 queries, memory issues',
      content: `# /w-perf

Performance Audit - Bottlenecks, N+1 queries, memory issues, optimization opportunities.

## Usage
\`\`\`
/w-perf [target description]
\`\`\`

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
**REQUIRED OUTPUT:**
- List of past optimizations (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past performance patterns. Proceed to Profiling?"
- Options: ["Continue", "Review past optimizations first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Profiling Done
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
**REQUIRED OUTPUT:**
- Prioritized recommendations (by impact)
- Estimated improvement metrics
- Implementation suggestions

**AUTO-PROCEED:** Continue to Compound phase.

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
\`\`\`
Memory: project/performance/[target-area]
Doc: docs/solutions/performance/[audit-name].md
\`\`\`

## Example
\`\`\`
/w-perf dashboard loading
\`\`\`
`
    },

    'w-architect': {
      name: 'w-architect',
      description: 'Hive-Mind Architecture - Collective intelligence for complex design',
      content: `# /w-architect

Hive-Mind Architecture - Multiple agents collaborate with collective intelligence for complex design.

## Usage
\`\`\`
/w-architect [system description]
\`\`\`

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
\`\`\`
Memory: project/architecture/[system-name]
Doc: docs/solutions/architecture/[system-name]-adr.md
\`\`\`

## Example
\`\`\`
/w-architect microservices migration
\`\`\`
`
    },

    'w-multi-repo': {
      name: 'w-multi-repo',
      description: 'Multi-Repository - Coordinate changes across repos',
      content: `# /w-multi-repo

Multi-Repository - Coordinates changes across repos with dependency awareness.

## Usage
\`\`\`
/w-multi-repo [task description]
\`\`\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past multi-repo patterns
2. Analyze dependencies between repos
3. Plan change coordination order
4. Execute changes across repos
5. Compound coordination pattern

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip dependency analysis - order matters
- NEVER skip compound phase at the end
- VIOLATION: Executing changes without dependency map = risk

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of past multi-repo patterns (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past coordination patterns. Proceed to Analyze?"
- Options: ["Continue", "Review past patterns first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Repos Analyzed
**REQUIRED OUTPUT:**
- Dependency map:
| Repo | Depends On | Depended By |
|------|------------|-------------|
| _____ | _____ | _____ |

- Change order (critical): _____
- Risk assessment: _____

**USER GATE:** Use AskUserQuestion
- Question: "Dependency map ready. Change order: [X → Y → Z]. Proceed to Plan?"
- Options: ["Continue", "Revise order", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Changes Prepared
**REQUIRED OUTPUT:**
- Per-repo changes:
| Repo | Files | Changes |
|------|-------|---------|
| _____ | _____ | _____ |

- Rollback plan: _____

**USER GATE:** Use AskUserQuestion
- Question: "Changes prepared for [N] repos. Proceed to Execute?"
- Options: ["Continue", "Revise changes", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Sync Complete
**REQUIRED OUTPUT:**
- Repos updated: _____
- Verification status per repo: _____
- Any failures: _____

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 4: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/multi-repo/_____
- Doc path: docs/solutions/multi-repo/_____.md
- Pattern documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] Checkpoints 0-2 completed with user confirmation
- [ ] Checkpoints 3-4 completed (auto-proceed)
- [ ] Dependency map created
- [ ] Changes applied in correct order
- [ ] All repos verified
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Coordination doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
\`\`\`
Memory: project/multi-repo/[task-name]
Doc: docs/solutions/multi-repo/[task-name].md
\`\`\`

## Example
\`\`\`
/w-multi-repo updating shared auth library across all repos
\`\`\`
`
    },

    'w-compound': {
      name: 'w-compound',
      description: 'Compound This - Capture context + auto-generate diagnostic/fix candidates',
      content: `# /w-compound

Compound This - Captures current context as reusable knowledge AND auto-generates diagnostic/fix Ralph candidates for overnight verification.

## Usage
\`\`\`
/w-compound [category]
/w-compound feature
/w-compound bug
\`\`\`

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete ALL phases including auto-QA generation.

---

## Categories
- \`feature\` - Feature implementations
- \`bug\` - Bug fixes
- \`security\` - Security improvements
- \`performance\` - Performance optimizations
- \`architecture\` - Architecture decisions

## What Gets Stored
1. **Memory Key** - Searchable pattern reference
2. **Solution Doc** - Markdown documentation
3. **Diagnostic Candidates** - RC-D### to verify patterns exist
4. **Fix Candidates** - RC-F### to restore patterns if diagnostics fail

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Category Detection
**REQUIRED OUTPUT:**
- Category selected: _____
- Context to capture: _____

**AUTO-DETECT:** If argument provided, use it. Otherwise, auto-detect from git diff:
\\\`\\\`\\\`bash
git diff HEAD~1
\\\`\\\`\\\`
Use weighted pattern matching:
- security (weight 3): injection, vulnerability, sanitize, xss, csrf, auth
- bug (weight 2): fix, bug, patch, hotfix, error handling, fallback
- performance (weight 2): cache, optimize, batch, lazy, memoize, throttle
- architecture (weight 2): refactor, redesign, restructure, migration, rename
- feature (weight 1): export function, new file mode, CREATE TABLE, add/create/implement

Highest score wins. Default to 'feature' on empty diff.

**AUTO-PROCEED:** Continue to Storage phase.

---

### ⛔ CHECKPOINT 1: Storage Complete (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/[category]/_____
- Doc path: docs/solutions/[category]/_____.md
- Pattern stored: yes/no

**AUTO-PROCEED:** Continue to Analyze Changes phase.

---

### ⛔ CHECKPOINT 2: Analyze Changes (AUTO-PROCEED)
**Parse git diff to identify what was built:**

Run: \`git diff --name-only HEAD~1\` and \`git diff HEAD~1\`

**Categorize changes:**
| Change Type | Detection Method |
|-------------|------------------|
| New function | \`+ export function\` or \`+ function\` |
| New interface | \`+ export interface\` or \`+ interface\` |
| Pattern change | Significant line changes in existing files |
| Test added | Changes in \`*.test.*\` or \`*.spec.*\` files |
| Config change | Changes in config/settings files |

**REQUIRED OUTPUT:**
- Files changed: _____
- Functions added: _____
- Interfaces added: _____
- Patterns modified: _____
- Tests added: _____

**AUTO-PROCEED:** Continue to Generate Diagnostics phase.

---

### ⛔ CHECKPOINT 3: Generate Diagnostics (AUTO-PROCEED)
**For each significant change, create RC-D### diagnostic:**

**Diagnostic Template:**
| Change Type | Diagnostic Command | Pass Criteria |
|-------------|-------------------|---------------|
| Function added | \`grep -n "export function NAME" FILE\` | Match found |
| Interface added | \`grep -n "export interface NAME" FILE\` | Match found |
| Pattern exists | \`grep -rn "PATTERN" PATH\` | N matches found |
| Test passes | \`npm test -- --grep "NAME"\` | Exit code 0 |
| Pattern removed | \`grep -rn "OLD_PATTERN" PATH\` | 0 matches |

**For each diagnostic, generate:**
\`\`\`markdown
### RC-D###: [Name] Exists

**Auto-Generated From**: /w-compound on [DATE]
**Type**: Diagnostic
**Verifies**: [description]

**Test Command**:
\\\`\\\`\\\`bash
grep -n "[pattern]" [file]
\\\`\\\`\\\`

**AI-Verifiable Output**:
DIAGNOSTIC: [NAME]
PATTERN_FOUND: YES|NO
LOCATION: [file:line] or NONE
STATUS: PASS|FAIL

**Triggers**: RC-F### if STATUS: FAIL
**Priority**: P2
**Status**: ready
\`\`\`

**REQUIRED OUTPUT:**
- Diagnostics generated: _____ (list RC-D### IDs)

**AUTO-PROCEED:** Continue to Generate Fix Candidates phase.

---

### ⛔ CHECKPOINT 4: Generate Fix Candidates (AUTO-PROCEED)
**For each diagnostic, create paired RC-F### fix candidate:**

**For each fix, generate:**
\`\`\`markdown
### RC-F###: Restore [Name]

**Auto-Generated From**: /w-compound on [DATE]
**Type**: Conditional Fix
**Triggered By**: RC-D### failure
**Priority**: P1 (critical - restores functionality)

**Pattern to Restore**:
\\\`\\\`\\\`[language]
[actual code that was just written]
\\\`\\\`\\\`

**File**: [path/to/file]

**Completion Tests**:
1. Pattern: \`[pattern]\` exists in \`[file]\`
2. Test: RC-D### returns STATUS: PASS

**Status**: ready (only runs if RC-D### fails)
\`\`\`

**REQUIRED OUTPUT:**
- Fix candidates generated: _____ (list RC-F### IDs)
- Diagnostic → Fix pairs: RC-D001→RC-F001, etc.

**AUTO-PROCEED:** Continue to Append phase.

---

### ⛔ CHECKPOINT 5: Append to Ralph Candidates (AUTO-PROCEED)
**Add all generated candidates to .claude/ralph-candidates.md:**

1. Read current file to find highest RC-D### and RC-F### IDs
2. Assign sequential IDs to new candidates
3. Append to Active Diagnostics table
4. Append to Active Fixes table
5. Append full details to Diagnostic Details and Fix Details sections

**REQUIRED OUTPUT:**
- Candidates appended: _____
- New highest RC-D ID: RC-D___
- New highest RC-F ID: RC-F___
- File updated: .claude/ralph-candidates.md

**AUTO-PROCEED:** Continue to Ralph Candidate Check phase.

---

### ⛔ CHECKPOINT 6: Ralph Candidate Check (MANDATORY)
**Evaluate if this pattern could become a GENERAL Ralph loop (RC-###):**
- Is this a repeating dev pattern beyond just this session?
- Could it be templated for future similar work?

**If YES - Create General Ralph Candidate (RC-###):**
1. Read .claude/ralph-candidates.md for next available RC-### ID
2. Assign priority: P1/P2/P3
3. Define completion tests
4. Add to Active Candidates table

**REQUIRED OUTPUT:**
- General Ralph candidate identified: yes/no
- If yes: ID, priority, tests, status

NEVER skip this phase. Command is INCOMPLETE without all checks.

---

### 🍳 CHECKPOINT 7: Agent Cookbook — Auto-Recipe Extraction
**Detect if this work is recipe-worthy and submit to the registry.**

Check config: read ~/.agent-cookbook/config.json → auto_recipes section.
Skip if auto_recipes.enabled is false.

**Recipe-worthy criteria:**
- Workflow had >= auto_recipes.min_steps steps (default: 3)
- Has tests that pass (if auto_recipes.require_tests = true)
- Is a repeatable pattern (not a one-off fix)

**If recipe-worthy:**
1. Extract recipe: title, description, tags, ordered steps with inputs/outputs
2. If auto_recipes.confirm = true: ask user before submitting
3. Submit to registry:

\\\`\\\`\\\`bash
# npm client (preferred)
npx @agent-cookbook/client submit-recipe --title="[title]" --tags="[tags]"

# HTTP fallback
curl -X POST https://agent-cookbook.replit.app/recipes \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"title":"...","description":"...","tags":[...],"version":"1.0.0","steps":[...]}'
\\\`\\\`\\\`

**REQUIRED OUTPUT:**
- Recipe-worthy: yes/no
- Recipe submitted: yes/no/skipped
- Recipe ID: _____ (if submitted)
- Reason if skipped: _____

---

## Completion Checklist

- [ ] Category confirmed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Changes analyzed
- [ ] Diagnostics generated: RC-D___ to RC-D___
- [ ] Fixes generated: RC-F___ to RC-F___
- [ ] Candidates appended to .claude/ralph-candidates.md
- [ ] General Ralph candidate check completed

⚠️ Command INCOMPLETE until all boxes checked

## Output Summary
At completion, report:
\`\`\`
Compounded: [category] - [name]
Memory: project/[category]/[name]
Doc: docs/solutions/[category]/[name].md
Auto-generated: N diagnostic/fix pairs for overnight Ralph
  - RC-D001 → RC-F001: [description]
  - RC-D002 → RC-F002: [description]
Run /w-ralph-batch to process overnight.
\`\`\`

## Example
\`\`\`
/w-compound feature
# Stores to: project/features/[auto-named]
# Creates: docs/solutions/features/[name].md
# Generates: RC-D001→RC-F001, RC-D002→RC-F002 (auto QA pairs)
\`\`\`
`
    },

    'w-search': {
      name: 'w-search',
      description: 'Search Solutions - Find relevant past work',
      content: `# /w-search

Search Solutions - Searches memory and solution docs for relevant past work.

## Usage
\`\`\`
/w-search [query]
\`\`\`

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search Complete
**REQUIRED OUTPUT:**
- Results count: _____
- Ranked matches with dates:

| # | Memory Key | Date | Relevance |
|---|------------|------|-----------|
| 1 | _____ | _____ | _____ |
| 2 | _____ | _____ | _____ |

**USER GATE:** Use AskUserQuestion (if results found)
- Question: "Found [N] matches. View details for any?"
- Options: ["Show #1", "Show #2", "Show all", "Done"]

STOP and wait for user response.

---

## Memory Namespaces Searched
- \`project/features/*\`
- \`project/bugs/*\`
- \`project/security/*\`
- \`project/performance/*\`
- \`project/architecture/*\`
- \`project/reviews/*\`
- \`project/incidents/*\`
- \`project/implementations/*\`
- \`project/debugging/*\`
- \`project/ideas/*\`
- \`project/ralph-specs/*\`

## Example
\`\`\`
/w-search authentication issues
# Returns:
#   - project/bugs/auth-logout-reset (Dec 2024)
#   - project/features/oauth2-google (Nov 2024)
#   - project/security/auth-module (Oct 2024)
\`\`\`
`
    },

    'w-background-compound': {
      name: 'w-background-compound',
      description: 'Fire-and-Forget Compound - Zero-gate background compound',
      content: `# /w-background-compound

Fire-and-Forget Compound. Auto-detects category and dispatches to a background agent. No human interaction at any point.

## Usage
\\\`\\\`\\\`
/w-background-compound [category]
/w-background-compound feature
\\\`\\\`\\\`

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Pre-flight
- **Step 1:** Category detection (argument or auto-detect from git diff HEAD~1)
  - Use weighted pattern matching: security(3), bug(2), performance(2), architecture(2), feature(1)
  - Highest score wins. Default to 'feature' on empty diff.
- **Step 2:** Branch detection (current branch name)
- **Step 3:** Merge decision (auto-resolved based on branch)

**AUTO-PROCEED:** Continue to Background Dispatch.

---

### ⛔ CHECKPOINT 1: Background Dispatch
Launch a background agent via the Task tool that runs 4 phases autonomously:

**Phase 1: Inline Compound**
- Storage: memory key + solution doc
- Analyze: parse git diff for functions, interfaces, patterns, tests
- Diagnostics: generate RC-D### for each significant change
- Fixes: generate paired RC-F### for each diagnostic
- Append all to .claude/ralph-candidates.md
- Ralph candidate check

**Phase 1.5: Agent Cookbook — Auto-Recipe Extraction**
- Check ~/.agent-cookbook/config.json → auto_recipes section
- If auto_recipes.enabled = false: skip
- Detect if work is recipe-worthy (>= min_steps, has tests, repeatable pattern)
- If recipe-worthy: extract recipe (title, description, tags, steps)
- If auto_recipes.confirm = false OR background mode: auto-submit
- Submit via: \\\`npx @agent-cookbook/client submit-recipe\\\` or \\\`curl -X POST https://agent-cookbook.replit.app/recipes\\\`
- Log result (submitted/skipped/error)

**Phase 2: Git Commit**
- Stage specific changed files only (NOT git add -A)
- Commit with descriptive message

**Phase 3: Git Push/Merge**
- Push current branch
- If not main: merge to main and cleanup

**Phase 4: Final Summary Report**
- Log what was compounded, committed, and pushed

**ERROR HANDLING:** Log errors but NEVER abort. Complete as many phases as possible.

---

## Difference from /w-compound

| Aspect | /w-compound | /w-background-compound |
|--------|-------------|----------------------|
| User gates | 0 (auto-detect) | 0 |
| Auto-merge | No | Yes |
| Auto-push | No | Yes |
| Runs in | Foreground | Background agent |
| Error handling | May block | Logs, never aborts |

## Example
\\\`\\\`\\\`
/w-background-compound
/w-background-compound feature
\\\`\\\`\\\`
`
    },

    'w-start': {
      name: 'w-start',
      description: 'Cold-Start Session - Load project context when --resume unavailable',
      content: `# /w-start

Cold-start a session by loading project context from plan docs, memories, and git.

## Usage
\`\`\`
/w-start [plan-file]
\`\`\`

Default: MASTER_PLAN.md

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete all context loading steps. NEVER skip memory search.

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Context Loaded
**REQUIRED OUTPUT:**
- Plan file loaded: _____
- Memories found: _____ patterns
- Compound docs: _____ files
- Git status: branch _____, _____ uncommitted changes
- Recent commits: _____

**USER GATE:** Use AskUserQuestion
- Question: "Session initialized. What would you like to work on?"
- Options: ["Continue existing work", "Start new task", "Review context"]

STOP and wait for user response.

---

## Memory Sources
- **Claude-Flow**: project/features/*, project/bugs/*, project/implementations/*, etc.
- **Compound Engineering**: docs/solutions/ markdown files
- **Git**: Recent commits and current branch state

## Completion Checklist

- [ ] Plan file read (or default used)
- [ ] Memory search completed
- [ ] Compound docs scanned
- [ ] Git status checked
- [ ] Context summary presented

⚠️ Session NOT ready until all steps complete

## Example
\`\`\`
/w-start
/w-start ROADMAP.md
/w-start docs/SPRINT_PLAN.md
\`\`\`
`
    },

    'w-end': {
      name: 'w-end',
      description: 'End Session - Compound knowledge and commit for next /w-start',
      content: `# /w-end

Gracefully end a session by compounding knowledge and committing work.

## Usage
\`\`\`
/w-end
/w-end [category]
\`\`\`

Categories: feature, bug, security, performance, architecture, debug

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete all steps. NEVER skip compound or commit.

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Summary
**REQUIRED OUTPUT:**
- Work accomplished: _____
- Files modified: _____
- Tests added/changed: _____
- Key decisions: _____

**USER GATE:** Use AskUserQuestion
- Question: "Session summary ready. Proceed to Compound?"
- Options: ["Continue", "Add more details"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/[category]/_____
- Doc path: docs/solutions/[category]/_____.md
- Patterns captured: _____

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

**AUTO-PROCEED:** Continue to Commit phase.

---

### ⛔ CHECKPOINT 2: Commit (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Commit message: _____
- Files staged: _____
- Commit hash: _____

**USER GATE:** Use AskUserQuestion
- Question: "Commit complete. Session ended. Run /w-start to resume later."
- Options: ["Done", "Push to remote"]

STOP and wait for user response.

---

## What Gets Captured
- Problems solved and approaches used
- Key decisions made
- Patterns discovered
- Files modified
- Tests added/changed

## Completion Checklist

- [ ] Checkpoint 0 completed with user confirmation
- [ ] Checkpoint 1 completed (auto-proceed)
- [ ] Checkpoint 2 completed with user confirmation
- [ ] Session summary created
- [ ] Compound phase completed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Changes committed
- [ ] Ralph candidate check completed

⚠️ Session NOT properly ended until all steps complete

## Example
\`\`\`
/w-end
/w-end feature
/w-end bug
\`\`\`

## Next Session
Run \\\`/w-start\\\` to load this session's context and continue where you left off.
`
    },

    'w-ralph-init': {
      name: 'w-ralph-init',
      description: 'Initialize Pure Ralph - Set up Ralph loop structure in current project',
      content: `# /w-ralph-init

Initialize Pure Ralph structure in the current project. Sets up the bash loop orchestrator and template files.

## What is Pure Ralph?

Pure Ralph is the bash loop approach to AI development:
- **Fresh context each iteration** - No context pollution
- **State through files** - IMPLEMENTATION_PLAN.md is the source of truth
- **External orchestration** - Bash loop controls iteration
- **Backpressure via tests** - Bad work gets rejected automatically

## Usage
\`\`\`
/w-ralph-init
/w-ralph-init --customize
\`\`\`

---

## ⚠️ MANDATORY EXECUTION

This command sets up the Pure Ralph structure. Execute ALL steps.

---

## What Gets Created

\`\`\`
.claude/ralph/
├── loop.sh              # Bash orchestrator (run this!)
├── PROMPT_plan.md       # Planning mode prompt
├── PROMPT_build.md      # Building mode prompt
├── AGENTS.md            # Validation commands (customize this!)
└── IMPLEMENTATION_PLAN.md  # Task tracking (shared state)

specs/
└── .gitkeep             # Place spec files here
\`\`\`

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Verify Structure
**Check if Ralph files already exist:**

\`\`\`bash
ls -la .claude/ralph/
\`\`\`

**REQUIRED OUTPUT:**
- Ralph directory exists: yes/no
- Files present: _____

**If exists:**
**USER GATE:** Use AskUserQuestion
- Question: "Ralph structure exists. Overwrite?"
- Options: ["Overwrite all", "Keep existing", "Merge (keep customizations)"]

**If not exists:**
**AUTO-PROCEED:** Create structure.

---

### ⛔ CHECKPOINT 1: Create/Update Structure
**Create directories:**
\`\`\`bash
mkdir -p .claude/ralph specs .claude/plans
\`\`\`

**Copy template files from installation or create defaults.**

**REQUIRED OUTPUT:**
- Directories created: .claude/ralph/, specs/, .claude/plans/
- Files created: loop.sh, PROMPT_*.md, AGENTS.md, IMPLEMENTATION_PLAN.md
- loop.sh made executable: yes/no

---

### ⛔ CHECKPOINT 2: Customize AGENTS.md
**Detect project type and customize validation commands:**

| Project Type | Detection | Commands |
|--------------|-----------|----------|
| Node.js | package.json | npm test, npm run build |
| Python | pyproject.toml/setup.py | pytest, mypy |
| Go | go.mod | go test, go build |
| Rust | Cargo.toml | cargo test, cargo build |

**USER GATE:** Use AskUserQuestion
- Question: "Detected [project type]. Customize AGENTS.md commands?"
- Options: ["Auto-configure", "Manual edit", "Skip customization"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Setup Complete
**REQUIRED OUTPUT:**
\`\`\`
Pure Ralph initialized!

Structure created:
  .claude/ralph/loop.sh (executable)
  .claude/ralph/PROMPT_build.md
  .claude/ralph/PROMPT_plan.md
  .claude/ralph/AGENTS.md
  .claude/ralph/IMPLEMENTATION_PLAN.md
  specs/

To start a Ralph loop:
  1. Add tasks to .claude/ralph/IMPLEMENTATION_PLAN.md
  2. Run: ./.claude/ralph/loop.sh

Modes:
  ./.claude/ralph/loop.sh build    # Build mode (default)
  ./.claude/ralph/loop.sh plan     # Planning mode
  ./.claude/ralph/loop.sh build 50 # Max 50 iterations
\`\`\`

---

## Completion Checklist

- [ ] Ralph directory created: .claude/ralph/
- [ ] loop.sh created and executable
- [ ] PROMPT_build.md created
- [ ] PROMPT_plan.md created
- [ ] AGENTS.md created (and customized if requested)
- [ ] IMPLEMENTATION_PLAN.md created
- [ ] specs/ directory created
- [ ] User informed of next steps

⚠️ Command INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-ralph-init
# Creates Pure Ralph structure

# Then start your loop:
./.claude/ralph/loop.sh
\`\`\`
`
    },

    'w-ralph-this': {
      name: 'w-ralph-this',
      description: 'Ralph This - Convert a task into Pure Ralph loop execution',
      content: `# /w-ralph-this

Convert a task description into a Pure Ralph loop. Creates IMPLEMENTATION_PLAN.md and outputs the command to run.

## What is Pure Ralph?

Pure Ralph uses a bash loop for fresh context each iteration:
- Each iteration reads IMPLEMENTATION_PLAN.md
- Picks ONE task, completes it, marks done
- Commits changes, exits
- Bash loop restarts with fresh context

**Key difference from plugin-style:** Context doesn't accumulate. State passes through files only.

## Usage
\`\`\`
/w-ralph-this [task description]
/w-ralph-this Build a REST API with CRUD endpoints and tests
/w-ralph-this .claude/plans/feature-spec.md
\`\`\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Parse task/spec into atomic tasks
2. Create/update IMPLEMENTATION_PLAN.md
3. Customize AGENTS.md if needed
4. Output run command
5. (Optional) Execute loop

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER run the loop internally - output the bash command
- ALWAYS break tasks into atomic, one-iteration steps
- ALWAYS include verification for each task
- NEVER skip IMPLEMENTATION_PLAN.md creation

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Parse Task
**Read input (inline or file) and analyze:**

**REQUIRED OUTPUT:**
- Input type: inline/file
- Task summary: _____
- Complexity estimate: simple/medium/complex
- Estimated tasks: N atomic tasks

**USER GATE:** Use AskUserQuestion
- Question: "Task: [summary]. ~[N] atomic tasks. Proceed to plan?"
- Options: ["Create plan", "Refine scope", "Show task breakdown"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Create Implementation Plan
**Break into atomic tasks (one per iteration):**

**Write to .claude/ralph/IMPLEMENTATION_PLAN.md:**
\`\`\`markdown
# Implementation Plan

## Status
- Total tasks: N
- Completed: 0
- In Progress: 0
- Remaining: N

## Tasks

### Phase 1: Foundation
- [ ] Task 1 description
  - Verify: [command or check]
- [ ] Task 2 description
  - Verify: [command or check]

### Phase 2: Core Implementation
- [ ] Task 3 description
...

## Discoveries

<!-- Learnings will be captured here during execution -->
\`\`\`

**REQUIRED OUTPUT:**
- Plan file: .claude/ralph/IMPLEMENTATION_PLAN.md
- Total tasks: N
- Phases: _____

**AUTO-PROCEED:** Continue to AGENTS.md check.

---

### ⛔ CHECKPOINT 2: Verify AGENTS.md
**Check AGENTS.md has correct validation commands:**

**REQUIRED OUTPUT:**
- AGENTS.md exists: yes/no
- Build command: _____
- Test command: _____
- Lint command: _____

**If commands need updating:**
**USER GATE:** Use AskUserQuestion
- Question: "Update AGENTS.md validation commands?"
- Options: ["Auto-detect", "Manual edit", "Keep current"]

STOP and wait for user response if changes needed.

---

### ⛔ CHECKPOINT 3: Output Run Command

**REQUIRED OUTPUT:**
\`\`\`
╔════════════════════════════════════════════════════╗
║  Pure Ralph Ready!                                 ║
╠════════════════════════════════════════════════════╣
║  Plan: .claude/ralph/IMPLEMENTATION_PLAN.md        ║
║  Tasks: N tasks in M phases                        ║
╠════════════════════════════════════════════════════╣
║  To start the loop:                                ║
║                                                    ║
║    ./.claude/ralph/loop.sh                         ║
║                                                    ║
║  Options:                                          ║
║    ./.claude/ralph/loop.sh build 50   # Max 50    ║
║    ./.claude/ralph/loop.sh plan       # Plan mode ║
╚════════════════════════════════════════════════════╝
\`\`\`

**USER GATE:** Use AskUserQuestion
- Question: "Plan created. Start loop now or run manually later?"
- Options: ["Run now (will exit session)", "Run manually later", "Show plan"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 4: Execute (if requested)
**If user chose "Run now":**

Inform user:
\`\`\`
Starting Pure Ralph loop...
This session will end. The bash loop will orchestrate fresh Claude instances.
Run this command in your terminal:

  ./.claude/ralph/loop.sh

Or for verbose output:
  ./.claude/ralph/loop.sh build 999 --verbose
\`\`\`

**Do NOT attempt to run loop internally.**

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Task parsed and understood
- [ ] IMPLEMENTATION_PLAN.md created with atomic tasks
- [ ] AGENTS.md verified/updated
- [ ] Run command provided to user
- [ ] User informed of execution options

⚠️ Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-ralph-this Build authentication with JWT tokens

# Creates plan with tasks like:
# - [ ] Create auth types in src/types/auth.ts
# - [ ] Implement JWT utilities in src/lib/jwt.ts
# - [ ] Add login endpoint
# - [ ] Add refresh endpoint
# - [ ] Add auth middleware
# - [ ] Write tests for auth flow

# Then user runs:
./.claude/ralph/loop.sh
\`\`\`
`
    },

    'w-ralph-goals': {
      name: 'w-ralph-goals',
      description: 'Ralph Goals - Interview to build IMPLEMENTATION_PLAN.md and specs',
      content: `# /w-ralph-goals

Build a complete Pure Ralph setup from a rough idea through interactive interview.

## What This Does

1. **Interviews you** to understand the idea deeply
2. **Creates IMPLEMENTATION_PLAN.md** with atomic tasks
3. **Generates spec files** in specs/ directory
4. **Configures AGENTS.md** for your project
5. **Outputs the run command**

## Usage
\`\`\`
/w-ralph-goals [rough idea]
/w-ralph-goals I want to build a CLI tool
/w-ralph-goals create a REST API with authentication
\`\`\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Capture and clarify initial idea
2. Interview for acceptance criteria
3. Interview for architecture decisions
4. Interview for verification approach
5. Generate IMPLEMENTATION_PLAN.md
6. Generate spec files
7. Configure AGENTS.md
8. Output run command

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip interview questions - each is critical
- NEVER skip checkpoints - each requires user confirmation
- Ask ONE question at a time using AskUserQuestion
- Generate ATOMIC tasks (one per Ralph iteration)

---

## Interview Categories

**Acceptance Criteria**
- What does "done" look like?
- How will we verify each feature works?

**Architecture & Approach**
- What's the high-level design?
- What files/modules need to be created?
- What dependencies are needed?

**Verification**
- What test framework to use?
- What commands validate success?
- What's the build command?

**Scope & Safety**
- What's explicitly OUT of scope?
- Are there any risky operations to avoid?

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Idea Captured
**REQUIRED OUTPUT:**
- Initial idea: _____
- Context needed: _____

**USER GATE:** Use AskUserQuestion
- Question: "What does 'done' look like for [idea]? What's the acceptance criteria?"
- Options: (free text via "Other")

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Requirements Clear
**Continue interviewing (one question at a time):**
- Architecture approach
- Key components needed
- Testing strategy
- Dependencies

**REQUIRED OUTPUT:**
- Acceptance criteria: _____
- Architecture summary: _____
- Key components: _____
- Test approach: _____
- Dependencies: _____

**USER GATE:** Use AskUserQuestion
- Question: "Requirements captured. Proceed to generate plan?"
- Options: ["Generate plan", "Add more details", "Show summary"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Generate IMPLEMENTATION_PLAN.md
**Create atomic tasks (ONE task = ONE Ralph iteration):**

**Write to .claude/ralph/IMPLEMENTATION_PLAN.md:**
\`\`\`markdown
# Implementation Plan: [Name]

## Status
- Total tasks: N
- Completed: 0
- In Progress: 0
- Remaining: N

## Acceptance Criteria
[From interview]

## Tasks

### Phase 1: Setup
- [ ] Task 1
  - Verify: [command]
- [ ] Task 2
  - Verify: [command]

### Phase 2: Core
- [ ] Task 3
...

### Phase N: Polish
- [ ] Final task
  - Verify: All tests pass, build succeeds

## Discoveries

<!-- Will be populated during execution -->
\`\`\`

**REQUIRED OUTPUT:**
- Plan file created: .claude/ralph/IMPLEMENTATION_PLAN.md
- Total tasks: N
- Phases: M

**AUTO-PROCEED:** Continue to spec generation.

---

### ⛔ CHECKPOINT 3: Generate Spec Files
**Create detailed specs in specs/ directory:**

For each major component/feature:
\`\`\`markdown
# Spec: [Component Name]

## Purpose
[What this component does]

## Interface
[API/function signatures]

## Behavior
[Expected behavior, edge cases]

## Tests
[Test cases to implement]
\`\`\`

**REQUIRED OUTPUT:**
- Spec files created: specs/*.md
- Components covered: _____

**AUTO-PROCEED:** Continue to AGENTS.md.

---

### ⛔ CHECKPOINT 4: Configure AGENTS.md
**Detect project type and configure validation:**

**Update .claude/ralph/AGENTS.md with:**
- Build command
- Test command
- Lint command
- Type check command (if applicable)

**USER GATE:** Use AskUserQuestion
- Question: "AGENTS.md configured for [project type]. Review commands?"
- Options: ["Looks good", "Edit commands", "Show AGENTS.md"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 5: Output Run Command
**REQUIRED OUTPUT:**
\`\`\`
╔════════════════════════════════════════════════════════════╗
║  Pure Ralph Setup Complete!                                 ║
╠════════════════════════════════════════════════════════════╣
║  Plan: .claude/ralph/IMPLEMENTATION_PLAN.md                 ║
║  Tasks: N tasks in M phases                                 ║
║  Specs: K spec files in specs/                              ║
╠════════════════════════════════════════════════════════════╣
║  To start the loop:                                         ║
║                                                             ║
║    ./.claude/ralph/loop.sh                                  ║
║                                                             ║
╚════════════════════════════════════════════════════════════╝
\`\`\`

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Interview completed (all key questions answered)
- [ ] IMPLEMENTATION_PLAN.md created with atomic tasks
- [ ] Spec files created in specs/
- [ ] AGENTS.md configured
- [ ] Run command provided to user

⚠️ Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-ralph-goals I want to build a markdown-to-HTML converter CLI

# Interview extracts:
# - Should support GitHub-flavored markdown
# - CLI interface with --input and --output flags
# - Tests with Jest
# - TypeScript project

# Generates:
# - .claude/ralph/IMPLEMENTATION_PLAN.md (12 tasks)
# - specs/cli-interface.md
# - specs/markdown-parser.md
# - specs/html-output.md
# - Configured AGENTS.md
\`\`\`
`
    },

    'w-ralph-pick': {
      name: 'w-ralph-pick',
      description: 'Ralph Pick - Select and execute a Ralph candidate from the queue',
      content: `# /w-ralph-pick

Select and execute a Ralph candidate from .claude/ralph-candidates.md.

## Usage
\`\`\`
/w-ralph-pick
/w-ralph-pick RC-001
/w-ralph-pick --priority P1
\`\`\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load candidates from .claude/ralph-candidates.md
2. Select candidate (user choice or by ID/priority)
3. Verify completion tests are valid
4. Execute Ralph loop
5. Verify completion
6. Update candidate status

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER execute without valid completion tests
- NEVER mark complete without passing all completion tests
- ALWAYS update candidate status in .claude/ralph-candidates.md

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Load Candidates
**REQUIRED OUTPUT:**
- Candidates file: .claude/ralph-candidates.md
- Total candidates: _____
- Ready candidates: _____
- By priority:
  | Priority | Count | IDs |
  |----------|-------|-----|
  | P1 | _____ | _____ |
  | P2 | _____ | _____ |
  | P3 | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] ready candidates. Which to execute?"
- Options: [List candidate IDs with names, e.g., "RC-001: API endpoint tests"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Candidate Selected
**REQUIRED OUTPUT:**
- Selected ID: RC-___
- Name: _____
- Priority: P_
- Source workflow: _____
- Pattern description: _____

**Completion Tests:**
| # | Type | Test | Current Status |
|---|------|------|----------------|
| 1 | _____ | _____ | pending |
| 2 | _____ | _____ | pending |

**USER GATE:** Use AskUserQuestion
- Question: "RC-[N]: [Name]. [X] completion tests. Verify tests are valid?"
- Options: ["Verify tests", "Edit tests", "Choose different candidate"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Tests Verified
**Run each completion test to establish baseline:**

| # | Test | Initial Result | Expected After |
|---|------|----------------|----------------|
| 1 | _____ | FAIL/PASS | PASS |
| 2 | _____ | FAIL/PASS | PASS |

**BLOCKING RULE:**
For TDD-style candidates, tests SHOULD fail initially.
For existing code candidates, some tests may already pass.

**USER GATE:** Use AskUserQuestion
- Question: "Baseline established. [X/Y] tests currently fail. Start Ralph loop?"
- Options: ["Start loop", "Revise tests", "Cancel"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Ralph Loop Execution
**Update candidate status to: in-progress**

Execute the Ralph loop with the candidate spec:
- Max iterations: 50 (or candidate-specified)
- Completion: All tests pass

**Per-iteration tracking:**
- Iteration #: _____
- Tests passing: X/Y
- Progress: _____

**AUTO-PROCEED:** Continue iterations until all tests pass or max reached.

---

### ⛔ CHECKPOINT 4: Completion Verification
**Run ALL completion tests:**

| # | Test | Result |
|---|------|--------|
| 1 | _____ | PASS/FAIL |
| 2 | _____ | PASS/FAIL |

**REQUIRED OUTPUT:**
- All tests pass: yes/no
- Total iterations: _____
- If failed: which tests still failing

**If ALL tests PASS:**
- Update candidate status to: complete
- Add completion date
- Move to Archived section in .claude/ralph-candidates.md

**If ANY test FAILS:**
- Keep status: in-progress
- Log progress for next attempt

**USER GATE:** Use AskUserQuestion
- Question: "[All pass: Complete! / Some fail: Partial progress]. Update candidate status?"
- Options: ["Mark complete", "Keep in-progress", "Mark as blocked"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 5: Candidate Updated
**REQUIRED OUTPUT:**
- Candidate ID: RC-___
- Final status: complete/in-progress/blocked
- Updated in .claude/ralph-candidates.md: yes/no
- If complete: moved to Archived section: yes/no

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 6 phases
- [ ] Checkpoints 0-2 completed with user confirmation
- [ ] Checkpoints 3-5 completed
- [ ] Candidate selected and verified
- [ ] Ralph loop executed
- [ ] All completion tests evaluated
- [ ] Candidate status updated in .claude/ralph-candidates.md
- [ ] If complete: candidate archived

⚠️ Workflow INCOMPLETE until all boxes checked

## Candidate Statuses
- **draft**: Needs refinement before execution
- **ready**: Can be executed
- **in-progress**: Currently being worked on
- **complete**: All tests pass, archived
- **blocked**: Cannot proceed, needs intervention

## Example
\`\`\`
/w-ralph-pick
/w-ralph-pick RC-003
/w-ralph-pick --priority P1
\`\`\`
`
    },

    'w-ralph-batch': {
      name: 'w-ralph-batch',
      description: 'Ralph Batch - Generate overnight bash scripts for multiple projects',
      content: `# /w-ralph-batch

Generate overnight bash scripts that run Pure Ralph loops on multiple projects or candidates.

## What This Does

Uses the **Pure Ralph bash loop approach** for batch processing:
- Each candidate/project gets its own Ralph loop
- Scripts use \`.claude/ralph/loop.sh\` for execution
- Fresh context for every iteration
- State persisted through IMPLEMENTATION_PLAN.md files

## Usage
\`\`\`
/w-ralph-batch                    # Interactive mode
/w-ralph-batch --script           # Generate overnight-ralph.sh
/w-ralph-batch --multi-project    # Multiple project directories
/w-ralph-batch --diagnostics      # Run diagnostics from ralph-candidates.md
\`\`\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Scan for candidates/projects
2. Configure batch parameters
3. Generate overnight script
4. Output execution instructions

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Batch Modes

| Mode | Description | Output |
|------|-------------|--------|
| Script | Generate overnight bash script | overnight-ralph.sh |
| Multi-project | Batch multiple project dirs | overnight-multi.sh |
| Diagnostics | Process ralph-candidates.md | overnight-diagnostics.sh |
| Interactive | Select and configure interactively | User choice |

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Scan Candidates
**Check for Ralph candidates and projects:**

\`\`\`bash
# Check for candidates file
cat .claude/ralph-candidates.md

# Check for Ralph setup in current project
ls -la .claude/ralph/

# Check for multi-project config
ls ../*/.claude/ralph/ 2>/dev/null
\`\`\`

**REQUIRED OUTPUT:**
- Candidates file exists: yes/no
- Ready candidates: N (RC-### IDs)
- Ready diagnostics: N (RC-D### IDs)
- Ralph setup in current project: yes/no
- Other projects with Ralph: [list paths]

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] candidates, [M] diagnostics, [P] projects. Select mode:"
- Options: ["Generate overnight script", "Multi-project batch", "Diagnostics only", "Interactive"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Configure Batch

**For Overnight Script:**
\`\`\`
Max iterations per candidate: 50 (default)
Stop on first failure: no (default)
Log to file: yes (default)
Notification on complete: no (default)
\`\`\`

**For Multi-Project:**
\`\`\`
Projects to include: [list]
Order: sequential/parallel
Shared log file: yes/no
\`\`\`

**For Diagnostics:**
\`\`\`
Run fixes on failure: yes (default)
Re-verify after fix: yes (default)
\`\`\`

**USER GATE:** Use AskUserQuestion
- Question: "Configuration ready. Generate script?"
- Options: ["Generate", "Adjust settings", "Add more projects"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Generate Script

**Generate overnight-ralph.sh:**
\`\`\`bash
#!/bin/bash
# Pure Ralph Batch - Generated [DATE]
#
# This script runs Pure Ralph loops on multiple candidates/projects.
# Each loop gets FRESH CONTEXT - no accumulation.

set -e
LOG_FILE="ralph-batch-$(date +%Y%m%d-%H%M%S).log"

log() {
  echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "╔════════════════════════════════════════════════╗"
log "║  Pure Ralph Batch Starting                      ║"
log "║  Candidates: [N]                                ║"
log "║  Log: $LOG_FILE                                 ║"
log "╚════════════════════════════════════════════════╝"

#───────────────────────────────────────────────────────
# Candidate: RC-001 - [Name]
#───────────────────────────────────────────────────────
log ""
log "Processing RC-001: [Name]..."

# Create/update IMPLEMENTATION_PLAN.md for this candidate
cat > .claude/ralph/IMPLEMENTATION_PLAN.md << 'PLAN_EOF'
# Implementation Plan: RC-001

## Status
- Total tasks: N
- Completed: 0
- Remaining: N

## Tasks
- [ ] Task 1
- [ ] Task 2
...

## Discoveries
PLAN_EOF

# Run the Pure Ralph loop
./.claude/ralph/loop.sh build 50

log "RC-001 complete: $(date)"

#───────────────────────────────────────────────────────
# Candidate: RC-002 - [Name]
#───────────────────────────────────────────────────────
log ""
log "Processing RC-002: [Name]..."

# [Similar pattern for each candidate]

log ""
log "╔════════════════════════════════════════════════╗"
log "║  Pure Ralph Batch Complete!                     ║"
log "║  End time: $(date)                              ║"
log "║  Log: $LOG_FILE                                 ║"
log "╚════════════════════════════════════════════════╝"
\`\`\`

**For Multi-Project Script:**
\`\`\`bash
#!/bin/bash
# Pure Ralph Multi-Project Batch

PROJECTS=(
  "/path/to/project1"
  "/path/to/project2"
)

for project in "\${PROJECTS[@]}"; do
  echo "═══ Processing: $project ═══"
  cd "$project"

  if [[ -f ".claude/ralph/loop.sh" ]]; then
    ./.claude/ralph/loop.sh build 50
  else
    echo "Warning: No Ralph setup in $project"
  fi
done
\`\`\`

**For Diagnostics Script:**
\`\`\`bash
#!/bin/bash
# Pure Ralph Diagnostics

run_diagnostic() {
  local id="$1"
  local cmd="$2"
  local fix_id="$3"

  echo "DIAGNOSTIC: $id"
  if eval "$cmd"; then
    echo "STATUS: PASS"
    echo "ACTION: VERIFIED"
  else
    echo "STATUS: FAIL"
    if [[ -n "$fix_id" ]]; then
      echo "Running fix: $fix_id"
      # Run fix via Ralph loop
      ./.claude/ralph/loop.sh build 10
      # Re-verify
      if eval "$cmd"; then
        echo "ACTION: RESTORED"
      else
        echo "ACTION: FAILED"
      fi
    fi
  fi
}

# RC-D001: [Name] Exists
run_diagnostic "RC-D001" "grep -q 'pattern' file.ts" "RC-F001"
\`\`\`

**Make executable:**
\`\`\`bash
chmod +x overnight-ralph.sh
\`\`\`

**REQUIRED OUTPUT:**
- Script path: ./overnight-ralph.sh
- Candidates included: [list]
- Executable: yes

---

### ⛔ CHECKPOINT 3: Output Instructions

**REQUIRED OUTPUT:**
\`\`\`
╔════════════════════════════════════════════════════════════╗
║  Overnight Script Generated!                                ║
╠════════════════════════════════════════════════════════════╣
║  Script: ./overnight-ralph.sh                               ║
║  Candidates: [N]                                            ║
║  Max iterations per candidate: 50                           ║
╠════════════════════════════════════════════════════════════╣
║  To run overnight:                                          ║
║                                                             ║
║    nohup ./overnight-ralph.sh > overnight.log 2>&1 &        ║
║                                                             ║
║  Or with screen:                                            ║
║    screen -S ralph ./overnight-ralph.sh                     ║
║                                                             ║
║  Check progress:                                            ║
║    tail -f ralph-batch-*.log                                ║
╚════════════════════════════════════════════════════════════╝
\`\`\`

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Candidates/projects scanned
- [ ] Batch parameters configured
- [ ] overnight-ralph.sh generated
- [ ] Script made executable
- [ ] Run instructions provided

⚠️ Workflow INCOMPLETE until all boxes checked

## Best Practices

**For Overnight Runs:**
1. Generate script: \`/w-ralph-batch --script\`
2. Review the generated script
3. Run with nohup or screen:
   \`\`\`bash
   nohup ./overnight-ralph.sh > overnight.log 2>&1 &
   \`\`\`
4. Check logs in morning: \`tail -f ralph-batch-*.log\`

**Key Principle:** The script runs \`loop.sh\` which gives each iteration fresh context. Bad work gets rejected by tests. Good work accumulates in git.

## Example
\`\`\`
/w-ralph-batch --script
# Generates overnight-ralph.sh for all ready candidates

./overnight-ralph.sh
# Runs all Ralph loops sequentially
# Each iteration: fresh context, one task, commit, exit
\`\`\`
`
    }
  };
}

/**
 * Get plugin namespace
 */
export function getNamespace() {
  return 'dot-shortcuts';
}

/**
 * Install dot shortcuts plugin
 */
export async function install(claudeDir, options = {}) {
  const commandsDir = path.join(claudeDir, 'commands', '.shortcuts');

  // Ensure directory exists
  await fs.mkdir(commandsDir, { recursive: true });

  // Write command files
  const commands = getCommands();
  for (const [name, command] of Object.entries(commands)) {
    const filePath = path.join(commandsDir, `${name}.md`);

    if (!options.dryRun) {
      await fs.writeFile(filePath, command.content, 'utf-8');
    }
  }

  return {
    plugin: 'dot-shortcuts',
    namespace: getNamespace(),
    commands: Object.keys(commands)
  };
}

/**
 * Uninstall dot shortcuts plugin
 */
export async function uninstall(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands', '.shortcuts');

  try {
    await fs.rm(commandsDir, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

/**
 * Check if dot shortcuts are installed
 */
export async function isInstalled(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands', '.shortcuts');

  try {
    const files = await fs.readdir(commandsDir);
    return files.length > 0;
  } catch {
    return false;
  }
}

export default {
  getCommands,
  getNamespace,
  install,
  uninstall,
  isInstalled
};
