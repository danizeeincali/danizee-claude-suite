# hardened-git-read-on-untrusted-repo — rebuild

## Idea (in our words)
When you read or diff a repository you did not write (a fetched branch, a pull request checkout, a cloned sample), git itself can run code from that repo's config: hooks, clean and smudge filters, the file system monitor, and submodule updates. This power wraps every git call so those are disabled first. It reads the folder's own filter driver names and neutralises each one with empty commands, sets flags that stop lazy object fetches and optional locks, removes every inherited GIT_ environment variable so an outer shell cannot point git at another repository, and runs the process with a closed stdin when no input is given. Diffs add flags that disable external diff and text conversion. It refuses a driver name it cannot switch off safely rather than skipping it. Useful for a personal suite that inspects other people's code: route all read-only git calls through one wrapper that builds these overrides once per folder and caches them.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.303Z
- Evidence: repo/packages/core/src/safe-git.ts:1-74

## What we have
missing — None of the five candidates wraps git calls. Outside the candidates, src/lib/bbs/fetch.js cloneEnv hardens only our own clone and rev-parse (hooks off, global config off, lfs off); there is no general read-only git wrapper for diff, log or filter drivers.

## Finish line (5 checks, written before the build)
- `tests_green_hardened-git-read-on-untrusted-repo`: hardened-git-read-on-untrusted-repo: green unit runs in a row
- `egress_zero_hardened-git-read-on-untrusted-repo`: hardened-git-read-on-untrusted-repo: zero egress in the packaged check
- `six_sigma_hardened-git-read-on-untrusted-repo`: hardened-git-read-on-untrusted-repo: clean reviews in a row
- `callers_hardened-git-read-on-untrusted-repo`: hardened-git-read-on-untrusted-repo: callers in the harness
- `packaged_hardened-git-read-on-untrusted-repo`: hardened-git-read-on-untrusted-repo: packaged check passes

## Kickoff lines

Done means
- tests_green_hardened-git-read-on-untrusted-repo — green unit runs in a row
- egress_zero_hardened-git-read-on-untrusted-repo — zero egress in the packaged check
- six_sigma_hardened-git-read-on-untrusted-repo — clean reviews in a row
- callers_hardened-git-read-on-untrusted-repo — callers in the harness
- packaged_hardened-git-read-on-untrusted-repo — packaged check passes

You may decide on your own
- How to structure the code behind each power's interface, within its brief
- Test names, fixtures and file layout

Ask me before
- Adding a dependency
- Any network call, account, purchase or signature
- Changing a finish line

Never
- Never execute fetched foreign code
- Never copy source code from the source

