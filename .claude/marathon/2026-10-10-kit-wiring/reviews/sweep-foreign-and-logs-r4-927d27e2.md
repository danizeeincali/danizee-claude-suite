# Review 927d27e2-bc63-4daf-af98-ba772b385d5e — sweep-foreign-and-logs, round 4

- Commit: f85fa13
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 4 findings

## Medium (2)

- **Newly shipped w-fix/w-swarm Pi Brain searches send raw, unredacted text pasted into the shell** — `.claude/commands/.shortcuts/w-fix.md:63` (security): CHECKPOINT 0.5 in w-fix.md (lines 63, 66) and w-swarm.md (lines 70, 73), pinned by test/sweep-foreign-and-logs-command.test.js (~line 780), pastes the bug or task description into a double-quoted shell argument (--data-urlencode "q=\[bug description\]"); the HTTP fallback puts it unencoded in the URL. Stack traces, connection strings or tokens go to pi.ruv.io without redact, and $(...) or backticks in an error message run in the shell. — fix: Reuse the w-compound pattern: write the description to a temp file, run the advisory redact --keep-lines block, send --data-urlencode "q@$Q" from the redacted file with timeouts; drop the unencoded HTTP fallback line; retarget the pinning assertion.
- **Upstream clone goes to a fixed, world-writable /tmp path that safe-git then treats as the clone** — `.claude/commands/.shortcuts/w-suite-sync.md:47` (security): git clone --depth 1 ... /tmp/suite-upstream uses a predictable shared path never removed. On a second run or when another local user created it the clone fails and the workflow carries on reading and copying whatever sits there (CHECKPOINT 3 copies selected files into the project), so stale or planted files can land in the repo as if upstream. The safe-git prose builds its trust boundary on this path without checking the clone succeeded. — fix: Clone into U=$(mktemp -d); stop on non-zero git clone; use the printed path for every later safe-git --dir, ls and copy; rm -rf -- that literal path at the end.

## Low (2)

- **Kit-missing fallback posts the raw recipe publicly even when a secrets file exists** — `.claude/commands/.shortcuts/w-compound.md:252` (security): The redact fence decides kit-missing from a cwd-relative test and then says to use the raw text from $E; the build-body fence skips its post-encoding check the same way. If the kit is not found but a secrets file exists, unredacted text goes to the public registry in search and POST: the only POST off the machine fails open. — fix: Resolve kit and secrets paths from git rev-parse --show-toplevel; when a secrets path exists but the kit is missing, refuse to send (secrets file present but kit missing: not sent) instead of falling back to raw text.
- **Predictable sibling temp names ($Q.resp, $B.resp, $B.chk) in shared /tmp** — `.claude/commands/.shortcuts/w-compound.md:263` (security): Only $Q and $B come from mktemp; curl -o and the shell redirect write to sibling names mktemp never reserved, so a pre-placed symlink could redirect the write outside the intended paths (usually blocked by protected\_symlinks in sticky /tmp). — fix: Create a private directory with mktemp -d and put Q, Q.resp, B, B.resp and B.chk inside it, removing the directory afterwards.
