# change-blast-radius-walk — rebuild

## Idea (in our words)
Map each changed line to the innermost definition around it, then follow incoming call, inheritance and implementation edges backwards for two hops. Keep certain edges ahead of likely and possible ones, and rank production code ahead of tests and nearer folders ahead of distant ones. Score risk from the number of touched symbols, direct callers and broken public names, so a widely implemented interface cannot push every change to high. Symbols removed by the change are checked against call sites that still point at their old location, so a removal that leaves a live caller is flagged rather than silently dropped. The walk has hard limits on hubs, per-hop callers and total symbols, and every cut it makes is recorded with how many items were left out, so the reader knows what the summary does not show. A reusable version needs only a symbol graph of the project and a diff parser; it works offline.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.305Z
- Evidence: repo/packages/graph/src/impact.ts:20-30, repo/packages/graph/src/impact.ts:220-260, repo/packages/graph/src/impact.ts:278-355, repo/packages/graph/src/impact.ts:98-105

## What we have
missing — No candidate builds a symbol graph or walks call and inheritance edges from diff lines; the candidates are command docs and a marathon reviewer.

## Finish line (5 checks, written before the build)
- `tests_green_change-blast-radius-walk`: change-blast-radius-walk: green unit runs in a row
- `egress_zero_change-blast-radius-walk`: change-blast-radius-walk: zero egress in the packaged check
- `six_sigma_change-blast-radius-walk`: change-blast-radius-walk: clean reviews in a row
- `callers_change-blast-radius-walk`: change-blast-radius-walk: callers in the harness
- `packaged_change-blast-radius-walk`: change-blast-radius-walk: packaged check passes

## Kickoff lines

Done means
- tests_green_change-blast-radius-walk — green unit runs in a row
- egress_zero_change-blast-radius-walk — zero egress in the packaged check
- six_sigma_change-blast-radius-walk — clean reviews in a row
- callers_change-blast-radius-walk — callers in the harness
- packaged_change-blast-radius-walk — packaged check passes

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

