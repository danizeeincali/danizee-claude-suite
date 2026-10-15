# Review 3d07c1d6-6400-4ac7-bfd9-c340575bc574 — exit-code-contract-separating-infrastruc, round 16

- Commit: 8b13239
- Angle: failure conditions and error paths
- Result: pass
- 1 findings

## Medium (1)

- **Missing-blob remedy now offers only 'git sparse-checkout disable', which does nothing in a non-sparse blobless --no-checkout clone** — `src/lib/kit/exit-codes.js:116` (facts): Confirmed locally (git 2.43, file:// promisor remote, no network): 'git clone --filter=blob:none --no-checkout' (no --sparse) then 'kit scrub' exits 2 with every HEAD file reported as 'object not available locally (partial clone?)'. Running the remedy's only named command, 'git sparse-checkout disable', returns 0 but fetches nothing (there is no index or checkout to widen), and scrub rerun gives the same exit 2. The text also frames the problem as blobs 'outside the sparse cone', which is not the case here. The r15 change dropped 'git backfill', which in a non-sparse clone does fetch all blobs, so this error path lost its only working fetch command; only 'or run in a full clone' remains. Same text in .claude/helpers/kit/exit-codes.js:116. — fix: Name the non-sparse case too, e.g. '(git sparse-checkout disable in a sparse checkout, git checkout in a --no-checkout clone, or git backfill --no-sparse on git 2.49+; a plain git fetch does not fill them in)', and keep the test matching the exact commands.
