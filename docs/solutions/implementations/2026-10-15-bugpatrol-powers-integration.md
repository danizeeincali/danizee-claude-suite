---
title: Wiring 11 bugpatrol powers into the suite (marathon 2026-10-15-bbs-bugpatrol)
date: 2026-10-15
category: implementations
tags: [bbs, marathon, kit, integration, workflows, ci]
---

# Wiring 11 bugpatrol powers into the suite

## What was built

The `/w-bbs` audit of agent-labs-dev/bugpatrol approved 11 rebuilds. Each was built in its own
worktree as a kit verb, certified by two clean reviews, then merged into one `integration`
branch and wired into 20 targets:

- Workflow steps (via `src/plugins/dot-shortcuts.js`, regenerated with `install()`):
  w-review, w-bg-review, w-fix, w-debug, w-marathon, w-bbs.
- `bin/cli.js check`: runs the doctor (honouring `.claude/kit/doctor.json`) and classifies exits
  (0 clean, 1 usage, 4 fatal prerequisite missing; a bad `--path` is usage).
- `.github/workflows/test.yml`: `scripts/ci-step.js` runs the tests through test-plan,
  exit-codes and the JUnit/SARIF renderers.

Reach tests live in `test/reach/` and are part of `npm test`.

## Lessons

- **Shell variables do not survive between Bash tool calls.** A workflow step that says
  `D=$(mktemp -d)` and later uses `$D` silently degrades to `/file`. Have the step print the
  path and reuse the literal value.
- **Never put model-written text in a double-quoted shell argument.** Lessons and error text
  carry backticks and `$( )`. `reflect lessons save --text-file` / `retire --reason-file` exist for this.
- **Redact before anything leaves the machine.** The PR comment from w-review now goes
  through `kit redact --keep-lines`; a redact failure means do not post.
- **No wall-clock across sessions.** The marathon helper allowance dropped `--time-ms`; on
  resume, `shared-budget status` and `stop` until depth is 0.
- **Judges fail closed.** A scrub or push-gate exit 2 always blocks; the CI step fails on
  any nonzero exit and only labels the class.
- **Build shared state infra once.** Four stateful verbs kept losing writes until one
  `src/lib/kit/state-lock.js` replaced per-verb fixes.

## Left open (within tolerance)

- CI writes JUnit/SARIF to `$RUNNER_TEMP` and nothing uploads them (an upload step would add
  `actions/upload-artifact`, a dependency the owner must approve).
- w-review names `kit/cli.js triage decide` instead of `node .claude/helpers/kit/cli.js triage decide`.
- ci-step labels any status classify calls infrastructure (such as 5) "timed out, rerun".
- The noise-ledger input text does not say `critical` must be mapped to `high`.
