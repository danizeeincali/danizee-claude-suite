# kit stream: isolated-tool-free-wording-judge (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js wording-judge --out <review-score out> [--cap n] [--resume] [--dry] [--runner path] [--model name]`
(`src/lib/kit/wording-judge.js`), and `review-score --wording [--wording-cap n] [--wording-resume] [--wording-runner path]`.
It is an optional second opinion on review wording that never changes a score. Only the findings scoring matched to a
planted bug are sent, with the planted truth, one call per case, to `claude -p` in a sealed mode (no tools, empty strict
MCP config, no setting sources, no session persistence, no slash commands, a cheap model), via execFile with the prompt
on stdin. The script parses the JSON answer itself, drops ids it did not ask about and records unreadable answers as
`unparsed`. The plan goes to stderr before the first call; a probe runs first and a usage limit or login wall stops the
batch at once. `--resume` skips a case only when every id was judged and its sentences are unchanged. Results go to
`wording.json` beside `scores.json`, which is never touched. Caller: `review-score --wording`, documented in step 4.5a.
Tests use a stub runner, so the packaged check has zero egress.

**Rounds:** r1 pass (the plan was printed after spending; resume kept stale verdicts; a partly parsed case was never
retried; review-score still claimed it sends nothing), r2 pass (the mid-batch stop and error paths were untested; an
exit-0 login wall mid-batch did not stop the batch). All 6 findings were fixed before merge.

**Lesson:** a judge that spends money must say what it will spend before it starts, and must treat "I could not read
the answer" and "the account is blocked" as different outcomes.
