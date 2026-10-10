# caller-floor-disclosure — rebuild

## Idea (in our words)
When a static analysis builds a caller list, it should also record what it could not see for that symbol: calls with the same name that could not be bound to one definition, calls through a value or a computed member, possible calls through an interface, files of the same project that were not read, and importers whose calls were left unresolved because a budget ran out. Each reason becomes a plain sentence attached to the symbol, and the symbol is marked as a floor when any reason applies. The rendered report then tells a reviewer to check the call sites by hand and never reads zero callers as proof of no use. This is cheap to rebuild on top of any caller index: keep the counters at the time the index is built and expose them with the result.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.306Z
- Evidence: repo/packages/graph/src/impact.ts:199-218, repo/packages/graph/src/impact.ts:435-439, repo/packages/graph/src/render.ts:77-87

## What we have
missing — No candidate builds a caller index or records unresolved-call reasons; marathon budget and resume helpers are unrelated.

## Finish line (5 checks, written before the build)
- `tests_green_caller-floor-disclosure`: caller-floor-disclosure: green unit runs in a row
- `egress_zero_caller-floor-disclosure`: caller-floor-disclosure: zero egress in the packaged check
- `six_sigma_caller-floor-disclosure`: caller-floor-disclosure: clean reviews in a row
- `callers_caller-floor-disclosure`: caller-floor-disclosure: callers in the harness
- `packaged_caller-floor-disclosure`: caller-floor-disclosure: packaged check passes

## Kickoff lines

Done means
- tests_green_caller-floor-disclosure — green unit runs in a row
- egress_zero_caller-floor-disclosure — zero egress in the packaged check
- six_sigma_caller-floor-disclosure — clean reviews in a row
- callers_caller-floor-disclosure — callers in the harness
- packaged_caller-floor-disclosure — packaged check passes

You may decide on your own
- How to structure the code behind each power's interface, within its brief
- Test names, fixtures and file layout

Ask me before
- Adding a dependency
- Any network call, account, purchase or signature
- Changing a finish line

Never
- Never execute fetched foreign code
- Never copy source code from the source

