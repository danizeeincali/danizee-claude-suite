# Marathon 2026-10-07-bbs

- State: RUNNING
- Budget: 3,878,712 / 10,000,000 tokens
- Allowance: 94% (ceiling 95%)
- Gate (run-wide, all streams): 2/2 clean reviews — build gate not met, full gate not met
- Escapes: 0
- Next for you: Continue stream "harness-map" (next: opus fix for review r4 (symlinked roots); then unit run, close, merge; fix reviewed in verdict r1 via --base f449196) — /w-marathon --resume 2026-10-07-bbs. Waiting on you: pushed (tick them in checklist.md).

## Streams

| Stream | Isolation | Plan | State | Gate | Phase | Next | Tasks | Escapes |
|---|---|---|---|---|---|---|---|---|
| intake | ../claude-suite-intake | .claude/plans/2026-10-07-w-bbs.md | done | clean 3/2 | /w-marathon · done | closed: 6 reviews (r4–r6 clean), 28 findings fixed; r6 fixes (497e7cf..5921405) reviewed in fetch r1 via --base 497e7cf |  | 0 |
| fetch | ../claude-suite-fetch | .claude/plans/2026-10-07-w-bbs.md | done | clean 2/2 | done | closed: 3 reviews (r2, r3 clean), 18 findings fixed; r3 fixes (952736d..eeebb82) reviewed in inventory r1 via --base 952736d |  | 0 |
| inventory | ../claude-suite-inventory | .claude/plans/2026-10-07-w-bbs.md | done | clean 2/2 | done | closed: 3 reviews (r2, r3 clean), 25 findings fixed; r3 fixes (945e873..9905a37) reviewed in harness-map r1 via --base 945e873 |  | 0 |
| harness-map | ../claude-suite-harness-map | .claude/plans/2026-10-07-w-bbs.md | active | clean 2/2 | 4.7 | opus fix for review r4 (symlinked roots); then unit run, close, merge; fix reviewed in verdict r1 via --base f449196 |  | 0 |
| verdict |  | .claude/plans/2026-10-07-w-bbs.md | queued | clean 0/2 |  | verdict.js licence policy, legalVerdicts, probe, decide, labels, registry |  | 0 |
| handoff |  | .claude/plans/2026-10-07-w-bbs.md | queued | clean 0/2 |  | handoff.js briefs + buildFinishLine + marathon bridge |  | 0 |
| command-docs |  | .claude/plans/2026-10-07-w-bbs.md | queued | clean 0/2 |  | plugin installer, w-bbs + bbs commands, docs, README, e2e packaged test |  | 0 |

## Finish line

| Line | Owner | Status | Actual | Target |
|---|---|---|---|---|
| Green end-to-end runs in a row | build | failing | 0 | at_least 6 |
| Green unit runs in a row | build | met | 19 | at_least 3 |
| Clean reviews in a row | build | met | 2 | at_least 2 |
| High findings in the latest review | build | met | 0 | at_most 0 |
| Open high findings | build | met | 0 | at_most 0 |
| Helpers that blew their budget | build | met | 0 | at_most 4 |
| Packaged check: installed CLI runs the fixture source end to end | build | failing | — | is true |
| Pushed and merged by the owner via /bcp | human | waiting on human | false | is true |

## Waiting on human

- pushed — Pushed and merged by the owner via /bcp
