# Kickoff — 2026-10-10-bbs-openqodex-2

## Done means
- pre-push-review-gate: 5 checks below
  - tests_green_pre-push-review-gate — green unit runs in a row
  - egress_zero_pre-push-review-gate — zero egress in the packaged check
  - six_sigma_pre-push-review-gate — clean reviews in a row
  - callers_pre-push-review-gate — callers in the harness
  - packaged_pre-push-review-gate — packaged check passes
- secret-redaction-by-value-and-fingerprint: 5 checks below
  - tests_green_secret-redaction-by-value-and-fingerprin — green unit runs in a row
  - egress_zero_secret-redaction-by-value-and-fingerprin — zero egress in the packaged check
  - six_sigma_secret-redaction-by-value-and-fingerprin — clean reviews in a row
  - callers_secret-redaction-by-value-and-fingerprin — callers in the harness
  - packaged_secret-redaction-by-value-and-fingerprin — packaged check passes
- lens-catalog-file-triggered-checks: 5 checks below
  - tests_green_lens-catalog-file-triggered-checks — green unit runs in a row
  - egress_zero_lens-catalog-file-triggered-checks — zero egress in the packaged check
  - six_sigma_lens-catalog-file-triggered-checks — clean reviews in a row
  - callers_lens-catalog-file-triggered-checks — callers in the harness
  - packaged_lens-catalog-file-triggered-checks — packaged check passes
- hardened-git-read-on-untrusted-repo: 5 checks below
  - tests_green_hardened-git-read-on-untrusted-repo — green unit runs in a row
  - egress_zero_hardened-git-read-on-untrusted-repo — zero egress in the packaged check
  - six_sigma_hardened-git-read-on-untrusted-repo — clean reviews in a row
  - callers_hardened-git-read-on-untrusted-repo — callers in the harness
  - packaged_hardened-git-read-on-untrusted-repo — packaged check passes
- identity-checked-file-writes: 5 checks below
  - tests_green_identity-checked-file-writes — green unit runs in a row
  - egress_zero_identity-checked-file-writes — zero egress in the packaged check
  - six_sigma_identity-checked-file-writes — clean reviews in a row
  - callers_identity-checked-file-writes — callers in the harness
  - packaged_identity-checked-file-writes — packaged check passes
- change-blast-radius-walk: 5 checks below
  - tests_green_change-blast-radius-walk — green unit runs in a row
  - egress_zero_change-blast-radius-walk — zero egress in the packaged check
  - six_sigma_change-blast-radius-walk — clean reviews in a row
  - callers_change-blast-radius-walk — callers in the harness
  - packaged_change-blast-radius-walk — packaged check passes
- caller-floor-disclosure: 5 checks below
  - tests_green_caller-floor-disclosure — green unit runs in a row
  - egress_zero_caller-floor-disclosure — zero egress in the packaged check
  - six_sigma_caller-floor-disclosure — clean reviews in a row
  - callers_caller-floor-disclosure — callers in the harness
  - packaged_caller-floor-disclosure — packaged check passes
- fact-cached-graph-build-with-budget: 5 checks below
  - tests_green_fact-cached-graph-build-with-budget — green unit runs in a row
  - egress_zero_fact-cached-graph-build-with-budget — zero egress in the packaged check
  - six_sigma_fact-cached-graph-build-with-budget — clean reviews in a row
  - callers_fact-cached-graph-build-with-budget — callers in the harness
  - packaged_fact-cached-graph-build-with-budget — packaged check passes
- tracked-file-scrub-gate: 5 checks below
  - tests_green_tracked-file-scrub-gate — green unit runs in a row
  - egress_zero_tracked-file-scrub-gate — zero egress in the packaged check
  - six_sigma_tracked-file-scrub-gate — clean reviews in a row
  - callers_tracked-file-scrub-gate — callers in the harness
  - packaged_tracked-file-scrub-gate — packaged check passes
- planted-bug-review-scoring: 5 checks below
  - tests_green_planted-bug-review-scoring — green unit runs in a row
  - egress_zero_planted-bug-review-scoring — zero egress in the packaged check
  - six_sigma_planted-bug-review-scoring — clean reviews in a row
  - callers_planted-bug-review-scoring — callers in the harness
  - packaged_planted-bug-review-scoring — packaged check passes
- isolated-tool-free-wording-judge: 5 checks below
  - tests_green_isolated-tool-free-wording-judge — green unit runs in a row
  - egress_zero_isolated-tool-free-wording-judge — zero egress in the packaged check
  - six_sigma_isolated-tool-free-wording-judge — clean reviews in a row
  - callers_isolated-tool-free-wording-judge — callers in the harness
  - packaged_isolated-tool-free-wording-judge — packaged check passes

## You may decide on your own
- How to structure the code behind each power's interface, within its brief
- Test names, fixtures and file layout

## Ask me before
- Adding a dependency
- Any network call, account, purchase or signature
- Changing a finish line

## Never
- Never execute fetched foreign code
- Never copy source code from the source

## Source
- Source: repo https://github.com/openqodex/openqodex
- bbs run: 2026-10-10-openqodex-2
- bbs run dir: .claude/bbs/runs/2026-10-10-openqodex-2
- Brief (pre-push-review-gate): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/pre-push-review-gate.md
- Brief (secret-redaction-by-value-and-fingerprint): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/secret-redaction-by-value-and-fingerprin.md
- Brief (lens-catalog-file-triggered-checks): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/lens-catalog-file-triggered-checks.md
- Brief (hardened-git-read-on-untrusted-repo): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/hardened-git-read-on-untrusted-repo.md
- Brief (identity-checked-file-writes): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/identity-checked-file-writes.md
- Brief (change-blast-radius-walk): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/change-blast-radius-walk.md
- Brief (caller-floor-disclosure): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/caller-floor-disclosure.md
- Brief (fact-cached-graph-build-with-budget): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/fact-cached-graph-build-with-budget.md
- Brief (tracked-file-scrub-gate): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/tracked-file-scrub-gate.md
- Brief (planted-bug-review-scoring): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/planted-bug-review-scoring.md
- Brief (isolated-tool-free-wording-judge): .claude/bbs/runs/2026-10-10-openqodex-2/briefs/isolated-tool-free-wording-judge.md

## Budget
- Run token budget: 10,000,000
- Usage ceiling: 100% of the weekly allowance, checked before every fan-out
- Helper budget: 150,000 (max 200,000)

## Models
- Lead: the session model · scoped builds: haiku · builds: sonnet · hard builds: opus · review: opus · routine: haiku
- Ladder: haiku → sonnet → opus → session. A failed job retries one tier up, never on the same tier.
