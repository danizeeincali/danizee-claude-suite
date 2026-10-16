# Review 0b049849-77d9-4844-87f9-99ec9cc2febf — repeated-replay-gate-for-claims, round 2

- Commit: 0252e36
- Angle: failure conditions and error paths
- Result: pass
- 2 findings

## Low (2)

- **A replay that throws a KitExit is reported as 'it returned an invalid run'** — `src/lib/kit/replay-gate.js:155` (facts): The catch tells the two failure kinds apart with \`e instanceof KitExit\`, but an injected replay that wraps another kit verb (for example safe-git failing with KitExit code 3) throws a KitExit itself. That verdict then gets the reason 'no second run: it returned an invalid run (git ran and failed)' (confirmed with a node one-liner), which sends the reader to look at the run's shape when the replay actually failed. The class (untested) is correct; only the reason misleads. — fix: Keep a flag set only around the checkRun call (or wrap checkRun in its own try) and choose 'it returned an invalid run' from that flag, not from the error's type.
- **Deeply nested run values fail with a bare 'Maximum call stack size exceeded'** — `src/lib/kit/replay-gate.js:55` (other): requirePlainJson, canon and diffPaths recurse with no depth limit. A run whose outputs nest about 20000 arrays deep (JSON.parse accepts it) makes gate() throw a RangeError instead of KitExit 1. Through the CLI the exit is still 1, but the message is only 'kit: Maximum call stack size exceeded', with no hint of which verdict or field caused it (confirmed with --file on such input). Library callers get a RangeError, not the KitExit the header documents for invalid input. — fix: Pass a depth counter through requirePlainJson and fail with KitExit 1 naming the path (for example \`verdicts\[0\].runs\[0\].outputs is nested too deeply\`) above a fixed limit such as 1000. canon and diffPaths are then safe because they only see validated runs.
