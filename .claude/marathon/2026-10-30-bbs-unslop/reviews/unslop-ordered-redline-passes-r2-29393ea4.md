# Review 29393ea4-10ad-48cc-b62e-d603165d3744 — unslop-ordered-redline-passes, round 2

- Commit: b4877d1
- Angle: failure conditions and error paths
- Result: pass
- 4 findings

## Medium (1)

- **On an out-of-order state, remaining and --all-at-once batch silently drop the misplaced pass** — `src/lib/kit/redline-passes.js:107` (correctness): evaluate() adds the offending id to \`seen\` before the loop stops, and \`remaining\` is IDS minus \`seen\`. For done=\["spacing","motion"\] (probed via cli.js) \`next --all-at-once\` returns ok=false and remaining/batch = color..visuals, with no motion. The fix text tells the user to redo the passes in plan order, but the list it hands back as 'the whole remaining list' leaves out a pass that still has to be applied in order. An agent that follows the batch never does motion. The same happens with plain \`next\`: \`remaining\` names 7 passes instead of 8. No test covers remaining or batch on a broken state. — fix: Build \`remaining\` from the in-order prefix only (IDS.slice(prefixLength)), or skip seen.add for the offending id when the problem is 'order'. Add a test that done=\["spacing","motion"\] gives remaining/batch = IDS.slice(1).

## Low (3)

- **parseFlags looks flags up on a plain object, so Object.prototype names are accepted as flags** — `src/lib/kit/redline-passes.js:142` (correctness): \`spec\[a\]\` finds inherited members: \`next toString x\`, \`next constructor x\` or \`mark ... valueOf y\` find a truthy function, take the next argument as its value and exit 0 instead of the documented exit 1 'unexpected argument' (\`next toString x\` probed: exit 0). — fix: Use Object.hasOwn(spec, a) (or a Map / Object.create(null) spec) before reading kind.
- **Header says every bad \`done\` is reported by next as ok=false, but non-string ids exit 1** — `src/lib/kit/redline-passes.js:12` (docs): STATE says '\`done\` must be an array of pass ids ...; anything else is reported by \`next\` as ok=false with a \`problem\` (an unknown id, ...)'. readState throws exit 1 for {"done":\[1\]} before evaluate runs (the test 'nums.json' expects that), so a non-string entry is not an ok=false advisory answer. The unknown-id branch in evaluate for non-strings cannot be reached through run. — fix: Say in the header that a non-string entry (like a missing \`done\`) exits 1, or drop the readState check and let evaluate report it as unknown.
- **A refused mark still creates the state file's folder** — `src/lib/kit/redline-passes.js:178` (correctness): withStateLock creates the parent folder before the order check runs, so \`mark --state sub/x.json --pass color\` exits 2 ('file untouched') and leaves an empty \`sub/\` directory behind (probed). Small, but it contradicts 'refusal leaves things untouched' for a new path. — fix: Check the order against a lock-free read first and refuse before taking the lock, then re-check inside the lock; or document that the folder is created.
