# /w-ralph-goals

Ralph Spec Builder - Interactive interview to build an optimal Ralph Wiggum prompt from a rough idea.

## Usage
```
/w-ralph-goals [rough idea]
/w-ralph-goals I want to build a CLI tool
/w-ralph-goals create a REST API with authentication
```

## What Happens
1. **Capture Idea** - Get the rough concept
2. **Interview** - Ask clarifying questions (one at a time):
   - What does "done" look like? (completion criteria)
   - What are the major phases/milestones?
   - What tests can verify success?
   - What's a reasonable max iteration limit?
   - Should the loop include self-testing cycles?
3. **Build Spec** - Generate a Ralph-ready prompt with:
   - Clear completion promise
   - Incremental goals
   - Test-and-verify cycles
4. **Save** - Write to .claude/plans/YYYY-MM-DD-[name]-ralph.md
5. **Execute?** - Ask if you want to run /w-ralph-this on it

## Interview Categories

**Completion Criteria**
- What specific output signals the task is complete?
- How can we automatically verify success?

**Phases & Milestones**
- What are the major steps?
- What order should they happen?

**Self-Correction**
- What tests should run each iteration?
- How should failures be handled?

**Safety**
- What's the max iteration limit?
- Are there any destructive operations to avoid?

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Idea captured | Initial concept |
| 1 | Interview | Answers and clarity |
| 2 | Spec built | Generated Ralph prompt |
| 3 | Execute? | Option to run immediately |

## Output Format
The generated spec will include:
```markdown
# Ralph Spec: [Name]

## Completion Promise
Output <promise>COMPLETE</promise> when done.

## Phases
1. Phase 1: ...
2. Phase 2: ...

## Verification
- Test 1: ...
- Test 2: ...

## Max Iterations: N
```

## Example
```
/w-ralph-goals I want to build a markdown-to-HTML converter CLI
```
