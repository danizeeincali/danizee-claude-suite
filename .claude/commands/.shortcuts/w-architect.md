# /w-architect

Hive-Mind Architecture - Multiple agents collaborate with collective intelligence for complex design.

## Usage
```
/w-architect [system description]
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
1. Search for related architecture decisions
2. Initialize hive-mind collaboration
3. Generate design proposals
4. Reach consensus on design
5. Compound architecture decision record

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip consensus phase - all options must be evaluated
- NEVER skip compound phase at the end
- VIOLATION: Skipping proposals = incomplete architecture

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
- List of related ADRs (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] related architecture decisions. Proceed to Hive Init?"
- Options: ["Continue", "Review past decisions first", "Show more detail"]

STOP and wait for user response.

---

### 🧠 CHECKPOINT 0.5: Pi Brain — Knowledge Discovery
**Search the Pi Brain network for existing architecture recipes matching this system:**

```bash
# npm client (preferred)
curl -s -H "Authorization: Bearer anonymous" "https://pi.ruv.io/v1/memories/search "[system description]" --top-k=3

# HTTP fallback
curl -s "https://pi.ruv.io/v1/memories/search?q=[system description]&top_k=3"
```

**If matching memories found:** Review steps for applicable architecture patterns. Adapt proven approaches.
**If no matches:** Proceed normally.

**REQUIRED OUTPUT:**
- Pi Brain memories found: _____ (0+ results)
- Applicable patterns: _____

---

### ⛔ CHECKPOINT 1: Hive Initialized
**REQUIRED OUTPUT:**
- Agent assignments:
| Agent | Role | Focus |
|-------|------|-------|
| _____ | system-architect | _____ |
| _____ | analyst | _____ |
| _____ | domain-expert | _____ |

- Hive topology: _____

**USER GATE:** Use AskUserQuestion
- Question: "Hive initialized with [N] agents. Proceed to Design Proposals?"
- Options: ["Continue", "Revise agents", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Design Proposals
**REQUIRED OUTPUT:**
| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| Option A | _____ | _____ | _____ |
| Option B | _____ | _____ | _____ |
| Option C | _____ | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "[N] design options generated. Proceed to Consensus?"
- Options: ["Continue", "Explore more options", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Consensus Reached

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Final visual verification with agent-browser
2. `agent-browser open <url>` → `agent-browser screenshot` → compare before/after
3. Verify responsive layout, dark mode, accessibility

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Recommended design: _____
- Rationale: _____
- Trade-offs accepted: _____
- Implementation roadmap: _____

**USER GATE:** Use AskUserQuestion
- Question: "Consensus: [Option X]. Proceed to Compound?"
- Options: ["Continue", "Revisit options", "Show more detail"]

STOP and wait for user response.

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
- Memory key: project/architecture/_____
- Doc path: docs/solutions/architecture/_____-adr.md
- ADR documented: yes/no

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
- [ ] All 5 checkpoints completed with user confirmation
- [ ] Multiple design options evaluated
- [ ] Consensus reached with rationale
- [ ] Pi Brain discovery completed (CHECKPOINT 0.5)
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] ADR doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/architecture/[system-name]
Doc: docs/solutions/architecture/[system-name]-adr.md
```

## Example
```
/w-architect microservices migration
```
