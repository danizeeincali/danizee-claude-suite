# Review 6e6aecbc-b592-4dd3-a7e2-1ca72e3f24b0 — bc, round 2

- Commit: c1cfd8c
- Angle: failure conditions and error paths
- Result: over tolerance
- 5 findings

## High (1)

- **Redact block diffs the lead's handoff commit, not the session's work** — `src/plugins/dot-shortcuts.js:3736` (correctness): CHECKPOINT 1 commits the handoff files before the agent is dispatched, so the agent's \`git diff HEAD~1\` covers the handoff commit plus uncommitted edits, not the session's committed work. After a refused handoff scrub there is no handoff commit and the same line gives a different range. The real diff never goes through redact unless the agent improvises. — fix: Have the lead record the pre-handoff HEAD (or the session's base) and pass it to the agent; diff that range in the block (git diff "$BASE"), never HEAD~1.

## Medium (3)

- **After a refused handoff scrub, the agent's scrub refuses too, so the claimed write-up commit never happens** — `src/plugins/dot-shortcuts.js:3716` (correctness): scrub --worktree scans every tracked file on disk. Unstaging only helps for a new file; a hit in an already-tracked handoff file stays on disk, the agent's Phase 2 scrub exits 2 and it does not commit, although the text promises the write-up commits. — fix: Say the agent's scrub will also refuse while a tracked file holds the hit, or have the lead pass that fact so the agent skips Phase 2 and reports it. Do not claim the write-up commits.
- **Main re-check after the merge stops every reviewed change** — `src/plugins/dot-shortcuts.js:3771` (correctness): push-gate changeId hashes (merge-base with @{upstream}, HEAD tree). On main after the merge the base differs from the one the receipt was keyed on, so with any receipt decide() returns ask 'only an earlier review exists, for a different version of this change', which is not the no-review reason: a reviewed change is held while an unreviewed one goes through. — fix: Have the main re-check pass --base set to the base the branch check used so a fast-forward merge of the reviewed tree matches its receipt; or document the outcome and route it to the relay explicitly.
- **Relay path loops: the lead's foreground rerun of Phase 3 stops on the same ask or deny** — `src/plugins/dot-shortcuts.js:3803` (process): After the owner answers, the lead runs the Phase 3 lines, push-gate block first; nothing changed, so the gate returns the same ask or deny and Phase 3 says not pushed. Read literally the owner's answer never leads to a push, and a deny is treated like an ask. — fix: State that after the owner explicitly says go on an ask, the lead pushes without rerunning the gate's stop rule (the permission prompt still applies); a deny is never pushed past, the owner must fix the cause first.

## Low (1)

- **Agent dispatched without --push after a handoff scrub refusal writes the wrong 'not pushed' reason** — `src/plugins/dot-shortcuts.js:3758` (docs): The lead's text says the summary reads 'not pushed — handoff scrub refused', but the agent is dispatched without --push and Phase 3 writes 'not pushed — owner's go needed (/bcp)', misleading when the owner ran /bcp. — fix: Have the lead put the reason into the agent's dispatch prompt, or write the line itself; make clear which.
