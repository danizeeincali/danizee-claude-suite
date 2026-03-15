# Verification Checkpoint — Cross-Method Validation for Coding Workflows

## Origin
User implemented a verification agent in NanoClaw/Prometheus that independently validates agent claims before publishing (the "4ml water = 4g" principle). Now wants the same pattern in danizee-claude-suite's coding workflows — verify deliverables independently before compounding.

## Interview Decisions

| Decision | Choice |
|----------|--------|
| What to verify | Full cross-method check: files exist, tests pass independently, git diff matches plan, build compiles |
| Placement | After Review, before Compound (final gate) |
| On failure | Block with retry — up to 3 retries, then escalate to user |
| Which workflows | ALL w-* including bg- variants |

## Philosophy
"If they say they have 4ml of water, weigh it — 4ml should weigh 4 grams." Don't trust self-reported results. Independently verify using a different method than the one that produced the result.

## Verification Checks (Cross-Method)

1. **Files Exist** — Verify all claimed "Implementation file paths" actually exist on disk
2. **Tests Pass Independently** — Re-run the test command (don't trust the earlier test output)
3. **Git Diff Matches Plan** — Compare `git diff` against the planned files-to-modify list
4. **Build Compiles** — Run build command if applicable, verify zero errors
5. **No Regressions** — Run full test suite (not just new tests) to catch regressions

## Retry Pipeline
- PASS → proceed to Compound
- FAIL + retries remaining (max 3) → log failure reason, fix the issue, re-verify
- FAIL + max retries exceeded → escalate to user with AskUserQuestion

## User Quotes
- "if the other agents said they have 4mls of water, this agent creates an independent way to verify that the work was done"
- "I want to implement that at end or deliverables from the coding agents"
