# /w-bbs on ai-design-skills: 12 design powers approved, built later in a marathon

Run: `2026-10-26-ai-design-skills` · Marathon: `2026-10-26-bbs-ai-design-skills` · Compounded 2026-10-26
Source: https://github.com/elayadesign/ai-design-skills (MIT), identity `git:eabf866`
Run files: `.claude/bbs/runs/2026-10-26-ai-design-skills/` · Marathon files: `.claude/marathon/2026-10-26-bbs-ai-design-skills/`
Branch: `claude/project-thread-8jw47h`.

## What was audited

Two Claude Code skills: `landing-page-design` and `design-to-motion` (a static design turned into animation).
One fetch (`requests=1`, `bytes_in=57808`, `bodies_sent=0`, host `github.com`). Nothing from the source was
executed, and the fetched tree stays git-ignored under the run's `fetched/` folder. 12 powers were found, none
past the cap.

The suite had almost no design capability: 11 powers are missing, 1 is partial (`analysis/layout.md` names a
landing page layout but no section order). The surfaces scan found job 1, cli 2 and workflow 46, so every power
lands in a workflow, applied only when the task is UI, landing page or animation work.

## The 12 powers and where each lands

Verdicts: 12 approved as rebuild (clean room, idea only), 0 skipped. Dani asked that they be integrated into
existing workflows.

| # | Power | Suite has | Lands in |
| --- | --- | --- | --- |
| 1 | Intake batch before design | missing | w-plan-tdd-swarm Interview; w-marathon Interview; analysis:design Usage |
| 2 | Landing page section order | partial | w-plan-tdd-swarm Spec; analysis:layout Layout Types; analysis:design What It Creates |
| 3 | Type scale snapping to Tailwind steps | missing | w-plan-tdd-swarm Build; analysis:design What It Creates |
| 4 | Tagline word reveal on scroll | missing | w-plan-tdd-swarm Build; w-marathon Loop |
| 5 | Realistic sample content rules | missing | w-plan-tdd-swarm Review; analysis:design What It Creates; w-marathon Loop |
| 6 | Context split showcase or website | missing | w-plan-tdd-swarm Plan; w-marathon Interview |
| 7 | Reference frame fidelity check | missing | w-plan-tdd-swarm Tests (blocking); w-marathon Loop (blocking); w-perf Profiling |
| 8 | Layer export placement math | missing | w-plan-tdd-swarm Build; w-marathon Loop |
| 9 | Sacred background preservation | missing | w-plan-tdd-swarm Review and Spec |
| 10 | Entrance choreography kinds | missing | w-plan-tdd-swarm Build; w-marathon Loop |
| 11 | Keyframe track story engine | missing | w-plan-tdd-swarm Build; w-marathon Loop |
| 12 | Deterministic frame capture | missing | w-plan-tdd-swarm Tests; w-perf Profiling |

All targets are advisory except the two fidelity rows.

## Notes for the build

- Probes found network calls in 4 powers: the fidelity check, layer placement and background preservation pull
  from the Figma REST API with a personal token, and frame capture installs a headless browser and ffmpeg. `use`
  was removed there. The rebuild takes the idea only: take local images and node data as input, never a token.
- Usage had no transcripts (cloud session), so the owner's list from 2026-10-15 was recorded
  (`w-plan-tdd-swarm,w-marathon,w-bbs`). `analysis:design`, `analysis:layout` and `w-perf` carry an
  `unused_reason`: they are the suite's existing design and screenshot homes.
- Scrub ran with `configured:false` (no pattern file).

Start the build with `/w-marathon --resume 2026-10-26-bbs-ai-design-skills`.
