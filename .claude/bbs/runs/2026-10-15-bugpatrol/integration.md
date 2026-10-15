# Integration — bbs run 2026-10-15-bugpatrol

Building a power is not the deliverable; a user using it is. This stream starts after every build stream is done.

## Rows
- noise ledger with flake quarantine → `/w-review` · ⛔ CHECKPOINT 4: Ralph Candidates (AUTO-PROCEED) · advisory — Caps new candidate issues per run and quarantines findings that do not reproduce on retry before they become Ralph work.
- two pass finding clustering → `/w-review` · ⛔ CHECKPOINT 1: Code Analysis · advisory — Groups duplicate findings from parallel agents by rule and file set, asking a model only about unresolved pairs.
- two pass finding clustering → `/w-bg-review` · Phase 4: Ralph Candidates · advisory — Deduplicates findings across phases before candidates are listed.
- asymmetric threshold router → `/w-review` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · advisory — Routes validator answers: raising a concern is free, suppressing or auto-fixing needs high confidence, deterministic failures never overridden.
- asymmetric threshold router → `/w-fix` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · blocking — Gates auto-fix acceptance on high confidence while a failing regression test can never be overridden.
- change-impact test plan → job `job:.github/workflows/test.yml` · node-test · advisory — reached by: Runs on every push to main and every pull request.; Maps changed files to affected tests and falls back to a smoke set, printing a reason per item.
- change-impact test plan → `/w-fix` · ⛔ CHECKPOINT 2: Fix Applied · advisory — After a fix, plans which tests to run from the changed files, with reasons.
- finding triage with fingerprint dedup and absence closing → `/w-review` · ⛔ CHECKPOINT 4: Ralph Candidates (AUTO-PROCEED) · advisory — Fingerprints findings, collapses repeats into few candidates, and closes candidates that checks no longer see.
- shared budget for claim sub-sessions → `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · blocking — All helper model sessions in the loop draw from one allowance of steps, cost and wall-clock time.
- shared budget for claim sub-sessions → `/w-review` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · advisory — Claim-checking sub-sessions share a single review budget.
- trouble-log reflection into lesson memory → `/w-fix` · ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP) · advisory — Builds a trouble log from the session and has a reviewer save, keep or retire short lessons.
- trouble-log reflection into lesson memory → `/w-bbs` · ⛔ CHECKPOINT 6: Compound (MANDATORY) · advisory — Turns the audit run's trouble log into saved lessons for future runs.
- Preflight doctor checks before a run → cli `cli:bin/cli.js` · check · blocking — reached by: Run `danizee-claude-suite check` in a project.; Adds named doctor checks (config, node version, binaries, agent runtimes, optional gh login) separating fatal from advisory, mapped to a usage exit code.
- Preflight doctor checks before a run → `/w-marathon` · ⛔ CHECKPOINT 3: Arm · blocking — Runs doctor checks before the long loop is armed.
- Exit code contract separating infrastructure from product failure → cli `cli:bin/cli.js` · check · blocking — reached by: Run `danizee-claude-suite check`; the exit code is read by scripts and CI.; Exit codes keep usage, missing prerequisite, infrastructure and product failures distinct.
- Exit code contract separating infrastructure from product failure → job `job:.github/workflows/test.yml` · node-test · blocking — reached by: Runs on every push and pull request.; Only the predicate's product-failure outcome may fail the job, not infrastructure errors.
- SARIF JUnit and sticky PR comment renderers → job `job:.github/workflows/test.yml` · test.yml · advisory — reached by: Runs on pull requests; the report is uploaded and commented there.; Renders findings to SARIF, JUnit XML and one sticky PR comment edited in place.
- SARIF JUnit and sticky PR comment renderers → `/w-review` · ⛔ CHECKPOINT 5: Compound (MANDATORY - NEVER SKIP) · advisory — Renders the review's findings as SARIF, JUnit and a PR comment.
- repeated replay gate for claims → `/w-review` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · blocking — Only a disproof that reproduces on a second replay may fail a check; model-judged or flaky ones stay comments.
- repeated replay gate for claims → `/w-debug` · ⛔ CHECKPOINT 2: Diagnosis (BLOCKING GATE) · blocking — Requires the diagnosis to reproduce on a second replay before it gates the fix.

## How
1. Wire each row where it says, the way that surface works:
   - job: call the power in the scheduled or queued job; the reach test runs the job's handler once
   - cli: add the power to the command (a subcommand or flag) and to its help; the reach test runs the command
   - workflow: add a step under the named heading of the workflow's command source (src/plugins/*.js for the suite's own commands) that runs `node .claude/helpers/kit/cli.js <verb>`: what to do when the kit is not installed, what each exit code means, and, for `advisory`, that the workflow goes on; regenerate the installed command files
2. Record each power: `node .claude/helpers/bbs/cli.js integrate --run 2026-10-15-bugpatrol --power <name> [--verb <kit verb>] [--entry <module>#<symbol>] [--reach <surface id>[@<at>]=<test file>::<command>]...`. A reach test goes in through the surface (it imports the surface file or names its route, endpoint, command or flag) and checks the power's effect there; a test that only calls the power does not count.
3. Measure each power: `node .claude/helpers/bbs/cli.js wired --run 2026-10-15-bugpatrol --power <name> --record` records `wired_<slug>` (targets that use the entry and whose reach test passes now).
4. Tell the owner: `node .claude/helpers/bbs/cli.js delivered --run 2026-10-15-bugpatrol --record` writes delivered.md (where to find each power, the test that proves it, how to run it) and records `delivered`; print delivered.md to the owner.
5. Review this stream on the files it changed: the reviewer checks each wiring is reached in the normal flow (a menu links the page, the router mounts the endpoint, the scheduler runs the job, the flag is read), not only that the file names the power.
