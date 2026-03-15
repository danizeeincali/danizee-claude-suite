# /w-swarm

RuFlo Swarm Build - Spawns parallel agents via ruflo for rapid implementation.

## Prerequisites
RuFlo must be installed. If not available, run:
```bash
npx ruflo@latest init
```

## Usage
```
/w-swarm [task description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for related implementation patterns
2. Decompose task and assign agents
3. Initialize ruflo swarm and spawn agents
4. Execute parallel work and collect results
5. Integrate, verify, and compound solution

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip compound phase at the end
- NEVER skip ruflo swarm initialization — agents must actually spawn
- VIOLATION: Starting implementation without search = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to screenshot the current state before changes
2. `agent-browser open <url>` → `agent-browser screenshot`
3. Note current UI state for comparison after build

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- List of related patterns (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] related patterns. Proceed to task decomposition?"
- Options: ["Proceed", "Use existing solution", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Task Decomposition & Agent Assignment
**Analyze the task and break it into parallel work units.**

**REQUIRED OUTPUT:**
- Task decomposition table:
| Sub-task | Agent Role | Domain | Description |
|----------|-----------|--------|-------------|
| _____ | coder | core | _____ |
| _____ | tester | support | _____ |
| _____ | reviewer | support | _____ |

- Swarm topology: _____ (hierarchical recommended for most tasks)
- Agent count: _____ (3-5 for simple, 6-15 for complex)
- Coordination strategy: _____ (queen-led, peer-to-peer, pipeline)

**USER GATE:** Use AskUserQuestion
- Question: "Task decomposed into [N] sub-tasks across [M] agents. Proceed to spawn swarm?"
- Options: ["Continue", "Revise assignments", "Add more agents"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: RuFlo Swarm Initialization & Execution

**Step 1: Initialize the swarm**
```bash
npx ruflo@latest swarm init --topology [chosen-topology] --agents [count]
```

**Step 2: Spawn agents for each sub-task**
For each row in the decomposition table, spawn an agent:
```bash
npx ruflo@latest agent spawn --domain [domain] --role [role] --task "[description]"
```

Alternatively, use the Agent tool to spawn parallel Claude Code agents:
```
Agent(role="coder", task="[sub-task description]", isolation="worktree")
Agent(role="tester", task="[sub-task description]", isolation="worktree")
Agent(role="reviewer", task="[sub-task description]", isolation="worktree")
```

**Step 3: Monitor progress**
```bash
npx ruflo@latest swarm status
```

**Step 4: Collect results**
Wait for all agents to complete. Aggregate their outputs.

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to verify the implementation visually
2. `agent-browser open <url>` → `agent-browser snapshot -i` → verify elements
3. Compare against pre-change screenshots from Search phase

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Swarm initialization: success/failure
- Agents spawned: _____ / _____ total
- Per-agent results summary:
| Agent | Status | Files Changed | Key Output |
|-------|--------|--------------|------------|
| _____ | _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Integration phase.

---

### ⛔ CHECKPOINT 3: Integration & Verification
**Merge all agent outputs into a cohesive result.**

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Final visual verification with agent-browser
2. `agent-browser open <url>` → `agent-browser screenshot` → compare before/after
3. Verify responsive layout, dark mode, accessibility

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Completed work summary per agent
- Files created/modified: _____
- Conflicts resolved: _____
- Test results: _____
- Integration verified: yes/no

**AUTO-PROCEED:** Continue to Verification phase.

---

### ✅ VERIFICATION CHECKPOINT — Cross-Method Validation
**Independent verification of deliverables. Do NOT trust self-reported results.**

**Verification Checks:**
1. **Files Exist** — Verify all claimed implementation file paths actually exist on disk
2. **Tests Re-run** — Independent re-run of ALL tests (not trusting earlier output)
3. **Git Diff Matches Plan** — Compare `git diff --stat` against planned files-to-modify list
4. **Build Compiles** — Run build command if applicable, verify zero errors
5. **No Regressions** — Run full test suite to catch regressions beyond new tests

**REQUIRED OUTPUT:**
- Files verified: _____ / _____ exist
- Tests re-run: _____ pass / _____ total
- Git diff matches plan: yes/no
- Build status: pass/fail/n-a
- Regressions: none / [list]

**RETRY LOGIC (max 3 retries):**
- PASS → proceed to next phase
- FAIL + retries remaining → log failure reason, fix the issue, re-verify
- FAIL + max retries exceeded → escalate to user with AskUserQuestion

---

### ⛔ CHECKPOINT 4: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/implementations/_____
- Doc path: docs/solutions/implementations/_____.md
- Pattern stored: yes/no
- Swarm metrics: agents used, topology, execution time

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] Checkpoints 0-1 completed with user confirmation
- [ ] RuFlo swarm initialized (Checkpoint 2)
- [ ] Agents actually spawned and completed work
- [ ] Results collected and integrated (Checkpoint 3)
- [ ] Compound phase executed (Checkpoint 4)
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

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
