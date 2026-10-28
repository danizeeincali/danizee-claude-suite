# Review 1468037c-ce75-458f-bcba-da4c0027dbd1 — intake-batch-before-design, round 1

- Commit: 23fb32c
- Angle: one input method at a time
- Result: pass
- 4 findings

## Medium (2)

- **--file on a pipe or FIFO bypasses the 8 MiB input cap** — `src/lib/kit/design-brief.js:211` (correctness): The --file path enforces the cap only through fs.stat().size, which is 0 for a pipe, FIFO or /dev/fd/N (for example \`--file /dev/stdin\` or shell process substitution \`--file \<(cmd)\`). fs.readFile then reads the whole stream with no limit. Confirmed: a 9 MiB body piped through \`--file /dev/stdin\` is accepted with exit 0, while the same body on plain stdin is refused with 'input is larger than 8 MiB'. So the contract's 'at most 8 MiB' holds for one input method and not for the other. The same code is in .claude/helpers/kit/design-brief.js. — fix: Refuse anything that is not st.isFile(), or read through a file handle with a bounded read of MAX\_BYTES+1 bytes and refuse when that limit is passed.
- **The stdinBytes path and the stdin 8 MiB refusal are never tested** — `test/kit-intake-batch-before-design.test.js:11` (test-quality): The fake io in the unit test supplies only stdin(), so readInput always takes the io.stdin() fallback. The io.stdinBytes branch, which the real cli.js uses, and its 'input is larger than 8 MiB' refusal are never run by a unit test. The packaged test sends only a small body. The 8 MiB limit is named in the contract, but only the --file side of it is asserted. — fix: Add a fake io with stdinBytes that returns MAX\_BYTES+1 bytes and assert the run rejects with /8 MiB/ and code 1, plus one happy-path run through stdinBytes.

## Low (2)

- **An empty --file value silently falls back to stdin** — `src/lib/kit/design-brief.js:208` (correctness): \`--file ""\` passes the parser's value check, but \`if (flags.file)\` treats '' as absent, so the verb reads stdin instead. Confirmed: \`echo '{"kind":"ui"}' | cli.js design-brief questions --file ""\` succeeds using stdin. Run on a TTY, the error is 'no input: pass the brief JSON on stdin or --file', which is misleading because --file was passed. The parser also refuses a file whose name starts with '--', and a repeated --file silently keeps the last value. — fix: Test \`flags.file !== undefined\` and refuse an empty value in run(): \`if (!flags.file) throw bad('--file needs a value')\`.
- **Packaged test drives only stdin, never --file, through the installed CLI** — `test/kit-intake-batch-before-design-packaged.test.js:12` (test-quality): Each input method should complete the task end to end. The packaged check covers stdin only. The --file path, which depends on the real process.cwd() given by the installed cli.js, is tested only with the unit test's fake io. — fix: In the packaged test, write the body to a temp file in the package dir and assert \`design-brief assume --file \<f\>\` exits 0 with the same assumptions as the stdin run.
