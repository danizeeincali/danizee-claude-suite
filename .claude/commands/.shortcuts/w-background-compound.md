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
- **Step 1:** Category detection (argument or auto-detect from git diff HEAD~1)
  - Use weighted pattern matching: security(3), bug(2), performance(2), architecture(2), feature(1)
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
- **After a refused scrub (any non-zero exit):** unstage the handoff paths (`git restore --staged -- <those paths>`) so they cannot ride along in the agent's commit, and dispatch the background agent **without `--push`** even when invoked as `/bcp`: the write-up still runs and commits its own paths, the push is withheld, and the summary says "not pushed — handoff scrub refused".
- Commit these files (specific paths, `git commit -- <those paths>`, not `git add -A`) only after the scrub is clean (or the kit is not installed). Never push here.

---

### ⛔ CHECKPOINT 2: Background Dispatch
Launch a background agent via the Task tool — pass `model: sonnet` (see Model Policy) — that runs 4
phases autonomously. It stages and commits **only its own paths** (the solution doc, the ralph
candidates file, memory exports) — never the handoff files the lead just committed:

**Phase 1: Inline Compound**
- Storage: memory key + solution doc
- Analyze: parse git diff for functions, interfaces, patterns, tests
- Diagnostics: generate RC-D### for each significant change
- Fixes: generate paired RC-F### for each diagnostic
- Append all to .claude/ralph-candidates.md
- Ralph candidate check
- **Redact before writing:** whenever the kit is installed, pass the diff text (or any excerpt of it) through `redact` before it is written into the solution doc or any memory export. Never test for the secrets file yourself: the verb looks for `.claude/kit/secrets` at the top of the worktree it runs in, then in the main checkout (the file is git-ignored, so a linked worktree usually has no copy of its own). With no secrets file anywhere nothing is replaced (`replaced: 0`) and the text comes back as is. `redact` reads the text on stdin (there is no `--file` for the text), prints JSON `{ text, replaced }`, and write the `text` field, not the raw diff. Use `--keep-lines` so line numbers still match; `--secrets-file <f>` names another secrets file. The block writes `git diff HEAD~1` to a temp file, checks git's exit, then redacts the file; the same pipeline applies to any excerpt (write it to a temp file, check the step that made it, then `redact --keep-lines < file`), never a bare pipe whose first command can fail unseen. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js): redact skipped, advisory"; (exit 0); else D=$(mktemp 2>/dev/null) && [ -n "$D" ] || { echo "mktemp failed: no temp file for the diff, nothing redacted" >&2; D=; RC=1; }
if [ -n "$D" ]; then git diff HEAD~1 > "$D"; RC=$?
if [ $RC -eq 0 ]; then node .claude/helpers/kit/cli.js redact --keep-lines < "$D"; RC=$?; else echo "git diff failed (exit $RC): the diff was not read, nothing redacted" >&2; fi; fi; [ -z "$D" ] || rm -f "$D"; (exit $RC); fi
```
  Exit 0 prints the redacted `text` and the `replaced` count. If the temp file cannot be made the block prints "mktemp failed"; if git fails it prints "git diff failed (exit N)" and `redact` does not run: report that, never read it as an empty, clean diff. Exit 1 is wrong input or a broken state (an unreadable secrets file, bad flag, mktemp failed): report it and do **not** write the unredacted diff into the solution doc or a memory export. Any other non-zero exit (git's own exit, 127, a signal) is a failure of the step: the same. The temp file is removed on every path.

**Phase 1.5: Agent Pi Brain — Knowledge Discovery (read-only)**
- Search for similar memories:
  `curl -s -H "Authorization: Bearer anonymous" "https://pi.ruv.io/v1/memories/search?q=[title]&top_k=3"`
- If matching memories found (score > 0.7): log applicable patterns in summary
- Log result (found/not-found)

**Phase 2: Git Commit**
- Stage only the paths it wrote (NOT git add -A, never the lead's handoff files). Staging them first also puts the new files under the scrub.
- **Scrub before the commit:** If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js): scrub skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js scrub --worktree; RC=$?; (exit $RC); fi
```
  Exit 0 clean (tracked files only; an untracked file is not scanned). Exit 2 means hits or an incomplete scan: list them as printed, **do not commit**, skip Phase 3, and say so in the summary. Exit 1 is wrong input or a broken state: report it, do not commit, skip Phase 3. Any other non-zero exit is a failure of the step: report it, do not commit, skip Phase 3.
- Commit with descriptive message, limited to its own paths: `git commit -m "<message>" -- <its own paths>`, so nothing else that happens to be staged goes into this commit.
- **Never pushes** in this phase.

**Phase 3: Git Push/Merge (only with --push)**
- Without `--push` this phase does nothing; the summary says "not pushed — owner's go needed (/bcp)".
- With `--push` (or `/bcp`), first run the push gate, before any push. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js): push-gate check skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js push-gate check; RC=$?; (exit $RC); fi
```
  Read the printed `decision` and `reason`. The gate stays advisory: a missing review receipt never blocks `/bcp`.
  - Exit 0 with decision `abstain` (a passing receipt for this exact change, or an incomplete one that found nothing blocking): the push goes on.
  - Exit 0 with decision `ask` and a `reason` starting "no review recorded for this change": no `/w-review` receipt exists (with no receipt the verb returns `ask` at threshold none, `deny` under a stricter `--threshold`). The push goes on, and the summary says "no review recorded for this change, pushed (run /w-review next time)".
  - Exit 0 with any other `ask` (a failed review, a review of an earlier version, another threshold): **not pushed**. Stop Phase 3 and write "not pushed — gate asks: <reason>" into the Phase 4 summary. A background agent cannot hold a conversation with the owner: it never puts the question itself and never answers it; the lead relays it (CHECKPOINT 4).
  - Exit 2 is a deny (read `decision` and `reason`) or a refused receipt store (`kit: refused:` on stderr): **not pushed**. Stop Phase 3 and write "not pushed — gate denied: <reason>" (or the refusal as printed) into the Phase 4 summary.
  - Exit 1 is an error: report it and do not push. Any other non-zero exit is a failure of the step: report it and do not push.

  The gate only abstains, asks or denies; it never allows, and it never skips or answers the owner's own permission prompt.
- Then push current branch. If it is not main: merge to main, then run the same push-gate block again on main before pushing main (the merged tree is a different change from the branch the first check saw), and read it by the same rules; push main only when that check lets the push go on, otherwise write its "not pushed — gate asks/denied: <reason>" line for main into the summary. Then clean up.

**Phase 4: Final Summary Report**
- Log what was compounded, committed, and whether it was pushed; a gate stop appears as its own line, "not pushed — gate asks: <reason>" or "not pushed — gate denied: <reason>", exactly as Phase 3 wrote it

**ERROR HANDLING:** Log errors but NEVER abort. Complete as many phases as possible. A push-gate deny or ask, and a scrub hit, are not errors to work around: the phase stops there (no commit after a scrub hit, no push after a deny or while an ask other than "no review recorded" is unanswered) and the summary says why. Never retry around them, never edit the patterns or the gate, never push by another route.

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

**Relay a gate stop (lead):** when the background agent's Phase 4 summary arrives with a "not pushed — gate asks: <reason>" or "not pushed — gate denied: <reason>" line, relay that line to the owner word for word and wait. Only after the owner answers does the lead run the push in the foreground (the Phase 3 lines, push-gate block first), where the owner's own permission prompt applies; the lead never answers the gate's question or that prompt itself, and without an answer nothing is pushed.

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
