# /w-bbs on unslop: 12 UI de-slop powers, built and wired into /pt and /mt

Run: `2026-10-30-unslop` · Marathon: `2026-10-30-bbs-unslop` · Finished 2026-11-02
Source: https://github.com/heydamir/unslop (CC BY 4.0, by Damir Sokolovsky), identity `git:4652254`
Run files: `.claude/bbs/runs/2026-10-30-unslop/` · Marathon files: `.claude/marathon/2026-10-30-bbs-unslop/`
Branch: `claude/project-thread-69i7t3`.

Credit: the ideas come from Damir Sokolovsky's `unslop` skill. Every power is a clean-room rebuild from the
idea; no code was copied and nothing from the source was ever run.

## What was audited

One Claude Code skill, `unslop`. It audits AI-looking UI for "slop" (purple gradients, glows, emoji labels,
shouty copy, uneven spacing), sets a direction from the product, fixes the screen in ordered passes, captures
live pages and renders a short before/after story video. One fetch (`requests=1`, `bytes_in=82034`,
`bodies_sent=0`, host `github.com`). 7 powers were missing from the suite, 5 partial (they extend
`design-brief.js`, `entrance.js`, `frame-capture.js`, `keyframes.js` and `landing-sections.js` from the
ai-design-skills run).

Licence note: `src/lib/bbs/config.js` does not list CC-BY-4.0 as permissive, so it is classed `none` and `use`
was removed. That does not matter for a rebuild.

## The 12 kit verbs and where they run

All are applied only on UI, landing page or dashboard work; advisory for anything else, and every step says
what to do when the kit is not installed.

| # | Power | Verb | Where it runs |
| --- | --- | --- | --- |
| 1 | Slop audit | `slop-audit` | /pt Review (**blocking**); /mt Loop (**blocking**, one `slop_<s>` measure per pass over every screen, re-run after a fix round) |
| 2 | Direction brief | `direction` | /pt Plan; /mt Interview |
| 3 | Triage and refine-only gate | `slop-triage` | /pt Interview; /mt Kickoff |
| 4 | Ordered redline passes | `redline-passes` | /pt Build; /mt Loop |
| 5 | Design tokens | `design-tokens` | /pt Spec; /mt Loop |
| 6 | Glyph and duotone effects | `image-effects` | /pt Build; /mt Loop |
| 7 | Visual direction | `visual-direction` | /pt Plan; /mt Loop |
| 8 | Image generation gate | `image-gate` | /pt Build (**blocking**); /mt Loop (**blocking**, requests queued, asked only at the Interview or handoff) |
| 9 | Live page snapshot | `page-snapshot` | /pt Search; /mt Search (remote URL only with the user's agreement) |
| 10 | Story video renderer | `story-render` | /pt Build |
| 11 | Story video authoring | `story-plan` | /pt Spec; /mt Loop |
| 12 | Do-not list and final checklist | `redesign-checklist` | /pt Review (**blocking**, incl. `template-test`); /mt Completion Checklist |

Where to find each and how to run it: `.claude/bbs/runs/2026-10-30-unslop/delivered.md`. The reach test for
every row: `.claude/bbs/runs/2026-10-30-unslop/reach-tests.md` (all in `test/bbs-unslop-reach.test.js`).

## How the build went

- 12 build streams plus integration, each to two clean reviews in a row (0 high / ≤2 medium / ≤5 low).
  Review rounds: most streams 2–3; live page snapshot 6; story video authoring 7; integration 3.
- 95 helpers (42 sonnet, 53 opus), all green on first pass; about 8.6M of the 14M run budget.
- Rules promoted during the run (rules.md "Promoted in this run"): tested header contracts, real producer
  output in tests, real CLI paths, reachable limits, linear scans with 8 MiB worst-case tests, brief facts
  mapped to code, hostile-input handling for anything passed on, unattended /mt steps, and accessibility
  carried through every transform.

## Lessons

- **Text sanitisers lose to browsers.** Both HTML-emitting verbs (`story-plan`, `page-snapshot`) went round
  after round on comment-end and raw-text tricks. What ended it was layers: clean in the live DOM where one
  exists, a fail-closed text pass, and a Content-Security-Policy meta as the first `<head>` child (a nonce
  for the verb's own script in `story-plan`; no script at all in `page-snapshot`). Start there next time.
- **A browser capture needs one deadline for everything.** Font loads, late bodies, the load event, the DOM
  copy and the screenshot each hung in turn until `--timeout-ms` bounded every wait.
- **Remote capture must close every egress path**: loopback/private addresses (with DNS and redirect
  checks), WebRTC, WebTransport and workers. Remote mode connects without the proxy so the address check
  means something; on a proxy-only network remote capture fails with a hint. Adding a proxy flag would weaken
  the check and is left to the owner.
- **/mt steps must never ask mid-loop**, and a /pt step reached from /mt must know it is inside /mt
  (`MT_STREAM`).
- **Known gap, again:** `bbs integrate --reach` refuses workflow surfaces, so reach is proven by the reach
  test file and listed in `reach-tests.md`, not in `integration.json`.
- The per-helper step allowance in `helper-budget-integration.json` was the orchestrator's own guess (the
  kickoff sets none) and was raised from 400 to 1000 with a `raised[]` entry.
