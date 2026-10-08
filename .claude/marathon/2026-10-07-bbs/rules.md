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

## Project rules — 2026-10-07-bbs

- Never execute fetched foreign code. `/w-bbs` reads sources; it never runs them. The sandbox check
  only decides whether `use` is legal; nothing in this run runs a sandbox.
- Egress is GET only, and only to hosts the owner named. No request body, no auth header, private
  hosts and private redirects refused, every request logged to `egress.jsonl`.
- No live network in the test suite: `fetch`, `dns.lookup` and `git` are injected and stubbed.
- Helpers return JSON only where the contract says JSON; prose is a defect, not a result.
- Zero new npm dependencies; the bbs library is copied verbatim into `.claude/helpers/bbs/`.
- A finished stream is merged into local `main` with a local commit before the next stream's
  worktree is created. Nothing is pushed.
- Every `src/lib/bbs/*` module has a test file; every CLI verb has an e2e path through the
  installed copy.

## Promoted from reviews (seen twice)

- **Claim atomically, commit last** (`correctness`, reviews intake-r1 + intake-r2). Any run, file or
  id that two processes could create is claimed with an exclusive operation (`mkdir` without
  `recursive`, `open` with `wx`, tmp-file + `rename`), and the file that marks a step as done is
  written **last**. A half-made run must never read as complete; a check-then-write gap is a defect.
- **Fail loudly, never fall back silently** (`other`, reviews intake-r1 + intake-r2). Every failure
  names its cause and the file or input involved; a missing tool, a non-object config or an
  unresolvable project root is an error (or a stderr warning naming the fallback), never a quiet
  default that moves state somewhere the user does not expect.
- **Nothing the user did not name is read, and nothing secret is kept** (`security`, reviews
  intake-r1 + intake-r4). Every path, run id and config value is checked to sit under its root
  before use; `git` runs with an explicit directory and a scrubbed environment (no `GIT_DIR`,
  `GIT_WORK_TREE`, `GIT_CONFIG_*`); a source ref is redacted (userinfo removed, token-like query
  values masked) before it is printed, persisted or logged.

## Stream close vs run-wide gate (lead decision, 2026-10-07, after intake r5)

- `cli.js gate --stream <s>` scopes `runs.streak:*`, `reviews.*` and `findings.open:*` to the
  stream, but `e2e_streak`, `packaged`, `helpers_over_budget` and `pushed` are run-wide by nature
  and cannot be met before the last stream exists. A stream therefore **closes** when its own lines
  are met: `clean_reviews`, `latest_high`, `open_high`, `unit_streak`, with every finding from its
  reviews closed and the fixes reviewed. The run-wide lines are judged by plain `cli.js gate` at the
  end. Follow-up for the marathon core (additive): a `scope: run|stream` field on finish-line lines
  so the per-stream gate can say this itself.
- **Every message names the real state** (`facts`, reviews intake-r1 + intake-r6). An error or
  status line says which input, file or pointer it is about (stdin vs file vs argument; a flag vs
  ACTIVE), and dates, limits and formats quoted in text are read from the same constant the code
  enforces, never retyped.
- **A test proves the boundary and the switch** (`test-quality`, reviews fetch-r1 + inventory-r1).
  Every limit is tested at N (passes) and N+1 (refused); every flag or option has a test showing
  it changes behaviour, not only that it parses; every input shape the contract names (each source
  type, symlinks, fenced/CRLF input, stdin vs file) has its own case. A test that passes when the
  feature is deleted is a missing test.
- **Walk only what you will use** (`performance`, reviews inventory-r1 + inventory-r2). A file walk
  skips vendor and build directories, uses the directory entry's type before any `lstat`, batches
  per directory, and stops collecting once the cap is reached (counting the rest). Sort, then slice.
