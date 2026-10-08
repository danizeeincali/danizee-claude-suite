# Review d85e685b-f180-4a24-a80c-c7efce195fb7 — intake, round 6

- Commit: 497e7cf
- Angle: facts and content
- Result: pass
- 2 findings

## Medium (2)

- **'omit --run to use the active run' is printed when the id already came from ACTIVE** — `src/lib/bbs/cli.js:104` (facts): resolveRun builds the same unknown-run message whether the id came from --run or from ACTIVE; with a stale ACTIVE the advice loops. — fix: Branch on whether --run was given; name ACTIVE and the next step.
- **Empty-paste error says (stdin) when the empty paste was the source argument** — `src/lib/bbs/intake.js:283` (facts): content falls back to String(ref) but the label only distinguishes --paste-file from everything else. — fix: Label by origin: --paste-file, stdin, or the source argument.
