# Review 75022879-8e6e-41d0-ab0a-aa4766edcb05 — diff-range, round 7

- Commit: d507c70
- Angle: performance and memory
- Result: pass
- 3 findings

## Medium (2)

- **One hardened git process per untracked file, with no cap and no overall time bound** — `src/lib/kit/diff-range.js:246` (performance): 2,000 one-line untracked files took 8.4 s (4.2 ms each); 50,000 would take minutes, w-review runs it three times, --timeout bounds each child only, no --max-untracked and no count in the output — fix: diff all untracked files in one process: temp GIT\_INDEX\_FILE copy, git add -N -- \<files\> with the same overrides, one git diff \<base\>; or cap the count, list the rest in skipped and print a note
- **Output over 64 MiB fails with an unnamed ENOBUFS, and no size cap matches downstream's 32 MiB limit** — `src/lib/kit/push-gate.js:64` (performance): a 70 MB untracked log gives 'kit: cannot run git: spawnSync git ENOBUFS' with no path or remedy; a 50 MB range passes diff-range but graph/impact refuse it (maxDiffBytes 32 MiB); the range is held three times in memory — fix: map ENOBUFS to a message naming the command, output size and (in diff-range) the untracked path; lstat untracked files and put any above a byte cap in skipped with reason too\_large; refuse a total above graph's maxDiffBytes with a clear message

## Low (1)

- **Header and a test title still say the partial-clone failure names that lazy fetch is off** — `src/lib/kit/diff-range.js:33` (docs): the message now says diff-range never downloads; the header line and the test title at test/kit-diff-range.test.js:370 still claim the lazy-fetch wording — fix: change both to 'naming the missing object and that diff-range never downloads'
