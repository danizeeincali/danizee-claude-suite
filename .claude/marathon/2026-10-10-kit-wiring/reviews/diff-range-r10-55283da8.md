# Review 55283da8-fe83-4f2c-9bf9-982a797eeeaf — diff-range, round 10

- Commit: 7d3b0f0
- Angle: older environments and degraded networks
- Result: pass
- 3 findings

## Medium (1)

- **The --sparse retry never runs on a real git 2.25-2.33 because git's usage text lists --pathspec-from-file** — `src/lib/kit/diff-range.js:297` (correctness): the retry requires !/pathspec-/ on the whole stderr, but git prints the full add usage after the error line and that usage names --pathspec-from-file; so the per-file fallback is taken instead; the tests fake stderr without the usage body — fix: test only the first error:/fatal: line of stderr for both the sparse match and the pathspec exclusion; add a usage body with --pathspec-from-file to the fake stderr in the tests

## Low (2)

- **When TMPDIR is unwritable the run fails with a bare EACCES although the per-file path needs no temp folder** — `src/lib/kit/diff-range.js:287` (correctness): fs.mkdtemp is not wrapped; a read-only /tmp fails the verb as soon as any untracked file exists — fix: catch the mkdtemp/copyFile failure and fall through to the per-file path, or raise a KitExit naming TMPDIR
- **The usage line describes --json too narrowly and says it always exits 0, which the code does not do** — `src/lib/kit/diff-range.js:83` (docs): skipped also holds too\_large and max\_untracked entries; under --json the code still exits 2 for an oversized range or a config include and 1 for failures — fix: say skipped/skipped\_detail cover nested repositories and cap-skipped files, and --json exits 0 whenever a summary is printed; errors and refusals keep 1/2
