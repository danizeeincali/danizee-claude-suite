# unslop direction brief — rebuild

## Idea (in our words)
Write five short lines before touching anything. Product is one plain sentence on what it does and for whom. Character is two or three concrete words, with a banned list of generic adjectives such as clean, modern, sleek, minimal and premium, because they fit every template. World is the place or material the product naturally belongs to, which sets the tint of the neutrals, the accent and the visual. Moments are one or two places where color, material and detail are allowed to get rich, chosen from what the product shows. Signature is one small detail only this product would have, used consistently and nowhere else. The examples in the source are shapes of an answer, not answers to reuse. A real brand color, logo or typeface that is not slop is kept and the direction is built around it. Gradients, sparkles and glow do not count as brand unless the user says they do.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.114Z
- Evidence: skills/unslop/SKILL.md:54-66

## What we have
partial — design-brief.js — questions/assume capture product offer, audience and brand constraints, but nothing on character, world, moments or signature, no banned-adjective list, and its default brand text uses 'clean'.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 2: Plan · advisory — For UI, landing page or dashboard tasks, write the five-line direction (product, character, world, moments, signature) into the plan before any visual change; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 1: Interview (HIL — once) · advisory — For UI, landing page or dashboard streams, derive the direction from the product and confirm it in the single interview batch; advisory for non-UI work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-direction-brief` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-direction-brief`: unslop-direction-brief: green unit runs in a row
- `egress_zero_unslop-direction-brief`: unslop-direction-brief: zero egress in the packaged check
- `six_sigma_unslop-direction-brief`: unslop-direction-brief: clean reviews in a row
- `wired_unslop-direction-brief`: unslop-direction-brief: wired into all 2 targets, reached by a user
- `packaged_unslop-direction-brief`: unslop-direction-brief: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-direction-brief — green unit runs in a row
- egress_zero_unslop-direction-brief — zero egress in the packaged check
- six_sigma_unslop-direction-brief — clean reviews in a row
- wired_unslop-direction-brief — wired into all 2 targets, reached by a user
- packaged_unslop-direction-brief — packaged check passes

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

