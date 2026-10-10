# secret-redaction-by-value-and-fingerprint — rebuild

## Idea (in our words)
Before any output (a report, a log, a prompt sent to a model) leaves the machine, replace each known secret with a fixed marker. Details that make it work: strings shorter than six characters are skipped to avoid hitting ordinary text; every multi-line secret such as a private key also contributes each of its trimmed lines, so a partial copy is still caught; all matches are located on the original text before any replacement, and overlapping matches merge, so a short secret inside a longer one cannot leave a tail behind. A variant keeps line breaks so line numbers in the output still match the source. The fingerprint path stores only lengths and SHA-256 hashes of the secrets, then slides a window of each length over short text and hashes it, so a finding's title or description can be scrubbed without keeping the secret values around. Useful for a personal suite that sends diffs or notes to a model: keep a secret list locally, redact before sending, and keep only fingerprints in any saved state.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.300Z
- Evidence: repo/packages/core/src/redact.ts:1-101

## What we have
partial — intake.js — redactRef and redactUrlsInText mask URL userinfo and token-like query values by pattern; no secret list, length-gated value matching, multi-line key handling, or fingerprint store.

## Finish line (5 checks, written before the build)
- `tests_green_secret-redaction-by-value-and-fingerprin`: secret-redaction-by-value-and-fingerprin: green unit runs in a row
- `egress_zero_secret-redaction-by-value-and-fingerprin`: secret-redaction-by-value-and-fingerprin: zero egress in the packaged check
- `six_sigma_secret-redaction-by-value-and-fingerprin`: secret-redaction-by-value-and-fingerprin: clean reviews in a row
- `callers_secret-redaction-by-value-and-fingerprin`: secret-redaction-by-value-and-fingerprin: callers in the harness
- `packaged_secret-redaction-by-value-and-fingerprin`: secret-redaction-by-value-and-fingerprin: packaged check passes

## Kickoff lines

Done means
- tests_green_secret-redaction-by-value-and-fingerprin — green unit runs in a row
- egress_zero_secret-redaction-by-value-and-fingerprin — zero egress in the packaged check
- six_sigma_secret-redaction-by-value-and-fingerprin — clean reviews in a row
- callers_secret-redaction-by-value-and-fingerprin — callers in the harness
- packaged_secret-redaction-by-value-and-fingerprin — packaged check passes

You may decide on your own
- How to structure the code behind each power's interface, within its brief
- Test names, fixtures and file layout

Ask me before
- Adding a dependency
- Any network call, account, purchase or signature
- Changing a finish line

Never
- Never execute fetched foreign code
- Never copy source code from the source

