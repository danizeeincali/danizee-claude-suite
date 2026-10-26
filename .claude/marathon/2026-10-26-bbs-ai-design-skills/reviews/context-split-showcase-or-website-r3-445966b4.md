# Review 445966b4-4b37-4202-8f8c-0abec642cc24 — context-split-showcase-or-website, round 3

- Commit: c6a85ba
- Angle: correctness
- Result: pass
- 1 findings

## Low (1)

- **Redirected-stdin /dev/stdin check passes even when cli.js is never found** — `test/kit-context-split-showcase-or-website.test.js:715` (test-quality): spawnSync runs the relative path '.claude/helpers/kit/cli.js', which resolves against the runner's cwd, and then asserts only r.status === 1. If node --test is started from any directory other than the worktree root (an IDE runner, a monorepo script, CI with a different working-directory), node fails with 'Cannot find module' and also exits 1, so the test passes without ever running motion-plan. Confirmed: from /tmp the same spawn gives status 1 with a MODULE\_NOT\_FOUND stack. The case that round 2 asked to have proven (stdin redirected from a regular file is still refused) is then not checked, and the test depends on the environment, which rules.md forbids ('Tests must not depend on the runner's stdin', 'Each test run gets its own temp folder'). — fix: Resolve the CLI from the test file: fileURLToPath(new URL('../.claude/helpers/kit/cli.js', import.meta.url)), and also assert that r.stderr matches /\/dev or \/proc/ so a crash or a missing module cannot satisfy the check.
