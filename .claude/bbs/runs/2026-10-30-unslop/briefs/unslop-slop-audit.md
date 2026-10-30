# unslop slop audit — rebuild

## Idea (in our words)
Before any edit, walk the screen against a fixed list of slop signs and write one line per sign with where it lives. The list covers purple-to-blue gradients, gradient text, colored glows, neon borders, weight 800 headings, uppercase tracked labels, mixed number formats, emoji icons, arbitrary pixel margins, greeting headlines, exclamation marks, hype words, fake data, glowing badges, rainbow or glowing charts, sparkline-decorated stat cards, glossy orb logos, pill badges above hero headlines, unverified social proof, looping pulses, transition-all and hover scale, and animating layout properties. Each sign carries its fix in the same line, so the audit doubles as the plan. A final group lists template-look fallbacks that a cleaned screen drifts into, such as a pure grey page with Inter and an old brand color on a warm product, so they can be checked after the fixes.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.109Z
- Evidence: skills/unslop/references/signs.md:1-104

## What we have
missing — No candidate walks a screen against a slop-sign list; landing-sections checks page section order and CTAs, design-brief collects answers, and the rest are unrelated.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 6: Review · blocking — For UI, landing page or dashboard tasks, walk the changed screens against the slop-sign list and write one line per sign with its fix; unresolved signs stop the review. Advisory for non-UI work.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · blocking — In UI, landing page or dashboard streams, run the slop audit each loop pass and treat unresolved signs as an unmet build gate. Advisory for non-UI streams.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-slop-audit` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-slop-audit`: unslop-slop-audit: green unit runs in a row
- `egress_zero_unslop-slop-audit`: unslop-slop-audit: zero egress in the packaged check
- `six_sigma_unslop-slop-audit`: unslop-slop-audit: clean reviews in a row
- `wired_unslop-slop-audit`: unslop-slop-audit: wired into all 2 targets, reached by a user
- `packaged_unslop-slop-audit`: unslop-slop-audit: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-slop-audit — green unit runs in a row
- egress_zero_unslop-slop-audit — zero egress in the packaged check
- six_sigma_unslop-slop-audit — clean reviews in a row
- wired_unslop-slop-audit — wired into all 2 targets, reached by a user
- packaged_unslop-slop-audit — packaged check passes

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

