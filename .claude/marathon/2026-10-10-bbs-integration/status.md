# Marathon 2026-10-10-bbs-integration

- State: RUNNING
- Budget: 0 / 10,000,000 tokens
- Allowance: unknown (ceiling 100%)
- Gate (run-wide, all streams): 0/2 clean reviews — build gate not met, full gate not met
- Escapes: 0
- Next for you: Next stream "usage": create its worktree (`git worktree add ../<repo>-usage -b marathon/2026-10-10-bbs-integration/usage`) and activate it with `cli.js stream usage state=active isolation=<path>`, then /w-marathon --resume 2026-10-10-bbs-integration.

## Streams

| Stream | Isolation | Plan | State | Gate | Phase | Next | Tasks | Escapes |
|---|---|---|---|---|---|---|---|---|
| usage |  | .claude/plans/2026-10-10-bbs-integration.md | queued | clean 0/2 |  | build stream usage per plan |  | 0 |
| targets |  | .claude/plans/2026-10-10-bbs-integration.md | queued | clean 0/2 |  | build stream targets per plan |  | 0 |
| integration-gate |  | .claude/plans/2026-10-10-bbs-integration.md | queued | clean 0/2 |  | build stream integration-gate per plan |  | 0 |

## Finish line

| Line | Owner | Status | Actual | Target |
|---|---|---|---|---|
| Green /w-bbs end-to-end runs in a row (usage -> targets -> verdict -> handoff with an integration stream) | build | failing | 0 | at_least 2 |
| Green unit runs in a row | build | failing | 0 | at_least 1 |
| Clean reviews in a row | build | failing | 0 | at_least 2 |
| High findings in the latest review | build | failing | — | at_most 0 |
| Open high findings | build | met | 0 | at_most 0 |
| Helpers that blew their budget | build | met | 0 | at_most 2 |
| Full npm test green after the last stream | build | failing | — | is true |
| The new wired measure reports redact as not wired on current main for the OpenQodex powers | build | failing | — | is true |
| Installed copies (.claude/commands/.shortcuts, .claude/helpers/bbs) equal their sources | build | failing | — | is true |

## Waiting on human

none
