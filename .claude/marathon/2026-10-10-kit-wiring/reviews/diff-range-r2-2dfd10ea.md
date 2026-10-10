# Review 2dfd10ea-679b-4620-badd-01f0a1c8fd9e — diff-range, round 2

- Commit: 274ecf9
- Angle: failure conditions and error paths
- Result: over tolerance
- 4 findings

## Medium (3)

- **An untracked symlink to a directory makes the whole verb exit 1** — `src/lib/kit/diff-range.js:104` (correctness): git diff --no-index -- /dev/null \<link\> follows a symlink to a directory and fails exit 1 with 'Could not access \<link\>/null'; the exit-1-with-stderr rule then throws, so lenses, graph and impact all stop with diff-range failed; a .gitignore line node\_modules/ does not match a worktree's node\_modules link (reproduced on git 2.43) — fix: lstat each untracked path first; for a symlink build the added-file diff from the link target text (mode 120000) instead of following it; add a test with a symlink to a directory
- **When the merge base fails with an upstream set, the range silently becomes the whole history** — `src/lib/kit/diff-range.js:74` (correctness): when @{upstream} resolves but merge-base fails (exit 1 in a shallow clone, or 128), the code falls through to the empty tree with no error, so every tracked file is reported as the change (reproduced with a --depth 1 clone) — fix: with an upstream and no merge base, exit 1 with 'no merge base with \<upstream\> (shallow clone?): pass --base'; keep the empty-tree fallback only for no upstream
- **--base refuses the empty-tree id that --base-only prints in a SHA-256 repository** — `src/lib/kit/diff-range.js:71` (correctness): --base-only prints hash-object -t tree /dev/null (6ef19b41... in a sha256 repo) but --base accepts only the hard-coded SHA-1 constant, so the w-review blast-radius block always fails there (reproduced with git init --object-format=sha256) — fix: compare f.base with the repository's own hash-object -t tree /dev/null result instead of the SHA-1 constant

## Low (1)

- **The blast-radius block ignores a failed --base-only and reports a misleading second error** — `src/plugins/dot-shortcuts.js:2139` (docs): nothing checks the first call's exit status; when it fails B is empty and the second call fails with '--base needs a ref', which misleads the diagnosis (nothing is skipped: the step still exits non-zero) — fix: test \[ -n "$B" \] (or || { echo 'diff-range --base-only failed' \>&2; (exit 1); }) before the second call
