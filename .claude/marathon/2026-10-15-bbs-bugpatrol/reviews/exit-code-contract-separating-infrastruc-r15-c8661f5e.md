# Review c8661f5e-d52a-41f4-96f1-5aee0ca9e2c2 — exit-code-contract-separating-infrastruc, round 15

- Commit: e88f25f
- Angle: one input method at a time
- Result: pass
- 1 findings

## Medium (1)

- **Missing-blob remedy suggests plain 'git backfill', which skips the missing blobs in a sparse checkout** — `src/lib/kit/exit-codes.js:116` (facts): scrub only reports 'object not available locally (partial clone?)' for HEAD's tree (scrub.js:176-187 via ls-tree; history mode exits 1 instead). In a blobless clone HEAD's blobs inside the checkout are already present, so the missing ones are the paths outside a sparse-checkout cone. Per git-backfill's documentation (git 2.49+), '--sparse is assumed' when sparse-checkout is enabled (builtin/backfill.c sets sparse from core\_apply\_sparse\_checkout), so a plain 'git backfill' downloads only blobs at paths inside the cone and leaves exactly the blobs scrub needs missing; the rerun gives the same fail-closed exit 2 the text was changed to avoid. Not reproduced locally (this machine has git 2.43, without backfill); based on git's documented default. Same text in .claude/helpers/kit/exit-codes.js:116. The test at test/kit-exit-code-contract-separating-infrastruc.test.js:558 accepts 'backfill' alone, so it would not catch this. — fix: Say 'git backfill --no-sparse on git 2.49+' (or keep only 'git sparse-checkout disable'), and have the r13 test match the exact command.
