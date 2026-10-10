# pre-push-review-gate — rebuild

## Idea (in our words)
Keep the push gate advisory by default: it only ever abstains or denies, never allows, so it cannot skip the developer's own permission prompt. The review writes a small receipt keyed by a hash of exactly what is being pushed (the change id), recording verdict, base commit, counts and the severity threshold it was judged under. At push time a hook looks up that receipt for the current change id. Same change and verdict passes silently. No receipt for this change asks for a review, and denies only when a threshold is set. A receipt from an incomplete review never blocks. A receipt judged under a different threshold does not count. A receipt for an older version of the change is reported as earlier. Store the receipt outside the repository so a branch cannot carry a forged one. Reusable for any personal suite that wants a review-before-push guard without giving a hook power to approve anything.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.294Z
- Evidence: repo/packages/core/src/push-gate.ts:45-113, repo/packages/core/src/push-gate.ts:1-9

## What we have
missing — None of the five candidates writes a change-id receipt or runs a push-time hook; they are review command docs only.

## Finish line (5 checks, written before the build)
- `tests_green_pre-push-review-gate`: pre-push-review-gate: green unit runs in a row
- `egress_zero_pre-push-review-gate`: pre-push-review-gate: zero egress in the packaged check
- `six_sigma_pre-push-review-gate`: pre-push-review-gate: clean reviews in a row
- `callers_pre-push-review-gate`: pre-push-review-gate: callers in the harness
- `packaged_pre-push-review-gate`: pre-push-review-gate: packaged check passes

## Kickoff lines

Done means
- tests_green_pre-push-review-gate — green unit runs in a row
- egress_zero_pre-push-review-gate — zero egress in the packaged check
- six_sigma_pre-push-review-gate — clean reviews in a row
- callers_pre-push-review-gate — callers in the harness
- packaged_pre-push-review-gate — packaged check passes

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

