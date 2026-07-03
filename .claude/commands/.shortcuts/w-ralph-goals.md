# /w-ralph-goals

Build a complete Pure Ralph setup from a rough idea through interactive interview.

## What This Does

1. **Interviews you** to understand the idea deeply
2. **Creates IMPLEMENTATION_PLAN.md** with atomic tasks
3. **Generates spec files** in specs/ directory
4. **Configures AGENTS.md** for your project
5. **Outputs the run command**

## Usage
```
/w-ralph-goals [rough idea]
/w-ralph-goals I want to build a CLI tool
/w-ralph-goals create a REST API with authentication
```

---

## Model Policy (fable/sonnet)

Route EVERY subagent this workflow spawns by work type — never let a spawn silently inherit the session model:

- **Thinking** (planning, architecture, root-cause analysis, adversarial review/verification, final judgment): `model: fable` (claude-fable-5).
- **Execution** (everything else — scoped builds, discovery sweeps, doc/compound writing, mechanical work): `model: sonnet` (Sonnet 5).
- **Opus fallback:** if fable is unavailable (access removed, usage exhausted, or the model errors), fall back to `model: opus` (claude-opus-4-8) for that step.
- **Escalation on detectable failure:** sonnet → fable (substitute opus when fable is unavailable). Never retry the same tier twice.

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Capture and clarify initial idea
2. Interview for acceptance criteria
3. Interview for architecture decisions
4. Interview for verification approach
5. Generate IMPLEMENTATION_PLAN.md
6. Generate spec files
7. Configure AGENTS.md
8. Output run command

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip interview questions - each is critical
- NEVER skip checkpoints - each requires user confirmation
- Ask ONE question at a time using AskUserQuestion
- Generate ATOMIC tasks (one per Ralph iteration)

---

## Interview Categories

**Acceptance Criteria**
- What does "done" look like?
- How will we verify each feature works?

**Architecture & Approach**
- What's the high-level design?
- What files/modules need to be created?
- What dependencies are needed?

**Verification**
- What test framework to use?
- What commands validate success?
- What's the build command?

**Scope & Safety**
- What's explicitly OUT of scope?
- Are there any risky operations to avoid?

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Idea Captured
**REQUIRED OUTPUT:**
- Initial idea: _____
- Context needed: _____

**USER GATE:** Use AskUserQuestion
- Question: "What does 'done' look like for [idea]? What's the acceptance criteria?"
- Options: (free text via "Other")

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Requirements Clear
**Continue interviewing (one question at a time):**
- Architecture approach
- Key components needed
- Testing strategy
- Dependencies

**REQUIRED OUTPUT:**
- Acceptance criteria: _____
- Architecture summary: _____
- Key components: _____
- Test approach: _____
- Dependencies: _____

**USER GATE:** Use AskUserQuestion
- Question: "Requirements captured. Proceed to generate plan?"
- Options: ["Generate plan", "Add more details", "Show summary"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Generate IMPLEMENTATION_PLAN.md
**Create atomic tasks (ONE task = ONE Ralph iteration):**

**Write to .claude/ralph/IMPLEMENTATION_PLAN.md:**
```markdown
# Implementation Plan: [Name]

## Status
- Total tasks: N
- Completed: 0
- In Progress: 0
- Remaining: N

## Acceptance Criteria
[From interview]

## Tasks

### Phase 1: Setup
- [ ] Task 1
  - Verify: [command]
- [ ] Task 2
  - Verify: [command]

### Phase 2: Core
- [ ] Task 3
...

### Phase N: Polish
- [ ] Final task
  - Verify: All tests pass, build succeeds

## Discoveries

<!-- Will be populated during execution -->
```

**REQUIRED OUTPUT:**
- Plan file created: .claude/ralph/IMPLEMENTATION_PLAN.md
- Total tasks: N
- Phases: M

**AUTO-PROCEED:** Continue to spec generation.

---

### ⛔ CHECKPOINT 3: Generate Spec Files
**Create detailed specs in specs/ directory:**

For each major component/feature:
```markdown
# Spec: [Component Name]

## Purpose
[What this component does]

## Interface
[API/function signatures]

## Behavior
[Expected behavior, edge cases]

## Tests
[Test cases to implement]
```

**REQUIRED OUTPUT:**
- Spec files created: specs/*.md
- Components covered: _____

**AUTO-PROCEED:** Continue to AGENTS.md.

---

### ⛔ CHECKPOINT 4: Configure AGENTS.md
**Detect project type and configure validation:**

**Update .claude/ralph/AGENTS.md with:**
- Build command
- Test command
- Lint command
- Type check command (if applicable)

**USER GATE:** Use AskUserQuestion
- Question: "AGENTS.md configured for [project type]. Review commands?"
- Options: ["Looks good", "Edit commands", "Show AGENTS.md"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 5: Output Run Command
**REQUIRED OUTPUT:**
```
╔════════════════════════════════════════════════════════════╗
║  Pure Ralph Setup Complete!                                 ║
╠════════════════════════════════════════════════════════════╣
║  Plan: .claude/ralph/IMPLEMENTATION_PLAN.md                 ║
║  Tasks: N tasks in M phases                                 ║
║  Specs: K spec files in specs/                              ║
╠════════════════════════════════════════════════════════════╣
║  To start the loop:                                         ║
║                                                             ║
║    ./.claude/ralph/loop.sh                                  ║
║                                                             ║
╚════════════════════════════════════════════════════════════╝
```

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Interview completed (all key questions answered)
- [ ] IMPLEMENTATION_PLAN.md created with atomic tasks
- [ ] Spec files created in specs/
- [ ] AGENTS.md configured
- [ ] Run command provided to user

⚠️ Workflow INCOMPLETE until all boxes checked

## Example
```
/w-ralph-goals I want to build a markdown-to-HTML converter CLI

# Interview extracts:
# - Should support GitHub-flavored markdown
# - CLI interface with --input and --output flags
# - Tests with Jest
# - TypeScript project

# Generates:
# - .claude/ralph/IMPLEMENTATION_PLAN.md (12 tasks)
# - specs/cli-interface.md
# - specs/markdown-parser.md
# - specs/html-output.md
# - Configured AGENTS.md
```
