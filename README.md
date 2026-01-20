# Danizee Claude Suite

[![npm version](https://badge.fury.io/js/danizee-claude-suite.svg)](https://www.npmjs.com/package/danizee-claude-suite)

Unified workflow shortcuts for Claude Code that **compound knowledge** - each task makes future tasks easier.

## Installation

```bash
# Install globally
npm install -g danizee-claude-suite

# Initialize in your project
cd /path/to/your/project
danizee-claude-suite init
```

Or use npx without installing:

```bash
npx danizee-claude-suite init
```

## Updating

When a new version is released:

```bash
# Update the npm package globally
npm update -g danizee-claude-suite

# Update your project's installed workflows
cd /path/to/your/project
danizee-claude-suite update
```

The `update` command regenerates all workflow shortcuts and documentation while preserving your existing candidates and solution docs.

## Requirements

- Node.js >= 20.0.0 (updated for Claude Flow 3.0)
- GitHub CLI (`gh`) - recommended for PR workflows

## Migrating to v2.0.0 (Claude Flow 3.0)

danizee-claude-suite v2.0.0 uses Claude Flow 3.0 (`claude-flow@v3alpha`).

### For New Installations

```bash
npm install -g danizee-claude-suite
cd /path/to/project
danizee-claude-suite init
```

### For Existing Installations

**Step 1: Update Node.js to v20+**
```bash
node --version  # Should show v20.x.x or higher
```

**Step 2: Update danizee-claude-suite**
```bash
npm update -g danizee-claude-suite
```

**Step 3: Update your project**
```bash
cd /path/to/your/project
danizee-claude-suite update
```

**Step 4: Migrate Claude Flow data (if you have existing data)**
```bash
# Backup first
cp -r ./data ./data-backup-v2
cp -r ./.claude-flow ./.claude-flow-backup-v2

# Check migration status
npx claude-flow@v3alpha migrate status

# Dry run first
npx claude-flow@v3alpha migrate run --dry-run

# Execute migration
npx claude-flow@v3alpha migrate run --from v2

# Verify
npx claude-flow@v3alpha migrate verify

# Initialize v3 learning
npx claude-flow@v3alpha hooks pretrain
npx claude-flow@v3alpha doctor --fix
```

### Breaking Changes in v2.0.0

| Change | Before | After |
|--------|--------|-------|
| Node.js minimum | 18.0.0 | 20.0.0 |
| Claude Flow package | `claude-flow@alpha` | `claude-flow@v3alpha` |
| MCP start command | `npx claude-flow@alpha mcp start` | `npx claude-flow@v3alpha mcp start` |

### Rollback

If you need to revert to the previous version:
```bash
npm install -g danizee-claude-suite@1.3.1
danizee-claude-suite update
```

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
│     → Check for Ralph candidates                │
└─────────────────────────────────────────────────┘
```

**Result**: The 2nd time you solve a similar problem, it's faster because the workflow finds and applies your previous solution.

## Quick Reference: /w- Shortcuts

All workflows use `/w-` prefix shortcuts:

| Shortcut | Description |
|----------|-------------|
| `/w-swarm` | Parallel agent build |
| `/w-tdd-swarm` | Full TDD + Swarm |
| `/w-idea-tdd-swarm` | Interview → TDD → Swarm |
| `/w-fix` | Quick bug fix |
| `/w-debug` | Deep debug → TDD fix |
| `/w-hotfix` | Critical production fix |
| `/w-review` | Multi-agent code review |
| `/w-security` | Security audit |
| `/w-perf` | Performance audit |
| `/w-architect` | Hive-mind architecture |
| `/w-multi-repo` | Cross-repo coordination |
| `/w-compound` | Ad-hoc knowledge capture |
| `/w-search` | Search past solutions |
| `/w-start` | Cold-start session |
| `/w-end` | End session + compound |
| `/w-ralph-this` | Ralph Wiggum loop |
| `/w-ralph-goals` | Build Ralph spec |
| `/w-ralph-pick` | Execute Ralph candidate |
| `/w-ralph-batch` | Batch process candidates |

## Workflows by Category

### Development

| Workflow | Command | Best For |
|----------|---------|----------|
| Swarm Build | `/w-swarm` | Parallel implementation with coder/tester/reviewer agents |
| Full TDD Swarm | `/w-tdd-swarm` | Plan → TDD → Swarm → Review combined |
| Idea to TDD | `/w-idea-tdd-swarm` | Interview refines idea, then Full TDD Swarm builds it |

### Bug Fixes

| Workflow | Command | Best For |
|----------|---------|----------|
| Quick Fix | `/w-fix` | Simple bugs - investigate → fix → verify |
| Deep Debug | `/w-debug` | Complex issues - hypothesis → diagnose → TDD fix |
| Critical Hotfix | `/w-hotfix` | Production emergencies - isolated branch + security review |

### Reviews & Audits

| Workflow | Command | Best For |
|----------|---------|----------|
| Full Review | `/w-review` | Comprehensive code review (12+ agents) |
| Security Audit | `/w-security` | OWASP top 10, auth/authz, data exposure |
| Performance Audit | `/w-perf` | N+1 queries, memory, bottlenecks |

### Architecture

| Workflow | Command | Best For |
|----------|---------|----------|
| Hive Architect | `/w-architect` | Collective intelligence for complex design |
| Multi-Repo | `/w-multi-repo` | Coordinate changes across repositories |

### Session Management

| Workflow | Command | Best For |
|----------|---------|----------|
| Cold Start | `/w-start` | Load project context when `--resume` unavailable |
| End Session | `/w-end` | Compound knowledge + commit for next session |

### Ralph Wiggum (Iterative AI Development)

| Workflow | Command | Best For |
|----------|---------|----------|
| Ralph Loop | `/w-ralph-this` | Iterate prompt until completion signal |
| Ralph Goals | `/w-ralph-goals` | Interview to build optimal Ralph spec |
| Ralph Pick | `/w-ralph-pick` | Select and execute a queued candidate |
| Ralph Batch | `/w-ralph-batch` | Batch process or generate overnight script |

### Utilities

| Workflow | Command | Best For |
|----------|---------|----------|
| Compound | `/w-compound` | Knowledge capture + auto-generate QA diagnostics |
| Search | `/w-search` | Find relevant past solutions |

## Ralph Candidates System

During compound phases, patterns suitable for future Ralph loops are logged to `.claude/ralph-candidates.md`:

```markdown
## Active Candidates
| ID | Priority | Name | Source | Completion Tests | Status |
|----|----------|------|--------|------------------|--------|
| RC-001 | P1 | API endpoints | /w-compound | 3 tests | ready |

## Active Diagnostics (Auto-generated by /w-compound)
| ID | Priority | Verifies | Triggers | Status |
|----|----------|----------|----------|--------|
| RC-D001 | P2 | getOrderBookDepth exists | RC-F001 | ready |

## Active Fixes (Only run if diagnostic fails)
| ID | Priority | Restores | Triggered By | Status |
|----|----------|----------|--------------|--------|
| RC-F001 | P1 | getOrderBookDepth function | RC-D001 | ready |
```

**Candidate ID Formats:**
| Format | Type | Purpose |
|--------|------|---------|
| RC-### | General | Standard Ralph candidates |
| RC-D### | Diagnostic | Verify patterns/code exists |
| RC-F### | Fix | Restore code if diagnostic fails |

**AI-Verifiable Completion Tests:**
- `File exists: path/to/file`
- `Pattern: "regex" in file`
- `Test: npm test -- --grep "name"`
- `Lint: npm run lint`
- `Build: npm run build`

**Batch Processing:**
```bash
# Generate overnight script
/w-ralph-batch --script

# Process by priority
/w-ralph-batch --priority P1

# Execute all ready candidates
/w-ralph-batch --all

# Phased execution (P1 → P2 → P3)
/w-ralph-batch --phased

# Run diagnostics first, fixes only if needed
/w-ralph-batch --diagnostics
```

**Diagnostic → Fix Flow:**
```
1. Run RC-D### diagnostic command
2. If STATUS: PASS → log "VERIFIED" → skip paired RC-F###
3. If STATUS: FAIL → run RC-F### → re-run RC-D### to verify
4. Report final status (VERIFIED | RESTORED | FAILED)
```

## CLI Commands

```bash
# Initialize suite in current project
danizee-claude-suite init

# Check installation status
danizee-claude-suite check

# Update existing installation (preserves your data)
danizee-claude-suite update

# Remove suite completely
danizee-claude-suite uninstall

# Preview changes without writing (dry run)
danizee-claude-suite init --dry-run

# Force overwrite existing files
danizee-claude-suite init --force
```

| Command | Description |
|---------|-------------|
| `init` | Install all workflows, create directories, generate docs |
| `check` | Verify installation status and show installed components |
| `update` | Regenerate workflows and docs, preserve ralph-candidates.md and solution docs |
| `uninstall` | Remove all installed files and directories |
| `--dry-run` | Preview what will be created without writing files |
| `--force` | Overwrite existing files without prompting |

## What Gets Installed

```
your-project/
├── .claude/
│   ├── commands/
│   │   ├── .shortcuts/     # /w- workflow shortcuts
│   │   ├── workflows/      # plan, work, review, compound
│   │   ├── coordination/   # swarm-init, agent-spawn, memory-ops
│   │   └── analysis/       # design, component, layout, theme
│   ├── ralph-candidates.md # Ralph candidate queue
│   └── settings.json       # Suite configuration
├── docs/
│   └── solutions/          # Compounded solution docs
│       ├── features/
│       ├── bugs/
│       ├── security/
│       ├── performance/
│       ├── architecture/
│       ├── reviews/
│       ├── incidents/
│       ├── ideas/
│       └── ralph/
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
| `project/ideas/*` | Refined ideas from interviews |
| `project/ralph/*` | Ralph loop patterns |
| `project/ralph-specs/*` | Generated Ralph specifications |

## Included Plugins

### Claude Flow 3.0
Multi-agent orchestration with memory and swarm support (`claude-flow@v3alpha`).
- Swarm topologies: hierarchical, mesh, ring, star
- 54+ specialized agents: coder, tester, reviewer, security-sentinel, performance-oracle, etc.
- HNSW-indexed memory for 150x faster pattern search
- ReasoningBank self-learning intelligence
- 175+ MCP tools for development workflows

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

## Checkpoint Automation

Workflows use **USER GATE** (requires confirmation) and **AUTO-PROCEED** (continues automatically):

| Phase | Gate Type | Rationale |
|-------|-----------|-----------|
| Search | USER GATE | Review past solutions before proceeding |
| Interview | USER GATE | Ensure requirements are captured |
| Plan | USER GATE | Validate approach before coding |
| Spec | AUTO-PROCEED | Flows directly to Tests |
| Tests | AUTO-PROCEED | Blocking rule ensures tests fail first |
| Build | AUTO-PROCEED | Continues after tests pass |
| Review | AUTO-PROCEED | Automatic code review |
| Compound | AUTO-PROCEED | Mandatory knowledge capture |
| Analyze Changes | AUTO-PROCEED | Parse git diff for built patterns |
| Generate Diagnostics | AUTO-PROCEED | Create RC-D### candidates |
| Generate Fixes | AUTO-PROCEED | Create paired RC-F### candidates |

**Philosophy**: Human gates in planning/context phases, auto-proceed in coding/verification phases.

**Auto-QA Pipeline**: Build → Compound → Auto-generate diagnostics → Ralph batch verifies overnight → Regressions auto-fixed

## Tips

1. **Use /w- shortcuts** - Quick access to all workflows
2. **Review checkpoint 0** - Past solutions may already solve your problem
3. **Trust the compound** - Don't skip the final checkpoint
4. **Log Ralph candidates** - Repeating patterns become future automation
5. **Batch overnight work** - Use `/w-ralph-batch --script` for unattended runs
6. **Search first** - `/w-search` before starting if unsure
7. **Run diagnostics nightly** - `/w-ralph-batch --diagnostics` catches accidental deletions

## License

MIT
