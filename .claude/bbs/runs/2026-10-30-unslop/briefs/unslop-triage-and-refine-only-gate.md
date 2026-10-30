# unslop triage and refine-only gate — rebuild

## Idea (in our words)
Grade the audit honestly into three modes. Heavy slop, with many signs across color, type, icons and copy, runs the full ordered process. Light slop, where the screen is mostly designed, gets polish mode: fix only what the audit found, take the direction from the existing brand, keep palette, type, layout and visual, and send bigger ideas to the report as suggestions. No slop means saying so plainly, offering two or three small refinements with exact values, and applying them only if the user agrees; a good screen is never changed just to look different. For heavy and light runs, write the direction and wait for the user before editing, because changing direction later means redoing every pass. Skip the wait only when the user has already said to just do it. Keep the run quick by rendering at most three times, and start any image generation as soon as the direction is confirmed.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.115Z
- Evidence: skills/unslop/SKILL.md:39-50

## What we have
missing — triage.js tracks finding identity across runs and issue lifecycle; no candidate grades a screen as heavy, light or no slop or gates on user agreement.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 1: Interview (MANDATORY - NEVER SKIP) · advisory — For UI, landing page or dashboard tasks, grade the existing screen as heavy, light or no slop and ask the user to confirm the direction in the interview; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 2: Kickoff (HIL — the last question) · advisory — For UI, landing page or dashboard streams, include the triage grade and refine-only option in the kickoff question; advisory for non-UI work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-triage-and-refine-only-gate` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-triage-and-refine-only-gate`: unslop-triage-and-refine-only-gate: green unit runs in a row
- `egress_zero_unslop-triage-and-refine-only-gate`: unslop-triage-and-refine-only-gate: zero egress in the packaged check
- `six_sigma_unslop-triage-and-refine-only-gate`: unslop-triage-and-refine-only-gate: clean reviews in a row
- `wired_unslop-triage-and-refine-only-gate`: unslop-triage-and-refine-only-gate: wired into all 2 targets, reached by a user
- `packaged_unslop-triage-and-refine-only-gate`: unslop-triage-and-refine-only-gate: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-triage-and-refine-only-gate — green unit runs in a row
- egress_zero_unslop-triage-and-refine-only-gate — zero egress in the packaged check
- six_sigma_unslop-triage-and-refine-only-gate — clean reviews in a row
- wired_unslop-triage-and-refine-only-gate — wired into all 2 targets, reached by a user
- packaged_unslop-triage-and-refine-only-gate — packaged check passes

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
- Never run the upstream code (use was removed: licence none — use is legal only for a permissive licence)

