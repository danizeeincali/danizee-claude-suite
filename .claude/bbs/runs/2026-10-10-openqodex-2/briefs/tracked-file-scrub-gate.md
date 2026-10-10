# tracked-file-scrub-gate — rebuild

## Idea (in our words)
Before publishing or pushing, walk every file git tracks and test each line against a list of forbidden regular expressions. Keep the public list in the repo and the sensitive names in a file that is git-ignored, so the check itself does not leak them. Decode UTF-16 text properly, and read every other file as UTF-8 so ASCII patterns still match inside binary files. Report each hit as file, line and the pattern that matched, then exit non-zero so the gate fails. Exclude the pattern file and the script itself so they do not match their own patterns. Run it as one step of the suite's pre-push or CI gate, next to build, typecheck and tests. Useful for a personal suite that holds client names, account ids or internal hostnames.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.308Z
- Evidence: repo/scripts/scrub.mjs:1-56, repo/scripts/scrub-patterns.txt:1-6

## What we have
missing — No candidate walks git-tracked files against forbidden regex patterns; intake.js only scrubs URL and secret-like parameters in refs.

## Finish line (5 checks, written before the build)
- `tests_green_tracked-file-scrub-gate`: tracked-file-scrub-gate: green unit runs in a row
- `egress_zero_tracked-file-scrub-gate`: tracked-file-scrub-gate: zero egress in the packaged check
- `six_sigma_tracked-file-scrub-gate`: tracked-file-scrub-gate: clean reviews in a row
- `callers_tracked-file-scrub-gate`: tracked-file-scrub-gate: callers in the harness
- `packaged_tracked-file-scrub-gate`: tracked-file-scrub-gate: packaged check passes

## Kickoff lines

Done means
- tests_green_tracked-file-scrub-gate — green unit runs in a row
- egress_zero_tracked-file-scrub-gate — zero egress in the packaged check
- six_sigma_tracked-file-scrub-gate — clean reviews in a row
- callers_tracked-file-scrub-gate — callers in the harness
- packaged_tracked-file-scrub-gate — packaged check passes

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

