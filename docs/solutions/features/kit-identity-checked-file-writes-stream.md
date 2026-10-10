# kit stream: identity-checked-file-writes (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js guarded-write --root <dir> --file <path> [--protect <dir>] [--allow-empty]`
(`src/lib/kit/guarded-fs.js`, also `guardedRead`, `guardedDelete`, `resolveGuarded`). The path is walked one name at
a time with lstat from the root, with every folder recorded by device+inode. A symlink inside the protected tree is
refused, while one elsewhere under root is followed. The write opens the verified folder, creates the temp file with
O_EXCL|O_NOFOLLOW, fsyncs and renames, then proves the final name holds the written inode. On Linux it works through
/proc/self/fd so the folder handle is used. Off Linux it goes by path, with a re-check right before the rename. An
overwrite keeps the file's permission bits. Stdin is taken as bytes, and a terminal or empty stdin is refused. Caller:
the push gate reads and writes its receipt store through it. The owner's links above the store are resolved first, a
link inside the receipts folder is refused, and `check` never creates folders.

**Rounds:** r1 fail (high: an empty stdin emptied the target; mediums: binary input corrupted, an off-Linux swap race,
wrong header), r2 pass (medium: a refused post-rename check deleted the file from the right folder), r3 pass (medium:
`check` failed instead of deciding on a read-only home). All 9 findings fixed before merge.

**Lesson:** a CLI that writes from stdin must refuse a terminal or empty input unless the user says so explicitly.
Separately, on failure, undo only what can still land in the wrong place; never undo what is already where it belongs.
