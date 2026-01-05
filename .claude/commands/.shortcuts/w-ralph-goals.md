# /w-ralph-goals

Ralph Spec Builder - Interactive interview to build an optimal Ralph Wiggum prompt from a rough idea.

## Usage
```
/w-ralph-goals [rough idea]
/w-ralph-goals I want to build a CLI tool
/w-ralph-goals create a REST API with authentication
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Capture initial idea
2. Interview for completion criteria
3. Interview for phases/milestones
4. Interview for verification
5. Build Ralph spec
6. Save spec file
7. Optionally execute

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip interview questions - each is critical
- NEVER skip checkpoints - each requires user confirmation
- NEVER skip saving the spec file
- Ask ONE question at a time using AskUserQuestion

---

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

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Idea Captured
**REQUIRED OUTPUT:**
- Initial idea: _____
- Context needed: _____

**USER GATE:** Use AskUserQuestion (first interview question)
- Question: "What specific output signals that [idea] is complete?"
- Options: (free text via "Other")

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Interview Complete
**REQUIRED OUTPUT:**
- Completion criteria: _____
- Phases identified: _____
- Verification methods: _____
- Max iterations: _____
- Safety considerations: _____

**USER GATE:** Use AskUserQuestion
- Question: "Interview complete. Proceed to build spec?"
- Options: ["Continue", "Add more questions"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Spec Built
**REQUIRED OUTPUT:**
- Spec preview with all sections
- Completion promise: _____
- Phase list: _____

**USER GATE:** Use AskUserQuestion
- Question: "Ralph spec ready. Review and save?"
- Options: ["Save spec", "Revise spec"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Execute Decision
**REQUIRED OUTPUT:**
- Spec saved to: .claude/plans/YYYY-MM-DD-[name]-ralph.md

**USER GATE:** Use AskUserQuestion
- Question: "Spec saved. Run /w-ralph-this on it now?"
- Options: ["Execute now", "Later"]

STOP and wait for user response.

---

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

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 7 phases
- [ ] All interview questions answered
- [ ] All 4 checkpoints completed with user confirmation
- [ ] Spec file saved: _____
- [ ] Execute decision made

⚠️ Workflow INCOMPLETE until all boxes checked

## Example
```
/w-ralph-goals I want to build a markdown-to-HTML converter CLI
```
