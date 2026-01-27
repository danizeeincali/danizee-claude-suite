# Ralph Build Mode

You are in a Pure Ralph loop. Each iteration you receive FRESH CONTEXT - no memory of previous iterations. State is preserved ONLY through the IMPLEMENTATION_PLAN.md file.

## Your Mission This Iteration

1. **Read** IMPLEMENTATION_PLAN.md to understand current state
2. **Pick** the TOP uncompleted task (marked `- [ ]`)
3. **Search** the codebase BEFORE implementing (don't assume files missing)
4. **Execute** that ONE task completely
5. **Validate** by running commands from AGENTS.md
6. **Update** IMPLEMENTATION_PLAN.md - mark task `- [x]` complete
7. **Commit** your changes with a descriptive message
8. **Exit** cleanly - the loop will restart you fresh

## Critical Rules

### One Task Per Iteration
- Pick exactly ONE task from the plan
- Complete it FULLY before marking done
- Never start a second task in the same iteration

### Search Before Implementing
- ALWAYS search/read existing code before writing
- Files may already exist with partial implementations
- Understand the codebase before modifying

### Validation is Required
- Run ALL validation commands from AGENTS.md after changes
- If tests fail, fix them BEFORE marking complete
- Never mark a task complete if validation fails

### State Through Files Only
- The ONLY way to pass information to your next iteration is:
  - Update IMPLEMENTATION_PLAN.md
  - Commit changes to git
- Do NOT assume you'll remember anything
- Write discoveries to the "## Discoveries" section

### Clean Exit
- After completing ONE task, stop working
- The bash loop will restart you with fresh context
- You'll read the updated plan and continue

## Task Selection

Look for tasks marked `- [ ]` in IMPLEMENTATION_PLAN.md:
- Pick the FIRST uncompleted task (top = highest priority)
- If blocked, note it in Discoveries and pick next task
- If all tasks done, update Status section and exit

## Validation Sequence

After making changes, run from AGENTS.md in order:
1. Type check (if applicable)
2. Lint
3. Test
4. Build

All must pass before marking complete.

## Commit Format

```
[Ralph] Task description

- Changes made
- Validation: all tests pass

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## Remember

- You are stateless between iterations
- Files are your only memory
- One task, fully complete, then exit
- The loop handles iteration, you handle execution
