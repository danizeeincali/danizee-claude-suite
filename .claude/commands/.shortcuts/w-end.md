# /w-end

Gracefully end a session by compounding knowledge and committing work.

## Usage
```
/w-end
/w-end [category]
```

Categories: feature, bug, security, performance, architecture, debug

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete all steps. NEVER skip compound or commit.

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Summary
**REQUIRED OUTPUT:**
- Work accomplished: _____
- Files modified: _____
- Tests added/changed: _____
- Key decisions: _____

**USER GATE:** Use AskUserQuestion
- Question: "Session summary ready. Proceed to Compound?"
- Options: ["Continue", "Add more details"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/[category]/_____
- Doc path: docs/solutions/[category]/_____.md
- Patterns captured: _____

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

**AUTO-PROCEED:** Continue to Commit phase.

---

### ⛔ CHECKPOINT 2: Commit (MANDATORY - NEVER SKIP)
Stage the specific session files (not `git add -A`), then scrub them, then commit.

**Scrub before the commit:** `git add` the paths to commit first (and any new file they create): `scrub --worktree` scans tracked files only, so an untracked file is not scanned. Then scan the tracked files as they are on disk for secrets. Before the scrub, check that no tracked file has unstaged changes: run a plain `git diff --quiet` with no path (exit 0 means none). Check the whole index, not only the paths just staged: `git commit` commits everything staged, by anyone, earlier included, so a check limited to the paths just staged misses an earlier staged path whose disk copy differs. The scrub reads each file's content from disk but git commits the index, so the two must agree. Exit 1 means unstaged changes: re-stage (`git add`) only the paths that appear in both `git diff --name-only` and `git diff --cached --name-only` (staged files with a later edit on disk), then check once more before the scrub. For any other path `git diff --name-only` lists, do not run `git add` on it: stop and ask the owner with AskUserQuestion: "Unstaged edits in <paths> are not part of this session's files. Include them, leave them out, or stop?" with options ["Leave them out and commit", "Include them", "Stop"]. "Include them" means `git add` those paths, then check again; "Stop" means do not commit; "Leave them out and commit" means the check is run as `git diff --quiet -- $(git diff --cached --name-only)` over the staged paths only: run the block with that command in place of its first `git diff --quiet`, so the scrub still runs only when that check exits 0. Any other exit (128 and above) is a git error: report it and do not commit. The block below runs the scrub only when this check exits 0: on exit 1 it prints the message, runs no scrub and exits 1, on 128 and above it runs no scrub and exits with that code, so after the re-stage run the whole block again (never only its scrub line) and commit only when that run exits 0. If the re-check still exits non-zero, report it and do not commit. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
git diff --quiet; D=$?; if [ $D -eq 1 ]; then echo "unstaged changes: re-stage only paths in both git diff --name-only and git diff --cached --name-only; ask the owner about any other path; then run this block again"; (exit 1); elif [ $D -ne 0 ]; then echo "git error (exit $D): do not commit"; (exit $D); elif [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): scrub skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js scrub --worktree; RC=$?; (exit $RC); fi
```
Exit 0 is clean for the tracked files (or no pattern file is configured: then nothing was scanned, say so); a file still untracked was not scanned. Exit 2 means hits or an incomplete scan: list them as printed and **do not commit**. Exit 1 is wrong input or a broken state: report it, never read it as clean, do not commit. Any other non-zero exit is a failure of the step: report it, do not commit. After any refusal unstage the paths so they cannot ride along in a later commit: `git reset -q -- <those paths>; RC=$?`, and if that exit is non-zero report "unstage failed (exit $RC): still staged: <those paths>" and say the owner must unstage them.

Commit only after the scrub exited 0 (or the kit is not installed); after a refusal write "not committed — scrub refused: <hits>" as the commit message line below; nothing was committed.

**REQUIRED OUTPUT:**
- Commit message: _____
- Files staged: _____
- Scrub: clean / refused (<hits>) / kit not installed
- Commit hash: _____

**USER GATE:** Use AskUserQuestion. The gate depends on the scrub result:
- After a scrub refusal (nothing was committed): Question: "Not committed: scrub refused. Fix and retry?" Options: ["Fix and retry", "Done without committing"]. There is no push option on this path.
- On the normal path: Question: "Commit complete. Session ended. Run /w-start to resume later." Options: ["Done", "Push to remote"]

STOP and wait for user response.

**On "Push to remote" (normal path only):** run the push gate first. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): push-gate check skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js push-gate check; RC=$?; (exit $RC); fi
```
Read the printed `decision` and `reason`. The gate stays advisory: it only abstains, asks or denies, and it never allows, skips or answers the owner's own permission prompt for the push.
- Exit 0 with decision `abstain`: push (`git push -u origin HEAD`).
- Exit 0 with decision `ask` and a `reason` starting "no review recorded for this change": the push goes on, and the summary says "no review recorded for this change, pushed (run /w-review next time)".
- Exit 0 with any other `ask` (a failed review, another threshold, or "only an earlier review exists, for a different version of this change", which also fires when the repository's store holds a receipt for another version or for another branch or change in the same repository): **not pushed**; only the "no review recorded" ask lets the push go on. Write "not pushed — gate asks: <reason>" (the `reason` as printed) and let the owner decide; never answer the ask yourself. The remedy for the "earlier review" ask is to run /w-review (or record a receipt) on the current change and rerun the check.
- Exit 2 is a deny (read `decision` and `reason`) or a refused receipt store (`kit: refused:` on stderr): **not pushed**; report it as printed.
- Exit 1 is an error: report it and do not push. Any other non-zero exit is a failure of the step: report it and do not push.

---

## What Gets Captured
- Problems solved and approaches used
- Key decisions made
- Patterns discovered
- Files modified
- Tests added/changed

## Completion Checklist

- [ ] Checkpoint 0 completed with user confirmation
- [ ] Checkpoint 1 completed (auto-proceed)
- [ ] Checkpoint 2 completed with user confirmation
- [ ] Session summary created
- [ ] Compound phase completed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Changes committed
- [ ] Ralph candidate check completed

⚠️ Session NOT properly ended until all steps complete

## Example
```
/w-end
/w-end feature
/w-end bug
```

## Next Session
Run `/w-start` to load this session's context and continue where you left off.
