# Review ffa73977-f66c-476c-bb64-d5eac3b0034d — marathon, round 3

- Commit: 5f081b1
- Angle: older environments and degraded networks
- Result: pass
- 2 findings

## Medium (1)

- **Folder isolation mode leaves W undefined, and an empty W is never refused** — `src/plugins/dot-shortcuts.js:4063` (correctness): In streams.isolation: folder mode the stream row has no isolation field and the blocks never say what W is. cd "" returns 0, so every block runs silently in the current directory with exit 0, contradicting the 'cannot enter the stream worktree' prose; the 4.2 copy with an empty W writes the private patterns to /.claude/kit when run as root. — fix: Open every block, including the 4.2 copy, with \[ -n "$W" \] || { echo "W is empty: set it to the stream's isolation path" \>&2; exit 1; }; add a sentence for folder mode: no isolation path, the stream builds in the main checkout, so W=. and the 4.2 copy is skipped.

## Low (1)

- **No timeout remedy on slow machines for scrub, diff-range and push-gate check** — `src/plugins/dot-shortcuts.js:4121` (docs): Each git call stops after 60 s by default; scrub and diff-range exit 1 ('took longer than … raise it with --timeout \<ms\>'), push-gate check turns a scrub timeout into a deny; the blocks pass no --timeout and 4.8 keeps the stream open until a scrub exits 0. impact has no --timeout flag (its safe-git timeout surfaces as exit 3). — fix: Add one sentence: a 'took longer than … ms' failure is cured by rerunning the same block with --timeout \<ms\> on scrub, diff-range or push-gate check; impact cannot be raised, report it as a failed step.
