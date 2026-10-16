# trouble-log reflection into lesson memory — rebuild

## Idea (in our words)
Before any model is called, the event log is reduced to a trouble log of plain signals: the same tool call repeated with identical input, the same field typed into again, three or more waits in a row, failed actions, and the stop reason. Lines are capped and length-limited, and secrets are redacted. Only then does a reviewer model run, with three tools: save a lesson, keep an existing one, or retire a wrong one with a reason. The reviewer is told to write one imperative, app-specific sentence per lesson, and the session has a hard cap on new lessons. Lesson writing is guarded by a word-overlap check against existing lessons of the same role. A near match must be confirmed by id rather than duplicated, and a deliberately different lesson must be marked as such to save. A lesson may be saved for another role, for example so the judge can tell the fixer why a fix failed. Reusable for any agent workflow that wants to learn across runs without a vector store.

## Provenance
- Source: repo https://github.com/agent-labs-dev/bugpatrol
- Identity: git:960cd19
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-15-bugpatrol
- Decided: 2026-10-15T14:36:46.346Z
- Evidence: repo/packages/agents/src/roles/reflect.ts:19-62, repo/packages/agents/src/tools/memory.ts:52-63

## What we have
missing — No candidate reduces an event log to trouble signals or runs a reviewer that saves, keeps or retires lessons; routing.js and wording-judge.js do not do this.

## Lands in (a separate deliverable)
- `/w-fix` · ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP) · advisory — Builds a trouble log from the session and has a reviewer save, keep or retire short lessons.
- `/w-bbs` · ⛔ CHECKPOINT 6: Compound (MANDATORY) · advisory — Turns the audit run's trouble log into saved lessons for future runs.
- Build the power so these places can call it: one entry (a kit verb for a workflow, a module and function for code). The `integration` stream wires it in; `wired_trouble-log-reflection-into-lesson-memor` counts only a target that uses the entry and, for code, a reach test that goes in through the surface and passes.

## Finish line (5 checks, written before the build)
- `tests_green_trouble-log-reflection-into-lesson-memor`: trouble-log-reflection-into-lesson-memor: green unit runs in a row
- `egress_zero_trouble-log-reflection-into-lesson-memor`: trouble-log-reflection-into-lesson-memor: zero egress in the packaged check
- `six_sigma_trouble-log-reflection-into-lesson-memor`: trouble-log-reflection-into-lesson-memor: clean reviews in a row
- `wired_trouble-log-reflection-into-lesson-memor`: trouble-log-reflection-into-lesson-memor: wired into all 2 targets, reached by a user
- `packaged_trouble-log-reflection-into-lesson-memor`: trouble-log-reflection-into-lesson-memor: packaged check passes

## Kickoff lines

Done means
- tests_green_trouble-log-reflection-into-lesson-memor — green unit runs in a row
- egress_zero_trouble-log-reflection-into-lesson-memor — zero egress in the packaged check
- six_sigma_trouble-log-reflection-into-lesson-memor — clean reviews in a row
- wired_trouble-log-reflection-into-lesson-memor — wired into all 2 targets, reached by a user
- packaged_trouble-log-reflection-into-lesson-memor — packaged check passes

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

