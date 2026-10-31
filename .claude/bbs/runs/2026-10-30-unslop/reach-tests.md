# Reach tests: 2026-10-30-unslop

Every wired power is proved by a reach test in `test/bbs-unslop-reach.test.js`. Each test goes in through the
installed command file under the named heading (`stepSection` from `.claude/helpers/bbs/wiring.js`), runs the step's
real bash block with fixtures and checks the power's effect, the UI gate, the kit-missing fallback and the
blocking/advisory mode.

Run them all: `node --test test/bbs-unslop-reach.test.js`

**Why this file exists:** `node .claude/helpers/bbs/cli.js integrate --reach` refuses workflow surfaces. It matches
`--reach` only against code targets, so for example
`--reach "workflow:.claude/commands/.shortcuts/w-marathon.md=test/bbs-unslop-reach.test.js::node --test test/bbs-unslop-reach.test.js"`
fails with "has no approved target on workflow:.claude/commands/.shortcuts/w-marathon.md". So `integration.json`
records every power with `--verb` only (`reach: []`), and `wired`/`delivered` show `test: null` for workflow
targets. The bbs CLI was left unchanged. This file is where the proving test for each power is listed.

| Power | Workflow · heading | Mode | Test name (describe › it) |
|---|---|---|---|
| unslop slop audit | /w-plan-tdd-swarm · ⛔ CHECKPOINT 6: Review | blocking | unslop slop audit › w-plan-tdd-swarm › ⛔ CHECKPOINT 6: Review (blocking) |
| unslop slop audit | /w-marathon · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met | blocking | unslop slop audit › w-marathon › ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met (blocking) |
| unslop direction brief | /w-plan-tdd-swarm · ⛔ CHECKPOINT 2: Plan | advisory | unslop direction brief › w-plan-tdd-swarm › ⛔ CHECKPOINT 2: Plan (advisory) |
| unslop direction brief | /w-marathon · ⛔ CHECKPOINT 1: Interview (HIL — once) | advisory | unslop direction brief › w-marathon › ⛔ CHECKPOINT 1: Interview (HIL — once) (advisory) |
| unslop triage and refine-only gate | /w-plan-tdd-swarm · ⛔ CHECKPOINT 1: Interview (MANDATORY - NEVER SKIP) | advisory | unslop triage and refine-only gate › w-plan-tdd-swarm › ⛔ CHECKPOINT 1: Interview (MANDATORY - NEVER SKIP) (advisory) |
| unslop triage and refine-only gate | /w-marathon · ⛔ CHECKPOINT 2: Kickoff (HIL — the last question) | advisory | unslop triage and refine-only gate › w-marathon › ⛔ CHECKPOINT 2: Kickoff (HIL — the last question) (advisory) |
| unslop ordered redline passes | /w-plan-tdd-swarm · ⛔ CHECKPOINT 5: Build | advisory | unslop ordered redline passes › w-plan-tdd-swarm › ⛔ CHECKPOINT 5: Build (advisory) |
| unslop ordered redline passes | /w-marathon · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met | advisory | unslop ordered redline passes › w-marathon › ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met (advisory) |
| unslop design tokens | /w-plan-tdd-swarm · ⛔ CHECKPOINT 3: Spec | advisory | unslop design tokens › w-plan-tdd-swarm › ⛔ CHECKPOINT 3: Spec (advisory) |
| unslop design tokens | /w-marathon · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met | advisory | unslop design tokens › w-marathon › ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met (advisory) |
| unslop glyph and duotone effects | /w-plan-tdd-swarm · ⛔ CHECKPOINT 5: Build | advisory | unslop glyph and duotone effects › w-plan-tdd-swarm › ⛔ CHECKPOINT 5: Build (advisory) |
| unslop glyph and duotone effects | /w-marathon · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met | advisory | unslop glyph and duotone effects › w-marathon › ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met (advisory) |
| unslop visual direction | /w-plan-tdd-swarm · ⛔ CHECKPOINT 2: Plan | advisory | unslop visual direction › w-plan-tdd-swarm › ⛔ CHECKPOINT 2: Plan (advisory) |
| unslop visual direction | /w-marathon · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met | advisory | unslop visual direction › w-marathon › ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met (advisory) |
| unslop image generation gate | /w-plan-tdd-swarm · ⛔ CHECKPOINT 5: Build | blocking | unslop image generation gate › w-plan-tdd-swarm › ⛔ CHECKPOINT 5: Build (blocking) |
| unslop image generation gate | /w-marathon · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met | blocking | unslop image generation gate › w-marathon › ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met (blocking) |
| unslop story video renderer | /w-plan-tdd-swarm · ⛔ CHECKPOINT 5: Build | advisory | unslop story video renderer › w-plan-tdd-swarm › ⛔ CHECKPOINT 5: Build (advisory) |
| unslop story video authoring | /w-plan-tdd-swarm · ⛔ CHECKPOINT 3: Spec | advisory | unslop story video authoring › w-plan-tdd-swarm › ⛔ CHECKPOINT 3: Spec (advisory) |
| unslop story video authoring | /w-marathon · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met | advisory | unslop story video authoring › w-marathon › ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met (advisory) |
| unslop do-not list and final checklist | /w-plan-tdd-swarm · ⛔ CHECKPOINT 6: Review | blocking | unslop do-not list and final checklist › w-plan-tdd-swarm › ⛔ CHECKPOINT 6: Review (blocking) |
| unslop do-not list and final checklist | /w-marathon · Completion Checklist | advisory | unslop do-not list and final checklist › w-marathon › Completion Checklist (advisory) |
| unslop live page snapshot | /w-plan-tdd-swarm · ⛔ CHECKPOINT 0: Search | advisory | unslop live page snapshot › w-plan-tdd-swarm › ⛔ CHECKPOINT 0: Search (advisory) |
| unslop live page snapshot | /w-marathon · ⛔ CHECKPOINT 0: Search | advisory | unslop live page snapshot › w-marathon › ⛔ CHECKPOINT 0: Search (advisory) |

All 23 rows of `integration.md` are wired (checked by "every integration.md row is wired: 23 rows").

Other tests in the same file that back the rows above:

- slop audit gate in /w-marathon › unresolved signs keep the scripted stream gate unmet however many green test runs follow
- slop audit gate in /w-marathon › a fix round (4.7 -> 4.4) that makes a screen dirty runs the audit again and leaves the gate unmet
- slop audit gate in /w-marathon › the Interview adds the slop_<s> line only when the kit is installed
- the story video authoring rows feed the real producer chain: the /pt Spec `story-plan template` block writes the story,
  the row's own block runs `check` and `emit`, and the page `emit` wrote goes into the story-render plan block at /pt
  CHECKPOINT 5: Build with the `format` emit printed (a wide story plans at 1920x1080); the /pt Build story-render block
  now takes `STORY_FORMAT` for that hand-off, since story-render reads the page's duration but not its format
- the live page snapshot rows never reach the internet: `plan` runs for a local file:// page and a remote URL, the
  capture block refuses a remote URL with `SNAP_REMOTE=no` (exit 2, nothing written) and refuses credentials in the URL
  or a non-http scheme even with `SNAP_REMOTE=yes`; a `node` stand-in on PATH shows `--allow-remote` is passed exactly
  when `SNAP_REMOTE=yes`; the capture of the local page (stylesheet and image inlined, script and handler gone, PNG
  screenshot, manifest) runs when playwright resolves, else its exit-4 advisory skip is checked
- the /pt image gate inside a /w-marathon build (`MT_STREAM` set: the request is queued, never asked) is checked inside "unslop image generation gate › w-plan-tdd-swarm › ⛔ CHECKPOINT 5: Build (blocking)"
- triage scan with an unfilled AUDIT (both workflows), without the kit (both workflows), source and installed copies
