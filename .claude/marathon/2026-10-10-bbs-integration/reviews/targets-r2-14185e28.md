# Review 14185e28-5511-4a5b-845f-bd38738541bd — targets, round 2

- Commit: c85e19c
- Angle: failure conditions and error paths
- Result: pass
- 5 findings

## Medium (2)

- **computeVerdicts throws after commit on corrupt targets/usage** — `src/lib/bbs/verdict.js:737` (correctness): bare readJson for the table after verdicts.json is written; same in verdict --table — fix: read inside try; warn with repair verb
- **identical resubmission refused for runs decided before targets** — `src/lib/bbs/verdict.js:862` (correctness): landing check runs on repeated rows — fix: skip landing check when had === v

## Low (3)

- **targets repair hint masked by finally render** — `src/lib/bbs/cli.js:318` (correctness): renderStatusSafe rethrows bare corrupt JSON — fix: catch in finally
- **targets --set '' falls through to --from** — `src/lib/bbs/cli.js:306` (correctness): truthiness vs undefined — fix: branch on !== undefined; reject empty --from
- **eviction rescans capped list when saturated with KEEP rows** — `src/lib/kit/graph.js:1191` (performance): O(cap x overflow) — fix: saturated flag
