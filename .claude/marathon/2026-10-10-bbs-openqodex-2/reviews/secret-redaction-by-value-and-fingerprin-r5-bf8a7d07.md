# Review bf8a7d07-16b7-4794-8c60-ae129db33159 — secret-redaction-by-value-and-fingerprin, round 5

- Commit: 0c4bc04
- Angle: accessibility
- Result: pass
- 3 findings

## Low (3)

- **rev-parse output error gives no next step and drops the caller's context** — `src/lib/kit/git-paths.js:34` (accessibility): When rev-parse exits 0 with odd output, resolveRevParse throws 'unexpected git rev-parse output (got N line(s), wanted M; first: ...)'. The \`what\` label gitPaths was given ('cannot find the index' / 'cannot find the git dir') is used only on a non-zero exit, and secretsRoots does not add its usual 'pass --secrets-file' remedy here. A user of redact or push-gate sees git internals with no action to take, unlike the neighbouring messages that name a fix. — fix: Let the callers wrap or prefix the error: gitPaths prepends \`what\`, and secretsRoots appends '; pass --secrets-file' (optionally with a hint to check the git version).
- **Malformed-secrets failure is the only fail-closed message with no remedy** — `src/lib/marathon/cli.js:709` (accessibility): The other new review-brief failures say 'refusing to emit an unredacted diff' and/or what to do (install the kit plugin or remove the secrets file). The malformed case says only '\<rel\> is malformed (\<parser message\>)'. The user is not told the brief was withheld on purpose or that fixing the file (for example closing the -----BEGIN block) unblocks it. — fix: Use the same wording as the siblings: append ' — fix the file or remove it; refusing to emit an unredacted diff'.
- **A dangling secrets symlink is reported as a bare ENOENT** — `src/lib/kit/redact.js:151` (accessibility): This change deliberately treats a dangling symlink at the secrets path as an error. Yet redact reports 'cannot read secrets file \<path\>: ENOENT', and marathon (cli.js:705) reports 'cannot read .claude/kit/secrets (ENOENT)'. 'No such file' about a path the user can see with ls is confusing, and neither message says that the symlink target is missing or what to do (mount or restore the target, or remove the link). — fix: When lstat succeeds but readFile gives ENOENT, say '\<path\> is a symlink to a missing target (\<readlink\>); restore it or remove the link'.
