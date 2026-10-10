# Changelog

Versions 4.2.0 and 4.3.0 were set in `package.json` but never published to npm,
so 4.4.0 is the first release after 4.1.0 and carries all three.

## 4.4.0 — 2026-10-10

### Added
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
