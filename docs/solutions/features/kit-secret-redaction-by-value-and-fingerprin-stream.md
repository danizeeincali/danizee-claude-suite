# kit stream: secret-redaction-by-value-and-fingerprin (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js redact` (`src/lib/kit/redact.js`): replace known secrets with `[REDACTED]` (entries
under six characters skipped; multi-line secrets also contribute each trimmed line; matches found on the original
text and merged before replacing; a keep-lines mode), and a fingerprint mode that keeps only lengths and SHA-256s.
Secrets file: `.claude/kit/secrets` (git-ignored by the kit install). Caller: marathon `review-brief` redacts the diff
before it goes to a reviewer model, and fails closed when a secrets file exists but redaction cannot run.

**Rounds:** r1 pass (2 medium security fixed: padded entries never matched; worktrees missed the secrets file),
r2 pass (2 medium security fixed: fail-open on an unreadable file or a missing kit), r3 over (1 high: git < 2.31
echoes `--path-format`, so redaction silently failed open — fixed for redact and push-gate with one shared
`git-paths.js`), r4 pass, r5 pass.

**Promoted rules:** fail closed for safety steps; never `--path-format`; fakes behave like the real thing.
