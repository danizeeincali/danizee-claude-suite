# /w-start

Cold-start a session by loading project context from plan docs, memories, and git.

## Usage
```
/w-start [plan-file]
```

Default: MASTER_PLAN.md

## What Happens
1. **Read Plan** - Load specified plan file (or MASTER_PLAN.md)
2. **Search Claude-Flow Memories** - Query project/* namespaces for stored patterns
3. **Scan Compound Docs** - Read docs/solutions/ for compound-engineering knowledge
4. **Check Git** - Recent commits, current branch, uncommitted changes
5. **Summarize** - Present context summary
6. **Ask** - "What would you like to work on?"

## Memory Sources
- **Claude-Flow**: project/features/*, project/bugs/*, project/implementations/*, etc.
- **Compound Engineering**: docs/solutions/ markdown files
- **Git**: Recent commits and current branch state

## Example
```
/w-start
/w-start ROADMAP.md
/w-start docs/SPRINT_PLAN.md
```
