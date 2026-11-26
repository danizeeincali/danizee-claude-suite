# Review 0c4bdfd7-fa11-41b8-9b22-4baa1aad62d2 — rounds, round 3

- Commit: ad2849a
- Angle: older environments and degraded networks
- Result: over tolerance
- 4 findings

## High (1)

- **Installed cli does not start in a CommonJS project** — `src/plugins/persona.js:37` (correctness): no package.json in helpers/persona — fix: ship type module

## Medium (2)

- **Transient server error during replan read as no reports** — `src/lib/persona/cli.js:173` (correctness): refused returns empty — fix: refuse on any failure
- **Publish with a lost answer never marks the round published** — `src/lib/persona/cli.js:392` (correctness): marked after — fix: mark before

## Low (1)

- **Timeout during the body reported as not JSON** — `src/lib/persona/client.js:58` (correctness): catch swallows — fix: check the error name
