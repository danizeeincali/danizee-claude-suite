# /w-ralph-this

Ralph Wiggum Loop - Iteratively feed a prompt to Claude until a completion signal is detected.

## What is Ralph Wiggum?

An iterative AI development methodology - a "simple while loop that repeatedly feeds an AI agent a prompt until completion."

## Usage
```
/w-ralph-this [prompt or file path]
/w-ralph-this "Build a REST API with full test coverage"
/w-ralph-this .claude/plans/api-spec.md
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load and validate prompt
2. Configure iteration parameters
3. Execute loop (track each iteration)
4. Compound successful pattern

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER exceed max iterations without user confirmation
- NEVER skip compound phase at the end
- VIOLATION: Running without completion promise = risk of infinite loop

---

## Key Parameters
- **Max Iterations**: Safety limit (default: 50)
- **Completion Promise**: String that signals done (e.g., "DONE", "<promise>COMPLETE</promise>")

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Load
**REQUIRED OUTPUT:**
- Input type: file/inline
- Prompt content: _____
- Completion promise: _____
- Max iterations: _____

**USER GATE:** Use AskUserQuestion
- Question: "Prompt loaded. Completion signal: [X]. Max: [N]. Start loop?"
- Options: ["Start loop", "Adjust config", "Show prompt"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Each Iteration
**REQUIRED OUTPUT (per iteration):**
- Iteration #: _____
- Progress made: _____
- Completion signal detected: yes/no

**AUTO-PROCEED:** Continue iterations until completion signal or max reached.

Only stop for user confirmation if max iterations reached without completion.

---

### ⛔ CHECKPOINT 2: Completion
**REQUIRED OUTPUT:**
- Total iterations: _____
- Completion signal: _____
- Final result: _____

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/ralph/_____
- Doc path: docs/solutions/ralph/_____.md
- Pattern stored: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 4 phases
- [ ] Checkpoint 0 completed with user confirmation
- [ ] Checkpoints 1-3 completed (auto-proceed)
- [ ] Loop completed successfully OR stopped intentionally
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Best For
- Greenfield projects with clear success criteria
- Test-driven development cycles
- Tasks executable overnight/unattended
- Feature implementation with measurable completion

## Example
```
/w-ralph-this "Build a CLI tool that converts markdown to HTML. Output <promise>COMPLETE</promise> when all tests pass."
```
