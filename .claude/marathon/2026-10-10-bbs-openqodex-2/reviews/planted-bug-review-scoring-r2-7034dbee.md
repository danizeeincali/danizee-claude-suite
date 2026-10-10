# Review 7034dbee-c5df-4c95-b39a-c16c685df417 — planted-bug-review-scoring, round 2

- Commit: 38e9ba9
- Angle: failure conditions and error paths
- Result: pass
- 3 findings

## Medium (2)

- **Fixtures announce their planted bugs in comments** — `.claude/helpers/kit/review-fixtures/repos/cache-leak/src/cache.js:5` (test-quality): cache.js:5 ('// planted bug: nothing ever evicts an entry...'), pager-off-by-one/src/pager.js:2 ('// planted bug: the last partial page is dropped') and legacy.js:2 ('real but unplanted style issue, accepted') say outright where the bug is. Step 4.5a hands these folders to the reviewer as the code to review, so a reviewer can find the bug by reading the comment, which pushes recall up and makes the calibration meaningless. The same applies to the copies under src/lib/kit/review-fixtures. — fix: Remove the 'planted bug' and 'accepted' comments from the fixture sources in both copies, and keep the explanation only in the specs' note fields.
- **Symlinked spec or review files are skipped without an error** — `src/lib/kit/review-score.js:162` (correctness): listJson skips any entry where Dirent.isFile() is false, and that includes symlinks. If a spec file is a symlink, its case drops out of the snapshot without a word and recall is computed without it. If a review file is a symlink, the case is scored as a missing, unfinished review instead of the run being refused. The header promises that input is 'refused, never silently cut', and this path breaks that. — fix: In listJson, throw bad() for an entry that is a symlink, or any other non-file whose name ends in .json, instead of skipping it with continue.

## Low (1)

- **The 1 MiB file cap and refusal exit codes are untested** — `test/kit-planted-bug-review-scoring.test.js:134` (test-quality): The header says each spec or review file is capped at 1 MiB and anything larger is refused. No test checks that an oversize review or spec is refused. readJson also turns guardedRead refusals (symlink, oversize) into exit 1, and no test pins down which code the user gets. — fix: Add a test that writes a review over MAX\_FILE\_BYTES and asserts scoreFolders rejects it with the expected message and exit code.
