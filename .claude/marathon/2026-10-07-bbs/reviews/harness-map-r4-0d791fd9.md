# Review 0d791fd9-0436-4039-a15f-d7424a6884be — harness-map, round 4

- Commit: f449196
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 1 findings

## Medium (1)

- **Symlinked index roots (.claude, .claude/hooks, scripts, src/lib, package.json) are followed out of the project without a SYMLINK report** — `src/lib/bbs/harness-map.js:243` (security): listFiles skips symlinked entries inside a directory but the roots and their parents are never checked; symlinked scripts/, .claude/hooks and package.json pointing outside were read (first 64 KiB) and indexed as if inside, with errors \[\]. — fix: lstat each root and each parent up to projectDir; a symlink → errors {path, code:'SYMLINK'} and skip; same for package.json; or realpath each root and refuse those not under realpath(projectDir). Tests for a symlinked scripts/, .claude and package.json.
