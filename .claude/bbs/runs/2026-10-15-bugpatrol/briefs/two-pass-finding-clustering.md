# two pass finding clustering — rebuild

## Idea (in our words)
One broken shared part should produce one issue, not twenty. The first pass is free: bucket findings by rule and by the sorted set of files they point at, keep the most severe member as the representative, and list every screen it touched. Only groups the first pass could not settle go to a model, one residual pair at a time. A pair is merged only when the model says yes with at least even odds and high confidence, because merging hides findings and so needs a stronger bar than raising one. Model cost then scales with real ambiguity rather than raw finding count, and the deterministic pass works with no model at all.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.339Z
- Evidence: packages/triage/src/cluster.ts:23-46

## What we have
missing — No candidate buckets findings by rule and file set or runs a pairwise model merge; the marathon routing and wording-judge candidates do not cluster findings.

## Lands in (a separate deliverable)
- `/w-review` · ⛔ CHECKPOINT 1: Code Analysis · advisory — Groups duplicate findings from parallel agents by rule and file set, asking a model only about unresolved pairs.
- `/w-bg-review` · Phase 4: Ralph Candidates · advisory — Deduplicates findings across phases before candidates are listed.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_two-pass-finding-clustering` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_two-pass-finding-clustering`: two-pass-finding-clustering: green unit runs in a row
- `egress_zero_two-pass-finding-clustering`: two-pass-finding-clustering: zero egress in the packaged check
- `six_sigma_two-pass-finding-clustering`: two-pass-finding-clustering: clean reviews in a row
- `wired_two-pass-finding-clustering`: two-pass-finding-clustering: wired into all 2 targets, reached by a user
- `packaged_two-pass-finding-clustering`: two-pass-finding-clustering: packaged check passes

## Kickoff lines

Done means
- tests_green_two-pass-finding-clustering — green unit runs in a row
- egress_zero_two-pass-finding-clustering — zero egress in the packaged check
- six_sigma_two-pass-finding-clustering — clean reviews in a row
- wired_two-pass-finding-clustering — wired into all 2 targets, reached by a user
- packaged_two-pass-finding-clustering — packaged check passes

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
- Never run the upstream code (use was removed: network probe found: the source makes a network call the inventory does not account for)

