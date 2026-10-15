# Review dba328f6-571f-4540-8284-8a2aabe0c5f2 — preflight-doctor-checks-before-a-run, round 1

- Commit: 6c2ea60
- Angle: one input method at a time
- Result: over tolerance
- 4 findings

## Medium (3)

- **A bin check whose target is a path always fails** — `src/lib/kit/doctor.js:63` (correctness): findOnPath joins every PATH entry with the target, so a project check like {"kind":"bin","target":"/bin/sh","fatal":true} or "node\_modules/.bin/eslint" looks for \<entry\>//bin/sh and is reported as '/bin/sh not found on PATH'. Confirmed: with /bin/sh present, doctor exits 2 (refused). parseConfig accepts these targets without complaint, so a user who points a fatal bin check at a pinned path blocks every run with a false failure. — fix: If the target contains a path separator (or is absolute), resolve it against cwd and test it directly for an executable file instead of searching PATH; or reject such targets in parseConfig with exit 1.
- **A json check prints part of the file's contents when the file is malformed** — `src/lib/kit/doctor.js:101` (security): On a parse failure, \`found\` includes JSON.parse's message, and on Node 20+ that message quotes the text around the error. Confirmed: a file containing {"token": ghp\_ABCDEFsecretvalue} yields found = 's.json is not valid JSON (Unexpected token 'g', ..."{"token": ghp\_ABCDEF"... is not valid JSON)'. A project json check on a credentials or settings file therefore writes a slice of a secret to stdout (and into marathon logs). The verb promises that env values are never printed, but it gives no such guarantee for file contents, so a user has no reason to expect the leak. — fix: Report only the position (the 'line N column M' / 'position N' part) or a fixed 'is not valid JSON' sentence, never e.message's quoted snippet; add a test with a secret-looking token in a malformed file.
- **Running doctor from a subdirectory falsely reports the kit missing** — `src/lib/kit/doctor.js:124` (correctness): The file and json checks resolve against io.cwd (process.cwd()), but the git-work-tree check walks upward. From \<project\>/sub, \`node ../.claude/helpers/kit/cli.js doctor\` reports '.claude/helpers/kit/cli.js not found' and exits 2. The file it reports as missing is the very script that is running. The marathon profile likewise fails .claude/marathon.json. A user who runs the preflight from a subfolder is refused, and the fix hint ('run danizee-claude-suite install') sends them the wrong way. — fix: Anchor the built-in file/json checks at the project root (the directory holding .claude, found by walking up as inGitWorkTree does, or derived from the kit's own location), or say in the found text which directory was searched.

## Low (1)

- **A UTF-8 BOM in doctor.json makes the config invalid** — `src/lib/kit/doctor.js:171` (correctness): loadConfig (and checkJson) pass the raw text to JSON.parse, so a doctor.json saved with a BOM (the default in some Windows editors) is rejected with exit 1: 'Unexpected token '\uFEFF''. The error shows the BOM as an invisible character, so the user cannot see the cause. — fix: Strip a leading \uFEFF before JSON.parse in loadConfig and checkJson.
