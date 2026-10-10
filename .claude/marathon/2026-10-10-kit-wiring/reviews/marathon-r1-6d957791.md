# Review 6d957791-b9cf-4fe2-b987-9b03815e4763 — marathon, round 1

- Commit: 15f1f0f
- Angle: one input method at a time
- Result: over tolerance
- 6 findings

## High (2)

- **impact runs against the main checkout, not the stream worktree** — `src/plugins/dot-shortcuts.js:4084` (correctness): The impact block takes its diff from diff-range --dir "$W" but calls impact without --dir, so impact resolves dir from the cwd (the main checkout, another branch) and builds the symbol graph from the wrong files; confirmed: 1 touched symbol from the main checkout vs 6 from the worktree, both exit 0 with unmapped empty, so the reviewer gets a wrong blast radius with no sign of it. — fix: Pass --dir "$W" to impact (impact.js accepts it) or run both verbs from inside the worktree with cd "$W"; fix the prose and add a test asserting it.
- **scrub and push-gate check in the worktree never see the private scrub patterns** — `src/plugins/dot-shortcuts.js:4119` (security): scrub.js loads .claude/kit/scrub-patterns.local from the working tree's top and the kit install git-ignores that file, so a fresh git worktree add has no copy. With only the private file, scrub reports configured:false with exit 0 and push-gate's scrub block is skipped, so a secret matching a private pattern passes both 4.8 and the pre-push check. — fix: Copy or symlink .claude/kit/scrub-patterns.local into the worktree at 4.2 and check it exists in $W before scanning; treat configured:false in $W as a failure when the main checkout has a pattern file.

## Medium (1)

- **Streams share one receipt slot, so every earlier stream is blocked at /bcp** — `src/plugins/dot-shortcuts.js:4090` (correctness): push-gate keeps one store file per git common dir, shared by all worktrees, holding a single latest receipt. When the next stream records its receipt, the earlier stream's change id moves to previous and its CHECKPOINT 6 check returns ask 'only an earlier review exists', which the template sorts under 'any other ask' and does not push. A /bc commit in the worktree after the receipt causes the same block. — fix: At CHECKPOINT 6 re-record the stream's receipt from its final review counts after /bc and just before the check; say an 'earlier version' ask can come from another stream's receipt.

## Low (3)

- **lenses and impact use the main checkout's kit; receipt, scrub and check use the worktree's** — `src/plugins/dot-shortcuts.js:4071` (correctness): The 4.5 blocks test and run .claude/helpers/kit/cli.js relative to the cwd while every other block uses $W's copy; the copies can differ (here the main checkout has no diff-range verb) and project lenses under .claude/kit/lenses are read from the wrong tree. — fix: Use one kit location for all blocks: run the 4.5 blocks with cd "$W" as the others do.
- **Reading the base with cli.js stream \<name\> writes to the store** — `src/plugins/dot-shortcuts.js:4068` (correctness): verbStream always calls setStream and refresh; a misspelled name silently creates a new stream row with no base, and BASE comes back empty. — fix: Read the base from a read-only output (cli.js status or streams.json), or warn that the name must match an existing stream exactly.
- **Kit-wiring tests only regex-match text, never run a block** — `test/w-marathon-command.test.js:115` (test-quality): No test runs a block against a real repo with a worktree, which is why the impact/--dir mismatch and the missing private patterns pass the suite. — fix: Add one test that extracts the 4.5 blocks and runs them in a temp repo with a worktree (empty range → exit 0 'no change to review'; a range with changes → lenses/impact output whose root is the worktree).
