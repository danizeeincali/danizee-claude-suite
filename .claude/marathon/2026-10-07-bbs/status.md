# Marathon 2026-10-07-bbs

- State: RUNNING
- Budget: 0 / 10,000,000 tokens
- Allowance: unknown (ceiling 70%)
- Gate (run-wide, all streams): 0/2 clean reviews — build gate not met, full gate not met
- Escapes: 0
- Next for you: Next stream "intake": create its worktree (`git worktree add ../<repo>-intake -b marathon/2026-10-07-bbs/intake`) and activate it with `cli.js stream intake state=active isolation=<path>`, then /w-marathon --resume 2026-10-07-bbs. Waiting on you: pushed (tick them in checklist.md).

## Streams

| Stream | Isolation | Plan | State | Gate | Phase | Next | Tasks | Escapes |
|---|---|---|---|---|---|---|---|---|
| intake |  | .claude/plans/2026-10-07-w-bbs.md | queued | clean 0/2 |  | create worktree; write contracts + failing tests for store/intake/status/cli skeleton |  | 0 |
| fetch |  | .claude/plans/2026-10-07-w-bbs.md | queued | clean 0/2 |  | fetch.js guards + egress log + clone; stubbed tests |  | 0 |
| inventory |  | .claude/plans/2026-10-07-w-bbs.md | queued | clean 0/2 |  | inventory.js schema/cap/brief + verbs |  | 0 |
| harness-map |  | .claude/plans/2026-10-07-w-bbs.md | queued | clean 0/2 |  | harness-map.js index + IDF-cosine matchPower + verbs |  | 0 |
| verdict |  | .claude/plans/2026-10-07-w-bbs.md | queued | clean 0/2 |  | verdict.js licence policy, legalVerdicts, probe, decide, labels, registry |  | 0 |
| handoff |  | .claude/plans/2026-10-07-w-bbs.md | queued | clean 0/2 |  | handoff.js briefs + buildFinishLine + marathon bridge |  | 0 |
| command-docs |  | .claude/plans/2026-10-07-w-bbs.md | queued | clean 0/2 |  | plugin installer, w-bbs + bbs commands, docs, README, e2e packaged test |  | 0 |

## Finish line

| Line | Owner | Status | Actual | Target |
|---|---|---|---|---|
| Green end-to-end runs in a row | build | failing | 0 | at_least 6 |
| Green unit runs in a row | build | failing | 0 | at_least 3 |
| Clean reviews in a row | build | failing | 0 | at_least 2 |
| High findings in the latest review | build | failing | — | at_most 0 |
| Open high findings | build | met | 0 | at_most 0 |
| Helpers that blew their budget | build | met | 0 | at_most 4 |
| Packaged check: installed CLI runs the fixture source end to end | build | failing | — | is true |
| Pushed and merged by the owner via /bcp | human | waiting on human | false | is true |

## Waiting on human

- pushed — Pushed and merged by the owner via /bcp
