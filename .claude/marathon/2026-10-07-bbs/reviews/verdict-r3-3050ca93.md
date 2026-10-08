# Review 3050ca93-18fc-4534-bc4e-38de8c2d81dc — verdict, round 3

- Commit: c8a8030
- Angle: older environments and degraded networks
- Result: pass
- 3 findings

## Medium (2)

- **On a filesystem without hard links, breaking a stale map.lock can silently steal another process's fresh lock, so two holders run at once** — `src/lib/bbs/store.js:220` (correctness): When the stale-break content check fails, the lock is put back with fs.link; on exFAT/SMB/FUSE link throws and the catch swallows it and continues, so B's open('wx') succeeds while A still holds the lock. — fix: Restore with fs.rename after checking the path is free (or link falling back to rename); if the restore fails, throw held() naming the aside file — do not retry. Test with an injected link that throws EPERM.
- **docker info against a remote daemon (DOCKER\_HOST / docker context) counts as a sandbox on this machine and makes use legal** — `src/lib/bbs/verdict.js:184` (correctness): With DOCKER\_HOST=tcp:// or ssh://, or a remote docker context, docker info exits 0 and the sandbox is recorded present although this machine has none; ssh:// can also prompt on /dev/tty. — fix: Count docker only when the endpoint is local (unix:// or npipe; DOCKER\_HOST unset or unix://), using docker context inspect or docker info --format; otherwise present:false with 'docker daemon is remote (\<redacted endpoint\>) — not a sandbox on this machine'. Tests with DOCKER\_HOST=tcp:// and ssh://.

## Low (1)

- **Sanitised sandbox stderr and probe evidence keep Unicode bidi and line-separator characters, and the 200-char cut can split a surrogate pair** — `src/lib/bbs/verdict.js:145` (security): CONTROL\_CHARS strips only C0/C1; bidi overrides and U+2028/2029 pass through; slice cuts by UTF-16 unit. — fix: Strip \p{Cf}-style format chars (keep \n) and cut by code point. Tests for U+202E and an emoji at the boundary.
