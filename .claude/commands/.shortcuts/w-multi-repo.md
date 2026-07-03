# /w-multi-repo

Multi-Repository - Coordinates changes across repos with dependency awareness.

## Usage
```
/w-multi-repo [task description]
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
1. Search for past multi-repo patterns
2. Analyze dependencies between repos
3. Plan change coordination order
4. Execute changes across repos
5. Compound coordination pattern

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip dependency analysis - order matters
- NEVER skip compound phase at the end
- VIOLATION: Executing changes without dependency map = risk

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of past multi-repo patterns (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past coordination patterns. Proceed to Analyze?"
- Options: ["Continue", "Review past patterns first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Repos Analyzed
**REQUIRED OUTPUT:**
- Dependency map:
| Repo | Depends On | Depended By |
|------|------------|-------------|
| _____ | _____ | _____ |

- Change order (critical): _____
- Risk assessment: _____

**USER GATE:** Use AskUserQuestion
- Question: "Dependency map ready. Change order: [X → Y → Z]. Proceed to Plan?"
- Options: ["Continue", "Revise order", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Changes Prepared
**REQUIRED OUTPUT:**
- Per-repo changes:
| Repo | Files | Changes |
|------|-------|---------|
| _____ | _____ | _____ |

- Rollback plan: _____

**USER GATE:** Use AskUserQuestion
- Question: "Changes prepared for [N] repos. Proceed to Execute?"
- Options: ["Continue", "Revise changes", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Sync Complete
**REQUIRED OUTPUT:**
- Repos updated: _____
- Verification status per repo: _____
- Any failures: _____

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 4: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/multi-repo/_____
- Doc path: docs/solutions/multi-repo/_____.md
- Pattern documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

**AUTORESEARCH CANDIDATE CHECK (RC-A):**
Scan the work just completed for measurable optimization targets:
1. **Static scan:** Analyze git diff for measurable patterns (function runtimes, test duration, bundle size, query counts, memory usage, coverage gaps)
2. **Agent reflection:** What about this work could be measured and autonomously optimized?
3. **Impact scoring:** Rate each candidate on 4 dimensions (weighted composite):
   - potential (0.35): estimated improvement magnitude (1-10)
   - blast_radius (0.15): files/systems affected, inverted (1-10)
   - risk (0.15): breaking change likelihood, inverted (1-10)
   - value (0.35): user/business value of improvement (1-10)
   - Composite = (potential * 0.35) + ((10 - blast_radius) * 0.15) + ((10 - risk) * 0.15) + (value * 0.35)
4. If candidates found, append RC-A entries to .claude/ralph-candidates.md:
```
## RC-A[NNN]: [Title]
**KPI:** [metric_name]
**Baseline:** [current value]
**Benchmark:** `[command to measure]`
**Impact Score:** [composite] (potential: N, blast_radius: N, risk: N, value: N)
**Files in scope:** [paths]
**Constraints:** [what must not break]
```
- RC-A candidates found: yes/no
- If yes, logged with impact scores to .claude/ralph-candidates.md


NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] Checkpoints 0-2 completed with user confirmation
- [ ] Checkpoints 3-4 completed (auto-proceed)
- [ ] Dependency map created
- [ ] Changes applied in correct order
- [ ] All repos verified
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Coordination doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/multi-repo/[task-name]
Doc: docs/solutions/multi-repo/[task-name].md
```

## Example
```
/w-multi-repo updating shared auth library across all repos
```
