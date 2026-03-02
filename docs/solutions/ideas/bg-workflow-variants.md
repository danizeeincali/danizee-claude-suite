# Background Workflow Variants

## Date: 2026-03-02
## Workflow: /w-idea-tdd-swarm
## Memory Key: project/ideas/bg-workflow-variants

## Summary

Created 6 `w-bg-*` workflow variants that auto-proceed through all checkpoints with no user gates, mirroring Prometheus's autonomous execution pattern. Existing foreground workflows remain unchanged.

## Variants Created

| Variant | Phases | Gates | Blocking Rules |
|---------|--------|-------|----------------|
| `w-bg-tdd-swarm` | 8 | None | Tests must fail before build |
| `w-bg-debug` | 10 | None | Root cause confirmed + tests must fail |
| `w-bg-review` | 8 | None | None |
| `w-bg-security` | 5 | None | None |
| `w-bg-perf` | 5 | None | None |
| `w-bg-idea-tdd-swarm` | 10 | Interview only | Tests must fail before build |

## Files Created

All in `.claude/commands/.shortcuts/`:
1. `w-bg-tdd-swarm.md` — Background TDD Swarm (164 lines)
2. `w-bg-debug.md` — Background Debug (192 lines)
3. `w-bg-review.md` — Background Review (172 lines)
4. `w-bg-security.md` — Background Security Audit (141 lines)
5. `w-bg-perf.md` — Background Performance Audit (139 lines)
6. `w-bg-idea-tdd-swarm.md` — Background Idea TDD Swarm (214 lines)

## Key Design Decisions

1. **Gate removal**: All `USER GATE: Use AskUserQuestion` blocks replaced with `AUTO-PROCEED`
2. **TDD blocking preserved**: Tests-must-fail rule kept in all TDD workflows (safety net)
3. **Git Commit phase added**: Every bg- workflow ends with mandatory Git Commit
4. **Compound mandatory**: Never skip compound — knowledge capture is essential
5. **Interview exception**: `w-bg-idea-tdd-swarm` keeps interview as the ONLY gate since ideas genuinely need refinement before autonomous build

## Pattern: Workflow Variant Generation

When creating variant workflows:
1. Start from foreground counterpart
2. Remove user gates (`AskUserQuestion` blocks, `STOP and wait`)
3. Add `AUTO-PROCEED` to every phase
4. Keep safety-critical blocking rules (TDD, diagnosis)
5. Add Git Commit as final mandatory phase
6. Keep Compound + Ralph check mandatory
7. Update phase counts, checklist, and examples

## Spec

`.claude/plans/2026-03-02-bg-workflow-variants.md` (in NanoClaw)
