# unslop ordered redline passes — rebuild

## Idea (in our words)
Apply nine passes in a fixed order and finish each across the whole screen before starting the next. Spacing comes first, on a 4px grid with equal things sized equally, groups tighter than the space between them, and aligned icon, label and number columns. Color follows, from one tinted neutral ramp with three text roles and a single rare accent, with gradients, glows and colored shadows removed. Icons become one line set at one size and stroke. Copy comes before type and layout because the headline length sets its size and placement; it is plain, specific, without exclamation marks, hype or greetings,. Type is chosen for the direction with two weights and no tracked uppercase. Layout keeps section order and gives apps real proportions and heroes an asymmetric or scene composition. Details cover nested radii, quiet meta, keycaps and charts with one accent and a clear main chart. Visuals come only after the screen works without them. Motion is last, with no looping, one easing curve and animations limited to color, opacity and transform. When nearly every line changes, the passes may be planned in order and written in one go, provided each one is applied.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.116Z
- Evidence: skills/unslop/SKILL.md:45

## What we have
missing — No candidate applies the nine ordered passes; entrance.js has entrance keyframes using blur, scale and several easings, which conflicts with the motion pass rules rather than implementing them.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory — When building or redesigning UI, landing page or dashboard screens, apply the nine passes in order, finishing each across the whole screen; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory — In UI, landing page or dashboard streams, run one ordered pass per loop iteration from spacing to motion; advisory for non-UI streams.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-ordered-redline-passes` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-ordered-redline-passes`: unslop-ordered-redline-passes: green unit runs in a row
- `egress_zero_unslop-ordered-redline-passes`: unslop-ordered-redline-passes: zero egress in the packaged check
- `six_sigma_unslop-ordered-redline-passes`: unslop-ordered-redline-passes: clean reviews in a row
- `wired_unslop-ordered-redline-passes`: unslop-ordered-redline-passes: wired into all 2 targets, reached by a user
- `packaged_unslop-ordered-redline-passes`: unslop-ordered-redline-passes: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-ordered-redline-passes — green unit runs in a row
- egress_zero_unslop-ordered-redline-passes — zero egress in the packaged check
- six_sigma_unslop-ordered-redline-passes — clean reviews in a row
- wired_unslop-ordered-redline-passes — wired into all 2 targets, reached by a user
- packaged_unslop-ordered-redline-passes — packaged check passes

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

