# unslop live page snapshot — rebuild

## Idea (in our words)
When the user has only a link, open the page in a headless browser at a set viewport, wait for the network to settle and fonts to load, then copy the rendered document. Stylesheets are fetched and inlined, images and CSS URLs are turned into data URIs under a size limit, srcset and scripts are dropped, and links are made absolute. The theme can be forced to light or dark by rewriting media queries. The result is a standalone HTML file to work on as a copy, plus a live screenshot to compare against. Scripted animated backgrounds do not survive the copy, so the audit should describe them from the live screenshot. The tool expects Playwright to be installed in the project and will use a local Chrome if one is found.

## Provenance
- Source: repo https://github.com/heydamir/unslop
- Identity: git:4652254
- Licence: CC-BY-4.0 (none)
- Verdict: rebuild
- Run: 2026-10-30-unslop
- Decided: 2026-10-30T23:28:29.120Z
- Evidence: skills/unslop/scripts/snapshot.mjs:1-141

## What we have
missing — The only candidates are pager and legacy review fixtures and the theme command; none opens a live page in a headless browser or inlines its assets.

## Lands in (a separate deliverable)
- `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 0: Search · advisory — When a UI redesign starts from only a live URL, save a static HTML copy and screenshot to work on and compare against; advisory otherwise.
- `/w-marathon` · ⛔ CHECKPOINT 0: Search · advisory — For UI or landing page streams that begin from a live link, snapshot the page once up front as the baseline copy; advisory for non-UI work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_unslop-live-page-snapshot` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_unslop-live-page-snapshot`: unslop-live-page-snapshot: green unit runs in a row
- `egress_zero_unslop-live-page-snapshot`: unslop-live-page-snapshot: zero egress in the packaged check
- `six_sigma_unslop-live-page-snapshot`: unslop-live-page-snapshot: clean reviews in a row
- `wired_unslop-live-page-snapshot`: unslop-live-page-snapshot: wired into all 2 targets, reached by a user
- `packaged_unslop-live-page-snapshot`: unslop-live-page-snapshot: packaged check passes

## Kickoff lines

Done means
- tests_green_unslop-live-page-snapshot — green unit runs in a row
- egress_zero_unslop-live-page-snapshot — zero egress in the packaged check
- six_sigma_unslop-live-page-snapshot — clean reviews in a row
- wired_unslop-live-page-snapshot — wired into all 2 targets, reached by a user
- packaged_unslop-live-page-snapshot — packaged check passes

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

