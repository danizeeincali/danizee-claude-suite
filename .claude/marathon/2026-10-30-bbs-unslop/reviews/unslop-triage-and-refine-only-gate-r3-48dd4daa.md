# Review 48dd4daa-bc43-4918-9d78-8183eef6c73b — unslop-triage-and-refine-only-gate, round 3

- Commit: 7f8bb0a
- Angle: older environments and degraded networks
- Result: pass
- 2 findings

## Low (2)

- **State write is atomic but not durable: no fsync before rename** — `.claude/helpers/kit/slop-triage.js:308` (correctness): writeState writes the temp file and renames it over the state file without fsyncing the temp file or the folder. A crash or power loss just after confirm can leave a zero-length state file, which happens on filesystems without ext4's auto\_da\_alloc rename heuristic: older XFS, ext3 data=writeback, some network mounts. The next gate then exits 1 ('not valid JSON') instead of 2. Worse, a crash just after a 'Change the direction' revoke can lose the rename, so the earlier { confirmed: true } comes back and the gate passes against the user's no. The header calls the revoke a guarantee. The kit's own guarded-fs.js already fsyncs before rename. — fix: Open the temp file with fs.open(tmp, 'wx'), write, await fh.sync(), close and rename. Then fsync the parent folder where that is supported (open it read-only and call sync, ignoring EISDIR/EPERM on platforms that refuse). Or reuse the guarded-fs write path.
- **Temp files left by a killed confirm are never cleaned up** — `.claude/helpers/kit/slop-triage.js:305` (other): If the process is killed between writeFile and rename (SIGKILL, OOM, a terminal closed on a slow network mount), the uniquely named '\<state\>.\<pid\>.\<uuid\>.tmp' file stays beside the state file for good. The catch-block cleanup only runs on a thrown error, and no later run removes such files, so they pile up in the user's folder. — fix: Document the leftover pattern in the header. Or, on confirm, remove sibling '\<state\>.\<pid\>.\*.tmp' files whose pid is no longer running (best effort, ignore errors).
