# Changelog

Versions 4.2.0, 4.3.0 and 4.4.0 were set in `package.json` but never published to npm,
so 4.5.0 is the first release after 4.1.0 and carries all four.

## 4.5.0 — 2026-10-16

### Added
- **`/w-marathon-times` (`/mtt`)**: a marathon that stops on the clock instead of a review
  bar. Give it a duration (`5h`, `90m`, `1h30m`) or a clock time with a zone (`12pm PST`,
  `tomorrow 9am ET`); it works a backlog stream by stream until the wrap-up point (the last 10%,
  10 to 60 minutes), then finishes the step in hand, writes `wrap-up.md`, runs `/bc` and finishes.
  A stream is done when its last unit run is green, it has had one review and no high finding
  is open.
- **`/w-bug-hunt` (`/bh`)**: a time-boxed bug hunt on the timed marathon. Each round is a
  Workflow of read-only hunters (one per angle) with a separate verifier per claim; a bug counts
  only when a test fails twice the same way (replay gate), anything else is a lead. Proved bugs
  are fixed while time allows (`--report-only` skips fixes), each area gets one review, and the
  run ends with `bug-hunt-report.md`.
- Marathon CLI: `deadline parse|set|check` (exit 2 at the wrap-up point), `init --mode timed
  --command <w-marathon-times|w-bug-hunt>`, the `reviews.count` finish-line source, a deadline
  line in `status.md`, and resume lines and wake-up prompts that name the run's own command and
  send a session past the deadline to the wrap-up. New `timed` block in `marathon.json`
  (wrap-up reserve, default time zone).
- **Most-used commands** at the top of the README: `/mt`, `/pt`, `/bbs`, `/bcp` and `/bc`
  with their long forms and what each does.
- **Review kit** (`node .claude/helpers/kit/cli.js <verb>`): 24 zero-dependency verbs
  rebuilt from two `/w-bbs` runs (OpenQodex and bugpatrol). Among them: `scrub` (tracked-file
  secret gate), `redact` (by value and fingerprint), `safe-git` (read-only git on an untrusted
  repository), `guarded-write`, `graph`, `callers` and `impact` (a cached symbol graph and a
  change's blast radius, reported as a floor when it cannot see everything), `test-plan`,
  `lenses`, `review-score` and the optional sealed `wording-judge`, `push-gate`,
  `replay-gate`, `threshold-route`, `noise-ledger`, `triage`, `cluster`, `reflect`,
  `shared-budget`, `render` (SARIF, JUnit, PR comment), `exit-codes`, `doctor` and
  `diff-range`.
- The kit is wired into `/pt`, `/mt`, `/bc`, `/bcp`, `/w-bbs`, `/w-review`, `/w-bg-review`,
  `/w-fix`, `/w-debug` and 14 more workflows, and into `danizee-claude-suite check`, which
  now runs the doctor preflight (`--profile kit|marathon|bbs|review`).
- **Optional SQLite index** (`kit db init|off|status|rebuild|prune|import-reports`): a
  per-user, rebuildable write-through index of the kit's JSON state, kept outside the project
  in `~/.claude/kit-db/`. The JSON files stay the only source of truth. Uses better-sqlite3
  from the suite package, else `node:sqlite` (Node 22.13+).
- **`/w-bbs` integration**: a power can land on any surface a user meets (UI, API, job,
  model, CLI, feature flag, library or workflow). The verdict records where each power lands
  and the hand-off adds a gated `integration` stream; a target counts as wired only when the
  surface uses the power and a reach test through that surface passes.
- CI uploads JUnit and SARIF test results as artifacts and prints failing tests at the end
  of the job log.

### Changed
- `/w-marathon` scopes the helper allowance per run and stream with a per-review claim
  budget; `/w-review` has a fail-closed replay gate. `npm test` and CI run the reach tests.
- Workflow shortcut copies are regenerated from the generator (`src/plugins/dot-shortcuts.js`),
  so `.claude/commands/.shortcuts/` equals its output.
- `/w-bbs` fetch clones source files only: commit and trees first, then just the blobs of
  code and prose files. Media, fonts, archives, binaries, minified bundles and lockfiles
  stay on the server, so a large repository fits the 20 MB egress cap (a 278 MB repository
  came down as 4.7 MB). HEAD is read through the hardened reader before anything is
  written; the egress row records `files_kept` and `files_skipped`.

## 4.4.0 — 2026-10-10 (unpublished)

### Added
- `init` and `update` set `subagentPromptCacheTtl: "1h"` in `.claude/settings.json`,
  so subagents keep a one-hour prompt cache like the main conversation. A value the
  project already set is kept.
- **`/w-bbs` and `/bbs`**: study another project's harness and decide, power by
  power, what to borrow, build or skip. Verbs for intake, fetch (GET-only with a
  host policy and egress log, hardened shallow clone), inventory, harness map
  (IDF-weighted matching against your own index), verdict (licence classes,
  sandbox gate, probes, decisions registry) and handoff (per-power finish lines,
  idea-only briefs, buy memos, and a bridge into a `/w-marathon` run). Installed
  by the new bbs plugin with an uninstall manifest and an e2e packaged check.
- **`/bc` compaction support without a marathon run**: `.claude/bc.json` names
  a project's status, kickoff, rules, memory and results files. New helper
  `.claude/helpers/bc/cli.js` (config, context, keeplist, resume, handoff,
  record), plus PreCompact and SessionStart(compact) hooks that stamp the status
  file and print the resume line. Both step aside for the marathon hooks during
  a run.
- **`danizee-claude-suite install-user`** ships `/bc`, `/bcp`,
  `/w-background-compound`, the bc helper and its hooks once into `~/.claude`;
  it refuses to replace a user's own `/bc` without `--force`.
- **`/w-marathon` finish-line scope**: a finish-line line can be scoped to the
  run, so it is judged only by the run-wide gate and reported as `run_scoped`
  per stream.

### Changed
- The shadowing check no longer flags the suite's own user-level `/bc` copy.
- `/w-background-compound` calls the bc helper for context, keep-list, resume
  and record.

## 4.3.0 — 2026-10-07 (unpublished)

### Added
- **`/w-marathon` and `/mt`**: finish-line runs that keep Claude working for
  days. One interview, then a kickoff the owner holds, a schema-checked
  `finish-line.json`, an owner checklist and rules. A zero-dependency helper
  (`.claude/helpers/marathon/`) with gate, budget, review, stream, routing,
  resume, keep-list and wake verbs that fail closed.
- **`/bcp`**: the owner's go to push and merge after a `/bc` handoff.
- Haiku-first model routing for scoped builds, escalating one tier on red tests.
- `fast-check` as a dev dependency for property tests.

### Changed
- **`/bc` redesign**: the lead commits the handoff first, the background
  write-up commits only its own paths and never pushes, and context is measured
  from the transcript to choose nothing, a `/compact` keep-list, or `/clear`
  plus a resume line.

## 4.2.0 — 2026-06-10 (unpublished)

### Added
- Per-step model policy in `/w-plan-tdd-swarm` and `/w-background-compound`,
  with an escalation ladder on detectable failure.
- Dynamic workflows (human-gated) and a Checkpoint 2.5 assessment.
- Property-based testing guidance in the tests gate.
- `/pt` and `/bc` aliases.

### Fixed
- Double-escaped backticks in the two touched templates; installed copies are
  now regenerated from the source template and sync-locked by a test.

## 4.1.0 and earlier

See the git history.
