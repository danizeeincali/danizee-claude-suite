# What you got — bbs run 2026-10-30-unslop

Written 2026-11-02T07:21:02.263Z. The powers below were built from ideas found in the source this run audited (a rebuild is written from the idea, never from its code). All 12 are wired into the places you approved at the verdict.

## unslop slop audit

Checklist of the usual AI-looking UI tells, each paired with its fix, grouped by surfaces, type, icons, spacing, copy, components, landing heroes, visuals, motion and template look

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 6: Review · blocking
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · blocking

Run it by hand: `node .claude/helpers/kit/cli.js slop-audit …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop direction brief

Five-line creative direction (product, character, world, moments, signature) derived from the product itself before any visual change

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 2: Plan · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 1: Interview (HIL — once) · advisory

Run it by hand: `node .claude/helpers/kit/cli.js direction …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop triage and refine-only gate

Decides heavy redesign, light polish or refine-only from the audit, and stops for the user to confirm the direction before editing

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 1: Interview (MANDATORY - NEVER SKIP) · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 2: Kickoff (HIL — the last question) · advisory

Run it by hand: `node .claude/helpers/kit/cli.js slop-triage …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop ordered redline passes

Nine ordered design passes from spacing through motion, each finished across the whole screen before the next starts

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory

Run it by hand: `node .claude/helpers/kit/cli.js redline-passes …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop design tokens

Starting values for spacing, neutral ramps, accents, type families and scale, radii, icons, depth and motion timing

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 3: Spec · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory

Run it by hand: `node .claude/helpers/kit/cli.js design-tokens …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop glyph and duotone effects

Optional code treatments that turn a hero image into characters, halftone dots, dither or a two-color duotone in the page palette

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory

Run it by hand: `node .claude/helpers/kit/cli.js image-effects …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop visual direction

Chooses what a hero or empty-state visual should be, how to phrase it as one sentence, and how to write the image prompt

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 2: Plan · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory

Run it by hand: `node .claude/helpers/kit/cli.js visual-direction …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop image generation gate

Requires showing the prompt, model and size and getting approval before any paid image generation, with an empty slot if declined

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · blocking
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · blocking

Run it by hand: `node .claude/helpers/kit/cli.js image-gate …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop live page snapshot

Saves a live web page as a single static HTML copy with its styles and images inlined, plus a screenshot, for redesign work

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 0: Search · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 0: Search · advisory

Run it by hand: `node .claude/helpers/kit/cli.js page-snapshot …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop story video renderer

Renders a story HTML page into a square or wide MP4 by driving a headless browser frame by frame and encoding with ffmpeg, with a live play mode

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory

Run it by hand: `node .claude/helpers/kit/cli.js story-render …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop story video authoring

Conventions for a short before-and-after story page where each step changes CSS in place and redlines measure the slop

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 3: Spec · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory

Run it by hand: `node .claude/helpers/kit/cli.js story-plan …` (its flags: `node .claude/helpers/kit/cli.js help`)

## unslop do-not list and final checklist

Hard limits on what a redesign may change, plus the closing checklist and template-fit test that every run must pass

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 6: Review · blocking
- ✓ `/w-marathon` · Completion Checklist · advisory

Run it by hand: `node .claude/helpers/kit/cli.js redesign-checklist …` (its flags: `node .claude/helpers/kit/cli.js help`)
