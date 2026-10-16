# change-impact test plan — rebuild

## Idea (in our words)
Build an inverse index from source file to screens during discovery. For a change set, direct hits get a direct-change reason. A file that touches at least a set share of screens (default 30 percent) is a shared component and gets its own reason, so a token-level edit is not under-tested. Any flow containing an affected screen pulls in the whole flow. If the share of changed files that map to any screen falls below a threshold (default 60 percent), add a smoke set ranked by how connected each screen is plus the entry points, and mark the run low-confidence rather than silently under-testing. Items are deduplicated by target, keeping the strongest reason, and always-on checks are appended. The output is a plan with coverage counts so a reviewer can see what was and was not tested.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.342Z
- Evidence: packages/recon/src/change-map.ts:19-78

## What we have
partial — impact.js — impact.js maps diff to touched symbols, walks callers up to hops and scores risk with a lower_bound flag, but has no screen/flow inverse index, shared-component share rule, smoke set or test-plan coverage counts.

## Lands in (a separate deliverable)
- job `job:.github/workflows/test.yml` · node-test · advisory — reached by: Runs on every push to main and every pull request.; Maps changed files to affected tests and falls back to a smoke set, printing a reason per item.
- `/w-fix` · ⛔ CHECKPOINT 2: Fix Applied · advisory — After a fix, plans which tests to run from the changed files, with reasons.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_change-impact-test-plan` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_change-impact-test-plan`: change-impact-test-plan: green unit runs in a row
- `egress_zero_change-impact-test-plan`: change-impact-test-plan: zero egress in the packaged check
- `six_sigma_change-impact-test-plan`: change-impact-test-plan: clean reviews in a row
- `wired_change-impact-test-plan`: change-impact-test-plan: wired into all 2 targets, reached by a user
- `packaged_change-impact-test-plan`: change-impact-test-plan: packaged check passes

## Kickoff lines

Done means
- tests_green_change-impact-test-plan — green unit runs in a row
- egress_zero_change-impact-test-plan — zero egress in the packaged check
- six_sigma_change-impact-test-plan — clean reviews in a row
- wired_change-impact-test-plan — wired into all 2 targets, reached by a user
- packaged_change-impact-test-plan — packaged check passes

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

