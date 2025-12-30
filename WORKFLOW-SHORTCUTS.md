# Workflow Shortcuts

Natural language workflows that **compound knowledge** - each task makes future tasks easier.

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

## Development Workflows

### Full Cycle Development

**Say:**
> "Run the full cycle workflow on [feature]"

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

**Say:**
> "Use swarm to build [task]"

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

**Say:**
> "TDD workflow for [feature]"

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

**Say:**
> "Full TDD Swarm on [feature]"

**What it does:** Combines planning (Full Cycle) + test-first (TDD) + parallel build (Swarm) + comprehensive review.

**Philosophy:** Plan like Full Cycle, test like TDD, build like Swarm.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past solutions, TDD patterns, implementations |
| 1 | Plan | Architecture, files, approach |
| 2 | Spec | Acceptance criteria, test cases |
| 3 | Tests | Test files (must fail - no implementation yet) |
| 4 | Build | Implementation (tests must pass) |
| 5 | Review | Security, performance, patterns, architecture |
| 6 | Compound | Complete solution summary |

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

## Bug Fix Workflows

### Quick Fix

**Say:**
> "Quick fix for [bug description]"

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

### Deep Debug

**Say:**
> "Debug workflow for [issue]"

**What it does:** Thorough multi-angle analysis: code, git history, performance profiling.

**Checkpoints:**
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Related debugging sessions |
| 1 | Analysis | Initial findings and hypotheses |
| 2 | Investigation | Confirmed root cause |
| 3 | Fix proposal | Proposed solution approach |
| 4 | Verification | Fix applied and tested |
| 5 | Compound | Root cause analysis to store |

**Compounds:**
```
Memory: project/debugging/[issue-category]
Doc: docs/solutions/debugging/[issue-name].md
Pattern: investigation approach + root cause + prevention
```

**Example:**
```
User: Debug workflow for intermittent API timeouts in production
```

<details>
<summary>Under the hood</summary>

```bash
# Search
mcp__claude-flow__memory_search { pattern: "debugging/*timeout*" }

# Execute
npx claude-flow@alpha sparc debugger "[issue]"
Task("analyst", "Analyze patterns...", "analyst")
Task("git-history-analyzer", "Check recent changes...", "researcher")

# Compound
mcp__claude-flow__memory_usage { action: "store", key: "project/debugging/api-timeouts" }
/compound-engineering:workflows:compound
```
</details>

---

### Critical Hotfix

**Say:**
> "Critical hotfix for [issue]"

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

**Say:**
> "Full review of PR [number]"

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

**Say:**
> "Security audit on [target]"

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

**Say:**
> "Performance audit on [target]"

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

**Say:**
> "Hive-mind architecture for [system]"

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

**Say:**
> "Multi-repo workflow for [task]"

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

**Say:**
> "Compound this solution"
> "Document what we just solved"

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

**Say:**
> "Search for solutions to [problem]"
> "What patterns exist for [category]?"

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

## Quick Reference

### Workflow Summary

| Workflow | Trigger | Best For |
|----------|---------|----------|
| Full Cycle | "full cycle workflow on [X]" | New features |
| Swarm Build | "swarm to build [X]" | Parallel implementation |
| TDD | "TDD workflow for [X]" | Test-first development |
| Full TDD Swarm | "Full TDD Swarm on [X]" | Critical features (speed + quality) |
| Quick Fix | "quick fix for [X]" | Simple bugs |
| Deep Debug | "debug workflow for [X]" | Complex issues |
| Hotfix | "critical hotfix for [X]" | Production emergencies |
| Full Review | "full review of PR [#]" | Comprehensive review |
| Security Audit | "security audit on [X]" | Security analysis |
| Perf Audit | "performance audit on [X]" | Optimization |
| Hive Architect | "hive-mind architecture for [X]" | Complex design |
| Multi-Repo | "multi-repo workflow for [X]" | Cross-repo changes |
| Compound This | "compound this solution" | Ad-hoc capture |
| Search Solutions | "search for solutions to [X]" | Find past work |

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
