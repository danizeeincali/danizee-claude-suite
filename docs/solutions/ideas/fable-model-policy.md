# Fable/Sonnet Model Policy with Opus Fallback (v4.3.0)

**Memory key:** `project/ideas/fable-model-policy`
**Spec:** `.claude/plans/2026-07-03-fable-model-policy.md`
**Date:** 2026-07-03

## What changed

Suite-wide model routing, replacing the old haiku/sonnet/opus generic-tier
policy:

- **Thinking** (planning, architecture, root-cause analysis, hard builds,
  adversarial review/verification, final judgment): `model: fable`
  (claude-fable-5).
- **Execution** (everything else — scoped builds, discovery sweeps,
  doc/compound writing, background dispatch): `model: sonnet` (Sonnet 5).
  The haiku tier is retired.
- **Opus fallback:** every fable routing carries the inline clause — if fable
  is unavailable (access removed, usage exhausted, or the model errors), fall
  back to `model: opus` (claude-opus-4-8) for that step. Never silently skip
  the step.
- **Escalation ladder:** sonnet → fable (substitute opus when fable is
  unavailable). Never retry the same tier twice.

Every `w-` workflow now carries a compact Model Policy block; the full table
lives in `/w-plan-tdd-swarm`. Enforced by `test/fable-model-policy.test.js`
(92 assertions). The old "generic-tier invariant" (never name a premium
model) was deliberately reversed by owner decision.

## Drift bugs found and fixed along the way

The build surfaced a long-standing dual-surface drift problem — the likely
root of the recurring "commands live in the wrong part of the file system"
issue:

1. **Stale installed copies.** 15 of the 22 `.claude/commands/.shortcuts/*.md`
   files dated to 2026-01 while their `src/plugins/dot-shortcuts.js` templates
   had been rewritten through 2026-06. Sessions were loading January-era
   workflows. Fixed by regenerating every copy from `getCommands()`.
2. **Reverse drift.** `w-swarm`/`w-debug` installed copies contained RuFlo
   swarm content (Jan) that the templates had lost; tests pinned the copies.
   The RuFlo content was ported back into the templates, and w-swarm's
   compound phase re-gained the RC-A block.
3. **Double-escaping bug.** 474 `\\\`` sequences in templates rendered
   literal `\`` artifacts. Fixed at the source; a new test bans the artifact
   in ALL commands (previously only 4 were locked).
4. **Missing copies.** 5 commands (w-agent-tdd-swarm, w-agent-interview-swarm,
   w-ralph-init, w-autoresearch, w-suite-sync) had no installed copy at all.
5. **Slash-command discovery.** Typed `/pt` returned "Unknown command" because
   the commands lived only inside the suite repo checkout — the client
   resolver scans the session's primary working directory, not secondary repo
   checkouts. Fixed by running the installer into `payment-system` (no PM
   module).

## Pattern stored

**When a repo ships generated copies of templated content, byte-identity
tests must cover the FULL surface, not a sample** — partial locks let both
surfaces accumulate one-way improvements that a later regeneration
silently destroys. Diff both directions before regenerating.

## Pi Brain

Discovery search returned 0 results; nothing to endorse.
