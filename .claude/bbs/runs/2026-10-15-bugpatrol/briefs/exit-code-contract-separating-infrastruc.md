# Exit code contract separating infrastructure from product failure — rebuild

## Idea (in our words)
Give each outcome its own numeric code and a one-line description, and reserve a single code for the only result that should fail a build. Infrastructure problems such as a crashed browser, a missing network or a boot failure must never turn a build red on their own, because a team that sees false reds stops trusting the gate. The same description text can be reused in the terminal summary and in report output, so every surface says the same thing. For the kit, adopt this as the contract for every verb and helper script: exit 0 for clean, a dedicated code for a real regression, another for misuse, and another for a precondition that was never met, so CI can tell a broken tool from a broken product.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.349Z
- Evidence: packages/core/src/exit-codes.ts:7-39, packages/cli/src/commands/run-cli.ts:106-110

## What we have
partial — kit-exit.js — kit-exit.js defines a KitExit error carrying a numeric code, but only codes 1 (invalid or broken) and 2 (refused) exist; there is no clean code 0, dedicated regression code or unmet-precondition code, and no shared description text.

## Lands in (a separate deliverable)
- cli `cli:bin/cli.js` · check · blocking — reached by: Run `danizee-claude-suite check`; the exit code is read by scripts and CI.; Exit codes keep usage, missing prerequisite, infrastructure and product failures distinct.
- job `job:.github/workflows/test.yml` · node-test · blocking — reached by: Runs on every push and pull request.; Only the predicate's product-failure outcome may fail the job, not infrastructure errors.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_exit-code-contract-separating-infrastruc` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_exit-code-contract-separating-infrastruc`: exit-code-contract-separating-infrastruc: green unit runs in a row
- `egress_zero_exit-code-contract-separating-infrastruc`: exit-code-contract-separating-infrastruc: zero egress in the packaged check
- `six_sigma_exit-code-contract-separating-infrastruc`: exit-code-contract-separating-infrastruc: clean reviews in a row
- `wired_exit-code-contract-separating-infrastruc`: exit-code-contract-separating-infrastruc: wired into all 2 targets, reached by a user
- `packaged_exit-code-contract-separating-infrastruc`: exit-code-contract-separating-infrastruc: packaged check passes

## Kickoff lines

Done means
- tests_green_exit-code-contract-separating-infrastruc — green unit runs in a row
- egress_zero_exit-code-contract-separating-infrastruc — zero egress in the packaged check
- six_sigma_exit-code-contract-separating-infrastruc — clean reviews in a row
- wired_exit-code-contract-separating-infrastruc — wired into all 2 targets, reached by a user
- packaged_exit-code-contract-separating-infrastruc — packaged check passes

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

