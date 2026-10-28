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

## Input reading (promoted 2026-10-26 after the same defect in two round-1 reviews)

- Every design verb reads input one way: `--file` must be a regular file (`fs.stat(...).isFile()`, else exit 1 naming
  it; a FIFO, device or `/dev/stdin` is refused) and is read with a bounded read of at most 8 MiB + 1 bytes; stdin is
  read with `io.stdinBytes({ maxBytes: MAX + 1 })` and the cap is counted in **bytes**, never `text.length`.
- An empty flag value (`--file ""`) and a repeated flag are refused with exit 1.
- Content sniffing never depends on how the input arrived: `--file x.md` and the same text on stdin give the same result
  (pass `--format` or decide from the text alone, ignoring fenced code).
- Tests: unit tests drive `stdinBytes` (over-cap with multibyte text, and a happy path); the packaged test drives both
  stdin and `--file` through the installed CLI.

## Linear time on capped input (promoted 2026-10-26: quadratic scans in three streams)

- An 8 MiB cap bounds work only if the work is linear. Line numbers come from newline offsets computed once (binary
  search or a forward walk), never a rescan from 0 per hit.
- No regex may rescan to the end of the input for every unclosed opener (`<script`, `<!--`, `<a`, a tag whose
  unquoted attribute class allows `<`): find closers with indexOf from the opener and stop at the first miss.
- Recursive walkers over parsed JSON use an explicit stack or refuse deep nesting with exit 1.
- Each verb with a scanner has a timing test: about 2 MB of adversarial input finishes in under 2 s.
- (added after r2 reviews) Implement the regular-file check on the open handle: `fs.open(p, O_RDONLY | O_NONBLOCK)`,
  then `fh.stat().isFile()`, then the bounded read. Also refuse any path that resolves under `/dev/` or `/proc/` (so
  `/dev/stdin` is refused even when stdin is redirected from a regular file). Tests must not depend on the runner's stdin.
