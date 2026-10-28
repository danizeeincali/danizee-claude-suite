# Realistic sample content rules — rebuild

## Idea (in our words)
Write real sentences in the product voice rather than lorem ipsum. Give people full names suited to the audience, invent company names that fit the industry, and avoid suspiciously round figures and repeated dates. Ban a list of hype words, use sentence case for headings and buttons, and write system messages as calm, specific statements that say what failed and what to do next.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.763Z
- Evidence: repo/skills/landing-page-design/SKILL.md:295-305

## What we have
missing — notes.js parses captured note text for people and topics; no candidate generates sample copy, names or hype-word bans.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 6: Review · advisory — For UI or landing work, review placeholder copy, names, prices and figures against the believable-content checklist and flag filler phrases; advisory.
- `/analysis:design` · What It Creates · advisory — Sample content in the generated design follows the realistic-content checklist.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory — When a stream builds UI, check placeholder content each loop pass against the realism rules; advisory.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_realistic-sample-content-rules` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_realistic-sample-content-rules`: realistic-sample-content-rules: green unit runs in a row
- `egress_zero_realistic-sample-content-rules`: realistic-sample-content-rules: zero egress in the packaged check
- `six_sigma_realistic-sample-content-rules`: realistic-sample-content-rules: clean reviews in a row
- `wired_realistic-sample-content-rules`: realistic-sample-content-rules: wired into all 3 targets, reached by a user
- `packaged_realistic-sample-content-rules`: realistic-sample-content-rules: packaged check passes

## Kickoff lines

Done means
- tests_green_realistic-sample-content-rules — green unit runs in a row
- egress_zero_realistic-sample-content-rules — zero egress in the packaged check
- six_sigma_realistic-sample-content-rules — clean reviews in a row
- wired_realistic-sample-content-rules — wired into all 3 targets, reached by a user
- packaged_realistic-sample-content-rules — packaged check passes

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

