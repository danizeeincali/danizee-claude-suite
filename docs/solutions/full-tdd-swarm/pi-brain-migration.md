# Pi Brain Migration — Replace Agent Cookbook in All Workflows

## Summary
Replaced all Agent Cookbook references with Pi Brain (pi.ruv.io) across all w-* workflow commands in danizee-claude-suite.

## Mapping

| Cookbook Concept | Pi Brain Equivalent |
|----------------|-------------------|
| Recipe | Memory/Knowledge |
| Receipt | Vote |
| `npx @agent-cookbook/client discover` | `npx ruvector brain search` |
| `npx @agent-cookbook/client submit-receipt` | `npx ruvector brain vote` |
| `npx @agent-cookbook/client submit-recipe` | `npx ruvector brain share` |
| `agent-cookbook.replit.app` | `pi.ruv.io/v1/memories` |
| `~/.agent-cookbook/config.json` | `~/.ruvector/config.json` |
| `auto_receipts` config | `auto_votes` config |
| `auto_recipes` config | `auto_share` config |
| Fork-aware dedup | Vote on existing memory |

## Checkpoint Renames
- CP 0.5: "Agent Cookbook — Recipe Discovery" → "Pi Brain — Knowledge Discovery"
- CP 5.5/6.5: "Agent Cookbook — Auto-Receipt" → "Pi Brain — Auto-Vote"
- Compound: "COOKBOOK AUTO-RECIPE CHECK" → "PI BRAIN AUTO-SHARE CHECK"

## Files Modified
- `src/plugins/dot-shortcuts.js` — 172 cookbook lines → 0 (all replaced with Pi Brain)
- `.claude/commands/.shortcuts/w-plan-tdd-swarm.md` — 17 cookbook references → 0

## Tests
- 35 tests in `test/pi-brain-migration.test.js` — all pass
- 143 total tests across all suites — all pass
