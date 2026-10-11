# Review 46147729-16fc-46d0-bd96-f949cf0eb5a0 — integration-gate, round 3

- Commit: 6015d1a
- Angle: older environments and degraded networks
- Result: pass
- 3 findings

## Medium (2)

- **Hand-off of a run with no targets.json makes unmeetable finish lines** — `src/lib/bbs/handoff.js:515` (correctness): wired and delivered throw for every power and no repair path is named — fix: refuse the hand-off naming usage, surfaces, targets --set --force
- **Reach tests hard-wired to POSIX sh and group kill** — `src/lib/bbs/wiring.js:157` (correctness): on Windows every reach test fails to start — fix: use the platform shell and taskkill /T on win32

## Low (1)

- **Activity misses non-ASCII paths quoted by git log** — `src/lib/bbs/surfaces.js:151` (correctness): core.quotePath C-quotes them so counts are 0 — fix: git -c core.quotePath=false log
