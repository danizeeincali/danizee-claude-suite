# BBS stream `handoff` — finish lines, briefs, buy memos, marathon bridge

Memory key: `project/marathon/2026-10-07-bbs/handoff`
Run: marathon `2026-10-07-bbs` (spec `.claude/plans/2026-10-07-w-bbs.md`, "Hand-off")
Merged to local main as `8f1a509`; fix rounds r1-r5 in `0de3813`..`c6743bb`. Not pushed.

## What the stream built

`src/lib/bbs/handoff.js` (777 lines) plus the `handoff` verb in the bbs CLI. Tests: `test/bbs-handoff.test.js`
(976 lines; contract commit `7330fb7`, then +36 regression tests across five fix rounds).

- **Per-power finish lines.** For each `rebuild`/`use` power, five checks: `tests_green_<p>`
  (`runs.streak:unit`), `egress_zero_<p>`, `six_sigma_<p>` (`reviews.streak`), `callers_<p>`,
  `packaged_<p>`. Power ids are slugified; lines are tracked per power (exact ids, not suffix matching).
  They validate against the marathon gate; tolerance comes from `finish-line.example.json` (a
  corrupt file is a loud error; `null` limits are accepted as the gate accepts them).
- **Idea-only briefs** (`briefs/<power>.md`): the idea in our words, provenance, what we have,
  the five checks, the never lines, and the wrapping rule for `use`. Evidence is location-only
  (file:line), with URLs and token-shaped strings redacted. No upstream source code.
- **Buy memos** (`memos/<power>.md`): source ref, run, licence, network, data that would leave. No stream.
  Slug collisions are checked across all approved powers before anything is written.
- **Marathon bridge** (`--marathon`): `init bbs-<run id without date prefix>`, `finish-line.json` with the
  per-power lines plus the standard clean_reviews/latest_high/open_high, `kickoff.md` filled in place
  (init's title, Budget and Models sections kept; one bullet per check with its id; names the bbs run
  and brief paths), queued streams whose `plan` is a project-relative path that resolves. Prints
  `/w-marathon --resume <run-id>`.
- **Safety of the bridge.** `--project <dir>` on every marathon CLI call; the marathon CLI runs async
  (promisified execFile) so the run-lock refresh keeps firing; the whole hand-off runs under the run
  lock; `marathon_cli` must resolve inside the project; `handoff.json` is claimed exclusively
  (partial file removed on a failed fallback write); any failure after init restores ACTIVE and names
  the half-made run dir.
- **Forced refill (`--force`).** Previous stream rows not in the new set are blocked (the marathon CLI
  has no remove verb), not deleted; cleanup removes only files listed in the previous `handoff.json`
  and skips non-regular entries; a previous-day marathon run is blocked too. JSON and status.md carry
  an explaining note per list (`stale_streams`, `removed_files`, `skipped_files`).
- **Refusals** name the cause, the exact command and `--run <bbs run>`; undecided powers (or a
  `powers_ts` mismatch) are refused with the `--decide` command.

## Review ledger

| Round | Commit | Angle | Findings (H/M/L) | Result | Headline |
|---|---|---|---|---|---|
| r1 | d1c0b20 | one input method at a time | 11 (3/6/2) | over | undecided powers vanish; slug from last dash segment only; brief path unresolvable |
| r2 | 0de3813 | failure conditions and error paths | 4 (0/4/0) | over | post-init failures leave ACTIVE moved; stale queued rows on refill; null tolerance refused; no lock |
| r3 | 8775915 | older environments, degraded networks | 5 (0/3/2) | over | linked worktree hits the main checkout's marathon dir; sync exec stops lock refresh; failed init leaves ACTIVE |
| r4 | 12da973 | egress, secrets, sandbox escape | 3 (0/2/1) | pass | evidence URLs/tokens unredacted; cleanup deletes foreign .md; marathon_cli uncontained |
| r5 | fe069a5 | accessibility | 4 (0/1/3) | pass | later-day refill leaves old run's streams pointing at deleted briefs; bare lists; refusals lack commands |

27 findings, all fixed. Gate closed at clean 2/2 (r4, r5). r5 fixes (`fe069a5..c6743bb`) are reviewed in
command-docs r1 via `--base fe069a5`. Promoted rule from this stream: `docs` (with verdict r6): a
docstring is a claim about the code and is checked like one.

All three r1 highs came from the lead's own contract draft, not from the builder: the slug rule
(last dash segment), the brief path (bare relative), and the undecided-powers check (absent from the
contract). r3's worktree finding mattered because this suite's marathon streams ARE git worktrees
(`../claude-suite-<stream>`): the bridge's own habitat exposed it.

## Contract fixes before the build

The lead made two fixes to the draft contract before the builder started: a bare `have` judgment
(a map judgment given as a plain string rather than `{status, tool, why}`) and a missing `verdict`
compute step in the CLI test. Both were errors in the draft, found only when it was run against the
merged main. A contract drafted ahead of the previous stream's close drifts from what that stream
merges; the draft needs a `node --test` pass on the merged main before the stream starts. It still
shipped with three high-severity gaps in r1.

## Builder numbers (`model-stats`, run-wide at close)

| Model | Spawned | Green | Tokens total | Mean | First-pass green |
|---|---|---|---|---|---|
| sonnet | 22 | 20 | 1,891,066 | 94,553 | 100% of done |
| opus | 41 | 41 | 4,490,429 | 109,523 | 100% |
| haiku | 3 | 3 | 415,195 | 138,398 | 100% |

The handoff builder was the third haiku builder: 160,494 tokens against a 150,000 budget (10,494
over), green on first pass (d1c0b20, 511 insertions). Haiku's mean (138k) is above sonnet's (95k)
and opus's (110k), though the haiku sample is 3 and its builds are the larger ones; none went red.
Handoff fixers: opus r1 and r4, sonnet r2, r3 and r5.

## Spend and progress

Run budget at close: 7,096,690 / 10,000,000 tokens; allowance 97% (ceiling 98%, raised by the
owner during verdict r2). Six of seven streams done (intake, fetch, inventory, harness-map,
verdict, handoff); `command-docs` is active (clean 0/2). Escapes: 0. End-to-end finish line: 0 of 6
runs so far (command-docs owns the e2e contract).
