# finding triage with fingerprint dedup and absence closing — rebuild

## Idea (in our words)
Each capture becomes candidates, not raw violations. All violations of one rule on one screen merge into a single candidate that lists the affected elements, so eleven instances are one decision. Every candidate gets a fingerprint from screen, rule and element signature. A fingerprint already decided in the triage ledger is not raised again; if it was filed as an issue, it adds one occurrence to that issue, at most once per session, so the count means how many sessions saw it. The first capture of a screen becomes its baseline, and absolute checks still run on it. Absence closes: an issue raised only by automatic checks on a screen is marked fixed after three consecutive visits where none of its fingerprints fired; any sighting resets the count. Constraints from the code: explorer-sourced issues never auto-close, and a check that is switched off gives no evidence of absence, so its issues are skipped. Closing also syncs to the tracker. Useful for any suite that must avoid re-raising known problems while still retiring fixed ones.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.342Z
- Evidence: repo/packages/agents/src/evaluate.ts:45-106

## What we have
missing — No candidate fingerprints findings by screen, rule and element, keeps a triage ledger or closes issues after absent visits; redact.js fingerprints secrets only, which is unrelated.

## Lands in (a separate deliverable)
- `/w-review` · ⛔ CHECKPOINT 4: Ralph Candidates (AUTO-PROCEED) · advisory — Fingerprints findings, collapses repeats into few candidates, and closes candidates that checks no longer see.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_finding-triage-with-fingerprint-dedup-an` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_finding-triage-with-fingerprint-dedup-an`: finding-triage-with-fingerprint-dedup-an: green unit runs in a row
- `egress_zero_finding-triage-with-fingerprint-dedup-an`: finding-triage-with-fingerprint-dedup-an: zero egress in the packaged check
- `six_sigma_finding-triage-with-fingerprint-dedup-an`: finding-triage-with-fingerprint-dedup-an: clean reviews in a row
- `wired_finding-triage-with-fingerprint-dedup-an`: finding-triage-with-fingerprint-dedup-an: wired into its target, reached by a user
- `packaged_finding-triage-with-fingerprint-dedup-an`: finding-triage-with-fingerprint-dedup-an: packaged check passes

## Kickoff lines

Done means
- tests_green_finding-triage-with-fingerprint-dedup-an — green unit runs in a row
- egress_zero_finding-triage-with-fingerprint-dedup-an — zero egress in the packaged check
- six_sigma_finding-triage-with-fingerprint-dedup-an — clean reviews in a row
- wired_finding-triage-with-fingerprint-dedup-an — wired into its target, reached by a user
- packaged_finding-triage-with-fingerprint-dedup-an — packaged check passes

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
- Never run the upstream code (use was removed: network probe found: the source makes a network call the inventory does not account for)

