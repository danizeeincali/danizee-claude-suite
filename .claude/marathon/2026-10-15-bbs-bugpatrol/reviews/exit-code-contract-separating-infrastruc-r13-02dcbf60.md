# Review 02dcbf60-4b18-4a22-a56d-da2d84fb3de3 — exit-code-contract-separating-infrastruc, round 13

- Commit: 0a2d85f
- Angle: facts and content
- Result: pass
- 2 findings

## Medium (1)

- **Missing-blob remedy says 'git fetch', which does not get the missing blobs back** — `src/lib/kit/exit-codes.js:116` (facts): For the reason 'object not available locally (partial clone?)' the description tells the user 'Fetch the missing blobs (git fetch, or unsparse the checkout) or run in a full clone'. In a blobless or sparse partial clone, the clone keeps its filter, so a plain \`git fetch\` only fetches new refs and never fills in blobs that are already missing. Confirmed locally (file:// clone with --filter=blob:none --sparse, then \`git fetch origin\`): \`git rev-list --objects --missing=print HEAD\` shows the same missing blob before and after the fetch. A user who follows the first remedy and reruns scrub gets the same fail-closed exit 2. The description itself says 'a rerun in the same clone gives the same result', so the user is left confused about why the advice did not work. The same text is in .claude/helpers/kit/exit-codes.js:116. — fix: Drop 'git fetch' from the parenthesis, or replace it with a command that does fetch the missing blobs (e.g. 'git sparse-checkout disable', or 'git backfill' on git 2.49+).

## Low (1)

- **diff-range exit 1 description leaves out the 'skipped by a cap' case its usage text names** — `src/lib/kit/exit-codes.js:72` (facts): diff-range's usage text (diff-range.js:83) says exit 1 covers 'bad input or git failed or files skipped by a cap left the diff empty', and diff-range.js:350 throws KitExit 1 for that case. The override description only says 'Bad input, or git failed or timed out while diff-range ran'. So a range that is empty only because untracked files went over --max-file-bytes or --max-untracked is described as a malformed call or a git failure, even though the fix is to raise a cap. 'read the message' softens this, but the description is meant to give the same text on every surface. Same in .claude/helpers/kit/exit-codes.js:72. — fix: Add ', or untracked files skipped by a cap (--max-file-bytes/--max-untracked) left the diff empty' to the diff-range 1 description.
