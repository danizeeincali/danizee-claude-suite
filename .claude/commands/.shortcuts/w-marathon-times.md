# /w-marathon-times

Timed marathon — the machinery of `/w-marathon` (state in files, one worktree per stream, a wake-up timer, a hard cost ceiling, fresh reviewers) with one difference: the run stops on the **clock**, not on a review bar. Give it a time and a backlog; it works the backlog in order until the wrap-up point, then finishes the step in hand, writes what got done and what did not, runs `/bc` and stops.

## Usage
```
/w-marathon-times <time> [what to work on]
/w-marathon-times --resume [run-id]
/w-marathon-times --status [run-id]
/mtt                                 (alias)
```

`<time>` is either a **duration** counted from the moment you say "Nothing, go." (`5h`, `90m`, `1h30m`, `2.5 hours`) or a **clock time with a zone** (`12pm PST`, `17:30 Europe/London`, `tomorrow 9am ET`, `2026-10-23 08:00 UTC`). Both are read by the same script. US zone names mean the zone's wall clock: `12pm PST` in October is noon Pacific (PDT). A clock time already past today rolls to tomorrow, and the script says so. At most seven days.

## How it differs from /w-marathon

| | `/w-marathon` | `/w-marathon-times` |
|---|---|---|
| The run stops when | the finish line is met (clean reviews in a row, green streaks) | the deadline comes (`cli.js deadline` exits 2), the budget stops it, or the backlog is done and the kickoff says stop early |
| A stream is done when | its gate passes with N clean reviews in a row | its last unit run is green, it has had one review, and no high finding is open (the timed finish line; the owner may tighten it) |
| Reviews | rounds until the clean streak | one fresh review per stream; highs are always fixed, mediums and lows while time allows, the rest are listed |
| Ends with | gate met, then `cli.js finish` | the wrap-up report, `/bc`, then `cli.js finish` |

Every judgment about time is a script, like every count and budget in `/w-marathon`:

```
node .claude/helpers/marathon/cli.js deadline parse <time>   # what the time means now; no run needed
node .claude/helpers/marathon/cli.js deadline set <time>     # fix the run's deadline (once; --replace moves it, the start stays)
node .claude/helpers/marathon/cli.js deadline                # exit 0 keep working · exit 2 wrap-up time or time is up · exit 1 no deadline or broken
```

`deadline` prints `phase` (`work`, `wrap_up`, `over`), `remaining`, `work_minutes_left` and `wrap_up_at`. The wrap-up reserve is the last 10% of the run, at least 10 and at most 60 minutes (`timed` in `.claude/marathon.json`; `--wrap-up <minutes>` on `deadline set` overrides it). Never compute time left in chat.

---

## ⚠️ MANDATORY FIRST ACTION

Use TaskCreate NOW to create todos for ALL phases:
1. Search past solutions
2. Interview once (time, backlog, defaults, if the backlog runs out, budget)
3. Kickoff: init the timed run, write kickoff.md, queue the streams, set the deadline on "Nothing, go."
4. Arm the wake-up
5. Loop streams until the clock says stop
6. Wrap up: report, page, finish
7. Compound every stream with /bc

⚠️ VIOLATION: Any action before TaskCreate = restart workflow

---

## Rules

- **Run `cli.js deadline` before every step and before every fan-out, beside `cli.js budget`.** Exit 2 → go to CHECKPOINT 5 (Wrap-up). **Never start a helper, a review, a fix round or a new stream after a `deadline` exit 2.** Exit 1 → the deadline is missing or broken: fix it with `deadline set`, rerun, do not spawn.
- **NEVER spawn a helper after any non-zero exit from `cli.js budget`** — the `/w-marathon` budget rule, unchanged.
- **Fit the step to the clock.** Before a step, compare its size with `work_minutes_left`. A step that will not fit is split, or a smaller item is taken; a half-built change is never merged.
- **The clock never excuses broken code.** Everything committed on a stream branch has green tests. Unfinished work stays on its branch with a `next=` note.
- **NEVER weaken an assertion.** **NEVER retry a `waitingOnHuman` line.** **NEVER push or merge without the owner's go** (`/bc` commits only; `/bcp` is the owner's go). **Ask once.**
- Update `status.md` through `cli.js` after every step and commit `.claude/marathon/` after every step.

## Model Policy and the shared steps

The model policy (lead on the session model, `cli.js route` for builders, opus reviewers, haiku routines, one tier up on red tests) and the detailed blocks for the steps marked **as /w-marathon** below are the ones in `/w-marathon`. Read `.claude/commands/.shortcuts/w-marathon.md` once at the start of the run (Model Policy, Files, and CHECKPOINT 3 to 6) and follow those blocks exactly; this file only says where a timed run differs.

---

## Execution Protocol

If invoked with `--resume` or `--status`, skip to those sections at the bottom.

### ⛔ CHECKPOINT 0: Search

As /w-marathon CHECKPOINT 0: memory, `docs/solutions/`, past runs under `.claude/marathon/` and the kit lessons (`node .claude/helpers/kit/cli.js reflect lessons list --role mtt` when the kit is installed). Sweeps on `model: haiku`.

**AUTO-PROCEED.**

---

### ⛔ CHECKPOINT 1: Interview (HIL — once, short: the clock has not started)

First read the time: `cli.js deadline parse <time>` (the time from the arguments, else ask for it). Show `deadline_local`, the minutes and the wrap-up reserve; say so when `rolled` (it moved to tomorrow) or `zone_assumed` (no zone was given: the machine's zone was used). One question at a time with AskUserQuestion, with a default offered for each:

1. **Time:** the parsed deadline above — right?
2. **Backlog:** the work in priority order. Each item becomes a stream; the first one starts first.
3. **You may decide on your own / Ask me before / Never:** the three kickoff lines from `/w-marathon`.
4. **If the backlog runs out before the deadline:** stop early (default), or keep going with a next-up list the owner names (tests, docs, polish, or a `/bh` bug hunt on what was built).
5. **Budget:** run token budget and usage ceiling (defaults 20M and 70%).

End with: "What did I forget to ask about?"

**REQUIRED OUTPUT:** the parsed deadline, the ordered backlog, the kickoff lines, the run-out rule, the budget.

---

### ⛔ CHECKPOINT 2: Kickoff (HIL — the last question)

1. `node .claude/helpers/marathon/cli.js init <slug> --mode timed` → a timed run (`command: w-marathon-times`), ACTIVE, with the timed finish line in `finish-line.json` (`runs.streak:unit` ≥ 1, `reviews.count` ≥ 1, `findings.open:high` ≤ 0 per stream; the owner may add lines).
2. Fill `kickoff.md`: the kickoff lines, and under **Time** the time as given, the parsed deadline and the run-out rule.
3. One row per backlog item, in order: `cli.js stream <name> state=queued plan=<path> next="<first step>"`.
4. Print `kickoff.md`, `finish-line.json` and `cli.js status` inline.

**USER GATE:** AskUserQuestion — "Kickoff written (printed above). The clock starts when you say go. Nothing, go?"
Options: ["Nothing, go.", "Change the time", "Change the backlog"]

On "Nothing, go.": **`cli.js deadline set <time>`** — the clock starts now for a duration — print its `deadline_local` and `wrap_up_at`, then commit the run dir (`git add .claude/marathon && git commit -m "marathon(<run-id>): timed kickoff"`).

---

### ⛔ CHECKPOINT 3: Arm

As /w-marathon CHECKPOINT 3 (doctor, `cli.js wake --cron` → CronCreate, `cli.js wake --fallback` printed and not installed). The wake prompt of a timed run checks `cli.js deadline` first, so a wake-up after the deadline goes straight to the wrap-up. Say the deadline in one line.

**AUTO-PROCEED.**

---

### ⛔ CHECKPOINT 4: Loop — per stream, until the clock says stop

Take the `active` stream, else the first `queued` one. Update the stream row after every step (`cli.js stream <name> phase=<phase> next="<the next step>"`) and commit `.claude/marathon/`.

**4.0 Clock — before every step.** `cli.js deadline`. Exit 0 → go on, and size the step to `work_minutes_left`. **Exit 2 → CHECKPOINT 5. Do not spawn.** Exit 1 → fix the deadline, do not spawn.

**4.1 Budget and 4.1a shared helper allowance** — as /w-marathon.

**4.2 Isolate** — as /w-marathon (one worktree per stream, the private scrub patterns copied in).

**4.3 Build and 4.4 record runs** — as /w-marathon, taking the slice of the stream that fits the time left. Red tests → one tier up before any review is spent.

**4.5 Review — one fresh reviewer per stream** once its build is green, as /w-marathon 4.5 (brief, kit analysis, cluster and triage, `record review`, one `record finding` per row, `review-writeup`, the push-gate receipt). A stream is not done without its review: if the review cannot fit before the wrap-up point, leave the stream active with `next="review"` and say so in the wrap-up.

**4.6 Promote** — as /w-marathon (`cli.js seen-twice`, `cli.js promote`).

**4.7 Fix — by severity while the clock allows.** High findings always (they hold the stream open); then mediums, then lows, each fix only when `cli.js deadline` still says `work`. Fix checks and `record finding-fixed` as /w-marathon 4.7. Findings left open are listed in the wrap-up, never closed without a green run.

**4.8 Gate** — the scrub, then `cli.js gate --stream <s>` against the timed finish line, as /w-marathon 4.8. Exit 0 and a clean scrub → `cli.js stream <s> state=done`, `cli.js model-stats`, `/bc`, and start the next queued stream now. Exit 1 → back to 4.0.

**Backlog done before the deadline:** follow the run-out rule from the kickoff — stop early (go to CHECKPOINT 5), or queue the next-up items (`cli.js stream <name> state=queued`) and continue at 4.0.

Light check-ins: "How's it going?" gets `cli.js status` (it shows the deadline line) and nothing else changes.

**REQUIRED OUTPUT per step:** the `cli.js deadline` JSON; per round, the `cli.js gate` and `cli.js budget` JSON and the review write-up path.

---

### ⛔ CHECKPOINT 5: Wrap-up

Reached on a `deadline` exit 2, a `budget` exit 2, or a finished backlog with "stop early".

1. **Start nothing new.** In `wrap_up`, let a helper already running finish and record it. In `over` (time is up), stop any helper still running (TaskStop), record it with `outcome=red`, and keep only what is green.
2. For each stream not done: commit its green work in its worktree and set `cli.js stream <name> next="<what is left>"`; never merge it half-done.
3. Write `.claude/marathon/<run-id>/wrap-up.md` from `cli.js status` and `cli.js gate` JSON (never from memory): the deadline and the time used; streams done and not done, with what is left; findings still open by severity; waiting on human; tokens used (`cli.js model-stats`); and a ready line to continue in a new run: `/mtt <time> <what is left>`, or `/mt <finish line>` to finish it against a review bar.
4. `cli.js page` (publish `page.html` with the Artifact tool when in the desktop app; otherwise say where it is).
5. `/bc` for every stream touched (CHECKPOINT 6), then `cli.js finish`, then delete the in-session wake-up (CronList → CronDelete).
6. Print the wrap-up summary: done, not done, open findings, waiting on you.

A budget exit 2 also leaves the run PAUSED as in /w-marathon; say so and that `cli.js unpause` plus `--resume` continues while time is left.

---

### ⛔ CHECKPOINT 6: Compound (MANDATORY — per stream)

As /w-marathon CHECKPOINT 6: `/bc` after every stream (write-up, handoff rows, memory, commit, never push), memory key `project/marathon/<run-id>/<stream>`, and before any `/bcp`: `/bc`, re-record the receipt, `push-gate check`, then `/bcp`.

---

## `--resume [run-id]`

1. `cli.js resume --run <run-id>` (omit `--run` for the ACTIVE run). If it says wrap-up time or time is up, go to CHECKPOINT 5. Otherwise read `kickoff.md`, `status.md`, `rules.md` and the memory index.
2. The `active` stream continues before any `queued` one; reload its skill and phase.
3. Re-arm the wake-up only if it is absent (CronList first; `cli.js wake --cron` → CronCreate).
4. Continue at CHECKPOINT 4.0.

**More time:** when the owner gives more time, `cli.js deadline set <new time> --replace` (the start stays, so elapsed time stays honest), then resume.

## `--status [run-id]`

`cli.js status --run <run-id>` and `cli.js deadline --run <run-id>` (omit `--run` for the ACTIVE run). Print both. Take no other action.

---

## Completion Checklist

- [ ] TaskCreate used at start with all 7 phases
- [ ] The time read with `cli.js deadline parse` and confirmed in the interview
- [ ] Run created with `cli.js init <slug> --mode timed`; streams queued in backlog order
- [ ] `cli.js deadline set` run on "Nothing, go."; wake-up armed
- [ ] `cli.js deadline` run before every step; nothing started after its exit 2
- [ ] `cli.js budget` run before every fan-out; no spawn after a non-zero exit
- [ ] One fresh review per stream; high findings fixed before a stream is done
- [ ] `wrap-up.md` written from the scripts' output; page published or its path given
- [ ] `/bc` run after every stream; `cli.js finish` run; nothing pushed without `/bcp`

⚠️ Workflow INCOMPLETE until all boxes checked

## Example
```
/w-marathon-times 5h Clear the API backlog: pagination on /orders, retry on webhook delivery, then the CSV export bug
/mtt 12pm PST Finish the onboarding screens and their e2e tests
```
