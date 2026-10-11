# Review 8616aec2-0b75-4db7-a1c8-ef52a2937b03 — usage, round 4

- Commit: 072e408
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 2 findings

## Medium (2)

- **usage.json records command and skill names from every project on the machine, and run folders are committed to git** — `src/lib/bbs/usage.js:204` (security): other keeps names of non-installed commands from all projects and the run folder is tracked. — fix: Store only a count of non-installed invocations; say the scan covers every project.
- **A corrupt usage.json makes verdict --decide fail with an error that does not name the --force repair** — `src/lib/bbs/verdict.js:827` (correctness): recordDecisions reads usage.json without a handler. — fix: Append the cli.js usage --force hint; test it.
