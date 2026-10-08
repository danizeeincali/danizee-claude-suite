# Review f52a6a06-72db-45f3-9d33-0cfc6660a68e — inventory, round 2

- Commit: 8a726fb
- Angle: failure conditions and error paths
- Result: pass
- 6 findings

## Medium (2)

- **A failure after powers.json is committed fails the verb, and a retry is refused with 'powers.json exists'** — `src/lib/bbs/inventory.js:533` (correctness): loadState/nextStep after the link run outside any try and throw on a corrupt map.json or EACCES on egress.jsonl; the new powers.json stays and the next plain --from says pass --force. Same commit-then-fail pattern as fetch r2. — fix: Once the link or rename succeeds the write is done: wrap the re-render and loadState/nextStep in try/catch, return next:null plus a warning naming the unreadable file, exit 0. Test with a corrupt map.json and no powers.json.
- **The exclusive claim needs hard links; on filesystems without them every non-force inventory fails with a raw EPERM/ENOTSUP** — `src/lib/bbs/inventory.js:523` (correctness): Only EEXIST is translated; EPERM/ENOTSUP/EXDEV from fs.link are rethrown raw so inventory can never succeed without --force on exFAT/SMB/FUSE. — fix: On EPERM/ENOTSUP/ENOSYS/EXDEV fall back to fs.open(powersFile,'wx') + write + fsync. Test with an injected link that throws EPERM.

## Low (4)

- **A --force that fails partway leaves files moved aside with no rollback and no report** — `src/lib/bbs/inventory.js:508` (correctness): A rename or the final write can fail after earlier renames; the error does not list what was moved; a same-ts stale name is overwritten silently. — fix: On failure after the first rename, rename moved files back or include stale\_moved in the error; claim the stale name with wx/link or a random suffix.
- **An empty or vanished source root still produces a normal-looking brief with no files** — `src/lib/bbs/inventory.js:381` (correctness): An empty fetched/ passes the stat check and the brief prints 'Read the source files above' with an empty list. — fix: When total is 0 throw 'source root \<root\> has no files — re-run fetch/intake'. Test with an empty fetched/.
- **The walk visits the whole tree one lstat at a time, even after maxFiles is reached** — `src/lib/bbs/inventory.js:334` (performance): Only .git and node\_modules are skipped; .venv, target, dist, vendor are walked in full with one awaited lstat per entry. — fix: Use Dirent types to skip lstat where possible, batch per directory with Promise.all, and skip common build/vendor dirs.
- **The 'JSON only' parse error does not say which input it came from and echoes raw bytes** — `src/lib/bbs/inventory.js:188` (facts): The same message for --from \<file\> and stdin; binary stdin prints control bytes. — fix: Pass a label (path or stdin) into parseInventory and escape control characters in the preview via JSON.stringify.
