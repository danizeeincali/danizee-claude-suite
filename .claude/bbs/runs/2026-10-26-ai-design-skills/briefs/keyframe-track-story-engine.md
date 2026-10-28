# Keyframe track story engine — rebuild

## Idea (in our words)
Write a one-sentence story for each visual from a menu of patterns such as a new item landing on a stack, a chart scrubber gliding, a donut segment easing outward, a typed prompt revealing glyph by glyph, or a marquee moving one full set. Build each story from eased keyframe tracks evaluated against the loop clock, so every story starts and ends on the exact design, and offset stories across cards so they do not act in unison.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.768Z
- Evidence: repo/skills/design-to-motion/SKILL.md:243-293

## What we have
missing — shared-budget.js is a per-job spend allowance and design.md only lists a component spec; no eased keyframe track engine exists.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory — When a landing page needs looping in-page visuals, drive them from one eased keyframe function on a shared clock with a story picker; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory — In animated-UI streams, build looping stories on the shared-clock keyframe engine; advisory for non-UI work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_keyframe-track-story-engine` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_keyframe-track-story-engine`: keyframe-track-story-engine: green unit runs in a row
- `egress_zero_keyframe-track-story-engine`: keyframe-track-story-engine: zero egress in the packaged check
- `six_sigma_keyframe-track-story-engine`: keyframe-track-story-engine: clean reviews in a row
- `wired_keyframe-track-story-engine`: keyframe-track-story-engine: wired into all 2 targets, reached by a user
- `packaged_keyframe-track-story-engine`: keyframe-track-story-engine: packaged check passes

## Kickoff lines

Done means
- tests_green_keyframe-track-story-engine — green unit runs in a row
- egress_zero_keyframe-track-story-engine — zero egress in the packaged check
- six_sigma_keyframe-track-story-engine — clean reviews in a row
- wired_keyframe-track-story-engine — wired into all 2 targets, reached by a user
- packaged_keyframe-track-story-engine — packaged check passes

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

