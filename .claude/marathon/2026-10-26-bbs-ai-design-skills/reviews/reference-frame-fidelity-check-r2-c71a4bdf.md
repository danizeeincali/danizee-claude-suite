# Review c71a4bdf-d064-48b7-ad81-e3e7e7b91a59 — reference-frame-fidelity-check, round 2

- Commit: 9584c13
- Angle: correctness
- Result: pass
- 1 findings

## Medium (1)

- **/dev/ and /proc/ input paths are not refused, so /dev/stdin redirected from a file is read** — `src/lib/kit/fidelity.js:521` (correctness): rules.md (Input reading, added after r2 reviews) says to also refuse any path that resolves under /dev/ or /proc/, so /dev/stdin is refused even when stdin is redirected from a regular file. readRegular only checks fstat().isFile() on the handle. Confirmed: \`cli.js fidelity --ref /dev/stdin --actual a.png \< a.png\` exits 0 with identical:true, and \`--ref /proc/self/fd/0 --actual a.png \< b.png\` scores the redirected file. Whether the judge reads /dev/stdin then depends on how the runner wired stdin (a pipe is refused, a file redirect is scored), which is the inconsistency the rule exists to remove. No test covers the /dev/ or /proc/ refusal. The same code is in .claude/helpers/kit/fidelity.js. — fix: In readRegular, resolve the path (fs.realpath, or path.resolve when realpath fails) and refuse with KitExit 1 '\<flag\> \<file\> is not a regular file' when it is /dev or /proc or lies under /dev/ or /proc/, before opening. Add a unit test for --ref /dev/stdin and /proc/self/fd/0 with a regular file supplied explicitly, not the runner's stdin. Copy the change to both files.
