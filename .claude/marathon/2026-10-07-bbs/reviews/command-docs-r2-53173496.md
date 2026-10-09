# Review 53173496-a0f9-4625-b246-8142459c7540 — command-docs, round 2

- Commit: bfed2cf
- Angle: failure conditions and error paths
- Result: pass
- 5 findings

## Medium (2)

- **After an illegal-verdict refusal (exit 2) the lead is told to 'fix the file, rerun', which means picking a verdict the owner never approved** — `.claude/commands/.shortcuts/w-bbs.md:125` (process): Line 45 says exit 2 = stop and report verbatim; CHECKPOINT 4 step 5 says fix the file and rerun, which makes the lead choose a verdict the owner did not approve. — fix: Treat a typed verdict not in the row's legal list as unparsable: print the table and the resume line and stop; on exit 2 report verbatim and stop. Never edit an owner's choice.
- **With zero approved powers ('Stop here', or all buy/skip), the hand-off has no resume line, yet the command requires one** — `.claude/commands/.shortcuts/w-bbs.md:146` (correctness): handoff sets resume\_line only when a marathon run is created; CHECKPOINT 5 and the checklist still demand the resume line. — fix: When resume\_line is null print the note and the buy memos instead; no marathon run is expected.

## Low (3)

- **An empty inventory (none\_found) is not covered, and the concatenation step turns it into a false schema miss** — `.claude/commands/.shortcuts/w-bbs.md:99` (docs): Concatenating all-none\_found helper answers yields \[\] which inventory --from refuses. — fix: If every helper returns none\_found, pass one {powers:\[\],none\_found} object, report 'no powers found' and stop before map.
- **CHECKPOINT 5 names only one hand-off failure; a failure after the marathon run exists is left to the generic rule** — `.claude/commands/.shortcuts/w-bbs.md:144` (docs): The 'created and is ACTIVE but incomplete' error names a --force refill command the checkpoint never mentions. — fix: On that error run the exact command the error names once; if it fails again report and stop.
- **An unreadable or half-written manifest, or an interrupted first install, loses the record of the marathon modules bbs copied** — `src/plugins/bbs.js:56` (correctness): A corrupt manifest is treated as \[\]; modules written before an interrupted manifest never enter it; onlyIfAbsent never repairs a bbs-owned module. — fix: Write the manifest with the planned list before the modules; warn on stderr when unreadable; overwrite bbs-owned modules when marathon/cli.js is absent.
