# /w-perf

Performance Audit - Bottlenecks, N+1 queries, memory issues, optimization opportunities.

## Usage
```
/w-perf [target description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past performance optimizations
2. Profile and identify bottlenecks
3. Analyze and prioritize recommendations
4. Compound performance patterns

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip any performance category
- NEVER skip compound phase at the end
- VIOLATION: Incomplete profiling = incomplete audit

---

## Checks Performed
- N+1 query detection
- Memory leak analysis
- CPU bottlenecks
- I/O optimization
- Caching opportunities
- Bundle size analysis

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
- List of past optimizations (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past performance patterns. Proceed to Profiling?"
- Options: ["Continue", "Review past optimizations first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Profiling Done

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to verify the implementation visually
2. `agent-browser open <url>` → `agent-browser snapshot -i` → verify elements
3. Compare against pre-change screenshots from Search phase

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
| Category | Finding | Impact | Location |
|----------|---------|--------|----------|
| N+1 queries | _____ | _____ | _____ |
| Memory | _____ | _____ | _____ |
| CPU | _____ | _____ | _____ |
| I/O | _____ | _____ | _____ |
| Caching | _____ | _____ | _____ |
| Bundle size | _____ | _____ | _____ |

**🎯 Reference frame fidelity (UI work with a reference design, advisory here):** When the task is UI or animation work with a reference design, render the still (before any motion is added) to `"$ACTUAL"`, export the reference to `"$REF"`, list the containers as `[{id, x, y, w, h}]` in `"$REGIONS"`, and report the blurred PSNR per container alongside the screenshots. Skip this for non-UI work. Before running a block, put the real path in place of each `NAME='<...>'` placeholder at its top (a file:// or localhost URL for `URL`); shell variables do not persist between Bash calls, so run the block as one. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.

```bash
REF='<the reference PNG>'; [ -f "$REF" ] || echo "REF is still the placeholder or does not exist: put the path of the reference PNG in place of <the reference PNG>" >&2
ACTUAL='<the rendered still PNG>'; [ -f "$ACTUAL" ] || echo "ACTUAL is still the placeholder or does not exist: put the path of the rendered still PNG in place of <the rendered still PNG>" >&2
REGIONS='<the containers JSON you wrote>'; [ -f "$REGIONS" ] || echo "REGIONS is still the placeholder or does not exist: put the path of the containers JSON you wrote in place of <the containers JSON you wrote>" >&2
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js fidelity --ref "$REF" --actual "$ACTUAL" --regions "$REGIONS"; RC=$?; (exit $RC); fi
```

Exit 0: every container meets the target; exit 2: report each region with `pass: false` and its `psnr` in the findings table (advisory here: profiling goes on); exit 1 is wrong input: report it, never read it as a pass.

**🎞️ Deterministic frame capture (animation work only):** When the task is animation work, capture the animation frames under a stepped fake clock instead of real-time recording, so profiling screenshots are repeatable: `plan` prints the stepped fake-clock times (`steps_ms`, one per frame); `capture` records the page frame by frame on that clock into `"$FRAMES"`. Skip this for non-animation work. Before running a block, put the real path in place of each `NAME='<...>'` placeholder at its top (a file:// or localhost URL for `URL`); shell variables do not persist between Bash calls, so run the block as one. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.

```bash
URL='<the file:// or localhost page URL>'
FRAMES='<the output frames directory>'
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js frame-capture plan --fps 30 --frames 60; RC=$?; (exit $RC); fi
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js frame-capture capture --url "$URL" --out "$FRAMES" --fps 30 --frames 60; RC=$?; (exit $RC); fi
```

Exit 0 printed the plan or the captured frames; exit 1 is wrong input; exit 2 refused a URL that is not file:// or localhost (nothing was fetched); exit 4 means playwright (1.48+ with its Chromium) is not usable: report the printed `reason` and fall back to plain screenshots. The step is advisory: whatever it prints, the workflow goes on.

**AUTO-PROCEED:** Continue to Analysis phase.

---

### ⛔ CHECKPOINT 2: Analysis Complete

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Final visual verification with agent-browser — focus on performance impact, load times, rendering
2. `agent-browser open <url>` → `agent-browser screenshot` → compare before/after
3. Verify responsive layout, dark mode, accessibility

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Prioritized recommendations (by impact)
- Estimated improvement metrics
- Implementation suggestions

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

### ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/performance/_____
- Doc path: docs/solutions/performance/_____.md
- All findings documented: yes/no

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
- [ ] TodoWrite used at start with all 4 phases
- [ ] Checkpoint 0 completed with user confirmation
- [ ] Checkpoints 1-3 completed (auto-proceed)
- [ ] All performance categories checked
- [ ] Recommendations prioritized
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Performance doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/performance/[target-area]
Doc: docs/solutions/performance/[audit-name].md
```

## Example
```
/w-perf dashboard loading
```
