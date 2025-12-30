# Danizee Claude Suite

Unified workflow shortcuts for Claude Code that **compound knowledge** - each task makes future tasks easier.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/danizeeincali/danizee-claude-suite.git
cd danizee-claude-suite

# Install dependencies
npm install

# Initialize in your project
cd /path/to/your/project
node /path/to/danizee-claude-suite/bin/cli.js init
```

## Requirements

- Node.js >= 18.0.0
- Claude Flow MCP server (`npx claude-flow@alpha mcp start`)

## How It Works

Every workflow follows the **Search → Execute → Compound** pattern:

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

**Result**: The 2nd time you solve a similar problem, it's faster because the workflow finds and applies your previous solution.

## Available Workflows

### Development
| Workflow | Trigger | Best For |
|----------|---------|----------|
| Full Cycle | "Run the full cycle workflow on [X]" | New features |
| Swarm Build | "Use swarm to build [X]" | Parallel implementation |
| TDD | "TDD workflow for [X]" | Test-first development |
| Full TDD Swarm | "Full TDD Swarm on [X]" | Critical features |

### Bug Fixes
| Workflow | Trigger | Best For |
|----------|---------|----------|
| Quick Fix | "Quick fix for [X]" | Simple bugs |
| Deep Debug | "Debug workflow for [X]" | Complex issues |
| Critical Hotfix | "Critical hotfix for [X]" | Production emergencies |

### Reviews
| Workflow | Trigger | Best For |
|----------|---------|----------|
| Full Review | "Full review of PR [#]" | Comprehensive review |
| Security Audit | "Security audit on [X]" | Security analysis |
| Performance Audit | "Performance audit on [X]" | Optimization |

### Architecture
| Workflow | Trigger | Best For |
|----------|---------|----------|
| Hive Architect | "Hive-mind architecture for [X]" | Complex design |
| Multi-Repo | "Multi-repo workflow for [X]" | Cross-repo changes |

### Utilities
| Workflow | Trigger | Best For |
|----------|---------|----------|
| Compound This | "Compound this solution" | Ad-hoc capture |
| Search Solutions | "Search for solutions to [X]" | Find past work |

## CLI Commands

```bash
# Initialize suite in current project
node bin/cli.js init

# Check installation status
node bin/cli.js check

# Update existing installation
node bin/cli.js update

# Remove suite
node bin/cli.js uninstall

# Preview changes (dry run)
node bin/cli.js init --dry-run

# Force overwrite existing
node bin/cli.js init --force
```

## What Gets Installed

```
your-project/
├── .claude/
│   ├── commands/
│   │   ├── workflows/      # plan, work, review, compound
│   │   ├── coordination/   # swarm-init, agent-spawn, memory-ops
│   │   └── analysis/       # design, component, layout, theme
│   ├── helpers/
│   │   ├── quick-start.sh
│   │   └── setup-mcp.sh
│   └── settings.json       # Suite configuration
├── docs/
│   └── solutions/          # Compounded solution docs
│       ├── features/
│       ├── bugs/
│       ├── security/
│       └── ...
└── WORKFLOW-SHORTCUTS.md   # Complete workflow reference
```

## Memory Namespaces

| Namespace | Contents |
|-----------|----------|
| `project/features/*` | Feature implementations |
| `project/bugs/*` | Bug fixes |
| `project/security/*` | Security findings |
| `project/performance/*` | Performance optimizations |
| `project/architecture/*` | Design decisions |
| `project/reviews/*` | Review findings |
| `project/incidents/*` | Incident responses |

## Included Plugins

### Claude Flow
Multi-agent orchestration with memory and swarm support.
- Swarm topologies: hierarchical, mesh, ring, star
- Agents: coder, tester, reviewer, security-sentinel, performance-oracle, etc.
- Memory operations for knowledge compounding

### Compound Engineering
Systematic feature development workflows.
- Plan: Feature planning with codebase analysis
- Work: Isolated implementation with worktrees
- Review: Multi-agent code review
- Compound: Knowledge storage and learning

### Frontend Design
UI component generation utilities.
- Design: Component specifications
- Component: Framework-specific implementations (React/Vue/Svelte)
- Layout: Page layouts and grids
- Theme: Design tokens and theming

## Tips

1. **Be specific** - More detail = better pattern matching
2. **Review checkpoint 0** - Past solutions may already solve your problem
3. **Name patterns well** - Good names make future searches easier
4. **Trust the compound** - Don't skip the final checkpoint
5. **Search first manually** - "Search for solutions to [X]" before starting if unsure

## License

MIT
