# /w-suite-sync

Suite Sync from Upstream Source — Parallel fetch + interview-driven additive sync.

**Pi Brain Recipe:** sha256:1bf583f6dcf5282fbc55ae1b70246bb8a25a908d1c003c315e15a027c4625014
**Registry:** https://agent-pi-brain.replit.app

**Philosophy:** Never modify existing files (zero regression risk). Only add new files and features.

## Usage
```
/w-suite-sync
/w-suite-sync --source https://github.com/danizeeincali/danizee-claude-suite
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
1. Parallel fetch all categories from upstream
2. Compare with local to detect gaps
3. Interview user on each category
4. Build only additive changes
5. Verify no regressions

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER modify existing files — additive only
- NEVER skip interview — user selects what to sync
- NEVER skip regression verification
- VIOLATION: Modifying existing file = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Fetch Upstream
**Parallel fetch all content categories from upstream source:**

```bash
# Clone or fetch upstream
git clone --depth 1 https://github.com/danizeeincali/danizee-claude-suite /tmp/suite-upstream

# Inventory by category
ls /tmp/suite-upstream/src/plugins/     # Workflow commands
ls /tmp/suite-upstream/src/lib/         # Library modules
ls /tmp/suite-upstream/src/templates/   # Templates
ls /tmp/suite-upstream/docs/            # Documentation
```

**REQUIRED OUTPUT:**
- Upstream version: _____
- Categories fetched:
| Category | Files | Description |
|----------|-------|-------------|
| plugins | _____ | Workflow commands |
| lib | _____ | Library modules |
| templates | _____ | Templates |
| docs | _____ | Documentation |

**AUTO-PROCEED:** Continue to Compare phase.

---

### ⛔ CHECKPOINT 1: Compare & Detect Gaps
**Analyze upstream inventory against local filesystem:**

For each upstream file, classify as:
- **already-exists**: Local file matches upstream
- **needs-update**: Local file exists but differs (DO NOT auto-update)
- **completely-new**: No local equivalent exists

**REQUIRED OUTPUT:**
| File | Status | Notes |
|------|--------|-------|
| _____ | already-exists/needs-update/completely-new | _____ |

- Coverage: ____% of upstream features present locally
- New items available: N

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] new items available from upstream. Review by category?"
- Options: ["Review all", "Show new only", "Show summary"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: Interview — Category Selection
**Present each category of gaps to the user:**

For each category with gaps:

**USER GATE:** Use AskUserQuestion
- Question: "[Category]: [N] new items available. What to sync?"
- Options: ["Sync all", "Pick specific items", "Skip this category"]

If "Pick specific items": present individual items for selection.

**REQUIRED OUTPUT:**
- Categories selected: _____
- Items to sync: _____ (list)
- Items skipped: _____ (list)

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Build Additive Changes
**Create ONLY new files from approved upstream content:**

- Copy selected new files to local project
- Adapt imports/paths to local conventions if needed
- DO NOT modify any existing files

**REQUIRED OUTPUT:**
- Files created: _____ (list)
- Files modified: 0 (MUST be zero)
- Adaptations made: _____

**AUTO-PROCEED:** Continue to Verify phase.

---

### ⛔ CHECKPOINT 4: Verify No Regressions
**Run existing test suites and checks:**

```bash
npm test
```

**Additional checks:**
- Levenshtein similarity check: new command names vs existing (flag conflicts > 0.8)
- Content pattern validation: new files follow existing conventions
- No broken imports or references

**REQUIRED OUTPUT:**
- Tests pass: yes/no
- Name conflicts found: _____
- Pattern validation: pass/fail

**USER GATE:** Use AskUserQuestion
- Question: "Verification complete. [All pass / N issues]. Proceed?"
- Options: ["Continue", "Fix issues", "Rollback"]

STOP and wait for user response.

---


---

### ⛔ CHECKPOINT 6: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/sync/_____
- Items synced: _____
- Upstream version: _____


NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] Upstream fetched and inventoried
- [ ] Gap analysis completed
- [ ] User interviewed on each category
- [ ] Only new files created (zero modifications)
- [ ] All tests pass
- [ ] No naming conflicts
- [ ] Compound phase executed

⚠️ Workflow INCOMPLETE until all boxes checked

## Example
```
/w-suite-sync
# Fetches latest upstream, shows what's new, you pick what to sync
```
