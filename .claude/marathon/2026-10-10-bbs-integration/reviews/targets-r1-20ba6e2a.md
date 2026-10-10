# Review 20ba6e2a-af28-41ed-96aa-4e19d5564546 — targets, round 1

- Commit: ec92870
- Angle: correctness r1
- Result: over tolerance
- 4 findings

## High (1)

- **Default verdict ignores targets so Approve-as-shown dead-ends** — `src/lib/bbs/verdict.js:382` (correctness): defaultVerdict/legalVerdicts keep rebuild for a power with no standing target; recordDecisions then refuses the whole batch. — fix: Drop rebuild/use from legal and fall back to skip/buy when no standing target.

## Medium (1)

- **targets --from/--set rewrite landings after decisions** — `src/lib/bbs/targets.js:140` (correctness): No check that verdicts are decided; approval no longer matches stored targets. — fix: Refuse once decided unless --force.

## Low (2)

- **Prefix step match picks first of several headings** — `src/lib/bbs/targets.js:44` (correctness): checkpoint 3 matches 3 and 3b. — fix: Accept prefix only when unique; else refuse with candidates.
- **Corrupt targets.json blocks skip-only decisions** — `src/lib/bbs/verdict.js:836` (correctness): targets.json read before the loop regardless of decisions. — fix: Read lazily only when rebuild/use present.
