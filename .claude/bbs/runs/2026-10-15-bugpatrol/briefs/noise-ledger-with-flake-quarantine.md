# noise ledger with flake quarantine — rebuild

## Idea (in our words)
Keep the first encounter with a new checker survivable. Rank findings by severity, then by how many screens they touch. File only the top N as separate issues and fold the rest into one summary item. On a project's first approved run, report but never block. A finding that fails to reproduce on two retries is marked quarantined: it stays listed and never blocks, and it is surfaced as a sign that the baseline or determinism setup needs attention, not silently dropped. Accepted decisions live in a committed file with an optional expiry, so a suppression is re-examined once it lapses; expired entries stop matching and can be pruned. Flake rate is failures minus reproductions, divided by failures.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.336Z
- Evidence: packages/triage/src/noise.ts:4-17, packages/triage/src/ledger.ts:40-43

## What we have
missing — No candidate has accepted-decision expiry, reproduction retries, quarantine or flake-rate logic; marathon findings.js only normalizes/folds rows and review-score.js only scores planted bugs.

## Lands in (a separate deliverable)
- `/w-review` · ⛔ CHECKPOINT 4: Ralph Candidates (AUTO-PROCEED) · advisory — Caps new candidate issues per run and quarantines findings that do not reproduce on retry before they become Ralph work.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_noise-ledger-with-flake-quarantine` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_noise-ledger-with-flake-quarantine`: noise-ledger-with-flake-quarantine: green unit runs in a row
- `egress_zero_noise-ledger-with-flake-quarantine`: noise-ledger-with-flake-quarantine: zero egress in the packaged check
- `six_sigma_noise-ledger-with-flake-quarantine`: noise-ledger-with-flake-quarantine: clean reviews in a row
- `wired_noise-ledger-with-flake-quarantine`: noise-ledger-with-flake-quarantine: wired into its target, reached by a user
- `packaged_noise-ledger-with-flake-quarantine`: noise-ledger-with-flake-quarantine: packaged check passes

## Kickoff lines

Done means
- tests_green_noise-ledger-with-flake-quarantine — green unit runs in a row
- egress_zero_noise-ledger-with-flake-quarantine — zero egress in the packaged check
- six_sigma_noise-ledger-with-flake-quarantine — clean reviews in a row
- wired_noise-ledger-with-flake-quarantine — wired into its target, reached by a user
- packaged_noise-ledger-with-flake-quarantine — packaged check passes

You may decide on your own
- How to structure the code behind each power's interface, within its brief
- Test names, fixtures and file layout

Ask me before
- Adding a dependency
- Any network call, account, purchase or signature
- Changing a finish line

Never
- Never execute fetched foreign code
- Never copy source code from the source

