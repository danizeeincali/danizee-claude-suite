# /w-marathon + /bc redesign — Long-running runs with a finish line

## Origin

Dani ran Claude Code for days on two projects and wrote up what kept it going
("How to keep Claude working for days", claude.ai/artifact/MVW8bZQHREvm1hCmNM9xkc).
Separately, a `/bbs` (beg-borrow-steal) command was built in the chief-of-staff repo
to absorb capabilities from outside sources; its first run spent 18.6M tokens and
shipped 0 powers, and its Part 3 "where to improve" list is the same infrastructure
the doc describes. This spec brings both into the suite.

## Source material, condensed

**The eight habits** (each removes one reason Claude stops):
1. Finish line, not a task. 2. Interview once, then "Nothing, go." 3. Decide defaults
ahead of time (may decide alone / ask before / never). 4. A bar it can't argue with
(two clean reviews in a row, six green runs). 5. State saved outside the chat
(status file). 6. A wake-up timer. 7. Worktree per stream. 8. Human jobs on a shared
checklist.

**What the updates added:** usage ceiling (70% of weekly allowance, checked before
every fan-out); fixed model roles with one-tier-up retry; contracts and failing tests
first; a budget per helper (120k–200k); a results store so "done" is a query; the
flywheel rule (anything seen twice becomes a test/check/fixture/rule); a tolerance
page the human owns (per-severity counts + passes in a row); one typed input per
gate line (bool / number / percent, at-most / at-least, owner build|human);
`failing / waitingOnHuman / buildGateMet / gateMet`.

**What was measured:** reviews are 43% of helper tokens and reread most of the code
→ scope to the diff since the last clean review. 290 findings had 290 distinct
signatures but only 8 categories → "seen twice" must work on categories. The
cheap-model gate wrapper cost 64k/review vs 5k for the lead running the script →
the lead runs the script. Helpers used 1.8–3.3× their stated budget → record actuals.
Owner-found problems are escapes → record who found each problem.

**The /bc spec** (from the doc, implemented here as written except for file level):
project config; background write-up on sonnet that commits and never pushes; lead
writes the handoff (status rows, rules, memory) in the foreground; lead measures
context from the transcript; thresholds <50% no prune, 50–80% print a `/compact`
line with a generated keep-list, >80% or stream finished recommend `/clear` + resume
line; record the event; `PreCompact` hook stamps state, `SessionStart(compact)` hook
prints the resume line.

## Interview decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Shape of the learnings in the suite | **New command `/w-marathon`** (+ alias `/mt`). Existing commands untouched except `/bc`. |
| 2 | `/bc` scope and level | **Full spec, project-level.** Installer + `check` warn when `~/.claude/commands/{bc,bcp,pt,mt,w-*}.md` would shadow a suite command. Hooks merged into `settings.json` by the installer. |
| 3 | Results store | **JSONL files, zero deps.** `runs / reviews / findings / helpers / compactions / promotions / measurements .jsonl` + node scripts for streak/gate/yield. Drop `lessons` and `tuning` (never used). |
| 4 | Wake-up default | **In-session cron + printed fallback.** Command arms an in-session recurring check; also prints a launchd/cron line running `claude -p "<resume line>"` for restart-survival (user opts in). |
| 5 | Finish line / tolerance | **`finish-line.json` + gate script + optional artifact render.** Edits happen in the file; `marathon page` renders a read-only HTML view the desktop app can publish. |
| 6 | Usage ceiling | **Allowance when available, token budget always.** `ceiling_pct` via `get_usage` when the tool exists; `run_token_budget` always enforced from `helpers.jsonl`. Both hard: the fan-out step stops on a non-zero exit. |
| 7 | `/bbs` port strategy | **Clean-room rebuild from the spec.** No chief-of-staff code (it isn't on this Mac anyway). |
| 8 | `/bbs` architecture | **`/bbs` = intake → marathon run.** `/bbs` owns intake/fetch/inventory/map/verdict; approved powers become streams of a marathon run with a 5-check finish line each. |
| 9 | Sequencing | **Slices A (marathon core) + B (/bc, /bcp, hooks) in this run. Slice C (/bbs) is the first real `/w-marathon` run** — dogfood before advertising. |
| 10 | Name | `/w-marathon` + `/mt`; run dir `.claude/marathon/<run-id>/`; scripts `marathon <verb>`. |
| 11 | Success measures (all four) | Resumes without being asked · owner-found escapes trend to zero · cost per clean review falls · ceiling never breached. |
| 12 | Regret conditions | **"It burns the week again"** and **"reviews loop forever on noise."** |
| 13 | Defaults confirmed | Worktree per stream (folder isolation as an option) · reviewer kit ships with the suite · human checklist file. |
| 14 | `/bc` push policy | **`/bc` commits and never pushes; new `/bcp` = background-compound-push** (today's push + merge behaviour). |
| 15 | OpenQodex | **Left to `/bbs`.** Slice A ships only the seam (`found_by: scanner`, `review.backend` as a config string); no OpenQodex-specific code. It is the first `/bbs` source on the dogfood run. See assessment below. |

## User quotes

- "lets talk it through"
- "Clean-room rebuild from the spec" (for /bbs)
- "We should have bc and bcp (background-compound-push)"
- "would this help? https://github.com/openqodex/openqodex"
- From the doc: "Nothing, go." · "Six sigma." "Two clean reviews in a row." ·
  "anything Claude can forget, lose or talk itself out of needs to live in a file,
  a test, or a rule it reads every time."
- From the /bbs write-up: "A helper cannot see its own token use." · "A missing check
  is not a pass."

## Non-negotiables (derived from the regret answers)

1. **The ceiling is code, not advice.** `marathon budget` exits 2 when `usage_pct ≥ ceiling_pct`
   or `spent ≥ run_token_budget`; the command protocol forbids any helper spawn after a
   non-zero exit. Every helper spawn writes a row with its stated budget; every task
   notification writes the actual; over-budget helpers are flagged in `status.md`.
2. **The gate is tunable and findings are typed.** Tolerance per severity + passes-in-a-row
   live in `finish-line.json` and override the kickoff. Findings are structured rows with a
   category from a fixed, extensible list. A category seen in two reviews is promoted
   (test / scan / fixture / rule) and recorded, so reviewers stop spending tokens on it.
3. **Never weaken an assertion.** Standing rule in `rules.md`, checked by a fresh reviewer.
4. **Nothing pushes or merges without the owner's go** unless the owner used `/bcp`.
5. **Not desktop-only.** Every feature degrades explicitly in the CLI (`allowance: unknown`,
   `page: not published`), never silently.

## Scope

### Slice A — marathon core (this run)

**Command** `.claude/commands/.shortcuts/w-marathon.md` (+ `mt.md` alias), suite checkpoint style:

| Phase | Gate | What happens |
|-------|------|--------------|
| 0 Search | auto | memory + docs/solutions + Pi Brain (read-only) |
| 1 Interview | **HIL** | `/pt`'s categories + the doc's four lines: *Done means / You may decide alone / Ask me before / Never*. One question at a time. |
| 2 Kickoff | **HIL** | Writes `kickoff.md`, `finish-line.json` (typed lines, owner build/human), `checklist.md`, `rules.md`, `status.md` (one row per stream). Prints all. Approval = "Nothing, go." — the last question until a `waitingOnHuman` line. |
| 3 Arm | auto | Arms the in-session wake-up (`marathon wake --cron`), prints the launchd/cron fallback, commits the run dir. |
| 4 Loop | auto | Per stream: `marathon budget` → worktree → build through `/pt` (contracts + failing tests first) → `marathon record run` → review round (reviewer kit) → `marathon record review/findings` → `marathon gate` → fix round or next stream. `marathon promote` on seen-twice. `status.md` rewritten after every step; state committed. |
| 5 Stop | auto | `buildGateMet` for every stream → list `waitingOnHuman` once → stop. Budget/ceiling hit → finish the step, exit 2, status says `PAUSED (budget)`. |
| — Compound | auto | `/bc` at the end of every stream. |

Modes: `/w-marathon <finish line>` (new run), `--resume [run-id]` (continue the active
stream before starting a new one), `--status` (print `status.md` + gate).

**Run directory** `.claude/marathon/<run-id>/` — committed to git, not `/tmp`:

```
kickoff.md            done-means / may-decide / ask-before / never
finish-line.json      typed gate lines + tolerance (human edits this)
status.md             header (state, budget, allowance, gate score) + one row per stream
checklist.md          human-only jobs as checkboxes; owner=human lines mirrored here
rules.md              standing rules (seeded with the doc's: never weaken an assertion,
                      never build against the owner's port, fix the shared helper first…)
reviews/<stream>-r<N>.md   generated from findings rows, never retyped
store/*.jsonl         runs, reviews, findings, helpers, compactions, promotions, measurements
page.html             optional render of gate + ledger + streams
wake.log              fallback cron output
```

**Config** `.claude/marathon.json` (project-level, installer writes defaults if absent):

```json
{
  "ceiling_pct": 70,
  "run_token_budget": 20000000,
  "helper_budget": { "default": 150000, "max": 200000 },
  "max_concurrent_builders": 3,
  "models": { "build": "sonnet", "review": "opus", "routine": "haiku" },
  "streams": { "isolation": "worktree" },
  "review": {
    "backend": "agent",
    "scope": "diff-since-clean",
    "reviewers_per_round": 1,
    "categories": ["correctness","security","accessibility","performance",
                   "facts","test-quality","process","docs","other"]
  },
  "bc": { "prune_below_pct": 50, "clear_above_pct": 80,
          "context_window": 1000000, "push": false },
  "paths": { "runs": ".claude/marathon", "memory": "docs/solutions" }
}
```

**Library** `src/lib/marathon/` (ES modules, zero deps; installer copies the directory to
`.claude/helpers/marathon/` so target projects need no package):

| Module | Responsibility |
|--------|----------------|
| `store.js` | append/read JSONL rows; per-run paths |
| `gate.js` | evaluate `finish-line.json` against the store/checklist/measurements → `{failing, waitingOnHuman, buildGateMet, gateMet, lines[]}`; a line with `value: null` is shown, not counted; a missing check is **not** a pass |
| `streak.js` | green-run streak, clean-review streak, severity counts |
| `budget.js` | `canFanOut()` → `{ok, reason}`; helper budget rows; over-budget flags |
| `status.js` | render `status.md` from config + store + gate |
| `findings.js` | normalise rows, category validation, seen-twice detection → promotion candidates |
| `reviewer.js` | render the reviewer brief (severity definitions, this round's angle, diff since last clean commit); `ingestFindings(rows, {found_by})` so a scanner backend can feed rows later |
| `context.js` | context size from a transcript (last assistant `usage`: input + cache read + cache creation) → pct of `context_window` |
| `keeplist.js` | generate the `/compact` keep-list: kickoff, open stream rows, open finding ids, rules, last commit, running tasks — never finished streams, never file contents |
| `resume.js` | the one-line resume prompt (+ active stream/phase/skill to reload) |
| `wake.js` | in-session cron spec + launchd/crontab fallback line |
| `page.js` | zero-dep HTML render of gate + ledger + streams |
| `cli.js` | `node .claude/helpers/marathon/cli.js <verb>`: `init, status, gate, budget, record, promote, handoff, resume, keeplist, context, wake, page` |

**Reviewer kit** (templates installed to `.claude/marathon/reviewer/`):
- `severity.md` — written definitions of high / medium / low; "neither inflate nor deflate".
- `angles.md` — rotation: one input method at a time · failure conditions · older
  environments · the three safety probes · accessibility · facts/content · performance;
  "confirm the fixes" is never a round on its own.
- Diff-only scope: each review row stores the commit it covered; the next brief is
  `git diff <last_clean_commit>..HEAD`.
- One reviewer per round on the `review` model; findings return as JSON rows
  `{severity, category, file, line, title, detail, fix_hint, found_by}`; the markdown
  write-up is generated from the rows.
- `found_by` ∈ `test | reviewer | scanner | owner`; `owner` rows are escapes and
  counted per stream in `status.md`.
- `review.backend` is a config string; only `"agent"` is implemented in this run. The
  seam (`found_by: scanner`, `ingestFindings`) exists so `/bbs` can absorb a scanner-first
  backend later without touching the gate or the store.

**Hooks** (installed to `.claude/hooks/`, registered in `settings.json` idempotently):
- `marathon-precompact.sh` — `PreCompact` (manual and auto): reads the hook JSON from
  stdin, runs `cli.js handoff --trigger <t> --transcript <p>`; stamps `status.md` with
  time, branch, commit, uncommitted files, running tasks; appends `compactions.jsonl`.
  Always exits 0 — never blocks a compaction.
- `marathon-session-start.sh` — `SessionStart` matcher `compact`: prints the resume line
  + the active stream's status row; prints nothing when no run is active.

**Installer** `src/plugins/marathon.js`: copies the lib to helpers, writes the hooks,
reviewer kit, default `marathon.json`, `.claude/marathon/.gitkeep`; merges hooks;
`isInstalled` / `uninstall`. `check` and `init` call `checkShadowing()` and print the
colliding `~/.claude/commands/*.md` names with the fix.

**Also in A:** `README.md` + `WORKFLOW-SHORTCUTS.md` sections; `fast-check` devDependency
for property tests; version → 4.3.0.

### Slice B — /bc redesign + /bcp (this run)

`w-background-compound.md` protocol becomes:
1. Background write-up on `sonnet` (lessons, solution note, ralph candidates). Commits.
   **Never pushes** unless `--push`.
2. Lead writes the handoff in the foreground: status rows of every stream, new standing
   rules, durable facts to memory. Commits.
3. Lead runs `cli.js context` → size and pct.
4. Decision by `bc.prune_below_pct` / `bc.clear_above_pct`: under → one line "no prune";
   between → print the ready-to-run `/compact` line from `cli.js keeplist`; over, or the
   stream just finished → recommend `/clear` + print `cli.js resume`.
5. `cli.js record compaction --trigger bc --decision <d>`.
6. Aliases: `bc.md` → skill with no push; `bcp.md` → same skill with `--push`.

Works without a marathon run (status file optional); with one, uses the active run's paths.

### Slice C — /bbs (follow-up, built by the first /w-marathon run)

Finish line: "`/bbs` shipped in the suite." Streams, each a 5-check finish line
(`tests_green`, `egress_zero`, `six_sigma_claim`, `callers_ge_1`, `packaged_check`):
intake + source identity · fetch (GET-only, private-host refusal, 25 links / 20 MB) ·
inventory (≤ 12 powers, JSON only) · harness map + IDF-cosine match · verdict gate
(`legalVerdicts`, licence policy, "use" only with a sandbox present — none on macOS
without Docker, so `use` is removed with a reason) · hand-off to a marathon run.
First candidate source: OpenQodex (Apache-2.0 → `use` legal).

### Out of scope

- A UI for editing `finish-line.json` (the file is the editor).
- SQLite export (follow-up if anyone asks).
- Cloud / routine-based wake-ups.
- Dollar costing (tokens only, as the doc concluded).

## OpenQodex assessment

Open-source (Apache-2.0) AI code review for Claude Code: pinned scanners (semgrep,
gitleaks, osv, oxlint, …) on changed lines, then a **separate `claude -p` reviewer** on
a frozen copy of the diff with read-only tools and none of your hooks/settings, structured
`report.json` / SARIF, and "Review incomplete" (exit 2) if any stage or changed line was
skipped. It is, almost line for line, the reviewer the doc asks for: diff-scoped, fresh
context, structured findings, scripted completeness check.

**Would it help?** Probably, as a scanner-first reviewer backend:
- Scanners turn mechanical categories (secrets, deps, lint, SAST) into zero-model-token
  findings — the flywheel's "class seen twice becomes a scan" out of the box.
- Its reviewer is a fresh context by construction (no self-preference).
- `report.json` looks like it maps onto our findings rows (schema not yet read).

**Decision: leave it to `/bbs`.** Under the `/bbs` rules, "use" is legal only for a
permissive licence *and* a safety check that finds no hidden network call. OpenQodex is
Apache-2.0 but talks to the semgrep registry, osv.dev (dependency names), GitHub releases
and npmjs (daily version check) — exactly what the verdict gate exists to weigh. It also
needs Node 22 (suite says ≥ 20), ~700 MB of scanners on first run and `claude` on PATH,
and is pre-1.0. Absorbing it now would bypass the gate; so Slice A ships only the seam and
OpenQodex is the first source the dogfood `/bbs` run audits.

## Files to create / modify

**Create**
- `src/lib/marathon/{store,gate,streak,budget,status,findings,reviewer,context,keeplist,resume,wake,page,cli}.js`
- `src/plugins/marathon.js`
- `src/templates/marathon/{marathon.json,marathon-precompact.sh,marathon-session-start.sh,reviewer/severity.md,reviewer/angles.md,rules.md}`
- `test/marathon-{store,gate,budget,findings,reviewer,context,keeplist,resume,wake,page,plugin}.test.js`
- `test/w-marathon-command.test.js`, `test/bc-redesign.test.js`
- `docs/solutions/ideas/marathon.md` (compound)
- `.claude/commands/.shortcuts/{w-marathon,mt,bcp}.md` (generated by install)

**Modify**
- `src/plugins/dot-shortcuts.js` — add `w-marathon`, `mt`, `bcp`; rewrite `w-background-compound`; `bc` alias text
- `src/installer.js` — install marathon plugin; shadow check in `install()` and `check()`
- `src/utils/settings.js` — `mergeHooks()` (idempotent array merge)
- `src/utils/shortcuts.js` — WORKFLOW-SHORTCUTS.md sections
- `bin/cli.js` — print shadow warnings in `init` / `check`
- `README.md`, `package.json` (4.3.0, `fast-check` devDependency), `.gitignore` (`.claude/marathon/*/wake.log`)

## Baseline

`npm test` before this work: 346 pass / 4 fail / 15 cancelled — every failure is the PM
module needing `better-sqlite3` (not installed here). Those stay as they are.

---

## Plan (Checkpoint 2)

### Architecture

1. **Zero-dep library, copied verbatim.** `src/lib/marathon/` is pure ES modules over a run
   directory; `cli.js` is the only entry that does process I/O. The installer copies the
   directory to `.claude/helpers/marathon/` (same pattern as `terminal-agents-mcp.js`), so a
   target project needs no package. Tests import `src/lib/marathon/*` directly.
2. **Store is truth, `status.md` is a view.** Humans edit `finish-line.json` and
   `checklist.md`; everything else in the run dir is appended (JSONL) or rendered
   (`status.md`, `reviews/*.md`, `page.html`). Nothing the model "remembers" is load-bearing.
3. **Scripts decide, the model acts.** Every judgment the doc measured as unreliable in a
   model (counting findings, streaks, budget arithmetic, context size, keep-lists) is a
   `cli.js` verb with a JSON result and an exit code. The command protocol names the exact
   verb at each step and forbids computing those values by hand.
4. **Two hook wrappers + idempotent registration.** `marathon-precompact.sh` and
   `marathon-session-start.sh` each call one `cli.js` verb. A new `mergeHooks()` in
   `settings.js` appends a hook entry only when its command string is absent, so `update`
   never duplicates.
5. **Commands stay in `dot-shortcuts.js`.** `w-marathon`, `mt`, `bcp` are added to
   `getCommands()`; `w-background-compound` is rewritten in place (Model Policy section kept
   for the existing tests); `bc` text updated. `installer.js` gains the marathon plugin in
   the plugin loop and `checkShadowing()` in `install()` and `check()`.

### Gate vocabulary (kept deliberately small)

`finish-line.json` lines reference sources from a fixed list, not an expression language:

| `source` | Meaning |
|---|---|
| `runs.streak:<kind>` | consecutive green runs of kind `unit` / `e2e` / `build` |
| `reviews.streak` | consecutive reviews within tolerance |
| `reviews.latest.<sev>` | count of `high` / `medium` / `low` in the latest review |
| `findings.open:<sev>` | open findings of a severity |
| `helpers.over_budget` | helpers that exceeded their stated budget |
| `checklist:<id>` | a checkbox in `checklist.md` (owner = human) |
| `measure:<id>` | latest value recorded with `cli.js record measure <id> <value>` |

Line shape: `{id, label, type: bool|number|percent, op: is|at_least|at_most, value, owner: build|human, source}`.
`value: null` → shown, not counted. Unknown source or missing data → **failing**, never pass.

### `cli.js` verbs

| Verb | In → Out |
|---|---|
| `init <slug> [--isolation worktree\|folder]` | creates the run dir from templates, writes `status.md` |
| `status [--run]` | renders `status.md`; prints it |
| `gate [--json]` | `{failing, waitingOnHuman, buildGateMet, gateMet, lines}`; exit 0 met / 1 not met |
| `budget [--usage-pct N] [--helper-budget N]` | `{ok, reason, spent, remaining, usage_pct}`; **exit 2 = stop** |
| `record run\|review\|finding\|helper\|helper-done\|measure\|compaction\|escape …` | appends one row; re-renders `status.md` |
| `promote <category> --kind test\|scan\|fixture\|rule --ref <path>` | appends `promotions.jsonl` |
| `seen-twice` | lists promotion candidates (category seen in ≥ 2 reviews, not yet promoted) |
| `review-brief --stream <s>` | prints the reviewer brief: severity defs, this round's angle, `git diff <last_clean>..HEAD` |
| `review-writeup --review <id>` | renders `reviews/<stream>-r<N>.md` from rows |
| `handoff --trigger <t> [--transcript <p>]` | stamps `status.md`, appends `compactions.jsonl` (hook) |
| `resume [--plain]` | the resume line (+ active stream row unless `--plain`) |
| `keeplist` | the ready-to-run `/compact …` line |
| `context --transcript <p> [--window N]` | `{tokens, pct, decision}` from the last assistant `usage` (input + cache_creation + cache_read) |
| `wake --cron\|--fallback` | in-session cron JSON, or crontab + launchd snippet running `claude -p "$(cli.js resume --plain)"` |
| `page` | writes `page.html` |
| `shadow-check` | lists `~/.claude/commands/*.md` that collide with suite command names |

### Run-id and stream shape

Run id `YYYY-MM-DD-<slug>` (sortable; same shape as `/bbs` run ids). `status.md` header:
`state · budget spent/limit · allowance pct or unknown · gate score (passes/needed) · escapes`.
Stream row: `name · isolation path · plan file · state (queued|active|blocked|done) · phase/skill
if mid-run · next step · background task ids · escapes`.

### Files

**Create**
```
src/lib/marathon/store.js        src/lib/marathon/gate.js        src/lib/marathon/streak.js
src/lib/marathon/budget.js       src/lib/marathon/status.js      src/lib/marathon/findings.js
src/lib/marathon/reviewer.js     src/lib/marathon/context.js     src/lib/marathon/keeplist.js
src/lib/marathon/resume.js       src/lib/marathon/wake.js        src/lib/marathon/page.js
src/lib/marathon/shadow.js       src/lib/marathon/config.js      src/lib/marathon/cli.js
src/plugins/marathon.js
src/templates/marathon/marathon.json
src/templates/marathon/marathon-precompact.sh
src/templates/marathon/marathon-session-start.sh
src/templates/marathon/rules.md
src/templates/marathon/reviewer/severity.md
src/templates/marathon/reviewer/angles.md
src/templates/marathon/finish-line.example.json
test/marathon-store.test.js      test/marathon-gate.test.js      test/marathon-budget.test.js
test/marathon-findings.test.js   test/marathon-reviewer.test.js  test/marathon-context.test.js
test/marathon-keeplist.test.js   test/marathon-resume.test.js    test/marathon-wake.test.js
test/marathon-page.test.js       test/marathon-status.test.js    test/marathon-plugin.test.js
test/w-marathon-command.test.js  test/bc-redesign.test.js
docs/solutions/ideas/marathon.md
```

**Modify**
```
src/plugins/dot-shortcuts.js   add w-marathon, mt, bcp; rewrite w-background-compound; bc text
src/installer.js               marathon plugin in installPlugins/check/uninstall; checkShadowing in install() + check()
src/utils/settings.js          mergeHooks(); call from mergeSettings
src/utils/shortcuts.js         "Marathon" section + /bc, /bcp rows
bin/cli.js                     print shadow warnings in init + check; marathon line in check
README.md                      Marathon section, /bc vs /bcp, hooks, shadowing note
package.json                   4.3.0; devDependencies.fast-check
.gitignore                     .claude/marathon/*/wake.log
```

### Test strategy

- Unit tests per module in temp dirs (`os.tmpdir()`), `node:test` + `node:assert/strict`.
- Property tests (fast-check) where an invariant exists:
  - **gate:** a line with missing data never passes; `value: null` never changes the verdict;
    `gateMet ⇒ buildGateMet`.
  - **budget:** `ok` is never true when `spent ≥ budget` or `usage_pct ≥ ceiling_pct`.
  - **keeplist:** for any status, no finished stream's name appears; output is one line.
  - **findings:** `seen-twice` is idempotent and never lists a promoted category.
- Plugin test: install twice into a temp dir → hooks registered once; helper files present;
  `shadow-check` with a fake `HOME` reports the collision.
- Command tests: `w-marathon.md` names TaskCreate, the six phases, every `cli.js` verb it
  depends on, the budget stop rule and "never weaken an assertion"; `w-background-compound.md`
  has no unconditional push, documents `--push`; `bcp.md` passes `--push`; Model Policy text
  preserved.

### Dynamic workflow assessment (Checkpoint 2.5)

Not warranted. Fourteen small, well-scoped modules with a failing-test spec each; a single
session with `model: sonnet` subagents for the mechanical module builds covers it without a
fan-out harness. Reviews in Checkpoint 6 run as one `opus` adversarial subagent.

---

## Spec (Checkpoint 3)

### Module contracts

All modules are ES modules under `src/lib/marathon/`, zero runtime deps, pure where possible.
`runDir` is an absolute path to `.claude/marathon/<run-id>/`.

| Module | Exports |
|---|---|
| `config.js` | `DEFAULT_CONFIG`; `loadConfig(projectDir)`; `runsDir(projectDir, cfg)`; `runDir(projectDir, runId, cfg)`; `activeRunId(projectDir, cfg)` (reads `<runs>/ACTIVE`); `setActiveRun(projectDir, runId, cfg)` |
| `store.js` | `TABLES = ['runs','reviews','findings','helpers','compactions','promotions','measurements']`; `append(runDir, table, row)` → row with `id`,`ts`; `readAll(runDir, table)`; `storePath(runDir, table)`; `foldHelpers(rows)` → `Map<id,{budget,tokens,model,stream,done,over_budget}>` (rows carry `event: 'spawn'|'done'`) |
| `streak.js` | `greenStreak(runs, kind)`; `reviewStreak(reviews)`; `latestReview(reviews)`; `openBySeverity(findings)`; `reviewPasses(counts, tolerance)` |
| `gate.js` | `evaluateGate({finishLine, runs, reviews, findings, helpers, measurements, checklist})` → `{lines, failing, waitingOnHuman, buildGateMet, gateMet}`; `resolveSource(source, ctx)` → `{found, value}`; `compare(op, actual, expected)`; `parseChecklist(md)` → `{[id]: bool}` from `- [x] <id> — label` |
| `budget.js` | `canFanOut({config, helpers, usagePct})` → `{ok, reason, spent, remaining, usage_pct}`; `helperBudgetFor(config, requested)`; `overBudget(folded)` |
| `findings.js` | `normalizeFinding(row, config)`; `seenTwice(findings, promotions)` → `[{category, reviews, count}]`; `escapes(findings)` |
| `reviewer.js` | `DEFAULT_ANGLES`; `pickAngle(round, angles)`; `lastCleanCommit(reviews, stream)`; `renderBrief({stream, round, angle, severityMd, diff, tolerance, categories})`; `renderWriteup(review, findings)`; `ingestFindings(rows, meta, config)` |
| `context.js` | `measureTranscript(text)` → `{tokens, input, cache_creation, cache_read, output} \| null`; `contextPct(tokens, window)`; `decide(pct, bcCfg, {streamFinished})` → `'none'\|'compact'\|'clear'` |
| `keeplist.js` | `buildKeepList({runId, kickoffPath, rulesPath, streams, findings, lastCommit, runningTasks})` → one line starting `/compact ` |
| `resume.js` | `resumeLine({runId, runDirRel, activeStream, plain})` → string |
| `wake.js` | `cronSpec({runId, runDirRel, schedule})` → `{schedule, prompt}`; `fallbackSnippets({projectDir, runId, cliRel})` → `{crontab, launchd}` |
| `page.js` | `renderPage({runId, gate, streams, reviews, helpers})` → HTML string |
| `status.js` | `readStreams(runDir)`/`writeStreams(runDir, streams)` (`streams.json`); `setStream(runDir, name, patch)`; `renderStatus({runId, config, gate, budget, streams, escapes, handoff})` → markdown; `stampHandoff(runDir, info)` |
| `shadow.js` | `checkShadowing(commandsDir, names)` → `string[]` of colliding command names |
| `cli.js` | verb dispatch over `process.cwd()`; `--run <id>` or `ACTIVE` |

Hook registration shape merged into `settings.json`:
```json
"hooks": {
  "PreCompact":   [{ "hooks": [{ "type": "command", "command": "bash .claude/hooks/marathon-precompact.sh" }] }],
  "SessionStart": [{ "matcher": "compact", "hooks": [{ "type": "command", "command": "bash .claude/hooks/marathon-session-start.sh" }] }]
}
```

### Acceptance criteria

**Store / config**
1. `append` writes one JSON line per row, adds `id` and ISO `ts` when absent, and `readAll` returns rows in write order; a missing table reads as `[]`.
2. `loadConfig` returns `DEFAULT_CONFIG` when `.claude/marathon.json` is absent and deep-merges it when present (`ceiling_pct` override keeps `models.*`).
3. `foldHelpers` pairs `spawn`/`done` rows by id and flags `over_budget` when `tokens > budget`.

**Gate**
4. A line whose source has no data is **failing** (owner build) or **waitingOnHuman** (owner human) — never met.
5. A line with `value: null` is reported with status `not_counted` and never affects `buildGateMet` or `gateMet`.
6. `buildGateMet` is true iff every counted owner=build line is met; `gateMet` is true iff every counted line is met; therefore `gateMet ⇒ buildGateMet` for every input.
7. `op` semantics: `at_least` ⇒ `actual ≥ value`; `at_most` ⇒ `actual ≤ value`; `is` ⇒ `actual === value`; `percent` lines compare numerically like `number`.
8. Every source in the vocabulary resolves: `runs.streak:<kind>`, `reviews.streak`, `reviews.latest.<sev>`, `findings.open:<sev>`, `helpers.over_budget`, `checklist:<id>`, `measure:<id>`; an unknown source yields `found: false`.
9. `parseChecklist` reads `- [x] id — label` as true and `- [ ] id — label` as false; ignores other lines.

**Budget**
10. `canFanOut` is `ok: false` whenever `usagePct ≥ ceiling_pct` or `spent ≥ run_token_budget`, where `spent` = actual tokens of done helpers + stated budgets of in-flight helpers; `reason` names which limit hit.
11. With `usagePct` null/undefined, only the token budget is enforced and `usage_pct` is reported `null`.
12. `helperBudgetFor` clamps to `helper_budget.max` and defaults to `helper_budget.default`.

**Findings / reviewer**
13. `normalizeFinding` lower-cases severity, rejects anything outside `high|medium|low` (throws), maps an unknown category to `other`, defaults `status: 'open'`, `found_by: 'reviewer'`, and derives `area` from the file's first path segment.
14. `seenTwice` lists a category only when it appears in ≥ 2 distinct `review_id`s and no promotion for that category exists; calling it twice on the same input gives the same result.
15. `escapes` returns exactly the findings with `found_by: 'owner'`.
16. `pickAngle(round)` rotates through the angle list and never returns `confirm-the-fixes`.
17. `lastCleanCommit` returns the `commit` of the most recent `pass: true` review for the stream, else null.
18. `renderBrief` includes the severity definitions, the angle, the tolerance, the category list, the diff, and the instruction to return JSON rows only.
19. `renderWriteup` lists every finding row (count in heading equals rows length) grouped by severity.

**Context / keep-list / resume / wake**
20. `measureTranscript` returns `input + cache_creation + cache_read` of the **last** assistant record with `usage`; returns null when none.
21. `decide` returns `none` below `prune_below_pct`, `compact` between, `clear` at/above `clear_above_pct` or when `streamFinished`.
22. `buildKeepList` is a single line starting with `/compact`, names the kickoff and rules paths, the last commit, running task ids, open finding ids, and every stream whose state ≠ `done`; it never contains a `done` stream's name and never contains a newline.
23. `resumeLine` names the run's kickoff, status, rules and the active stream; when `phase`/`skill` are set it says to reload that skill and continue from that phase; `plain: true` omits the status row.
24. `cronSpec` defaults to `17,47 * * * *` and its prompt tells Claude to read `status.md`, take the next step, and stop if no stream is active; `fallbackSnippets.crontab` contains `claude -p` and the project dir; `.launchd` is a plist with the same command.

**Status / page**
25. `renderStatus` header shows state, spent/limit, allowance pct or `unknown`, gate score, escapes; one table row per stream with name, isolation path, state, phase/skill, next step, task ids.
26. `stampHandoff` records time, branch, commit, uncommitted count, running tasks in `streams.json` and the rendered header.
27. `renderPage` is a full HTML document (`<!doctype html>`, `<title>`), lists every gate line with its status and every stream, and has light/dark CSS.

**Shadowing**
28. `checkShadowing(dir, names)` returns the names whose `<name>.md` exists in `dir`, in input order; a missing dir returns `[]`.

**Plugin / installer**
29. `marathon.install(claudeDir)` writes `helpers/marathon/*.js` (every lib module), `hooks/marathon-precompact.sh` and `hooks/marathon-session-start.sh` (mode 755), `marathon.json` (only if absent), `marathon/reviewer/severity.md`, `marathon/reviewer/angles.md`, `marathon/rules.md`, `marathon/.gitkeep`.
30. `mergeSettings` registers the two hook entries; a second `install()` leaves exactly one of each.
31. `DaniZeeSuiteInstaller.install()` installs marathon by default, returns `shadowing: string[]` (computed from `options.homeDir ?? os.homedir()`), and `check()` reports `plugins.marathon`.
32. `uninstall()` removes helpers/marathon, the two hooks and the hook entries; it leaves `.claude/marathon/<runs>` (user data) alone.
33. `dot-shortcuts` installs `w-marathon.md`, `mt.md`, `bcp.md` alongside the existing files.

**Commands**
34. `w-marathon.md`: header `# /w-marathon`; TaskCreate first action; phases Search, Interview, Kickoff, Arm, Loop, Stop, Compound; the four kickoff lines; "Nothing, go"; names `cli.js budget`, `gate`, `record`, `status`, `wake`, `resume`, `seen-twice`, `review-brief`, `review-writeup`, `promote`; the rule that a non-zero `budget` exit stops every spawn; `waitingOnHuman` listed once and never retried; "never weaken an assertion"; `--resume` and `--status`; model roles sonnet/opus/haiku; no `TodoWrite`.
35. `mt.md` invokes `.shortcuts:w-marathon` verbatim-args, like `pt.md` does.
36. `w-background-compound.md`: keeps the Model Policy section; write-up phase commits and **never pushes unless `--push`**; adds handoff, `cli.js context`, the three-way decision using `prune_below_pct`/`clear_above_pct` with `cli.js keeplist` and `cli.js resume`, and `cli.js record compaction`; works when no marathon run is active.
37. `bc.md` aliases `w-background-compound` without `--push`; `bcp.md` aliases it **with** `--push` and says "push".
38. `WORKFLOW-SHORTCUTS.md` gains a Marathon section and `/bc` vs `/bcp` rows; README documents the command, the run dir, the config, the hooks, `/bcp`, and the shadowing warning.
39. `package.json` version is `4.3.0`; `fast-check` is a devDependency; `npm test` baseline failures (PM/better-sqlite3) are unchanged and nothing else fails.

### Test cases

| # | File | Covers |
|---|------|--------|
| T1–T3 | `test/marathon-store.test.js` | AC 1–3 (+ config load/merge) |
| T4–T9 | `test/marathon-gate.test.js` | AC 4–9; **property**: missing data never met; null never counted; `gateMet ⇒ buildGateMet` |
| T10–T12 | `test/marathon-budget.test.js` | AC 10–12; **property**: never ok past either limit |
| T13–T19 | `test/marathon-findings.test.js`, `test/marathon-reviewer.test.js` | AC 13–19; **property**: seenTwice idempotent, never lists promoted |
| T20–T21 | `test/marathon-context.test.js` | AC 20–21 (fixture = real transcript shape) |
| T22 | `test/marathon-keeplist.test.js` | AC 22; **property**: no done stream, no newline |
| T23 | `test/marathon-resume.test.js` | AC 23 |
| T24 | `test/marathon-wake.test.js` | AC 24 |
| T25–T27 | `test/marathon-status.test.js`, `test/marathon-page.test.js` | AC 25–27 |
| T28 | `test/marathon-plugin.test.js` | AC 28–33 (temp dir installs, double-install idempotence, fake HOME) |
| T34–T35 | `test/w-marathon-command.test.js` | AC 34–35 |
| T36–T39 | `test/bc-redesign.test.js` | AC 36–39 (package.json version, shortcuts section, README) |

---

## Addendum (mid-build, 2026-10-07): haiku-first routing and RuVector

**Decision 16 — model routing as speed × probability (added to Slice A).** With a contract and
failing tests written first, the test run is a near-free error detector, so a cheap builder's miss
costs one retry on the next tier — not a 100–200k-token review round. Break-even for haiku-first
on a scoped step is roughly a 70% test-failure rate. Errors compound only when a cheap output feeds
the next step unchecked; the loop forbids that (nothing moves on until its tests are green).

- `models`: `build_scoped: haiku` · `build: sonnet` · `build_hard: opus` · `review: opus` ·
  `routine: haiku` · `ladder: [haiku, sonnet, opus, session]`; `routing: { scoped_max_files: 3,
  hard_categories: [security, migration] }`.
- `routing.js`: `classifyBuild(signals, config)` → scoped | default | hard (structural,
  deterministic, no model); `modelFor`; `nextTier` (exactly one up, null at the top);
  `modelStats(rows)` → per model: spawned, done, green/red/escalated, tokens mean, first-pass
  green rate, tokens per green (null, not 0, when unmeasured).
- Ledger: `record helper … model= role= escalated_from=`; `record helper-done … outcome=green|red|escalated`.
- `cli.js route` and `cli.js model-stats`; `/w-marathon` 4.3 routes every builder, escalates one
  tier up on red tests **before any review is spent**, prints `model-stats` per stream.
- Tiers, never versions (existing test forbids naming premium models): a new release in a tier
  — e.g. a new Haiku — is picked up automatically.
- RC-A candidate: KPI = tokens per green step per model; benchmark = `cli.js model-stats`.

**RuVector `@ruvector/typesafe` (MIT) — assessed, not adopted now.** It turns text into typed
`choice`/`score` decisions with local embeddings and decision heads, with confidence and
abstention (77–84% accuracy, 4–10 ms p95 on its own ticket benchmark; the default embedder is a
test double). Today's routing decision is structural and free — "do failing tests exist?" beats
any classifier — so it adds nothing yet. Where it could help: learning from outcomes which briefs
haiku handles (its "outcome-aware routing"), normalising finding categories for the seen-twice
rule, grading severity from text. All three need the labeled data the ledger starts collecting
now. It is a native/WASM dependency and an outside source, so when there is data it goes through
`/bbs` (MIT → `use` or `rebuild`), behind the `classifyBuild(signals, config)` seam; an abstention
maps to `default`.

---

## Review round 1 (Checkpoint 6) — 2026-10-07

Fresh-context `opus` reviewer on the full change: **over** — 10 high, 12 medium, 9 low. Probes
clean: shell injection (quoting correct), hooks never block, page escaping. Highs, all fixed in
the fix round with regression tests first:

| id | Defect | Fix |
|----|--------|-----|
| f1 | `stream … tasks=[a,b]` stored a string; every renderer crashed | `normalizeTasks` on write and render; `tasks=a,b` accepted |
| f2 | Corrupt/missing `finish-line.json` → empty lines → gate vacuously met | unreadable finish line = not met (exit 1 + error); review grading requires a valid tolerance; empty line set never met |
| f3 | Review without counts / with `pass=true` recorded as clean | `validCounts` required; `pass` rejected; `review-writeup` refuses on counts≠rows; latest-review source unresolved without valid counts |
| f4 | `--usage-pct 85%` → NaN → ceiling off; string tokens concatenated | fail closed on any non-finite usage/tokens/budget (exit 2, reason `invalid`) |
| f5 | Findings never close → `open_high` fails forever | `foldFindings` by id; `record finding-fixed id=` |
| f6 | Streaks spanned all streams | `gate --stream <s>` scopes runs/reviews/findings |
| f7 | `''`/`null` measurements met `at_most` lines | type enforcement: number/percent need a finite number, bool needs a boolean |
| f8 | `/bc` without a run died at keeplist/resume | run-less paths for both; `--if-active` prints nothing without an active stream |
| f9 | Protocol stopped only on exit 2 | "any non-zero exit from `cli.js budget` → do not spawn" |
| f10 | First review saw only `HEAD~1`; commits from the wrong checkout | stream `base` recorded at `state=active`; commits and diffs from the stream's checkout |

Mediums fixed: m1 budget clamp order + integer tokens · m3 usage reading as a timestamped
measurement with `usage_reading_ttl_minutes` (stale → unknown) · m4 `cli.js finish` clears ACTIVE;
hook silent without an active stream · m5 transcript slug `[^a-zA-Z0-9] → -` · m6 fallback sets
PATH, guards with `--if-active || exit 0`, log path from config, documented permission caveat ·
m7 `unmergeHooks` on uninstall · m8 hooks resolve from `$CLAUDE_PROJECT_DIR` · m9 corrupt JSONL
lines skipped and counted · m10 helper CLI in `permissions.allow` · m11 `/bc` lead commits the
handoff before dispatch; agent commits only its own paths · m12 `test/marathon-cli.test.js` +
garbage-generating property tests · m13 `record run` requires kind and status.
Lows fixed: l1 dead `--json`, l2 run-id validation, l3 commit sha validation, l4 missing `files`
→ default, l5 page reuses `foldHelpers`, l6 brief tolerance text, l7 dryRun no mkdir, l8 docs
verb list + `--run`, l9 `process.exitCode`.

Second review (diff-scoped, fresh context) follows the fix round, per the standing rule.

---

## Review round 2 (Checkpoint 6, second pass) — 2026-10-07

Fresh-context `opus` reviewer, failure-conditions angle, verifying round 1: **over** — 8 high,
10 medium, 6 low. Three round-1 highs were only partly closed (f2, f3, f4) and the "skip and
count" fix for corrupt rows (m9) had introduced a fail-open. Per the doc's rule — after two dirty
rounds, change the design — the fix round made one design change instead of patching each case:
**validate at every boundary; fail closed on any store damage.**

| id | Defect | Fix |
|----|--------|-----|
| g1 | counts with missing/miscased/extra keys graded as zeros → pass | `validCounts` requires exactly `{high, medium, low}`, non-negative integers |
| g2 | `buildGateMet` vacuously true with no counted build line (owner typo, human-only line) | `validateFinishLine` schema (owner, op, type, source, value, ids); build gate needs ≥ 1 counted build line |
| g3 | usage ceiling disabled via the measurement path (`95%`, bare flag, bad TTL) | `record measure usage_pct` validated 0–100; latest reading decides and a non-numeric one is `invalid`; bare `--usage-pct` → exit 1; TTL validated |
| g4 | gate met over a store with corrupt rows; JSON hid it | corrupt rows block gate (`corrupt` in JSON, exit 1) and budget (`invalid`); `cli.js repair` quarantines them |
| g5 | `append` after a half-written line glued the next row onto it | newline guard before every append |
| g6 | 2nd review in a streak got an empty diff; git failures → empty brief that passes | diff from the last *over* review's commit, else the stream base; empty diff / git failure → exit 1 |
| g7 | finding without `stream=` invisible to `gate --stream` | inherit stream from the review; refuse with neither; `filterByStream` attributes via `review_id` |
| g8 | `streams.json` read-modify-write lost rows under concurrency | lock file + atomic rename in `setStream` / `stampHandoff` / `writeStreams` |
| g9 | state resolved from cwd → stale copy inside a stream worktree; ACTIVE committed | `resolveProjectDir` via `git rev-parse --git-common-dir`; ACTIVE gitignored by the installer |
| g10 | fallback wake ignored `finish` and a live session | `--if-active` silent when finished or no active stream; `--idle-minutes` guard on `status.md` mtime |
| g11 | missing worktree silently fell back to main | error unless `--cwd` given |
| g12 | exit-code contract text ≠ code | `invalid:` → exit 1, ceiling/budget → exit 2 |
| g13 | `passes_in_a_row` display-only | must agree with the `reviews.streak` line (schema error otherwise) |
| g14 | `gate --stream` rewrote status.md with a scoped verdict | status always from the run-wide gate; scoped verdict only printed |
| g15–g24 | garbage `--helper-budget`, unnamed stream, finding rewrite/downgrade, allow-list replaced on install, unnamed streams.json error, numeric-coerced shas, write-up path, helper event override, stale test title, missing-transcript message | all fixed (`settings.mergeSettings` unions `permissions.allow/deny`; write-up file carries the review id; key-aware coercion) |

Regression net: `test/marathon-cli-round2.test.js` (24 cases incl. 8 concurrent processes and a
worktree round trip) + unit cases g1/g2/g4/g5/g7/g8/g18/g19.

Note on g2: the round-2 test I wrote claimed a human-only finish line could have `gateMet: true`
while `buildGateMet: false`. That contradicts AC6 (`gateMet ⇒ buildGateMet` for every input). The
spec won: a finish line with no counted build line is never "done" — both verdicts false, the human
line itself still reported `met`. Fixed in both `gate.js` and the test.

---

## Review round 3 (Checkpoint 6, third pass) — 2026-10-07

Fresh-context `opus` reviewer, operator's-path angle, verifying g1–g24: **over** — 11 high,
16 medium, 5 low. All round-2 findings confirmed closed except the live-session guard (g10). The
gate-bypass class is gone; this round found the next layer: the human's path through the run.

| id | Defect | Fix |
|----|--------|-----|
| h1 | Run stalls at every stream boundary: no active stream → every wake path silent or a dead end | `resume` names the next queued stream and says `/w-marathon --resume`; `--if-active` speaks while queued work remains; cron prompt activates the next queued stream; protocol activates the next stream before `/bc` |
| h2 | After an over review the clean streak only re-reviewed the fix diff | diff from the last **certified** point (HEAD of the last *completed* clean streak), else the stream base; an over round never narrows |
| h3 | Tolerance keys/values unvalidated — `Medium` made that severity unlimited | `validateFinishLine`: keys ⊆ {high, medium, low, passes_in_a_row}, all three severities present, non-negative integer or explicit null |
| h4 | Value/type incoherence passed via JS coercion (`1 <= true`) | number/percent lines need a numeric value and at_least/at_most; bool lines a boolean value and `is` |
| h5 | "Re-record the review" advice counted one round twice | `record review … replaces=<id>` voids the old row (same round); write-ups follow the chain; the advice names it |
| h6 | Ceiling pause expired with the reading's TTL; fallback resumed a PAUSED run | `_meta.paused` persists until a fresh reading below the ceiling or `cli.js unpause`; `--if-active` silent while paused |
| h7 | Nested project resolved state to the enclosing repo root | only a *linked worktree* is redirected (mapped onto the main checkout); a nested project keeps its cwd |
| h8 | 25-minute idle guard shorter than the cron cadence → duplicate headless session | guard 45 min; silent while paused/finished |
| h9 | Documented bare `--helper-budget` exited 1 → no spawn | bare flag returns the configured default |
| h10 | `review-brief` crashed with ENOBUFS over 1 MiB | 64 MB buffer, lock files/generated assets excluded, inline diff capped with `--stat` |
| h11 | Fallback `PATH` missed nvm node and `~/.local/bin/claude` → silently did nothing | absolute `node`/`claude` paths embedded at generation; "claude not found" logged |
| m1–m16, l1–l5 | tolerance change not re-grading (documented: next review), cross-stream status header, needed from the `reviews.streak` line, unknown stream names, `--cwd` honoured / finding-fixed needs no checkout, bare `--stream`, repair/append lock, transcript dir from the launch directory, protocol branches (all-done-but-failing, cron hygiene, commit before review, allowance field, isolate-once), status "Next for you", non-object JSONL rows, write-up filename docs, broader gitignore, `--idle-minutes` validation, init on a finished run | fixed; m1 left as documented behaviour (a tolerance change applies from the next review) |

Regression net: `test/marathon-cli-round3.test.js` (22 cases incl. a nested-repo, a worktree and a
pause/unpause sequence) + round-2 cases adjusted where round 2's expectation was the one at fault.

**Where the bar stands.** Three reviews, each finding real defects of a progressively shallower
class: gate bypass → store/concurrency → operator path. Per the doc's tolerance rule the number of
clean rounds required is the human's to set; the fourth-round decision is Dani's.

---

## Review round 4 (Checkpoint 6, fourth pass) — 2026-10-07

Fresh-context `opus` reviewer, dry run + trust boundary: **over** — 3 high, 9 medium, 5 low.
All 11 round-3 highs and every round-3 medium/low confirmed closed; the protocol dry run
(init → two streams → worktree → reviews → findings → fix → gate → next stream → finish, with
SessionStart and PreCompact fired at six points) survived on files alone. Trend across rounds:
10 → 8 → 11 → 3 highs.

| id | Defect | Fix |
|----|--------|-----|
| k1 | `record review id=… void=…` could rewrite or erase a review (the round-3 fold made it possible) | `id`, `void`, `voided_ts`, `replaced_by` refused from the caller; the ledger has exactly two write paths |
| k2 | replacing an *older* review moved it to the end of the ledger and inflated the streak | `replaces=` applies only to the stream's latest live review |
| k3 | every stream after the first was activated without a worktree (4.2 "only when not active" vs. activation paths) | `stream X state=active` refuses without `isolation=` in worktree mode (`--no-isolation` opts out); every activation instruction (resume line, cron prompt, Next for you, 4.8) includes the worktree step |
| k4/k5 | replacement stamped HEAD-now and the void row was written second | replacement inherits the replaced review's commit; void row first with a pre-generated id |
| k6 | `record review commit=<sha>` still failed on a missing worktree | cwd resolved only when `commit` is absent |
| k7 | changed lock/snapshot files invisible to the reviewer | always listed under "Changed but excluded from the inline diff"; brief names its HEAD sha |
| k8 | done-but-unfinished run: every wake path silent → never reached CHECKPOINT 5 | `--if-active` speaks with the all-done line; cron prompt runs `gate` then `finish`/reopen |
| k9–k17 | rules.md vs protocol on exit 1, stale "last clean review" phrase, vacuous h1/m8 tests, dead `lastCleanCommit`, angles.md rotation note, fix_hint dropped and raw markdown in write-ups, all-blocked reported as done, stale `next` in per-step updates | all fixed |

Regression net: `test/marathon-cli-round4.test.js` (10 cases) + adjusted round-2/3 expectations where
round 4 showed them vacuous. Final: **584 tests, 0 failures.**

**Decision (Dani, 2026-10-07):** run round 4; commit if clean, otherwise fix and ship with the
ledger. Round 4 was over, so this ships with four rounds on record and the first real `/w-marathon`
run (building `/bbs`) as the next test.
