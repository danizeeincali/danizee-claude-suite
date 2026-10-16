# Review e0f203d8-0b19-4c9f-80ac-26b965974df1 — exit-code-contract-separating-infrastruc, round 17

- Commit: 4596acc
- Angle: older environments and degraded networks
- Result: pass
- 1 findings

## Low (1)

- **Missing-blob remedy now names no command at all, and lists clone shapes that do not cause missing blobs alone** — `src/lib/kit/exit-codes.js:116` (correctness): After r16 the scrub missing-blob remedy says 'Fetch the missing blobs (the command depends on how the clone was made: sparse, --no-checkout or blobless; ...)' but gives no command for any of those shapes. A user on an older git (2.43 here, no backfill) is told what not to run but not what to run, which is the case this angle covers. diff-range does give a concrete command for the same condition (diff-range.js:144). Also, 'sparse' and '--no-checkout' do not leave blobs missing by themselves; only a filtered (blobless) clone does, so listing them as three alternatives misleads. A single command works on every git version and clone shape: confirmed locally (git 2.43, file:// promisor remote, no network) that in a 'git clone --filter=blob:none --no-checkout' clone, 'git archive HEAD \>/dev/null' takes HEAD's missing blobs from 2 to 0. Because this is only remedy text and the exit code is unchanged, it is low. Same text in .claude/helpers/kit/exit-codes.js:116. — fix: Name one version-independent command, e.g. 'Fetch the missing blobs once (git archive HEAD \>/dev/null works on any git version and clone shape; a plain git fetch does not fill them in) or run in a full clone', and make the r13 test match it exactly.
