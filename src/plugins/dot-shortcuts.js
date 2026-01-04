/**
 * Dot Shortcuts Plugin for Danizee Claude Suite
 * Provides quick `/.` prefixed slash commands for all workflows
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Get all dot shortcut commands
 */
export function getCommands() {
  return {
    '.swarm': {
      name: '.swarm',
      description: 'Swarm Build - Parallel agents for rapid implementation',
      content: `# /.swarm

Swarm Build - Spawns parallel agents (coder, tester, reviewer) for rapid implementation.

## Usage
\`\`\`
/.swarm [task description]
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
/.swarm REST API for user management with CRUD and tests
\`\`\`
`
    },

    '.tdd-swarm': {
      name: '.tdd-swarm',
      description: 'Full TDD Swarm - Plan + TDD + Swarm + Review combined',
      content: `# /.tdd-swarm

Full TDD Swarm - Combines planning + test-first + parallel build + comprehensive review.

**Philosophy:** Plan like Full Cycle, test like TDD, build like Swarm.

## Usage
\`\`\`
/.tdd-swarm [feature description]
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
/.tdd-swarm user authentication with JWT tokens
\`\`\`
`
    },

    '.fix': {
      name: '.fix',
      description: 'Quick Fix - Fast bug investigation and targeted fix',
      content: `# /.fix

Quick Fix - Fast investigation → targeted fix → verification.

## Usage
\`\`\`
/.fix [bug description]
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
/.fix users getting logged out after password reset
\`\`\`
`
    },

    '.debug': {
      name: '.debug',
      description: 'Deep Debug - Thorough multi-angle analysis',
      content: `# /.debug

Deep Debug - Thorough multi-angle analysis: code, git history, performance profiling.

## Usage
\`\`\`
/.debug [issue description]
\`\`\`

## What Happens
1. **Search** - Find related debugging sessions
2. **Analyze** - Form initial hypotheses
3. **Investigate** - Deep dive with multiple tools
4. **Diagnose** - Confirm root cause
5. **Fix** - Apply and verify solution
6. **Compound** - Store root cause analysis

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Related debugging sessions |
| 1 | Analysis | Initial findings and hypotheses |
| 2 | Investigation | Confirmed root cause |
| 3 | Fix proposal | Proposed solution approach |
| 4 | Verification | Fix applied and tested |
| 5 | Compound | Root cause analysis to store |

## Compounds
\`\`\`
Memory: project/debugging/[issue-category]
Doc: docs/solutions/debugging/[issue-name].md
\`\`\`

## Example
\`\`\`
/.debug intermittent API timeouts in production
\`\`\`
`
    },

    '.hotfix': {
      name: '.hotfix',
      description: 'Critical Hotfix - Isolated branch, minimal fix, security review',
      content: `# /.hotfix

Critical Hotfix - Isolated branch → minimal fix → security-focused review → expedited PR.

## Usage
\`\`\`
/.hotfix [issue description]
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
/.hotfix SQL injection vulnerability in search endpoint
\`\`\`
`
    },

    '.review': {
      name: '.review',
      description: 'Full Review - 12+ specialized agents analyze code',
      content: `# /.review

Full Review - 12+ specialized agents analyze code, security, performance, architecture.

## Usage
\`\`\`
/.review [PR number or description]
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
/.review PR 47
\`\`\`
`
    },

    '.security': {
      name: '.security',
      description: 'Security Audit - OWASP top 10, auth/authz, data exposure',
      content: `# /.security

Security Audit - OWASP top 10, auth/authz, data exposure analysis.

## Usage
\`\`\`
/.security [target description]
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
/.security authentication module
\`\`\`
`
    },

    '.perf': {
      name: '.perf',
      description: 'Performance Audit - Bottlenecks, N+1 queries, memory issues',
      content: `# /.perf

Performance Audit - Bottlenecks, N+1 queries, memory issues, optimization opportunities.

## Usage
\`\`\`
/.perf [target description]
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
/.perf dashboard loading
\`\`\`
`
    },

    '.architect': {
      name: '.architect',
      description: 'Hive-Mind Architecture - Collective intelligence for complex design',
      content: `# /.architect

Hive-Mind Architecture - Multiple agents collaborate with collective intelligence for complex design.

## Usage
\`\`\`
/.architect [system description]
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
/.architect microservices migration
\`\`\`
`
    },

    '.multi-repo': {
      name: '.multi-repo',
      description: 'Multi-Repository - Coordinate changes across repos',
      content: `# /.multi-repo

Multi-Repository - Coordinates changes across repos with dependency awareness.

## Usage
\`\`\`
/.multi-repo [task description]
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
/.multi-repo updating shared auth library across all repos
\`\`\`
`
    },

    '.compound': {
      name: '.compound',
      description: 'Compound This - Capture current context as reusable knowledge',
      content: `# /.compound

Compound This - Captures current context as reusable knowledge (ad-hoc).

## Usage
\`\`\`
/.compound [category]
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
/.compound feature
# Stores to: project/features/[auto-named]
# Creates: docs/solutions/features/[name].md
\`\`\`
`
    },

    '.search': {
      name: '.search',
      description: 'Search Solutions - Find relevant past work',
      content: `# /.search

Search Solutions - Searches memory and solution docs for relevant past work.

## Usage
\`\`\`
/.search [query]
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
/.search authentication issues
# Returns:
#   - project/bugs/auth-logout-reset (Dec 2024)
#   - project/features/oauth2-google (Nov 2024)
#   - project/security/auth-module (Oct 2024)
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
