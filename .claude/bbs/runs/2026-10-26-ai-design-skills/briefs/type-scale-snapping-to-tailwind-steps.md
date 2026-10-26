# Type scale snapping to Tailwind steps — rebuild

## Idea (in our words)
Look at every font size in the design. If it does not land exactly on a standard step from the Tailwind type scale, drop it to the closest step below and use that step's line height. Letter spacing and line height may only be tuned inside the step already chosen, so two rules never conflict.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.761Z
- Evidence: repo/skills/landing-page-design/SKILL.md:170-192

## What we have
missing — No candidate snaps font sizes to a Tailwind type scale; bbs/steps.js and marathon/page.js only handle command headings and a run page with hand-set rem sizes.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory — When building UI, snap any off-scale font size to the nearest smaller Tailwind step and use its paired line height; advisory outside UI work.
- `/analysis:design` · What It Creates · advisory — Typography tokens the design emits are snapped to Tailwind steps with paired line heights.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_type-scale-snapping-to-tailwind-steps` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_type-scale-snapping-to-tailwind-steps`: type-scale-snapping-to-tailwind-steps: green unit runs in a row
- `egress_zero_type-scale-snapping-to-tailwind-steps`: type-scale-snapping-to-tailwind-steps: zero egress in the packaged check
- `six_sigma_type-scale-snapping-to-tailwind-steps`: type-scale-snapping-to-tailwind-steps: clean reviews in a row
- `wired_type-scale-snapping-to-tailwind-steps`: type-scale-snapping-to-tailwind-steps: wired into all 2 targets, reached by a user
- `packaged_type-scale-snapping-to-tailwind-steps`: type-scale-snapping-to-tailwind-steps: packaged check passes

## Kickoff lines

Done means
- tests_green_type-scale-snapping-to-tailwind-steps — green unit runs in a row
- egress_zero_type-scale-snapping-to-tailwind-steps — zero egress in the packaged check
- six_sigma_type-scale-snapping-to-tailwind-steps — clean reviews in a row
- wired_type-scale-snapping-to-tailwind-steps — wired into all 2 targets, reached by a user
- packaged_type-scale-snapping-to-tailwind-steps — packaged check passes

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

