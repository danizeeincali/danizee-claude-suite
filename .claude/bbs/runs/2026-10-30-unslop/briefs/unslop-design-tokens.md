# unslop design tokens — rebuild

## Idea (in our words)
A reference sheet of starting values, to be overridden when the project already has a good system. The spacing scale is a 4-based ladder with per-use ranges for controls, lists, groups, sections and heroes, and fixed row heights for compact and touch layouts. Neutral ramps come in graphite, warm and ink variants for dark and light themes, with page, card, raised, hairline and three text roles, and semantic positive and negative colors toned to sit inside any ramp. The accent rule says keep a real brand color, otherwise take one from the world, and hold 4.5 to 1 contrast on text. Type families are grouped by character, one interface family with an optional mono or display partner, and the scale runs from small labels to hero headlines with letter spacing set by size. Radii are per element with the nested rule inner equals outer minus padding. Motion uses one easing curve with durations for feedback, menus and entrances, and a small stagger capped at six items.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.117Z
- Evidence: skills/unslop/references/tokens.md:5-131

## What we have
partial — entrance.js — entrance.js holds per-kind durations, a shared ease-out curve and a container stagger, covering part of the motion tokens only; no spacing scale, neutral ramps, type scale, radii or six-item stagger cap.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 3: Spec · advisory — For UI, landing page or dashboard specs, use the token sheet as starting values for spacing, ramps, type and motion unless the project already has a system; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory — In UI streams, pull spacing, color, radius and motion values from the token sheet when the project has none; advisory for non-UI work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-design-tokens` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-design-tokens`: unslop-design-tokens: green unit runs in a row
- `egress_zero_unslop-design-tokens`: unslop-design-tokens: zero egress in the packaged check
- `six_sigma_unslop-design-tokens`: unslop-design-tokens: clean reviews in a row
- `wired_unslop-design-tokens`: unslop-design-tokens: wired into all 2 targets, reached by a user
- `packaged_unslop-design-tokens`: unslop-design-tokens: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-design-tokens — green unit runs in a row
- egress_zero_unslop-design-tokens — zero egress in the packaged check
- six_sigma_unslop-design-tokens — clean reviews in a row
- wired_unslop-design-tokens — wired into all 2 targets, reached by a user
- packaged_unslop-design-tokens — packaged check passes

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

