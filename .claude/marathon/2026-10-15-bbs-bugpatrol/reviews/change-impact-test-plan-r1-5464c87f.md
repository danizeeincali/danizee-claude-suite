# Review 5464c87f-07b2-4ed0-b85d-b0813ba815e4 — change-impact-test-plan, round 1

- Commit: ee9b261
- Angle: r1: full read, silent under-testing
- Result: pass
- 2 findings

## Low (2)

- **Mapped share is rounded before the low-confidence comparison, so a share just under the minimum skips the smoke set** — `src/lib/kit/test-plan.js:140` (correctness): mappedPct is pct(), which rounds to one decimal, and line 143 compares that rounded value with minMappedPct. 241 of 402 changed files mapped is 59.95%, which rounds to 60.0. With the default --min-mapped-pct 60 the result is low\_confidence false, no smoke set, and mapped\_pct 60 (confirmed with planTests). That breaks the rule 'below the threshold, add a smoke set and flag it, never silent'. It only happens on large change sets (about 400 or more files), so it is rare. — fix: Compare the raw ratio: mapped \* 100 \< minMappedPct \* files.length. Keep the rounded value for display only.
- **low\_confidence\_reason says 'a smoke set was added' when the smoke set is empty** — `src/lib/kit/test-plan.js:145` (facts): The reason string is fixed text. If no target has entry: true and --smoke is 0, nothing is added: with planTests({targets:\[{id:'a',files:\[\]}\]}, \['z.js'\], {smoke:0}) the plan is \[\], yet the reason still says a smoke set was added. A reviewer reading only the reason would think a fallback ran when none did. — fix: Count the targets the smoke step actually added and word the reason to match, e.g. 'smoke set: N targets' or 'no smoke targets available'.
