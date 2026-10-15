# Review 12b93dda-48b2-4364-913f-8a53c5e30d84 — finding-triage-with-fingerprint-dedup-an, round 5

- Commit: d13d8a5
- Angle: accessibility
- Result: pass
- 2 findings

## Low (2)

- **triage list shows only opaque hashes, so records on one scope+rule cannot be told apart** — `src/lib/kit/triage.js:415` (accessibility): Members are now sha256 hex (candidatesOf line 205), and list (line 415) prints them as the only per-record detail. Confirmed: after visits flagging 'button.submit' and then 'a.forgot-link' for login/contrast, list shows two records with the same scope and rule whose members are just 64-char hashes. A user who decides later from list, not straight from the visit report, cannot tell which fingerprint is which element. The header (line 21, 'stored with the set of element signatures') and the usage still describe readable signatures. — fix: Say in usage and the header that list members are hashes and that the readable \`elements\` come only in the visit report. Optionally keep a short redacted label per member (passed through the redact verb's scrubbing) so list can show it without storing raw text.
- **Exit code 2 from the new symlink refusal is not in triage's usage or header** — `src/lib/kit/triage.js:42` (docs): guardDefaultState (line 155) exits 2 ('kit: refused: ...'), confirmed with .claude/kit linked out of the tree. But the triage usage string (line 54, 'exit 0 done, 1 invalid input or corrupt state') and the header (line 42) list only 0 and 1. The kit-wide convention in cli.js defines 2 as a policy refusal, so the meaning is recoverable, but the verb's own help is wrong. — fix: Add '2 refused: the default state path goes through a symbolic link' to the usage string and the header's exit codes.
