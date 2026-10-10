# /w-agent-tdd-swarm

Fully Autonomous TDD Swarm — Zero user gates. Designed for terminal agents (tmux + worktree).

**Philosophy:** Same rigor as /w-tdd-swarm, but fully autonomous. No gates, no stops, auto-PR.

## Usage
```
/w-agent-tdd-swarm [feature description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past solutions
2. Plan architecture
3. Write spec/acceptance criteria
4. Write ALL tests (must fail)
5. Build implementation (tests pass)
6. Run full review
7. Commit, push, and create PR
8. Compound solution
9. Write completion report and notify parent

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ZERO user gates — this workflow runs fully autonomously
- NEVER proceed to Build before all tests exist and FAIL
- NEVER skip compound phase at the end
- ALWAYS create a PR at the end with `gh pr create --fill` when the push gate lets the push go on; otherwise report "not pushed — <reason>" and create none
- ALWAYS commit with descriptive messages

---

## Execution Protocol

### PHASE 0: Context Gathering (AUTO-PROCEED)
**Run /w-start on yourself first** to load project context, memory, follow-ups, and session state.

**AUTO-PROCEED:** Continue to Search.

---

### PHASE 1: Search (AUTO-PROCEED)
Search for past solutions. Check memory keys, search codebase for similar implementations, note reusable patterns.

**AUTO-PROCEED:** Continue to Pi Brain Discovery.

---

### PHASE 1.5: Pi Brain — Knowledge Discovery (AUTO-PROCEED)
**Search the Pi Brain network for existing knowledge matching this feature:**

```bash
# curl, query URL-encoded (preferred)
curl -s -G "https://pi.ruv.io/v1/memories/search" --data-urlencode "q=[feature description]" --data top_k=3

# HTTP fallback
curl -s "https://pi.ruv.io/v1/memories/search?q=[feature description]&top_k=3"
```

**If matching memories found:** Review steps for applicable patterns. Adapt proven approaches. Note memory IDs for voting later.
**If no matches:** Proceed normally.

**AUTO-PROCEED:** Continue to Plan.

---

### PHASE 2: Plan (AUTO-PROCEED)
**REQUIRED OUTPUT:**
- Architecture summary (3-5 bullets)
- Files to create/modify (list)
- Approach and rationale

**AUTO-PROCEED:** Continue to Spec.

---

### PHASE 3: Spec (AUTO-PROCEED)
**REQUIRED OUTPUT:**
- Acceptance criteria (numbered list)
- Test cases (numbered list)

**AUTO-PROCEED:** Continue to Tests.

---

### PHASE 4: Tests (BLOCKING GATE — TDD only)
**REQUIRED OUTPUT:**
- Test file paths: _____
- Test count: _____ tests written
- Test run result: "All _____ tests FAIL as expected"

**BLOCKING RULE:**
NEVER proceed to Build until:
- [ ] All tests written
- [ ] All tests RUN and FAIL
- [ ] Failure output captured

**AUTO-PROCEED:** Continue to Build after tests fail.

---

### PHASE 5: Build (AUTO-PROCEED)
**REQUIRED OUTPUT:**
- Implementation file paths: _____
- Test run result: "All _____ tests PASS"

**AUTO-PROCEED:** Continue to Review.

---

### PHASE 6: Review (AUTO-PROCEED)
Quick self-review. Fix any critical/high findings before proceeding.

| Category | Finding | Severity |
|----------|---------|----------|
| Security | _____ | _____ |
| Performance | _____ | _____ |
| Architecture | _____ | _____ |

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


**RETRY LOGIC (max 3 retries):**
- PASS → proceed to next phase
- FAIL + retries remaining → log failure reason, fix the issue, re-verify
- FAIL + max retries exceeded → log error and mark workflow as FAILED

---


---

### PHASE 7: Commit & PR (AUTO-PROCEED)
**REQUIRED ACTIONS:**
1. Stage all changes: `git add -A`
2. **Scrub before the commit:** `git add` the paths to commit first (and any new file they create): `scrub --worktree` scans tracked files only, so an untracked file is not scanned. Then scan the tracked files as they are on disk for secrets. Before the scrub, check that no tracked file has unstaged changes: run a plain `git diff --quiet` with no path (exit 0 means none). Check the whole index, not only the paths just staged: `git commit` commits everything staged, by anyone, earlier included, so a check limited to the paths just staged misses an earlier staged path whose disk copy differs. The scrub reads each file's content from disk but git commits the index, so the two must agree. Exit 1 means unstaged changes: re-stage the paths `git diff --name-only` lists (`git add`) and check once more before the scrub; any other exit (128 and above) is a git error: report it and do not commit. If the re-check still exits non-zero, report it and do not commit. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): scrub skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js scrub --worktree; RC=$?; (exit $RC); fi
```
Exit 0 is clean for the tracked files (or no pattern file is configured: then nothing was scanned, say so); a file still untracked was not scanned. Exit 2 means hits or an incomplete scan: list them as printed and **do not commit**. Exit 1 is wrong input or a broken state: report it, never read it as clean, do not commit. Any other non-zero exit is a failure of the step: report it, do not commit. After any refusal unstage the paths so they cannot ride along in a later commit: `git reset -q -- <those paths>; RC=$?`, and if that exit is non-zero report "unstage failed (exit $RC): still staged: <those paths>" and say the owner must unstage them.
3. Commit with descriptive message, only after the scrub exited 0 (or the kit is not installed). On any refusal stop here: no commit, no push, no PR.
4. Record the review receipt (after the commit, so it matches the committed tree), with the real finding counts from the Verification and Code Analysis output (add `--incomplete` if any category was skipped). With no kit say "kit not installed (.claude/helpers/kit/cli.js missing): receipt skipped, advisory" and continue:
```
node .claude/helpers/kit/cli.js push-gate receipt --verdict pass --high 0 --medium 0 --low 0
node .claude/helpers/kit/cli.js push-gate receipt --verdict fail --high 1 --medium 2 --low 0
```
   Verdict rule: `--verdict fail` when any high finding is open, else `--verdict pass`, always with the real counts. Exit 0 means the receipt was written; exit 1 is wrong input or a broken state and exit 2 a refused receipt store: report either as printed, never read it as recorded. Any other non-zero exit is a failure of the step: name the exit code. A failed receipt (exit 1, 2 or any other non-zero) means **not pushed**: write "not pushed: receipt not recorded (exit N)" into the final output and stop Phase 7 there, skip step 5 and the push; a review ran but its receipt was not written, so never let the gate's "no review recorded" case push it.
5. Run the push gate before the push. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): push-gate check skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js push-gate check; RC=$?; (exit $RC); fi
```
   Read the printed `decision` and `reason`. The gate stays advisory: it only abstains, asks or denies, and it never allows, skips or answers the owner's own permission prompt for the push.
   - Exit 0 with decision `abstain`: the push goes on.
   - Exit 0 with decision `ask` and a `reason` starting "no review recorded for this change": the push goes on, and the summary says "no review recorded for this change, pushed (run /w-review next time)".
   - Exit 0 with any other `ask` (a failed review, another threshold, or "only an earlier review exists, for a different version of this change", which also fires when the repository's store holds a receipt for another version or for another branch or change in the same repository): **not pushed**; only the "no review recorded" ask lets the push go on. Write "not pushed — gate asks: <reason>" (the `reason` as printed) into the final output and stop Phase 7 there: this workflow has no user gate, so the owner reads the line and decides; never answer the ask yourself. The remedy for the "earlier review" ask is to run /w-review (or record a receipt) on the current change and rerun the check.
   - Exit 2 is a deny (read `decision` and `reason`) or a refused receipt store (`kit: refused:` on stderr): **not pushed**; report it as printed.
   - Exit 1 is an error: report it and do not push. Any other non-zero exit is a failure of the step: report it and do not push.
6. Push branch (only when step 5 let it go on): `git push -u origin HEAD`
7. Create PR (only when the push exited 0): `gh pr create --fill`

**REQUIRED OUTPUT:**
- Commit hash: _____
- Push: pushed / not pushed — <reason>
- PR URL: _____ (or none when not pushed)

**AUTO-PROCEED:** Continue to Compound.

---

### PHASE 8: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/full-tdd-swarm/_____
- Doc path: docs/solutions/full-tdd-swarm/_____.md
- Pattern stored: yes/no


NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

### PHASE 9: Report & Notify Parent (MANDATORY - NEVER SKIP)
**Write a completion report** to `.claude/agent-reports/{your-agent-id}.md` containing:
- Task summary (what was built)
- Files changed (list with brief descriptions)
- Test results (pass/fail counts)
- Push: pushed / not pushed — <reason> (the reason as printed by the scrub, the receipt or the push gate)
- PR URL (or none when not pushed)
- Any issues encountered or decisions made

Your agent-id was specified in the initial prompt. If unclear, use the branch name.

**If a parent agent was specified in your initial prompt**, use the `redirect_terminal_agent` MCP tool to send:
```
Agent {id} finished: pushed PR {url} | not pushed — {reason}. Report: .claude/agent-reports/{id}.md
```

**REQUIRED OUTPUT:**
- Report path: .claude/agent-reports/_____.md
- Parent notified: yes/no

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] All 9 phases completed (zero user gates)
- [ ] Tests written and pass
- [ ] PR created with `gh pr create --fill`, or "not pushed — <reason>" reported (when the push gate did not let the push go on)
- [ ] Compound phase executed
- [ ] Completion report written to .claude/agent-reports/
- [ ] Parent agent notified (if applicable)
