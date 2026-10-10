# /w-marathon

Marathon — a run with a **finish line** that keeps going for days: one interview, state in files, a wake-up timer, a bar it can't argue with, and a hard ceiling on cost. The first real run builds `/bbs`.

## Usage
```
/w-marathon [finish line description]
/w-marathon --resume [run-id]
/w-marathon --status [run-id]
/mt                                  (alias)
```

Every judgment a model is bad at remembering or counting — streaks, finding counts, budgets, context size, keep-lists — is a script:

```
node .claude/helpers/marathon/cli.js <verb> [--run <id>]
```

Never compute a streak, a count, a budget or a keep-list in chat. Run the verb, act on its JSON and exit code.

---

## ⚠️ MANDATORY FIRST ACTION

Use TaskCreate NOW to create todos for ALL phases:
1. Search past solutions
2. Interview once (finish line, defaults, bar, streams, human jobs, budget)
3. Kickoff: write kickoff.md, finish-line.json, checklist.md, rules.md, streams
4. Arm the wake-up
5. Loop streams until the build gate is met
6. Stop: list what waits on the human, publish the page
7. Compound every stream with /bc

⚠️ VIOLATION: Any action before TaskCreate = restart workflow

---

## Rules

- **NEVER spawn a helper after any non-zero exit from `cli.js budget`.** Exit 2 = the ceiling or the token budget: finish the current step, leave status PAUSED, stop. Exit 1 = the state is broken — an invalid reading or flag, a bad `marathon.json`, or a corrupt store row (`cli.js repair` quarantines corrupt rows; never hand-edit a `.jsonl`): fix the state, rerun `budget`, and only then spawn. Not one more agent either way.
- **NEVER weaken an assertion.** A separate, fresh-context reviewer checks every fix; the next round restores the test.
- **NEVER retry a `waitingOnHuman` line.** List it once under "Waiting on human" and move on.
- **NEVER push or merge without the owner's go.** `/bc` commits only; `/bcp` is the owner's go.
- **Scripts decide, the model acts.** `cli.js gate` says whether the bar is met; `cli.js budget` says whether you may fan out; `cli.js seen-twice` says what to promote.
- **Resume before new.** A stream that is `active` continues before any `queued` stream starts.
- **Ask once.** After the kickoff is approved, the only questions left are the `waitingOnHuman` lines.
- Update `status.md` after every step (every `cli.js record` re-renders it) and commit `.claude/marathon/` after every step. State lives in files, never only in chat.

---

## Model Policy (token/cost) — applies to EVERY helper spawn

The **lead stays on the session model** for the interview, the kickoff, the final verdicts and the synthesis. Everything else is routed — and routing is a **speed × probability** problem. With a contract and failing tests written first, the test run is a near-free error detector, so a cheap builder's mistake costs one retry, not a review round. Errors compound only when a cheap output feeds the next step unchecked; here nothing moves on until its tests are green.

| Work | `models.*` | Default | Why |
|------|------------|---------|-----|
| **Scoped** builds: contract + failing tests exist, ≤ `routing.scoped_max_files` files, not a hard category | `build_scoped` | `haiku` | Fast and cheap; red tests catch a miss for free; break-even needs ~70% failure rate to lose |
| **Default** builds: scope not fully nailed down | `build` | `sonnet` | Near-parity with opus on scoped agentic coding |
| **Hard** builds: `security` or `migration`, root cause unknown, cross-cutting | `build_hard` | `opus` | Errors tests don't catch reach the expensive detector — don't send them there cheap |
| Reviewers (one per round) | `review` | `opus` | The quality backstop that lets builders run cheap |
| Routines (status copying, write-ups) | `routine` | `haiku` | No judgment in them |

**Escalation ladder** (`models.ladder`: `haiku → sonnet → opus → session`): on a **detectable failure — tests still red, regressions, agent stuck or died — retry exactly one tier up, before any review is spent.** Never the same tier twice. Classify with `cli.js route hasContract=true hasFailingTests=true files=<n> category=<c>` → `{class, model, next}`; the model never picks its own tier.

Every helper brief names its **files, its tests and its token budget**. Get the budget from `cli.js budget --helper-budget` (default 150k, max 200k from `.claude/marathon.json`), record the spawn with `cli.js record helper … model=<m>`, and record the actual from the task notification with `cli.js record helper-done helper_id=<id> tokens=<n> outcome=green|red|escalated`. Helpers used 1.8–3.3× their stated budget in the first run; the ledger is how you see it. **`cli.js model-stats`** reports, per model, first-pass green rate, mean tokens and tokens per green step — the number that says whether haiku-first pays on this project. The suite names tiers, never versions: a new release in a tier is picked up automatically.

---

## Files — `.claude/marathon/<run-id>/` (committed, not /tmp)

| File | Who writes it | What it holds |
|------|---------------|---------------|
| `kickoff.md` | lead, once | Done means / You may decide on your own / Ask me before / Never |
| `finish-line.json` | **the human** | one typed line per gate check + the tolerance (high/medium/low counts, passes in a row). Overrides the kickoff. |
| `checklist.md` | the human ticks, Claude reads | jobs only the owner can do — `- [ ] <id> — label` |
| `rules.md` | lead, append-only | standing rules; seeded from `.claude/marathon/rules.md` |
| `status.md` | `cli.js` (rendered, never hand-edited) | state, budget, allowance, gate score, one row per stream |
| `streams.json` | `cli.js stream` | the machine-readable stream rows + the last handoff |
| `reviews/<stream>-r<N>-<id>.md` | `cli.js review-writeup` | generated from finding rows; refuses when counts ≠ rows |
| `store/*.jsonl` | `cli.js record` | runs, reviews, findings, helpers, compactions, promotions, measurements |
| `page.html` | `cli.js page` | read-only view of gate + ledger + streams |

Finish-line sources: `runs.streak:<kind>`, `reviews.streak`, `reviews.latest.<sev>`, `findings.open:<sev>`, `helpers.over_budget`, `checklist:<id>`, `measure:<id>`. A line with `value: null` is shown but not counted. A missing check is **not** a pass.

---

## Execution Protocol

If invoked with `--resume` or `--status`, skip to those sections at the bottom.

### ⛔ CHECKPOINT 0: Search

Memory, `docs/solutions/`, past runs under `.claude/marathon/`, and Pi Brain (read-only):
```bash
curl -s -H "Authorization: Bearer anonymous" "https://pi.ruv.io/v1/memories/search?q=[finish line]&top_k=3"
```
Spawn any sweep with `model: haiku`.

**REQUIRED OUTPUT:** past solutions (0+), prior runs (0+), applicable patterns.

**AUTO-PROCEED.**

---

### ⛔ CHECKPOINT 1: Interview (HIL — once)

One question at a time with AskUserQuestion. Every question Claude would otherwise ask mid-build gets answered here, so it never stops to wait. Cover, in this order:

1. **Done means:** the finish line, as checks — green runs in a row, clean reviews in a row, what the packaged thing must do, what number must be reached.
2. **You may decide on your own:** what Claude may fake, choose or skip without asking ("if you need a key, fake it").
3. **Ask me before:** the decisions that must wait for the owner.
4. **Never:** the lines that are never crossed (push to main, run against the owner's port, weaken a test).
5. **Streams:** how the work splits so it can run in parallel — one git worktree per stream by default (`streams.isolation` in `.claude/marathon.json`).
6. **The bar:** tolerance per severity and passes in a row (default 0 high / 2 medium / 5 low, 2 in a row). The human owns these numbers and can change them in `finish-line.json` at any time.
7. **Human jobs:** accounts, keys, domains, testers, deploys — the `checklist.md` lines and their `owner: human` gate lines.
8. **Budget:** run token budget and usage ceiling (defaults 20M and 70%). Say plainly that one fix round cost 8.7M tokens in the first project and one power cost ~650k in the `/bbs` run.
9. **Wake-up:** in-session cron (dies with the session, expires in 7 days) plus the launchd/crontab fallback the owner may install.

End with: "What did I forget to ask about?"

**REQUIRED OUTPUT:** the four kickoff lines verbatim, the stream list, the tolerance, the human jobs, the budget.

---

### ⛔ CHECKPOINT 2: Kickoff (HIL — the last question)

1. `node .claude/helpers/marathon/cli.js init <slug>` → creates `.claude/marathon/<run-id>/` and marks it ACTIVE.
2. Fill `kickoff.md` with the four lines. Fill `finish-line.json`: one typed line per check from the interview (`type` bool|number|percent, `op` is|at_least|at_most, `owner` build|human, `source` from the list above), plus the tolerance. Add the human jobs to `checklist.md`. Append project rules to `rules.md`.
3. One row per stream: `cli.js stream <name> state=queued plan=<path> next="<first step>"`.
4. `cli.js status` → prints `status.md`.
5. **Print kickoff.md, finish-line.json, checklist.md and status.md inline.**

**USER GATE:** AskUserQuestion — "Kickoff written (printed above). Nothing, go?"
Options: ["Nothing, go.", "Edit the finish line", "Change the streams"]

On "Nothing, go.": commit the run dir (`git add .claude/marathon && git commit -m "marathon(<run-id>): kickoff"`). This was the last question until a `waitingOnHuman` line or the run ends.

---

### ⛔ CHECKPOINT 3: Arm

- `cli.js wake --cron` → JSON `{schedule, prompt}`. Create the in-session recurring check with **CronCreate** using exactly that schedule and prompt. Say that it lasts for this session and expires after seven days.
- `cli.js wake --fallback` → print the crontab line and the launchd plist. The owner installs one if the run must survive a restart; **do not install it yourself.** Each fallback wake is a fresh `claude -p` session that starts from `cli.js resume --plain`.
- The suite's hooks are already registered: `PreCompact` stamps `status.md` before any compaction; `SessionStart(compact)` prints `cli.js resume` afterwards. Say so in one line.

**AUTO-PROCEED.**

---

### ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met

Take the `active` stream, else the first `queued` one. For each step below, update the row — including what comes next, so a resume line is never stale — (`cli.js stream <name> phase=<phase> skill=<skill> next="<the next step>" tasks=<id>,<id>`) and commit `.claude/marathon/` afterwards.

**4.1 Budget — before every fan-out.**
In the desktop app, read the allowance with `get_usage` and pass the **weekly** percentage — the higher of the overall weekly figure and the per-model weekly figure for the review model — as `cli.js budget --usage-pct <n>` (the reading is kept for `usage_reading_ttl_minutes`, then the allowance is `unknown` again). In a terminal, run `cli.js budget` (allowance `unknown`; the token budget still applies). The helper budget for the next brief comes from the same call: `cli.js budget --usage-pct <n> --helper-budget` (bare = the configured default, or `--helper-budget <n>`).
- exit 0 → continue.
- **exit 2 → the run is now PAUSED (it stays paused until a fresh reading below the ceiling or `cli.js unpause`). Go to CHECKPOINT 5. Do not spawn.**
- **exit 1 → the state is broken; fix it, rerun. Do not spawn.**

**4.2 Isolate — whenever the stream has no `isolation` yet** (every stream, once; skip on later rounds of the same stream). `git worktree add ../<repo>-<stream> -b marathon/<run-id>/<stream>` (or a folder when `streams.isolation: folder`), then `cli.js stream <name> state=active isolation=<path>` — the stream's base commit is recorded then, so the first review covers everything the stream adds. Add task ids later as they exist: `cli.js stream <name> tasks=<id>,<id>`.

**4.3 Build.** Inside the worktree, build through `/pt` (interview already done — pass the stream's plan and skip straight to its Plan gate) or `/w-tdd-swarm`: contracts first, failing tests, then builders. Route each builder with `cli.js route hasContract=<bool> hasFailingTests=<bool> files=<n> category=<c>`: **scoped → `build_scoped` (haiku)**, default → `build` (sonnet), **hard → `build_hard` (opus)**. For every helper: `cli.js record helper stream=<s> role=build model=<m> budget=<n>` before the spawn (put the budget in the brief); `cli.js record helper-done helper_id=<id> tokens=<n> outcome=green|red|escalated` from the task notification. **Red tests → retry one tier up (`next` from `cli.js route`) before any review is spent**, with `escalated_from=<id>` on the new spawn row; the second row's outcome is what the review sees. A builder's output never feeds the next step until its tests are green.

**4.4 Record runs.** After every test run: `cli.js record run kind=unit|e2e|build status=green|red stream=<s>`. Each test run uses its own temp folder, cleaned up afterwards.

**4.5 Review round — one fresh reviewer.** First **commit the stream's changes in its worktree** — the brief diffs committed history and the review is stamped with HEAD.
`cli.js review-brief --stream <s>` → the brief: severity definitions, this round's angle, the tolerance, the category list, and the diff from the **last certified point** — the HEAD that the last *completed* clean streak certified, else the stream's base commit — to HEAD in the stream's checkout. An over round certifies nothing and never narrows the next review; every round of a clean streak sees the **same code from a different angle**, and only a completed streak moves the base. An empty diff or a git failure is an error, not a clean brief; lock files and generated assets are excluded and an oversize diff is summarised with `--stat`. Spawn one reviewer with `model: opus`, the brief, and a budget (recorded as in 4.3). It returns **JSON rows only**.
Then: `cli.js record review stream=<s> counts='{"high":H,"medium":M,"low":L}' angle="<angle>" tokens=<n>` (counts must be the row totals; pass/over is computed from the tolerance and can never be supplied) → one `cli.js record finding review_id=<id> stream=<s> severity=... category=... file=... line=... title="..." detail="..." fix_hint="..."` per row → `cli.js review-writeup --review <id>`. If the write-up refuses because the counts and the rows disagree, record the missing finding rows, or **replace** the review with the right counts (`cli.js record review … replaces=<id>`) — one review per round, never a second row for the same round.

**4.5a Calibrate the reviewer (optional, once per run before the first review).** Grade the reviewer prompt on the planted-bug fixtures the kit ships. Skip it when the run already has a calibration or the owner does not want the spend. Make a scratch folder `<cal>`. For each folder under `.claude/helpers/kit/review-fixtures/repos/` spawn one reviewer with the same brief shape as 4.5 (budgeted and recorded as in 4.3) but with that fixture folder as the only code to review; it returns JSON rows only. Save each answer as `<cal>/reviews/<case>.json` in the form `{"case":"<folder name>","completed":true,"findings":[rows]}` (`completed` is false when the reviewer stopped early). Then run:

```bash
node .claude/helpers/kit/cli.js review-score --specs .claude/helpers/kit/review-fixtures/specs --reviews <cal>/reviews --out <cal>/scores
```

It prints `totals` (precision and recall as summed ratios; null means nothing to divide), a verdict per case (hit, near miss, duplicate, accepted, false positive, missed) and saves `<cal>/scores/scores.json`. A copy of the specs is taken on the first run and reused, so editing a spec later never changes an old score. Exit 1 means invalid input: fix it and rerun. Low recall or a failed clean case means the reviewer prompt needs work before it is trusted; write that as a finding row for the stream, never as a pass. The reviewer spawns need the model API; without `--wording`, the `review-score` command itself reads saved files only and makes no network call.

Optional second opinion on wording: add `--wording` to that command (or run `cli.js wording-judge --out <cal>/scores --dry` first). It sends only the findings that matched a planted bug, with the planted truth, to a sealed model run (no tools, settings, MCP servers or saved session), writes the plan (calls) to stderr before the first call (use `--dry` on `wording-judge` to see it without spending), and writes `<cal>/scores/wording.json`. `--wording-cap <n>` limits calls and `--wording-resume` skips cases whose findings were all judged and have not changed since. A usage limit or login wall stops it at once. It is reported beside the scores and never changes them or the exit code.

**4.6 Promote — the flywheel.** `cli.js seen-twice` lists categories seen in two reviews and not yet promoted. For each: write a test, a scripted scan, a fixture or a standing rule, then `cli.js promote <category> --kind test|scan|fixture|rule --ref <path>`. The reviewer stops spending tokens on it.

**4.7 Fix round.** Open findings → one fixer on `model: sonnet` with the write-up (`opus` for `security`, or on the second attempt). Never weaken an assertion. Fix the shared test helper first when a rule changes. When a fix is verified by a green run, close the finding: `cli.js record finding-fixed id=<finding id>` — an open finding that is never closed fails the `findings.open` lines forever. **Commit the fixes in the stream's worktree.** Back to 4.4.

**4.8 Gate.** `cli.js gate --stream <s>` (per stream — streaks, latest review and open findings are scoped to that stream; lines with `scope: run` in `finish-line.json` — e2e streaks, packaged checks, human jobs — are reported as run_scoped and left to the run-wide gate; plain `cli.js gate` is the whole run):
- exit 0 (`buildGateMet`) → `cli.js stream <name> state=done`, `cli.js model-stats`, **start the next queued stream now** so no wake path ever finds the run idle: its worktree first (`git worktree add ../<repo>-<next> -b marathon/<run-id>/<next>`), then `cli.js stream <next> state=active isolation=<path>` (the CLI refuses an activation without isolation in worktree mode), then run `/bc`, commit, and continue with that stream at 4.1. When no stream is left and the run-wide `cli.js gate` exits 1 (an escape recorded after a stream closed, a stream-less row), reopen the owning stream (`cli.js stream <name> state=active`) and continue at 4.1.
- exit 1 → next round at 4.1. "Two clean reviews in a row" is the `reviews.streak` line and `tolerance.passes_in_a_row` (they must agree); the human owns the number. If the JSON carries `error`, the gate is blocked: `finish-line.json` is unreadable or fails its schema (owner build|human, op is|at_least|at_most, type bool|number|percent, a known source), or the store has corrupt rows (`corrupt` > 0 → `cli.js repair`). Fix that before anything else — a blocked gate is a gate that is not met.

**4.9 Escapes.** A problem the owner finds while using the build: `cli.js record escape stream=<s> severity=<sev> title="..."`. Escapes per stream show the cost of a skipped review.

Light check-ins: "How's it going?" gets the output of `cli.js status` and nothing else changes.

**REQUIRED OUTPUT per round:** the `cli.js gate` JSON, the `cli.js budget` JSON, the review write-up path.

---

### ⛔ CHECKPOINT 5: Stop

- **All streams done and `cli.js gate` exits 0:** print the `waitingOnHuman` lines ONCE under "Waiting on human", run `cli.js page` (publish `page.html` with the Artifact tool when in the desktop app; otherwise say where it is), then `cli.js finish` — it marks the run FINISHED and clears ACTIVE so the hooks and the fallback wake-up go quiet — delete the in-session wake-up (CronList → CronDelete) and stop. When `gateMet` is also true, say the run is finished.
- **`cli.js budget` exited 2:** the run is PAUSED and stays paused — `cli.js status` shows it and the "Next for you" line. Delete the in-session wake-up (CronList → CronDelete), say so in one line and stop. The owner raises `run_token_budget` or `ceiling_pct` in `.claude/marathon.json` (or waits for the allowance), then runs `cli.js unpause` — or `cli.js budget --usage-pct <fresh reading>` below the ceiling clears it — and `--resume` continues from the saved step.
- **Blocked:** a stream that cannot proceed without the owner → `cli.js stream <name> state=blocked next="<what is needed>"`, add the line to `checklist.md`, take the next stream.

---

### ⛔ CHECKPOINT 6: Compound (MANDATORY — per stream)

`/bc` after every stream: write-up on `sonnet`, handoff rows, durable facts to memory, commit, never push. Memory key `project/marathon/<run-id>/<stream>`; doc under `docs/solutions/`; Ralph candidate check; RC-A candidate check. The run itself ends with one more `/bc`.

---

## `--resume [run-id]`

1. `cli.js resume --run <run-id>` (omit `--run` for the ACTIVE run) → read `kickoff.md`, `status.md`, `rules.md` and the memory index.
2. The `active` stream continues before any `queued` one starts. If its row names a skill and a phase, reload that skill and continue from that phase — do not restart it.
3. Re-arm the wake-up only if it is absent (CronList first; `cli.js wake --cron` → CronCreate when no marathon job exists).
4. Continue at CHECKPOINT 4.1.

## `--status [run-id]`

`cli.js status --run <run-id>` and `cli.js gate --run <run-id>` (omit `--run` for the ACTIVE run). Print both. Take no other action.

## Verbs

`init` · `status` · `gate [--stream <s>]` · `budget [--usage-pct <n>] [--helper-budget [<n>]]` · `unpause` · `record run|review|finding|finding-fixed|helper|helper-done|measure|compaction|escape [--cwd <checkout>]` · `repair` · `promote` · `seen-twice` · `review-brief` · `review-writeup` · `stream` · `route` · `model-stats` · `handoff` · `resume` · `keeplist` · `context` · `wake --cron|--fallback` · `page` · `finish` · `shadow-check`. All take `--run <id>`; without it the ACTIVE run is used. Every verb resolves the run from the **main checkout** even when called from inside a stream worktree.

---

## Completion Checklist

- [ ] TaskCreate used at start with all 7 phases
- [ ] Interview held once; the four kickoff lines captured verbatim
- [ ] `.claude/marathon/<run-id>/` created and committed; `finish-line.json` typed and owned by the human
- [ ] Wake-up armed with CronCreate; fallback printed, not installed
- [ ] `cli.js budget` run before every fan-out; no spawn after exit 2
- [ ] Every helper has a budget row and an actual row with an outcome; builders routed with `cli.js route`, escalated one tier up on red tests
- [ ] `cli.js model-stats` printed at the end of every stream
- [ ] Every review is a fresh `opus` reviewer on the diff since the last certified point, with JSON rows
- [ ] `cli.js seen-twice` run after every review; promotions recorded
- [ ] `waitingOnHuman` lines listed once, never retried
- [ ] `/bc` run after every stream; nothing pushed without `/bcp`

⚠️ Workflow INCOMPLETE until all boxes checked

## Example
```
/w-marathon Ship /bbs in the suite: intake, fetch, inventory, map, verdict gate, hand-off to a marathon run. Two clean reviews per stream, six green e2e runs, under 10M tokens.
```
