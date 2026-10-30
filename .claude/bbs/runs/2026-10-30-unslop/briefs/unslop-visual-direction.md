# unslop visual direction — rebuild

## Idea (in our words)
Decide first whether the screen needs a visual at all, since dashboards and settings usually do not, while landing heroes and empty states often do. Then prefer a scene from the product's world with the subject on one side and calm space for the headline, with the product preview rising from the bottom edge. Without an image tool, build a code preview of the one moment that proves the headline, using project components where they exist and plausible data. Write the visual as one plain sentence before any generation; if the sentence is unclear, the visual is not clear yet. Pick one style for the whole page from a short list, such as painted background, cinematic object, soft 3D, product object render, light and optics, or engraving, and avoid film grain prompts, multiple subjects, and glossy purple abstractions. The prompt is built in fixed parts: subject, setting, light and palette named by hex, style, composition, exclusions of text and logos, and the slot's aspect ratio at twice the display size. Edges are faded into the page color in code so no hard rectangle shows.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.119Z
- Evidence: skills/unslop/references/visuals.md:5-80, skills/unslop/SKILL.md:155-166

## What we have
missing — No candidate decides whether a visual is needed, writes a one-sentence visual brief or builds a generation prompt; landing-sections only lists a hero visual as a required element.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 2: Plan · advisory — For landing page or empty-state work, decide whether a visual is needed and write it as one plain sentence before any generation; advisory for dashboards and non-UI work.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory — In landing page streams, choose the visual style and write the prompt recipe only after the screen works without it; advisory for non-UI work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-visual-direction` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-visual-direction`: unslop-visual-direction: green unit runs in a row
- `egress_zero_unslop-visual-direction`: unslop-visual-direction: zero egress in the packaged check
- `six_sigma_unslop-visual-direction`: unslop-visual-direction: clean reviews in a row
- `wired_unslop-visual-direction`: unslop-visual-direction: wired into all 2 targets, reached by a user
- `packaged_unslop-visual-direction`: unslop-visual-direction: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-visual-direction — green unit runs in a row
- egress_zero_unslop-visual-direction — zero egress in the packaged check
- six_sigma_unslop-visual-direction — clean reviews in a row
- wired_unslop-visual-direction — wired into all 2 targets, reached by a user
- packaged_unslop-visual-direction — packaged check passes

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

