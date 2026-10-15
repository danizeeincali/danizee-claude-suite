# SARIF JUnit and sticky PR comment renderers — rebuild

## Idea (in our words)
Keep the report layer free of I/O so each renderer is a pure function that is easy to test. SARIF should mark only blocking findings as errors and everything advisory as warnings or notes, so code-scanning views do not overstate the result. JUnit should attribute each failure to the test case that produced it, keep orphan findings rather than dropping them, and add an explicit incomplete-run error when the run did not finish. The PR comment should lead with one verdict line, separate blocking, filed and needs-decision items, and carry a hidden marker so a later run edits the same comment instead of appending another. Adopt these three renderers for the kit's review and CI output, and escape all text for XML.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.350Z
- Evidence: packages/report/src/sarif.ts:4-53, packages/report/src/junit.ts:4-57, packages/report/src/pr-comment.ts:4

## What we have
missing — No candidate renders SARIF, JUnit or a sticky PR comment; review-score.js writes plain scores.json and package.json test only runs node --test.

## Lands in (a separate deliverable)
- job `job:.github/workflows/test.yml` · test.yml · advisory — reached by: Runs on pull requests; the report is uploaded and commented there.; Renders findings to SARIF, JUnit XML and one sticky PR comment edited in place.
- `/w-review` · ⛔ CHECKPOINT 5: Compound (MANDATORY - NEVER SKIP) · advisory — Renders the review's findings as SARIF, JUnit and a PR comment.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_sarif-junit-and-sticky-pr-comment-render` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_sarif-junit-and-sticky-pr-comment-render`: sarif-junit-and-sticky-pr-comment-render: green unit runs in a row
- `egress_zero_sarif-junit-and-sticky-pr-comment-render`: sarif-junit-and-sticky-pr-comment-render: zero egress in the packaged check
- `six_sigma_sarif-junit-and-sticky-pr-comment-render`: sarif-junit-and-sticky-pr-comment-render: clean reviews in a row
- `wired_sarif-junit-and-sticky-pr-comment-render`: sarif-junit-and-sticky-pr-comment-render: wired into all 2 targets, reached by a user
- `packaged_sarif-junit-and-sticky-pr-comment-render`: sarif-junit-and-sticky-pr-comment-render: packaged check passes

## Kickoff lines

Done means
- tests_green_sarif-junit-and-sticky-pr-comment-render — green unit runs in a row
- egress_zero_sarif-junit-and-sticky-pr-comment-render — zero egress in the packaged check
- six_sigma_sarif-junit-and-sticky-pr-comment-render — clean reviews in a row
- wired_sarif-junit-and-sticky-pr-comment-render — wired into all 2 targets, reached by a user
- packaged_sarif-junit-and-sticky-pr-comment-render — packaged check passes

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

