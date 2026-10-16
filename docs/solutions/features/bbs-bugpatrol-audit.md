# /w-bbs on Bugpatrol: 12 powers approved, built later in a marathon

Run: `2026-10-15-bugpatrol` · Marathon: `2026-10-15-bbs-bugpatrol` · Compounded 2026-10-15
Source: https://github.com/agent-labs-dev/bugpatrol (Apache-2.0), identity `git:960cd19`
Run files: `.claude/bbs/runs/2026-10-15-bugpatrol/` · Marathon files: `.claude/marathon/2026-10-15-bbs-bugpatrol/`
Commit with the run files: `880e8c8`. Branch: `claude/project-thread-24nlxj`.

## What was audited

Bugpatrol, an open-source bug-patrol tool for agent-driven review and fix loops. One fetch (`requests=1`,
`bytes_in=2013321`, `bodies_sent=0`, host `github.com`). Nothing from the source was executed, and the fetched
tree stays git-ignored under the run's `fetched/` folder. The inventory found 16 powers; 12 fit under the cap
and 4 were noted but not assessed (commit-keyed patrol loop with closed-PR lessons, stable finding fingerprints
from rule and bucketed regions, one-sentence consequence rule, commit replayable routines).

The surfaces scan of this repo found 48 surfaces (job 1, cli 2, lib 1, workflow 44): no page, endpoint or model
step. So almost every power lands in a Claude Code workflow.

## The 12 powers and where each lands

Verdicts: 12 approved, 0 skipped, 0 undecided. 11 rebuild (clean room, idea only), 1 buy (memo only).

| # | Power | Suite has | Verdict | Lands in |
| --- | --- | --- | --- | --- |
| 1 | noise ledger with flake quarantine | missing | rebuild | w-review, Ralph Candidates (advisory) |
| 2 | two pass finding clustering | missing | rebuild | w-review Code Analysis; w-bg-review Phase 4 (advisory) |
| 3 | asymmetric threshold router | partial (push-gate.js) | rebuild | w-review Cross-Method Validation (advisory); w-fix (blocking) |
| 4 | change-impact test plan | partial (impact.js) | rebuild | CI `test.yml` node-test; w-fix Fix Applied (advisory) |
| 5 | finding triage with fingerprint dedup and absence closing | missing | rebuild | w-review, Ralph Candidates (advisory) |
| 6 | shared budget for claim sub-sessions | partial (marathon budget.js) | rebuild | w-marathon Loop (blocking); w-review |
| 7 | trouble-log reflection into lesson memory | missing | rebuild | w-fix Compound; w-bbs Compound (advisory) |
| 8 | safe worktree cleanup for fix checkouts | missing | **buy** | w-fix Compound; w-hotfix closing step (advisory) |
| 9 | preflight doctor checks before a run | missing | rebuild | `bin/cli.js check` (blocking); w-marathon Arm (blocking) |
| 10 | exit code contract separating infrastructure from product failure | partial (kit-exit.js) | rebuild | `bin/cli.js check`; CI node-test (blocking) |
| 11 | SARIF, JUnit and sticky PR comment renderers | missing | rebuild | CI `test.yml`; w-review Compound (advisory) |
| 12 | repeated replay gate for claims | partial (wording-judge.js) | rebuild | w-review Cross-Method Validation; w-debug Diagnosis (blocking) |

Safe worktree cleanup defaults to buy because its source checks the remote over the network (`git ls-remote`);
its memo is `memos/safe-worktree-cleanup-for-fix-checkouts.md`, with no stream. Seven probes found network calls
(a model call, the gh CLI, `git ls-remote`), so `use` was off for those rows. Full per-power descriptions are in
the run's briefs.

## Hand-off

Marathon `2026-10-15-bbs-bugpatrol` has 11 build streams (one per rebuild power, briefs under `briefs/`) plus an
integration stream, all queued. A power counts as built only when a user can reach it (see
`bbs-integration-any-surface.md`). Resume with:

```
/w-marathon --resume 2026-10-15-bbs-bugpatrol
```

Nothing is pushed; the owner's go (`/bcp`) is needed for that.

## Lessons

1. **In a cloud session `cli.js usage` only sees the current session.** The history it counted was one session
   that had run w-bbs only, so every workflow target (w-review, w-fix, w-debug, w-hotfix, w-marathon,
   w-bg-review) was unconfirmed against what the owner actually runs. The workflow targets had to carry an
   `unused_reason` instead of passing as used. Name the owner's workflows with `usage --workflows a,b` when the
   run happens in the cloud.
2. **The surfaces scan does not list the kit CLI `.claude/helpers/kit/cli.js` as a cli surface.** It found only
   the `bin/cli.js` commands, so a power meant for the kit had no cli target to name. A possible bbs
   improvement (RC-D039 / RC-F035).
3. **haiku and sonnet helpers sometimes returned JSON without writing their output file.** The step looked done
   but the file was missing. Check the file exists and is non-empty before marking a step done (RC-D040 /
   RC-F036).
4. **A typo in the repo URL failed the fetch with exit 1.** A new intake was needed; the failed run directory was
   removed so the registry holds only the good run `2026-10-15-bugpatrol`.

## Not done here, by design

- None of the 11 powers is built. This run only audited, decided and queued the work.
- The 4 powers past the cap were not assessed; run `/w-bbs` again on the same source to pick them up.
