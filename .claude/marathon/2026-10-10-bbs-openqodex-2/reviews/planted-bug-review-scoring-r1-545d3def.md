# Review 545d3def-61ce-4e8d-91e2-e121b80d6290 — planted-bug-review-scoring, round 1

- Commit: 04bda59
- Angle: one input method at a time
- Result: over tolerance
- 4 findings

## High (1)

- **Repo-root finding paths never match fixture-relative spec paths** — `src/lib/kit/review-score.js:105` (correctness): Step 4.5a (.claude/commands/.shortcuts/w-marathon.md:95, src/plugins/dot-shortcuts.js:3931) has the calibration reviewer use the same brief shape as 4.5, and that brief's row format asks for "file": "path/from/repo/root". A reviewer that follows it reports .claude/helpers/kit/review-fixtures/repos/cache-leak/src/cache.js. normPath only rewrites backslashes, './' and repeated slashes, so this never equals the spec's 'src/cache.js'. Reproduced: scoreCase(cache-leak spec, finding with that repo-root path, line 5, performance, 'leak') returns 0 hits and 1 false positive. A correct reviewer gets recall 0 and every case fails, so the calibration wrongly says the prompt needs work. — fix: Match a finding when its normalised path ends with '/'+spec file (or strip a known fixture-root prefix), or tell the 4.5a brief to cite paths relative to the fixture folder; add a test with a repo-root path.

## Low (3)

- **String line numbers with whitespace or a decimal are dropped** — `src/lib/kit/review-score.js:106` (correctness): Only /^\d+$/ strings are converted to numbers. A row with line " 5" or "5.0" (as it can come back from the record finding CLI's key=value strings) gets line null and can never be a hit. Reproduced: both return 0 hits on the cache-leak bug. — fix: Trim the string and accept Number(x) when Number.isInteger(Number(x)).
- **A review file with an upper-case .JSON extension is silently skipped** — `src/lib/kit/review-score.js:153` (correctness): listJson filters on e.name.endsWith('.json'), so \<cal\>/reviews/tidy-clean.JSON is ignored and the case scores as a missing, unfinished review with no warning. Reproduced via scoreFolders: tidy-clean shows up in missing\_reviews. — fix: Compare the extension case-insensitively, or report non-.json files that are skipped.
- **The 'bare array' test never passes a bare array** — `test/kit-planted-bug-review-scoring.test.js:69` (test-quality): The test named 'accepts marathon review rows as a bare array' passes {case, completed, rows}, which exercises the 'rows' alias. The bare-array path (normaliseReview with fallbackCase taken from the file name, used in scoreFolders) has no test. scoreCase(spec, \[rows\]) actually throws because no fallback case is given. — fix: Rename this test to cover 'rows', and add a scoreFolders test that saves a bare array as \<case\>.json and checks it is scored for that case.
