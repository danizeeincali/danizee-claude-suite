# unslop story video renderer — rebuild

## Idea (in our words)
Serves the story file from a local loopback server, places it inside a stage page that scales it into a square or 16:9 frame, and advances the step timeline in fixed frame increments at 60 frames per second, screenshotting each frame. Step classes switch on the page, and a runtime pauses CSS animations and steps them by time so the morphing is deterministic. Redline overlays are placed from live measurements for data-driven spacing gaps, corner radii and marked slop, and the tool stops after the timeline is complete. Frames are encoded with ffmpeg into a high-quality H.264 MP4 and the temporary frame folder is removed. The play mode loops the animation in a visible browser window until it is closed. It needs Playwright and ffmpeg installed. Note that the story page is loaded only from local files, but any remote fonts or resources the story references would still be fetched by the browser.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.121Z
- Evidence: skills/unslop/scripts/story.mjs:1-461

## What we have
partial — frame-capture.js — capture steps a faked clock at fps, pauses CSS animations and screenshots each frame with a manifest, covering the deterministic frame core; no ffmpeg MP4 encoding, stage scaling, redline overlays, step classes, play mode or loopback server.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory — When the user asks for a before-and-after video of a UI redesign, render the story page to MP4 with the headless browser and ffmpeg; advisory and optional.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-story-video-renderer` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-story-video-renderer`: unslop-story-video-renderer: green unit runs in a row
- `egress_zero_unslop-story-video-renderer`: unslop-story-video-renderer: zero egress in the packaged check
- `six_sigma_unslop-story-video-renderer`: unslop-story-video-renderer: clean reviews in a row
- `wired_unslop-story-video-renderer`: unslop-story-video-renderer: wired into its target, reached by a user
- `packaged_unslop-story-video-renderer`: unslop-story-video-renderer: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-story-video-renderer — green unit runs in a row
- egress_zero_unslop-story-video-renderer — zero egress in the packaged check
- six_sigma_unslop-story-video-renderer — clean reviews in a row
- wired_unslop-story-video-renderer — wired into its target, reached by a user
- packaged_unslop-story-video-renderer — packaged check passes

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

