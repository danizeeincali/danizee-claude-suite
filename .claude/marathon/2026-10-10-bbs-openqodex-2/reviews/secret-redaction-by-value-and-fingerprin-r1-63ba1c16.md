# Review 63ba1c16-bece-45a8-8ebe-338927acba58 — secret-redaction-by-value-and-fingerprin, round 1

- Commit: 798faa3
- Angle: one input method at a time
- Result: pass
- 3 findings

## Medium (2)

- **Secrets-file lines keep surrounding whitespace, so a padded entry never matches** — `src/lib/kit/redact.js:115` (security): parseSecretsFile strips only a trailing \r and pushes the line as is. A secrets file line like 'tok-abcdef ' (trailing spaces from an editor or paste) becomes the secret 'tok-abcdef ', and redactSecrets('x tok-abcdef y', ...) returns replaced: 0, so the value goes out unredacted with no warning. The same applies to fingerprints (the hash covers the spaces). Multi-line blocks already get trimmed lines as candidates; single-line entries do not. — fix: Trim single-line entries (secrets.push(line.trim())) before applying MIN\_LENGTH, and add a test with a padded entry.
- **Default secrets file is not found from a linked git worktree, so redaction silently does nothing** — `src/lib/kit/redact.js:188` (security): The default path is \`git rev-parse --show-toplevel\`/.claude/kit/secrets. In a linked worktree (the isolation marathon streams use), show-toplevel returns the worktree root. The secrets file is git-ignored, so it exists only in the main checkout. readFileOr(..., optional=true) returns null, and \`redact\` passes stdin through with replaced: 0 and no note. A user scrubbing text from inside a worktree gets back unredacted text that looks scrubbed. — fix: Locate the main checkout through \`git rev-parse --path-format=absolute --git-common-dir\` (its parent directory) and use that as a fallback, or report in the output that no secrets file was found.

## Low (1)

- **loadProjectSecrets doc says \[\] but the function returns null; nothing calls it** — `src/lib/kit/redact.js:134` (docs): The JSDoc says it returns \[\] when the file does not exist, but the code returns null. Nothing in the diff calls it: marathon's redactForModel parses the file on its own. — fix: Return \[\] to match the doc, or fix the doc, or remove the unused export.
