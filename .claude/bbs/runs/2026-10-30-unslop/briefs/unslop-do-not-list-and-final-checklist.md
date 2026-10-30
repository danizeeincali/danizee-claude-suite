# unslop do-not list and final checklist — rebuild

## Idea (in our words)
Before handing over, check the redesign against hard limits: do not rename the product, keep a real logo, and redraw a slop logo flat rather than as a glossy or gradient tile; do not change the product's features, content or section order; do not swap removed decoration for new trends such as glass, grain, neon or bento grids; do not invent features, claims or data; and do not reuse the same look for every product. The checklist then confirms the direction is followed, the spacing is on the scale, icons and numbers align, colors and type meet the rules, no emoji or exclamation marks remain, the hero has a real visual with a moment, the first screen has no dead band, and motion is calm. The final template test swaps in another product's name and asks whether the screen still fits; if it does, the direction, copy, visual and signature should be pushed harder.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.123Z
- Evidence: skills/unslop/SKILL.md:209-233

## What we have
partial — landing-sections.js — check verifies section order against the canonical plan and that hero and final CTAs exist and match; nothing covers logo handling, emoji or exclamation marks, dead bands, real visuals, motion calm or the template test.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 6: Review · blocking — For UI, landing page or dashboard work, check the redesign against the do-not list, the closing checklist and the swap-the-product-name template test; failures stop the review. Advisory for non-UI work.
- `/w-marathon` · Completion Checklist · advisory — For UI, landing page or dashboard streams, confirm the do-not limits and template-fit test before closing; advisory for non-UI work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-do-not-list-and-final-checklist` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-do-not-list-and-final-checklist`: unslop-do-not-list-and-final-checklist: green unit runs in a row
- `egress_zero_unslop-do-not-list-and-final-checklist`: unslop-do-not-list-and-final-checklist: zero egress in the packaged check
- `six_sigma_unslop-do-not-list-and-final-checklist`: unslop-do-not-list-and-final-checklist: clean reviews in a row
- `wired_unslop-do-not-list-and-final-checklist`: unslop-do-not-list-and-final-checklist: wired into all 2 targets, reached by a user
- `packaged_unslop-do-not-list-and-final-checklist`: unslop-do-not-list-and-final-checklist: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-do-not-list-and-final-checklist — green unit runs in a row
- egress_zero_unslop-do-not-list-and-final-checklist — zero egress in the packaged check
- six_sigma_unslop-do-not-list-and-final-checklist — clean reviews in a row
- wired_unslop-do-not-list-and-final-checklist — wired into all 2 targets, reached by a user
- packaged_unslop-do-not-list-and-final-checklist — packaged check passes

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

