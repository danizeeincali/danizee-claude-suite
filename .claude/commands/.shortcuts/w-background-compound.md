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
suite hooks make automatic compaction behave the same way: `PreCompact` stamps the status file,
`SessionStart(compact)` prints the resume line.

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Pre-flight
- **Step 1:** Category detection (argument or auto-detect from git diff HEAD~1)
  - Use weighted pattern matching: security(3), bug(2), performance(2), architecture(2), feature(1)
  - Highest score wins. Default to 'feature' on empty diff.
- **Step 2:** Branch detection (current branch name)
- **Step 3:** Push flag: `--push` present (or invoked as `/bcp`) → push phase enabled. Otherwise the push phase is skipped.
- **Step 4:** Marathon run active? Ask the CLI, never a file test (ACTIVE is machine-local and absent in a worktree): `node .claude/helpers/marathon/cli.js status` succeeds → handoff goes to that run; it fails with "no active run" → `.claude/plans/STATUS.md`.

**AUTO-PROCEED:** Continue to the Handoff.

---

### ⛔ CHECKPOINT 1: Handoff (lead, foreground — do not delegate)

Write what a fresh context needs, in files, and commit it **before** anything runs in the background,
so two writers never commit in the same checkout at the same time:
- **Status rows (`status.md`):** every stream — where it lives, its plan, its state, its next step, any running background task ids. With a marathon run active: `node .claude/helpers/marathon/cli.js stream <name> state=... phase=... skill=... next="..." tasks=<id>,<id>` per stream, then `cli.js status`. Without a marathon run: refresh `.claude/plans/STATUS.md` with the same columns — the handoff does not need marathon.
- **Standing rules:** anything learned the hard way this session → `rules.md` of the run (or `.claude/plans/RULES.md` without a run).
- **Durable facts** → memory.
- Commit these files (specific paths, not `git add -A`). Never push here.

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

**Phase 1.5: Agent Pi Brain — Knowledge Discovery (read-only)**
- Search for similar memories:
  `curl -s -H "Authorization: Bearer anonymous" "https://pi.ruv.io/v1/memories/search?q=[title]&top_k=3"`
- If matching memories found (score > 0.7): log applicable patterns in summary
- Log result (found/not-found)

**Phase 2: Git Commit**
- Stage only the paths it wrote (NOT git add -A, never the lead's handoff files)
- Commit with descriptive message
- **Never pushes** in this phase.

**Phase 3: Git Push/Merge (only with --push)**
- Without `--push` this phase does nothing; the summary says "not pushed — owner's go needed (/bcp)".
- With `--push`: push current branch; if not main, merge to main and clean up.

**Phase 4: Final Summary Report**
- Log what was compounded, committed, and whether it was pushed

**ERROR HANDLING:** Log errors but NEVER abort. Complete as many phases as possible.

---

### ⛔ CHECKPOINT 3: Measure the context and decide

`node .claude/helpers/marathon/cli.js context` reads the latest transcript's last assistant usage
(input + cache read + cache creation) and returns `{tokens, pct, decision}`. Pass `--transcript <path>`
to pin a transcript and `--stream-finished` when the stream just closed. Thresholds live in
`.claude/marathon.json` → `bc` (`prune_below_pct` 50, `clear_above_pct` 80, `context_window`).

| decision | What you print |
|----------|----------------|
| `none` (under 50%) | One line: "Context at N% — no prune." |
| `compact` (50–80%) | The output of `cli.js keeplist`: a ready-to-run `/compact …` line whose keep-list names the kickoff, the open stream rows, open findings by id, the rules file, the last commit and running tasks — never finished streams, never file contents. Without a marathon run it keeps `.claude/plans/STATUS.md`, `RULES.md` and the last commit. |
| `clear` (≥ 80%, or the stream just finished) | Recommend `/clear`, and print `cli.js resume --plain` as the first line to paste into the fresh session (without a run it says so and points at `STATUS.md`). A compaction that late buys little room. |

Say plainly that only the person can run the line; you cannot compact for them.

---

### ⛔ CHECKPOINT 4: Record

With a marathon run active: `cli.js record compaction trigger=bc tokens=<n> pct=<n> decision=<d>`.
Without one, skip. Automatic compactions are recorded by the `PreCompact` hook the same way.

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
