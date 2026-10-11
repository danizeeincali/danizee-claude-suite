# Review 77b23ca4-249f-458d-986f-1ecd935bd4cf — marathon, round 2

- Commit: 5671237
- Angle: failure conditions and error paths
- Result: pass
- 6 findings

## Medium (2)

- **A missing or mistyped worktree is reported as 'kit not installed' and the push gate is skipped** — `src/plugins/dot-shortcuts.js:4150` (correctness): The CHECKPOINT 6 block and both 4.5 receipt blocks test \[ ! -f "$W/.claude/helpers/kit/cli.js" \] before entering $W, so a missing or wrong W prints the advisory skip and exits 0, and the lead goes on to /bcp with no receipt, check or scrub. Confirmed with W set to a missing folder. — fix: Enter the worktree before testing for the kit (cd "$W" || { echo "cannot enter the stream worktree $W: not pushed" \>&2; exit 1; }) in the CHECKPOINT 6 block and both receipt blocks.
- **The 4.8 check for missing scrub patterns misses the usual case: public file committed, private file missing** — `src/plugins/dot-shortcuts.js:4119` (security): The 4.8 guard only fails on configured: false; configured is true when either pattern file exists, and the public file is committed, so a missing .local copy still scans with no private pattern, exits 0 and the stream can close. — fix: In 4.8, before the scrub, loop over both pattern files: if "$M/$P" exists and "$P" does not, print 'scrub patterns missing from the worktree' and exit 2, as CHECKPOINT 6 does.

## Low (4)

- **A scrub exit 1 (nothing scanned) still lets the stream close** — `src/plugins/dot-shortcuts.js:4121` (correctness): At 4.8 a scrub exit 1 (bad base, git failure, unreadable pattern file, incomplete history) is reported and the gate still runs, so state=done can follow although the history was never scanned. — fix: Say that a scrub exit 1, or any other non-zero exit, also keeps the stream open until a scrub exits 0.
- **The kit is judged missing from the worktree alone, so a kit the main checkout has but the branch lacks is skipped silently** — `src/plugins/dot-shortcuts.js:4117` (correctness): Every block decides 'kit not installed: advisory' from $W alone; a kit installed but uncommitted in the main checkout makes every worktree skip all five wired steps. — fix: Report 'kit not installed' only when $M/.claude/helpers/kit/cli.js is also missing; otherwise print 'kit missing from the worktree: commit it or copy it' and exit non-zero.
- **The base reader's exit 1 always points at the stream name, even when the file is missing or corrupt** — `src/plugins/dot-shortcuts.js:4063` (facts): The node -e reader exits 1 with an uncaught stack trace when streams.json is missing or invalid, but the prose says exit 1 means an unknown name or no base. — fix: Wrap the read in try/catch and print 'cannot read \<f\>: \<message\>'; add 'or the run folder or streams.json is wrong' to the prose.
- **The CHECKPOINT 6 block does not stop on an empty BASE, and push-gate accepts it without a word** — `src/plugins/dot-shortcuts.js:4152` (correctness): push-gate parses --base "" as empty and falls back to the upstream merge base, so an empty BASE records a receipt and checks a range other than the stream's with no error. — fix: Add \[ -n "$BASE" \] || { echo "BASE is empty: read it from streams.json first: not pushed" \>&2; exit 1; } at the top of the CHECKPOINT 6 block and the receipt blocks.
