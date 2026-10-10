# Review 4af10bed-d1f1-455d-9419-b82bf5fe59d3 — secret-redaction-by-value-and-fingerprin, round 2

- Commit: e2e55a4
- Angle: failure conditions and error paths
- Result: pass
- 3 findings

## Medium (2)

- **Secrets file that exists but cannot be reached is treated as 'no secrets' and fails open silently** — `src/lib/marathon/cli.js:704` (security): redactForModel gates on fileExists(), which returns false for any fs.access error, not only for a missing file. A dangling symlink (for example .claude/kit/secrets linked to a password store that is not mounted), EACCES on .claude/kit, or ELOOP all make review-brief skip redaction with no note, so the unredacted diff goes to the model and the brief says nothing. The kit CLI does the same: readFileOr treats ENOENT from a dangling symlink as 'missing default file' (verified: a dangling .claude/kit/secrets symlink gives {replaced: 0}, exit 0). The module promises the review-brief path fails closed on a broken secrets file, but these failures fail open. — fix: Use fs.lstat (or check only e.code === 'ENOENT' on lstat) so 'the path exists in any form' blocks the brief; any other error, or a symlink whose target is missing, should stop with an error naming the path. In redact.js readFileOr, lstat before treating ENOENT as optional.
- **Secrets file present but kit missing: the diff goes out unredacted** — `src/lib/marathon/cli.js:696` (security): When .claude/kit/secrets exists, the user has said which values must not leave the machine. If the redact module cannot be imported (kit not installed, uninstalled, or redact.js/kit-exit.js missing, which the message check also swallows because the importer path contains 'redact.js'), review-brief still prints the whole raw diff and only adds a note at the end of the scope line. That note is easy to miss, and the secret has already gone out. The test locks in this fail-open behaviour instead of the fail-closed behaviour used for a malformed file. — fix: When the secrets file exists and the redact module cannot load, fail the brief (or use a minimal inline exact-match redaction) rather than emit the unredacted diff; keep the 'works without kit' path only for when there is no secrets file.

## Low (1)

- **Any git rev-parse failure is reported as 'not inside a git repository'** — `src/lib/kit/redact.js:221` (correctness): secretsRoots maps every non-zero exit to 'not inside a git repository'. git older than 2.31 rejects --path-format=absolute, and running from inside .git rejects --show-toplevel. Both cases print a wrong diagnosis even though the user is in a repository. — fix: Include a short, value-free summary of r.stderr in the message, or check for the specific 'not a git repository' text before using that wording.
