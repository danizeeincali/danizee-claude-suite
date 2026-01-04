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

## What Happens
1. **Search** - Find related implementation patterns
2. **Spawn** - Initialize hierarchical swarm topology
3. **Execute** - Parallel agents work on components
4. **Integrate** - Combine and verify results
5. **Compound** - Store implementation pattern

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Related implementation patterns |
| 1 | Agent spawn | Agent assignments and strategy |
| 2 | Execution | Completed work before integration |
| 3 | Compound | Implementation pattern to store |

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

## What Happens
1. **Search** - Check features, TDD patterns, implementations
2. **Plan** - Architecture and approach
3. **Spec** - Acceptance criteria and test cases
4. **Test-First** - ALL tests written (must fail initially)
5. **Build** - Swarm implements to pass tests
6. **Review** - Security, performance, architecture
7. **Compound** - Store complete solution

## Strict TDD Rule
Build phase is **BLOCKED** until all tests are written and failing.

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past solutions, TDD patterns, implementations |
| 1 | Plan | Architecture, files, approach |
| 2 | Spec | Acceptance criteria, test cases |
| 3 | Tests | Test files (must fail - no implementation yet) |
| 4 | Build | Implementation (tests must pass) |
| 5 | Review | Security, performance, patterns, architecture |
| 6 | Compound | Complete solution summary |

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

## What Happens

### Phase 1: Deep Interview
1. **Detect Input** - File path or inline description
2. **Load Context** - Read relevant project docs if mentioned
3. **Interview** - One question at a time (see below)
4. **Capture Quotes** - Note verbatim moments of clarity
5. **Final Question** - "What did I forget to ask about?"
6. **Save Spec** - Write to .claude/plans/YYYY-MM-DD-[name].md

### Phase 2: Full TDD Swarm
7. **Plan** - Architecture based on refined spec
8. **Spec** - Acceptance criteria from interview
9. **Test-First** - ALL tests written (must fail)
10. **Build** - Swarm implements to pass tests
11. **Review** - Security, performance, architecture
12. **Compound** - Store complete solution

## Interview Categories

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

## Interview Rules
- Ask ONE question at a time
- Go deep on answers revealing uncertainty or assumptions
- Don't ask obvious questions - push on unthought things
- Capture quotable moments verbatim for the spec

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past solutions, patterns |
| 1 | Interview | Refined spec from questions |
| 2 | Plan | Architecture, files, approach |
| 3 | Spec | Acceptance criteria, test cases |
| 4 | Tests | Test files (must fail) |
| 5 | Build | Implementation (tests pass) |
| 6 | Review | Security, performance, patterns |
| 7 | Compound | Complete solution summary |

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

## What Happens
1. **Search** - Find similar bugs fixed before
2. **Investigate** - Identify root cause
3. **Fix** - Apply minimal targeted fix
4. **Verify** - Run tests
5. **Compound** - Store bug pattern

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Similar bugs fixed before |
| 1 | Investigation | Root cause analysis |
| 2 | Fix applied | Changes before testing |
| 3 | Compound | Bug pattern to store |

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

## What Happens

### Phase 1: Debug Investigation
1. **Search** - Find related debugging sessions
2. **Analyze** - Form initial hypotheses
3. **Investigate** - Deep dive with multiple tools
4. **Diagnose** - Confirm root cause

### Phase 2: TDD-Swarm Fix
5. **Plan** - Architecture for the fix based on diagnosis
6. **Spec** - Test cases that would have caught this bug
7. **Test-First** - Write regression tests (must fail with current code)
8. **Build** - Swarm implements the fix to pass tests
9. **Review** - Security, performance, ensure no regressions
10. **Compound** - Store root cause + fix pattern

## Strict TDD Rule
Fix phase is **BLOCKED** until regression tests are written and failing.

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Related debugging sessions |
| 1 | Analysis | Initial findings and hypotheses |
| 2 | Diagnosis | Confirmed root cause |
| 3 | Plan | Fix architecture based on diagnosis |
| 4 | Tests | Regression tests (must fail) |
| 5 | Build | Fix implementation (tests pass) |
| 6 | Review | Security, performance, no regressions |
| 7 | Compound | Root cause + fix pattern to store |

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

## What Happens
1. **Search** - Find similar incidents
2. **Isolate** - Create hotfix branch
3. **Fix** - Apply minimal targeted change
4. **Security Review** - Focused security analysis
5. **Compound** - Store incident documentation

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Similar incidents |
| 1 | Branch created | Isolated hotfix branch |
| 2 | Fix applied | Minimal change for review |
| 3 | Security review | Security analysis complete |
| 4 | Compound | Incident doc to store |

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

## What Happens
1. **Search** - Find past review patterns for this code area
2. **Code Analysis** - Style, patterns, quality
3. **Security Scan** - Vulnerability detection
4. **Performance Check** - Optimization opportunities
5. **Architecture Review** - Design patterns
6. **Compound** - Store review findings

## Agents Deployed
- code-simplicity-reviewer
- security-sentinel
- performance-oracle
- architecture-strategist
- pattern-recognition-specialist

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past review patterns for this code area |
| 1 | Code analysis | Style, patterns, quality findings |
| 2 | Security scan | Vulnerability report |
| 3 | Performance check | Optimization opportunities |
| 4 | Compound | Review findings to store |

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

## What Happens
1. **Search** - Find past security findings in this area
2. **Scan** - Run comprehensive security checks
3. **Analyze** - Risk assessment and prioritization
4. **Compound** - Store security patterns

## Checks Performed
- SQL injection
- XSS (Cross-Site Scripting)
- CSRF (Cross-Site Request Forgery)
- Authentication bypass
- Secrets exposure
- Input validation
- Authorization flaws

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past security findings in this area |
| 1 | Scan complete | Vulnerability findings |
| 2 | Analysis done | Risk assessment and priorities |
| 3 | Compound | Security patterns to store |

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

## What Happens
1. **Search** - Find past performance optimizations
2. **Profile** - Identify bottlenecks
3. **Analyze** - Prioritize recommendations
4. **Compound** - Store performance patterns

## Checks Performed
- N+1 query detection
- Memory leak analysis
- CPU bottlenecks
- I/O optimization
- Caching opportunities
- Bundle size analysis

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past performance optimizations |
| 1 | Profiling done | Bottleneck identification |
| 2 | Analysis complete | Prioritized recommendations |
| 3 | Compound | Performance patterns to store |

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

## What Happens
1. **Search** - Find related architecture decisions
2. **Initialize** - Set up hive-mind collaboration
3. **Design** - Multiple agents propose options
4. **Consensus** - Converge on recommended design
5. **Compound** - Store architecture decision record

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Related architecture decisions |
| 1 | Hive initialized | Agent assignments |
| 2 | Design proposals | Multiple architecture options |
| 3 | Consensus reached | Final recommended design |
| 4 | Compound | Architecture decision record |

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

## What Happens
1. **Search** - Find past multi-repo coordination patterns
2. **Analyze** - Map dependencies between repos
3. **Plan** - Coordinate change order
4. **Execute** - Apply changes across repos
5. **Compound** - Store coordination pattern

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past multi-repo coordination patterns |
| 1 | Repos analyzed | Dependency map and change plan |
| 2 | Changes prepared | Per-repo changes for review |
| 3 | Sync complete | All repos updated |
| 4 | Compound | Coordination pattern to store |

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

## What Happens
1. Searches memory namespaces for matching patterns
2. Scans docs/solutions/ for relevant documentation
3. Returns ranked matches with dates

## Memory Namespaces Searched
- \`project/features/*\`
- \`project/bugs/*\`
- \`project/security/*\`
- \`project/performance/*\`
- \`project/architecture/*\`
- \`project/reviews/*\`
- \`project/incidents/*\`

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

## What Happens
1. **Read Plan** - Load specified plan file (or MASTER_PLAN.md)
2. **Search Claude-Flow Memories** - Query project/* namespaces for stored patterns
3. **Scan Compound Docs** - Read docs/solutions/ for compound-engineering knowledge
4. **Check Git** - Recent commits, current branch, uncommitted changes
5. **Summarize** - Present context summary
6. **Ask** - "What would you like to work on?"

## Memory Sources
- **Claude-Flow**: project/features/*, project/bugs/*, project/implementations/*, etc.
- **Compound Engineering**: docs/solutions/ markdown files
- **Git**: Recent commits and current branch state

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

## What Happens
1. **Compound** - Store session patterns to claude-flow memory
2. **Update Docs** - Write/update docs/solutions/ with session learnings
3. **Commit** - Stage all changes and commit with session summary
4. **Summarize** - Recap what was accomplished this session
5. **Goodbye** - "See you later! Run \\\`/w-start\\\` to resume."

## Memory Storage
- Claude-Flow: project/[category]/[auto-named]
- Compound Doc: docs/solutions/[category]/[name].md

## What Gets Captured
- Problems solved and approaches used
- Key decisions made
- Patterns discovered
- Files modified
- Tests added/changed

## Example
\`\`\`
/w-end
/w-end feature
/w-end bug
\`\`\`

## Next Session
Run \\\`/w-start\\\` to load this session's context and continue where you left off.
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
