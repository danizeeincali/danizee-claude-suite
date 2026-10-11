# Review 4f04c228-c12a-4f47-b2eb-7f55bf06da26 — marathon, round 4

- Commit: 297cfcd
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 2 findings

## Medium (1)

- **4.2 copy creates a missing W and writes the private scrub patterns outside the repo** — `src/plugins/dot-shortcuts.js:4065` (security): The guard refuses only an empty W. A non-empty W that does not exist (typo, wrong cwd, a failed git worktree add) makes mkdir -p create the whole path and cp write the private patterns into a stray folder outside the repository; the block exits 0 and the stray folder passes the isDir check of cli.js stream isolation=\<path\>. — fix: Before the copy: \[ -d "$W" \] && git -C "$W" rev-parse --is-inside-work-tree \>/dev/null 2\>&1 || { echo "$W is not the stream worktree: create it first" \>&2; exit 1; }; mkdir -p only the .claude/kit subfolder. Add a test with a missing W asserting exit 1 and nothing created.

## Low (1)

- **push-gate check cannot exit 1 on a timeout; the remedy sits under the wrong exit** — `src/plugins/dot-shortcuts.js:4193` (facts): push-gate check builds its own git without a timeout, so it never raises its own 'took longer than' exit 1; --timeout only reaches the scrub, whose timeout becomes a deny (exit 2). The remedy is listed under exit 1. — fix: Move the remedy to the exit-2 bullet: a deny whose reason says the scrub took longer than … ms is cured by rerunning with --timeout \<ms\> on push-gate check; drop the exit-1 timeout claim.
