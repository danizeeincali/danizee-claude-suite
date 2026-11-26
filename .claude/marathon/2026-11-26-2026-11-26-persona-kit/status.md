# Marathon 2026-11-26-2026-11-26-persona-kit

- State: RUNNING
- Budget: 0 / 14,000,000 tokens
- Allowance: unknown (ceiling 100%)
- Gate (run-wide, all streams): 0/2 clean reviews — build gate not met, full gate not met
- Escapes: 0
- Next for you: Next stream "server": create its worktree (`git worktree add ../<repo>-server -b marathon/2026-11-26-2026-11-26-persona-kit/server`) and activate it with `cli.js stream server state=active isolation=<path>`, then /w-marathon --resume 2026-11-26-2026-11-26-persona-kit.

## Streams

| Stream | Isolation | Plan | State | Gate | Phase | Next | Tasks | Escapes |
|---|---|---|---|---|---|---|---|---|
| server |  | .claude/marathon/2026-11-26-2026-11-26-persona-kit/plan-server.md | queued | clean 0/2 |  | write contract, port tests |  | 0 |
| rounds |  | .claude/marathon/2026-11-26-2026-11-26-persona-kit/plan-rounds.md | queued | clean 0/2 |  | waits on server |  | 0 |

## Finish line

| Line | Owner | Status | Actual | Target |
|---|---|---|---|---|
| Green end-to-end runs in a row | build | failing | 0 | at_least 3 |
| Green unit runs in a row | build | failing | 0 | at_least 3 |
| Clean reviews in a row | build | failing | 0 | at_least 2 |
| High findings in the latest review | build | failing | — | at_most 0 |
| Open high findings | build | met | 0 | at_most 0 |
| Helpers that blew their budget | build | met | 0 | at_most 2 |
| A fresh project gets helpers/persona and /w-persona-test from init | build | failing | — | is true |
| bos has no change | build | failing | — | is true |

## Waiting on human

none
