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

## Promoted in this run

- (docs, seen twice) A kit verb's header contract is checked by a test: every exit code and output field the header documents is asserted, so the header and the code cannot drift apart.
- (correctness, seen twice) Every input shape a verb's header says it accepts gets a test built from the real producer's output (run the sibling verb), never a hand-made look-alike; every documented edge (blank array items, duplicate keys, null/array JSON, inherited object keys as flags) is tested.
- (test-quality, seen twice) Tests drive the real CLI path too (a `--file` run and a piped stdin run through `node .claude/helpers/kit/cli.js <verb>`), not only an in-process fake stdin; size caps and BOM handling are tested through `--file`.
- (other, seen twice) Every documented limit or threshold must be reachable: a test shows each cap or limit actually taking effect, and each format a verb sniffs can be forced with a `--format` override.
- (performance, seen twice) Every regex or scan over user input is linear: no pattern that rescans to the end per match (unbounded lazy spans, per-match line lookups from the start); a test feeds the 8 MiB cap shape of the worst case and must finish in a few seconds.
- (facts, seen twice) Every requirement sentence in the power brief maps to code plus a test, or the header says plainly why the verb differs (a documented gap); lists the brief names are matched or the difference is explained.
- (security, seen twice) Anything a verb passes on (to a person as a question, into a saved file, or out to the network) is treated as hostile: control/format characters are refused, active content (script, embed, object, iframe, handlers) is stripped, remote fetches never reach loopback or private addresses, and each guard has a test with a real attack probe.
