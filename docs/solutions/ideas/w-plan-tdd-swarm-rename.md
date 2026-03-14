# w-plan-tdd-swarm — Rename + Automation Upgrade

## Summary
Renamed `w-interview-tdd-swarm` (formerly `w-idea-tdd-swarm`) to `w-plan-tdd-swarm` and upgraded gate automation.

## Changes

### Rename
- `w-idea-tdd-swarm.md` → `w-plan-tdd-swarm.md` (physical file)
- `w-interview-tdd-swarm` → `w-plan-tdd-swarm` (dot-shortcuts.js key, installer tests)

### Gate Decisions
| Checkpoint | Gate Type | Change |
|-----------|-----------|--------|
| CP0: Search | Auto-proceed | Changed from HIL → auto |
| CP0.5: Cookbook | Auto-proceed | No change |
| CP1: Interview | HIL | Added: PRINT FULL SPEC inline before gate |
| CP2: Plan | HIL | Changed from auto → HIL, prints plan inline |
| CP3: Spec | Auto-proceed | No change |
| CP4: Tests | Blocking | No change |
| CP5: Build | Auto-proceed | Added ruflo swarm block |
| CP6: Review | Auto-proceed | No change |
| CP6.5: Cookbook | Auto-proceed | Added (was missing) |
| CP7: Compound | Auto-proceed | Added cookbook auto-recipe check |

### Tool Migration
- `TodoWrite` → `TaskCreate` throughout

## Files Modified
- `.claude/commands/.shortcuts/w-plan-tdd-swarm.md` (created)
- `.claude/commands/.shortcuts/w-idea-tdd-swarm.md` (deleted)
- `src/plugins/dot-shortcuts.js` (renamed entry + content updates)
- `src/utils/shortcuts.js` (renamed references)
- `test/installer-v3.test.js` (updated assertions)
- `test/ruflo-integration.test.js` (updated filename)

## Tests
- 15 tests in `test/w-plan-tdd-swarm.test.js` — all pass
- 26 tests in `test/ruflo-integration.test.js` — all pass
