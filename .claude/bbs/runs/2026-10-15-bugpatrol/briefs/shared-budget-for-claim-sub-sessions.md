# shared budget for claim sub-sessions — rebuild

## Idea (in our words)
A review-level budget object holds the running totals. Each new sub-session gets only what remains of the step, cost and time limits, and a sub-session that starts with nothing left is skipped with a logged reason instead of failing. The clock runs only while claim work is active, so an unrelated bug hunt does not eat the time allowance. Nested claim work increments a depth counter so the clock is started once and never double-counts. Pure checks such as replays and benchmarks use no model, so only the time limit can stop them. Each session's spend is recorded back into the budget and into the review's cost total as soon as it ends, including on failure. A runtime that throws fails the review, while limit exhaustion does not. Suits a marathon runner in which several sub-agents must share one allowance.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.345Z
- Evidence: repo/packages/agents/src/roles/claim-judge.ts:21-86

## What we have
partial — budget.js — budget.js canFanOut sums spent tokens and in-flight budgets against a run token limit and usage ceiling, failing closed on bad input; it has no time limit, step/cost budget object, nesting depth counter or per-session spend recording.

## Lands in (a separate deliverable)
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · blocking — All helper model sessions in the loop draw from one allowance of steps, cost and wall-clock time.
- `/w-review` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · advisory — Claim-checking sub-sessions share a single review budget.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_shared-budget-for-claim-sub-sessions` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_shared-budget-for-claim-sub-sessions`: shared-budget-for-claim-sub-sessions: green unit runs in a row
- `egress_zero_shared-budget-for-claim-sub-sessions`: shared-budget-for-claim-sub-sessions: zero egress in the packaged check
- `six_sigma_shared-budget-for-claim-sub-sessions`: shared-budget-for-claim-sub-sessions: clean reviews in a row
- `wired_shared-budget-for-claim-sub-sessions`: shared-budget-for-claim-sub-sessions: wired into all 2 targets, reached by a user
- `packaged_shared-budget-for-claim-sub-sessions`: shared-budget-for-claim-sub-sessions: packaged check passes

## Kickoff lines

Done means
- tests_green_shared-budget-for-claim-sub-sessions — green unit runs in a row
- egress_zero_shared-budget-for-claim-sub-sessions — zero egress in the packaged check
- six_sigma_shared-budget-for-claim-sub-sessions — clean reviews in a row
- wired_shared-budget-for-claim-sub-sessions — wired into all 2 targets, reached by a user
- packaged_shared-budget-for-claim-sub-sessions — packaged check passes

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

