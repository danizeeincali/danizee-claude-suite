# Review f5484cfd-2ce7-48d6-95f8-e6f75cc03ba2 — bc, round 6

- Commit: 622f44a
- Angle: facts and content
- Result: pass
- 5 findings

## Low (5)

- **Step 1 kit-missing branch points to a fallback 'below' that is above** — `src/plugins/dot-shortcuts.js:3701` (facts): The no-kit branch prints 'use the fallback below' but the git diff fallback is in Step 1's prose before the block, and no scoring is given for the fallback path. — fix: Change the message to 'use the git diff fallback in Step 1's text' or move the fallback sentence after the block.
- **'a range over 32 MiB' is exit 2 only up to 64 MiB** — `src/plugins/dot-shortcuts.js:3699` (facts): diff-range exits 2 over graph's maxDiffBytes (32 MiB) but defaultGit reads git stdout with maxBuffer 64 MiB and an overflow is KitExit 1, so a range over 64 MiB is exit 1. — fix: Say 'a range over 32 MiB (exit 1 when git's output passes 64 MiB)' or leave the size out of the exit-2 list.
- **Category scoring counts '+++ \<path\>' header lines as added content** — `src/plugins/dot-shortcuts.js:3709` (correctness): The greps match ^\[+\].\* and diff-range runs with --no-prefix, so each file's +++ path header is scored; a path holding auth, token, module, cache or error adds points whatever the change. — fix: Exclude headers, e.g. '^\[+\](\[^+\]|$).\*(…)' or grep -v '^+++ ' before counting.
- **Lead's relay re-check uses $MB, but nothing hands MB to the lead** — `src/plugins/dot-shortcuts.js:3841` (process): CHECKPOINT 4 has the lead run push-gate check --base "$MB" after the go, but MB lives only in the background agent and on a branch stop was never recorded, so the lead always runs with an empty MB. — fix: Say the lead records MB itself (Phase 3's record line) before pushing the branch on a branch stop, and have the agent's summary carry MB=\<sha\> for a main stop.
- **Step 1 real-kit test accepts either of two categories and skips diff-range failure paths** — `test/w-background-compound-command.test.js:642` (test-quality): The fixture scores bug 4 against security 3 but the test asserts /CATEGORY=(security|bug)/; it never runs Step 1's diff-range exit 1 or exit 2 branches. — fix: Assert CATEGORY=bug; add a case that makes diff-range fail (include.path in .git/config for exit 2) and assert the stderr message plus CATEGORY=feature.
