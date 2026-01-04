# /w-end

Gracefully end a session by compounding knowledge and committing work.

## Usage
```
/w-end
/w-end [category]
```

Categories: feature, bug, security, performance, architecture, debug

## What Happens
1. **Compound** - Store session patterns to claude-flow memory
2. **Update Docs** - Write/update docs/solutions/ with session learnings
3. **Commit** - Stage all changes and commit with session summary
4. **Summarize** - Recap what was accomplished this session
5. **Goodbye** - "See you later! Run \`/w-start\` to resume."

## Memory Storage
- Claude-Flow: project/[category]/[auto-named]
- Compound Doc: docs/solutions/[category]/[name].md

## What Gets Captured
- Problems solved and approaches used
- Key decisions made
- Patterns discovered
- Files modified
- Tests added/changed

## Example
```
/w-end
/w-end feature
/w-end bug
```

## Next Session
Run \`/w-start\` to load this session's context and continue where you left off.
