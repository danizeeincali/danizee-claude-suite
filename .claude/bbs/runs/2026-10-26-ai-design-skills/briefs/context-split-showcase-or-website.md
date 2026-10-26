# Context split showcase or website — rebuild

## Idea (in our words)
Before building, classify the job as either a self-contained showcase that plays from an empty state and loops, or a website section that animates once on scroll with live text. Then go section by section: hero text always gets a small load-in, cards with visuals get a card intro plus a story, product mockups get only a load-in until the user says otherwise, and text-only blocks are left to the normal scroll reveal.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.764Z
- Evidence: repo/skills/design-to-motion/SKILL.md:20-45

## What we have
missing — surfaces.js locates where users meet a feature in code; no candidate classifies a showcase versus a scroll-animated website section.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 2: Plan · advisory — When the task is animating a design, decide first whether it is a standalone showcase or a website section and map each page section to its motion; advisory for non-animation work.
- `/w-marathon` · ⛔ CHECKPOINT 1: Interview (HIL — once) · advisory — For animation streams, ask the showcase-versus-website question in the interview and record the motion map per section.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_context-split-showcase-or-website` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_context-split-showcase-or-website`: context-split-showcase-or-website: green unit runs in a row
- `egress_zero_context-split-showcase-or-website`: context-split-showcase-or-website: zero egress in the packaged check
- `six_sigma_context-split-showcase-or-website`: context-split-showcase-or-website: clean reviews in a row
- `wired_context-split-showcase-or-website`: context-split-showcase-or-website: wired into all 2 targets, reached by a user
- `packaged_context-split-showcase-or-website`: context-split-showcase-or-website: packaged check passes

## Kickoff lines

Done means
- tests_green_context-split-showcase-or-website — green unit runs in a row
- egress_zero_context-split-showcase-or-website — zero egress in the packaged check
- six_sigma_context-split-showcase-or-website — clean reviews in a row
- wired_context-split-showcase-or-website — wired into all 2 targets, reached by a user
- packaged_context-split-showcase-or-website — packaged check passes

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

