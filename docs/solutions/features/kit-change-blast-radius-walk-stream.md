# kit stream: change-blast-radius-walk (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js impact --diff <file|-> [--base <ref>] [--hops 1-3] [--dir]` (`src/lib/kit/impact.js`), built
on the graph verb. Each changed line maps to the smallest definition containing it. A pure deletion maps through the
new-side line it sits before, and lines outside every definition are reported as `module_level`. From the touched
definitions it follows call, extends and implements edges backwards for 2 hops by default. Ranking is certain before
possible, production before tests, then fewer hops, then nearer folders. Hubs, per-hop and total caps are recorded in
`cuts` with counts. With `--base`, old-side files are read through safe-git, definitions the change removes are found,
and any removed name still called is flagged. A blob missing at base (partial clone) is listed in `old_not_read`. The
risk level has its reasons, and `lower_bound` is set whenever the graph is partial or the walk was cut. Caller: the
/w-review Code Analysis step. It catches a failed `git diff` (including untracked files named like options) instead of
reporting "no change to map".

**Rounds:** r1 fail (high: a nested function's change hid its outer function; module-level lines next to definitions
missed), r2 fail (high: a change that only deleted lines touched nothing), r3 pass (mediums: partial-clone blobs
skipped silently; a failed git diff read as an empty change), r4 pass (medium: untracked names starting with `-` were
taken as git options). All 10 findings were fixed before merge.

**Follow-up (not fixed here):** the lenses and graph steps of /w-review use the same untracked-file loop without `--`
and ignore its exit status. Their merged tests assert the exact command text, so changing them belongs in its own
change.

**Lesson:** map changes per line, deletions included. A change summary built only from added lines misses edits that
only remove code. In shell steps, put `--` before paths and carry every git exit status out, not just the first.
