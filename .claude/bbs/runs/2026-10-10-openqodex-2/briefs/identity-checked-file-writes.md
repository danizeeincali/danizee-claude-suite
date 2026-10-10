# identity-checked-file-writes — rebuild

## Idea (in our words)
When a tool may write into a user's own folders, comparing path strings is not enough, because symlinks, case and Unicode spelling can move a write outside the allowed area. This power walks a path one name at a time from the root, using lstat so links are not silently followed, and records each folder by its device and inode rather than its spelling. A link found inside the project tree is refused, while a link elsewhere in the home folder (for example dotfiles) is followed as the owner intends. The write opens the verified folder without following links, creates a temp file exclusively, writes, fsyncs and renames it into place. Because Node has no renameat, the final path is checked afterwards to hold the same device and inode as the open handle, and the write is removed and reported as failed on any mismatch. Deletes never follow a final link and recheck folder identity before each removal. A reader variant repeats the walk after opening to catch a link swapped in during the read. Reusable for any personal automation that edits config files in the home folder or the current repository.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.304Z
- Evidence: repo/packages/core/src/guarded-fs.ts:1-35, repo/packages/core/src/guarded-fs.ts:37-139

## What we have
missing — The lstat walk and temp-file fsync write live in harness-map.js and inventory.js, which are not among the candidates; none of the candidates tracks device and inode identity.

## Finish line (5 checks, written before the build)
- `tests_green_identity-checked-file-writes`: identity-checked-file-writes: green unit runs in a row
- `egress_zero_identity-checked-file-writes`: identity-checked-file-writes: zero egress in the packaged check
- `six_sigma_identity-checked-file-writes`: identity-checked-file-writes: clean reviews in a row
- `callers_identity-checked-file-writes`: identity-checked-file-writes: callers in the harness
- `packaged_identity-checked-file-writes`: identity-checked-file-writes: packaged check passes

## Kickoff lines

Done means
- tests_green_identity-checked-file-writes — green unit runs in a row
- egress_zero_identity-checked-file-writes — zero egress in the packaged check
- six_sigma_identity-checked-file-writes — clean reviews in a row
- callers_identity-checked-file-writes — callers in the harness
- packaged_identity-checked-file-writes — packaged check passes

You may decide on your own
- How to structure the code behind each power's interface, within its brief
- Test names, fixtures and file layout

Ask me before
- Adding a dependency
- Any network call, account, purchase or signature
- Changing a finish line

Never
- Never execute fetched foreign code
- Never copy source code from the source

