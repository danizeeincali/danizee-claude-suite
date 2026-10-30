# unslop story video authoring — rebuild

## Idea (in our words)
Build one story page from the original screen and keep its rules as step zero. Declare three to five steps, merging passes so each step changes something visible, and name them so spacing and corner steps get their redlines. Each later step is only CSS layered on top of the previous ones, changing values rather than structure, so padding, gaps, colors, radii and shadows tween in place. Things that cannot tween are handled separately: gradients fade out on their own layer, pill radii are written as half the height, text that changes uses a blur-out and letter-by-letter roll, and emoji turn into icons by crossfading stacked elements. Keep text swaps to a handful at most, so the video does not read as a cut between two pictures. Redlines mark a few gaps in vertical stacks and a few corners, and optional red slop tags appear briefly first. The camera is set to a square or wide frame cropped close on the part that changes most, around ten seconds long. The clean result still ships as normal project code without story classes. Every video carries a small credit to the author.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.122Z
- Evidence: skills/unslop/SKILL.md:177-207

## What we have
partial — keyframes.js — check enforces one-sentence stories, seamless loop start and end, and unison offsets, and the engine evaluates eased tracks; no step plan, CSS tween rules for gradients, pills or text, redlines, camera framing or credit line.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 3: Spec · advisory — When a before-and-after story video is requested for a UI redesign, spec the story page as three to five CSS-only steps with redlines; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory — In UI streams that ship a redesign story, author the story steps from the original screen after the passes are done; advisory for non-UI work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-story-video-authoring` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-story-video-authoring`: unslop-story-video-authoring: green unit runs in a row
- `egress_zero_unslop-story-video-authoring`: unslop-story-video-authoring: zero egress in the packaged check
- `six_sigma_unslop-story-video-authoring`: unslop-story-video-authoring: clean reviews in a row
- `wired_unslop-story-video-authoring`: unslop-story-video-authoring: wired into all 2 targets, reached by a user
- `packaged_unslop-story-video-authoring`: unslop-story-video-authoring: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-story-video-authoring — green unit runs in a row
- egress_zero_unslop-story-video-authoring — zero egress in the packaged check
- six_sigma_unslop-story-video-authoring — clean reviews in a row
- wired_unslop-story-video-authoring — wired into all 2 targets, reached by a user
- packaged_unslop-story-video-authoring — packaged check passes

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

