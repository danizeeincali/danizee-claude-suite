# Review 90804c82-57b2-4f9b-9441-07d294801821 — diff-range, round 1

- Commit: 7d9bd9a
- Angle: one input method at a time
- Result: over tolerance
- 5 findings

## High (1)

- **Commit adds a node\_modules symlink to an absolute host path** — `node_modules:1` (process): 7d9bd9a adds node\_modules as a symlink (mode 120000) to /home/claude/danizee-claude-suite/node\_modules; .gitignore only ignores node\_modules/ so the link got through; dangling in every other clone and exposes the host path — fix: git rm --cached node\_modules; ignore node\_modules without the trailing slash

## Medium (2)

- **An untracked path git cannot diff exits 1 and is dropped silently, so a failure can become 'no change to review'** — `src/lib/kit/diff-range.js:87` (correctness): git diff --no-index exits 1 both for differences and for some errors (an untracked nested repo: error Could not access 'sub/null', exit 1, empty stdout); only code\>1 is a failure, so diff-range exits 3 and --json lists the path under untracked with empty:true — fix: treat code 1 with empty stdout or non-empty stderr as a failure; list a path in untracked only when its diff text is non-empty
- **Command text still says any non-zero exit is a failure although the blocks exit 3 for an empty range** — `src/plugins/dot-shortcuts.js:2134` (docs): the graph paragraph never mentions exit 3 and says a non-zero exit is a broken state; the lens and impact paragraphs say the same right after the exit-3 sentence; same text in the regenerated w-review.md — fix: say 'any non-zero exit other than 3 (empty range)' in all three paragraphs and add the exit-3 sentence to the graph paragraph

## Low (2)

- **The impact block calls diff-range twice and the --base advice covers only one call** — `src/plugins/dot-shortcuts.js:2139` (docs): the diff and the base-only call can be given different bases and nothing notices — fix: resolve the base once into B and pass --base $B to both diff-range and impact, or say the ref goes on both calls
- **Non-UTF-8 file content is rewritten as U+FFFD in the printed diff** — `src/lib/kit/diff-range.js:87` (correctness): defaultGit decodes stdout as utf-8, so a latin-1 byte becomes EF BF BD and the diff no longer matches the file — fix: read the diff calls' stdout as a Buffer and let raw be a Buffer that cli.js writes undecoded
