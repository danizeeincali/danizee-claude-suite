# Agent Browser — Workflow Integration

## Summary
Added conditional agent-browser (Playwright) visual verification blocks to all 16 applicable workflows in danizee-claude-suite.

## Pattern
Each browser block is conditional — only triggers when the task involves UI/frontend/visual changes. Three variants:
- **Search**: Screenshot current state before changes
- **Build**: Verify implementation visually, compare against pre-change state
- **Review**: Final visual verification (responsive, dark mode, accessibility)

If agent-browser is not available, the block prompts the user to install Playwright.

## Workflows Updated (16)
| Workflow | Blocks Added |
|----------|-------------|
| w-tdd-swarm | Search, Build, Review |
| w-plan-tdd-swarm | Search, Build, Review |
| w-debug | Analysis, Build, Review |
| w-fix | Search, Fix Applied |
| w-hotfix | Search, Fix Applied, Security Review |
| w-swarm | Search, Execution, Integration |
| w-perf | Search, Profiling, Analysis |
| w-security | Search, Scan, Analysis |
| w-review | Search, Code Analysis |
| w-architect | Search, Consensus |
| w-bg-tdd-swarm | Search, Build, Review |
| w-bg-debug | Analysis, Build, Review |
| w-bg-idea-tdd-swarm | Search, Build, Review |
| w-bg-perf | Search, Profiling, Analysis |
| w-bg-review | Search, Code Analysis |
| w-bg-security | Search, Scan, Analysis |

## Workflows Excluded (9)
w-compound, w-start, w-end, w-search, w-multi-repo, w-ralph-batch, w-ralph-goals, w-ralph-pick, w-ralph-this — these don't produce UI changes.

## Also Updated
- `src/plugins/dot-shortcuts.js` — all 10 inline workflow entries updated with matching browser blocks

## Tests
- 67 tests in `test/agent-browser-workflows.test.js` — all pass
- 108 total tests across all suites — all pass
