# Review ff26cdf4-1cdf-4397-b5f2-17fc3dc4abec — verdict, round 1

- Commit: 50f2ffb
- Angle: one input method at a time
- Result: over tolerance
- 5 findings

## High (1)

- **licenceClass strips parentheses, so a grouped OR beside an AND is classed permissive** — `src/lib/bbs/verdict.js:55` (correctness): '(MIT OR Apache-2.0) AND Proprietary', '(MIT OR GPL-3.0) AND BUSL-1.1' and 'GPL-3.0 AND (MIT OR Apache-2.0)' all return permissive; they should be commercial, commercial, copyleft. legalVerdicts then lets use through for a licence with a binding proprietary or copyleft term. — fix: Parse SPDX with precedence (AND tighter than OR, parentheses group); strictest-of-AND, most-permissive-of-OR over the tree; unbalanced or unrecognised → none. Tests for the three cases and nested groups.

## Medium (3)

- **BBS\_SANDBOX=present in any shell replaces real sandbox detection in the shipped CLI** — `src/lib/bbs/cli.js:339` (security): A leftover export or a CI env marks the sandbox present without running docker info; a permissive power with a clean probe then gets use on a machine with no sandbox, with no stderr trace. — fix: Honour only absent (the safe direction) with a stderr warning naming BBS\_SANDBOX; refuse present with exit 1.
- **Config sandbox.required\_for\_use:false makes use legal with no sandbox** — `src/lib/bbs/verdict.js:220` (security): A .claude/bbs.json override silently removes a rule the spec says cannot change; no warning, no reason recorded. — fix: Always require a present sandbox for use; ignore false with a stderr warning naming .claude/bbs.json.
- **Several input shapes and switches the contract names have no test of their own** — `test/bbs-verdict.test.js:287` (test-quality): Untested: CLI --from \<file\>/--from -/missing file; BBS\_SANDBOX=present and invalid; --evidence alone; --table after a probe changed legality; a refused --decide leaving verdicts.json and labels.jsonl byte-identical; grouped licence expressions; probe --force clean→found clearing a use decision. — fix: Add each as its own case.

## Low (1)

- **Probe evidence is stored and printed verbatim, with no length cap and no redaction** — `src/lib/bbs/verdict.js:321` (security): Evidence for a found probe often quotes the URL found, which can carry a token. — fix: Cap at 2 KiB, strip control characters, redact with intake's redactRef-style helper before storing or printing.
