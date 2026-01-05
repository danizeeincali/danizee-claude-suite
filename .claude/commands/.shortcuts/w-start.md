# /w-start

Cold-start a session by loading project context from plan docs, memories, and git.

## Usage
```
/w-start [plan-file]
```

Default: MASTER_PLAN.md

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete all context loading steps. NEVER skip memory search.

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Context Loaded
**REQUIRED OUTPUT:**
- Plan file loaded: _____
- Memories found: _____ patterns
- Compound docs: _____ files
- Git status: branch _____, _____ uncommitted changes
- Recent commits: _____

**USER GATE:** Use AskUserQuestion
- Question: "Session initialized. What would you like to work on?"
- Options: ["Continue existing work", "Start new task", "Review context"]

STOP and wait for user response.

---

## Memory Sources
- **Claude-Flow**: project/features/*, project/bugs/*, project/implementations/*, etc.
- **Compound Engineering**: docs/solutions/ markdown files
- **Git**: Recent commits and current branch state

## Completion Checklist

- [ ] Plan file read (or default used)
- [ ] Memory search completed
- [ ] Compound docs scanned
- [ ] Git status checked
- [ ] Context summary presented

⚠️ Session NOT ready until all steps complete

## Example
```
/w-start
/w-start ROADMAP.md
/w-start docs/SPRINT_PLAN.md
```
