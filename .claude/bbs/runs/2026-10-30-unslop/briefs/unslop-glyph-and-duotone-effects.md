# unslop glyph and duotone effects — rebuild

## Idea (in our words)
When the direction fits, render the main image as a grid of characters whose brightness picks the glyph, using characters drawn from the product's own material, such as money symbols for finance or code symbols for developer tools. Pixels are sampled once at load, glyphs are prepared in a prebuilt atlas, and only a small share of cells change at eight to twelve steps per second, paused off screen. Halftone sizes dots by brightness for editorial and print looks, dithering uses two or three ramp colors once at load for retro or technical looks, and a duotone maps brightness onto the darkest surface and the accent, which is the simplest way to make any generated image match the palette. Use one treatment on the main visual only, never as decoration elsewhere, and cap canvas size at a device pixel ratio of two.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.118Z
- Evidence: skills/unslop/references/effects.md:5-109

## What we have
missing — layer-place.js and bg-fill.js place and size images; none renders glyph grids, halftone, dithering or duotone.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory — When a landing page hero image needs to match the palette, offer one glyph, halftone, dither or duotone treatment on the main visual only; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory — In landing page streams with a hero image, apply a single duotone or glyph treatment in the visuals pass; advisory for non-UI streams.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-glyph-and-duotone-effects` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-glyph-and-duotone-effects`: unslop-glyph-and-duotone-effects: green unit runs in a row
- `egress_zero_unslop-glyph-and-duotone-effects`: unslop-glyph-and-duotone-effects: zero egress in the packaged check
- `six_sigma_unslop-glyph-and-duotone-effects`: unslop-glyph-and-duotone-effects: clean reviews in a row
- `wired_unslop-glyph-and-duotone-effects`: unslop-glyph-and-duotone-effects: wired into all 2 targets, reached by a user
- `packaged_unslop-glyph-and-duotone-effects`: unslop-glyph-and-duotone-effects: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-glyph-and-duotone-effects — green unit runs in a row
- egress_zero_unslop-glyph-and-duotone-effects — zero egress in the packaged check
- six_sigma_unslop-glyph-and-duotone-effects — clean reviews in a row
- wired_unslop-glyph-and-duotone-effects — wired into all 2 targets, reached by a user
- packaged_unslop-glyph-and-duotone-effects — packaged check passes

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

