# Review 5519bc89-613c-4ea6-937a-95846e45cd13 — intake, round 4

- Commit: 5b7551c
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 4 findings

## Medium (2)

- **URL/repo credentials in the source ref are saved in plaintext to source.json, status.md and stdout** — `src/lib/bbs/intake.js:176` (security): storedRef keeps userinfo and the query string as given; a ref like https://alice:ghp\_SECRET@host/x?token=abc lands in source.json, the JSON result and status.md, and later in egress.jsonl and the registry. — fix: Refuse refs with userinfo (or strip it) and redact query values whose key looks like token/key/secret/sig/auth in every persisted or printed copy of ref. Test that no ghp\_-style string reaches source.json or status.md.
- **git rev-parse HEAD inherits GIT\_DIR/GIT\_WORK\_TREE from the environment, so identity can come from a repo the user did not name** — `src/lib/bbs/intake.js:25` (correctness): defaultGit runs with the full process.env; with GIT\_DIR set, git ignores cwd and the run gets another repo's identity, so lookupSource can attach reuse\_from to an unrelated run. — fix: Run git with GIT\_DIR, GIT\_WORK\_TREE, GIT\_INDEX\_FILE, GIT\_COMMON\_DIR, GIT\_CEILING\_DIRECTORIES and GIT\_CONFIG\_\* removed from env, or pass explicit --git-dir/--work-tree. Test with GIT\_DIR pointing elsewhere.

## Low (2)

- **A .git file or symlink in a local source sends rev-parse to a repository outside the named directory** — `src/lib/bbs/intake.js:144` (security): isGitRepo only checks \<ref\>/.git exists; a gitdir file or symlink pointing elsewhere lets a crafted directory impersonate a known identity. — fix: lstat \<ref\>/.git: a symlink or a gitdir file resolving outside ref falls back to the manifest identity with an identity\_note.
- **Config paths.runs / paths.registry can point writes outside .claude/bbs** — `src/lib/bbs/store.js:11` (security): runsDir and registryPath join cfg.paths.\* with no containment check; paths.runs '../escaped' created run dirs outside the project while ACTIVE stays hardcoded. — fix: In loadConfig, reject paths.runs/paths.registry that are absolute or do not resolve under \<project\>/.claude/bbs, failing loudly with the key.
