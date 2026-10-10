# Review b7fdd520-d746-419d-8abf-77c0819d1909 — pre-push-review-gate, round 3

- Commit: c34bb07
- Angle: older environments and degraded networks
- Result: pass
- 2 findings

## Medium (1)

- **--path-format=absolute (git \>= 2.31) silently misbehaves on older git** — `src/lib/kit/push-gate.js:215` (correctness): workingTree (line 215) and storeFile (line 314) call \`git rev-parse --path-format=absolute ...\`. Git before 2.31 (Ubuntu 20.04 ships 2.25, Debian 11 2.30, RHEL 8 2.27-2.31) does not know the option; rev-parse passes unknown flags through to stdout and exits 0 (verified: \`git rev-parse --bogus=absolute --git-common-dir\` prints \`--bogus=absolute\n\<path\>\`, rc 0). So \`must()\` returns a two-line string. In workingTree the index copy then fails with ENOENT, which line 219 swallows, so \`git add -u\` runs on an empty temp index and write-tree returns the empty tree: a dirty receipt would hash the wrong tree. storeFile then calls fs.realpath on the two-line string and every receipt and check exits 1 with a cryptic \`ENOENT ... realpath '--path-format=absolute\n...'\`. The gate is unusable on these hosts and the error does not say why. No test covers older git or a minimum version. — fix: Drop --path-format and resolve the relative output of \`--git-common-dir\` / \`--git-path index\` with path.resolve against \`git rev-parse --show-toplevel\`'s cwd (or the cwd git ran in), or check \`git --version\` and throw a clear KitExit for \< 2.31; do not swallow ENOENT on the index copy when status reported changes.

## Low (1)

- **Stale-lock check compares local clock to filesystem mtime** — `src/lib/kit/push-gate.js:351` (correctness): withLock treats the lock as stale when Date.now() - st.mtimeMs \> staleMs. When the receipts dir lives on a network home directory (NFS/SMB), mtime comes from the server clock; with more than 30s of skew a live lock can be taken over, or a dead one never treated as stale until waitMs expires. Two concurrent receipts can then lose a \`previous\` entry. — fix: Write the owner pid and a local timestamp into the lock file and judge staleness from that content (or from the pid being dead) instead of the server-set mtime.
