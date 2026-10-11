# Review e98d3fca-9589-4bbf-b259-65957ad4afd4 — diff-range, round 4

- Commit: 8c2c7e4
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 1 findings

## Medium (1)

- **diff-range runs programs and can fetch over the network when the reviewed repo's .git/config says so (textconv, clean filters, fsmonitor, lazy fetch)** — `src/lib/kit/diff-range.js:64` (security): defaultGit only sets core.hooksPath=/dev/null and strips GIT\_\*; a planted .git/config with diff.X.textconv, filter.X.clean and core.fsmonitor ran all three programs during diff-range (markers created), textconv output replaced the real content the lenses read, and a blob:none partial clone fetched missing blobs from the promisor remote with the user's credential helper; the header claims a hardened read — fix: apply safe-git's overrides to both diff calls: --no-textconv, -c core.fsmonitor= -c diff.external= -c credential.helper= -c protocol.allow=never and GIT\_NO\_LAZY\_FETCH=1 in env (a missing blob then exits 1 with a clear message); state the remaining trust assumption in the header
