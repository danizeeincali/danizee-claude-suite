# What you got — bbs run 2026-10-15-bugpatrol

Written 2026-10-15T19:52:54.488Z. The powers below were built from ideas found in the source this run audited (a rebuild is written from the idea, never from its code). All 11 are wired into the places you approved at the verdict.

## noise ledger with flake quarantine

Caps new issues per run, holds back blocking on a first run, and quarantines findings that fail to reproduce on retry.

Where it runs now:
- ✓ `/w-review` · ⛔ CHECKPOINT 4: Ralph Candidates (AUTO-PROCEED) · advisory

Run it by hand: `node .claude/helpers/kit/cli.js noise-ledger …` (its flags: `node .claude/helpers/kit/cli.js help`)

## two pass finding clustering

Groups duplicate findings deterministically by rule and affected-file set, then asks a model only about the pairs left unresolved, merging only on high confidence.

Where it runs now:
- ✓ `/w-review` · ⛔ CHECKPOINT 1: Code Analysis · advisory
- ✓ `/w-bg-review` · Phase 4: Ralph Candidates · advisory

Run it by hand: `node .claude/helpers/kit/cli.js cluster …` (its flags: `node .claude/helpers/kit/cli.js help`)

## asymmetric threshold router

Routes a decider's answers so that raising a question needs no confidence, while suppressing or auto-fixing needs high confidence and a deterministic regression can never be overridden.

Where it runs now:
- ✓ `/w-review` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · advisory
- ✓ `/w-fix` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · blocking

Run it by hand: `node .claude/helpers/kit/cli.js threshold-route …` (its flags: `node .claude/helpers/kit/cli.js help`)

## change-impact test plan

Maps changed files to affected screens through an inverse index, widens to flows and shared components, falls back to a smoke set when mapping is weak, and gives every item a reason.

Where it runs now:
- ✓ Runs on every push to main and every pull request. (`job:.github/workflows/test.yml` · node-test) · advisory — proved by `test/reach/ci-job.test.js`
- ✓ `/w-fix` · ⛔ CHECKPOINT 2: Fix Applied · advisory

Run it by hand: `node .claude/helpers/kit/cli.js test-plan …` (its flags: `node .claude/helpers/kit/cli.js help`)

## finding triage with fingerprint dedup and absence closing

Collapses one screen's raw check results into the few candidates a judge needs, and closes issues that automatic checks stop seeing

Where it runs now:
- ✓ `/w-review` · ⛔ CHECKPOINT 4: Ralph Candidates (AUTO-PROCEED) · advisory

Run it by hand: `node .claude/helpers/kit/cli.js triage …` (its flags: `node .claude/helpers/kit/cli.js help`)

## shared budget for claim sub-sessions

One allowance of steps, cost and wall-clock time that every model session in a single review draws from

Where it runs now:
- ✓ `/w-marathon` · ⛔ CHECKPOINT 4: Loop — per stream, until the build gate is met · blocking
- ✓ `/w-review` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · advisory

Run it by hand: `node .claude/helpers/kit/cli.js shared-budget …` (its flags: `node .claude/helpers/kit/cli.js help`)

## trouble-log reflection into lesson memory

Builds a mechanical trouble log from a finished session and has a reviewer model save, keep or retire short lessons for future runs

Where it runs now:
- ✓ `/w-fix` · ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP) · advisory
- ✓ `/w-bbs` · ⛔ CHECKPOINT 6: Compound (MANDATORY) · advisory

Run it by hand: `node .claude/helpers/kit/cli.js reflect …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Preflight doctor checks before a run

A doctor command that builds a list of named checks (config present, runtime version, required binaries on PATH, agent runtimes usable, optional GitHub CLI login) and separates fatal failures from advisory warnings, then maps any fatal failure to a usage exit code.

Where it runs now:
- ✓ Run `danizee-claude-suite check` in a project. (`cli:bin/cli.js` · check) · blocking — proved by `test/reach/cli-check.test.js`
- ✓ `/w-marathon` · ⛔ CHECKPOINT 3: Arm · blocking

Run it by hand: `node .claude/helpers/kit/cli.js doctor …` (its flags: `node .claude/helpers/kit/cli.js help`)

## Exit code contract separating infrastructure from product failure

A small, documented exit-code table that keeps product regressions, usage errors, missing prerequisites and infrastructure failures distinct, with one predicate that says which outcome is allowed to block a merge.

Where it runs now:
- ✓ Run `danizee-claude-suite check`; the exit code is read by scripts and CI. (`cli:bin/cli.js` · check) · blocking — proved by `test/reach/cli-check.test.js`
- ✓ Runs on every push and pull request. (`job:.github/workflows/test.yml` · node-test) · blocking — proved by `test/reach/ci-job.test.js`

Run it by hand: `node .claude/helpers/kit/cli.js exit-codes …` (its flags: `node .claude/helpers/kit/cli.js help`)

## SARIF JUnit and sticky PR comment renderers

Three pure renderers that turn one list of findings and a run record into a code-scanning SARIF file, a JUnit XML report with one test case per planned target, and a single PR comment body that is edited in place using a hidden marker.

Where it runs now:
- ✓ Runs on pull requests; the report is uploaded and commented there. (`job:.github/workflows/test.yml` · test.yml) · advisory — proved by `test/reach/ci-job.test.js`
- ✓ `/w-review` · ⛔ CHECKPOINT 5: Compound (MANDATORY - NEVER SKIP) · advisory

Run it by hand: `node .claude/helpers/kit/cli.js render …` (its flags: `node .claude/helpers/kit/cli.js help`)

## repeated replay gate for claims

Only a disproof that code reproduces on a second replay may fail a check; anything a model judged, or any flaky replay, stays a comment

Where it runs now:
- ✓ `/w-review` · ✅ VERIFICATION CHECKPOINT — Cross-Method Validation · blocking
- ✓ `/w-debug` · ⛔ CHECKPOINT 2: Diagnosis (BLOCKING GATE) · blocking

Run it by hand: `node .claude/helpers/kit/cli.js replay-gate …` (its flags: `node .claude/helpers/kit/cli.js help`)
