# asymmetric threshold router — rebuild

## Idea (in our words)
Encode the principle that a wrong raise is recoverable but a wrong silence is not. Evaluate in a fixed order: a ledger match ends as intended; a deterministic regression always goes to a blocking check and the model cannot override it; a confident not-anomalous answer is ignored; a high ambiguity flag escalates; a missing answer or one below the low threshold becomes a human question. Suppression and auto-fix require the high threshold, and anything between the two thresholds asks. A check verdict from the model with no deterministic backing is downgraded to an issue, so a red check always means the same pixels changed. Auto-fix eligibility is a separate predicate with the same confidence floor.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.340Z
- Evidence: packages/decide/src/thresholds.ts:28-83

## What we have
partial — push-gate.js — push-gate decide() returns abstain/ask/deny with a none/high/medium/low threshold and never allows, but has no ambiguity escalation band, auto-fix predicate or model-verdict downgrade.

## Lands in (a separate deliverable)
- `/w-review` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · advisory — Routes validator answers: raising a concern is free, suppressing or auto-fixing needs high confidence, deterministic failures never overridden.
- `/w-fix` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · blocking — Gates auto-fix acceptance on high confidence while a failing regression test can never be overridden.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_asymmetric-threshold-router` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_asymmetric-threshold-router`: asymmetric-threshold-router: green unit runs in a row
- `egress_zero_asymmetric-threshold-router`: asymmetric-threshold-router: zero egress in the packaged check
- `six_sigma_asymmetric-threshold-router`: asymmetric-threshold-router: clean reviews in a row
- `wired_asymmetric-threshold-router`: asymmetric-threshold-router: wired into all 2 targets, reached by a user
- `packaged_asymmetric-threshold-router`: asymmetric-threshold-router: packaged check passes

## Kickoff lines

Done means
- tests_green_asymmetric-threshold-router — green unit runs in a row
- egress_zero_asymmetric-threshold-router — zero egress in the packaged check
- six_sigma_asymmetric-threshold-router — clean reviews in a row
- wired_asymmetric-threshold-router — wired into all 2 targets, reached by a user
- packaged_asymmetric-threshold-router — packaged check passes

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

