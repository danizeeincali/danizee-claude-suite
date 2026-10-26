# Entrance choreography kinds — rebuild

## Idea (in our words)
Assign every element group a kind from the catalogue: whole cards rise with blur, text rises a short distance from a small blur, bars and rules grow from zero along their start edge, photos shimmer and then sharpen, and so on. Stagger containers in reading order and items within a group by small steps, keep the empty state free of scale-to-zero, and let anything hidden under another layer appear last and leave first.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.768Z
- Evidence: repo/skills/design-to-motion/SKILL.md:214-236

## What we have
missing — triage.js, surfaces.js and redact.js have no animation or entrance-kind catalogue; nothing assigns blur, rise or stagger kinds to element groups.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory — When building animated UI, pick a named entrance animation per element type with stagger order, covered layers arriving last; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory — In animation streams, apply the entrance catalogue and stagger rules while building each element; advisory for non-UI work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_entrance-choreography-kinds` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_entrance-choreography-kinds`: entrance-choreography-kinds: green unit runs in a row
- `egress_zero_entrance-choreography-kinds`: entrance-choreography-kinds: zero egress in the packaged check
- `six_sigma_entrance-choreography-kinds`: entrance-choreography-kinds: clean reviews in a row
- `wired_entrance-choreography-kinds`: entrance-choreography-kinds: wired into all 2 targets, reached by a user
- `packaged_entrance-choreography-kinds`: entrance-choreography-kinds: packaged check passes

## Kickoff lines

Done means
- tests_green_entrance-choreography-kinds — green unit runs in a row
- egress_zero_entrance-choreography-kinds — zero egress in the packaged check
- six_sigma_entrance-choreography-kinds — clean reviews in a row
- wired_entrance-choreography-kinds — wired into all 2 targets, reached by a user
- packaged_entrance-choreography-kinds — packaged check passes

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

