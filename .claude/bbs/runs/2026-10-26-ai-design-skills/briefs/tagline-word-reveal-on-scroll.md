# Tagline word reveal on scroll — rebuild

## Idea (in our words)
Render the tagline at a large type size, starting each word at a muted fraction of the base text colour. As the block crosses a trigger line, activate words one at a time in reading order, each transitioning on the shared easing curve. Track each word with an observer or a single throttled frame-based scroll handler, never an unthrottled scroll listener.

## Provenance
- Source: repo https://github.com/elayadesign/ai-design-skills
- Identity: git:eabf866
- Licence: MIT (permissive)
- Verdict: rebuild
- Run: 2026-10-26-ai-design-skills
- Decided: 2026-10-26T20:07:04.762Z
- Evidence: repo/skills/landing-page-design/SKILL.md:335-351

## What we have
missing — No candidate implements a scroll-triggered word-by-word reveal; marathon/page.js has only an overflow-x scroll wrapper.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory — When a landing page or animated UI includes a large benefit statement, build it as a scroll-triggered word-by-word reveal; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory — In UI streams, implement the tagline section with the word reveal on scroll as part of the build loop; advisory for non-UI streams.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_tagline-word-reveal-on-scroll` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_tagline-word-reveal-on-scroll`: tagline-word-reveal-on-scroll: green unit runs in a row
- `egress_zero_tagline-word-reveal-on-scroll`: tagline-word-reveal-on-scroll: zero egress in the packaged check
- `six_sigma_tagline-word-reveal-on-scroll`: tagline-word-reveal-on-scroll: clean reviews in a row
- `wired_tagline-word-reveal-on-scroll`: tagline-word-reveal-on-scroll: wired into all 2 targets, reached by a user
- `packaged_tagline-word-reveal-on-scroll`: tagline-word-reveal-on-scroll: packaged check passes

## Kickoff lines

Done means
- tests_green_tagline-word-reveal-on-scroll — green unit runs in a row
- egress_zero_tagline-word-reveal-on-scroll — zero egress in the packaged check
- six_sigma_tagline-word-reveal-on-scroll — clean reviews in a row
- wired_tagline-word-reveal-on-scroll — wired into all 2 targets, reached by a user
- packaged_tagline-word-reveal-on-scroll — packaged check passes

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

