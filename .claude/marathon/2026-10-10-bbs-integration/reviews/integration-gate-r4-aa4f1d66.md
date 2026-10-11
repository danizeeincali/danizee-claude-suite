# Review aa4f1d66-a930-4cd9-b9cc-f739542a5eaa — integration-gate, round 4

- Commit: 4a61e57
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: over tolerance
- 4 findings

## High (1)

- **singleCall bypassed by an escaped quote** — `src/lib/bbs/wiring.js:137` (security): a backslash-escaped quote hides ; from the check while sh runs several commands, so a failing reach test passes — fix: tokenize to argv and spawn without a shell

## Medium (2)

- **Any program is accepted as a reach runner** — `src/lib/bbs/wiring.js:142` (security): curl with a secret naming the test file is accepted and run — fix: allowlist test runners, reject $ and globs
- **Reach tests run with the full env and no egress probe** — `src/lib/bbs/wiring.js:153` (security): reach tests get API keys and may reach the network unmeasured — fix: minimal env and the egress preload; pass only with an empty egress log

## Low (1)

- **Scan follows tracked symlinks out of the project** — `src/lib/bbs/surfaces.js:182` (security): a tracked symlink to a secrets file becomes anchors — fix: lstat and skip symlinks or realpath outside the project
