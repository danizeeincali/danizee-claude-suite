# Review 5dd73dab-c665-42a3-8705-b7b4806cae64 — identity-checked-file-writes, round 2

- Commit: 2245ccc
- Angle: failure conditions and error paths
- Result: pass
- 1 findings

## Medium (1)

- **Post-rename 'undo' deletes the overwritten file: neither old nor new content survives** — `src/lib/kit/guarded-fs.js:219` (correctness): When a check after the rename fails (the identity check at line 212 or recheck at line 213), the catch unlinks the file that was just renamed into place. On an overwrite the rename has already replaced the previous file, so removing it does not undo the write. It destroys the target completely. On Linux, finalVia is /proc/self/fd/\<dir\>/name, so the rename landed in the verified, opened folder, and the removal deletes a correctly placed file. Reproduced at HEAD 2245ccc. Pre-create d/x='OLD', then use an afterOpen hook that renames d to d-moved (a plain rename, as in the existing test). guardedWrite refuses with code 2 and d-moved/ ends up empty. Same with an afterRename hook that renames an ancestor folder with no symlink involved: a/b/f ends up gone. For push-gate this loses the whole receipt store (latest and previous). The header (line 26) and the error text ('the write was undone') say the opposite. The same code is in .claude/helpers/kit/guarded-fs.js. — fix: Unlink only when the file may have landed outside the checked folder (the by-path case where \`ours\` was reached through a swapped link). In the /proc/self/fd case, leave the renamed file in place and just report the refusal. Alternatively, hard-link the old file aside before the rename and restore it on failure. Fix the header and the message to match, and add a test that pre-creates the target and asserts its content survives a refused write.
