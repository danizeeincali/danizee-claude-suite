---
memory_key: project/marathon/2026-10-07-bbs/command-docs
date: 2026-10-09
run: 2026-10-07-bbs
stream: command-docs
---

# /w-bbs, stream command-docs: installer, command, docs, packaged check

Last of seven streams in the first marathon run. Closed after 3 reviews (r2, r3 clean), 17 findings
fixed, 0 escapes. Merged into local `main`, not pushed.

## What shipped

- **Plugin installer** `src/plugins/bbs.js` (131 lines): copies the bbs library to
  `.claude/helpers/bbs/`, and the marathon modules `handoff.js` imports to `.claude/helpers/marathon/`.
  `cli.js` of marathon is left out on purpose: its presence marks the marathon plugin as installed.
  A manifest in `helpers/bbs/` lists the marathon modules bbs wrote; it is written first with the
  planned list, uninstall removes exactly those when marathon's `cli.js` is absent, an unreadable
  manifest warns on stderr and is rewritten, and modules the manifest lists are repaired in place.
- **Installer wiring** `src/installer.js` (+14), `src/utils/settings.js`, `src/utils/shortcuts.js`,
  `src/plugins/dot-shortcuts.js`: install, uninstall, `check` status (`plugins.bbs`), a permission
  entry for `.claude/helpers/bbs/cli.js`, and the `bbs` plugin name in the plugin list.
- **Command** `.claude/commands/.shortcuts/w-bbs.md` plus the `/bbs` alias: six checkpoints
  (0 intake, 1 fetch, 2 inventory, 3 map, 4 verdict, 5 hand-off). One approval (an AskUserQuestion
  at checkpoint 4). Every number, identity and verdict comes from a `cli.js` verb.
- **Docs**: `WORKFLOW-SHORTCUTS.md` (command row + a `/w-bbs` section, +31) and `README.md`
  (+60: sandbox conditions, CLI output shapes, gitignore rules). `.gitignore` +6 for run folders.
- **`check` printout**: `bin/cli.js` prints a BBS helpers line beside the Marathon one.
- **Dogfooding**: the suite repo now commits `.claude/helpers/bbs/` (cli, config, fetch, handoff,
  harness-map, intake, inventory, status, store, verdict) the way it commits marathon's.
- **E2E packaged check** `test/bbs-e2e.test.js` (175 lines): installs into a temp dir and runs the
  installed copy against `test/fixtures/bbs/sample-source` through every verb. Run-wide line
  "installed CLI runs the fixture source end to end" is met. Also `test/bbs-plugin.test.js` (284),
  `test/w-bbs-command.test.js` (207), `test/bbs-docs.test.js` (108).
- Range handoff..command-docs: 68 files, +7,384 / -19. Commits: contracts 2664d95, build 2e409ab,
  fixes bfed2cf, 4e8fea5, a297d74 (14 + 8 + 3 regression tests).

## Review ledger

| Round | Angle | H/M/L | Result | Tokens | Reviewed |
|---|---|---|---|---|---|
| r1 | one input method at a time | 0/4/5 | over | 167,908 | 2e409ab |
| r2 | failure conditions and error paths | 0/2/3 | pass | 114,028 | bfed2cf |
| r3 | older environments and degraded networks | 0/1/2 | pass | 127,311 | 4e8fea5 |

Headline findings:

- **r1, known-source path crashed**: `known: true` at intake jumped to CHECKPOINT 5, but intake does
  not copy powers/verdicts, so hand-off exited 1 on the empty run; repo/url identity is only known
  after fetch. Fix: print `report` and `status` of `reuse_from`, say nothing is re-audited, stop;
  same check after fetch; e2e test follows the documented path.
- **r1, `--run` on resume**: `--resume <run-id>` ran checkpoint verbs against the ACTIVE run. Fix:
  append `--run <run-id>` to every verb.
- **r1, one-question rule**: "Change some verdicts" forced a second question or a guess. Fix: the
  single question carries `<power>=<verdict>` pairs; the decisions JSON shape is stated.
- **r1, repo did not carry its own helpers**: `/w-bbs` would fail at its first verb in the suite
  repo. Fix: commit `.claude/helpers/bbs/` and the gitignore rules.
- **r2, routing around a refusal**: after an illegal-verdict exit 2 the text said "fix the file,
  rerun", i.e. the lead would pick a verdict the owner never approved. Fix: report verbatim and stop.
  Also: zero approved powers (no resume line), empty inventory (`none_found` read as a schema miss),
  half-made hand-off recovery, manifest written before the modules.
- **r3**: fetch without a Bash timeout above the 300 s clone limit (a killed process leaves
  `fetched/` and a tmp HOME; branch added), sandbox wording made exact (local daemon answering
  `docker info` in 5 s; `unshare` only on Linux with user namespaces), manifest-order test made real.

Rule promoted: `process` ("a command never routes around a refusal or a human choice"), reviews
command-docs-r1 + r2, in `rules.md`.

## Cost

`cli.js model-stats` for the whole run: sonnet 26 helpers (95,237 mean), opus 44 (111,356), haiku 3
(138,398); all 73 first-pass green, 0 escalations. This stream's reviews: 409,247 tokens.

## Follow-ups

- Generator `dot-shortcuts.js` and the committed `.shortcuts/*.md` still drift apart (only touched
  files were re-rendered); reconcile.
- Owner jobs left: push and merge via `/bcp`.
