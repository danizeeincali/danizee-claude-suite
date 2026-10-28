# Review 55588525-a6d1-476c-b849-a30a5f588e17 — context-split-showcase-or-website, round 2

- Commit: 498ec58
- Angle: r2
- Result: pass
- 2 findings

## Medium (1)

- **--file /dev/stdin is accepted when stdin is redirected from a regular file** — `src/lib/kit/motion-plan.js:146` (correctness): rules.md says a FIFO, device or /dev/stdin given to --file is refused with exit 1. The code only checks fs.stat(p).isFile(), and stat follows /dev/stdin -\> /proc/self/fd/0. When stdin is redirected from a regular file, that check passes. Confirmed: \`node .claude/helpers/kit/cli.js motion-plan --file /dev/stdin \< plan.json\` exits 0 and prints a plan. The same holds for /dev/fd/N and /proc/self/fd/N. The unit test '--file refuses /dev/stdin' passes only because the test runner's stdin happens not to be a regular file, so it depends on the environment: run it under \`node --test ... \< somefile\` and it would fail or misbehave. Same code in .claude/helpers/kit/motion-plan.js. — fix: Before the stat, refuse a path whose fs.realpath (or the resolved path itself) is /dev/stdin, /dev/fd/\* or /proc/\*/fd/\*, or simply refuse any path under /dev or /proc, with KitExit 1 naming it. Apply to both copies, and have the test pass a regular file as stdin so it does not depend on the environment.

## Low (1)

- **isFile check runs on the path before open, not on the opened handle** — `src/lib/kit/motion-plan.js:149` (correctness): run() calls fs.stat(p) and then readBounded calls fs.open(p, 'r') on the same path. If the path is replaced by a FIFO in between, fs.open with no writer blocks forever, and the regular-file check never sees it. It is a narrow race, but it is the hang the rule is meant to prevent. Same code in .claude/helpers/kit/motion-plan.js. — fix: Open with fs.constants.O\_RDONLY | O\_NONBLOCK, then run fh.stat() on the open handle and refuse unless isFile(); keep the bounded read. Apply to both copies.
