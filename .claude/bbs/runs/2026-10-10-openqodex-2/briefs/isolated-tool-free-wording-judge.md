# isolated-tool-free-wording-judge — rebuild

## Idea (in our words)
Add an optional second opinion on review wording without letting the judge change the score. The script first decides which findings matched a planted bug, then sends only those findings and their planted truth to a model in a sealed mode: no tools, no reading of the user's settings, no connectors, no session saved. The model answers as JSON with yes or no on plainness and correctness for each sentence of a finding. The script parses the answer itself, drops any verdict for an id it did not ask about, and records a failed parse as unparsed rather than inventing a result. The judge's verdict is reported beside the scores and never read by the scorer, and the exit code stays zero. Before any spend the plan prints the number of calls, a cap limits them, and a resume flag skips reviews already judged. A probe run before the batch uses the same isolation flags and a regex for usage limits and login walls, stopping the batch at once rather than logging a run of false failures. A personal suite could reuse the pattern for grading its own generated text with a cheap model.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.311Z
- Evidence: repo/benchmark/judge.mjs:1-30, repo/benchmark/judge.mjs:56, repo/benchmark/judge.mjs:103, repo/benchmark/judge.mjs:123, repo/benchmark/lib/reviewers.mjs:50, repo/benchmark/lib/reviewers.mjs:60, repo/benchmark/lib/reviewers.mjs:62

## What we have
partial — w-bbs.md — The command spawns JSON-only haiku judges for map verdicts, but has no tool-free sealed mode, call cap, usage-limit probe, or parse-and-drop logic for wording grades.

## Finish line (5 checks, written before the build)
- `tests_green_isolated-tool-free-wording-judge`: isolated-tool-free-wording-judge: green unit runs in a row
- `egress_zero_isolated-tool-free-wording-judge`: isolated-tool-free-wording-judge: zero egress in the packaged check
- `six_sigma_isolated-tool-free-wording-judge`: isolated-tool-free-wording-judge: clean reviews in a row
- `callers_isolated-tool-free-wording-judge`: isolated-tool-free-wording-judge: callers in the harness
- `packaged_isolated-tool-free-wording-judge`: isolated-tool-free-wording-judge: packaged check passes

## Kickoff lines

Done means
- tests_green_isolated-tool-free-wording-judge — green unit runs in a row
- egress_zero_isolated-tool-free-wording-judge — zero egress in the packaged check
- six_sigma_isolated-tool-free-wording-judge — clean reviews in a row
- callers_isolated-tool-free-wording-judge — callers in the harness
- packaged_isolated-tool-free-wording-judge — packaged check passes

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
- Never run the upstream code (use was removed: network probe found: the source makes a network call the inventory does not account for)

