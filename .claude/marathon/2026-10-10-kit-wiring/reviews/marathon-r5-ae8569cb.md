# Review ae8569cb-d2f4-42c4-a125-53429e337326 — marathon, round 5

- Commit: 14bea65
- Angle: accessibility
- Result: pass
- 3 findings

## Medium (1)

- **Folder isolation mode: 4.2 and 4.5 now give contradictory instructions** — `src/plugins/dot-shortcuts.js:4081` (accessibility): 4.5 says folder mode has no isolation path, W=. and the 4.2 copy is skipped; 4.2 still says to create a folder, copy the private patterns into it and activate with isolation=\<path\>; the kit's own folder-mode hint is state=active --no-isolation, and the new worktree check refuses a plain folder. — fix: In 4.2 replace '(or a folder when streams.isolation: folder)' with: in folder mode skip 4.2 entirely, activate with cli.js stream \<name\> state=active --no-isolation and use W=. in every later block.

## Low (2)

- **4.2 copy block never says what W is; its error points to a field not set yet** — `src/plugins/dot-shortcuts.js:4064` (accessibility): The block starts with W=../myrepo-api; nothing in 4.2 says to set W to the path given to git worktree add, and the guard message refers to the isolation field that is recorded only after the copy. — fix: Add to 4.2: 'Set W to the path you gave git worktree add', and make the 4.2 guard say 'set it to the new worktree path'.
- **CHECKPOINT 6 timeout remedy quotes text the deny reason does not contain** — `src/plugins/dot-shortcuts.js:4193` (docs): push-gate's scrubBlock prints 'the scrub check is configured but could not run: git \<cmd\> took longer than N ms and was stopped (raise it with --timeout \<ms\>)'; the phrase 'the scrub took longer' never appears. — fix: Quote the real wording.
