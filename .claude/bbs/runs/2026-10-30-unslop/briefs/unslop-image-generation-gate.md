# unslop image generation gate — rebuild

## Idea (in our words)
Image generation can cost money, so the agent must show the user the prompt, the model and the size, and wait for a yes before each run. Run once, judge the result against the one-sentence brief and the palette, and change the prompt rather than rerolling the same one. Save the result into the project's assets, not a temporary URL. If no image tool is connected and the screen needs a scene or object, say so before the visuals pass and offer to connect one. If the user declines or skips, leave an empty slot of the exact size with the layout radius and no text, and put the prompt in the report rather than on the page, so unfinished placeholders cannot ship by accident. Tell the user which kind of service could generate it and the file name to save it under.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.119Z
- Evidence: skills/unslop/references/visuals.md:52-60, skills/unslop/SKILL.md:50

## What we have
missing — No candidate generates images or asks for a yes before a paid run; bg-fill.js only computes CSS background sizing for an existing image.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · blocking — Before any paid image generation for a UI or landing page, show prompt, model and size and wait for approval; if declined leave an empty slot and put the prompt in the report.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · blocking — Before any paid image generation in a UI or landing page stream, require approval of prompt, model and size; declined means an empty slot, not a stalled loop.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-image-generation-gate` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-image-generation-gate`: unslop-image-generation-gate: green unit runs in a row
- `egress_zero_unslop-image-generation-gate`: unslop-image-generation-gate: zero egress in the packaged check
- `six_sigma_unslop-image-generation-gate`: unslop-image-generation-gate: clean reviews in a row
- `wired_unslop-image-generation-gate`: unslop-image-generation-gate: wired into all 2 targets, reached by a user
- `packaged_unslop-image-generation-gate`: unslop-image-generation-gate: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-image-generation-gate — green unit runs in a row
- egress_zero_unslop-image-generation-gate — zero egress in the packaged check
- six_sigma_unslop-image-generation-gate — clean reviews in a row
- wired_unslop-image-generation-gate — wired into all 2 targets, reached by a user
- packaged_unslop-image-generation-gate — packaged check passes

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

