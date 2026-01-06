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
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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

**USER GATE:** Use AskUserQuestion
- Question: "Spec ready. Proceed to Tests?"
- Options: ["Continue", "Revise spec"]

STOP and wait for user response.

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

### ⛔ CHECKPOINT 6: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/full-tdd-swarm/_____
- Doc path: docs/solutions/full-tdd-swarm/_____.md
- Pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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

    'w-idea-tdd-swarm': {
      name: 'w-idea-tdd-swarm',
      description: 'Idea to TDD Swarm - Deep interview refines idea, then Full TDD Swarm builds it',
      content: `# /w-idea-tdd-swarm

Turn a half-baked idea into a well-built feature through deep interviewing + Full TDD Swarm.

## Usage
\`\`\`
/w-idea-tdd-swarm [description or file path]
/w-idea-tdd-swarm user authentication system
/w-idea-tdd-swarm .claude/plans/auth-idea.md
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

**USER GATE:** Use AskUserQuestion
- Question: "Spec ready. Proceed to Tests?"
- Options: ["Continue", "Revise spec"]

STOP and wait for user response.

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
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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
/w-idea-tdd-swarm I want some kind of notification system but I'm not sure exactly what
\`\`\`
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
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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

### ⛔ CHECKPOINT 7: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/debugging/_____
- Doc path: docs/solutions/debugging/_____.md
- Root cause documented: yes/no
- Fix pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 4: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/reviews/_____
- Doc path: docs/solutions/reviews/_____.md
- All findings documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 6 phases
- [ ] Checkpoint 0 completed with user confirmation
- [ ] Checkpoints 1-4 completed (auto-proceed)
- [ ] Code analysis completed
- [ ] Security scan completed
- [ ] Performance check completed
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
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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
      description: 'Compound This - Capture current context as reusable knowledge',
      content: `# /w-compound

Compound This - Captures current context as reusable knowledge (ad-hoc).

## Usage
\`\`\`
/w-compound [category]
\`\`\`

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete fully. NEVER skip the storage step.

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
3. **Neural Pattern** - Learned behavior for similar problems

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Category Selection
**REQUIRED OUTPUT:**
- Category selected: _____
- Context to capture: _____

**USER GATE:** Use AskUserQuestion
- Question: "Storing as [category]. Confirm?"
- Options: ["Continue", "Change category"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Storage Complete (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/[category]/_____
- Doc path: docs/solutions/[category]/_____.md
- Pattern stored: yes/no

NEVER skip this phase. Command is INCOMPLETE without storage.

---

## Completion Checklist

- [ ] Category confirmed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____

⚠️ Command INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-compound feature
# Stores to: project/features/[auto-named]
# Creates: docs/solutions/features/[name].md
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
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

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

    'w-ralph-this': {
      name: 'w-ralph-this',
      description: 'Ralph Wiggum Loop - Iteratively execute a prompt until completion',
      content: `# /w-ralph-this

Ralph Wiggum Loop - Iteratively feed a prompt to Claude until a completion signal is detected.

## What is Ralph Wiggum?

An iterative AI development methodology - a "simple while loop that repeatedly feeds an AI agent a prompt until completion."

## Usage
\`\`\`
/w-ralph-this [prompt or file path]
/w-ralph-this "Build a REST API with full test coverage"
/w-ralph-this .claude/plans/api-spec.md
\`\`\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load and validate prompt
2. Configure iteration parameters
3. Execute loop (track each iteration)
4. Compound successful pattern

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER exceed max iterations without user confirmation
- NEVER skip compound phase at the end
- VIOLATION: Running without completion promise = risk of infinite loop

---

## Key Parameters
- **Max Iterations**: Safety limit (default: 50)
- **Completion Promise**: String that signals done (e.g., "DONE", "<promise>COMPLETE</promise>")

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Load
**REQUIRED OUTPUT:**
- Input type: file/inline
- Prompt content: _____
- Completion promise: _____
- Max iterations: _____

**USER GATE:** Use AskUserQuestion
- Question: "Prompt loaded. Completion signal: [X]. Max: [N]. Start loop?"
- Options: ["Start loop", "Adjust config", "Show prompt"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Each Iteration
**REQUIRED OUTPUT (per iteration):**
- Iteration #: _____
- Progress made: _____
- Completion signal detected: yes/no

**AUTO-PROCEED:** Continue iterations until completion signal or max reached.

Only stop for user confirmation if max iterations reached without completion.

---

### ⛔ CHECKPOINT 2: Completion
**REQUIRED OUTPUT:**
- Total iterations: _____
- Completion signal: _____
- Final result: _____

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/ralph/_____
- Doc path: docs/solutions/ralph/_____.md
- Pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: docs/solutions/ralph-candidates/RALPH_CANDIDATES.md

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 4 phases
- [ ] Checkpoint 0 completed with user confirmation
- [ ] Checkpoints 1-3 completed (auto-proceed)
- [ ] Loop completed successfully OR stopped intentionally
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Best For
- Greenfield projects with clear success criteria
- Test-driven development cycles
- Tasks executable overnight/unattended
- Feature implementation with measurable completion

## Example
\`\`\`
/w-ralph-this "Build a CLI tool that converts markdown to HTML. Output <promise>COMPLETE</promise> when all tests pass."
\`\`\`
`
    },

    'w-ralph-goals': {
      name: 'w-ralph-goals',
      description: 'Ralph Spec Builder - Interview to build an optimal Ralph Wiggum prompt',
      content: `# /w-ralph-goals

Ralph Spec Builder - Interactive interview to build an optimal Ralph Wiggum prompt from a rough idea.

## Usage
\`\`\`
/w-ralph-goals [rough idea]
/w-ralph-goals I want to build a CLI tool
/w-ralph-goals create a REST API with authentication
\`\`\`

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Capture initial idea
2. Interview for completion criteria
3. Interview for phases/milestones
4. Interview for verification
5. Build Ralph spec
6. Save spec file
7. Optionally execute

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip interview questions - each is critical
- NEVER skip checkpoints - each requires user confirmation
- NEVER skip saving the spec file
- Ask ONE question at a time using AskUserQuestion

---

## Interview Categories

**Completion Criteria**
- What specific output signals the task is complete?
- How can we automatically verify success?

**Phases & Milestones**
- What are the major steps?
- What order should they happen?

**Self-Correction**
- What tests should run each iteration?
- How should failures be handled?

**Safety**
- What's the max iteration limit?
- Are there any destructive operations to avoid?

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Idea Captured
**REQUIRED OUTPUT:**
- Initial idea: _____
- Context needed: _____

**USER GATE:** Use AskUserQuestion (first interview question)
- Question: "What specific output signals that [idea] is complete?"
- Options: (free text via "Other")

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Interview Complete
**REQUIRED OUTPUT:**
- Completion criteria: _____
- Phases identified: _____
- Verification methods: _____
- Max iterations: _____
- Safety considerations: _____

**USER GATE:** Use AskUserQuestion
- Question: "Interview complete. Proceed to build spec?"
- Options: ["Continue", "Add more questions"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Spec Built
**REQUIRED OUTPUT:**
- Spec preview with all sections
- Completion promise: _____
- Phase list: _____

**USER GATE:** Use AskUserQuestion
- Question: "Ralph spec ready. Review and save?"
- Options: ["Save spec", "Revise spec"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Execute Decision
**REQUIRED OUTPUT:**
- Spec saved to: .claude/plans/YYYY-MM-DD-[name]-ralph.md

**USER GATE:** Use AskUserQuestion
- Question: "Spec saved. Run /w-ralph-this on it now?"
- Options: ["Execute now", "Later"]

STOP and wait for user response.

---

## Output Format
The generated spec will include:
\`\`\`markdown
# Ralph Spec: [Name]

## Completion Promise
Output <promise>COMPLETE</promise> when done.

## Phases
1. Phase 1: ...
2. Phase 2: ...

## Verification
- Test 1: ...
- Test 2: ...

## Max Iterations: N
\`\`\`

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 7 phases
- [ ] All interview questions answered
- [ ] All 4 checkpoints completed with user confirmation
- [ ] Spec file saved: _____
- [ ] Execute decision made

⚠️ Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-ralph-goals I want to build a markdown-to-HTML converter CLI
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
