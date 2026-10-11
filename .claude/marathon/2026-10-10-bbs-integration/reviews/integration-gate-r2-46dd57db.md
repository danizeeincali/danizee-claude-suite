# Review 46dd57db-ef18-46e2-9193-6556721fd005 — integration-gate, round 2

- Commit: a12f061
- Angle: failure conditions and error paths
- Result: over tolerance
- 5 findings

## Medium (3)

- **runsTest accepts reach commands whose exit cannot fail** — `src/lib/bbs/wiring.js:131` (correctness): node --test t.js || true passes runsTest and always exits 0, so a failing reach test counts as wired — fix: Reject shell control operators (; && || | & newline backtick $( ) in reach commands
- **stepSection never matches a heading in a CRLF command file** — `src/lib/bbs/wiring.js:122` (correctness): lines ending in \r fail the heading regex, so a CRLF workflow target is never wired — fix: split on /\r?\n/
- **stripComments treats apostrophes in JSX text as string quotes** — `src/lib/bbs/wiring.js:76` (correctness): Don't in JSX text opens a quote across lines, so a commented-out use counts — fix: end ' and " strings at an unescaped newline

## Low (2)

- **Reach timeout kills only the sh wrapper** — `src/lib/bbs/wiring.js:143` (correctness): the runner of a compound command is orphaned on timeout — fix: spawn detached and kill the process group
- **integrate --reach accepts an @at naming no approved target** — `src/lib/bbs/wiring.js:263` (correctness): a typo anchor is recorded and later reads as no reach test — fix: require the at to match an approved target at of that surface
