# planted-bug-review-scoring — rebuild

## Idea (in our words)
Grade a reviewer by scoring its saved output offline. Plant known bugs in a small repository, then count a finding as a hit only when three things agree: it points at the planted line range within a tolerance, it uses one of the allowed issue categories, and its text names one of the expected keywords at the start of a word. Anything close but wrong on one of those tests is reported as a near miss and counts against precision, not recall. A second hit on an already-found bug is a duplicate and is kept out of precision. Real side issues that were never planted go on an accepted list so they are not punished. Clean repositories, which have nothing planted, turn every finding into a false positive and pass only when the review completes with no findings. Ratios are summed hits over summed checks rather than averages of averages, and paths are normalised before comparing. The scorer reads only saved files and copies of the specs taken at run time, so editing a spec later does not change an old score. A personal suite could rebuild this as a small local script that scores its own review skill against a folder of seeded-bug fixtures.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.309Z
- Evidence: repo/benchmark/lib/score.mjs:1-60, repo/benchmark/lib/score.mjs:97, repo/benchmark/lib/score.mjs:108, repo/benchmark/lib/score.mjs:200, repo/benchmark/cases/django-model-view/case.json

## What we have
missing — No candidate scores saved review output against planted-bug specs; marathon streak and reviewer helpers track streaks and review rounds, not hits or precision.

## Finish line (5 checks, written before the build)
- `tests_green_planted-bug-review-scoring`: planted-bug-review-scoring: green unit runs in a row
- `egress_zero_planted-bug-review-scoring`: planted-bug-review-scoring: zero egress in the packaged check
- `six_sigma_planted-bug-review-scoring`: planted-bug-review-scoring: clean reviews in a row
- `callers_planted-bug-review-scoring`: planted-bug-review-scoring: callers in the harness
- `packaged_planted-bug-review-scoring`: planted-bug-review-scoring: packaged check passes

## Kickoff lines

Done means
- tests_green_planted-bug-review-scoring — green unit runs in a row
- egress_zero_planted-bug-review-scoring — zero egress in the packaged check
- six_sigma_planted-bug-review-scoring — clean reviews in a row
- callers_planted-bug-review-scoring — callers in the harness
- packaged_planted-bug-review-scoring — packaged check passes

You may decide on your own
- How to structure the code behind each power's interface, within its brief
- Test names, fixtures and file layout

Ask me before
- Adding a dependency
- Any network call, account, purchase or signature
- Changing a finish line

Never
- Never execute fetched foreign code
- Never copy source code from the source

