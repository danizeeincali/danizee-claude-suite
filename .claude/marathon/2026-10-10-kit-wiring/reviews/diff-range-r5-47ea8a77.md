# Review 47ea8a77-4348-4a8f-a396-f3f4258f7c43 — diff-range, round 5

- Commit: 7563d5a
- Angle: accessibility (checking the security fix)
- Result: pass
- 5 findings

## Medium (2)

- **--ignore-submodules=all makes a committed submodule pointer bump disappear (exit 3)** — `src/lib/kit/diff-range.js:82` (correctness): a superproject pointer bump with --base HEAD~1 prints nothing and exits 3; with a hostile submodule config, --ignore-submodules=dirty printed the pointer change and ran no program, while none ran the submodule's clean filter — fix: use --ignore-submodules=dirty on both diffs (the flag overrides diff.ignoreSubmodules=all); test a pointer bump in range with a planted filter not running; update the header
- **An include.path in the untrusted repo's config is followed with no timeout: a FIFO hangs the verb forever** — `src/lib/kit/diff-range.js:123` (security): mkfifo .git/inc + git config include.path inc made git config -z --list block forever; defaultGit uses spawnSync with no timeout; safe-git uses --no-includes and a timeout on every child — fix: pass a timeout to every git child and exit 1 on expiry with a plain message, and/or read the config with --no-includes (then includes are data not followed); name the remaining gap in the header

## Low (3)

- **Many driver names overflow GIT\_CONFIG\_PARAMETERS: E2BIG with a jargon error** — `src/lib/kit/diff-range.js:93` (accessibility): 600 filter sections make spawnSync fail with E2BIG (128 KiB single env string cap); it fails closed but the message says nothing useful — fix: put per-driver pairs on argv as -c options (as safe-git does) and keep only the statics in the env, or exit 1 with 'too many filter/diff/merge drivers configured (N) to switch off safely'
- **Partial-clone error text is nested and jargon-heavy with no runnable next step** — `src/lib/kit/diff-range.js:101` (accessibility): the message nests parentheses two deep and uses promisor/GIT\_NO\_LAZY\_FETCH/transports without a command — fix: one plain sentence with a command: this is a partial clone and some file contents are not downloaded; diff-range never downloads; run git -C \<dir\> diff \<base\> \>/dev/null once, or use a full clone
- **No test checks that every git call carries the hardened env or that an inherited GIT\_CONFIG\_PARAMETERS is replaced** — `test/kit-diff-range.test.js:331` (test-quality): the planted-config test proves the programs do not run during the diffs but no test records the env per call; a future call through the unwrapped runner would pass the suite — fix: add a recording fake around defaultGit asserting every call's env has the overrides, GIT\_NO\_LAZY\_FETCH=1 and GIT\_LFS\_SKIP\_SMUDGE=1, and that a caller's GIT\_CONFIG\_PARAMETERS is dropped
