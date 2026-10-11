# Review 3fd389df-4c6e-4898-ac8a-17a4994b0180 — bc, round 4

- Commit: a122148
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 3 findings

## Medium (2)

- **Plain git diff "$BASE" can lazy-fetch over the network and hang on a credential prompt** — `src/plugins/dot-shortcuts.js:3747` (security): The redact block and Step 1's category detection run a bare git diff. In a partial or promisor clone git fetches missing blobs on demand (a network call that is neither a Pi Brain read nor the owner's push) and GIT\_TERMINAL\_PROMPT is unset, so the background agent can stop at a credential prompt. diff-range turns lazy fetch off; the block skips that protection. — fix: Write the range with the hardened verb: node .claude/helpers/kit/cli.js diff-range --base "$BASE" --no-untracked \> "$D" (check its exit the same way, exit 3 = empty range), or at least prefix with GIT\_NO\_LAZY\_FETCH=1 GIT\_TERMINAL\_PROMPT=0.
- **Redact rule skips ralph-candidates.md and the commit message, both of which get committed and pushed** — `src/plugins/dot-shortcuts.js:3742` (security): The rule requires redaction only before the solution doc or a memory export. The RC-D/RC-F diagnostics built from the diff go into .claude/ralph-candidates.md and the descriptive commit message can quote diff text; both go into the Phase 2 commit without redact. The scrub checks only the scrub-pattern list, not the secrets file. — fix: Extend the rule to every write and commit that carries diff text: solution doc, ralph-candidates.md, memory exports and the commit message; each takes only the redacted text.

## Low (1)

- **BASE from the dispatch prompt is passed to git diff without checking it is a commit** — `src/plugins/dot-shortcuts.js:3747` (security): A value starting with -- would be parsed as an option (e.g. --output=/some/path) and could write outside the repository. The lead normally writes a sha, so this is hardening. — fix: Check BASE with git rev-parse --verify -q "$BASE^{commit}" and use the resolved sha (or --end-of-options); on failure RC=1 with 'BASE is not a commit'.
