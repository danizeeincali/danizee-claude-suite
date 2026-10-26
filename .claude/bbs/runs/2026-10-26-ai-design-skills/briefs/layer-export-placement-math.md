# Layer export placement math — rebuild

## Idea (in our words)
Export each moving element as its own high-resolution image in batches. Choose its placement from a decision table: use the render bounds when the image matches them, offset by the overhang when a parent clipped it or effects spread evenly, use the stroke or fill geometry when the overhang is uneven, and export with absolute bounds for arcs, rotated blobs and masks. Keep the original z order, and where a container's children must move separately, rebuild the container in CSS and export each child.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.766Z
- Evidence: repo/skills/design-to-motion/SKILL.md:93-109

## What we have
missing — render.js renders findings to SARIF, JUnit or comments; no candidate exports layers or computes placement bounds.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory — When assembling exported design layers into animated UI, compute each layer's placement (overhang, clipping, stroke geometry) so it lines up with the source; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory — In animation streams, use the placement math when positioning exported layer images; advisory for non-UI work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_layer-export-placement-math` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_layer-export-placement-math`: layer-export-placement-math: green unit runs in a row
- `egress_zero_layer-export-placement-math`: layer-export-placement-math: zero egress in the packaged check
- `six_sigma_layer-export-placement-math`: layer-export-placement-math: clean reviews in a row
- `wired_layer-export-placement-math`: layer-export-placement-math: wired into all 2 targets, reached by a user
- `packaged_layer-export-placement-math`: layer-export-placement-math: packaged check passes

## Kickoff lines

Done means
- tests_green_layer-export-placement-math — green unit runs in a row
- egress_zero_layer-export-placement-math — zero egress in the packaged check
- six_sigma_layer-export-placement-math — clean reviews in a row
- wired_layer-export-placement-math — wired into all 2 targets, reached by a user
- packaged_layer-export-placement-math — packaged check passes

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

