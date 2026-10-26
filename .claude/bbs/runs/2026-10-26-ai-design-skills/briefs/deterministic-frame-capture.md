# Deterministic frame capture — rebuild

## Idea (in our words)
Install a fake clock in a headless browser, step it by whole-millisecond increments that average the target frame rate, advance the page's own animation clock inside the same evaluation as the seek, pause all CSS animations at the matching time, and screenshot each frame. Save the loop time for each frame beside the images so the export window and seam checks can be verified.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.769Z
- Evidence: repo/skills/design-to-motion/SKILL.md:365-402

## What we have
missing — w-marathon-times uses a wall-clock deadline and w-perf takes plain screenshots; no candidate installs a fake clock or steps animation frames.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 4: Tests (BLOCKING GATE) · advisory — For animation tasks, record output frame by frame under a stepped fake clock so test captures are repeatable; advisory outside animation work.
- `/w-perf` · ⛔ CHECKPOINT 1: Profiling Done · advisory — Capture animation frames under a stepped fake clock instead of real-time recording so profiling screenshots are repeatable.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_deterministic-frame-capture` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_deterministic-frame-capture`: deterministic-frame-capture: green unit runs in a row
- `egress_zero_deterministic-frame-capture`: deterministic-frame-capture: zero egress in the packaged check
- `six_sigma_deterministic-frame-capture`: deterministic-frame-capture: clean reviews in a row
- `wired_deterministic-frame-capture`: deterministic-frame-capture: wired into all 2 targets, reached by a user
- `packaged_deterministic-frame-capture`: deterministic-frame-capture: packaged check passes

## Kickoff lines

Done means
- tests_green_deterministic-frame-capture — green unit runs in a row
- egress_zero_deterministic-frame-capture — zero egress in the packaged check
- six_sigma_deterministic-frame-capture — clean reviews in a row
- wired_deterministic-frame-capture — wired into all 2 targets, reached by a user
- packaged_deterministic-frame-capture — packaged check passes

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
- Never run the upstream code (use was removed: network probe found: the source makes a network call the inventory does not account for)

