# repeated replay gate for claims — rebuild

## Idea (in our words)
Split every verdict by how it was decided. Only verdicts a program decided (a replay, an exact check, or a diff of normalised outputs) may fail a gate, and only after a second identical run agrees on the steps reached, the check answers and the outputs. If the two runs disagree, downgrade the verdict to untested with a flakiness reason rather than failing. A model's judgement, however confident, is posted as a comment only. Useful for a Claude Code workflow that wants a hard stop without letting model opinion block work.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.351Z
- Evidence: (no location given)

## What we have
partial — wording-judge.js — wording-judge reports model opinion beside scores and the scorer never reads it, which covers the model-comment-only half; it has no program-decided verdict split, second identical replay run or untested downgrade.

## Lands in (a separate deliverable)
- `/w-review` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · blocking — Only a disproof that reproduces on a second replay may fail a check; model-judged or flaky ones stay comments.
- `/w-debug` · ⛔ CHECKPOINT 2: Diagnosis (BLOCKING GATE) · blocking — Requires the diagnosis to reproduce on a second replay before it gates the fix.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_repeated-replay-gate-for-claims` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_repeated-replay-gate-for-claims`: repeated-replay-gate-for-claims: green unit runs in a row
- `egress_zero_repeated-replay-gate-for-claims`: repeated-replay-gate-for-claims: zero egress in the packaged check
- `six_sigma_repeated-replay-gate-for-claims`: repeated-replay-gate-for-claims: clean reviews in a row
- `wired_repeated-replay-gate-for-claims`: repeated-replay-gate-for-claims: wired into all 2 targets, reached by a user
- `packaged_repeated-replay-gate-for-claims`: repeated-replay-gate-for-claims: packaged check passes

## Kickoff lines

Done means
- tests_green_repeated-replay-gate-for-claims — green unit runs in a row
- egress_zero_repeated-replay-gate-for-claims — zero egress in the packaged check
- six_sigma_repeated-replay-gate-for-claims — clean reviews in a row
- wired_repeated-replay-gate-for-claims — wired into all 2 targets, reached by a user
- packaged_repeated-replay-gate-for-claims — packaged check passes

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

