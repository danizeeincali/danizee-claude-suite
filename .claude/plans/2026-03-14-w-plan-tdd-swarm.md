# w-plan-tdd-swarm — Rename + Automation Upgrade

## Origin
User wants to rename w-interview-tdd-swarm → w-plan-tdd-swarm and make it more automated. Also noticed the spec wasn't being printed inline after the interview.

## Interview Decisions

| Checkpoint | Gate Type | Notes |
|-----------|-----------|-------|
| CP0: Search | Auto-proceed | No change |
| CP0.5: Cookbook | Auto-proceed | No change |
| CP1: Interview | HIL | Keep interview, but PRINT FULL SPEC inline before asking to proceed |
| CP2: Plan | HIL | Changed from auto → HIL. Pause after plan for user approval |
| CP3: Spec | Auto-proceed | No change |
| CP4: Tests | Blocking | No change — TDD contract |
| CP5: Build | Auto-proceed | Add ruflo swarm block |
| CP6: Review | Auto-proceed | No change |
| CP6.5: Cookbook | Auto-proceed | No change |
| CP7: Compound | Auto-proceed | No change |

## Additional Changes
- Rename: `w-interview-tdd-swarm.md` → `w-plan-tdd-swarm.md`
- Task tool: `TodoWrite` → `TaskCreate`
- Spec display bug: After interview, MUST print the full spec content inline (not just "here's the spec")
- Ruflo swarm: Add optional ruflo swarm execution block in Build phase

## User Quotes
- "I want to change the name to w-plan-tdd-swarm"
- "I am also noticing that there is a checkpoint where you say here is the spec but you don't print it for me to see"
- "lets go through all the gates and I will tell you if we need a HIL checkpoint or just a normal checkpoint"

## Files to Update
- `.claude/commands/.shortcuts/w-interview-tdd-swarm.md` → rename to `w-plan-tdd-swarm.md`
- `src/installer.js` — update reference from w-interview-tdd-swarm to w-plan-tdd-swarm
- `src/utils/shortcuts.js` or wherever shortcut names are registered
