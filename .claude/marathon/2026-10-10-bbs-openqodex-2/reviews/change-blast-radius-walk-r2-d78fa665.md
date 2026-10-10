# Review d78fa665-f4e5-4d88-819f-8d21ff3545eb — change-blast-radius-walk, round 2

- Commit: 9f30147
- Angle: failure conditions and error paths
- Result: over tolerance
- 2 findings

## High (1)

- **Deletion-only change inside a definition maps to nothing: empty touched set, low risk, lower\_bound false** — `src/lib/kit/impact.js:111` (correctness): touchedSymbols maps only new-side added lines (c.added) to definitions. Removed lines (c.removed) are used only to look for definitions whose declaration line was deleted. So a hunk that only deletes lines inside a function that still exists maps to no definition. Examples are dropping a validation \`if (!x) throw ...\` or deleting an import at module level. That function gets no touched entry, no module\_level entry and no note. Its callers are never walked, and risk is low/0 with lower\_bound false. Reproduced, with and without --base: lib.js \`check()\` loses its throw line and main.js calls check(). Result: touched \[\], impacted \[\], risk {level:'low', score:0, lower\_bound:false}, notes \[\]. The w-review step then reads this as nothing affected, though the change alters behaviour for every caller. The same .claude/helpers/kit/impact.js copy has the same code. — fix: Also map each removed old-side line to the new side. A removed line at old line n in a hunk sits between new-side lines, so map the new-side line it borders (or the hunk's new position) through mapLines and add that to touched, or to module\_level when no definition contains it. Add a test for a deletion-only hunk inside a function with a caller.

## Low (1)

- **Empty diff returns exit 0 without validating --base** — `src/lib/kit/impact.js:361` (correctness): The empty-diff early return runs before the \`rev-parse --verify \<base\>^{tree}\` check. So \`impact --diff \<empty\> --base no-such-ref\` exits 0 and echoes base 'no-such-ref', while the same bad ref with a non-empty diff exits 1. A wrong BASE in the w-review recipe (for example a typo in \`--base \<ref\>\`) is therefore hidden whenever the range happens to be empty. — fix: Move the --base rev-parse check above the \`if (!changes.length)\` return.
