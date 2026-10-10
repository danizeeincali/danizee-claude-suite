# Review a755ee5d-ac89-4adc-b679-affeb1fb8876 — diff-range, round 8

- Commit: 5b3a800
- Angle: one input method at a time
- Result: over tolerance
- 4 findings

## Medium (3)

- **Merged add -N diff pairs a deleted tracked file with an untracked copy as a rename, so the content disappears** — `src/lib/kit/diff-range.js:286` (correctness): a tracked old.txt moved by hand to untracked new.txt printed only rename from/to with no hunks; the --no-index fallback printed a delete plus a full add; the two paths differ and lenses/graph see no content — fix: add --no-renames to the diff (both paths) so an intent-to-add file is always a new-file entry; test both paths on a hand-moved file
- **In a sparse checkout an untracked file outside the cone makes the whole verb exit 1** — `src/lib/kit/diff-range.js:284` (correctness): git add -N refuses paths outside the sparse-checkout definition; that stderr does not match the fallback regex, so the verb exits 1 with a mislabelled 'cannot list the untracked files' error; the fallback works — fix: pass --sparse to add -N (an older git without it already takes the fallback) and relabel the error 'cannot add the untracked files to the temporary index'
- **A range whose only changes were skipped by the caps exits 3, which w-review reports as no change to review** — `src/lib/kit/diff-range.js:322` (correctness): a repo whose only change is a 9 MB new file exits 3 with only a stderr note; same with --max-untracked 0; the header's own rule says an unread untracked path is never exit 3 — fix: when the diff is empty but skipped holds max\_untracked or too\_large entries, exit 1 naming the skipped files; test a single oversized new file

## Low (1)

- **With core.splitIndex on, add -N on the temporary index writes a new sharedindex file into the real .git** — `src/lib/kit/diff-range.js:283` (correctness): one run left a new .git/sharedindex.\<sha\>; the verb writes to a repository it claims only to read — fix: run the add and the diff with -c core.splitIndex=false
