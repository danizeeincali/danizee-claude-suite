/**
 * Workflow Shortcuts Generator for Danizee Claude Suite
 * Generates WORKFLOW-SHORTCUTS.md with all compound-knowledge workflows
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Generate the complete WORKFLOW-SHORTCUTS.md content
 */
export function generateWorkflowShortcuts() {
  return `# Workflow Shortcuts

Natural language workflows that **compound knowledge** - each task makes future tasks easier.

---

## ⚠️ AI-Proof Enforcement Protocol

All workflows include enforcement mechanisms to prevent AI agents from skipping steps:

### Mandatory First Action
Every workflow requires **TodoWrite** before any other action. Violation = restart.

### Checkpoint Gates
Each ⛔ **CHECKPOINT** requires:
1. **REQUIRED OUTPUT** - Specific artifacts that must be produced
2. **USER GATE** - AskUserQuestion confirmation before proceeding
3. **STOP** - Wait for user response before continuing

### Blocking Rules
- **NEVER** proceed without completing required outputs
- **NEVER** skip checkpoints
- **NEVER** skip compound phase at the end
- **VIOLATION** markers indicate restart conditions

### Completion Checklists
Every workflow ends with a checklist. Workflow is **INCOMPLETE** until all boxes checked.

---

## How It Works

Every workflow follows this pattern:

\`\`\`
┌─────────────────────────────────────────────────┐
│  1. SEARCH FIRST                                │
│     → Check memory for similar past solutions   │
│     → Show relevant patterns if found           │
├─────────────────────────────────────────────────┤
│  2. EXECUTE                                     │
│     → Run the workflow                          │
│     → Pause at checkpoints for review           │
├─────────────────────────────────────────────────┤
│  3. COMPOUND                                    │
│     → Store solution pattern in memory          │
│     → Create/update solution doc                │
│     → Learn from outcome                        │
└─────────────────────────────────────────────────┘
\`\`\`

**At checkpoints**, say "continue" to proceed or give feedback to redirect.

**Result**: The 2nd time you solve a similar problem, it's faster because the workflow finds and applies your previous solution.

---

## Session Management

### Cold-Start Session

**Say:** "Start session with [plan-file]" or "Resume work on [task]"
**Slash:** \`/w-start [plan-file]\`

**What it does:** Boot up a session with full project context - perfect when \`--resume\` isn't available.

**Flow:**
1. **Project Scan** - Read \`CLAUDE.md\`, \`.claude/settings.json\`, tree structure
2. **Load Context** - If plan-file provided, load it into working memory
3. **Memory Sync** - Search memory for related past work
4. **Ready State** - Summary of context loaded, ready for commands

**When to use:**
- Starting fresh VS Code terminal
- Beginning work without \`--resume\` flag
- Switching contexts between different features/bugs
- After system restart or long break

**Example:**
\`\`\`
/w-start .claude/plans/oauth-implementation.md
/w-start
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Project Context
Read CLAUDE.md
Read .claude/settings.json
Bash("ls -la && git status && git log --oneline -5")

# Memory Sync
mcp__claude-flow__memory_search { pattern: "project/*" }
mcp__claude-flow__memory_search { pattern: "session/*" }

# Load Plan (if provided)
Read [plan-file]

# Ready
"Session initialized. Context loaded. Ready for commands."
\`\`\`
</details>

---

### End Session

**Say:** "End session" or "Wrap up work"
**Slash:** \`/w-end [category]\`

**What it does:** Gracefully end a work session - compound knowledge + commit changes.

**Flow:**
1. **Gather Work** - Summarize what was accomplished this session
2. **Compound** - Store patterns and solutions in memory
3. **Commit** - Create a commit with session summary
4. **Handoff** - Generate context for next \`/w-start\`

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Summary | Work accomplished this session |
| 1 | Compound | Patterns to store |
| 2 | Commit | Commit message and changes |
| 3 | Handoff | Context saved for next session |

**Categories:** \`feature\`, \`bug\`, \`security\`, \`performance\`, \`architecture\`, \`docs\`, \`refactor\`

**Example:**
\`\`\`
/w-end feature
/w-end bug
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Gather
git diff --stat
git status

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "session/[timestamp]" }
/compound-engineering:workflows:compound

# Commit
git add -A
git commit -m "[category]: [summary]

🤖 Generated with Claude Code

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

# Handoff
Write session summary to .claude/plans/last-session.md
\`\`\`
</details>

---

## Slash Commands (Quick Access)

Use the \`/w-\` prefix for quick workflow invocation:

| Command | Description |
|---------|-------------|
| \`/w-start [plan-file]\` | Cold-start session with project context |
| \`/w-end [category]\` | End session - compound and commit |
| \`/w-tdd-swarm [feature]\` | Full TDD + Swarm + Review combined (recommended) |
| \`/w-plan-tdd-swarm [idea]\` | Deep interview → refine idea → TDD Swarm |
| \`/w-swarm [task]\` | Parallel agents for rapid implementation |
| \`/w-fix [bug]\` | Quick bug investigation and fix |
| \`/w-debug [issue]\` | Debug → diagnose → TDD-swarm fix |
| \`/w-hotfix [issue]\` | Critical production fix |
| \`/w-review [PR#]\` | Comprehensive multi-agent review |
| \`/w-security [target]\` | OWASP security audit |
| \`/w-perf [target]\` | Performance bottleneck analysis |
| \`/w-architect [system]\` | Hive-mind architecture design |
| \`/w-multi-repo [task]\` | Cross-repository coordination |
| \`/w-compound\` | Store current solution in memory |
| \`/w-search [query]\` | Search past solutions |
| \`/w-ralph-init\` | Initialize Pure Ralph structure |
| \`/w-ralph-this [task]\` | Convert task to IMPLEMENTATION_PLAN.md |
| \`/w-ralph-goals [idea]\` | Interview to build Ralph plan + specs |
| \`/w-ralph-pick [ID]\` | Execute a Ralph candidate |
| \`/w-ralph-batch [mode]\` | Generate overnight bash scripts |

**Example:**
\`\`\`
/w-tdd-swarm OAuth2 authentication with Google
/w-swarm REST API with CRUD endpoints
/w-fix users getting logged out after password reset
\`\`\`

---

## Development Workflows

### Full Cycle Development

**Say:** "Run the full cycle workflow on [feature]"

**What it does:** Plans → implements in isolated worktree → comprehensive review → PR ready.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Similar past solutions found |
| 1 | Planning | Proposed approach and files |
| 2 | Implementation | Code changes before PR |
| 3 | Review | Findings before merge |
| 4 | Compound | Solution summary to store |

**Compounds:**
\`\`\`
Memory: project/features/[feature-name]
Doc: docs/solutions/features/[feature-name].md
Pattern: implementation approach + key decisions
\`\`\`

**Example:**
\`\`\`
User: Run the full cycle workflow on adding OAuth2 authentication with Google
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Search
mcp__claude-flow__memory_search { pattern: "auth/*" }

# Execute
/compound-engineering:workflows:plan
npx claude-flow@v3alpha swarm init --topology hierarchical
/compound-engineering:workflows:work
/compound-engineering:workflows:review

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/features/oauth2-google" }
/compound-engineering:workflows:compound
mcp__claude-flow__neural_patterns { action: "learn" }
\`\`\`
</details>

---

### Swarm Build

**Say:** "Use swarm to build [task]"
**Slash:** \`/w-swarm [task]\`

**What it does:** Spawns parallel agents (coder, tester, reviewer) for rapid implementation.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Related implementation patterns |
| 1 | Agent spawn | Agent assignments and strategy |
| 2 | Execution | Completed work before integration |
| 3 | Compound | Implementation pattern to store |

**Compounds:**
\`\`\`
Memory: project/implementations/[task-name]
Doc: docs/solutions/implementations/[task-name].md
Pattern: agent configuration + coordination approach
\`\`\`

**Example:**
\`\`\`
User: Use swarm to build a REST API for user management with CRUD and tests
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Search
mcp__claude-flow__memory_search { pattern: "implementations/*api*" }

# Execute
npx claude-flow@v3alpha swarm init --topology hierarchical
Task("coder", "Implement endpoints...", "coder") x3
Task("tester", "Create tests...", "tester") x2
Task("reviewer", "Review code...", "reviewer")

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/implementations/user-api" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

### TDD Development

**Say:** "TDD workflow for [feature]"

**What it does:** SPARC methodology: Spec → Tests first → Implementation → Refinement.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Similar test patterns |
| 1 | Specification | Requirements and acceptance criteria |
| 2 | Test creation | Test cases before implementation |
| 3 | Implementation | Code that makes tests pass |
| 4 | Compound | Test patterns to store |

**Compounds:**
\`\`\`
Memory: project/tdd/[feature-name]
Doc: docs/solutions/tdd/[feature-name].md
Pattern: test structure + implementation approach
\`\`\`

**Example:**
\`\`\`
User: TDD workflow for shopping cart with add, remove, and checkout
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Search
mcp__claude-flow__memory_search { pattern: "tdd/*cart*" }

# Execute
npx claude-flow@v3alpha sparc tdd "[feature]"

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/tdd/shopping-cart" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

### Full TDD Swarm

**Say:** "Full TDD Swarm on [feature]"
**Slash:** \`/w-tdd-swarm [feature]\`

**What it does:** Combines planning (Full Cycle) + test-first (TDD) + parallel build (Swarm) + comprehensive review.

**Philosophy:** Plan like Full Cycle, test like TDD, build like Swarm.

**⚠️ Enforcement:**
- MANDATORY: Use TodoWrite first with all 7 phases
- BLOCKING: Build phase is BLOCKED until all tests exist and FAIL
- NEVER skip compound phase at the end

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| ⛔ 0 | Search | Past solutions, TDD patterns, implementations |
| ⛔ 1 | Plan | Architecture, files, approach |
| ⛔ 2 | Spec | Acceptance criteria, test cases |
| ⛔ 3 | Tests | Test files (must fail - no implementation yet) |
| ⛔ 4 | Build | Implementation (tests must pass) |
| ⛔ 5 | Review | Security, performance, patterns, architecture |
| ⛔ 6 | Compound | Complete solution summary |

**Strict TDD Rule:** Build phase is BLOCKED until all tests are written and failing.

**Compounds:**
\`\`\`
Memory: project/full-tdd-swarm/[feature-name]
Doc: docs/solutions/full-tdd-swarm/[feature-name].md
Pattern: plan + test structure + implementation + review findings
\`\`\`

**Example:**
\`\`\`
User: Full TDD Swarm on user authentication with JWT tokens
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# 0. SEARCH (unified)
mcp__claude-flow__memory_search { pattern: "features/*[feature]*" }
mcp__claude-flow__memory_search { pattern: "tdd/*[feature]*" }
mcp__claude-flow__memory_search { pattern: "implementations/*[feature]*" }

# 1. PLAN
/compound-engineering:workflows:plan [feature]

# 2. SPEC
npx claude-flow@v3alpha sparc run spec-pseudocode "[feature]"

# 3. TEST-FIRST (strict: ALL tests before ANY implementation)
npx claude-flow@v3alpha swarm init --topology hierarchical
Task("tester", "Write unit tests for [component-1]", "tester")
Task("tester", "Write unit tests for [component-2]", "tester")
Task("tester", "Write integration tests", "tester")
# GATE: npm run test → ALL MUST FAIL (no implementation yet)

# 4. SWARM BUILD
Task("coder", "Implement [component-1] to pass tests", "coder")
Task("coder", "Implement [component-2] to pass tests", "coder")
Task("coder", "Implement integration layer", "coder")
# VERIFY: npm run test → ALL MUST PASS

# 5. FULL REVIEW
/compound-engineering:workflows:review
Task("security-sentinel", "Security scan", "reviewer")
Task("performance-oracle", "Performance analysis", "reviewer")
Task("architecture-strategist", "Architecture review", "reviewer")
Task("pattern-recognition-specialist", "Pattern analysis", "reviewer")
Task("code-simplicity-reviewer", "Simplicity check", "reviewer")

# 6. COMPOUND
mcp__claude-flow__memory_usage { action: "store", key: "project/full-tdd-swarm/[feature]" }
/compound-engineering:workflows:compound
mcp__claude-flow__neural_patterns { action: "learn" }
\`\`\`
</details>

---

### Idea → TDD Swarm

**Say:** "I have an idea for [rough concept]" or "Help me build [half-baked idea]"
**Slash:** \`/w-plan-tdd-swarm [idea]\`

**What it does:** Deep interview to refine a half-baked idea, then flows into Full TDD Swarm.

**Philosophy:** Ideas need refinement before implementation. This workflow uses structured interviewing to transform vague concepts into clear specs, then executes them with TDD Swarm rigor.

**⚠️ Enforcement:**
- MANDATORY: Use TodoWrite first with all 9 phases
- NEVER skip interview phase - ideas MUST be refined
- BLOCKING: Build is BLOCKED until tests exist and FAIL
- NEVER skip compound phase at the end

**Phase 1: Deep Interview**
- Clarify the core value and purpose
- Define success criteria (how do we know it works?)
- Identify edge cases and constraints
- Explore integration points
- Establish measurable acceptance criteria

**Phase 2: Full TDD Swarm**
- Plan → Tests → Build → Review → Compound

**Interview Questions:**
\`\`\`
• What problem does this solve? Who benefits?
• What does "done" look like? Be specific.
• What are the must-have vs nice-to-have features?
• What are the constraints? (time, tech, security)
• What could go wrong? Edge cases?
• How will we test this works correctly?
• Does this integrate with existing code?
\`\`\`

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| ⛔ 0 | Idea captured | Initial rough concept |
| ⛔ 1 | Interview | Clarified requirements |
| ⛔ 2 | Spec | Refined, actionable specification |
| ⛔ 3 | Plan | Architecture based on refined spec |
| ⛔ 4 | Tests | Test cases (must fail) |
| ⛔ 5 | Build | Implementation (tests pass) |
| ⛔ 6 | Review | Full review |
| ⛔ 7 | Compound | Complete pattern to store |

**Compounds:**
\`\`\`
Memory: project/ideas/[idea-name]
Doc: docs/solutions/ideas/[idea-name].md
Pattern: interview answers + refined spec + implementation
\`\`\`

**Example:**
\`\`\`
User: /w-plan-tdd-swarm I want some kind of caching layer for the API
Claude: Let me interview you to refine this idea...
  - What problem does caching solve here? Slow responses? Rate limits?
  - What data needs caching? All endpoints or specific ones?
  - What's the TTL? Should users be able to invalidate?
  ...
Claude: [Checkpoint 2] Here's the refined spec:
  - Redis cache for /api/products with 5min TTL
  - Cache-Control headers for browser caching
  - Admin endpoint to invalidate cache
User: continue
Claude: [Proceeds to Full TDD Swarm...]
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Phase 1: Deep Interview
AskUserQuestion("What problem does this solve?", options)
AskUserQuestion("What does done look like?", options)
AskUserQuestion("Must-haves vs nice-to-haves?", options)
AskUserQuestion("Constraints?", options)
AskUserQuestion("Edge cases?", options)
AskUserQuestion("How to test?", options)

# Generate refined spec
Write refined spec to .claude/plans/[idea]-spec.md

# Phase 2: Full TDD Swarm
/w-tdd-swarm [refined-spec]

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/ideas/[idea]" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

## Bug Fix Workflows

### Quick Fix

**Say:** "Quick fix for [bug description]"
**Slash:** \`/w-fix [bug]\`

**What it does:** Fast investigation → targeted fix → verification.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Similar bugs fixed before |
| 1 | Investigation | Root cause analysis |
| 2 | Fix applied | Changes before testing |
| 3 | Compound | Bug pattern to store |

**Compounds:**
\`\`\`
Memory: project/bugs/[bug-category]
Doc: docs/solutions/bugs/[bug-name].md
Pattern: root cause + fix approach
\`\`\`

**Example:**
\`\`\`
User: Quick fix for users getting logged out after password reset
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Search
mcp__claude-flow__memory_search { pattern: "bugs/*auth*" }

# Execute
# Search codebase, analyze, apply minimal fix, run tests

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/bugs/auth-logout-reset" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

### Deep Debug → TDD Swarm

**Say:** "Debug workflow for [issue]"
**Slash:** \`/w-debug [issue]\`

**What it does:** Thorough investigation → diagnose root cause → TDD-swarm fix with regression tests.

**⚠️ Enforcement:**
- MANDATORY: Use TodoWrite first with all 9 phases
- NEVER skip diagnosis - root cause MUST be confirmed
- BLOCKING: Fix is BLOCKED until regression tests exist and FAIL
- NEVER skip compound phase at the end

**Phase 1: Debug Investigation**
- Search → Analyze → Investigate → Diagnose root cause

**Phase 2: TDD-Swarm Fix**
- Plan fix → Write regression tests (must fail) → Build fix → Review

**Strict TDD Rule:** Fix phase is BLOCKED until regression tests are written and failing.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| ⛔ 0 | Search | Related debugging sessions |
| ⛔ 1 | Analysis | Initial findings and hypotheses |
| ⛔ 2 | Diagnosis | Confirmed root cause |
| ⛔ 3 | Plan | Fix architecture based on diagnosis |
| ⛔ 4 | Tests | Regression tests (must fail) |
| ⛔ 5 | Build | Fix implementation (tests pass) |
| ⛔ 6 | Review | Security, performance, no regressions |
| ⛔ 7 | Compound | Root cause + fix pattern to store |

**Compounds:**
\`\`\`
Memory: project/debugging/[issue-category]
Doc: docs/solutions/debugging/[issue-name].md
Pattern: root cause + regression tests + fix approach
\`\`\`

**Example:**
\`\`\`
User: Debug workflow for intermittent API timeouts in production
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Phase 1: Debug Investigation
mcp__claude-flow__memory_search { pattern: "debugging/*timeout*" }
npx claude-flow@v3alpha sparc debugger "[issue]"
Task("analyst", "Analyze patterns...", "analyst")
Task("git-history-analyzer", "Check recent changes...", "researcher")
# CHECKPOINT: Root cause confirmed

# Phase 2: TDD-Swarm Fix
/compound-engineering:workflows:plan
Task("tester", "Write regression tests that reproduce bug", "tester")
# GATE: npm run test → MUST FAIL (bug still exists)
npx claude-flow@v3alpha swarm init --topology hierarchical
Task("coder", "Implement fix to pass tests", "coder")
# VERIFY: npm run test → ALL MUST PASS
/compound-engineering:workflows:review

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/debugging/api-timeouts" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

### Critical Hotfix

**Say:** "Critical hotfix for [issue]"
**Slash:** \`/w-hotfix [issue]\`

**What it does:** Isolated branch → minimal fix → security-focused review → expedited PR.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Similar incidents |
| 1 | Branch created | Isolated hotfix branch |
| 2 | Fix applied | Minimal change for review |
| 3 | Security review | Security analysis complete |
| 4 | Compound | Incident doc to store |

**Compounds:**
\`\`\`
Memory: project/incidents/[incident-type]
Doc: docs/solutions/incidents/[incident-name].md
Pattern: incident response + prevention measures
\`\`\`

**Example:**
\`\`\`
User: Critical hotfix for SQL injection vulnerability in search endpoint
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Search
mcp__claude-flow__memory_search { pattern: "incidents/*sql*" }

# Execute
git worktree add ../hotfix-branch hotfix/[issue]
npx claude-flow@v3alpha swarm init --topology star
Task("security-sentinel", "Security review...", "reviewer")

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/incidents/sql-injection-search" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

## Review Workflows

### Full Review

**Say:** "Full review of PR [number]"
**Slash:** \`/w-review [PR#]\`

**What it does:** 12+ specialized agents analyze code, security, performance, architecture.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past review patterns for this code area |
| 1 | Code analysis | Style, patterns, quality findings |
| 2 | Security scan | Vulnerability report |
| 3 | Performance check | Optimization opportunities |
| 4 | Compound | Review findings to store |

**Compounds:**
\`\`\`
Memory: project/reviews/[pr-topic]
Doc: docs/solutions/reviews/[pr-number].md
Pattern: key findings + recommendations applied
\`\`\`

**Example:**
\`\`\`
User: Full review of PR 47
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Search
mcp__claude-flow__memory_search { pattern: "reviews/*" }

# Execute
/compound-engineering:workflows:review PR#47
# Runs: code-simplicity-reviewer, security-sentinel, performance-oracle,
#       architecture-strategist, pattern-recognition-specialist

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/reviews/pr-47-auth" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

### Security Audit

**Say:** "Security audit on [target]"
**Slash:** \`/w-security [target]\`

**What it does:** OWASP top 10, auth/authz, data exposure analysis.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past security findings in this area |
| 1 | Scan complete | Vulnerability findings |
| 2 | Analysis done | Risk assessment and priorities |
| 3 | Compound | Security patterns to store |

**Compounds:**
\`\`\`
Memory: project/security/[target-area]
Doc: docs/solutions/security/[audit-name].md
Pattern: vulnerabilities found + remediation applied
\`\`\`

**Example:**
\`\`\`
User: Security audit on the authentication module
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Search
mcp__claude-flow__memory_search { pattern: "security/*auth*" }

# Execute
Task("security-sentinel", "Full security scan...", "reviewer")
# Checks: SQL injection, XSS, CSRF, auth bypass, secrets, input validation

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/security/auth-module" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

### Performance Audit

**Say:** "Performance audit on [target]"
**Slash:** \`/w-perf [target]\`

**What it does:** Bottlenecks, N+1 queries, memory issues, optimization opportunities.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past performance optimizations |
| 1 | Profiling done | Bottleneck identification |
| 2 | Analysis complete | Prioritized recommendations |
| 3 | Compound | Performance patterns to store |

**Compounds:**
\`\`\`
Memory: project/performance/[target-area]
Doc: docs/solutions/performance/[audit-name].md
Pattern: bottlenecks found + optimizations applied
\`\`\`

**Example:**
\`\`\`
User: Performance audit on the dashboard loading
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Search
mcp__claude-flow__memory_search { pattern: "performance/*dashboard*" }

# Execute
Task("performance-oracle", "Profile and analyze...", "analyst")
npx claude-flow@v3alpha analysis bottleneck-detect

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/performance/dashboard" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

## Architecture Workflows

### Hive-Mind Architecture

**Say:** "Hive-mind architecture for [system]"
**Slash:** \`/w-architect [system]\`

**What it does:** Multiple agents collaborate with collective intelligence for complex design.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Related architecture decisions |
| 1 | Hive initialized | Agent assignments |
| 2 | Design proposals | Multiple architecture options |
| 3 | Consensus reached | Final recommended design |
| 4 | Compound | Architecture decision record |

**Compounds:**
\`\`\`
Memory: project/architecture/[system-name]
Doc: docs/solutions/architecture/[system-name]-adr.md
Pattern: decision rationale + trade-offs considered
\`\`\`

**Example:**
\`\`\`
User: Hive-mind architecture for microservices migration
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Search
mcp__claude-flow__memory_search { pattern: "architecture/*microservices*" }

# Execute
npx claude-flow@v3alpha hive-mind init
Task("system-architect", "Design system...", "architect")
Task("analyst", "Analyze trade-offs...", "analyst")
mcp__claude-flow__collective-intelligence-coordinator

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/architecture/microservices" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

### Multi-Repository

**Say:** "Multi-repo workflow for [task]"
**Slash:** \`/w-multi-repo [task]\`

**What it does:** Coordinates changes across repos with dependency awareness.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past multi-repo coordination patterns |
| 1 | Repos analyzed | Dependency map and change plan |
| 2 | Changes prepared | Per-repo changes for review |
| 3 | Sync complete | All repos updated |
| 4 | Compound | Coordination pattern to store |

**Compounds:**
\`\`\`
Memory: project/multi-repo/[task-name]
Doc: docs/solutions/multi-repo/[task-name].md
Pattern: coordination approach + dependency handling
\`\`\`

**Example:**
\`\`\`
User: Multi-repo workflow for updating shared auth library across all repos
\`\`\`

<details>
<summary>Under the hood</summary>

\`\`\`bash
# Search
mcp__claude-flow__memory_search { pattern: "multi-repo/*" }

# Execute
npx claude-flow@v3alpha swarm init --topology mesh
Task("multi-repo-swarm", "Coordinate changes...", "coordinator")
npx claude-flow@v3alpha github multi-repo --repos "frontend,backend,mobile"

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/multi-repo/auth-library-update" }
/compound-engineering:workflows:compound
\`\`\`
</details>

---

## Utility Workflows

### Compound This

**Say:** "Compound this solution" or "Document what we just solved"
**Slash:** \`/w-compound [category]\`

**What it does:** Captures current context as reusable knowledge (ad-hoc).

**Example:**
\`\`\`
User: Compound this solution
Claude: What category? (feature/bug/security/performance/architecture)
User: bug
Claude: Stored as project/bugs/[auto-named] + created docs/solutions/bugs/[name].md
\`\`\`

---

### Search Solutions

**Say:** "Search for solutions to [problem]" or "What patterns exist for [category]?"
**Slash:** \`/w-search [query]\`

**What it does:** Searches memory and solution docs for relevant past work.

**Example:**
\`\`\`
User: Search for solutions to authentication issues
Claude: Found 3 matches:
  - project/bugs/auth-logout-reset (Dec 2024)
  - project/features/oauth2-google (Nov 2024)
  - project/security/auth-module (Oct 2024)
\`\`\`

---

## Pure Ralph (Bash Loop Approach)

Pure Ralph uses external bash orchestration for **fresh context each iteration**.

### Key Principle

Each iteration starts FRESH - no context pollution. State passes through \`IMPLEMENTATION_PLAN.md\` only.

\`\`\`
┌────────────────────────────────────────────────────────────┐
│ while [ tasks_remaining ]; do                               │
│   cat PROMPT.md AGENTS.md IMPLEMENTATION_PLAN.md | claude   │
│                          ↓                                  │
│   Fresh Claude reads plan → picks ONE task → executes       │
│   → validates → marks done → commits → exits                │
│                          ↓                                  │
│   IMPLEMENTATION_PLAN.md updated (state preserved!)         │
│ done                                                        │
└────────────────────────────────────────────────────────────┘
\`\`\`

### Project Structure

\`\`\`
.claude/ralph/
├── loop.sh              # Bash orchestrator (run this!)
├── PROMPT_build.md      # Build mode prompt
├── PROMPT_plan.md       # Planning mode prompt
├── AGENTS.md            # Validation commands (customize!)
└── IMPLEMENTATION_PLAN.md  # Task tracking (shared state)

specs/
└── *.md                 # Specification files
\`\`\`

### Differences from Plugin-Style

| Aspect | Plugin-Style | Pure Ralph (Bash Loop) |
|--------|--------------|------------------------|
| Context | Accumulates | Fresh each iteration |
| Orchestration | Internal hooks | External bash loop |
| State | In-memory | File-based (IMPLEMENTATION_PLAN.md) |
| Task scope | Multiple per session | ONE per iteration |
| Completion | String matching | Plan file + git commit |

### Quick Start

\`\`\`bash
# 1. Initialize Ralph structure
/w-ralph-init

# 2. Create implementation plan from a task
/w-ralph-this "Build authentication with JWT tokens"

# 3. Run the loop (in your terminal, not Claude)
./.claude/ralph/loop.sh

# Options:
./.claude/ralph/loop.sh build 50   # Max 50 iterations
./.claude/ralph/loop.sh plan       # Planning mode
\`\`\`

---

### Ralph Init

**Say:** "Initialize Ralph" or "Set up Pure Ralph"
**Slash:** \`/w-ralph-init\`

**What it does:** Creates the Pure Ralph directory structure in your project.

**Creates:**
\`\`\`
.claude/ralph/loop.sh           # Bash orchestrator
.claude/ralph/PROMPT_build.md   # Build mode prompt
.claude/ralph/PROMPT_plan.md    # Planning mode prompt
.claude/ralph/AGENTS.md         # Validation commands
.claude/ralph/IMPLEMENTATION_PLAN.md  # Task tracking
specs/                          # Spec files directory
\`\`\`

**Example:**
\`\`\`
/w-ralph-init
# Creates structure, then:
./.claude/ralph/loop.sh
\`\`\`

---

### Ralph This

**Say:** "Ralph this [task]" or "Create Ralph plan for [task]"
**Slash:** \`/w-ralph-this [task or file path]\`

**What it does:** Converts a task into an IMPLEMENTATION_PLAN.md and outputs the command to run.

**Flow:**
1. Parse task into atomic steps (one per iteration)
2. Create/update \`IMPLEMENTATION_PLAN.md\`
3. Verify \`AGENTS.md\` has correct validation commands
4. Output the bash command to run

**Key difference:** Does NOT run the loop internally - outputs the command for you to run.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Parse | Task breakdown and scope |
| 1 | Plan | IMPLEMENTATION_PLAN.md created |
| 2 | Agents | Validation commands verified |
| 3 | Command | Bash command to run |

**Example:**
\`\`\`
/w-ralph-this Build a REST API with CRUD endpoints and tests

# Creates IMPLEMENTATION_PLAN.md with tasks like:
# - [ ] Create types in src/types/api.ts
# - [ ] Implement GET endpoint
# - [ ] Implement POST endpoint
# - [ ] Write tests
# - [ ] Add error handling

# Then run in terminal:
./.claude/ralph/loop.sh
\`\`\`

---

### Ralph Goals

**Say:** "Ralph goals for [rough idea]" or "Interview me for Ralph"
**Slash:** \`/w-ralph-goals [idea]\`

**What it does:** Interactive interview to build a complete Ralph setup from a rough idea.

**Flow:**
1. **Interview** - Clarify acceptance criteria, architecture, verification
2. **Generate Plan** - Create IMPLEMENTATION_PLAN.md with atomic tasks
3. **Generate Specs** - Create spec files in specs/ directory
4. **Configure AGENTS.md** - Set up validation commands
5. **Output Command** - Show how to run

**Interview Categories:**
\`\`\`
• Acceptance Criteria - What does "done" look like?
• Architecture - What's the high-level design?
• Verification - How do we test it works?
• Scope - What's explicitly out of scope?
\`\`\`

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Idea | Initial concept captured |
| 1 | Interview | Requirements clarified |
| 2 | Plan | IMPLEMENTATION_PLAN.md created |
| 3 | Specs | Spec files generated |
| 4 | Agents | AGENTS.md configured |
| 5 | Command | Ready to run |

**Example:**
\`\`\`
/w-ralph-goals I want to build a CLI tool for markdown conversion

# Interview extracts requirements
# Generates:
#   .claude/ralph/IMPLEMENTATION_PLAN.md (12 tasks)
#   specs/cli-interface.md
#   specs/markdown-parser.md
#   specs/html-output.md
#   Configured AGENTS.md

# Then run:
./.claude/ralph/loop.sh
\`\`\`

---

### Ralph Pick

**Say:** "Pick Ralph candidate [ID]" or "Execute RC-001"
**Slash:** \`/w-ralph-pick [ID]\`

**What it does:** Select a Ralph candidate and create its IMPLEMENTATION_PLAN.md for execution.

**Flow:**
1. **Load Candidates** - Read \`.claude/ralph-candidates.md\`
2. **Select** - User picks candidate by ID or priority
3. **Create Plan** - Generate IMPLEMENTATION_PLAN.md from candidate spec
4. **Output Command** - Show how to run with loop.sh

**Example:**
\`\`\`
/w-ralph-pick RC-001
/w-ralph-pick --priority P1

# Then run:
./.claude/ralph/loop.sh
\`\`\`

---

### Ralph Batch

**Say:** "Generate overnight Ralph script" or "Batch Ralph"
**Slash:** \`/w-ralph-batch [mode]\`

**What it does:** Generate overnight bash scripts that run Pure Ralph loops on multiple candidates/projects.

**Uses the bash loop approach:**
- Each candidate gets its own Ralph loop via \`loop.sh\`
- Fresh context for every iteration
- State persisted through IMPLEMENTATION_PLAN.md files

**Modes:**
| Mode | Flag | Description |
|------|------|-------------|
| Script | \`--script\` | Generate \`overnight-ralph.sh\` |
| Multi-project | \`--multi-project\` | Batch multiple project dirs |
| Diagnostics | \`--diagnostics\` | Run diagnostics from candidates |

**Generated Script Example:**
\`\`\`bash
#!/bin/bash
# Pure Ralph Batch - Generated [DATE]

LOG_FILE="ralph-batch-$(date +%Y%m%d-%H%M%S).log"

# Candidate: RC-001
cat > .claude/ralph/IMPLEMENTATION_PLAN.md << 'EOF'
# Implementation Plan: RC-001
...
EOF
./.claude/ralph/loop.sh build 50

# Candidate: RC-002
...
\`\`\`

**Running Overnight:**
\`\`\`bash
# Generate script
/w-ralph-batch --script

# Run with nohup
nohup ./overnight-ralph.sh > overnight.log 2>&1 &

# Or with screen
screen -S ralph ./overnight-ralph.sh

# Check progress
tail -f ralph-batch-*.log
\`\`\`

**Example:**
\`\`\`
/w-ralph-batch --script
# Generates overnight-ralph.sh with all ready candidates

./overnight-ralph.sh
# Runs all Ralph loops sequentially
# Each iteration: fresh context, one task, commit, exit
\`\`\`

---

## Ralph Candidates System

During compound phases, patterns are logged to \`.claude/ralph-candidates.md\`:

### Candidate Types

| ID Format | Type | Purpose |
|-----------|------|---------|
| RC-### | General | Standard Ralph candidates |
| RC-D### | Diagnostic | Verify patterns/code exists |
| RC-F### | Fix | Restore code if diagnostic fails |

### Auto-Generated QA

\`/w-compound\` automatically generates diagnostic and fix candidates:

1. **Analyze Changes** - Parse git diff for new functions/interfaces
2. **Generate Diagnostics** - Create RC-D### to verify patterns exist
3. **Generate Fixes** - Create paired RC-F### to restore if needed

### Diagnostic → Fix Flow

\`\`\`
1. Run RC-D### diagnostic command
2. If STATUS: PASS → log "VERIFIED" → skip RC-F###
3. If STATUS: FAIL → run RC-F### → re-run RC-D### to verify
4. Report: VERIFIED | RESTORED | FAILED
\`\`\`

### AI-Verifiable Completion Tests

| Type | Format | Example |
|------|--------|---------|
| File exists | \`File exists: path\` | \`File exists: src/api/users.ts\` |
| Pattern match | \`Pattern: "regex" in file\` | \`Pattern: "export.*getUser" in src/api.ts\` |
| Test passes | \`Test: command\` | \`Test: npm test -- --grep "getUser"\` |
| Lint clean | \`Lint: command\` | \`Lint: npm run lint\` |
| Build passes | \`Build: command\` | \`Build: npm run build\` |

### Batch Processing

\`\`\`bash
# Generate overnight script
/w-ralph-batch --script

# Process by priority
/w-ralph-batch --priority P1

# Run diagnostics first, fixes only if needed
/w-ralph-batch --diagnostics

# Phased execution (P1 → P2 → P3)
/w-ralph-batch --phased
\`\`\`

---

## Quick Reference

### Workflow Summary

| Workflow | Slash | Natural Language | Best For |
|----------|-------|------------------|----------|
| Cold-Start | \`/w-start\` | "start session with [plan]" | Resume without --resume |
| End Session | \`/w-end\` | "end session" | Compound and commit before disconnect |
| Full TDD Swarm | \`/w-tdd-swarm\` | "Full TDD Swarm on [X]" | New features (recommended) |
| Idea → TDD Swarm | \`/w-plan-tdd-swarm\` | "I have an idea for [X]" | Half-baked ideas → features |
| Swarm Build | \`/w-swarm\` | "swarm to build [X]" | Parallel implementation |
| Full Cycle | - | "full cycle workflow on [X]" | Features without strict TDD |
| TDD | - | "TDD workflow for [X]" | Simple test-first |
| Quick Fix | \`/w-fix\` | "quick fix for [X]" | Simple bugs |
| Deep Debug → TDD | \`/w-debug\` | "debug workflow for [X]" | Complex issues with regression tests |
| Hotfix | \`/w-hotfix\` | "critical hotfix for [X]" | Production emergencies |
| Full Review | \`/w-review\` | "full review of PR [#]" | Comprehensive review |
| Security Audit | \`/w-security\` | "security audit on [X]" | Security analysis |
| Perf Audit | \`/w-perf\` | "performance audit on [X]" | Optimization |
| Hive Architect | \`/w-architect\` | "hive-mind architecture for [X]" | Complex design |
| Multi-Repo | \`/w-multi-repo\` | "multi-repo workflow for [X]" | Cross-repo changes |
| Compound This | \`/w-compound\` | "compound this solution" | Ad-hoc capture |
| Search Solutions | \`/w-search\` | "search for solutions to [X]" | Find past work |
| Ralph Init | \`/w-ralph-init\` | "initialize ralph" | Setup Pure Ralph structure |
| Ralph This | \`/w-ralph-this\` | "ralph this [task]" | Create IMPLEMENTATION_PLAN.md |
| Ralph Goals | \`/w-ralph-goals\` | "ralph goals for [idea]" | Interview → Plan → Specs |
| Ralph Pick | \`/w-ralph-pick\` | "pick candidate RC-001" | Execute queued candidate |
| Ralph Batch | \`/w-ralph-batch\` | "generate overnight script" | Batch/overnight runs |

### Key Agents

| Agent | Purpose |
|-------|---------|
| coder | Implementation |
| tester | Test creation |
| reviewer | Code review |
| security-sentinel | Security scanning |
| performance-oracle | Performance analysis |
| architecture-strategist | Design review |
| analyst | Deep analysis |

### Memory Namespaces

| Namespace | Contents |
|-----------|----------|
| \`project/features/*\` | Feature implementations |
| \`project/bugs/*\` | Bug fixes |
| \`project/security/*\` | Security findings |
| \`project/performance/*\` | Performance optimizations |
| \`project/architecture/*\` | Design decisions |
| \`project/reviews/*\` | Review findings |
| \`project/incidents/*\` | Incident responses |
| \`project/ideas/*\` | Refined ideas from interviews |
| \`project/ralph/*\` | Ralph loop patterns |
| \`project/ralph-specs/*\` | Generated Ralph specs |

---

## Tips

1. **Be specific** - More detail = better pattern matching
2. **Review checkpoint 0** - Past solutions may already solve your problem
3. **Name patterns well** - Good names make future searches easier
4. **Trust the compound** - Don't skip the final checkpoint
5. **Search first manually** - "Search for solutions to [X]" before starting if unsure
6. **Log Ralph candidates** - Repeating patterns become future automation
7. **Batch overnight work** - Use \`/w-ralph-batch --script\` for unattended runs
8. **Run diagnostics nightly** - \`/w-ralph-batch --diagnostics\` catches accidental deletions
`;
}

/**
 * Write the WORKFLOW-SHORTCUTS.md file
 */
export async function writeWorkflowShortcuts(targetDir) {
  const content = generateWorkflowShortcuts();
  const filePath = path.join(targetDir, 'WORKFLOW-SHORTCUTS.md');

  await fs.writeFile(filePath, content, 'utf-8');

  return filePath;
}

/**
 * Check if shortcuts file exists
 */
export async function shortcutsExist(targetDir) {
  const filePath = path.join(targetDir, 'WORKFLOW-SHORTCUTS.md');

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export default {
  generateWorkflowShortcuts,
  writeWorkflowShortcuts,
  shortcutsExist
};
