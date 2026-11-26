# Review 5e4cf3cf-3f61-496e-a3b1-257ed2f0d0cd — rounds, round 4

- Commit: 8b6a038
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: over tolerance
- 3 findings

## High (1)

- **Tester key survives fetch and read into committed files** — `src/lib/persona/client.js:125` (security): hex key reads as a slug — fix: cut /k/, Bearer and the exact keys

## Medium (1)

- **Requests follow redirects to any host** — `src/lib/persona/client.js:33` (security): default redirect follow — fix: redirect manual

## Low (1)

- **Coding key sent in clear to any http host** — `src/lib/persona/client.js:47` (security): no scheme rule — fix: http only for this computer
