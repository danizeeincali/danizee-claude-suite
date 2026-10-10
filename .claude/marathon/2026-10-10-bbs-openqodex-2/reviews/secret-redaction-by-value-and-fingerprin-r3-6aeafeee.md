# Review 6aeafeee-e00a-42ef-a93d-abdccb15e16c — secret-redaction-by-value-and-fingerprin, round 3

- Commit: e270249
- Angle: older environments and degraded networks
- Result: over tolerance
- 2 findings

## High (1)

- **Git older than 2.31 does not reject --path-format: it echoes it, and redaction silently fails open** — `src/lib/kit/redact.js:126` (security): The new non-zero-status branch (lines 129-133, mirrored in .claude/helpers/kit/redact.js) assumes git versions without --path-format fail with 'error: unknown option'. Real git rev-parse before 2.31 (Ubuntu 20.04 has 2.25, Debian 11 has 2.30, RHEL 8 ships 2.2x) does not do that. It passes unknown dash-arguments through show\_flag, so it prints '--path-format=absolute' as its first output line and exits 0. secretsRoots then returns top='--path-format=absolute' (common is the toplevel path, whose basename is not .git). run() reads '--path-format=absolute/.claude/kit/secrets', resolved against process.cwd(), gets ENOENT, and readFileOr treats that as 'no secrets file'. The result is zero secrets and stdin passed through unredacted with exit 0. So on exactly the older environments the new diagnostic is meant for, the command leaks every secret instead of failing closed. — fix: After a zero-status run, check that the output has exactly two lines and that both are absolute paths (path.isAbsolute(top) && !top.startsWith('-')). Otherwise throw a KitExit such as 'git \>= 2.31 required (rev-parse --path-format); pass --secrets-file'. You could instead drop --path-format and resolve --show-toplevel and --git-common-dir against cwd yourself.

## Low (1)

- **Old-git test fakes a stderr that real old git never produces** — `test/kit-secret-redaction-by-value-and-fingerprin.test.js:296` (test-quality): The test stubs spawn to return status 128 with 'error: unknown option \`path-format=absolute''. Real pre-2.31 git exits 0 and echoes the flag on stdout. The test therefore certifies a code path that never runs on old git, and it does not cover the fail-open case. It passes while the behaviour it names is wrong. — fix: Add a case with stub output { status: 0, stdout: '--path-format=absolute\n/repo\n.git\n' } and assert that secretsRoots throws a KitExit and does not return a relative root.
