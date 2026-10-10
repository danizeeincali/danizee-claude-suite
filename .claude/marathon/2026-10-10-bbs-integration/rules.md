# Standing rules

Rules Claude reads at every wake-up and every review. Anything Claude can forget, lose or
talk itself out of lives here, in a test, or in a scripted check — never only in chat.
Add a rule the second time something goes wrong.

## Quality

- **Never weaken an assertion.** A fixer that loosens a test to make it pass has introduced a
  defect. A separate reviewer checks every fix; the next round restores the test.
- A flaky test is a bug, not noise. Fix the code or the test's isolation; never retry it away.
- "Done" means checked in the real, packaged, running thing — not only in the test suite.
- Two clean reviews in a row close a stream. The tolerance in `finish-line.json` decides what
  "clean" means; the human owns that number.
- Findings are rows with a severity and a category. The write-up is generated from the rows,
  never retyped. A category seen in two reviews becomes a test, a scan, a fixture or a rule.

## Process

- Scripts decide, the model acts: streaks, counts, budgets, gates and keep-lists come from
  `node .claude/helpers/marathon/cli.js <verb>`, never from memory or arithmetic in chat.
- Never spawn a helper after `cli.js budget` exits non-zero. Exit 2 = the ceiling or the token
  budget: finish the step, the run is PAUSED, stop. Exit 1 = broken state or invalid input: fix it,
  rerun `budget`, and only then spawn.
- Every helper gets a token budget in its brief and a row in the ledger; the actual spend is
  recorded from the task notification.
- Never build or run browser tests against the port the owner is using. Use a scratch copy on
  its own port and swap the served build once, announced.
- When a rule changes, fix the shared test helper first, then edit only the tests that still fail.
- Each test run gets its own temp folder that is cleaned up afterwards.
- Code and reviews go into git as soon as they exist. State lives in files, never only in chat.

## Ownership

- Nothing is pushed or merged without the owner's go (`/bcp` is that go for a compound).
- Lines only the human can close are listed once under "Waiting on human" and never retried.
- A problem the owner finds while using the build is an escape: record it with
  `cli.js record escape` so skipped reviews show their cost.

## This run
- The "How OpenQodex powers fit workflows" thread (run 2026-10-10-kit-wiring) edits w-bbs.md CHECKPOINTS 4 and 6
  and the bbs helper briefs. Keep edits to those sections small and additive so the two branches merge cleanly.
- A caller that counts is a step in a workflow the owner runs. A doc, a note, a review or a sibling module that
  names the verb is not a caller.
- Edit sources (src/lib/bbs, src/templates or wherever the installer copies from), then regenerate the installed
  copies; never edit only the copy.
- (promoted: correctness) A gate checks the evidence, not that a file exists: an empty or "none" record is not an
  answer. Every state file a verb reads has a --force repair path its error names, and every config value it reads
  is validated in loadConfig before any scan.
- **performance (promoted):** a loop over a capped list never rescans or re-reads per item (build the index once, e.g. a Map or Set, then look up); every scan of the owner's project has a file count and byte cap, and an eviction or cap loop must make progress each pass (no saturation spin).
