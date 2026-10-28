# Landing page section order — rebuild

## Idea (in our words)
Lay the page out as ordered sections: a headline stating outcome and audience, a supporting subheadline, one primary call to action, a single proof signal and a hero visual above the fold; then problem and solution, outcome-driven benefits, a three-step process and social proof; then an FAQ, a risk reversal and a final call to action that mirrors the top. A tagline section sits within the middle argument.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.759Z
- Evidence: repo/skills/landing-page-design/SKILL.md:52-72

## What we have
partial — layout.md — layout.md offers a marketing/landing page layout type but defines no ordered section sequence (headline, proof, FAQ, final CTA).

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 3: Spec · advisory — When the task is a landing page, write the spec as the fixed numbered section sequence (hero, argument, objection handling, repeated final CTA); advisory for non-landing work.
- `/analysis:layout` · Layout Types · advisory — Offer the landing-page section order as a layout type with its fixed numbered sections.
- `/analysis:design` · What It Creates · advisory — Design output for a landing page follows the fixed section sequence.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_landing-page-section-order` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_landing-page-section-order`: landing-page-section-order: green unit runs in a row
- `egress_zero_landing-page-section-order`: landing-page-section-order: zero egress in the packaged check
- `six_sigma_landing-page-section-order`: landing-page-section-order: clean reviews in a row
- `wired_landing-page-section-order`: landing-page-section-order: wired into all 3 targets, reached by a user
- `packaged_landing-page-section-order`: landing-page-section-order: packaged check passes

## Kickoff lines

Done means
- tests_green_landing-page-section-order — green unit runs in a row
- egress_zero_landing-page-section-order — zero egress in the packaged check
- six_sigma_landing-page-section-order — clean reviews in a row
- wired_landing-page-section-order — wired into all 3 targets, reached by a user
- packaged_landing-page-section-order — packaged check passes

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

