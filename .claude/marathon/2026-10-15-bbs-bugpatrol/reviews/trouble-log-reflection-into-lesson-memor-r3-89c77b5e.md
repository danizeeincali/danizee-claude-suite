# Review 89c77b5e-c01f-4c66-8474-1173ca84a979 — trouble-log-reflection-into-lesson-memor, round 3

- Commit: 1622483
- Angle: older environments and degraded networks
- Result: over tolerance
- 2 findings

## High (1)

- **trouble-log quietly skips redaction when git is missing or rev-parse fails** — `src/lib/kit/reflect.js:351` (security): loadSecrets catches every error from secretsRoots, including 'cannot run git' (git not installed) and 'git rev-parse failed' (for example git's 'dubious ownership' refusal in a container or CI checkout with a mounted repo). It then falls back to \[cwd\]. The secrets file is git-ignored and usually exists only in the main checkout, so a run from a linked worktree or a subfolder finds no secrets. The verb then exits 0 with secrets=\[\] and prints the raw text. Confirmed: main checkout with .claude/kit/secrets = 'SuperSecretToken123', run from a linked worktree. With git on PATH the output is 'failed: Login - bad \[REDACTED\]'. With git removed from PATH, or with GIT\_DIR=/nonexistent, it is 'failed: Login - bad SuperSecretToken123', exit 0. In the same setup the redact verb exits 1 with 'cannot run git'. This output goes straight to the reviewer model in /w-fix and /w-bbs. No test covers the fallback. — fix: Catch only the 'not inside a git repository' case, or none at all. For any other secretsRoots error, exit 1 and tell the user to pass --secrets-file, as the redact verb does. Add a test that runs trouble-log with git unavailable (a stubbed spawn or an empty PATH) and checks for exit 1, not unredacted output.

## Medium (1)

- **Live lock is broken at once when the holder is in another PID namespace under the same hostname** — `src/lib/kit/state-lock.js:51` (correctness): deadOnThisHost decides a lock is 'this host' by hostname alone, and then calls kill(pid, 0). Containers started with --network host or --uts=host, or with the same compose hostname, share a hostname but not a PID namespace. When they share a mounted volume, the holder's pid is not visible from the waiter, so kill returns ESRCH. The waiter then judges a live, heartbeating lock stale and breaks it on its first poll. Two writers then load and save lessons.json at the same time, and the later rename drops the other's lesson or keep or retire. Confirmed: a fresh lock {host: os.hostname(), pid: 4000000, token: 'live-holder...'} is acquired over in 37 ms. A live holder should get the full staleMs wait. — fix: Make the shortcut stricter: also record a boot/namespace id in the lock (for example the readlink of /proc/self/ns/pid where it exists) and apply the dead-pid shortcut only when it matches. Otherwise fall back to the unchanged-content-for-staleMs rule. Add a test with a matching hostname and a different namespace id that expects the full wait.
