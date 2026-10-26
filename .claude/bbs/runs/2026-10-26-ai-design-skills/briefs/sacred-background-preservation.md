# Sacred background preservation — rebuild

## Idea (in our words)
Fetch the raw image fill instead of a render, then reproduce its scale mode and transform as CSS sizing and offset. Frosted panels need their own sibling layer so the backdrop filter can see the photo. Verify the background region against the reference, and if the image cannot be obtained, report it to the user rather than silently substituting a flat colour.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.767Z
- Evidence: repo/skills/design-to-motion/SKILL.md:135-145

## What we have
missing — The background-compound shortcuts compound knowledge in the background; no candidate fetches a raw image fill or reproduces background scale modes.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 6: Review · advisory — For UI or animation work, check that photo or texture backgrounds reuse the original image fill and transform and are never animated or swapped; advisory.
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 3: Spec · advisory — When animating a design with a photo or texture background, write the spec rule that the background is left exactly as designed.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_sacred-background-preservation` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_sacred-background-preservation`: sacred-background-preservation: green unit runs in a row
- `egress_zero_sacred-background-preservation`: sacred-background-preservation: zero egress in the packaged check
- `six_sigma_sacred-background-preservation`: sacred-background-preservation: clean reviews in a row
- `wired_sacred-background-preservation`: sacred-background-preservation: wired into all 2 targets, reached by a user
- `packaged_sacred-background-preservation`: sacred-background-preservation: packaged check passes

## Kickoff lines

Done means
- tests_green_sacred-background-preservation — green unit runs in a row
- egress_zero_sacred-background-preservation — zero egress in the packaged check
- six_sigma_sacred-background-preservation — clean reviews in a row
- wired_sacred-background-preservation — wired into all 2 targets, reached by a user
- packaged_sacred-background-preservation — packaged check passes

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

