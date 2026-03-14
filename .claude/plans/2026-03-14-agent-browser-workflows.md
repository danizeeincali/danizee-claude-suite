# Agent Browser in All Workflows

## Origin
User wants agent-browser checking integrated into all workflows so that UI-impacting work gets visually verified.

## Interview Decisions

| Decision | Choice |
|----------|--------|
| Repo | danizee-claude-suite (feature/updates branch) |
| When to use | Any phase with UI impact — Search (check existing UI), Build (test as you go), Review (final verification) |
| Mandatory? | Conditional — only when task involves UI/frontend/pages/visual changes |
| Which workflows | ALL w-* including bg- variants (16+ workflows) |
| Fallback | Prompt to install if not available |

## Requirements

1. Add a conditional agent-browser block to workflows that triggers when task involves UI/frontend work
2. Browser checks in up to 3 phases: Search (see current state), Build (verify changes), Review (final visual check)
3. The block should be conditional — "If this task involves UI changes..." prefix
4. If agent-browser is not available, prompt user to install Playwright
5. Apply to ALL workflows: interactive (w-tdd-swarm, w-plan-tdd-swarm, w-debug, w-fix, w-hotfix, w-swarm, w-perf, w-security, w-review, w-architect) AND background (w-bg-tdd-swarm, w-bg-debug, w-bg-idea-tdd-swarm, w-bg-perf, w-bg-review, w-bg-security)
6. Non-UI workflows (w-compound, w-start, w-end, w-search, w-ralph-*, w-multi-repo) can skip since they don't produce UI changes

## User Quotes
- "can you make sure that checking with agent browser when needed is part of all the workflows?"

## Agent-Browser Capabilities
- Navigate: `agent-browser open <url>`
- Snapshot: `agent-browser snapshot -i` (returns interactive elements)
- Screenshot: `agent-browser screenshot`
- Interact: click, fill, type, check, select
- State: save/load browser sessions
- Playwright-based, runs via Bash tool
