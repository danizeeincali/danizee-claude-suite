# Review bba6ce41-4a5a-463a-8d14-78d3e5b6d271 — trouble-log-reflection-into-lesson-memor, round 4

- Commit: 22a3c99
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 1 findings

## Medium (1)

- **Lesson text and retire reason are saved without redaction to a store that is not git-ignored** — `src/lib/kit/reflect.js:397` (security): trouble-log redacts project secrets, but 'lessons save' (--text, --scope) and 'lessons retire' (--reason) write the caller's strings to .claude/kit/lessons.json as given. Nothing checks them against the secrets file. The reviewer model in /w-fix and /w-bbs has the whole session in its context, not only the redacted trouble log, so it can put a credential in a lesson. That file is not in .gitignore (only .claude/kit/secrets and .claude/kit/cache/ are), so the secret can be committed, and 'lessons list' sends it back into every later reviewer prompt. Confirmed: in a repo whose .claude/kit/secrets holds 'SuperSecretToken123', \`reflect lessons save --role fixer --session s1 --text "Use token SuperSecretToken123 when calling the staging API."\` exits 0 and stores the token in clear. \`lessons retire --id L1 --reason "token SuperSecretToken123 rotated"\` also stores it, and \`lessons list --all\` prints both. git check-ignore reports nothing for .claude/kit/lessons.json. — fix: In save and retire, load the secrets the same way trouble-log does (loadSecrets) and refuse with exit 1 when redactSecrets finds a match in text, scope or reason (or store the redacted form). Add tests for a planted secret in --text and --reason.
