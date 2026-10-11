# Review 9b08cc7c-f2ee-4769-a37b-d3ac24867389 — sweep-commits, round 3

- Commit: 349d04b
- Angle: older environments and degraded networks
- Result: pass
- 3 findings

## Medium (1)

- **autoresearch refusal revert does nothing if it runs before the unstage** — `src/plugins/dot-shortcuts.js:3799` (correctness): On a Keep, the scrub step has already run \`git add\` on the experiment's files. The new revert \`git checkout -- . && git clean -fd -- \<new paths\>\` restores the worktree from the index, which still holds the refused content; git clean only removes untracked files, so a staged new file is left alone. Checked in a scratch repo (git 2.43): after \`git add f n\`, that revert left \`M f\` (still containing SECRET) and \`A n\`. It only works if \`git reset -q -- \<paths\>\` runs first. Line 70 does not order the two steps, and when the unstage fails the revert silently does nothing. The refused secret then stays staged and on disk, every later Keep is refused again, Discard's \`git checkout -- .\` does not clear it, and a Discard resets the 3-refusal counter, so the loop may never pause. — fix: Change the revert to say: unstage first (\`git reset -q -- \<the experiment's paths\>\`), then \`git checkout -- . && git clean -fd -- \<the experiment's new paths\>\`. If the unstage failed, do not count this as reverted: report it and pause the loop.

## Low (2)

- **'record no receipt' after a scrub refusal is undone by the post-Compound re-record** — `.claude/commands/.shortcuts/w-tdd-swarm.md:234` (docs): The closing step says that after a scrub refusal or failure the agent records no receipt and continues to Compound. The next paragraph still says unconditionally: after Compound, if the tracked tree changed, record the receipt again. An agent that follows it records a receipt for a tree that failed the scrub. Same text in w-debug, w-hotfix, w-security and the generator. — fix: Add 'only when a receipt was recorded before Compound' to the re-record sentence.
- **Vacuous assertion in the index-vs-disk scrub test** — `test/sweep-commits-command.test.js:303` (test-quality): \`assert.ok(s.indexOf('git diff --quiet') \< s.length)\` is always true, because -1 is less than any length. It does not check that the check comes before the scrub command. — fix: Assert \`s.indexOf('git diff --quiet') \>= 0\`. s already ends at the scrub command, so that also proves the order.
