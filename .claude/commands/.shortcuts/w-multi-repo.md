# /w-multi-repo

Multi-Repository - Coordinates changes across repos with dependency awareness.

## Usage
```
/w-multi-repo [task description]
```

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

**🔒 Git reads of a repository you did not write (safe-git):** A dependency, vendored or upstream checkout, or a repo cloned only to read is not yours to trust; this applies to any repository in this task that you did not write. Every git read of it goes through `node .claude/helpers/kit/cli.js safe-git --dir <clone top> -- <git args>`, never plain `git -C <path> ...` and never `cd` into it to run git (its config and hooks were not written by you). `<clone top>` is the top directory of that checkout (the directory that holds its `.git`); `--dir` must be the clone top itself, not a subfolder of it, and paths in the git args are relative to it. Only read-only verbs on safe-git's allow-list are accepted (for example rev-parse, log, show, ls-tree, cat-file); any other verb is refused. Read the process exit code, not a field of the output: 0 git ok (it prints `{ stdout, stderr, code, exit }` and `stdout` is the answer), 1 bad input (stdout is empty, the reason is a `kit:` line on stderr: fix the call, retry once), 2 refused (stdout is empty, the reason is a `kit: refused:` line on stderr: do not retry, report it as printed and treat that read as not done), 3 git failed or timed out (when git ran and failed it prints `{ stdout, stderr, code, exit }` with a non-zero `code`: fix a wrong call and retry once; when git timed out, printed over 256 MiB or was killed by a signal it prints nothing on stdout, only a `kit:` line on stderr, and `--timeout <ms>` raises the 60000 ms default). Only exit 0 and a git-ran exit 3 print that JSON; a timeout, overflow or kill prints only a `kit:` stderr line. Any other non-zero exit (for example 127, or a signal) is a failure of that step: report it, never read it as nothing found. If `.claude/helpers/kit/cli.js` is missing, say "kit not installed (.claude/helpers/kit/cli.js missing): safe-git skipped, advisory" in one line and continue without running git on that checkout (read its files directly); the kit is advisory and never blocks a workflow that worked before.

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
- Lens findings per repo: _____ (or the one-line kit skip)

**🔎 Code Analysis (lenses over the change under review):** Run this in each repository you changed, from its top (cd there first; a repository without the kit prints the one-line skip), over the range printed by `diff-range` (everything since the merge base with the upstream branch, plus uncommitted edits and untracked files; the whole history when there is no upstream; no removal check runs in this workflow (lenses only)). If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before. Each block starts with a guard for that: with no kit it prints "kit not installed" and ends with status 0, without closing your shell.

1. Lenses: which review rules apply to the changed files.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else D=$(mktemp 2>/dev/null) && [ -n "$D" ] || { echo "mktemp failed: no temp file for the range" >&2; D=; RC=1; }
if [ -n "$D" ]; then node .claude/helpers/kit/cli.js diff-range > "$D"; RC=$?
case $RC in 0) node .claude/helpers/kit/cli.js lenses --diff "$D"; RC=$?;; 3) echo "no change to review"; RC=0;; *) echo "diff-range failed (exit $RC): the change range was not read" >&2;; esac; fi; [ -z "$D" ] || rm -f "$D"; (exit $RC); fi
```

How to read the results: each entry in `fired` (lenses) has a `name`, the `files` it matched and a `body` to apply as an extra check on those files: add its findings to the review findings above, and mention a non-empty `capped` list.
Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure and never "no lens applies"; the block sets its own status to 0 in that case. Exit 1 is wrong input or a broken state: report it, never skip the step. Exit 2 is a refusal (the repository, a range over 32 MiB, or the verb itself): report it as printed and stop that step, never retry it. Exit 0 from `diff-range` can still leave files out: it writes a note to stderr for an untracked file over the size cap (`too_large`, named) and for untracked files over the count cap (`max_untracked`, a count only); name each skipped file in the findings, say it was not analysed, and treat every result as a floor. If `diff-range` itself fails the step prints "diff-range failed" and the verb does not run; if the temp file cannot be made it prints "mktemp failed": report that the change was not analysed, never "nothing found". Any other non-zero exit (for example 127, or a signal) is a failure of that step: report it, never read it as nothing found.

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
- [ ] Git reads of repositories you did not write went through safe-git, and lenses ran on each changed repo (or one line said the kit is not installed)
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
