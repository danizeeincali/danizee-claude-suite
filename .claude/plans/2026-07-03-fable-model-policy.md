# Fable/Sonnet Model Policy — Suite-Wide (v4.3.0)

**Date:** 2026-07-03
**Requested by:** danizee — "update the workflows to use fable where thinking is
required and sonnet 5 for all execution… add fallbacks to opus in case fable
access is removed or I run out of usage."

## Interview notes (verbatim decisions)

- **Haiku tier:** *"Sonnet for everything non-thinking"* — the haiku tier is
  retired from the policy. Every non-reasoning subagent (search sweeps,
  scoped builds, doc writing, background dispatch) runs **sonnet** (Sonnet 5).
- **Scope:** *"All workflows"* — a shared Model Policy block goes into every
  `w-` workflow, not just the two that have routing today.
- **Generic-tier invariant:** the old test asserting "suite content must not
  reference fable" is deliberately overridden. New wording: *"Fable with
  inline opus fallback"* — every thinking step names fable and carries the
  fallback clause.
- **Extras:** fix `/pt` "Unknown command" discovery (commands live inside the
  suite repo's `.claude/`, which the client slash-resolver doesn't scan when
  the session roots at a parent directory).

## The new policy

| Work | Model | Fallback |
|---|---|---|
| Thinking: planning, architecture, root-cause analysis, hard builds, adversarial review/verification, final judgment subagents | `fable` (claude-fable-5) | `opus` (claude-opus-4-8) if fable is unavailable — access removed, usage/quota exhausted, or model-not-found error |
| Execution: scoped builds, search/discovery sweeps, doc/compound writing, background dispatch, mechanical work | `sonnet` (Sonnet 5, claude-sonnet-5) | escalate to `fable` (then opus per the fallback rule) only on detectable failure |

**Escalation ladder (build retries):** sonnet → fable; substitute opus at the
fable rung whenever fable is unavailable. Never retry the same tier twice.

**Fallback clause (standard wording, appears wherever fable is named):**
> If fable is unavailable (access removed, usage exhausted, or the model
> errors as not found), fall back to `opus` for that step.

## Requirements

1. `src/plugins/dot-shortcuts.js` (source of truth): rewrite the full Model
   Policy in `w-plan-tdd-swarm`, update `w-background-compound` dispatch
   note, and insert a compact shared Model Policy block into every other
   `w-` workflow. `pt`/`bc` aliases unchanged (inherit via parents).
2. `.claude/commands/.shortcuts/*.md` installed copies regenerated
   byte-identical to the plugin source (existing test locks this).
3. `test/model-policy-port.test.js`: flip the generic-tier invariant into a
   fable-with-opus-fallback invariant; update haiku→sonnet routing
   assertions; add suite-wide block coverage; bump release assertion.
4. `docs/solutions/ideas/model-policy-workflows.md`: document the new tiers.
5. Version bump to 4.3.0.
6. Command discovery: install the suite's commands into
   `payment-system/.claude/` (no PM module) so `/pt`, `/w-*` resolve natively
   in sessions rooted at that repo; push to its designated branch.
7. Push suite changes to `claude/sync-claude-suite-repo-73gr9v`.
