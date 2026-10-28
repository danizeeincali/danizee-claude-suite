# Intake batch before design — rebuild

## Idea (in our words)
Before designing, gather the offer, the one primary action, the audience and its objections, the proof available, and the brand and design constraints in a single round of questions. Where an answer is missing, state a one-line assumption and continue rather than waiting for the user.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.755Z
- Evidence: repo/skills/landing-page-design/SKILL.md:24-50

## What we have
missing — design.md and frontend-design.js only generate component specs; no candidate gathers offer, CTA, audience, proof and brand in one question round.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 1: Interview (MANDATORY - NEVER SKIP) · advisory — When the task is a landing page, UI or animation build, batch all missing brief items (audience, offer, brand, references) into one interview round and record stated assumptions for gaps; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 1: Interview (HIL — once) · advisory — For UI or landing-page streams, ask the missing design brief in the single interview batch and log assumptions instead of stalling; advisory for non-UI work.
- `/analysis:design` · Usage · advisory — Run the design workflow with one intake batch up front, filling gaps with stated assumptions.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_intake-batch-before-design` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_intake-batch-before-design`: intake-batch-before-design: green unit runs in a row
- `egress_zero_intake-batch-before-design`: intake-batch-before-design: zero egress in the packaged check
- `six_sigma_intake-batch-before-design`: intake-batch-before-design: clean reviews in a row
- `wired_intake-batch-before-design`: intake-batch-before-design: wired into all 3 targets, reached by a user
- `packaged_intake-batch-before-design`: intake-batch-before-design: packaged check passes

## Kickoff lines

Done means
- tests_green_intake-batch-before-design — green unit runs in a row
- egress_zero_intake-batch-before-design — zero egress in the packaged check
- six_sigma_intake-batch-before-design — clean reviews in a row
- wired_intake-batch-before-design — wired into all 3 targets, reached by a user
- packaged_intake-batch-before-design — packaged check passes

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

