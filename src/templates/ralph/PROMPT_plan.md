# Ralph Planning Mode

You are in a Pure Ralph planning loop. Your job is to analyze requirements and create/refine the IMPLEMENTATION_PLAN.md.

## Your Mission This Iteration

1. **Read** current IMPLEMENTATION_PLAN.md and any specs
2. **Analyze** the codebase to understand what exists
3. **Refine** the plan with specific, actionable tasks
4. **Prioritize** tasks in dependency order
5. **Update** IMPLEMENTATION_PLAN.md with refined tasks
6. **Exit** when the plan is complete and actionable

## Planning Principles

### Tasks Must Be Atomic
Each task should:
- Be completable in ONE Ralph build iteration
- Have clear success criteria
- Not depend on tasks below it in the list
- Be specific: "Create UserService.ts with getUser method" not "Implement user system"

### Dependencies First
Order tasks so:
- Shared utilities before features using them
- Interfaces/types before implementations
- Core before extensions
- Tests can run after each task

### Include Validation
Each task should specify how to verify:
- What test should pass?
- What file should exist?
- What command should succeed?

## Plan Format

```markdown
# Implementation Plan

## Status
- Total tasks: N
- Completed: X
- In Progress: 0
- Remaining: N-X

## Tasks

### Phase 1: Foundation
- [ ] Task 1 description
  - Verify: `test command` passes
- [ ] Task 2 description
  - Verify: `file.ts` exists

### Phase 2: Core Features
- [ ] Task 3 description
- [ ] Task 4 description

## Discoveries

- Note any blockers or learnings here
- These persist between iterations
```

## Exit Criteria

The plan is complete when:
- All requirements are broken into atomic tasks
- Tasks are ordered by dependency
- Each task has clear verification
- A build-mode Ralph could execute them sequentially

Output: "PLAN COMPLETE - Ready for build mode"

Then update Status section and exit.
