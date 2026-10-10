# /w-autoresearch

Autonomous experiment loop. Runs experiments, measures results, keeps winners, discards losers.

## Usage
```
/w-autoresearch [optimization objective]     # Free-form: describe what to optimize
/w-autoresearch RC-A003                      # RC-A target: use pre-defined candidate
/w-autoresearch optimize test suite runtime  # Example: optimize test speed
```

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Mode Detection

**If argument matches RC-A[NNN] pattern:**
1. Read .claude/ralph-candidates.md
2. Find the matching RC-A entry
3. Extract: KPI name, baseline, benchmark command, files in scope, constraints
4. Skip to CHECKPOINT 2 (Setup) with pre-filled values

**If argument is free-form text:**
1. Use the text as the optimization objective
2. Proceed to CHECKPOINT 1 (Discovery)

**AUTO-PROCEED:** Continue to next phase.

---

### ⛔ CHECKPOINT 1: Discovery (free-form mode only)

Gather information for the experiment:
1. **Objective:** What are we optimizing? (from user argument)
2. **Primary metric:** What number tells us if we improved? (e.g., test_duration_seconds, bundle_size_kb)
3. **Direction:** maximize or minimize?
4. **Benchmark command:** How to measure the metric? Must output `METRIC name=number`
5. **Files in scope:** What can the experiment modify?
6. **Constraints:** What must NOT break? (e.g., "all tests must still pass")

**AUTO-PROCEED:** Continue to Setup.

---

### ⛔ CHECKPOINT 2: Setup

1. Create feature branch: `git checkout -b autoresearch/[goal-slug]`
2. Read source files deeply — understand what you're optimizing
3. Create `autoresearch.md` — session blueprint with objective, metrics, scope, constraints
4. Create `autoresearch.sh` — benchmark runner (outputs `METRIC name=number`)
5. Run baseline measurement
6. Initialize `autoresearch.jsonl` with config header
7. Create `experiments/worklog.md` for narrative log

**AUTO-PROCEED:** Continue to Background Dispatch.

---

### ⛔ CHECKPOINT 3: Background Dispatch

Launch a background agent that runs the experiment loop autonomously:

**The loop (runs forever until paused):**
**Before each experiment (clean-tree precondition):** run `git diff --quiet && git diff --cached --quiet` and `git ls-files --others --exclude-standard`. The tree is clean when both diff checks exit 0 and the untracked list holds nothing but the loop's own state files (the State Files table below, and `.autoresearch-off`); keep those state files untracked (never `git add` them). If the tree is not clean (a staged path, an unstaged edit or another untracked file, any of which may be someone else's work), do not start the experiment and touch nothing (no stash, reset, checkout or clean): pause the loop (create `.autoresearch-off`) and log why ("paused: tree not clean before experiment: <paths>"). So the index only ever holds the experiment's own changes.
1. **Think:** Based on worklog and ideas, choose next experiment
2. **Implement:** Make the code change
3. **Run:** Execute `./autoresearch.sh`, capture output
4. **Parse:** Extract `METRIC name=number` lines
5. **Evaluate:**
   - **Keep:** metric improved → run the scrub below, then `git commit` with Result trailer; a scrub refusal means no commit: treat it as a Crash (log the hits, take the path lists recorded in the scrub step, revert in this order: first unstage with `git reset -q -- <the experiment's paths>` (the scrub step already ran `git add`, and the checkout restores from the index), then `git checkout -- <its tracked paths>` (only those, never `git checkout -- .`, which would also wipe edits that are not the experiment's; a new path in that list makes the whole checkout fail; with none, skip the checkout); if the experiment created new paths, `git clean -fd -- <those paths>` so a refused new file does not stay on disk untracked and unscanned; with none, skip the clean; never run git clean without a path (`git clean -fd --` with no path deletes every untracked file, the loop's state and `.autoresearch-off` included); here <the experiment's paths> is the recorded list from `git diff --cached --name-only --no-renames`, <its tracked paths> the recorded list from `git diff --cached --name-only --no-renames --diff-filter=a` and <those paths> the recorded list of new paths from `git diff --cached --name-only --no-renames --diff-filter=A`; if the unstage failed, do not count it as reverted: report it and pause the loop (create `.autoresearch-off`); then try a different approach). After 3 consecutive scrub refusals pause the loop: create `.autoresearch-off` and log why ("paused: 3 consecutive scrub refusals"); a Keep or Discard resets the count
   - **Discard:** metric worse/equal → revert the experiment's changes only: `git add` the files it changed by path, save the three path lists as in the scrub step, then revert in the same order as after a scrub refusal (unstage, checkout of its tracked paths, guarded clean of its new paths); never `git checkout -- .`
   - **Crash:** non-zero exit → log error, revert as for Discard, try different approach
6. **Log:** Append result to `autoresearch.jsonl`, update dashboard
7. **Loop:** Go to step 1

**ERROR HANDLING:** Log errors but NEVER abort. Revert and try a different approach.

**Put this in the background agent's prompt (scrub before every Keep commit):**
**Scrub before the commit:** `git add` the files this experiment changed first (and any new file they create), by path (never `git add -A` or `git add .`: they would stage the loop's untracked state): right after that `git add`, and before any `git reset`, list the experiment's paths with `git diff --cached --name-only --no-renames`, its new paths with `git diff --cached --name-only --no-renames --diff-filter=A` and its tracked paths (all but the new ones) with `git diff --cached --name-only --no-renames --diff-filter=a`, and save the three lists in the experiment's log entry (`--no-renames` so a rename lists both its old and its new path; do not use `git status` or `git ls-files --others`: they also list the loop's untracked state such as autoresearch.jsonl); the clean-tree precondition means the index held nothing before this `git add`, so these lists are exactly the experiment's own paths and nobody else's; the revert on a refusal uses those lists. `scrub --worktree` scans tracked files only, so an untracked file is not scanned. Then scan the tracked files as they are on disk for secrets. Before the scrub, check that no tracked file has unstaged changes: run a plain `git diff --quiet` with no path (exit 0 means none). Check the whole index, not only the paths just staged: `git commit` commits everything staged, by anyone, earlier included, so a check limited to the paths just staged misses an earlier staged path whose disk copy differs. The scrub reads each file's content from disk but git commits the index, so the two must agree. Exit 1 means unstaged changes: re-stage the paths `git diff --name-only` lists (`git add`) and check once more before the scrub; with the clean-tree precondition every one of them is the experiment's own, so list the three path lists again and save them in place of the earlier ones. Any other exit (128 and above) is a git error: report it and do not commit. The block below runs the scrub only when this check exits 0: on exit 1 it prints the message, runs no scrub and exits 1, on 128 and above it runs no scrub and exits with that code, so after the re-stage run the whole block again (never only its scrub line) and commit only when that run exits 0. If the re-check still exits non-zero, report it and do not commit. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
git diff --quiet; D=$?; if [ $D -eq 1 ]; then echo "unstaged changes: re-stage the paths git diff --name-only lists, then run this block again"; (exit 1); elif [ $D -ne 0 ]; then echo "git error (exit $D): do not commit"; (exit $D); elif [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): scrub skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js scrub --worktree; RC=$?; (exit $RC); fi
```
Exit 0 is clean for the tracked files (or no pattern file is configured: then nothing was scanned, say so); a file still untracked was not scanned. Exit 2 means hits or an incomplete scan: list them as printed and **do not commit**. Exit 1 is wrong input or a broken state: report it, never read it as clean, do not commit. Any other non-zero exit is a failure of the step: report it, do not commit. After any refusal unstage the paths so they cannot ride along in a later commit: `git reset -q -- <those paths>; RC=$?`, and if that exit is non-zero report "unstage failed (exit $RC): still staged: <those paths>" and say the owner must unstage them.


**Pausing:** Create `.autoresearch-off` sentinel file, or user sends `/autoresearch off`

---

## State Files

| File | Purpose |
|------|---------|
| `autoresearch.md` | Session blueprint (objective, rules, what's been tried) |
| `autoresearch.sh` | Benchmark runner (must output METRIC lines) |
| `autoresearch.jsonl` | Structured state (config + results) |
| `autoresearch-dashboard.md` | Progress visualization |
| `autoresearch.ideas.md` | Promising untried optimizations |
| `experiments/worklog.md` | Narrative experiment log |

## JSONL Protocol

**Config header:**
```json
{"type": "config", "goal": "...", "primary_metric": "...", "direction": "maximize|minimize", "command": "./autoresearch.sh", "started": "ISO8601"}
```

**Result line:**
```json
{"type": "result", "run": 1, "commit": "abc123", "metric": 0.783, "status": "keep|discard|crash", "timestamp": "ISO8601", "notes": "what changed"}
```

## Example

```
# Free-form: optimize test runtime
/w-autoresearch optimize test suite runtime

# Run against a pre-defined RC-A candidate
/w-autoresearch RC-A003

# Pause a running experiment
/autoresearch off
```
