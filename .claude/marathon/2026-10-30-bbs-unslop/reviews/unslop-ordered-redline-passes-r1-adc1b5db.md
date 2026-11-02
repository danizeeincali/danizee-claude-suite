# Review adc1b5db-f95e-48b8-b671-c52262f6f758 — unslop-ordered-redline-passes, round 1

- Commit: 998a707
- Angle: one input method at a time
- Result: pass
- 4 findings

## Medium (1)

- **Header says mark exits 2 for an unknown pass; the code exits 1** — `src/lib/kit/redline-passes.js:24` (docs): The MARK paragraph says 'A pass that is out of order, already done or unknown exits 2 with the file untouched'. Line 170 rejects an unknown --pass with bad() (KitExit 1), and the unit test at test/kit-unslop-ordered-redline-passes.test.js:164 pins exit 1. A probe confirmed it: \`mark --state p.json --pass sparkle\` exits 1. A caller who branches on the documented exit codes (2 = refusal and retry with the next pass, 1 = broken input) gets the wrong branch. The same text is in .claude/helpers/kit/redline-passes.js:24. — fix: Change the header in both copies to 'A pass that is out of order or already done exits 2; an unknown pass id exits 1'. That matches the code and the test.

## Low (3)

- **next/remaining depend on where the first problem sits, so \`next\` can name a pass already listed as done** — `src/lib/kit/redline-passes.js:98` (correctness): evaluate stops at the first problem (line 98) and builds \`remaining\` only from the ids it saw before that point. For {"done":\["spacing","bogus","color"\]} it returns next=color and keeps color in \`remaining\`, although color is in \`done\`. The header (line 13) says \`next\` 'still names the first pass of the plan that is not done'. The answer is arguably the right advice, but it contradicts the stated rule. The \`fix\` text 'Redo the passes out of order' also points at the wrong pass for unknown or repeated ids. — fix: Either reword the header: on a problem, \`next\` is the first plan pass after the last in-order prefix. Or compute \`next\` from the in-order prefix explicitly and word \`fix\` for each problem kind.
- **Concurrent-mark test does not check why the losers failed** — `test/kit-unslop-ordered-redline-passes.test.js:171` (test-quality): 'serialises concurrent marks' asserts only that at least one mark succeeded and that the file holds an in-order prefix. A loser that failed with a lock timeout or a lost-lock KitExit 1 would also pass the test, although the behaviour the spec needs is a refusal (exit 2). — fix: Also assert that every rejected result is a KitExit with code 2, and that done.length equals the number of fulfilled results.
- **next signature line omits batch, reminder and exit** — `src/lib/kit/redline-passes.js:9` (docs): The return shape documented for \`next\` is { next, done, remaining, ok, problem?, fix? }. The code can also add \`batch\` and \`reminder\` (--all-at-once) and \`exit: 2\` (--strict). The ALL AT ONCE and STATE paragraphs describe these, but the signature line, which readers scan first, does not. — fix: Extend the line to { next, done, remaining, ok, problem?, fix?, batch?, reminder?, exit? } in both copies.
