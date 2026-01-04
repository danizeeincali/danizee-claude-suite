# /w-idea-tdd-swarm

Turn a half-baked idea into a well-built feature through deep interviewing + Full TDD Swarm.

## Usage
```
/w-idea-tdd-swarm [description or file path]
/w-idea-tdd-swarm user authentication system
/w-idea-tdd-swarm .claude/plans/auth-idea.md
```

## What Happens

### Phase 1: Deep Interview
1. **Detect Input** - File path or inline description
2. **Load Context** - Read relevant project docs if mentioned
3. **Interview** - One question at a time (see below)
4. **Capture Quotes** - Note verbatim moments of clarity
5. **Final Question** - "What did I forget to ask about?"
6. **Save Spec** - Write to .claude/plans/YYYY-MM-DD-[name].md

### Phase 2: Full TDD Swarm
7. **Plan** - Architecture based on refined spec
8. **Spec** - Acceptance criteria from interview
9. **Test-First** - ALL tests written (must fail)
10. **Build** - Swarm implements to pass tests
11. **Review** - Security, performance, architecture
12. **Compound** - Store complete solution

## Interview Categories

**Technical & Architecture**
- Implementation approach, tradeoffs, edge cases
- How this fits with existing systems
- What could break or need migration

**Human & Workflow**
- Who else is affected?
- What's the manual fallback if automation fails?
- How will you know it's working? What does success look like?

**Strategic**
- Why now? What's the cost of waiting?
- What's the simplest version that delivers value?
- What would make you regret building this?

## Interview Rules
- Ask ONE question at a time
- Go deep on answers revealing uncertainty or assumptions
- Don't ask obvious questions - push on unthought things
- Capture quotable moments verbatim for the spec

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past solutions, patterns |
| 1 | Interview | Refined spec from questions |
| 2 | Plan | Architecture, files, approach |
| 3 | Spec | Acceptance criteria, test cases |
| 4 | Tests | Test files (must fail) |
| 5 | Build | Implementation (tests pass) |
| 6 | Review | Security, performance, patterns |
| 7 | Compound | Complete solution summary |

## Compounds
```
Memory: project/ideas/[idea-name]
Doc: docs/solutions/ideas/[idea-name].md
Spec: .claude/plans/YYYY-MM-DD-[name].md
```

## Example
```
/w-idea-tdd-swarm I want some kind of notification system but I'm not sure exactly what
```
