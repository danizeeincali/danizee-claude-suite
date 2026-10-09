# Marathon — a run with a finish line (/w-marathon, /bc, /bcp)

**Memory key:** `project/ideas/marathon`
**Spec:** `.claude/plans/2026-10-07-w-marathon.md`
**Source:** Dani's write-up "How to keep Claude working for days" and the `/bbs` first-run report.

## The problem

Claude Code stops for four reasons: it runs out of task, it waits for an answer, it forgets, or it
can't tell whether the work is good. A week of running it for days on two projects produced eight
habits that each remove one of those reasons — and a cost lesson: the first full run burned a week's
usage allowance in under 24 hours, mostly in helper agents.

## What was built

A new command `/w-marathon` (alias `/mt`), a zero-dependency helper library the installer copies
into `.claude/helpers/marathon/`, two compaction hooks, a reviewer kit, and a redesign of `/bc`
with a new `/bcp`.

| Habit | Where it lives |
|-------|----------------|
| Finish line, not a task | `finish-line.json`: one typed line per check (`bool`/`number`/`percent`, `at_least`/`at_most`/`is`, owner `build`/`human`) + tolerance |
| Interview once, then "Nothing, go." | Checkpoint 1–2 of the command; the kickoff gate is the last question |
| Defaults decided up front | `kickoff.md`: done means / may decide alone / ask me before / never |
| A bar it can't argue with | `cli.js gate` — scripts decide; a missing check is never a pass |
| State outside the chat | `status.md` rendered after every step; `streams.json`; `store/*.jsonl` |
| Wake-up timer | `cli.js wake --cron` (in-session) and `--fallback` (crontab/launchd → `claude -p "$(cli.js resume --plain)"`) |
| Worktree per stream | `streams.isolation` in `.claude/marathon.json` |
| Human jobs on a checklist | `checklist.md`, `owner: human` lines → `waitingOnHuman`, listed once, never retried |

### Design rules that came out of the data

1. **Scripts decide, the model acts.** Counting findings, streaks, budgets, context size and
   keep-lists are all `cli.js` verbs with JSON output and exit codes. The cheap-model "routine"
   wrapper in the original run cost 64k tokens per review to run two scripts; the lead running
   the script costs ~5k.
2. **The ceiling is code.** `cli.js budget` exits 2 at `ceiling_pct` (weekly allowance via
   `get_usage` when available) or at `run_token_budget` (actuals of done helpers + stated budgets
   of in-flight ones). The protocol forbids any spawn after a non-zero exit.
3. **Findings are typed rows.** 290 findings had 290 distinct signatures but 8 categories, so the
   "seen twice" rule works on `category`. `cli.js seen-twice` → promote to test/scan/fixture/rule
   → the reviewer stops paying for it.
4. **Review the diff since the last clean review**, with written severity definitions and a
   rotating angle. "Confirm the fixes" is never a round on its own.
5. **Routing is speed × probability.** With contracts + failing tests the test run is a near-free
   error detector, so scoped builds start on `haiku` and climb `haiku → sonnet → opus → session`
   on red tests, *before* any review is spent. Hard work (security, migrations, unknown root
   cause, cross-cutting) goes straight to `opus`. `cli.js model-stats` measures whether it pays.
6. **Tiers, never versions.** Config names `haiku`/`sonnet`/`opus`; a new release in a tier is
   picked up automatically; a test forbids naming premium models.
7. **Store is truth, status is a view.** Humans edit two files (`finish-line.json`,
   `checklist.md`); everything else is appended or rendered.

### `/bc` redesign

Only the person can run `/compact` or `/clear`. `/bc` now: background write-up on `sonnet`
(commits, never pushes) → lead writes the handoff (status rows, rules, memory) → `cli.js context`
measures the transcript → under 50% nothing, 50–80% a ready-to-run `/compact` with a generated
keep-list, ≥ 80% `/clear` + the resume line → `cli.js record compaction`. `/bcp` is the owner's go
(`--push`). `PreCompact` and `SessionStart(compact)` hooks make automatic compaction behave the same.

### Shadowing

A `~/.claude/commands/<name>.md` silently wins over the project copy — that is how an old `/bc`
without the prune step ran all week. `init` and `check` now list collisions and print the rename.

## How to use it

```
/w-marathon Ship /bbs in the suite. Two clean reviews per stream, six green e2e runs, under 10M tokens.
/w-marathon --status
/w-marathon --resume
```

Edit `.claude/marathon/<run-id>/finish-line.json` to change the bar; tick `checklist.md` lines as
you do the human jobs; raise `run_token_budget` / `ceiling_pct` in `.claude/marathon.json` to
continue a PAUSED run.

## What to measure on the first real run (building /bbs)

- Resumes without being asked after a forced compaction (zero "where were we?" turns).
- Owner-found escapes per stream trend to zero.
- Tokens per clean review fall as categories get promoted.
- `cli.js budget` never breached — no spawn after exit 2.
- `cli.js model-stats`: first-pass green rate and tokens per green step, haiku vs sonnet.

## Deferred

- `/bbs` itself (Slice C) — the first `/w-marathon` run builds it; OpenQodex is its first source.
- A learned router (e.g. RuVector `@ruvector/typesafe`) behind `classifyBuild(signals, config)`,
  once the ledger has labeled outcomes — via `/bbs`.
- SQLite export of the JSONL store.

## What the first adversarial review found (and why it matters for the design)

One fresh `opus` reviewer on the whole change returned 10 high / 12 medium / 9 low. Every high was
a way the gate or the budget could **silently pass**, which is exactly the regret the spec names:

- A corrupt or missing `finish-line.json` fell back to an empty line set → `gateMet` vacuously true.
  Fix: an unreadable finish line is a gate that is not met; a review cannot be graded without a
  valid tolerance.
- `--usage-pct 85%` → `NaN >= 70` is false → ceiling off. Fix: non-finite readings refuse (exit 2).
- A review recorded without counts (or with `pass=true`) counted as clean. Fix: counts must be a
  valid object, `pass` can never be supplied, `review-writeup` refuses when counts ≠ rows.
- Findings could never close, so `open_high` failed forever — the "reviews loop forever" regret
  from the other side. Fix: fold findings by id, `record finding-fixed`.
- Streaks spanned all streams; a stream could close on another stream's clean reviews. Fix:
  `gate --stream`.
- `''` and `null` measurements met `at_most` lines (`'' <= 200` is true in JS). Fix: number lines
  require a finite number, bool lines a boolean.
- `/bc` in a project with no marathon run died at its own keep-list step. Fix: run-less paths.
- The first review of a stream saw only `HEAD~1`; commits were stamped from the main checkout, not
  the worktree. Fix: record the stream's base commit at `state=active`, take commits from the
  stream's checkout.

Pattern: **fail closed everywhere a human-edited file or a model-typed value enters the gate.**
The property tests now generate garbage (missing, null, strings, negatives) alongside valid inputs,
and `test/marathon-cli.test.js` runs the documented invocations against the real CLI — the two
tests that would have caught most of this before the review did.

## What the second review found — and the design change it forced

A second fresh reviewer (failure-conditions angle) returned 8 high / 10 medium / 6 low and showed
three round-1 highs only *partly* closed: counts with the wrong keys still graded as zeros,
`buildGateMet` was vacuously true with no build line, and the usage reading could still be
disabled through the measurement path. New ones: a half-written last line glued the next record
onto it (lost, exit 0); a corrupt store line could hide a failing review (the round-1 "skip and
count" fix had introduced a fail-open); the second review of a clean streak got an *empty* diff;
`streams.json` lost rows under parallel writes; CLI calls from inside a stream worktree wrote to
a stale copy.

That is the doc's own rule firing — *after two failed rounds, change the design, don't patch
wording* — so the fix round made one change: **a validation layer at every boundary** (schema
for `finish-line.json`, exact `{high, medium, low}` for counts, 0–100 for usage readings, names
and shas checked), **fail closed on any store damage** (corrupt rows block the gate and the budget
until `cli.js repair` quarantines them; appends never glue), **a lock on the streams file**,
**state resolved to the main worktree**, and **a review streak that diffs from where it began**
so every angle judges the same code. One of my own round-2 tests contradicted the spec's
invariant (`gateMet ⇒ buildGateMet`); the spec won — a finish line with no build line is never
"done".

## What the third review found — the operator's path

With the gate-bypass and store-damage classes closed (all 24 round-2 findings verified), a third
fresh reviewer read the protocols as the person who must follow them for days and found the next
layer: the run stalled at every stream boundary (no active stream → every wake path silent); an
over round narrowed the clean streak to the fix diff; a tolerance typo made a severity unlimited;
the ceiling pause quietly expired with the reading; the fallback's `PATH` missed nvm and
`~/.local/bin` on this very machine; a nested project resolved state to the enclosing repo root.
Fixes: every wake path names the next queued stream; reviews diff from the last *certified*
point; tolerance and value/type are schema-checked; a pause is a persisted state cleared only by a
fresh reading below the ceiling or `unpause`; the fallback embeds absolute binaries and logs when
they are missing; only linked worktrees are redirected; `status.md` carries a "Next for you" line.

Three rounds, each a shallower class: gate bypass → store and concurrency → operator path. That
shape is the doc's own observation ("each tougher review finds a new kind of small problem"), and
the doc's answer applies: the number of clean rounds required is a tolerance the human owns.

## The fourth review — a dry run, and what my own fixes had opened

Dani set the bar at one more round. It confirmed every round-3 finding closed and walked the whole
protocol end to end on files alone — then found 3 highs, two of them opened by the round-3 fix
itself: the review fold let a caller rewrite or void a review by passing `id=`/`void=`, and
replacing an *older* review moved it to the end of the ledger (inflating the streak). The third
was a protocol gap: every stream after the first was activated without a worktree. Fixes: the
ledger has exactly two write paths (a new round, or `replaces=` of the latest round); activation
refuses without isolation in worktree mode; wake paths close a finished run instead of going silent.

Lesson worth keeping: **a fix that adds a fold or an alias adds a write path** — review it as one.
Trend across rounds was 10 → 8 → 11 → 3 highs; shipped after four with the ledger in the spec.

## Lessons from this build

- The repo's committed `.claude/commands/.shortcuts/*.md` had drifted from the generator in
  `src/plugins/dot-shortcuts.js` (e.g. `w-swarm.md` differs by ~170 lines, and the ruflo tests
  depend on the committed copy). Regenerating everything broke four tests; only the five touched
  files were re-rendered. The generator and the committed copy need reconciling (follow-up).
- `npm install` of a devDependency also built the optional `better-sqlite3`, which made the four
  pre-existing PM-module failures pass. The baseline is now fully green.
- fast-check 4 removed `fc.hexaString`; use `fc.stringMatching(/^[0-9a-f]{8}$/)`.
- zsh does not word-split `$CMD` with spaces; smoke scripts that call `node file args` through a
  variable must run under bash or use a shell function.

## First real run: 2026-10-07-bbs (closed 2026-10-09)

Measured from `.claude/marathon/2026-10-07-bbs/store/*.jsonl` and `cli.js` output, answering the
"What to measure on the first real run" list above.

- **Resumes after compaction and pauses**: the run paused four times at the allowance ceiling (70%,
  95%, 98%, 100%; intake active, verdict r2, command-docs built, command-docs r1 fixed). The owner
  raised the ceiling three times (95, 98, 100) and the allowance reset once. Every resume was from
  files (`status.md`, `cli.js resume`), with no "where were we?" turn recorded. One compaction row
  (`bc`, 308,015 tokens, 30.8%, decision `clear`).
- **Escapes per stream**: 0 in all 7 streams (`cli.js status`).
- **Tokens per review**: 30 reviews. Clean (pass): 16, mean 105,356 tokens. Over tolerance: 14, mean
  110,510 tokens. The gap is about 5%, so promotion lowered rounds-to-clean more than cost per review.
- **Budget never breached**: no helper was spawned after `budget` exited 2. The four pauses are the
  only exit-2 events; each ended with an owner raise before the next spawn.
- **`cli.js model-stats`** (every helper finished green, none escalated):
  - sonnet: 26 spawned, 25 done, first-pass green 100%, mean 95,237 tokens
  - opus: 44 spawned, 44 done, first-pass green 100%, mean 111,356 tokens
  - haiku: 3 spawned, 3 done, first-pass green 100%, mean 138,398 tokens
  The 100% rate is uninformative: no row ever failed, so the router was never tested by a red step.
- **Totals**: 7 streams closed; 30 reviews; 168 findings with a severity (9 high, 81 medium, 78 low),
  all with `fixed_ts`; 9 rules promoted (`promotions.jsonl`); 73 helpers spawned (150 helper rows,
  including 5 helpers with a second `done` row, which inflates a naive sum to 8,339,135); spend
  7,795,797 of the 10,000,000 budget (status line; `model-stats` sums 7,695,797); final test
  count 1055; 37 green unit runs and 8 green e2e runs in a row.
- **Surprises**: the run-wide finish-line lines (`e2e_streak`, `packaged`, `pushed`) cannot be met
  per stream, so a stream-close rule was written by hand.
