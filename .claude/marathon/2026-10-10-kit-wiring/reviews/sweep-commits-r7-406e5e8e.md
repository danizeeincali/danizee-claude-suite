# Review 406e5e8e-c927-4d1a-9276-1ae99c094702 — sweep-commits, round 7

- Commit: 38552ec
- Angle: performance and memory
- Result: pass
- 1 findings

## Low (1)

- **Discard revert stages every changed file and runs three name-only diffs just to revert** — `src/plugins/dot-shortcuts.js:3809` (performance): The Discard path runs git add on the experiment's files only to record path lists, then three separate git diff --cached --name-only --no-renames calls, then reset, checkout and clean: six git calls per Discard in a loop that runs forever; each git add writes loose blobs that stay until auto-gc. With the clean-tree precondition the experiment's paths are derivable without staging: git diff --name-only --no-renames for tracked paths and git ls-files --others --exclude-standard minus the loop's state files for new ones; the three cached lists also come out of one git diff --cached --name-status --no-renames. — fix: For Discard and Crash derive the lists without git add; where staging already happened take one git diff --cached --name-status --no-renames and split it by status.
