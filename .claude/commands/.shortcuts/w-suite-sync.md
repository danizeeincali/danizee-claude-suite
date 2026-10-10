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

**🔒 Git reads of the upstream clone (safe-git):** `/tmp/suite-upstream` is a repository you did not write. Every git read of it goes through `node .claude/helpers/kit/cli.js safe-git --dir <clone top> -- <git args>`, never plain `git -C <path> ...` and never `cd` into it to run git (its config and hooks were not written by you). `<clone top>` is `/tmp/suite-upstream` itself (the directory the `git clone` above created, not `/tmp/suite-upstream/src`); `--dir` must be the clone top itself, not a subfolder of it, and paths in the git args are relative to it. Only read-only verbs are accepted (rev-parse, rev-list, log, show, diff, ls-files, ls-tree, cat-file). Read the process exit code, not a field of the output: 0 git ok (it prints `{ stdout, stderr, code, exit }` and `stdout` is the answer), 1 bad input (stdout is empty, the reason is a `kit:` line on stderr: fix the call, retry once), 2 refused (stdout is empty, the reason is a `kit: refused:` line on stderr: do not retry, report it as printed and treat that read as not done), 3 git failed or timed out (when git ran and failed it prints `{ stdout, stderr, code, exit }` with a non-zero `code`: fix a wrong call and retry once; when git timed out, printed over 256 MiB or was killed by a signal it prints nothing on stdout, only a `kit:` line on stderr, and `--timeout <ms>` raises the 60000 ms default). Only exit 0 and a git-ran exit 3 print that JSON; a timeout, overflow or kill prints only a `kit:` stderr line. Any other non-zero exit (for example 127, or a signal) is a failure of that step: report it, never read it as nothing found. If `.claude/helpers/kit/cli.js` is missing, say "kit not installed (.claude/helpers/kit/cli.js missing): safe-git skipped, advisory" in one line and continue without running git on that checkout (read its files directly); the kit is advisory and never blocks a workflow that worked before.
The clone is depth 1 (a single commit), so only HEAD and its tree are readable: asking for history beyond HEAD (`HEAD~1`, `log` ranges, `rev-list` ranges, `diff` against an older commit) is a wrong call. The upstream version is `node .claude/helpers/kit/cli.js safe-git --dir /tmp/suite-upstream -- rev-parse HEAD`; a file list is `... safe-git --dir /tmp/suite-upstream -- ls-tree -r --name-only HEAD`.

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
- Lens findings: _____ (or the one-line kit skip)

**🔎 Code Analysis (lenses over the change under review):** Run this over the files created in CHECKPOINT 3 (untracked files are part of the range) and printed by `diff-range` (everything since the merge base with the upstream branch, plus uncommitted edits and untracked files; the whole history when there is no upstream; no removal check runs in this workflow (lenses only)). If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before. Each block starts with a guard for that: with no kit it prints "kit not installed" and ends with status 0, without closing your shell.

1. Lenses: which review rules apply to the changed files.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else D=$(mktemp 2>/dev/null) && [ -n "$D" ] || { echo "mktemp failed: no temp file for the range" >&2; D=; RC=1; }
if [ -n "$D" ]; then node .claude/helpers/kit/cli.js diff-range > "$D"; RC=$?
case $RC in 0) node .claude/helpers/kit/cli.js lenses --diff "$D"; RC=$?;; 3) echo "no change to review"; RC=0;; *) echo "diff-range failed (exit $RC): the change range was not read" >&2;; esac; fi; [ -z "$D" ] || rm -f "$D"; (exit $RC); fi
```

How to read the results: each entry in `fired` (lenses) has a `name`, the `files` it matched and a `body` to apply as an extra check on those files: add its findings to the review findings above, and mention a non-empty `capped` list.
Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure and never "no lens applies"; the block sets its own status to 0 in that case. Exit 1 is wrong input or a broken state: report it, never skip the step. Exit 2 is a refusal (the repository, a range over 32 MiB, or the verb itself): report it as printed and stop that step, never retry it. Exit 0 from `diff-range` can still leave files out: it writes a note to stderr for an untracked file over the size cap (`too_large`, named) and for untracked files over the count cap (`max_untracked`, a count only); name each skipped file in the findings, say it was not analysed, and treat every result as a floor. If `diff-range` itself fails the step prints "diff-range failed" and the verb does not run; if the temp file cannot be made it prints "mktemp failed": report that the change was not analysed, never "nothing found". Any other non-zero exit (for example 127, or a signal) is a failure of that step: report it, never read it as nothing found.

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
- [ ] Git reads of the upstream clone went through safe-git, and lenses ran at Verify (or one line said the kit is not installed)
- [ ] Compound phase executed

⚠️ Workflow INCOMPLETE until all boxes checked

## Example
```
/w-suite-sync
# Fetches latest upstream, shows what's new, you pick what to sync
```
