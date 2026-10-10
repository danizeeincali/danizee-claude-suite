# /w-background-compound

Fire-and-Forget Compound. A background agent writes up the lessons; then the lead writes the handoff, measures the context and hands you a ready-to-run prune line. Commits, **never pushes** — `/bcp` (or `--push`) is the owner's go to push and merge.

## Usage
```
/w-background-compound [category] [--push]
/w-background-compound feature
/bc            → commit only
/bcp           → commit + push + merge
```

---

## Model Policy (token/cost)

This flow is mechanical checklist work with hard verification (git status/log) — it does not need
the premium session model. **Dispatch the background agent with `model: sonnet`** (Agent tool
`model` param). Spawn any extra utility probes (file inventories, greps) with `model: haiku`. Only
the thin pre-flight and the handoff in the main loop run on the session model. Never dispatch /bc on
the session model by silent inheritance.

---

## Why the handoff matters

Only the person can run `/compact` or `/clear` — a skill, a command or the model cannot. Automatic
compaction runs at about 97% of the context window and keeps ~30k tokens; twice in one week a
multi-phase skill had to be reloaded because compaction had cut its instructions. So `/bc` writes
everything a fresh context needs into files first, then tells you exactly which line to run. Two
suite hooks make automatic compaction behave the same way: `PreCompact` stamps the status file
and records the compaction, `SessionStart(compact)` prints the resume line.

---

## One copy, configured per project

`/bc` ships once, at user level (`danizee-claude-suite install-user`), so a stale user-level
command can never shadow it. A project never copies the command; it adds `.claude/bc.json`:

```json
{ "status": ".claude/plans/STATUS.md", "kickoff": "docs/build/KICKOFF.md", "rules": ".claude/plans/RULES.md",
  "memory": "docs/solutions", "db": ".claude/bc/compactions.jsonl" }
```

Optional keys: `prune_below_pct` (50), `clear_above_pct` (80), `context_window` (1000000).
Without the file the defaults above apply (no kickoff).

Below, **`bc`** means `node .claude/helpers/bc/cli.js` when that file exists in the project, otherwise
`node ~/.claude/helpers/bc/cli.js` (the user-level copy). While a marathon run is active the helper hands
every verb to the run, so the same lines work in both cases.

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Pre-flight
- **Step 0: Record the session base** (lead, before the handoff commit). `BASE` is where this session's work starts, so the diff covers every commit of the session plus uncommitted edits, not just the last commit: `git rev-parse HEAD` alone is wrong once the session committed its work in several commits, and `HEAD~1` would cover the lead's own handoff commit instead. With the kit, `diff-range --base-only` resolves it: it prints the merge-base of HEAD with `@{upstream}`, or, when there is no upstream, the empty-tree id (the whole history); it exits non-zero on failure (for example an upstream with no merge base in a shallow clone). With no upstream (the empty-tree id) or on a failure the lead uses the pre-handoff HEAD instead and says so; without the kit, `BASE` is the pre-handoff HEAD. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js): BASE is the pre-handoff HEAD, advisory"; BASE=$(git rev-parse HEAD 2>/dev/null); echo "BASE=$BASE"; (exit 0); else BASE=$(node .claude/helpers/kit/cli.js diff-range --base-only); RC=$?
if [ $RC -ne 0 ] || [ -z "$BASE" ]; then echo "diff-range --base-only failed (exit $RC): BASE is the pre-handoff HEAD" >&2; BASE=$(git rev-parse HEAD); elif [ "$BASE" = "$(git hash-object -t tree /dev/null)" ]; then echo "no upstream (diff-range printed the empty-tree id): BASE is the pre-handoff HEAD"; BASE=$(git rev-parse HEAD); fi; echo "BASE=$BASE"; (exit 0); fi
```
  The lead keeps that sha and writes it into the dispatch prompt as the agent's `BASE` (CHECKPOINT 2).
- **Step 1:** Category detection (argument or auto-detect from the range since `$BASE`, the same base as Step 0). Before reading the range, check that `BASE` is a commit and use the resolved sha: `case "$BASE" in -*) echo "BASE is not a commit" >&2; RC=1; BASE=;; *) BASE=$(git rev-parse --verify -q "$BASE^{commit}") || { echo "BASE is not a commit" >&2; RC=1; BASE=; };; esac` (a value starting with `-` would be read as an option, e.g. `--output=<path>`, so it is refused before git sees it). Then write the range with the hardened verb into a temp file `$D`: `node .claude/helpers/kit/cli.js diff-range --base "$BASE" --no-untracked > "$D"; RC=$?`. The block below defines `$D` with the same mktemp guard, trap and subshell as the Phase 1 redact block, runs both checks, scores the range, deletes `$D` as soon as the category is detected (or on any path out), and prints `CATEGORY=<category>`; the lead sets `BASE=<sha>` (and `ARG` when a category was given) in the shell that runs it. diff-range never fetches and never prompts: lazy fetch is off and every transport is refused, so a blob missing from a partial clone is exit 1 naming the object, never a download or a credential prompt. Exit 0 printed the range: detect from it. Exit 3 is an empty range: no change to compound, the category is 'feature'. Exit 2 is a refusal (a refused repository or driver, or a range over 32 MiB; a range whose git output passes 64 MiB is exit 1 instead): report the reason as printed and stop that step (the argument, else 'feature'). Exit 1 is bad input, a git failure or an unread change: report it, never read it as an empty diff (the argument, else 'feature'). Any other non-zero exit is a failure of the step: the same. Without the kit, fall back to `GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0 git diff --end-of-options "$BASE"` and say in one line that the kit's protections (no hooks, no drivers, no transports) are missing; score that diff the same way as the block does, with the same keyword weights on the fallback's added lines (lines starting with a single `+`, never the `+++ ` file headers).
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed: use the git diff fallback in Step 1's text (.claude/helpers/kit/cli.js is missing), advisory"; (exit 0); else ( D=$(mktemp 2>/dev/null) && [ -n "$D" ] || { echo "mktemp failed: no temp file for the range, the category falls back" >&2; D=; }
[ -z "$D" ] || trap 'rm -f "$D"' EXIT INT TERM
CAT=$ARG
if [ -n "$CAT" ]; then :
elif [ -z "$D" ]; then :
elif [ -z "$BASE" ]; then echo "BASE not set: the range was not read, the category falls back" >&2
else case "$BASE" in -*) echo "BASE is not a commit" >&2; BASE=;; *) BASE=$(git rev-parse --verify -q "$BASE^{commit}") || { echo "BASE is not a commit" >&2; BASE=; };; esac
if [ -n "$BASE" ]; then node .claude/helpers/kit/cli.js diff-range --base "$BASE" --no-untracked > "$D"; RC=$?
if [ $RC -eq 0 ]; then set -- $(awk '/^[+][+][+] /{next} /^[+]/{l=tolower($0); if(l ~ /^[+].*(secret|token|password|auth|csrf|xss|inject)/)s++; if(l ~ /^[+].*(fix|bug|error|crash|regress)/)b++; if(l ~ /^[+].*(perf|cache|latency|optimi|throughput)/)p++; if(l ~ /^[+].*(refactor|architect|interface|module|abstract)/)a++; if(l ~ /^[+].*(add|new|feature|support)/)f++} END{print s+0, b+0, p+0, a+0, f+0}' "$D") 0 0 0 0 0; SEC=$1; BUG=$2; PERF=$3; ARCH=$4; FEAT=$5
BEST=$FEAT; CAT=feature
[ $((ARCH * 2)) -gt $BEST ] && { BEST=$((ARCH * 2)); CAT=architecture; }
[ $((PERF * 2)) -gt $BEST ] && { BEST=$((PERF * 2)); CAT=performance; }
[ $((BUG * 2)) -gt $BEST ] && { BEST=$((BUG * 2)); CAT=bug; }
[ $((SEC * 3)) -gt $BEST ] && { BEST=$((SEC * 3)); CAT=security; }
elif [ $RC -eq 3 ]; then echo "no change to compound (diff-range: empty range): the category is feature"
elif [ $RC -eq 2 ]; then echo "diff-range refused (exit 2, reason as printed): the range was not read, the category falls back" >&2
else echo "diff-range failed (exit $RC): the range was not read, the category falls back" >&2; fi; fi; fi
[ -z "$D" ] || rm -f "$D"; [ -n "$CAT" ] || CAT=feature; echo "CATEGORY=$CAT" ); (exit 0); fi
```
  - Use weighted pattern matching on the added lines only (the `+++ ` file headers are skipped), counted for all five categories in one pass over `$D` (one POSIX `awk`, lowercase patterns on `tolower($0)`, no gawk-only `IGNORECASE`): security(3), bug(2), performance(2), architecture(2), feature(1)
  - Highest score wins. Default to 'feature' on empty diff.
- **Step 2:** Branch detection (current branch name)
- **Step 3:** Push flag: `--push` present (or invoked as `/bcp`) → push phase enabled. Otherwise the push phase is skipped.
- **Step 4:** `bc config` → the project's status, kickoff and rules files, the thresholds, and `marathonRun` (the active run id, or null). Never test for files yourself: ACTIVE is machine-local and absent in a worktree. A run → the handoff goes to that run; no marathon run → the status file named in `bc.json`.

**AUTO-PROCEED:** Continue to the Handoff.

---

### ⛔ CHECKPOINT 1: Handoff (lead, foreground — do not delegate)

Write what a fresh context needs, in files, and commit it **before** anything runs in the background,
so two writers never commit in the same checkout at the same time:
- **Status rows (`status.md`):** every stream — where it lives, its plan, its state, its next step, any running background task ids. With a marathon run active: `node .claude/helpers/marathon/cli.js stream <name> state=... phase=... skill=... next="..." tasks=<id>,<id>` per stream, then `cli.js status`. Without a marathon run: refresh the status file from `bc config` (default `.claude/plans/STATUS.md`) as a table — `| Stream | Where | Plan | State | Next | Phase | Skill | Tasks |` — one row per stream, `active` in State for the one being worked, `done` once finished. If a multi-phase skill such as `/pt` is mid-run, its row names the skill and the phase. The handoff does not need marathon.
- **Standing rules:** anything learned the hard way this session → `rules.md` of the run (or the rules file from `bc config` without a run).
- **Durable facts** → memory.
- **Scrub before the commit:** `git add` these specific paths first (and any new file they create): `scrub --worktree` scans tracked files only, so an untracked file is not scanned. Then scan the tracked files as they are on disk for secrets. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js): scrub skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js scrub --worktree; RC=$?; (exit $RC); fi
```
  Exit 0 is clean for the tracked files (or no pattern file is configured: then nothing was scanned, say so); a file still untracked was not scanned. Exit 2 means hits or an incomplete scan: list them as printed, **do not commit**, and say so in the summary. Exit 1 is wrong input or a broken state: report it, never read it as clean, do not commit. Any other non-zero exit is a failure of the step: report it, do not commit.
- **After a refused scrub (any non-zero exit):** unstage the handoff paths so they cannot ride along in a commit: `git reset -q -- <those paths>; RC=$?` (`git reset` works on every git; `git restore --staged` needs git 2.23 or later). Check that exit: a non-zero exit means nothing was unstaged, so report "unstage failed (exit $RC): still staged: <those paths>", naming each path, and say the owner must unstage them before any commit. Unstaging only takes a new file out of the scan: `scrub --worktree` scans every tracked file as it is on disk, so while a tracked file still holds the hit the agent's Phase 2 scrub refuses too, and the write-up cannot be committed. So dispatch the background agent **without `--push`** even when invoked as `/bcp`, and write "handoff scrub refused: <hits>" (the hits as printed) into its dispatch prompt. The agent still writes the solution doc and the candidates, skips Phase 2 and Phase 3, and its summary says "not committed, not pushed — handoff scrub refused: <hits>". The lead does not write that line itself.
- Commit these files (specific paths, `git commit -- <those paths>`, not `git add -A`) only after the scrub is clean (or the kit is not installed). Never push here.

---

### ⛔ CHECKPOINT 2: Background Dispatch
Launch a background agent via the Task tool — pass `model: sonnet` (see Model Policy) — that runs 4
phases autonomously. It stages and commits **only its own paths** (the solution doc, the ralph
candidates file, memory exports) — never the handoff files the lead just committed.
The dispatch prompt carries `BASE=<sha>`, the session base the lead recorded at CHECKPOINT 0 (the agent sets `BASE` in its shell before the redact block), and, after a refused handoff scrub, the line "handoff scrub refused: <hits>":

**Phase 1: Inline Compound**
- **Redact first (the first step of Phase 1, before anything is analysed or written):** whenever the kit is installed, pass the diff text (or any excerpt of it) through `redact` before it is written into the solution doc, the RC-D/RC-F entries in `.claude/ralph-candidates.md`, any memory export or the commit message. Never test for the secrets file yourself: the verb looks for `.claude/kit/secrets` at the top of the worktree it runs in, then in the main checkout (the file is git-ignored, so a linked worktree usually has no copy of its own). With no secrets file anywhere nothing is replaced (`replaced: 0`) and the text comes back as is. `redact` reads the text on stdin (there is no `--file` for the text), prints JSON `{ text, replaced }`, and write the `text` field, not the raw diff. Use `--keep-lines` so line numbers still match; `--secrets-file <f>` names another secrets file. The block first checks that `BASE` is a commit (`case "$BASE" in -*) echo "BASE is not a commit" >&2; RC=1; BASE=;; *) BASE=$(git rev-parse --verify -q "$BASE^{commit}") || { echo "BASE is not a commit" >&2; RC=1; BASE=; };; esac`: a value starting with `-` such as `--output=<path>` is refused before git sees it, and the resolved sha is what the range uses), then writes the range with the hardened verb, `node .claude/helpers/kit/cli.js diff-range --base "$BASE" --no-untracked > "$D"; RC=$?` (the session base from the dispatch prompt to the working tree: every commit of the session, the lead's handoff commit and uncommitted edits; never `HEAD~1`), to a temp file, checks its exit, then redacts the file. diff-range never fetches and never prompts: lazy fetch is off and every transport is refused, so in a partial clone a missing blob is exit 1 naming the object, never a network call or a credential prompt, and hooks, filters and diff drivers from the repository's config do not run; the same pipeline applies to any excerpt (write it to a temp file, check the step that made it, then `redact --keep-lines < file`), never a bare pipe whose first command can fail unseen. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js): redact skipped, advisory"; (exit 0); else ( D=; J=; R=; D=$(mktemp 2>/dev/null) && J=$(mktemp 2>/dev/null) && R=$(mktemp 2>/dev/null) && [ -n "$D" ] && [ -n "$J" ] && [ -n "$R" ] || { echo "mktemp failed: no temp file for the diff, nothing redacted" >&2; rm -f "$D" "$J" "$R"; D=; J=; R=; RC=1; }
KEEP=; [ -z "$D" ] || trap 'rm -f "$D" "$J"; [ -n "$KEEP" ] || rm -f "$R"' EXIT INT TERM
if [ -n "$D" ] && [ -z "$BASE" ]; then echo "BASE not set (the lead writes it into the dispatch prompt): the diff was not read, nothing redacted" >&2; RC=1
elif [ -n "$D" ]; then case "$BASE" in -*) echo "BASE is not a commit" >&2; RC=1; BASE=;; *) BASE=$(git rev-parse --verify -q "$BASE^{commit}") || { echo "BASE is not a commit" >&2; RC=1; BASE=; };; esac
if [ -n "$BASE" ]; then node .claude/helpers/kit/cli.js diff-range --base "$BASE" --no-untracked > "$D"; RC=$?
if [ $RC -eq 0 ]; then node .claude/helpers/kit/cli.js redact --keep-lines < "$D" > "$J"; RC=$?
if [ $RC -eq 0 ]; then node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));require("fs").writeFileSync(process.argv[2],j.text);console.log("replaced="+j.replaced+" bytes="+Buffer.byteLength(j.text)+" file="+process.argv[2])' "$J" "$R"; RC=$?; [ $RC -eq 0 ] && KEEP=1; fi
elif [ $RC -eq 3 ]; then echo "no change to compound (diff-range: empty range): redact skipped"; RC=0
elif [ $RC -eq 2 ]; then echo "diff-range refused (exit 2, reason as printed): the diff was not read, nothing redacted" >&2
else echo "diff-range failed (exit $RC): the diff was not read, nothing redacted" >&2; fi; fi; fi; [ -z "$D" ] || rm -f "$D" "$J"; [ -n "$KEEP" ] || rm -f "$R"; exit $RC ); RC=$?; (exit $RC); fi
```
  Exit 0 prints exactly one summary line, `replaced=<n> bytes=<n> file=<path>`: the redacted `text` is in that file (the whole range is never printed, a Bash result is cut off at about 30K characters). If the temp file cannot be made the block prints "mktemp failed"; if `BASE` is empty it prints "BASE not set" and nothing is read; if `BASE` is not a commit (or starts with `-`) it prints "BASE is not a commit", exits 1 and nothing is read. diff-range exit 3 is an empty range: the block prints "no change to compound", skips the redact step and exits 0; the solution doc is still written, with no diff text in it. diff-range exit 2: Exit 2 is a refusal (a refused repository or driver, or a range over 32 MiB; a range whose git output passes 64 MiB is exit 1 instead): report the reason as printed. The block prints "diff-range refused (exit 2" after the reason diff-range printed, exits 2 and `redact` does not run; stop that step. diff-range exit 1 (bad input, git failed, or a change it could not read) prints "diff-range failed (exit 1)", and any other non-zero exit "diff-range failed (exit N)": `redact` does not run; report that, never read it as an empty, clean diff. Exit 1 is wrong input or a broken state (an unreadable secrets file, bad flag, mktemp failed, BASE not a commit): report it and do **not** write the unredacted diff into the solution doc, `.claude/ralph-candidates.md`, a memory export or the commit message. Any other non-zero exit (git's own exit, 127, a signal) is a failure of the step: the same. The block runs in a subshell that sets `trap 'rm -f "$D" "$J"; [ -n "$KEEP" ] || rm -f "$R"' EXIT INT TERM` as soon as the temp file exists, so the trap never touches the caller's shell or its own traps: the temp files for the unredacted diff (`$D`) and redact's JSON (`$J`) are removed when the block ends on any path, and when the block is interrupted or terminated (INT, TERM). The redacted file `$R` is the one output and survives a successful block (on any failure path, and on exit 3, it is removed and no file is named). Only a SIGKILL, which no trap can catch, can leave it behind in `$TMPDIR`: the unredacted `$D`, the JSON `$J` or `$R`.
- Storage: memory key + solution doc
- Analyze: read the redacted file named by the `file=` field of the redact block's summary line (the range since `$BASE`), per file or in chunks (`grep -n '^diff --git' <path from file=>` then `sed -n 'a,bp' <path from file=>`), for functions, interfaces, patterns, tests; nothing in Phase 1 reads the working tree's own diff, only that file. Pass only its contents on to the solution doc, `.claude/ralph-candidates.md`, memory exports and the commit message. `R` is not a shell variable in later tool calls (the block's subshell ended), so always use the path printed in `file=`. At the end of Phase 1 run `rm -f <path from file=>`: a killed shell leaves it in `$TMPDIR` (mode 0600), and the Phase 4 summary, written by the agent, says "redacted range left at <path>" when that file still exists, and nothing otherwise.
- Diagnostics: generate RC-D### for each significant change
- Fixes: generate paired RC-F### for each diagnostic
- Append all to .claude/ralph-candidates.md (redacted entries only, written after the redact block has run)
- **Redact everywhere diff text lands:** the redact rule covers every write and commit that carries diff text: the solution doc, the RC-D/RC-F entries in `.claude/ralph-candidates.md`, memory exports, and the commit message; each takes only the redacted `text`, never the raw diff or an excerpt of it.
- Ralph candidate check

**Phase 1.5: Agent Pi Brain — Knowledge Discovery (read-only)**
- Search for similar memories:
  `curl -s -H "Authorization: Bearer anonymous" "https://pi.ruv.io/v1/memories/search?q=[title]&top_k=3"`
- If matching memories found (score > 0.7): log applicable patterns in summary
- Log result (found/not-found)

**Phase 2: Git Commit**
- **Handoff scrub refused:** when the dispatch prompt carries "handoff scrub refused: <hits>", skip Phase 2 and Phase 3 (no scrub, no commit, no push; the scrub would refuse on the same tracked file) and write "not committed, not pushed — handoff scrub refused: <hits>" into the Phase 4 summary.
- Stage only the paths it wrote (NOT git add -A, never the lead's handoff files). Staging them first also puts the new files under the scrub.
- **Scrub before the commit:** If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js): scrub skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js scrub --worktree; RC=$?; (exit $RC); fi
```
  Exit 0 clean (tracked files only; an untracked file is not scanned). Exit 2 means hits or an incomplete scan: list them as printed, **do not commit**, skip Phase 3, and say so in the summary. Exit 1 is wrong input or a broken state: report it, do not commit, skip Phase 3. Any other non-zero exit is a failure of the step: report it, do not commit, skip Phase 3.
- Commit with descriptive message, limited to its own paths: `git commit -m "<message>" -- <its own paths>`, so nothing else that happens to be staged goes into this commit. The redact rule covers every write and commit that carries diff text: the solution doc, the RC-D/RC-F entries in `.claude/ralph-candidates.md`, memory exports, and the commit message; each takes only the redacted `text`. A commit message that quotes the diff quotes the redacted `text`, never the raw diff.
- **Never pushes** in this phase.

**Phase 3: Git Push/Merge (only with --push)**
- Without `--push` this phase does nothing; the summary says "not pushed — owner's go needed (/bcp)" (after a refused handoff scrub the line is "not committed, not pushed — handoff scrub refused: <hits>" instead, as Phase 2 says).
- With `--push` (or `/bcp`), first run the push gate, before any push. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js): push-gate check skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js push-gate check; RC=$?; (exit $RC); fi
```
  Read the printed `decision` and `reason`. The gate stays advisory: a missing review receipt never blocks `/bcp`.
  - Exit 0 with decision `abstain` (a passing receipt for this exact change, or an incomplete one that found nothing blocking): the push goes on.
  - Exit 0 with decision `ask` and a `reason` starting "no review recorded for this change": no `/w-review` receipt exists (with no receipt the verb returns `ask` at threshold none, `deny` under a stricter `--threshold`). The push goes on, and the summary says "no review recorded for this change, pushed (run /w-review next time)".
  - Exit 0 with any other `ask` (a failed review, a review of an earlier version, another threshold): **not pushed**. Stop Phase 3 and write "not pushed (branch) — gate asks: <reason>" into the Phase 4 summary (the ref in parentheses is the one this check was for: `branch` here, `main` at the main re-check). A background agent cannot hold a conversation with the owner: it never puts the question itself and never answers it; the lead relays it (CHECKPOINT 4).
  - Exit 2 is a deny (read `decision` and `reason`) or a refused receipt store (`kit: refused:` on stderr): **not pushed**. Stop Phase 3 and write "not pushed (branch) — gate denied: <reason>" (`main` at the main re-check; or the refusal as printed) into the Phase 4 summary.
  - Exit 1 is an error: report it and do not push. Any other non-zero exit is a failure of the step: report it and do not push.

  The gate only abstains, asks or denies; it never allows, and it never skips or answers the owner's own permission prompt.
- **Record the branch base before any push.** Right after the branch check lets the push go on, and before `git push`, record and print it in one step, `MB=$(git merge-base @{upstream} HEAD 2>/dev/null); echo "MB=$MB"`, on the branch: the base the branch check used. Shell state does not carry between tool calls, so the agent keeps the printed sha and sets `MB=<sha>` in the shell that runs the main check (an empty `MB` stays empty). The gate keys a receipt on a change id, sha256 of (base, tree), where the base is `--base`, else the merge-base of HEAD with `@{upstream}`, else none. Recording `MB` after the push would be wrong: a successful push moves the remote-tracking ref, so the merge-base becomes HEAD and the main re-check would hash a different id.
- Then push current branch: `git push -u origin HEAD; RC=$?`. A non-zero `RC` (offline, rejected, no such remote) is a failed push: stop Phase 3 there (no merge into main, no main push, no clean-up) and write "not pushed — push failed (exit N): <first line of git's stderr>" (N is `$RC`) into the Phase 4 summary. Never retry it by another route, never force-push, and never let the shell answer or bypass the owner's own permission prompt for the push.
- If the branch is not main and its push exited 0: merge to main, then run the same push-gate block again on main before pushing main, with `--base "$MB"` added, and the main-check line leaves `--base` out itself when `MB` is empty: `if [ -n "$MB" ]; then node .claude/helpers/kit/cli.js push-gate check --base "$MB"; else node .claude/helpers/kit/cli.js push-gate check; fi`, so a fast-forward merge of the reviewed tree matches its receipt. If the branch had no upstream when `MB` was recorded, `MB` is empty: the branch check had no base, and the main check runs without `--base` and resolves main's own upstream instead, so unless main has no upstream either and the merge is a fast-forward, its change id differs from the branch's and, whenever a receipt exists, it returns the same earlier-review ask ("only an earlier review exists…"), which goes to the relay (CHECKPOINT 4). A non-fast-forward merge yields a new tree, for which the gate returns ask "only an earlier review exists, for a different version of this change; run /w-review on the current one"; that goes to the relay (CHECKPOINT 4) like any other ask. Read it by the same rules; push main only when that check lets the push go on, otherwise write its "not pushed (main) — gate asks: <reason>; MB=<sha>" (or "not pushed (main) — gate denied: <reason>") line into the summary.
- Push main: `git push origin main; RC=$?`. A non-zero `RC` is a failed push, the same as the branch's: no clean-up, and the summary says "not pushed — push failed (exit N): <first line of git's stderr>" for main. Clean up only when no push failed.

**Phase 4: Final Summary Report**
- When the redacted file named by Phase 1's `file=` field still exists, add the line "redacted range left at <path>"; when it was removed, add nothing.
- Log what was compounded, committed, and whether it was pushed; a gate stop appears as its own line naming the ref, "not pushed (branch) — gate asks: <reason>", "not pushed (main) — gate asks: <reason>" (or "gate denied: <reason>" for either), and a failed push as "not pushed — push failed (exit N): <first line of git's stderr>", exactly as Phase 3 wrote it

**ERROR HANDLING:** Log errors but NEVER abort. Complete as many phases as possible. A push-gate deny or ask, and a scrub hit, are not errors to work around: the phase stops there (no commit after a scrub hit, no push after a deny or while an ask other than "no review recorded" is unanswered) and the summary says why. Never retry around them, never edit the patterns or the gate, never push by another route. A failed push (a non-zero exit from `git push`, written "not pushed — push failed (exit N): <first line of git's stderr>") is a stop beside them, not an error to work around: no merge, no main push and no clean-up after it, never a retry by another route or a force-push.

---

### ⛔ CHECKPOINT 3: Measure the context and decide

`bc context` (the helper's `cli.js context`) reads the latest transcript's last assistant usage
(input + cache read + cache creation) and returns `{tokens, pct, decision}`. Pass `--transcript <path>`
to pin a transcript and `--stream-finished` when the stream just closed. Thresholds live in
`.claude/bc.json` (or `.claude/marathon.json` → `bc`): `prune_below_pct` 50, `clear_above_pct` 80, `context_window`.

| decision | What you print |
|----------|----------------|
| `none` (under 50%) | One line: "Context at N% — no prune." |
| `compact` (50–80%) | The output of `bc keeplist` (`cli.js keeplist`): a ready-to-run `/compact …` line whose keep-list names the kickoff, the open stream rows, open findings by id (in a marathon run), the rules file, the last commit and running tasks — never finished streams, never file contents. Generated from the status file, never typed from memory. |
| `clear` (≥ 80%, or the stream just finished) | Recommend `/clear`, and print `bc resume --plain` (`cli.js resume --plain`) as the first line to paste into the fresh session: read the kickoff, status, rules and memory index, then continue the active stream, reloading its skill at its phase. A compaction that late buys little room. |

Say plainly that only the person can run the line; you cannot compact for them.

---

### ⛔ CHECKPOINT 4: Record

`bc record compaction trigger=bc tokens=<n> pct=<n> decision=<d>` (`cli.js record compaction …`) — into the run's
store with a marathon run active, otherwise into the `db` file from `bc.json` (default `.claude/bc/compactions.jsonl`).
Every compaction, manual or automatic, is also recorded by the `PreCompact` hook, with its trigger and size.

**Relay a gate stop (lead):** when the background agent's Phase 4 summary arrives with a "not pushed (branch|main) — gate asks: <reason>" or "not pushed (branch|main) — gate denied: <reason>" line, relay that line to the owner word for word and wait. On an ask, only after the owner explicitly says go does the lead push in the foreground (the push and merge lines of Phase 3) without rerunning the gate's stop rule, which would stop on the same ask again. The ref in the line tells which push lines remain: a branch stop → push the branch, merge to main, run the main check, push main; a main stop → push main only (the branch is already pushed and merged). `MB` is handed to the lead like this: on a branch stop the agent never pushed, so the lead records `MB` itself with Phase 3's record line (`MB=$(git merge-base @{upstream} HEAD 2>/dev/null); echo "MB=$MB"`) before pushing the branch; on a main stop the agent's summary line carries it, "not pushed (main) — gate asks: <reason>; MB=<sha>", and the lead sets `MB=<sha>` before the main re-check. After the go the lead still runs the main re-check (`push-gate check --base "$MB"` as Phase 3 words it) and stops on a deny there, ignoring only an ask; the owner's own permission prompt still applies, the lead never answers the gate's question or that prompt itself, and without an explicit go nothing is pushed. A deny is never pushed past, not even on the owner's word: the owner fixes the cause and runs /bcp again.

---

## Difference from /w-compound

| Aspect | /w-compound | /w-background-compound | /bcp |
|--------|-------------|------------------------|------|
| User gates | 0 (auto-detect) | 0 | 0 |
| Auto-push / merge | No | **No** (commit only) | Yes (`--push`) |
| Handoff + prune line | No | Yes | Yes |
| Runs in | Foreground | Background agent + lead handoff | same |
| Error handling | May block | Logs, never aborts | same |

## Example
```
/w-background-compound
/w-background-compound feature
/w-background-compound security --push
```
