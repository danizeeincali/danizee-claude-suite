# Review 7ef7d811-19f0-45fb-ac15-af2711f1c1b7 — intake, round 5

- Commit: 55e8bb2
- Angle: accessibility
- Result: pass
- 5 findings

## Medium (1)

- **Stray positional arguments are silently ignored, so \`status \<run-id\>\` reports a different run** — `src/lib/bbs/cli.js:55` (correctness): status and report never read positionals and intake uses only the first; \`status first\` prints the active run, \`report nonsense-run\` prints the active run's counts, \`intake a.txt extra\` drops extra silently. — fix: Reject positionals a verb does not take with the verb's usage plus \`unexpected argument "\<arg\>" (use --run \<id\>)\`; allow at most one positional for intake. Test per verb.

## Low (4)

- **Run-id errors name the input but not the fix** — `src/lib/bbs/cli.js:94` (accessibility): invalid run id / unknown run / already exists messages give neither the accepted format nor the next step. — fix: Append the rule and the next step to each message.
- **Usage text hides the per-verb flags and the \`-\` stdin source** — `src/lib/bbs/cli.js:139` (accessibility): Top-level usage does not name --next, --project, --as, --slug or --paste-file; INTAKE\_USAGE never says \<source\> may be \`-\` for stdin. — fix: Print each verb's usage line from FLAGS; write \<source|-\> and note that - reads stdin.
- **\`paste is empty\` does not say which input was empty** — `src/lib/bbs/intake.js:282` (accessibility): Same message for stdin and --paste-file. — fix: Name the source: paste is empty (stdin) / (--paste-file p).
- **\`report\` fails outright on a status.md write error, naming a temp file** — `src/lib/bbs/cli.js:130` (other): status warns and continues; report aborts and the error names the random tmp path. — fix: Use renderStatusSafe in report with the same warning line, naming status.md and the run dir.
