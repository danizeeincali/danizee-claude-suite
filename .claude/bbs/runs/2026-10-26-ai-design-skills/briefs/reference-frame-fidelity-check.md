# Reference frame fidelity check — rebuild

## Idea (in our words)
Render the static version at a fixed scale, blur both images lightly to suppress sub-pixel antialiasing, and compute a peak signal-to-noise score for the whole frame and for each container, with a target for each. Where a region scores low, retry it with heavier blur so only structure is compared, and inspect an amplified difference image to find misplaced stacking, shadows or strokes rather than chasing tiny offsets.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.765Z
- Evidence: repo/skills/design-to-motion/SKILL.md:193-199

## What we have
missing — threshold-route.js routes model-judged findings by confidence; no candidate computes PSNR or blur-compares a rendered frame against a reference.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 4: Tests (BLOCKING GATE) · blocking — For UI or animation tasks with a reference design, compare the rendered still to the reference using blurred PSNR per container before motion is added; a score below target stops the flow.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · blocking — In UI streams, run the per-container fidelity score each loop pass and treat a score under target as an unmet build gate; applies only to UI work.
- `/w-perf` · ⛔ CHECKPOINT 1: Profiling Done · advisory — Alongside screenshots, score the rendered still against the reference with blurred PSNR and report per container.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_reference-frame-fidelity-check` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_reference-frame-fidelity-check`: reference-frame-fidelity-check: green unit runs in a row
- `egress_zero_reference-frame-fidelity-check`: reference-frame-fidelity-check: zero egress in the packaged check
- `six_sigma_reference-frame-fidelity-check`: reference-frame-fidelity-check: clean reviews in a row
- `wired_reference-frame-fidelity-check`: reference-frame-fidelity-check: wired into all 3 targets, reached by a user
- `packaged_reference-frame-fidelity-check`: reference-frame-fidelity-check: packaged check passes

## Kickoff lines

Done means
- tests_green_reference-frame-fidelity-check — green unit runs in a row
- egress_zero_reference-frame-fidelity-check — zero egress in the packaged check
- six_sigma_reference-frame-fidelity-check — clean reviews in a row
- wired_reference-frame-fidelity-check — wired into all 3 targets, reached by a user
- packaged_reference-frame-fidelity-check — packaged check passes

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

