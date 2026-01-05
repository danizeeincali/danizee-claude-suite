# /w-swarm

Swarm Build - Spawns parallel agents (coder, tester, reviewer) for rapid implementation.

## Usage
```
/w-swarm [task description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for related implementation patterns
2. Spawn agents with assignments
3. Execute parallel work
4. Integrate and verify results
5. Compound solution

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip compound phase at the end
- VIOLATION: Starting implementation without search = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of related patterns (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] related patterns. Proceed to Spawn agents or use existing?"
- Options: ["Proceed to Spawn", "Use existing solution", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Agent Spawn
**REQUIRED OUTPUT:**
- Agent assignments table:
| Agent | Task | Role |
|-------|------|------|
| _____ | _____ | coder |
| _____ | _____ | tester |
| _____ | _____ | reviewer |

- Swarm topology: _____
- Coordination strategy: _____

**USER GATE:** Use AskUserQuestion
- Question: "Agent assignments ready. Proceed to Execute?"
- Options: ["Continue", "Revise assignments", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Execution Complete
**REQUIRED OUTPUT:**
- Completed work summary per agent
- Files created/modified: _____
- Test results (if applicable): _____

**USER GATE:** Use AskUserQuestion
- Question: "Execution complete. Proceed to Integrate and Compound?"
- Options: ["Continue", "Revise work", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/implementations/_____
- Doc path: docs/solutions/implementations/_____.md
- Pattern stored: yes/no

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] All 4 checkpoints completed with user confirmation
- [ ] All required outputs generated
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/implementations/[task-name]
Doc: docs/solutions/implementations/[task-name].md
```

## Example
```
/w-swarm REST API for user management with CRUD and tests
```
