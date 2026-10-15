# Preflight doctor checks before a run — rebuild

## Idea (in our words)
Run a fast preflight before any expensive work. Each check reports a name, a pass or fail flag, a human sentence saying what was found or what to install, and whether it is fatal. Fatal failures block the run with a usage exit code. Non-fatal ones, such as an unpinned container image, a missing project model or a logged-out GitHub CLI, print a warning and let work continue, because the local loop is still useful without them. Checks depend on the chosen mode: agent runtimes are only probed when agents are enabled, and the container pin only matters for the deterministic gate. Adopt this as a doctor verb in the kit: list the tools each workflow needs, give each a clear fix hint, and let the verdict decide the exit code.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.348Z
- Evidence: packages/cli/src/commands/doctor.ts:14-133

## What we have
missing — No candidate defines a doctor/preflight verb or checks tools with fatal and non-fatal verdicts; the workflow commands only say to skip when the kit is missing.

## Lands in (a separate deliverable)
- cli `cli:bin/cli.js` · check · blocking — reached by: Run `danizee-claude-suite check` in a project.; Adds named doctor checks (config, node version, binaries, agent runtimes, optional gh login) separating fatal from advisory, mapped to a usage exit code.
- `/w-marathon` · ⛔ CHECKPOINT 3: Arm · blocking — Runs doctor checks before the long loop is armed.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_preflight-doctor-checks-before-a-run` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_preflight-doctor-checks-before-a-run`: preflight-doctor-checks-before-a-run: green unit runs in a row
- `egress_zero_preflight-doctor-checks-before-a-run`: preflight-doctor-checks-before-a-run: zero egress in the packaged check
- `six_sigma_preflight-doctor-checks-before-a-run`: preflight-doctor-checks-before-a-run: clean reviews in a row
- `wired_preflight-doctor-checks-before-a-run`: preflight-doctor-checks-before-a-run: wired into all 2 targets, reached by a user
- `packaged_preflight-doctor-checks-before-a-run`: preflight-doctor-checks-before-a-run: packaged check passes

## Kickoff lines

Done means
- tests_green_preflight-doctor-checks-before-a-run — green unit runs in a row
- egress_zero_preflight-doctor-checks-before-a-run — zero egress in the packaged check
- six_sigma_preflight-doctor-checks-before-a-run — clean reviews in a row
- wired_preflight-doctor-checks-before-a-run — wired into all 2 targets, reached by a user
- packaged_preflight-doctor-checks-before-a-run — packaged check passes

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

