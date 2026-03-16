# Danizee Claude Suite

[![npm version](https://badge.fury.io/js/danizee-claude-suite.svg)](https://www.npmjs.com/package/danizee-claude-suite)

Unified workflow shortcuts for Claude Code that **compound knowledge** — each task makes future tasks easier.

## Installation

```bash
npx danizee-claude-suite init
```

Options:

```bash
npx danizee-claude-suite init --force         # Overwrite existing files
npx danizee-claude-suite init --with-pm       # Include PM workflows
npx danizee-claude-suite init --without-cookbook  # Skip Agent Cookbook
npx danizee-claude-suite init --dry-run       # Preview without writing
```

## Requirements

- Node.js >= 20.0.0
- GitHub CLI (`gh`) — recommended for PR workflows

## How It Works

Every workflow follows the **Search → Execute → Verify → Compound** pattern:

```
 1. SEARCH — Check memory + Pi Brain for past solutions
 2. EXECUTE — Run the workflow with checkpoint gates
 3. VERIFY — Cross-method validation (files, tests, git diff, build)
 4. COMPOUND — Store solution + Ralph candidates + RC-A candidates
```

The second time you solve a similar problem, it's faster because the workflow finds and applies your previous solution.

## Quick Reference: /w- Shortcuts

### Development

| Shortcut | Description |
|----------|-------------|
| `/w-tdd-swarm` | Full TDD + Swarm — plan, test-first, parallel build, review |
| `/w-plan-tdd-swarm` | Interview refines idea → Full TDD Swarm builds it |
| `/w-swarm` | Parallel agents (coder, tester, reviewer) |
| `/w-autoresearch` | Autonomous experiment loop for measurable optimization |
| `/w-agent-tdd-swarm` | Gateless TDD for terminal agents (zero user gates, auto-PR) |
| `/w-agent-interview-swarm` | Interview → spawn gateless terminal agent |

### Bug Fixes

| Shortcut | Description |
|----------|-------------|
| `/w-fix` | Quick fix — investigate → TDD fix → verify |
| `/w-debug` | Deep debug — hypothesis → diagnose → TDD fix |
| `/w-hotfix` | Critical production fix — isolated branch + security review |

### Reviews & Audits

| Shortcut | Description |
|----------|-------------|
| `/w-review` | Comprehensive code review (12+ specialized agents) |
| `/w-security` | Security audit — OWASP top 10, auth/authz, data exposure |
| `/w-perf` | Performance audit — N+1 queries, memory, bottlenecks |

### Architecture

| Shortcut | Description |
|----------|-------------|
| `/w-architect` | Hive-mind architecture — collective intelligence for complex design |
| `/w-multi-repo` | Coordinate changes across repositories |

### Session Management

| Shortcut | Description |
|----------|-------------|
| `/w-start` | Cold-start session with project context |
| `/w-end` | End session — compound knowledge + commit |
| `/w-search` | Search past solutions in memory |

### Compound & Knowledge

| Shortcut | Description |
|----------|-------------|
| `/w-compound` | Ad-hoc knowledge capture with auto-QA diagnostics |
| `/w-background-compound` | Fire-and-forget compound (background agent, auto-push) |
| `/w-suite-sync` | Sync shortcuts after suite update (additive only) |

### Pure Ralph (Bash Loop)

| Shortcut | Description |
|----------|-------------|
| `/w-ralph-init` | Initialize Ralph structure in project |
| `/w-ralph-this` | Convert current task to implementation plan |
| `/w-ralph-goals` | Interview → build plan + specs |
| `/w-ralph-pick` | Execute a queued Ralph candidate |
| `/w-ralph-batch` | Generate overnight batch scripts |

## Workflow Features

### Verification Checkpoint

Every workflow includes an independent **cross-method validation gate** after implementation:

1. **Files Exist** — verify all claimed file paths exist on disk
2. **Tests Re-run** — independent re-run (not trusting earlier output)
3. **Git Diff Matches Plan** — compare `git diff --stat` against planned files
4. **Build Compiles** — run build command, verify zero errors
5. **No Regressions** — full test suite to catch regressions

Retry logic: max 3 retries, then escalate to user.

### Pi Brain Integration

Workflows integrate with the [Pi Brain](https://pi.ruv.io) knowledge network at two points:

- **Discovery** (before building) — search for existing knowledge:
  ```bash
  npx ruvector brain search "[task description]" --top-k=3
  ```
- **Auto-Vote** (after building) — submit proof-of-execution if tests pass

### Agent Browser

UI/frontend workflows include conditional browser checks:
```bash
agent-browser open <url> → agent-browser screenshot  # Before changes
agent-browser snapshot -i → verify elements           # After build
agent-browser screenshot → compare before/after       # Final review
```

Skipped for non-UI tasks. Falls back to: `npx playwright install`

### Autoresearch

Autonomous experiment loop for measurable optimization:

```bash
/w-autoresearch optimize test suite runtime    # Free-form objective
/w-autoresearch RC-A003                        # Run against RC-A candidate
```

- Runs as background agent, loops forever until paused
- Git commits winners, reverts losers
- State in `autoresearch.jsonl`, narrative log in `experiments/worklog.md`
- Benchmark script outputs `METRIC name=number` lines

## Ralph Candidates System

During compound phases, three types of candidates are logged to `.claude/ralph-candidates.md`:

| Format | Type | Purpose |
|--------|------|---------|
| `RC-###` | General | Standard Ralph candidates (repeatable patterns) |
| `RC-D###` | Diagnostic | Verify patterns/code exists |
| `RC-F###` | Fix | Restore code if diagnostic fails |
| `RC-A###` | Autoresearch | Measurable optimization targets with KPI + impact score |

### RC-A Candidates (Autoresearch)

Discovered automatically in compound phases via static analysis + agent reflection:

```markdown
## RC-A003: Test Suite Runtime Optimization
**KPI:** test_suite_duration_seconds
**Baseline:** 45.2s
**Benchmark:** `time python3 -m pytest tests/ 2>&1 | tail -1`
**Impact Score:** 7.2 (potential: 8, blast_radius: 3, risk: 2, value: 9)
**Files in scope:** tests/, src/
**Constraints:** All tests must still pass
```

Impact score = weighted composite of potential (0.35), blast_radius (0.15), risk (0.15), value (0.35).

## Pure Ralph (Bash Loop)

Fresh context each iteration. State passes through files only.

```bash
/w-ralph-init                          # Create structure
/w-ralph-this "Build authentication"   # Generate plan
./.claude/ralph/loop.sh                # Run the loop
./.claude/ralph/loop.sh build 50       # Max 50 iterations
```

```
while [ tasks_remaining ]; do
  cat PROMPT.md AGENTS.md IMPLEMENTATION_PLAN.md | claude
  # Fresh Claude reads plan → picks ONE task → executes → validates → commits → exits
  # IMPLEMENTATION_PLAN.md updated (state preserved!)
done
```

## PM Module (--with-pm)

Adds 34 additional workflows for project management:

```bash
npx danizee-claude-suite init --with-pm
```

Requires `npm install better-sqlite3` for the SQLite database.

| Category | Workflows |
|----------|-----------|
| Action Items | `/w-action`, `/w-action-done`, `/w-action-list`, `/w-action-rebalance` |
| Standup | `/w-cos` (Chief of Staff daily standup) |
| Follow-ups | `/w-followup`, `/w-followup-done` |
| Goals | `/w-goal` |
| Ideas | `/w-idea`, `/w-idea-refine`, `/w-idea-share` |
| Knowledge | `/w-knowledge`, `/w-knowledge-search` |
| Notes & Facts | `/w-notes`, `/w-fact`, `/w-fact-search`, `/w-fact-enrich` |
| Brainstorm | `/w-ramble`, `/w-ramble-search`, `/w-ramble-refine` |
| Research | `/w-research`, `/w-doc-review` |
| Meetings | `/w-meeting-prep` |
| Projects | `/w-project`, `/w-initiative` |
| Sharing | `/w-share`, `/w-share-list`, `/w-share-revoke` |
| Design | `/w-systems-design`, `/w-ui-references`, `/w-ui-references-review` |

Action items use Fibonacci bucket limits (P1: 1, P2: 2, P3: 3, P5: 5, P8: 8, P13: 13) with auto-promotion on completion.

## Post-Init Hooks

The suite runs `.claude/hooks/post-init.sh` after installation if it exists and is executable. Use this to apply project-specific customizations that should survive suite updates.

```bash
#!/bin/bash
# Example: .claude/hooks/post-init.sh
sed -i '' 's/TodoWrite/TaskCreate/g' .claude/commands/.shortcuts/*.md
```

## CLI Commands

```bash
npx danizee-claude-suite init          # Install suite
npx danizee-claude-suite check         # Verify installation
npx danizee-claude-suite update        # Update workflows (preserves data)
npx danizee-claude-suite uninstall     # Remove suite
```

| Flag | Description |
|------|-------------|
| `--force` | Overwrite existing files |
| `--dry-run` | Preview without writing |
| `--with-pm` | Include PM workflows |
| `--without-cookbook` | Skip Agent Cookbook |
| `--keep-settings` | Preserve settings.json on uninstall |
| `-p, --path <dir>` | Target directory (default: cwd) |

## What Gets Installed

```
.claude/
├── commands/
│   ├── .shortcuts/         24 /w- workflow shortcuts
│   ├── workflows/          plan, work, review, compound
│   ├── coordination/       swarm-init, agent-spawn, memory-ops
│   ├── analysis/           design, component, layout, theme
│   └── autoresearch.md     /autoresearch command
├── skills/
│   └── autoresearch/       Autoresearch skill (SKILL.md)
├── hooks/
│   └── autoresearch-context.sh
├── helpers/
│   ├── quick-start.sh
│   ├── setup-mcp.sh
│   └── terminal-agents-mcp.js
├── ralph/                  Pure Ralph loop structure
├── plans/                  Interview specs
├── ralph-candidates.md     Candidate queue
└── settings.json           Suite configuration

docs/solutions/             Compounded solution docs
specs/                      Ralph specification files
WORKFLOW-SHORTCUTS.md       Generated reference
.mcp.json                   MCP server configuration
```

## Plugins

| Plugin | Purpose |
|--------|---------|
| **RuFlo** | Multi-agent orchestration, memory, swarm topologies |
| **Compound Engineering** | Plan, work, review, compound workflows |
| **Frontend Design** | UI component generation (React/Vue/Svelte) |
| **Dot Shortcuts** | 24 /w- workflow shortcuts |
| **PM Shortcuts** | 34 /w- PM workflows (opt-in) |
| **Agent Cookbook** | Recipe registry integration |
| **Terminal Agents** | MCP server for tmux + worktree agent orchestration |
| **Autoresearch** | Autonomous experiment loop skill + hook |

## Checkpoint Gates

| Phase | Gate | Rationale |
|-------|------|-----------|
| Search | AUTO-PROCEED | Find past solutions, continue automatically |
| Pi Brain | AUTO-PROCEED | Knowledge discovery from network |
| Interview | USER GATE | Ensure requirements captured |
| Plan | USER GATE | Validate approach before coding |
| Spec | AUTO-PROCEED | Flows directly to tests |
| Tests | AUTO-PROCEED | Blocking rule: tests must fail first |
| Build | AUTO-PROCEED | Continues after tests pass |
| Review | AUTO-PROCEED | Automatic code review |
| Verification | AUTO-PROCEED | Cross-method validation (3 retries) |
| Compound | AUTO-PROCEED | Mandatory knowledge capture |

## License

MIT
