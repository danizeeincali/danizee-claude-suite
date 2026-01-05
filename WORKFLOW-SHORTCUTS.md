# Workflow Shortcuts

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

```
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
```

**At checkpoints**, say "continue" to proceed or give feedback to redirect.

**Result**: The 2nd time you solve a similar problem, it's faster because the workflow finds and applies your previous solution.

---

## Session Management

### Cold-Start Session

**Say:** "Start session with [plan-file]" or "Resume work on [task]"
**Slash:** `/w-start [plan-file]`

**What it does:** Boot up a session with full project context - perfect when `--resume` isn't available.

**Flow:**
1. **Project Scan** - Read `CLAUDE.md`, `.claude/settings.json`, tree structure
2. **Load Context** - If plan-file provided, load it into working memory
3. **Memory Sync** - Search memory for related past work
4. **Ready State** - Summary of context loaded, ready for commands

**When to use:**
- Starting fresh VS Code terminal
- Beginning work without `--resume` flag
- Switching contexts between different features/bugs
- After system restart or long break

**Example:**
```
/w-start .claude/plans/oauth-implementation.md
/w-start
```

<details>
<summary>Under the hood</summary>

```bash
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
```
</details>

---

### End Session

**Say:** "End session" or "Wrap up work"
**Slash:** `/w-end [category]`

**What it does:** Gracefully end a work session - compound knowledge + commit changes.

**Flow:**
1. **Gather Work** - Summarize what was accomplished this session
2. **Compound** - Store patterns and solutions in memory
3. **Commit** - Create a commit with session summary
4. **Handoff** - Generate context for next `/w-start`

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Summary | Work accomplished this session |
| 1 | Compound | Patterns to store |
| 2 | Commit | Commit message and changes |
| 3 | Handoff | Context saved for next session |

**Categories:** `feature`, `bug`, `security`, `performance`, `architecture`, `docs`, `refactor`

**Example:**
```
/w-end feature
/w-end bug
```

<details>
<summary>Under the hood</summary>

```bash
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
```
</details>

---

## Slash Commands (Quick Access)

Use the `/w-` prefix for quick workflow invocation:

| Command | Description |
|---------|-------------|
| `/w-start [plan-file]` | Cold-start session with project context |
| `/w-end [category]` | End session - compound and commit |
| `/w-tdd-swarm [feature]` | Full TDD + Swarm + Review combined (recommended) |
| `/w-idea-tdd-swarm [idea]` | Deep interview → refine idea → TDD Swarm |
| `/w-swarm [task]` | Parallel agents for rapid implementation |
| `/w-fix [bug]` | Quick bug investigation and fix |
| `/w-debug [issue]` | Debug → diagnose → TDD-swarm fix |
| `/w-hotfix [issue]` | Critical production fix |
| `/w-review [PR#]` | Comprehensive multi-agent review |
| `/w-security [target]` | OWASP security audit |
| `/w-perf [target]` | Performance bottleneck analysis |
| `/w-architect [system]` | Hive-mind architecture design |
| `/w-multi-repo [task]` | Cross-repository coordination |
| `/w-compound` | Store current solution in memory |
| `/w-search [query]` | Search past solutions |
| `/w-ralph-this [prompt]` | Ralph Wiggum iterative loop |
| `/w-ralph-goals [idea]` | Interview to build Ralph spec |

**Example:**
```
/w-tdd-swarm OAuth2 authentication with Google
/w-swarm REST API with CRUD endpoints
/w-fix users getting logged out after password reset
```

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
```
Memory: project/features/[feature-name]
Doc: docs/solutions/features/[feature-name].md
Pattern: implementation approach + key decisions
```

**Example:**
```
User: Run the full cycle workflow on adding OAuth2 authentication with Google
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "auth/*" }

# Execute
/compound-engineering:workflows:plan
npx claude-flow@alpha swarm init --topology hierarchical
/compound-engineering:workflows:work
/compound-engineering:workflows:review

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/features/oauth2-google" }
/compound-engineering:workflows:compound
mcp__claude-flow__neural_patterns { action: "learn" }
```
</details>

---

### Swarm Build

**Say:** "Use swarm to build [task]"
**Slash:** `/w-swarm [task]`

**What it does:** Spawns parallel agents (coder, tester, reviewer) for rapid implementation.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Related implementation patterns |
| 1 | Agent spawn | Agent assignments and strategy |
| 2 | Execution | Completed work before integration |
| 3 | Compound | Implementation pattern to store |

**Compounds:**
```
Memory: project/implementations/[task-name]
Doc: docs/solutions/implementations/[task-name].md
Pattern: agent configuration + coordination approach
```

**Example:**
```
User: Use swarm to build a REST API for user management with CRUD and tests
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "implementations/*api*" }

# Execute
npx claude-flow@alpha swarm init --topology hierarchical
Task("coder", "Implement endpoints...", "coder") x3
Task("tester", "Create tests...", "tester") x2
Task("reviewer", "Review code...", "reviewer")

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/implementations/user-api" }
/compound-engineering:workflows:compound
```
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
```
Memory: project/tdd/[feature-name]
Doc: docs/solutions/tdd/[feature-name].md
Pattern: test structure + implementation approach
```

**Example:**
```
User: TDD workflow for shopping cart with add, remove, and checkout
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "tdd/*cart*" }

# Execute
npx claude-flow@alpha sparc tdd "[feature]"

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/tdd/shopping-cart" }
/compound-engineering:workflows:compound
```
</details>

---

### Full TDD Swarm

**Say:** "Full TDD Swarm on [feature]"
**Slash:** `/w-tdd-swarm [feature]`

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
```
Memory: project/full-tdd-swarm/[feature-name]
Doc: docs/solutions/full-tdd-swarm/[feature-name].md
Pattern: plan + test structure + implementation + review findings
```

**Example:**
```
User: Full TDD Swarm on user authentication with JWT tokens
```

<details>
<summary>Under the hood</summary>

```bash
# 0. SEARCH (unified)
mcp__claude-flow__memory_search { pattern: "features/*[feature]*" }
mcp__claude-flow__memory_search { pattern: "tdd/*[feature]*" }
mcp__claude-flow__memory_search { pattern: "implementations/*[feature]*" }

# 1. PLAN
/compound-engineering:workflows:plan [feature]

# 2. SPEC
npx claude-flow@alpha sparc run spec-pseudocode "[feature]"

# 3. TEST-FIRST (strict: ALL tests before ANY implementation)
npx claude-flow@alpha swarm init --topology hierarchical
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
```
</details>

---

### Idea → TDD Swarm

**Say:** "I have an idea for [rough concept]" or "Help me build [half-baked idea]"
**Slash:** `/w-idea-tdd-swarm [idea]`

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
```
• What problem does this solve? Who benefits?
• What does "done" look like? Be specific.
• What are the must-have vs nice-to-have features?
• What are the constraints? (time, tech, security)
• What could go wrong? Edge cases?
• How will we test this works correctly?
• Does this integrate with existing code?
```

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
```
Memory: project/ideas/[idea-name]
Doc: docs/solutions/ideas/[idea-name].md
Pattern: interview answers + refined spec + implementation
```

**Example:**
```
User: /w-idea-tdd-swarm I want some kind of caching layer for the API
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
```

<details>
<summary>Under the hood</summary>

```bash
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
```
</details>

---

## Bug Fix Workflows

### Quick Fix

**Say:** "Quick fix for [bug description]"
**Slash:** `/w-fix [bug]`

**What it does:** Fast investigation → targeted fix → verification.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Similar bugs fixed before |
| 1 | Investigation | Root cause analysis |
| 2 | Fix applied | Changes before testing |
| 3 | Compound | Bug pattern to store |

**Compounds:**
```
Memory: project/bugs/[bug-category]
Doc: docs/solutions/bugs/[bug-name].md
Pattern: root cause + fix approach
```

**Example:**
```
User: Quick fix for users getting logged out after password reset
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "bugs/*auth*" }

# Execute
# Search codebase, analyze, apply minimal fix, run tests

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/bugs/auth-logout-reset" }
/compound-engineering:workflows:compound
```
</details>

---

### Deep Debug → TDD Swarm

**Say:** "Debug workflow for [issue]"
**Slash:** `/w-debug [issue]`

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
```
Memory: project/debugging/[issue-category]
Doc: docs/solutions/debugging/[issue-name].md
Pattern: root cause + regression tests + fix approach
```

**Example:**
```
User: Debug workflow for intermittent API timeouts in production
```

<details>
<summary>Under the hood</summary>

```bash
# Phase 1: Debug Investigation
mcp__claude-flow__memory_search { pattern: "debugging/*timeout*" }
npx claude-flow@alpha sparc debugger "[issue]"
Task("analyst", "Analyze patterns...", "analyst")
Task("git-history-analyzer", "Check recent changes...", "researcher")
# CHECKPOINT: Root cause confirmed

# Phase 2: TDD-Swarm Fix
/compound-engineering:workflows:plan
Task("tester", "Write regression tests that reproduce bug", "tester")
# GATE: npm run test → MUST FAIL (bug still exists)
npx claude-flow@alpha swarm init --topology hierarchical
Task("coder", "Implement fix to pass tests", "coder")
# VERIFY: npm run test → ALL MUST PASS
/compound-engineering:workflows:review

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/debugging/api-timeouts" }
/compound-engineering:workflows:compound
```
</details>

---

### Critical Hotfix

**Say:** "Critical hotfix for [issue]"
**Slash:** `/w-hotfix [issue]`

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
```
Memory: project/incidents/[incident-type]
Doc: docs/solutions/incidents/[incident-name].md
Pattern: incident response + prevention measures
```

**Example:**
```
User: Critical hotfix for SQL injection vulnerability in search endpoint
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "incidents/*sql*" }

# Execute
git worktree add ../hotfix-branch hotfix/[issue]
npx claude-flow@alpha swarm init --topology star
Task("security-sentinel", "Security review...", "reviewer")

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/incidents/sql-injection-search" }
/compound-engineering:workflows:compound
```
</details>

---

## Review Workflows

### Full Review

**Say:** "Full review of PR [number]"
**Slash:** `/w-review [PR#]`

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
```
Memory: project/reviews/[pr-topic]
Doc: docs/solutions/reviews/[pr-number].md
Pattern: key findings + recommendations applied
```

**Example:**
```
User: Full review of PR 47
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "reviews/*" }

# Execute
/compound-engineering:workflows:review PR#47
# Runs: code-simplicity-reviewer, security-sentinel, performance-oracle,
#       architecture-strategist, pattern-recognition-specialist

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/reviews/pr-47-auth" }
/compound-engineering:workflows:compound
```
</details>

---

### Security Audit

**Say:** "Security audit on [target]"
**Slash:** `/w-security [target]`

**What it does:** OWASP top 10, auth/authz, data exposure analysis.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past security findings in this area |
| 1 | Scan complete | Vulnerability findings |
| 2 | Analysis done | Risk assessment and priorities |
| 3 | Compound | Security patterns to store |

**Compounds:**
```
Memory: project/security/[target-area]
Doc: docs/solutions/security/[audit-name].md
Pattern: vulnerabilities found + remediation applied
```

**Example:**
```
User: Security audit on the authentication module
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "security/*auth*" }

# Execute
Task("security-sentinel", "Full security scan...", "reviewer")
# Checks: SQL injection, XSS, CSRF, auth bypass, secrets, input validation

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/security/auth-module" }
/compound-engineering:workflows:compound
```
</details>

---

### Performance Audit

**Say:** "Performance audit on [target]"
**Slash:** `/w-perf [target]`

**What it does:** Bottlenecks, N+1 queries, memory issues, optimization opportunities.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past performance optimizations |
| 1 | Profiling done | Bottleneck identification |
| 2 | Analysis complete | Prioritized recommendations |
| 3 | Compound | Performance patterns to store |

**Compounds:**
```
Memory: project/performance/[target-area]
Doc: docs/solutions/performance/[audit-name].md
Pattern: bottlenecks found + optimizations applied
```

**Example:**
```
User: Performance audit on the dashboard loading
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "performance/*dashboard*" }

# Execute
Task("performance-oracle", "Profile and analyze...", "analyst")
npx claude-flow@alpha analysis bottleneck-detect

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/performance/dashboard" }
/compound-engineering:workflows:compound
```
</details>

---

## Architecture Workflows

### Hive-Mind Architecture

**Say:** "Hive-mind architecture for [system]"
**Slash:** `/w-architect [system]`

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
```
Memory: project/architecture/[system-name]
Doc: docs/solutions/architecture/[system-name]-adr.md
Pattern: decision rationale + trade-offs considered
```

**Example:**
```
User: Hive-mind architecture for microservices migration
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "architecture/*microservices*" }

# Execute
npx claude-flow@alpha hive-mind init
Task("system-architect", "Design system...", "architect")
Task("analyst", "Analyze trade-offs...", "analyst")
mcp__claude-flow__collective-intelligence-coordinator

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/architecture/microservices" }
/compound-engineering:workflows:compound
```
</details>

---

### Multi-Repository

**Say:** "Multi-repo workflow for [task]"
**Slash:** `/w-multi-repo [task]`

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
```
Memory: project/multi-repo/[task-name]
Doc: docs/solutions/multi-repo/[task-name].md
Pattern: coordination approach + dependency handling
```

**Example:**
```
User: Multi-repo workflow for updating shared auth library across all repos
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "multi-repo/*" }

# Execute
npx claude-flow@alpha swarm init --topology mesh
Task("multi-repo-swarm", "Coordinate changes...", "coordinator")
npx claude-flow@alpha github multi-repo --repos "frontend,backend,mobile"

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/multi-repo/auth-library-update" }
/compound-engineering:workflows:compound
```
</details>

---

## Utility Workflows

### Compound This

**Say:** "Compound this solution" or "Document what we just solved"
**Slash:** `/w-compound [category]`

**What it does:** Captures current context as reusable knowledge (ad-hoc).

**Example:**
```
User: Compound this solution
Claude: What category? (feature/bug/security/performance/architecture)
User: bug
Claude: Stored as project/bugs/[auto-named] + created docs/solutions/bugs/[name].md
```

---

### Search Solutions

**Say:** "Search for solutions to [problem]" or "What patterns exist for [category]?"
**Slash:** `/w-search [query]`

**What it does:** Searches memory and solution docs for relevant past work.

**Example:**
```
User: Search for solutions to authentication issues
Claude: Found 3 matches:
  - project/bugs/auth-logout-reset (Dec 2024)
  - project/features/oauth2-google (Nov 2024)
  - project/security/auth-module (Oct 2024)
```

---

## Ralph Wiggum Workflows

Iterative AI development methodology - a "simple while loop that repeatedly feeds an AI agent a prompt until completion."

**Core concept:**
```bash
while :; do cat PROMPT.md | claude ; done
```

**Best for:** Greenfield projects, TDD cycles, overnight automation, measurable completion tasks.

---

### Ralph This

**Say:** "Ralph this [prompt]" or "Run a Ralph loop on [file]"
**Slash:** `/w-ralph-this [prompt or file path]`

**What it does:** Run a Ralph Wiggum iterative loop on a prompt or file until completion.

**Parameters:**
- **Prompt**: Inline text or path to a .md file
- **Max Iterations**: Safety limit (default: 10)
- **Completion Promise**: Exact string that signals done (e.g., "DONE", "ALL_TESTS_PASS")

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Load | Prompt content and config |
| 1 | Each iteration | Progress and state |
| 2 | Completion | Final result |
| 3 | Compound | Pattern to store |

**Example:**
```
/w-ralph-this "Build a REST API with full test coverage. When all tests pass, output COMPLETE."
/w-ralph-this .claude/plans/api-spec.md
```

<details>
<summary>Under the hood</summary>

```bash
# Load prompt
content = Read(file_path) OR inline prompt
completionSignal = extract_completion_promise(content)
maxIterations = 10

# Ralph loop
for (i = 0; i < maxIterations; i++) {
  result = Task("executor", content)
  if (result.contains(completionSignal)) {
    break  # Done!
  }
  # Continue to next iteration
}

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/ralph/[name]" }
```
</details>

---

### Ralph Goals

**Say:** "Ralph goals for [rough idea]" or "Build me a Ralph spec for [concept]"
**Slash:** `/w-ralph-goals [idea]`

**What it does:** Interactive interview to build an optimal Ralph Wiggum spec from a rough idea.

**Interview Flow:**
1. **Capture Idea** - Get the rough concept
2. **Interview** - Clarify completion criteria, phases, testing, limits
3. **Build Spec** - Generate a Ralph-ready prompt
4. **Save** - Write to `.claude/plans/YYYY-MM-DD-[name]-ralph.md`
5. **Execute?** - Optionally run `/w-ralph-this` on it

**Interview Questions:**
```
• What specific output signals that the task is complete?
• What are the major phases or milestones?
• How can each phase be automatically verified?
• What's a reasonable max iteration limit?
• Should the loop include self-testing cycles?
```

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Idea captured | Initial concept |
| 1 | Interview | Answers and clarity |
| 2 | Spec built | Generated Ralph prompt |
| 3 | Execute? | Option to run immediately |

**Compounds:**
```
Memory: project/ralph-specs/[idea-name]
Doc: .claude/plans/YYYY-MM-DD-[name]-ralph.md
Pattern: interview answers + optimized prompt
```

**Example:**
```
User: /w-ralph-goals I want to build a CLI tool
Claude: Let me help you build a Ralph spec for this...
  - What signals completion? "All CLI commands work"? "Tests pass"?
  - What are the phases? Init → Core commands → Help → Tests?
  - How to verify each phase? Unit tests? Integration tests?
  - Max iterations? 10? 20?
  ...
Claude: [Checkpoint 2] Here's your Ralph spec:
  ---
  # CLI Tool Ralph Spec
  ## Completion Signal: ALL_TESTS_PASS
  ## Max Iterations: 15
  ## Prompt:
  Build a CLI tool with the following commands...
  When all tests pass, output "ALL_TESTS_PASS"
  ---
User: Run it
Claude: [Executes /w-ralph-this on the spec]
```

<details>
<summary>Under the hood</summary>

```bash
# Interview
AskUserQuestion("What signals completion?", options)
AskUserQuestion("What are the phases?", options)
AskUserQuestion("How to verify each phase?", options)
AskUserQuestion("Max iterations?", options)
AskUserQuestion("Include self-testing?", options)

# Build spec
prompt = generate_ralph_prompt(answers)
filename = `YYYY-MM-DD-[name]-ralph.md`
Write(filename, prompt)

# Execute?
AskUserQuestion("Run this Ralph spec now?", ["Yes", "No"])
if (yes) {
  /w-ralph-this [filename]
}

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/ralph-specs/[name]" }
```
</details>

---

## Quick Reference

### Workflow Summary

| Workflow | Slash | Natural Language | Best For |
|----------|-------|------------------|----------|
| Cold-Start | `/w-start` | "start session with [plan]" | Resume without --resume |
| End Session | `/w-end` | "end session" | Compound and commit before disconnect |
| Full TDD Swarm | `/w-tdd-swarm` | "Full TDD Swarm on [X]" | New features (recommended) |
| Idea → TDD Swarm | `/w-idea-tdd-swarm` | "I have an idea for [X]" | Half-baked ideas → features |
| Swarm Build | `/w-swarm` | "swarm to build [X]" | Parallel implementation |
| Full Cycle | - | "full cycle workflow on [X]" | Features without strict TDD |
| TDD | - | "TDD workflow for [X]" | Simple test-first |
| Quick Fix | `/w-fix` | "quick fix for [X]" | Simple bugs |
| Deep Debug → TDD | `/w-debug` | "debug workflow for [X]" | Complex issues with regression tests |
| Hotfix | `/w-hotfix` | "critical hotfix for [X]" | Production emergencies |
| Full Review | `/w-review` | "full review of PR [#]" | Comprehensive review |
| Security Audit | `/w-security` | "security audit on [X]" | Security analysis |
| Perf Audit | `/w-perf` | "performance audit on [X]" | Optimization |
| Hive Architect | `/w-architect` | "hive-mind architecture for [X]" | Complex design |
| Multi-Repo | `/w-multi-repo` | "multi-repo workflow for [X]" | Cross-repo changes |
| Compound This | `/w-compound` | "compound this solution" | Ad-hoc capture |
| Search Solutions | `/w-search` | "search for solutions to [X]" | Find past work |
| Ralph Loop | `/w-ralph-this` | "ralph this [prompt]" | Iterative AI loop |
| Ralph Spec | `/w-ralph-goals` | "ralph goals for [idea]" | Build Ralph prompt |

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
| `project/features/*` | Feature implementations |
| `project/bugs/*` | Bug fixes |
| `project/security/*` | Security findings |
| `project/performance/*` | Performance optimizations |
| `project/architecture/*` | Design decisions |
| `project/reviews/*` | Review findings |
| `project/incidents/*` | Incident responses |

---

## Tips

1. **Be specific** - More detail = better pattern matching
2. **Review checkpoint 0** - Past solutions may already solve your problem
3. **Name patterns well** - Good names make future searches easier
4. **Trust the compound** - Don't skip the final checkpoint
5. **Search first manually** - "Search for solutions to [X]" before starting if unsure
