# Review 9c835f58-172d-46fa-bdce-f2446d74e785 — isolated-tool-free-wording-judge, round 2

- Commit: f8897c3
- Angle: failure conditions and error paths
- Result: pass
- 2 findings

## Medium (1)

- **Mid-batch usage-limit stop and per-case error path are untested** — `src/lib/kit/wording-judge.js:162` (test-quality): The docs (w-marathon.md, dot-shortcuts.js) promise that 'A usage limit or login wall stops it at once', and the code has a distinct stop path after the probe has passed (line 162: break with stopped='usage limit or login wall during the batch') plus a per-case 'error' record path (line 163). The tests only cover a failing probe (limit/login/crash before any judging call); no test has the probe succeed and a later judging call hit a limit or fail, so neither the break (no further calls spent, earlier cases kept, case not recorded so --resume retries it) nor the status:'error' record is checked. A regression here would silently keep spending calls after a limit. — fix: Add a stub mode where the probe answers OK but judging calls return is\_error with a usage-limit message (and one that exits non-zero with plain text); assert stopped matches /during the batch/, calls===1, the log shows exactly one judging call, and a non-limit failure yields status 'error' that --resume retries.

## Low (1)

- **Login wall mid-batch with exit 0 does not stop the batch** — `src/lib/kit/wording-judge.js:162` (correctness): The probe treats any LIMIT\_RE match as a stop even at exit 0 (the 'login' stub mode exits 0 without is\_error), but during the batch a LIMIT\_RE match only stops when the exit code is non-zero or is\_error is set. The same exit-0 login/limit answer mid-batch is parsed as model output, recorded as 'unparsed', and the loop goes on calling the runner for every remaining case, contrary to the documented 'stops it at once'. Judging is gated on a passing probe, so this needs the session to change mid-run, hence low. — fix: When a.text has no parsable verdicts and LIMIT\_RE matches it, treat it as a stop too (for example, check LIMIT\_RE on the text whenever parseVerdicts returns no verdicts), or narrow the doc wording to non-zero/is\_error answers.
