# Ralph Wiggum Loop Candidates

Development patterns identified during compound phases that could be executed via `/w-ralph-this`.

**Ralph is for DEV WORK:** Features, bug fixes, refactoring - not general automation.

## Candidates

| # | Name | Source Workflow | Date | Status | Spec File |
|---|------|-----------------|------|--------|-----------|
| - | (none yet) | - | - | - | - |

## Statuses

- **draft**: Identified, needs refinement
- **ready**: Spec complete, ready to use with `/w-ralph-this`
- **used**: Successfully executed

## What Makes a Good Ralph Candidate

- Feature or bug fix pattern that repeats
- Has clear completion signal (tests pass, build succeeds)
- Could iterate: write code -> run tests -> fix -> repeat
- Similar to work just completed that could be templated

## Adding a Candidate

When completing any workflow compound phase, check for patterns that could become Ralph loops:

1. Add entry to table above
2. Create spec file: `candidate-XXX-[name].md`
3. Use `/w-ralph-this [spec-file]` to execute when ready
