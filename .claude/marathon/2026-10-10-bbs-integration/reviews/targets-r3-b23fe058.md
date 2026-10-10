# Review b23fe058-a6a5-4074-b273-7901403471c3 — targets, round 3

- Commit: a59228c
- Angle: older environments and degraded networks
- Result: pass
- 3 findings

## Medium (2)

- **No-evidence table says lands in no workflow next to its workflow** — `src/lib/bbs/verdict.js:431` (facts): unverified not rendered; why text wrong under evidence none — fix: cause-specific why; mark unverified in landsIn
- **Table defaults to rebuild for owner-set target under no evidence; recorder refuses** — `src/lib/bbs/verdict.js:411` (correctness): landingDefault and recordDecisions disagree — fix: share one gate

## Low (1)

- **Corrupt targets/usage blocks resubmitting a recorded build** — `src/lib/bbs/verdict.js:870` (correctness): builds computed over all decisions — fix: only over changed decisions
