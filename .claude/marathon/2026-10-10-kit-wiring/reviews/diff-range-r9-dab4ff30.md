# Review dab4ff30-db47-4274-8a7f-a8df4197740d — diff-range, round 9

- Commit: 71cef3a
- Angle: failure conditions and error paths
- Result: pass
- 4 findings

## Medium (1)

- **An unconditional --sparse sends git 2.25-2.33 to the per-file fallback on every run** — `src/lib/kit/diff-range.js:290` (performance): git add --sparse shipped in 2.34; older gits reject it as unknown option and always take the --no-index loop; before 2.34 add -N ignores the cone anyway — fix: pass --sparse only when the config read shows core.sparseCheckout=true, or retry add -N once without --sparse before the per-file fallback

## Low (3)

- **Fallback regex matches any stderr that contains 'sparse' or 'usage:'** — `src/lib/kit/diff-range.js:295` (correctness): a real add -N failure mentioning a path with 'sparse' quietly switches to the slow path and the real cause is never reported — fix: anchor on git's option-parse failure only: /unknown (option|switch) \`(sparse|pathspec-from-file|pathspec-file-nul)/ or exit 129 with usage:
- **Usage and header give exit 3 / exit 1 for empty and cap-only ranges, but --json exits 0 in both** — `src/lib/kit/diff-range.js:83` (docs): with --json no exit is returned; nothing names the --json exit code or says to read empty and skipped\_detail; no test covers the cap-only --json case — fix: add '(--json: always exit 0; read empty and skipped\_detail)' to usage and header; add one assertion on the cap-only --json result
- **An unreadable untracked file fails the whole verb as 'cannot diff against the base'** — `src/lib/kit/diff-range.js:282` (other): a mode-000 untracked file makes the merged diff exit 128 and the message points at the base, not the untracked file — fix: label a failing merged diff 'cannot diff the range (tracked changes plus N untracked files)'
