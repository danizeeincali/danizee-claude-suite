# /w-security

Security Audit - OWASP top 10, auth/authz, data exposure analysis.

## Usage
```
/w-security [target description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past security findings
2. Run comprehensive security scan
3. Analyze and prioritize risks
4. Compound security patterns

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip any OWASP category
- NEVER skip compound phase at the end
- VIOLATION: Incomplete scan = incomplete audit

---

## Checks Performed
- SQL injection
- XSS (Cross-Site Scripting)
- CSRF (Cross-Site Request Forgery)
- Authentication bypass
- Secrets exposure
- Input validation
- Authorization flaws

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
- List of past security findings (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past security findings. Proceed to Scan?"
- Options: ["Continue", "Review past findings first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Scan Complete

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to verify the implementation visually — focus on security-related UI aspects, auth flows, input sanitization display
2. `agent-browser open <url>` → `agent-browser snapshot -i` → verify elements
3. Compare against pre-change screenshots from Search phase

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
| Category | Finding | Severity | Location |
|----------|---------|----------|----------|
| SQL Injection | _____ | _____ | _____ |
| XSS | _____ | _____ | _____ |
| CSRF | _____ | _____ | _____ |
| Auth bypass | _____ | _____ | _____ |
| Secrets | _____ | _____ | _____ |
| Input validation | _____ | _____ | _____ |
| Authz flaws | _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Analysis phase.

---

### ⛔ CHECKPOINT 2: Analysis Done

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Final visual verification with agent-browser
2. `agent-browser open <url>` → `agent-browser screenshot` → compare before/after
3. Verify responsive layout, dark mode, accessibility

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Risk assessment summary
- Prioritized remediation list (by severity)
- Recommended fixes

**🔎 Code Analysis (lenses and impact over the change under review):** Run these two, in order, over the range printed by `diff-range` (everything since the merge base with the upstream branch, plus uncommitted edits and untracked files; the whole history when there is no upstream: then `removed_with_live_callers` cannot find removals, so say the removal check did not run). If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before. Each block starts with a guard for that: with no kit it prints "kit not installed" and ends with status 0, without closing your shell.

1. Lenses: which review rules apply to the changed files.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else D=$(mktemp 2>/dev/null) && [ -n "$D" ] || { echo "mktemp failed: no temp file for the range" >&2; D=; RC=1; }
if [ -n "$D" ]; then node .claude/helpers/kit/cli.js diff-range > "$D"; RC=$?
case $RC in 0) node .claude/helpers/kit/cli.js lenses --diff "$D"; RC=$?;; 3) echo "no change to review"; RC=0;; *) echo "diff-range failed (exit $RC): the change range was not read" >&2;; esac; fi; [ -z "$D" ] || rm -f "$D"; (exit $RC); fi
```

2. Impact: what depends on the change. The base is resolved once into `B` and given to both `diff-range` and `impact` so they cannot disagree.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else B=$(node .claude/helpers/kit/cli.js diff-range --base-only); RC=$?
if [ $RC -ne 0 ] || [ -z "$B" ]; then [ $RC -eq 0 ] && RC=1; echo "diff-range --base-only failed (exit $RC): the base was not resolved" >&2; else D=$(mktemp 2>/dev/null) && [ -n "$D" ] || { echo "mktemp failed: no temp file for the range" >&2; D=; RC=1; }
if [ -n "$D" ]; then node .claude/helpers/kit/cli.js diff-range --base "$B" > "$D"; RC=$?
case $RC in 0) node .claude/helpers/kit/cli.js impact --diff "$D" --base "$B"; RC=$?;; 3) echo "no change to review"; RC=0;; *) echo "diff-range failed (exit $RC): the change range was not read" >&2;; esac; fi; [ -z "$D" ] || rm -f "$D"; fi; (exit $RC); fi
```

How to read the results: each entry in `fired` (lenses) has a `name`, the `files` it matched and a `body` to apply as an extra check on those files: add its findings to the review findings above, and mention a non-empty `capped` list. For impact, check every entry of `removed_with_live_callers` (a removal with a caller left behind is a defect until shown otherwise), the `risk` level with its `reasons` and every row of `cuts`; when `risk.lower_bound` is true or `cuts` is not empty the level is a floor, never write "nothing else is affected". Print each symbol's `sentences` as they are; a symbol with `floor: true` and no callers found is not unused.
Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure and never "no lens applies"; the block sets its own status to 0 in that case. Exit 1 is wrong input or a broken state: report it, never skip the step. Exit 2 is a refusal (the repository, a range over 32 MiB, or the verb itself): report it as printed and stop that step, never retry it. Exit 0 from `diff-range` can still leave files out: it writes a note to stderr for an untracked file over the size cap (`too_large`, named) and for untracked files over the count cap (`max_untracked`, a count only); name each skipped file in the findings, say it was not analysed, and treat every result as a floor. If `diff-range` itself fails the step prints "diff-range failed" and the verb does not run; if the temp file cannot be made it prints "mktemp failed": report that the change was not analysed, never "nothing found". Any other non-zero exit (for example 127, or a signal) is a failure of that step: report it, never read it as nothing found.


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

### 🔒 CLOSING STEP: Scrub and receipt
After Verification passes and before Compound, first run `git add` on the new files the work created: `scrub --worktree` scans tracked files only and the receipt is keyed on the base and the tracked tree, so untracked files are in neither until they are added. Then scan the tracked files as they are on disk for secrets, and record the review verdict. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): scrub skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js scrub --worktree; RC=$?; (exit $RC); fi
```
Exit 0 is clean for the tracked files (or no pattern file is configured: then nothing was scanned, say so); a file still untracked was not scanned. Exit 2 means hits or an incomplete scan: list them as printed and do not commit. Exit 1 is wrong input or a broken state: report it, never read it as clean, do not commit. Any other non-zero exit is a failure of the step: report it, do not commit. After a scrub refusal or failure record no receipt (skip the receipt commands below) and continue to Compound.

Then record the counts from the review findings, with the real finding counts in place of the numbers (add `--incomplete` if any category was skipped). With no kit, skip this too and say so ("kit not installed (.claude/helpers/kit/cli.js missing): receipt skipped, advisory"). Use the form that matches the verdict:
```
node .claude/helpers/kit/cli.js push-gate receipt --verdict pass --high 0 --medium 0 --low 0
node .claude/helpers/kit/cli.js push-gate receipt --verdict fail --high 1 --medium 2 --low 0
```
Exit 0 means the receipt was written; exit 1 is wrong input or a broken state and exit 2 a refused receipt store: report either as printed, never read a failed receipt as recorded. Any other non-zero exit is a failure of the step: name the exit code, never read it as recorded. Compound may change tracked files: after Compound, `git add` its new files and, if the tracked tree changed, record the receipt again, only when a receipt was recorded before Compound, so it matches what is committed. Then tell the user: run `node .claude/helpers/kit/cli.js push-gate check` before pushing (same `--base`, or none, used for the receipt). Its exit 0 means abstain or ask (read `decision`), exit 2 deny (read `decision` and `reason`) or a refused receipt store (`kit: refused:` on stderr), and exit 1 an error; none is an allow. It only abstains, asks or denies; it never skips their permission prompt.

---

### ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/security/_____
- Doc path: docs/solutions/security/_____.md
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
- [ ] All OWASP categories scanned
- [ ] Risk assessment completed
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Security doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/security/[target-area]
Doc: docs/solutions/security/[audit-name].md
```

## Example
```
/w-security authentication module
```
