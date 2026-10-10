# Review 84d80b23-2be2-49df-a230-ddc7a8e2a2fd — sweep-commits, round 4

- Commit: 3074caf
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 3 findings

## Medium (2)

- **Index-vs-disk check misses paths that were staged earlier, so a staged secret can be committed after a clean scrub** — `src/plugins/dot-shortcuts.js:4837` (security): The new sentence runs \`git diff --quiet -- \<the staged paths\>\`, and the agent fills in the paths it just staged. But \`git commit\` commits the whole index, and \`scrub --worktree\` reads every tracked file from disk. Reproduced: commit a.txt clean, stage a.txt with a key, put the clean text back on disk, then stage b.txt. \`git diff --quiet -- b.txt\` exits 0 and \`scrub --worktree\` exits 0 clean, but \`git diff --cached\` still holds the secret in a.txt, which the commit would include. A plain \`git diff --quiet\` exits 1 here. This matters most in w-end, which stages specific session files on top of whatever the owner already staged; same text in w-autoresearch and w-agent-tdd-swarm. — fix: Check every path in the index: run the check over \`git diff --cached --name-only -z\` (all staged paths), or say 'every staged path (\`git diff --cached --name-only\`)' instead of '\<the staged paths\>'. Apply in all three generator entries and regenerate.
- **Autoresearch revert \`git clean -fd -- \<the experiment's new paths\>\` deletes every untracked file when the experiment created no new file** — `src/plugins/dot-shortcuts.js:3799` (correctness): Most experiments only edit existing files, so the placeholder list is often empty. \`git clean -fd --\` with no path cleans every untracked, non-ignored file under the working directory. Reproduced: it removed autoresearch.jsonl and the .autoresearch-off sentinel. Nothing says the Setup state files are committed, so one scrub refusal can wipe the loop's state, a pause sentinel the owner created, and any untracked work of the owner's. Pinned by test/sweep-commits-command.test.js:325. — fix: Run the clean only when the list is non-empty: 'if the experiment created new paths, \`git clean -fd -- \<those paths\>\`; with none, skip the clean (never run git clean without a path)'. Update the test to assert that condition.

## Low (1)

- **The new \`git diff --quiet\` step names only exit 0 and does not say what to do if the second check also fails** — `src/plugins/dot-shortcuts.js:1209` (process): The text says 'exit 0 means none' and 'if the check fails, re-stage and run the check again before the scrub'. It does not name exit 1 (differences) or 128+ (a git error), nor what happens if the re-check fails again, so an agent may go on to scrub and commit while index and disk still differ. Generator lines 1209, 3808, 4837. — fix: Add: 'exit 1 means unstaged changes (re-stage and check once more); any other exit is a git error: report it and do not commit; if the re-check still exits non-zero, report it and do not commit.'
