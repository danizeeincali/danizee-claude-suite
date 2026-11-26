# Review ab6175f1-4367-4e66-acd7-53677a49a4c1 — rounds, round 5

- Commit: 7d2c823
- Angle: accessibility
- Result: over tolerance
- 10 findings

## Medium (3)

- **Deck steps name kit commands that fail as written** — `.claude/commands/.shortcuts/w-persona-test.md:47` (docs): see write-up — fix: fixed in bc8d27e
- **read, fetch, status of an unplanned round report no findings** — `src/lib/persona/cli.js:445` (correctness): see write-up — fix: fixed in bc8d27e
- **README gives the wrong Node floor for serve** — `README.md:417` (facts): see write-up — fix: fixed in bc8d27e

## Low (7)

- **Replan refusal does not name the flag** — `src/lib/persona/plan.js:217` (accessibility): see write-up — fix: fixed in bc8d27e
- **Replanning a published round never says to publish again** — `.claude/commands/.shortcuts/w-persona-test.md:32` (docs): see write-up — fix: fixed in bc8d27e
- **connect prints a tester line for http remote addresses** — `src/lib/persona/cli.js:272` (security): see write-up — fix: fixed in bc8d27e
- **Guide promises sitting; findings always say Remembered** — `src/lib/persona/brief.js:152` (facts): see write-up — fix: fixed in bc8d27e
- **read reports its file as a bare name** — `src/lib/persona/cli.js:448` (accessibility): see write-up — fix: fixed in bc8d27e
- **No verb has no stderr sentence; server failure codes differ by verb** — `src/lib/persona/cli.js:376` (accessibility): see write-up — fix: fixed in bc8d27e
- **Notes heading repeated inside Notes** — `src/lib/persona/report-shape.js:222` (accessibility): see write-up — fix: fixed in bc8d27e
