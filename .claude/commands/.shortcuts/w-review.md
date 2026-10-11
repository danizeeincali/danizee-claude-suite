# /w-review

Full Review - 12+ specialized agents analyze code, security, performance, architecture.

## Usage
```
/w-review [PR number or description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past review patterns
2. Run code analysis
3. Run security scan
4. Run performance check
5. Run architecture review
6. Compound review findings

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip any review category
- NEVER skip compound phase at the end
- VIOLATION: Completing review without all categories = incomplete

---

## Agents Deployed
- code-simplicity-reviewer
- security-sentinel
- performance-oracle
- architecture-strategist
- pattern-recognition-specialist

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
- List of past reviews (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past reviews for this area. Proceed to Code Analysis?"
- Options: ["Continue", "Review past findings first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Code Analysis

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to verify the implementation visually
2. `agent-browser open <url>` → `agent-browser snapshot -i` → verify elements
3. Compare against pre-change screenshots from Search phase

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**🔎 LENS CHECKS (file-triggered review rules):**
Review rules live as markdown files (built in, plus any in `.claude/kit/lenses/`). Write the change under review to a temp file and ask which rules apply:
The range is built by `diff-range`: everything since the merge base with the upstream branch (the whole history when there is no upstream), plus uncommitted edits and untracked files, paths bare. If the review was started with a base (`push-gate receipt --base <ref>`), pass `--base <ref>` to `diff-range` so both cover the same change.
```bash
D=$(mktemp); node .claude/helpers/kit/cli.js diff-range > "$D"; RC=$?
case $RC in 0) node .claude/helpers/kit/cli.js lenses --diff "$D"; RC=$?;; 3) echo "no change to review";; *) echo "diff-range failed (exit $RC): the change range was not read" >&2;; esac; rm -f "$D"; (exit $RC)
```
Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure and never "no lens applies". Any other non-zero exit is wrong input or a broken state: report it, never skip the step. Exit 2 means `diff-range` refused the repository (for example an include in its own config): report the refusal as printed. (Wrong input includes not a repository, an unknown base or a git failure.)
Each entry in `fired` has a `name`, the `files` it matched and a `body`: apply the body as an extra check on those files and add its findings to the table below. A non-empty `capped` list means more lenses applied than the cap (4); mention them in the table. If a deterministic check already ran for the same rule, say so with `--covered` (for example `--covered no-floating-promises`) and that lens stands down. The block keeps the exit status after removing the temp file. A non-zero exit from `lenses` itself means wrong input or a broken lens file: report it, do not skip the step.

**🕸️ SYMBOL GRAPH AND BLAST RADIUS (calls around the changed files, and what depends on them):**
Build the call graph for the files this change touches. It reads JS/TS source only, scans each file once and caches the facts by content hash (so a second run is quick), scans the changed files first, and stops at a time budget instead of stalling. It never runs the code it reads. Same range as above, written to its own temp file:
```bash
D=$(mktemp); node .claude/helpers/kit/cli.js diff-range > "$D"; RC=$?
case $RC in 0) node .claude/helpers/kit/cli.js graph --diff "$D" --budget-ms 20000 --max-parses 300; RC=$?;; 3) echo "no change to review";; *) echo "diff-range failed (exit $RC): the change range was not read" >&2;; esac; rm -f "$D"; (exit $RC)
```
The summary has `partial`, `not_read` (each file with a reason: budget, parse_cap, too_large, unsupported or parse_error) and `changed` (how many of the changed files were read). Add the graph's findings (callers and callees of changed definitions, `--json` gives the full edge list) to the table below, and state `partial` and every `not_read` entry in the review as it is: when `partial` is true the graph is a floor, not the whole picture, so never write that "nothing else calls this" from it. A `possible` edge is a name match, not a proof. Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure and never "no lens applies". Any other non-zero exit is wrong input or a broken state: report it, never skip the step. Exit 2 means `diff-range` refused the repository (for example an include in its own config): report the refusal as printed.

Then the blast radius: the same range, with its base resolved once into `B` and passed to both `diff-range` and `impact` so they cannot disagree (when the review was started with a base ref, put that ref on the one line: `B=<ref>` in place of the `--base-only` call), maps each changed line to the innermost definition around it and follows who calls, extends or implements it for two hops (certain edges first, production before tests, nearer folders first). With a base it also finds definitions the change removes and flags each one the tree still calls:
```bash
B=$(node .claude/helpers/kit/cli.js diff-range --base-only) || { echo "diff-range --base-only failed: the base was not resolved" >&2; B=; }
if [ -z "$B" ]; then RC=1; else D=$(mktemp); node .claude/helpers/kit/cli.js diff-range --base "$B" > "$D"; RC=$?
case $RC in 0) node .claude/helpers/kit/cli.js impact --diff "$D" --base "$B"; RC=$?;; 3) echo "no change to review";; *) echo "diff-range failed (exit $RC): the change range was not read" >&2;; esac; rm -f "$D"; fi; (exit $RC)
```
List what to check from the result: each symbol in `touched`, then the `impacted` symbols in the order given (each with its hop, `confidence` and `path`), every entry of `removed_with_live_callers` (a removal with a caller left behind is a defect until shown otherwise), and the `risk` level with its `reasons`. State the limits as they are: every row of `cuts` (`at`, `kind`, how many were `omitted`) and any `hubs` (symbols with too many callers to list), `partial` with `not_read`, `unmapped` and `old_not_read`, and the `notes`. Every touched, impacted and removed symbol also has `floor`, `reasons` and `sentences` (the caller floor: same-name calls not tied to one definition, calls through a value or computed member, interface dispatch, unread files, budget cuts): print each symbol's `sentences` as they are and check those call sites by hand. A symbol with `floor: true` and no callers found is not unused and a removed one is not safe to remove; never read zero callers as proof of no use. For one symbol, `node .claude/helpers/kit/cli.js callers --symbol src/file.js:name` prints the same entry (paths are relative to the repository top). When `risk.lower_bound` is true, or `cuts` is not empty, the level is a floor and the list is not everything that depends on the change: never write "nothing else is affected" from it. If `diff-range` itself fails the step prints "diff-range failed" and the verb does not run: report that the change was not mapped, never "no change to map". Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure and never "no lens applies". Any other non-zero exit is wrong input or a broken state: report it, never skip the step. Exit 2 means `diff-range` refused the repository (for example an include in its own config): report the refusal as printed.

**REQUIRED OUTPUT:**
| Category | Finding | Severity |
|----------|---------|----------|
| Style | _____ | _____ |
| Patterns | _____ | _____ |
| Quality | _____ | _____ |
| Simplicity | _____ | _____ |

**AUTO-PROCEED:** Continue to Security Scan phase.

---

### ⛔ CHECKPOINT 2: Security Scan
**REQUIRED OUTPUT:**
| Vulnerability | Risk | Location |
|---------------|------|----------|
| _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Performance Check phase.

---

### ⛔ CHECKPOINT 3: Performance Check
**REQUIRED OUTPUT:**
| Opportunity | Impact | Location |
|-------------|--------|----------|
| _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Ralph Candidates phase.

---

### ⛔ CHECKPOINT 4: Ralph Candidates (AUTO-PROCEED)
**Scan for dev patterns that could become future Ralph loops:**
- Repeating code patterns in this PR
- Bug fix patterns that recur
- Feature patterns worth templating

**If candidate identified:**
1. Generate unique ID: RC-NNN (check .claude/ralph-candidates.md for next available)
2. Assign priority: P1 (critical) / P2 (important) / P3 (nice-to-have)
3. Define AI-verifiable completion tests:
   - File exists: `path/to/expected/file`
   - Pattern match: `"regex"` in `file`
   - Test passes: `npm test -- --grep "name"`
   - Lint clean: `npm run lint`
4. Add entry to .claude/ralph-candidates.md
5. Set initial status: draft

**REQUIRED OUTPUT:**
- Candidates identified: 0/1/2+
- If any:
  - ID(s) added: RC-___
  - Priority: P_
  - Completion tests defined: yes/no

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

### ⛔ CHECKPOINT 5: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/reviews/_____
- Doc path: docs/solutions/reviews/_____.md
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
- [ ] TodoWrite used at start with all 6 phases
- [ ] Checkpoint 0 completed with user confirmation
- [ ] Checkpoints 1-5 completed (auto-proceed)
- [ ] Code analysis completed
- [ ] Security scan completed
- [ ] Performance check completed
- [ ] Ralph candidates scanned
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Review doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Closing step: record the push receipt
Record the review's counts so the advisory push gate can recognise this exact change. Use the form that matches the verdict, with the real finding counts in place of the numbers (add `--incomplete` if any category was skipped, and `--threshold high`, `--threshold medium` or `--threshold low` if the user wants the push check to deny at that level):
```
node .claude/helpers/kit/cli.js push-gate receipt --verdict pass --high 0 --medium 0 --low 0
node .claude/helpers/kit/cli.js push-gate receipt --verdict fail --high 1 --medium 2 --low 0
```
Then tell the user: run `node .claude/helpers/kit/cli.js push-gate check` before pushing, with the same `--threshold` level and the same `--base` (or none) used for the receipt. It only abstains, asks or denies; it never skips their permission prompt. Reviewing uncommitted edits and then committing them unchanged still matches. If the repository has `.claude/kit/scrub-patterns` or `.claude/kit/scrub-patterns.local`, the check also scrubs against them the files of HEAD and every blob in the commits being pushed (`<base>..HEAD`, the same base; the commits no remote-tracking ref has when there is none, or all of HEAD's history when the repository has no remote-tracking refs; a git call that times out is a deny too: raise it with `--timeout <ms>`), so a secret that was committed and removed again is found (`node .claude/helpers/kit/cli.js scrub` lists the HEAD hits, `scrub --history <base>` the pushed range), and denies on any hit, on an incomplete scan, or when the scrub cannot run, whatever the receipt says.

## Compounds
```
Memory: project/reviews/[pr-topic]
Doc: docs/solutions/reviews/[pr-number].md
```

## Example
```
/w-review PR 47
```
