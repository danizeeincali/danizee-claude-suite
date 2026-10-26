# What you got — bbs run 2026-10-26-ai-design-skills

Written 2026-10-26T23:06:17.797Z. The powers below were built from ideas found in the source this run audited (a rebuild is written from the idea, never from its code). All 12 are wired into the places you approved at the verdict.

## Intake batch before design

Collects the missing brief in one batch and fills any gap with a stated assumption instead of stalling.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 1: Interview (MANDATORY - NEVER SKIP) · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 1: Interview (HIL — once) · advisory
- ✓ `/analysis:design` · Usage · advisory

Run it by hand: `node .claude/helpers/kit/cli.js design-brief …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Landing page section order

Fixed sequence of numbered page sections, from an above-the-fold hero through the argument to objection handling and a repeated final call to action.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 3: Spec · advisory
- ✓ `/analysis:layout` · Layout Types · advisory
- ✓ `/analysis:design` · What It Creates · advisory

Run it by hand: `node .claude/helpers/kit/cli.js landing-sections …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Type scale snapping to Tailwind steps

Maps any off-scale font size to the nearest smaller standard step and takes its paired line height from that step.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory
- ✓ `/analysis:design` · What It Creates · advisory

Run it by hand: `node .claude/helpers/kit/cli.js type-scale …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Tagline word reveal on scroll

A large benefit statement whose words brighten one at a time in reading order as the section scrolls into view.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory

Run it by hand: `node .claude/helpers/kit/cli.js word-reveal …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Realistic sample content rules

Checklist that keeps placeholder copy, names, prices and figures believable and free of filler phrases.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 6: Review · advisory
- ✓ `/analysis:design` · What It Creates · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory

Run it by hand: `node .claude/helpers/kit/cli.js sample-content …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Context split showcase or website

Decides whether an animation request is a standalone showcase or a website section, then maps each page section to the motion it should receive.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 2: Plan · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 1: Interview (HIL — once) · advisory

Run it by hand: `node .claude/helpers/kit/cli.js motion-plan …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Reference frame fidelity check

Compares a rendered still against the source reference using a blurred peak signal-to-noise score, per container, before any motion is added.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 4: Tests (BLOCKING GATE) · blocking
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · blocking
- ✓ `/w-perf` · ⛔ CHECKPOINT 1: Profiling Done · advisory

Run it by hand: `node .claude/helpers/kit/cli.js fidelity …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Layer export placement math

Computes where to place each exported layer image so it lines up with the source, including overhang, clipping and stroke-geometry cases.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory

Run it by hand: `node .claude/helpers/kit/cli.js layer-place …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Sacred background preservation

Keeps a photo or texture background exactly as designed by reusing the original image fill with its transform, never animating or swapping it.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 6: Review · advisory
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 3: Spec · advisory

Run it by hand: `node .claude/helpers/kit/cli.js bg-fill …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Entrance choreography kinds

A catalogue of named entrance animations for each element type, with stagger order and the rule that covered layers arrive last.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory

Run it by hand: `node .claude/helpers/kit/cli.js entrance …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Keyframe track story engine

Drives looping in-page stories from a single eased keyframe function on a shared clock, with a story picker for each visual.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 5: Build · advisory
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · advisory

Run it by hand: `node .claude/helpers/kit/cli.js keyframes …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Deterministic frame capture

Records an animation frame by frame under a stepped fake clock instead of real-time screen recording, so output is repeatable.

Where it runs now:
- ✓ `/w-plan-tdd-swarm` · ⛔ CHECKPOINT 4: Tests (BLOCKING GATE) · advisory
- ✓ `/w-perf` · ⛔ CHECKPOINT 1: Profiling Done · advisory

Run it by hand: `node .claude/helpers/kit/cli.js frame-capture …` (its flags: `node .claude/helpers/kit/cli.js help`)
